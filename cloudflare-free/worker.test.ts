import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, type ObservedRun } from './metrics.ts';
import { load, numberMap } from './source.ts';
import worker, { handle, parseOptions } from './worker.ts';
const now = new Date('2026-09-21T04:00:00Z'), start = new Date('2026-09-20T00:00:00Z');
const root = { id: 'trace-1', trace_id: 'trace-1', start_time: '2026-09-20T01:00:00Z', end_time: '2026-09-20T01:00:02Z',
  total_cost: .25, error: null, extra: { metadata: { total_response_ms: 1900,
    agent_latencies_ms: '{"roteador":200,"sst":700}', agent_transitions_ms: '{"roteador->sst":50}' } } };
const children = [
  { id: 'agent-1', trace_id: 'trace-1', parent_run_id: 'trace-1', name: 'roteador', total_cost: .10, error: null },
  { id: 'agent-inner', trace_id: 'trace-1', parent_run_id: 'agent-1', name: 'roteador', total_cost: .10, error: null },
  { id: 'agent-2', trace_id: 'trace-1', parent_run_id: 'trace-1', name: 'sst', total_cost: .15, error: 'failure' },
];
const env = { LANGSMITH_API_KEY: 'test-key', LANGSMITH_PROJECT: 'project-tests' };
function fakeSource(rootResponse: any = { runs: [root] }, feedback = [{ run_id: 'trace-1', score: 1 }], childResponse: any = { runs: children }) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetcher = async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input)); calls.push({ url, init });
    assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).get('x-api-key'), 'test-key');
    if (url.pathname === '/sessions') return Response.json([{ id: 'project-id' }]);
    if (url.pathname === '/feedback') return Response.json(feedback);
    assert.equal(url.pathname, '/runs/query');
    const body = JSON.parse(String(init.body));
    assert.ok(!body.select.includes('inputs') && !body.select.includes('outputs'));
    return Response.json(body.is_root ? rootResponse : childResponse);
  };
  return { fetcher: fetcher as typeof fetch, calls };
}
test('LangSmith metadata, feedback and nested agent costs preserve the backend semantics', async () => {
  const fake = fakeSource(), data = await load(env, start, now, fake.fetcher);
  assert.equal(data.truncated, false); assert.equal(data.runs[0].latency_ms, 1900);
  assert.deepEqual(data.runs[0].agent_latencies_ms, { roteador: 200, sst: 700 });
  assert.deepEqual({ ...data.runs[0].agent_costs_usd }, { roteador: .10, sst: .15 });
  assert.deepEqual({ ...data.runs[0].agent_errors }, { sst: 1 }); assert.equal(data.runs[0].resolved, 1);
  assert.equal(fake.calls.length, 4);
});
test('root sample and child pagination stop at their limits and explicitly report partial data', async () => {
  const fake = fakeSource({ runs: [root], cursors: { next: 'more-roots' } }, [], { runs: children, cursors: { next: 'more-children' } });
  const data = await load(env, start, now, fake.fetcher);
  assert.equal(data.truncated, true); assert.equal(data.childPartial, true);
  assert.ok(fake.calls.length <= 20);
});
test('feedback pagination is bounded and reports incomplete feedback', async () => {
  const fake = fakeSource({ runs: [root] }, Array.from({ length: 100 }, () => ({ run_id: 'trace-1', score: 1 })));
  const data = await load(env, start, now, fake.fetcher);
  assert.equal(data.feedbackPartial, true); assert.equal(fake.calls.filter(c => c.url.pathname === '/feedback').length, 5);
});
test('invalid or negative metadata is omitted; metadata cannot poison object prototypes', () => {
  assert.deepEqual(numberMap('bad-json'), {}); assert.deepEqual(numberMap([1, 2]), {});
  assert.deepEqual(numberMap({ a: -1, b: '2', c: 3, d: Infinity }), { c: 3 });
  assert.deepEqual(numberMap('{"__proto__":2}'), Object.fromEntries([['__proto__', 2]]));
  assert.equal(({} as any).polluted, undefined);
});
test('untrusted endpoints cannot receive LangSmith credentials', async () => {
  let called = false;
  await assert.rejects(load({ ...env, LANGSMITH_ENDPOINT: 'https://example.com' }, start, now, (async () => { called = true; }) as any));
  assert.equal(called, false);
});
test('health works without secrets; dashboard requires a configured secret', async () => {
  const health = await worker.fetch(new Request('https://worker.test/health'), {});
  assert.deepEqual(await health.json(), { status: 'ok' });
  const dash = await worker.fetch(new Request('https://worker.test/api/observability/dashboard'), {});
  assert.equal(dash.status, 503); assert.ok(!(await dash.text()).includes('test-key'));
});
test('the dashboard preserves CORS, validates parameters, and never exposes upstream errors or keys', async () => {
  const url = 'https://worker.test/api/observability/dashboard';
  const options = { headers: { Origin: 'http://localhost:4174' } };
  const success = await handle(new Request(`${url}?period=7d`, options), env, fakeSource().fetcher, now);
  assert.equal(success.status, 200); assert.equal(success.headers.get('Access-Control-Allow-Origin'), 'http://localhost:4174');
  const body: any = await success.json(); assert.equal(body.runs_examined, 1); assert.equal(body.total_cost_usd, .25);
  assert.ok(!JSON.stringify(body).includes('trace-1'));
  const bad = await handle(new Request(`${url}?hourly_cost_usd=NaN`), env, fakeSource().fetcher, now);
  assert.equal(bad.status, 422);
  const failure = await handle(new Request(`${url}?period=custom&start=2026-09-20T00:00:00Z&end=2026-09-20T12:00:00Z`), env,
    (async () => { throw new Error('test-key upstream debug'); }) as any, now);
  assert.equal(failure.status, 502); assert.ok(!(await failure.text()).includes('test-key'));
});
test('aggregate cache prevents a repeated query from reaching LangSmith', async () => {
  const fake = fakeSource(), req = new Request('https://worker.test/api/observability/dashboard?hourly_cost_usd=17');
  await handle(req, env, fake.fetcher, now); const count = fake.calls.length;
  await handle(req, env, fake.fetcher, now); assert.equal(fake.calls.length, count);
});
test('ROI changes reuse a sanitized source sample without repeating LangSmith requests', async () => {
  const fake = fakeSource(), uniqueEnv = { ...env, LANGSMITH_PROJECT: 'roi-cache-test' };
  const base = 'https://worker.test/api/observability/dashboard?hourly_cost_usd=';
  const first = await handle(new Request(base + '6'), uniqueEnv, fake.fetcher, now);
  const count = fake.calls.length;
  const second = await handle(new Request(base + '17'), uniqueEnv, fake.fetcher, now);
  assert.equal(first.status, 200); assert.equal(second.status, 200); assert.equal(fake.calls.length, count);
  assert.equal((await second.json() as any).roi.hourly_cost_usd, 17);
});
test('simultaneous dashboard requests share one upstream query', async () => {
  const fake = fakeSource(), uniqueEnv = { ...env, LANGSMITH_PROJECT: 'single-flight-test' };
  const request = new Request('https://worker.test/api/observability/dashboard');
  const responses = await Promise.all([handle(request, uniqueEnv, fake.fetcher, now), handle(request, uniqueEnv, fake.fetcher, now)]);
  assert.ok(responses.every(r => r.status === 200)); assert.equal(fake.calls.length, 4);
});
test('LangSmith rate limits are exposed as retryable status without automatic retries', async () => {
  let calls = 0;
  const response = await handle(new Request('https://worker.test/api/observability/dashboard'),
    { ...env, LANGSMITH_PROJECT: 'rate-limit-test' }, (async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '42' } }); }) as any, now);
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '42'); assert.equal(calls, 1);
});
test('a rate-limited integration stays quiet until its cooldown expires', async () => {
  let calls = 0;
  const project = { ...env, LANGSMITH_PROJECT: 'cooldown-test' }, clock = new Date();
  const upstream = (async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); }) as any;
  const first = await handle(new Request('https://worker.test/api/observability/dashboard?period=7d'), project, upstream, clock);
  const second = await handle(new Request('https://worker.test/api/observability/dashboard?period=30d'), project, upstream, clock);
  assert.equal(first.status, 429); assert.equal(second.status, 429); assert.equal(calls, 1);
});
test('custom dates need a timezone; future, reversed and long intervals are rejected', () => {
  for (const query of [
    'period=custom&start=2026-09-20&end=2026-09-21',
    'period=custom&start=2026-09-21T00:00:00Z&end=2026-09-20T00:00:00Z',
    'period=custom&start=2026-01-01T00:00:00Z&end=2026-09-20T00:00:00Z',
    'period=custom&start=2026-09-20T00:00:00Z&end=2027-01-01T00:00:00Z',
    'requests_per_user_week=0', 'minutes_saved_per_resolution=-1', 'period=wrong',
  ]) assert.throws(() => parseOptions(new URL(`https://test/?${query}`), 'America/Sao_Paulo', now));
  assert.equal(parseOptions(new URL('https://test/?period=today'), 'America/Sao_Paulo', now).start.toISOString(), '2026-09-21T03:00:00.000Z');
});
test('zero costs, missing feedback and local-day grouping retain meaningful nulls', () => {
  const run: ObservedRun = { run_id: 'x', started_at: '2026-09-20T01:00:00Z', latency_ms: 0, cost_usd: 0,
    error: false, resolved: null, agent_latencies_ms: {}, agent_costs_usd: {}, agent_errors: {}, agent_transitions_ms: {}, error_stage: null };
  const result = aggregate([run], { start, end: now, timezone: 'America/Sao_Paulo', truncated: false,
    requests_per_user_week: 5, minutes_saved_per_resolution: 9.5, hourly_cost_usd: 6, other_operational_cost_usd: 0 }, now);
  assert.equal(result.total_cost_usd, 0); assert.equal(result.average_latency_ms, 0); assert.equal(result.roi.roi_percent, null);
  assert.equal(result.resolution_rate, null); assert.equal(result.daily[0].date, '2026-09-19'); assert.equal(result.daily[0].executions, 1);
});
