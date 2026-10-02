export interface ObservedRun {
  run_id: string; started_at: string; latency_ms: number | null; cost_usd: number | null;
  error: boolean; resolved: number | null; agent_latencies_ms: Record<string, number>;
  agent_transitions_ms: Record<string, number>; agent_costs_usd: Record<string, number>;
  agent_errors: Record<string, number>; error_stage: string | null;
}
export interface Options {
  start: Date; end: Date; timezone: string; truncated: boolean;
  requests_per_user_week: number; minutes_saved_per_resolution: number;
  hourly_cost_usd: number; other_operational_cost_usd: number;
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) => values.length ? sum(values) / values.length : null;
export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * fraction, lower = Math.floor(position);
  return ordered[lower] + (ordered[Math.min(lower + 1, ordered.length - 1)] - ordered[lower]) * (position - lower);
}
export function dateFormatter(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
}
export function localDate(date: Date, formatter: Intl.DateTimeFormat): string {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function aggregate(runs: ObservedRun[], options: Options, now = new Date()) {
  const { start, end, truncated, requests_per_user_week, minutes_saved_per_resolution,
    hourly_cost_usd, other_operational_cost_usd } = options;
  const count = runs.length, errors = runs.filter(r => r.error).length;
  const latencies = runs.flatMap(r => r.latency_ms === null ? [] : [r.latency_ms]);
  const costs = runs.flatMap(r => r.cost_usd === null ? [] : [r.cost_usd]);
  const evaluated = runs.filter(r => r.resolved !== null);
  const resolved = evaluated.filter(r => r.resolved === 1).length;
  const total_cost = costs.length ? sum(costs) : null;
  const average_cost = mean(costs), resolution_rate = evaluated.length ? resolved / evaluated.length : null;
  const warnings: string[] = [];
  if (truncated) warnings.push('O período excedeu o limite de traces consultados; os indicadores representam apenas a amostra exibida.');
  if (count && costs.length < count) {
    warnings.push(costs.length
      ? `Há traces sem custo informado pelo LangSmith; os valores de custo são parciais e usam ${costs.length} de ${count} traces (${(costs.length / count * 100).toFixed(1)}% de cobertura).`
      : 'Nenhum trace do período possui custo informado pelo LangSmith.');
  }
  if (count && evaluated.length < count) warnings.push('Nem todos os traces possuem feedback resolved; a taxa de resolução usa somente os avaliados.');
  if (count && !latencies.length) warnings.push('Nenhum trace do período contém duração completa.');
  if (count) warnings.push('O Astro não registra identificador de usuário no trace; usuários únicos não são mensuráveis neste painel.');
  if (count && !runs.some(r => Object.keys(r.agent_costs_usd).length)) warnings.push('Os runs filhos não possuem custos que possam ser atribuídos aos agentes neste período.');
  if (count && !runs.some(r => Object.keys(r.agent_latencies_ms).length)) warnings.push('Duração por agente não está disponível nos traces deste período.');
  const values = new Map<string, { calls: number; total: number; errors: number; cost: number; has_cost: boolean }>();
  const transitions = new Map<string, { count: number; total: number }>();
  const agent = (name: string) => {
    if (!values.has(name)) values.set(name, { calls: 0, total: 0, errors: 0, cost: 0, has_cost: false });
    return values.get(name)!;
  };
  for (const run of runs) {
    for (const [name, duration] of Object.entries(run.agent_latencies_ms)) { const a = agent(name); a.calls++; a.total += duration; }
    for (const [name, cost] of Object.entries(run.agent_costs_usd)) { const a = agent(name); a.cost += cost; a.has_cost = true; }
    for (const [name, count] of Object.entries(run.agent_errors)) agent(name).errors += count;
    if (!Object.keys(run.agent_errors).length && run.error_stage && run.error_stage in run.agent_latencies_ms) agent(run.error_stage).errors++;
    for (const [name, duration] of Object.entries(run.agent_transitions_ms)) {
      const t = transitions.get(name) ?? { count: 0, total: 0 }; t.count++; t.total += duration; transitions.set(name, t);
    }
  }
  const attributed = runs.some(r => Object.keys(r.agent_costs_usd).length || Object.keys(r.agent_errors).length);
  const agents = [...values].sort((a, b) => b[1].total - a[1].total).map(([name, a]) => ({
    name, calls: a.calls, average_latency_ms: a.calls ? a.total / a.calls : null,
    total_latency_ms: a.total, attributed_errors: attributed ? a.errors : null, cost_usd: a.has_cost ? a.cost : null,
  }));
  const formatter = dateFormatter(options.timezone);
  const days = new Map<string, ObservedRun[]>();
  for (const run of runs) { const day = localDate(new Date(run.started_at), formatter); const group = days.get(day) ?? []; group.push(run); days.set(day, group); }
  const daily = [];
  const first = localDate(start, formatter), last = localDate(new Date(end.getTime() - 1), formatter);
  for (let day = first; day <= last; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
    const group = days.get(day) ?? [], day_errors = group.filter(r => r.error).length;
    const day_costs = group.flatMap(r => r.cost_usd === null ? [] : [r.cost_usd]);
    daily.push({ date: day, executions: group.length, errors: day_errors, error_rate: group.length ? day_errors / group.length : null,
      cost_usd: day_costs.length ? sum(day_costs) : null,
      average_latency_ms: mean(group.flatMap(r => r.latency_ms === null ? [] : [r.latency_ms])) });
  }
  const benefit = evaluated.length ? resolved * minutes_saved_per_resolution / 60 * hourly_cost_usd : null;
  const roi_total_cost = total_cost === null ? null : total_cost + other_operational_cost_usd;
  const net = benefit === null || roi_total_cost === null ? null : benefit - roi_total_cost;
  return {
    period: { start: start.toISOString(), end: end.toISOString() }, generated_at: now.toISOString(),
    data_status: !count ? 'empty' : warnings.length || truncated ? 'partial' : 'complete', warnings,
    runs_examined: count, users_analyzed: null, executions: count, successes: count - errors, errors,
    success_rate: count ? (count - errors) / count : null, error_rate: count ? errors / count : null,
    average_latency_ms: mean(latencies), p50_latency_ms: percentile(latencies, .5),
    p95_latency_ms: percentile(latencies, .95), p99_latency_ms: percentile(latencies, .99),
    min_latency_ms: latencies.length ? Math.min(...latencies) : null, max_latency_ms: latencies.length ? Math.max(...latencies) : null,
    cost_coverage: count ? costs.length / count : null, total_cost_usd: total_cost, average_cost_usd: average_cost,
    resolution_evaluated_count: evaluated.length, resolved_count: resolved,
    resolution_coverage: count ? evaluated.length / count : null, resolution_rate,
    cost_per_resolution_usd: total_cost !== null && resolved ? total_cost / resolved : null,
    agents, transitions: [...transitions].sort((a, b) => b[1].total - a[1].total).map(([name, t]) => ({ name, count: t.count, average_latency_ms: t.total / t.count })),
    daily, projections: [100, 1000].map(weekly_users => ({ weekly_users, requests_per_user_week,
      projected_requests: weekly_users * requests_per_user_week,
      projected_cost_usd: average_cost === null ? null : weekly_users * requests_per_user_week * average_cost,
      projected_resolutions: resolution_rate === null ? null : weekly_users * requests_per_user_week * resolution_rate })),
    roi: { estimated: true, minutes_saved_per_resolution, hourly_cost_usd, other_operational_cost_usd,
      benefit_usd: benefit, total_cost_usd: roi_total_cost, net_benefit_usd: net,
      roi_percent: net !== null && roi_total_cost !== null && roi_total_cost > 0 ? net / roi_total_cost * 100 : null },
  };
}
