export type Point = { date: string; executions: number; errors: number; error_rate: number | null; cost_usd: number | null; average_latency_ms: number | null }
export type Agent = { name: string; calls: number; average_latency_ms: number | null; total_latency_ms: number; attributed_errors: number | null; cost_usd: number | null }
export type Transition = { name: string; count: number; average_latency_ms: number | null }
export type Projection = { weekly_users: number; requests_per_user_week: number; projected_requests: number; projected_cost_usd: number | null; projected_resolutions: number | null }
export type Roi = { estimated: boolean; minutes_saved_per_resolution: number; hourly_cost_usd: number; other_operational_cost_usd: number; benefit_usd: number | null; total_cost_usd: number | null; net_benefit_usd: number | null; roi_percent: number | null }
export type Dashboard = {
  period: { start: string; end: string }; generated_at: string; data_status: 'empty' | 'partial' | 'complete'; warnings: string[];
  runs_examined: number; users_analyzed: number | null; executions: number; successes: number; errors: number;
  success_rate: number | null; error_rate: number | null; average_latency_ms: number | null;
  p50_latency_ms: number | null; p95_latency_ms: number | null; p99_latency_ms: number | null;
  min_latency_ms: number | null; max_latency_ms: number | null;
  cost_coverage: number | null; total_cost_usd: number | null; average_cost_usd: number | null;
  resolution_evaluated_count: number; resolved_count: number; resolution_coverage: number | null;
  resolution_rate: number | null; cost_per_resolution_usd: number | null;
  agents: Agent[]; transitions: Transition[]; daily: Point[]; projections: Projection[]; roi: Roi;
}
