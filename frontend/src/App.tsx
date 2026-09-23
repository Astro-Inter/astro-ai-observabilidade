import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dashboard, Point } from './types'
import astroLogo from './assets/astro-imagotipo.svg'
import dashboardIcon from './assets/icons/dashboard.svg?raw'
import costIcon from './assets/icons/cost.svg?raw'
import performanceIcon from './assets/icons/performance.svg?raw'
import reliabilityIcon from './assets/icons/reliability.svg?raw'
import roiIcon from './assets/icons/roi.svg?raw'
import refreshIcon from './assets/icons/refresh.svg?raw'
import infoIcon from './assets/icons/info.svg?raw'
import calendarIcon from './assets/icons/calendar.svg?raw'
import percentageIcon from './assets/icons/percentage.svg?raw'
import LoadingPlanet from './components/LoadingPlanet'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')
type PeriodChoice = 'today' | '24h' | '7d' | '30d' | 'custom'
type Section = 'overview' | 'costs' | 'latency' | 'reliability' | 'roi'

const money = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value)
const number = (value: number | null | undefined, digits = 0) => value == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value)
const percent = (value: number | null | undefined) => value == null ? '—' : `${number(value * 100, 1)}%`
const ms = (value: number | null | undefined) => value == null ? '—' : value >= 1000 ? `${number(value / 1000, 2)} s` : `${number(value, 0)} ms`
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
const periods: { value: PeriodChoice; label: string }[] = [
  { value: 'today', label: 'Hoje' }, { value: '24h', label: '24 horas' },
  { value: '7d', label: '7 dias' }, { value: '30d', label: '30 dias' },
  { value: 'custom', label: 'Personalizado' },
]
const sections: { value: Section; label: string; icon: string }[] = [
  { value: 'overview', label: 'Visão geral', icon: dashboardIcon },
  { value: 'costs', label: 'Custos', icon: costIcon },
  { value: 'latency', label: 'Desempenho', icon: performanceIcon },
  { value: 'reliability', label: 'Confiabilidade', icon: reliabilityIcon },
  { value: 'roi', label: 'ROI estimado', icon: roiIcon },
]

function Icon({ src, className = '' }: { src: string; className?: string }) {
  return <span className={`ui-icon ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: src }} />
}

function Card({ label, value, foot, tone = 'default' }: { label: string; value: string; foot?: string; tone?: 'default' | 'purple' | 'mint' | 'rose' }) {
  return <div className={`metric-card metric-card--${tone}`}><span className="metric-label">{label}</span><strong>{value}</strong>{foot && <span className="metric-foot">{foot}</span>}</div>
}

type DailyMetric = 'executions' | 'cost_usd' | 'average_latency_ms' | 'error_rate'

function DailyChart({ points, metric, color, explanation }: { points: Point[]; metric: DailyMetric; color: string; explanation: string }) {
  const values = points.map(point => metric === 'executions' ? point.executions : point[metric])
  const available = values.filter((value): value is number => value != null)
  if (!available.length) return <div className="chart-empty">Ainda não há dados suficientes para este gráfico.</div>

  const observedMax = Math.max(...available)
  const scaleMax = metric === 'error_rate' ? 1 : Math.max(observedMax, .001)
  const format = (value: number | null) => {
    if (value == null) return '—'
    if (metric === 'cost_usd') return money(value)
    if (metric === 'average_latency_ms') return ms(value)
    if (metric === 'error_rate') return percent(value)
    return number(value)
  }
  const detail = (point: Point, value: number | null) => {
    if (value == null) return 'Sem medição'
    if (metric === 'error_rate') return `${number(point.errors)} de ${number(point.executions)} com erro`
    if (metric === 'executions') return `${number(point.errors)} com erro`
    return `${number(point.executions)} execuções`
  }

  return <div className="daily-chart">
    <div className="daily-chart-meta"><span><i style={{ background: color }} />{explanation}</span><b>Maior valor: {format(observedMax)}</b></div>
    <div className="daily-chart-scroll">
      <div className="daily-chart-grid" style={{ minWidth: `${Math.max(620, points.length * 82)}px` }}>
        <div className="daily-scale" aria-hidden="true"><span>{format(scaleMax)}</span><span>{format(scaleMax / 2)}</span><span>{format(0)}</span></div>
        <div className="daily-columns" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(64px, 1fr))` }}>
          {points.map((point, index) => {
            const value = values[index]
            const height = value == null ? 0 : Math.max(value > 0 ? 4 : 2, (value / scaleMax) * 100)
            const description = `${dateLabel(point.date)}: ${format(value)}. ${detail(point, value)}.`
            return <div className={`daily-column${value == null ? ' daily-column--empty' : ''}`} key={point.date} title={description} aria-label={description}>
              <strong>{format(value)}</strong>
              <div className="daily-bar-slot"><div className="daily-bar" style={{ height: `${height}%`, background: color }} /></div>
              <span>{dateLabel(point.date)}</span>
              <small>{detail(point, value)}</small>
            </div>
          })}
        </div>
      </div>
    </div>
  </div>
}

function Bars({ items, unit }: { items: { name: string; value: number | null }[]; unit: 'latency' | 'count' }) {
  const available = items.filter(item => item.value != null)
  if (!available.length) return <div className="chart-empty">Nenhuma etapa medida neste período.</div>
  const max = Math.max(...available.map(item => item.value as number), .001)
  return <div className="bars">{available.slice(0, 8).map(item => <div className="bar-row" key={item.name}>
    <span title={item.name}>{item.name}</span><div className="bar-track"><div style={{ width: `${Math.max(2, ((item.value as number) / max) * 100)}%` }} /></div>
    <b>{unit === 'latency' ? ms(item.value) : number(item.value)}</b>
  </div>)}</div>
}

function Title({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) {
  return <div className="section-title"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{note && <p>{note}</p>}</div>
}

function App() {
  const [period, setPeriod] = useState<PeriodChoice>('7d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [requests, setRequests] = useState(5)
  const [minutes, setMinutes] = useState(9.5)
  const [hourly, setHourly] = useState(6)
  const [otherCost, setOtherCost] = useState(0)
  const [draftMinutes, setDraftMinutes] = useState('9.5')
  const [draftHourly, setDraftHourly] = useState('6')
  const [draftOtherCost, setDraftOtherCost] = useState('0')
  const [section, setSection] = useState<Section>('overview')
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const partialCost = data?.cost_coverage != null && data.cost_coverage < 1
  const costFoot = data?.total_cost_usd == null
    ? 'Nenhum custo informado no período'
    : partialCost
      ? `Parcial · cobertura de ${percent(data.cost_coverage)}`
      : 'Total reportado pelo LangSmith'
  const roiMultiple = data?.roi.benefit_usd != null && data.roi.total_cost_usd != null && data.roi.total_cost_usd > 0
    ? data.roi.benefit_usd / data.roi.total_cost_usd
    : null
  const roiLabel = data?.roi.roi_percent == null
    ? '—'
    : data.roi.roi_percent >= 10_000
      ? `${number(data.roi.roi_percent / 1000, 1)} mil%`
      : `${number(data.roi.roi_percent, 1)}%`
  const draftSimulation = [Number(draftMinutes), Number(draftHourly), Number(draftOtherCost)]
  const simulationValid = [draftMinutes, draftHourly, draftOtherCost].every(value => value.trim() !== '') && draftSimulation.every(value => Number.isFinite(value) && value >= 0)
  const simulationDirty = simulationValid && (draftSimulation[0] !== minutes || draftSimulation[1] !== hourly || draftSimulation[2] !== otherCost)

  const query = useMemo(() => {
    const params = new URLSearchParams({ period, requests_per_user_week: String(requests), minutes_saved_per_resolution: String(minutes), hourly_cost_usd: String(hourly), other_operational_cost_usd: String(otherCost) })
    if (period === 'custom' && customStart && customEnd) { params.set('start', new Date(customStart).toISOString()); params.set('end', new Date(customEnd).toISOString()) }
    return params.toString()
  }, [period, customStart, customEnd, requests, minutes, hourly, otherCost])

  const load = useCallback(async (signal: AbortSignal) => {
    if (period === 'custom' && (!customStart || !customEnd)) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const response = await fetch(`${API_BASE}/api/observability/dashboard?${query}`, { signal })
      if (!response.ok) {
        if (response.status === 503) throw new Error('A API ainda não tem todas as variáveis necessárias configuradas.')
        throw new Error(response.status === 502 ? 'A consulta ao LangSmith falhou. Tente atualizar em instantes.' : `Não foi possível carregar os dados (${response.status}).`)
      }
      setData(await response.json() as Dashboard)
    } catch (cause) {
      if (!signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : 'Falha inesperada ao carregar o painel.') }
    } finally { if (!signal.aborted) setLoading(false) }
  }, [period, customStart, customEnd, query])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, revision])

  useEffect(() => {
    if (!detailsOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDetailsOpen(false) }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [detailsOpen])

  return <div className="shell" aria-busy={loading}>
    {loading && <div className="api-loading-overlay"><div className="api-loading-surface"><LoadingPlanet label={data ? 'Atualizando dados' : 'Carregando indicadores'} /></div></div>}
    {detailsOpen && data && <div className="details-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetailsOpen(false) }}>
      <aside className="details-drawer" role="dialog" aria-modal="true" aria-labelledby="details-title">
        <header className="details-header"><div><span className="eyebrow">CONTEXTO DO PAINEL</span><h2 id="details-title">Detalhes da observabilidade</h2></div><button type="button" onClick={() => setDetailsOpen(false)}>Fechar</button></header>
        <div className="details-content">
          <section className="details-summary" aria-label="Resumo dos dados">
            <div><span>Status</span><b>{data.data_status === 'complete' ? 'Completo' : data.data_status === 'partial' ? 'Parcial' : 'Sem dados'}</b></div>
            <div><span>Período</span><b>{dateLabel(data.period.start)} — {dateLabel(data.period.end)}</b></div>
            <div><span>Execuções</span><b>{number(data.executions)}</b></div>
            <div><span>Cobertura de custo</span><b>{percent(data.cost_coverage)}</b></div>
          </section>

          <section className="details-section"><div className="details-section-title"><Icon src={infoIcon} /><div><span>QUALIDADE DOS DADOS</span><h3>{data.warnings.length} nota{data.warnings.length === 1 ? '' : 's'} no período</h3></div></div>{data.warnings.length ? <ul className="details-notes">{data.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : <p className="details-empty">Nenhuma limitação adicional identificada neste período.</p>}</section>

          <section className="details-section"><div className="details-section-title"><Icon src={dashboardIcon} /><div><span>ESCOPO</span><h3>O que este painel considera</h3></div></div><dl className="details-list"><div><dt>Execuções</dt><dd>Traces raiz <code>astro_chat</code> observados no período.</dd></div><div><dt>Resolução</dt><dd>Feedback <code>resolved</code> existente no LangSmith.</dd></div><div><dt>Custos</dt><dd>Valores informados nos traces e nos runs filhos dos agentes.</dd></div><div><dt>Privacidade</dt><dd>Prompts, mensagens e identificadores pessoais não são enviados ao frontend.</dd></div></dl></section>

          <section className="details-section"><div className="details-section-title"><Icon src={reliabilityIcon} /><div><span>INTERPRETAÇÃO</span><h3>Leituras importantes</h3></div></div><div className="details-readings"><p>Custos e latências são observados. Cenários futuros e ROI dependem das premissas ajustadas no painel.</p><p>O percentual de ROI fica elevado quando o benefício estimado é comparado com um custo observado muito pequeno. Use o benefício líquido em dinheiro como referência principal.</p><p>Valores parciais devem ser lidos junto das respectivas coberturas antes de tomar decisões.</p></div></section>
        </div>
      </aside>
    </div>}
    <aside className="sidebar"><div className="brand"><img className="brand-logo" src={astroLogo} alt="Astro" /></div>
      <div className="side-label">OBSERVABILIDADE</div><nav aria-label="Seções do painel">{sections.map(item => <button key={item.value} className={section === item.value ? 'active' : ''} onClick={() => setSection(item.value)}><Icon src={item.icon} className="nav-icon" />{item.label}</button>)}</nav>
      <div className="side-bottom"><p>Fonte: LangSmith</p></div>
    </aside>
    <main className="workspace"><header className="topbar"><div className="breadcrumb">Astro AI <span>/</span> Observabilidade <span>/</span> <b>{sections.find(item => item.value === section)?.label}</b></div><div className="top-actions"><button className="details-trigger" type="button" onClick={() => setDetailsOpen(true)} disabled={!data}><Icon src={infoIcon} /><span>Detalhes</span>{data && data.warnings.length > 0 && <b>{data.warnings.length}</b>}</button><button className="refresh" onClick={() => setRevision(value => value + 1)} disabled={loading}><Icon src={refreshIcon} className="refresh-icon" /><span>Atualizar</span></button></div></header>
      <div className="content"><div className="page-heading"><div><span className="eyebrow">INTELIGÊNCIA OPERACIONAL / ASTRO</span><h1>{section === 'overview' ? 'Observabilidade da IA' : sections.find(item => item.value === section)?.label}</h1><p>Do primeiro agente à resposta final: os sinais que mostram como o Astro está operando.</p></div><div className="period-wrap"><label htmlFor="period">Período analisado</label><span className="period-select"><Icon src={calendarIcon} /><select id="period" value={period} onChange={event => setPeriod(event.target.value as PeriodChoice)}>{periods.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></span></div></div>
      {period === 'custom' && <div className="custom-range"><label>Início<input type="datetime-local" value={customStart} onChange={event => setCustomStart(event.target.value)} /></label><label>Fim<input type="datetime-local" value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></label><span>Máximo: 90 dias</span></div>}
      {error && <div className="state-box state-box--error"><span className="state-icon">!</span><h2>Os indicadores não carregaram</h2><p>{error}</p><button onClick={() => setRevision(value => value + 1)}>Tentar novamente</button></div>}
      {!error && !loading && !data && period === 'custom' && <div className="state-box"><h2>Defina o intervalo</h2><p>Escolha início e fim para consultar as métricas.</p></div>}
      {data && !error && <>
        <div className="report-strip"><div><span className="strip-pulse" /> {data.data_status === 'empty' ? 'Sem execuções no período' : data.data_status === 'partial' ? 'Dados parciais' : 'Dados observados'} <span className="strip-divider">·</span> Atualizado em {new Date(data.generated_at).toLocaleString('pt-BR')}</div><span>{dateLabel(data.period.start)} — {dateLabel(data.period.end)}</span></div>
        {data.data_status === 'empty' ? <div className="state-box"><span className="state-icon">◇</span><h2>Nenhum trace encontrado</h2><p>Experimente ampliar o período ou confira se o projeto LangSmith configurado é o mesmo utilizado pelo Astro.</p></div> : <>
          {section === 'overview' && <>
            <div className="hero-grid"><div className="hero-card"><div className="hero-top"><span>OPERAÇÃO NO PERÍODO</span><span className="hero-star">✦</span></div><div className="hero-number">{number(data.executions)}</div><h2>execuções analisadas</h2><p>{number(data.successes)} concluídas sem erro · {number(data.errors)} com erro</p></div><div className="hero-side"><Card label="Custo observado" value={money(data.total_cost_usd)} foot={costFoot} tone="purple" /><Card label="Tempo médio de resposta" value={ms(data.average_latency_ms)} foot={`P95 em ${ms(data.p95_latency_ms)}`} /><Card label="Taxa de erro" value={percent(data.error_rate)} foot={`${number(data.errors)} de ${number(data.executions)} execuções`} tone="mint" /><Card label="Resoluções avaliadas" value={number(data.resolved_count)} foot={`Cobertura: ${percent(data.resolution_coverage)}`} /></div></div>
            <div className="section-grid"><section className="panel wide"><div className="panel-heading"><div><span className="eyebrow">VOLUME</span><h3>Execuções por dia</h3></div><span className="panel-note">Cada coluna representa um dia</span></div><DailyChart points={data.daily} metric="executions" color="#8f00c4" explanation="Quantidade de execuções analisadas em cada dia" /></section><section className="panel compact"><div className="panel-heading"><div><span className="eyebrow">SAÚDE</span><h3>Em um olhar</h3></div></div><div className="health-list"><div><span>Taxa de sucesso</span><b>{percent(data.success_rate)}</b></div><div><span>Latência P50</span><b>{ms(data.p50_latency_ms)}</b></div><div><span>Latência P95</span><b>{ms(data.p95_latency_ms)}</b></div><div><span>Custo por resolução</span><b>{money(data.cost_per_resolution_usd)}</b></div><div><span>ROI <em>estimado</em></span><b>{data.roi.roi_percent == null ? '—' : `${number(data.roi.roi_percent, 1)}%`}</b></div></div></section></div>
          </>}
          {section === 'costs' && <>
            <Title eyebrow="FINANÇAS / OBSERVADO E PROJETADO" title="O custo da operação, sem misturar previsão com fato." note="Os valores observados vêm dos traces raiz; as projeções partem do custo médio real por interação." />
            <div className="metric-grid"><Card label="Custo total observado" value={money(data.total_cost_usd)} foot={costFoot} tone="purple" /><Card label="Por interação" value={money(data.average_cost_usd)} foot={partialCost ? 'Média dos traces com custo' : undefined} /><Card label="Por resolução" value={money(data.cost_per_resolution_usd)} foot={partialCost ? 'Usa o custo parcial disponível' : undefined} /><Card label="Cobertura de custo" value={percent(data.cost_coverage)} foot="Traces com custo informado" /></div>
            <div className="section-grid"><section className="panel wide"><div className="panel-heading"><div><span className="eyebrow">HISTÓRICO</span><h3>Custo informado por dia</h3></div><span className="panel-note">Soma diária em USD</span></div><DailyChart points={data.daily} metric="cost_usd" color="#8f00c4" explanation="Soma dos custos que o LangSmith informou em cada dia" /></section><section className="panel compact"><div className="panel-heading"><div><span className="eyebrow">SIMULADOR</span><h3>Escala semanal</h3></div></div><label className="input-label">Interações por usuário / semana<input type="number" min="1" max="1000" value={requests} onChange={event => setRequests(Math.max(1, Number(event.target.value) || 1))} /></label><div className="scenario-stack">{data.projections.map(item => <div className="scenario" key={item.weekly_users}><span>{number(item.weekly_users)} usuários</span><strong>{money(item.projected_cost_usd)}</strong><small>{number(item.projected_requests)} interações previstas</small></div>)}</div></section></div>
            <p className="context-note">O custo por agente usa os runs filhos externos de cada etapa. Custos ausentes continuam fora da soma parcial.</p>
          </>}
          {section === 'latency' && <>
            <Title eyebrow="DESEMPENHO / FLUXO MULTIAGENTE" title="Onde o tempo da resposta acontece." note="Duração total e contribuição das etapas medidas pelo Astro, incluindo transições registradas." />
            <div className="metric-grid"><Card label="Média total" value={ms(data.average_latency_ms)} tone="purple" /><Card label="Mediana · P50" value={ms(data.p50_latency_ms)} /><Card label="P95" value={ms(data.p95_latency_ms)} /><Card label="P99" value={ms(data.p99_latency_ms)} /></div>
            <div className="section-grid"><section className="panel wide"><div className="panel-heading"><div><span className="eyebrow">AGENTES</span><h3>Tempo médio por agente</h3></div><span className="panel-note">Média por trace em que aparece</span></div><Bars items={data.agents.map(item => ({ name: item.name, value: item.average_latency_ms }))} unit="latency" /></section><section className="panel compact"><div className="panel-heading"><div><span className="eyebrow">DISTRIBUIÇÃO</span><h3>Extremos observados</h3></div></div><div className="health-list"><div><span>Menor resposta</span><b>{ms(data.min_latency_ms)}</b></div><div><span>Maior resposta</span><b>{ms(data.max_latency_ms)}</b></div><div><span>P50</span><b>{ms(data.p50_latency_ms)}</b></div><div><span>P95</span><b>{ms(data.p95_latency_ms)}</b></div></div></section></div>
            <div className="section-grid"><section className="panel wide"><div className="panel-heading"><div><span className="eyebrow">TENDÊNCIA</span><h3>Tempo médio por dia</h3></div><span className="panel-note">Média das execuções do dia</span></div><DailyChart points={data.daily} metric="average_latency_ms" color="#1937b7" explanation="Tempo médio de resposta das execuções medidas em cada dia" /></section><section className="panel compact"><div className="panel-heading"><div><span className="eyebrow">ENTRE ETAPAS</span><h3>Transições medidas</h3></div></div>{data.transitions.length ? <div className="transition-list">{data.transitions.slice(0, 8).map(item => <div key={item.name}><span>{item.name.replace('->', ' → ')}</span><b>{ms(item.average_latency_ms)}</b></div>)}</div> : <div className="chart-empty">Nenhuma transição registrada.</div>}</section></div>
            <p className="context-note">A instrumentação atual agrega a duração de cada nome de transição por trace. Repetições da mesma transição dentro de um trace não são contadas separadamente.</p>
          </>}
          {section === 'reliability' && <>
            <Title eyebrow="SRE / CONFIABILIDADE" title="O que deu certo. E o que exige atenção." note="A taxa de erro usa apenas falhas sinalizadas no trace ou nos metadados de erro do Astro." />
            <div className="metric-grid"><Card label="Execuções" value={number(data.executions)} tone="purple" /><Card label="Sucesso" value={number(data.successes)} foot={percent(data.success_rate)} tone="mint" /><Card label="Erros" value={number(data.errors)} foot={percent(data.error_rate)} tone="rose" /><Card label="Taxa de resolução" value={percent(data.resolution_rate)} foot={`${number(data.resolution_evaluated_count)} traces avaliados`} /></div>
            <div className="section-grid"><section className="panel wide"><div className="panel-heading"><div><span className="eyebrow">TENDÊNCIA</span><h3>Execuções com erro por dia</h3></div><span className="panel-note">Erros ÷ execuções do dia</span></div><DailyChart points={data.daily} metric="error_rate" color="#b92768" explanation="Percentual das execuções que terminaram com erro em cada dia" /></section><section className="panel compact"><div className="panel-heading"><div><span className="eyebrow">RESOLUÇÃO</span><h3>Feedback do Astro</h3></div></div><div className="resolution-figure"><strong>{percent(data.resolution_rate)}</strong><span>das execuções avaliadas foram resolvidas</span></div><div className="coverage-line"><span>Cobertura de feedback</span><b>{percent(data.resolution_coverage)}</b></div></section></div>
            <section className="panel"><div className="panel-heading"><div><span className="eyebrow">COMPARATIVO</span><h3>Agentes envolvidos</h3></div></div><div className="table-scroll"><table><thead><tr><th>Agente</th><th>Traces com agente</th><th>Latência média</th><th>Erros atribuídos</th><th>Custo atribuído</th></tr></thead><tbody>{data.agents.map(item => <tr key={item.name}><td><span className="agent-dot" />{item.name}</td><td>{number(item.calls)}</td><td>{ms(item.average_latency_ms)}</td><td>{item.attributed_errors == null ? '—' : number(item.attributed_errors)}</td><td>{money(item.cost_usd)}</td></tr>)}</tbody></table></div><p className="table-note">Erros e custos são atribuídos pelos runs filhos de cada agente. Custos ausentes no LangSmith continuam fora da soma e o total permanece identificado como parcial.</p></section>
          </>}
          {section === 'roi' && <>
            <Title eyebrow="IMPACTO / ESTIMATIVA" title="Qual pode ser o retorno operacional?" note="A simulação converte o tempo economizado em benefício financeiro e compara esse valor com o custo observado." />
            <div className="roi-layout">
              <section className="panel assumption-panel">
                <div className="panel-heading"><div><span className="eyebrow">PREMISSAS</span><h3>Ajuste a simulação</h3></div></div>
                <form className="assumption-form" onSubmit={event => { event.preventDefault(); if (!simulationValid) return; setMinutes(draftSimulation[0]); setHourly(draftSimulation[1]); setOtherCost(draftSimulation[2]) }}>
                  <label className="input-label"><span>Tempo economizado por resolução</span><span className="input-with-unit"><input type="number" min="0" max="1440" step="0.5" value={draftMinutes} onChange={event => setDraftMinutes(event.target.value)} /><span>min</span></span><small>Tempo que uma resolução positiva poupa da equipe.</small></label>
                  <label className="input-label"><span>Custo da hora de trabalho</span><span className="input-with-unit"><input type="number" min="0" step="0.5" value={draftHourly} onChange={event => setDraftHourly(event.target.value)} /><span>USD/h</span></span><small>Converte o tempo economizado em benefício estimado.</small></label>
                  <label className="input-label"><span>Outros custos operacionais</span><span className="input-with-unit"><input type="number" min="0" step="0.5" value={draftOtherCost} onChange={event => setDraftOtherCost(event.target.value)} /><span>USD</span></span><small>Inclua licenças, infraestrutura ou operação externa.</small></label>
                  <div className="assumption-base"><span>Base observada</span><strong>{number(data.resolved_count)} resoluções</strong><small>{number(data.resolution_evaluated_count)} execuções receberam feedback.</small></div>
                  <div className="simulation-action"><button type="submit" disabled={!simulationDirty || loading}><Icon src={roiIcon} /><span>{!simulationValid ? 'Verifique os campos' : simulationDirty ? 'Simular cenário' : 'Cenário aplicado'}</span></button><small>{simulationValid ? 'A API será consultada somente ao confirmar.' : 'Preencha todos os campos com valores válidos.'}</small></div>
                </form>
              </section>
              <section className="roi-result">
                <div className="roi-result-header"><div><span>IMPACTO NO PERÍODO</span><h3>Retorno operacional estimado</h3></div><em>Simulação</em></div>
                <div className="roi-primary"><span>Benefício líquido estimado</span><strong>{money(data.roi.net_benefit_usd)}</strong><p>Valor estimado após descontar o custo observado e os outros custos informados.</p></div>
                <div className="roi-stats">
                  <div><div className="roi-stat-label"><Icon src={percentageIcon} /><span>ROI indicativo</span></div><b title={data.roi.roi_percent == null ? undefined : `${number(data.roi.roi_percent, 1)}%`}>{roiLabel}</b><small>{roiMultiple == null ? 'Sem base suficiente' : `${number(roiMultiple, 1)}× o custo considerado`}</small></div>
                  <div><span>Cobertura de custo</span><b>{percent(data.cost_coverage)}</b><small>{partialCost ? 'Resultado ainda parcial' : 'Todos os traces têm custo'}</small></div>
                </div>
                <div className="roi-calculation" aria-label="Cálculo do benefício líquido">
                  <div><span>Benefício estimado</span><b>{money(data.roi.benefit_usd)}</b></div><i>−</i><div><span>Custo considerado</span><b>{money(data.roi.total_cost_usd)}</b></div><i>=</i><div><span>Benefício líquido</span><b>{money(data.roi.net_benefit_usd)}</b></div>
                </div>
                {partialCost && <div className="roi-warning"><b>Custo parcial</b><span>A cobertura é de {percent(data.cost_coverage)}. O ROI pode estar superestimado enquanto houver traces sem custo.</span></div>}
              </section>
            </div>
          </>}
        </>}
      </>}
      </div><footer className="main-footer"><span>ASTRO AI / OBSERVABILIDADE</span><span>Métricas técnicas observadas · estimativas explicitadas</span></footer>
    </main>
  </div>
}

export default App
