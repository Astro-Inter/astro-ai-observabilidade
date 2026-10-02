import { aggregate, dateFormatter, localDate, type Options } from './metrics.ts';
import { load, ROOT_LIMIT, SourceError, type SourceEnv } from './source.ts';
import { queueGrafanaLog, type GrafanaEnv } from './grafana-logs.ts';
export interface Env extends SourceEnv, GrafanaEnv { CORS_ALLOWED_ORIGINS?: string; CACHE_TTL_SECONDS?: string; ANALYSIS_TIMEZONE?: string }
const cache = new Map<string, { expires: number; body: string }>();
const sourceCache = new Map<string, { expires: number; data: Awaited<ReturnType<typeof load>> }>();
const inFlight = new Map<string, ReturnType<typeof load>>();
const cooldown = new Map<string, { until: number; error: SourceError }>();
async function cachedLoad(key: string, env: Env, options: Options, fetcher: typeof fetch, now: Date, ttl: number) {
  const cached = sourceCache.get(key);
  if (cached && cached.expires > +now) return cached.data;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const integration = JSON.stringify([env.LANGSMITH_PROJECT, env.LANGSMITH_WORKSPACE_ID, env.LANGSMITH_ENDPOINT]);
  const limited = cooldown.get(integration);
  if (limited && limited.until > +now) throw limited.error;
  const promise = load(env, options.start, options.end, fetcher);
  inFlight.set(key, promise);
  try {
    const data = await promise;
    if (sourceCache.size >= 16) sourceCache.clear();
    sourceCache.set(key, { expires: +now + ttl * 1000, data });
    return data;
  } catch (error) {
    if (error instanceof SourceError && error.status === 429) {
      if (cooldown.size >= 16) cooldown.clear();
      cooldown.set(integration, { until: Date.now() + (error.retryAfter ?? 60) * 1000, error });
    }
    throw error;
  } finally { inFlight.delete(key); }
}
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
function localMidnight(now: Date, timezone: string) {
  const day = localDate(now, dateFormatter(timezone));
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const target = Date.parse(`${day}T00:00:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(format.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    guess += target - local;
  }
  return new Date(guess);
}
export function parseOptions(url: URL, timezone: string, now: Date): Options {
  const q = url.searchParams, period = q.get('period') ?? '7d';
  if (!['today', '24h', '7d', '30d', 'custom'].includes(period)) throw new Error('Período inválido.');
  const end = period === 'custom' ? new Date(q.get('end') ?? '') : now;
  const start = period === 'custom' ? new Date(q.get('start') ?? '') : period === 'today'
    ? localMidnight(now, timezone) : new Date(+now - ({ '24h': 1, '7d': 7, '30d': 30 } as Record<string, number>)[period] * 86400000);
  if (period === 'custom' && ['start', 'end'].some(key => !/(Z|[+-]\d{2}:?\d{2})$/i.test(q.get(key) ?? ''))) throw new Error('Informe start e end com fuso horário para período personalizado.');
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || +start >= +end || +end > +now + 60000 || +end - +start > 90 * 86400000) throw new Error('O intervalo deve ser válido e ter no máximo 90 dias.');
  function numeric(name: string, fallback: number, min: number, max: number, exclusive = false) {
    const raw = q.get(name), n = raw === null ? fallback : raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(n) || (exclusive ? n <= min : n < min) || n > max) throw new Error(`Parâmetro inválido: ${name}.`);
    return n;
  }
  return { start, end, timezone, truncated: false,
    requests_per_user_week: numeric('requests_per_user_week', 5, 0, 1000, true),
    minutes_saved_per_resolution: numeric('minutes_saved_per_resolution', 9.5, 0, 1440),
    hourly_cost_usd: numeric('hourly_cost_usd', 6, 0, 10000),
    other_operational_cost_usd: numeric('other_operational_cost_usd', 0, 0, 10000000) };
}
export async function handle(request: Request, env: Env, fetcher: typeof fetch = fetch, now = new Date()) {
  const url = new URL(request.url), origin = request.headers.get('Origin');
  const origins = (env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim().replace(/\/$/, ''));
  const cors = origin && (origins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) ? origin : null;
  let response: Response;
  if (request.method === 'OPTIONS') {
    response = new Response(null, { status: cors && request.headers.get('Access-Control-Request-Method') === 'GET' ? 204 : 400 });
    response.headers.set('Access-Control-Allow-Methods', 'GET');
    response.headers.set('Access-Control-Allow-Headers', 'Accept, Accept-Language, Content-Language, Content-Type');
    response.headers.set('Access-Control-Max-Age', '600');
  } else if (!['GET', 'HEAD'].includes(request.method)) {
    response = json({ detail: 'Method Not Allowed' }, 405); response.headers.set('Allow', 'GET, HEAD');
  } else if (url.pathname === '/health') response = json({ status: 'ok' });
  else if (url.pathname !== '/api/observability/dashboard') response = json({ detail: 'Not Found' }, 404);
  else {
    let options: Options | undefined;
    try { options = parseOptions(url, env.ANALYSIS_TIMEZONE || 'America/Sao_Paulo', now); }
    catch (error) { response = json({ detail: (error as Error).message }, 422); }
    if (options) {
      if (!env.LANGSMITH_API_KEY) response = json({ detail: 'LANGSMITH_API_KEY não configurada no backend.' }, 503);
      else {
        // Per-isolate cache contains only aggregate results; never raw traces or credentials.
        const sourceKey = JSON.stringify([env.LANGSMITH_PROJECT, env.LANGSMITH_WORKSPACE_ID, env.LANGSMITH_ENDPOINT,
          options.start.toISOString().slice(0, 16), options.end.toISOString().slice(0, 16)]);
        const key = JSON.stringify([sourceKey, options.timezone,
          options.requests_per_user_week, options.minutes_saved_per_resolution, options.hourly_cost_usd, options.other_operational_cost_usd]);
        const cached = cache.get(key);
        if (cached && cached.expires > +now) response = new Response(cached.body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
        else try {
          const ttl = Math.max(30, Math.min(3600, Number(env.CACHE_TTL_SECONDS) || 300));
          const data = await cachedLoad(sourceKey, env, options, fetcher, now, ttl);
          const result = aggregate(data.runs, { ...options, truncated: data.truncated }, now);
          if (data.childPartial) result.warnings.push('O limite gratuito de runs filhos foi atingido; a atribuição por agente pode estar incompleta.');
          if (data.feedbackPartial) result.warnings.push('O limite gratuito de feedback foi atingido; a taxa de resolução usa a amostra consultada.');
          if (result.warnings.length) result.data_status = 'partial';
          const body = JSON.stringify(result);
          if (cache.size >= 100) cache.clear();
          cache.set(key, { body, expires: +now + ttl * 1000 });
          response = new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
        } catch (error) {
          console.error(JSON.stringify({ event: 'langsmith_query_failed', code: error instanceof SourceError ? error.code : 'invalid_response',
            stage: error instanceof SourceError ? error.stage : undefined, status: error instanceof SourceError ? error.status : undefined,
            reason: error instanceof SourceError ? error.reason : undefined }));
          if (error instanceof SourceError && error.status === 429) {
            response = json({ detail: 'O LangSmith atingiu seu limite temporário de consultas. Tente novamente em instantes.' }, 429);
            response.headers.set('Retry-After', String(error.retryAfter ?? 60));
          } else response = json({ detail: 'Não foi possível consultar o LangSmith agora.' }, 502);
        }
      }
    }
  }
  response!.headers.set('Vary', 'Origin');
  response!.headers.set('X-Astro-Trace-Limit', String(ROOT_LIMIT));
  if (cors) response!.headers.set('Access-Control-Allow-Origin', cors);
  if (request.method === 'HEAD') return new Response(null, { status: response!.status, headers: response!.headers });
  return response!;
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const started = Date.now();
    const response = await handle(request, env);
    queueGrafanaLog(ctx, env, "astro-ai-observabilidade", "http_request_finished",
      response.status >= 500 ? "ERROR" : "INFO", {
        method: request.method, route: new URL(request.url).pathname,
        status: response.status, duration_ms: Date.now() - started,
      });
    return response;
  },
};
