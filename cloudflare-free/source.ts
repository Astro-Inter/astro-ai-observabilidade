import type { ObservedRun } from './metrics.ts';
export interface SourceEnv { LANGSMITH_API_KEY?: string; LANGSMITH_PROJECT?: string; LANGSMITH_ENDPOINT?: string; LANGSMITH_WORKSPACE_ID?: string }
type Raw = Record<string, any>;
export class SourceError extends Error {
  code: string; stage: string; status?: number; reason?: string; retryAfter?: number;
  constructor(code: string, stage: string, status?: number, reason?: string, retryAfter?: number) { super(code); this.name = 'SourceError'; this.code = code; this.stage = stage; this.status = status; this.reason = reason; this.retryAfter = retryAfter; }
}

// Reserve query slots per integration in this isolate. Other isolates may still
// exhaust the workspace limit; the Worker retains Retry-After and cache fallback.
export function createQueryScheduler(wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), clock = Date.now) {
  const slots = new Map<string, number>();
  return async (key: string, interval: number) => {
    const now = clock(), at = Math.max(now, slots.get(key) ?? now);
    if (slots.size >= 64 && !slots.has(key)) {
      for (const [name, expiry] of slots) if (expiry <= now) slots.delete(name);
      if (slots.size >= 64) throw new SourceError('query_busy', '/runs/query', 429, undefined, 10);
    }
    slots.set(key, at + interval);
    if (at > now) await wait(at - now);
  };
}
const scheduleQuery = createQueryScheduler();

export const ROOT_LIMIT = 500;
export function parseRunDate(value: string): Date {
  return new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : value + "Z");
}
const CHILD_LIMIT = 500;
export function numberMap(raw: unknown): Record<string, number> {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) as Record<string, number>;
  } catch { return {}; }
}
function nonnegative(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw); return Number.isFinite(n) && n >= 0 ? n : null;
}
export async function load(env: SourceEnv, start: Date, end: Date, fetcher: typeof fetch = fetch) {
  // No private messages or user identifiers are requested from LangSmith.
  const endpoint = new URL(env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com');
  if (endpoint.protocol !== 'https:' || !['api.smith.langchain.com', 'eu.api.smith.langchain.com', 'aws.api.smith.langchain.com'].includes(endpoint.hostname)) throw new Error('Unsupported LangSmith endpoint');
  const headers = new Headers({ 'x-api-key': env.LANGSMITH_API_KEY!, 'Content-Type': 'application/json' });
  if (env.LANGSMITH_WORKSPACE_ID) headers.set('X-Tenant-ID', env.LANGSMITH_WORKSPACE_ID);
  const integration = JSON.stringify([endpoint.origin, env.LANGSMITH_PROJECT, env.LANGSMITH_WORKSPACE_ID]);
  const interval = +end - +start > 7 * 86400000 ? 3500 : 1100;
  let requestCount = 0;
  async function query(path: string, body?: Raw): Promise<any> {
    if (++requestCount > 20) throw new Error('Upstream request budget exceeded');
    if (path === '/runs/query') await scheduleQuery(integration, interval);
    let response: Response;
    try {
      response = await fetcher(`${endpoint.origin}${path}`, { method: body ? 'POST' : 'GET', headers,
        redirect: 'manual', signal: AbortSignal.timeout(60000), ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (error) {
      const reason = (error as Error).message.replaceAll(env.LANGSMITH_API_KEY!, '[redacted]').replace(/https?:\/\/\S+/g, '[url]').slice(0, 180);
      throw new SourceError((error as Error).name === 'TimeoutError' ? 'timeout' : 'network', path.split('?')[0], undefined, reason);
    }
    if (!response.ok) throw new SourceError('upstream_http', path.split('?')[0], response.status, undefined,
      response.status === 429 ? Math.max(1, Math.min(600, Number(response.headers.get('Retry-After')) || 60)) : undefined);
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('Upstream response exceeds free-tier budget');
    return JSON.parse(text);
  }
  const project = await query(`/sessions?limit=1&include_stats=false&name=${encodeURIComponent(env.LANGSMITH_PROJECT || 'astro-ai-api')}`);
  if (!Array.isArray(project) || !project[0]?.id) throw new Error('LangSmith project not found');
  const base = { session: [project[0].id], start_time: start.toISOString(), end_time: end.toISOString(), limit: 100 };
  const roots: Raw[] = [];
  const seen = new Set<string>();
  let rootCursor: string | undefined;
  let truncated = false;
  for (let page = 0; page < ROOT_LIMIT / 100; page++) {
    const raw = await query('/runs/query', { ...base, is_root: true,
      filter: `and(eq(name, "astro_chat"), lt(start_time, "${end.toISOString()}"))`,
      select: ['id', 'trace_id', 'start_time', 'end_time', 'error', 'total_cost', 'extra'],
      ...(rootCursor ? { cursor: rootCursor } : {}) });
    if (!Array.isArray(raw.runs)) throw new Error('Invalid runs response');
    for (const run of raw.runs) {
      if (!run.start_time || seen.has(run.id)) continue;
      const started = +parseRunDate(run.start_time);
      if (roots.length < ROOT_LIMIT && started >= +start && started < +end) { roots.push(run); seen.add(run.id); }
    }
    const next = raw.cursors?.next;
    if (!next || !raw.runs.length) break;
    if (next === rootCursor || page === ROOT_LIMIT / 100 - 1) { truncated = true; break; }
    rootCursor = next;
  }
  const feedback = new Map<string, number>();
  let feedbackPartial = false;
  let rateLimited = false;
  let retryAfter: number | undefined;
  if (roots.length) {
    for (let offset = 0; offset < roots.length; offset += 100) {
      const params = new URLSearchParams({ key: 'resolved', limit: '100', offset: '0' });
      for (const r of roots.slice(offset, offset + 100)) params.append('run', r.id);
      let items;
      try { items = await query(`/feedback?${params}`); }
      catch (error) {
        if (!(error instanceof SourceError) || error.status !== 429) throw error;
        feedbackPartial = true; rateLimited = true; retryAfter = error.retryAfter; break;
      }
      if (!Array.isArray(items)) throw new Error('Invalid feedback response');
      for (const item of items) if (item.run_id && item.score !== null && item.score !== undefined && Number.isFinite(Number(item.score))) feedback.set(item.run_id, Number(Number(item.score) >= .5));
      if (items.length >= 100) feedbackPartial = true;
    }
  }
  const metadata = new Map<string, Raw>(roots.map(r => [r.id, r.extra?.metadata ?? {}]));
  const names = new Set(roots.flatMap(r => Object.keys(numberMap(metadata.get(r.id)?.agent_latencies_ms))));
  const traceIds = new Set(roots.map(r => String(r.trace_id || r.id)));
  const children: Raw[] = [];
  let childPartial = rateLimited && traceIds.size > 0 && names.size > 0;
  if (traceIds.size && names.size && !rateLimited) {
    let cursor: string | undefined;
    for (let page = 0; page < CHILD_LIMIT / 100; page++) {
      let data;
      try { data = await query('/runs/query', { ...base, is_root: false, run_type: 'chain',
        trace_filter: 'eq(name, "astro_chat")', filter: `in(trace_id, ${JSON.stringify([...traceIds])})`,
        select: ['id', 'trace_id', 'parent_run_id', 'name', 'run_type', 'total_cost', 'error'], ...(cursor ? { cursor } : {}) }); }
      catch (error) {
        if (!(error instanceof SourceError) || error.status !== 429) throw error;
        childPartial = true; rateLimited = true; retryAfter = error.retryAfter; break;
      }
      if (!Array.isArray(data.runs)) throw new Error('Invalid child runs response');
      children.push(...data.runs.filter((c: Raw) => traceIds.has(c.trace_id)));
      cursor = data.cursors?.next;
      if (!cursor || !data.runs.length) break;
      if (page === CHILD_LIMIT / 100 - 1) childPartial = true;
    }
  }
  const childrenById = new Map(children.map(c => [c.id, c]));
  const costs = new Map<string, Record<string, number>>(), errors = new Map<string, Record<string, number>>();
  for (const child of childrenById.values()) {
    if (!names.has(child.name)) continue;
    let ancestorId = child.parent_run_id, nested = false;
    const visited = new Set<string>();
    while (ancestorId && childrenById.has(ancestorId)) {
      if (visited.has(ancestorId)) { nested = true; break; } visited.add(ancestorId);
      const ancestor = childrenById.get(ancestorId)!;
      if (ancestor.name === child.name) { nested = true; break; } ancestorId = ancestor.parent_run_id;
    }
    if (nested) continue;
    const cost = nonnegative(child.total_cost), trace = child.trace_id;
    if (cost !== null) { const map = costs.get(trace) ?? Object.create(null); map[child.name] = (map[child.name] ?? 0) + cost; costs.set(trace, map); }
    if (child.error) { const map = errors.get(trace) ?? Object.create(null); map[child.name] = (map[child.name] ?? 0) + 1; errors.set(trace, map); }
  }
  const runs: ObservedRun[] = roots.map(r => {
    const m = metadata.get(r.id)!, trace = r.trace_id || r.id;
    const latency = nonnegative(m.total_response_ms) ?? (r.end_time && Number.isFinite(+parseRunDate(r.end_time)) ? Math.max(0, +parseRunDate(r.end_time) - +parseRunDate(r.start_time)) : null);
    return { run_id: r.id, started_at: parseRunDate(r.start_time).toISOString(), latency_ms: latency, cost_usd: nonnegative(r.total_cost) ?? nonnegative(m.observed_cost_usd),
      error: Boolean(r.error || m.error_type), resolved: feedback.get(r.id) ?? null,
      agent_latencies_ms: numberMap(m.agent_latencies_ms), agent_transitions_ms: numberMap(m.agent_transitions_ms),
      agent_costs_usd: costs.get(trace) ?? {}, agent_errors: errors.get(trace) ?? {}, error_stage: m.error_stage ? String(m.error_stage) : null };
  });
  return { runs, truncated, childPartial, feedbackPartial, rateLimited, retryAfter };
}
