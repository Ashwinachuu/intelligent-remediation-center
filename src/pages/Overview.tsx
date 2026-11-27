import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, FilterX, Info } from 'lucide-react';
import { useStore } from '../app/store';
import { CATEGORIES, CATEGORY_LABEL } from '../domain/catalog';
import {
  categoryBreakdown, closedInRange, cohort, dailyResolvedByPath, defaultRange, durationByPath, fmtNum, fmtPct, funnel, guardrails, kpis, opportunities,
  previousPeriod, statusBreakdown, type Filters, type MetricKey,
} from '../domain/metrics';
import { addDaysKey, localDateKey } from '../domain/util';
import { PATH_LABEL } from '../components/ui';
import { Workspace } from '../components/Workspace';
import { BusinessImpact } from '../components/BusinessImpact';
import type { Path } from '../domain/types';

const PATH_COLOR: Record<Path, string> = { AUTO_POLICY: 'var(--series-1)', HUMAN_APPROVED: 'var(--series-2)', MANUAL: 'var(--series-3)' };
const PRESETS = [{ k: 'today', l: 'Today', d: 1 }, { k: '7', l: '7 days', d: 7 }, { k: '30', l: '30 days', d: 30 }, { k: '90', l: '90 days', d: 90 }];

function useFilters(now: number): [Filters, URLSearchParams, (k: Record<string, string | null>) => void] {
  const [p, setP] = useSearchParams();
  const preset = p.get('preset') ?? '30';
  const def = defaultRange(now, PRESETS.find((x) => x.k === preset)?.d ?? 30);
  const from = preset === 'custom' ? p.get('from') ?? def.from : def.from;
  const to = preset === 'custom' ? p.get('to') ?? def.to : def.to;
  const f: Filters = { from: from <= to ? from : to, to: from <= to ? to : from, source: (p.get('source') || undefined) as Filters['source'], category: (p.get('category') || undefined) as Filters['category'], group: (p.get('group') || undefined) as Filters['group'], path: (p.get('path') || undefined) as Filters['path'] };
  const set = (kv: Record<string, string | null>) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(kv)) { if (v) n.set(k, v); else n.delete(k); } setP(n, { replace: true }); };
  return [f, p, set];
}
function dimsQuery(f: Filters) {
  const q = new URLSearchParams();
  if (f.source) q.set('source', f.source); if (f.category) q.set('category', f.category); if (f.group) q.set('group', f.group); if (f.path) q.set('path', f.path);
  return q;
}
export function drillLink(f: Filters, metric: MetricKey | null, extra: Record<string, string> = {}, basis: 'created' | 'resolved' | 'closed' = 'created') {
  const q = dimsQuery(f);
  q.set('from', extra.from ?? f.from); q.set('to', extra.to ?? f.to); q.set('basis', basis);
  if (metric && metric !== 'all') q.set('metric', metric);
  for (const [k, v] of Object.entries(extra)) if (k !== 'from' && k !== 'to') q.set(k, v);
  return `/incidents?${q.toString()}`;
}

function Kpi({ label, value, sub, to, delta }: { label: string; value: string; sub?: string; to: string; delta?: string }) {
  return <Link className="kpi" to={to} aria-label={`${label}: ${value}. Open matching incidents`}><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="sub">{sub}</span>}{delta && <span className="sub">{delta}</span>}</Link>;
}
function BarList({ items, max, color }: { items: { label: string; n: number; to?: string; display?: string }[]; max?: number; color?: string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.n));
  return (
    <ul className="bar-list">{items.map((i) => {
      const inner = <><span>{i.label}</span><span className="bar-track" aria-hidden><span className="bar-fill" style={{ width: `${(i.n / m) * 100}%`, background: color, display: 'block' }} /></span><span className="n">{i.display ?? i.n}</span></>;
      return <li key={i.label}>{i.to ? <Link to={i.to} title={`${i.label}: ${i.display ?? i.n}`}>{inner}</Link> : <div className="bl-row">{inner}</div>}</li>;
    })}</ul>
  );
}

export function OverviewPage() {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const nav = useNavigate();
  const [f, p, set] = useFilters(now);
  const preset = p.get('preset') ?? '30';
  const prev = previousPeriod(f);
  const data = useMemo(() => {
    const k = kpis(state, f), kp = kpis(state, prev);
    return {
      k, kp, g: guardrails(state, f), daily: dailyResolvedByPath(state, f), dur: durationByPath(state, f), fun: funnel(state, f), cats: categoryBreakdown(state, f),
      buckets: statusBreakdown(state, f), closed: closedInRange(state, f).length, gaps: opportunities(state).gaps.slice(0, 5), prevHasData: cohort(state, prev).length > 0,
    };
  }, [state, f.from, f.to, f.source, f.category, f.group, f.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const { k, kp, g } = data;
  const delta = (cur: number | null, old: number | null, pct = false) => {
    if (!data.prevHasData || cur === null || old === null) return 'Prev. period: — insufficient data';
    const dv = cur - old;
    return `Prev. period: ${pct ? fmtPct(old) : fmtNum(old)} (${dv >= 0 ? '+' : ''}${pct ? `${(dv * 100).toFixed(0)} pts` : fmtNum(dv)})`;
  };
  const totalResolved = data.daily.reduce((a, r) => a + r.AUTO_POLICY + r.HUMAN_APPROVED + r.MANUAL, 0);
  const dims = !!(f.source || f.category || f.group || f.path);

  return (
    <div>
      <div className="page-head">
        <div><h1>Endpoint remediation overview</h1><p>Intake cohort: tickets <strong>created</strong> {f.from} → {f.to} (inclusive, local time) matching filters, measured as of now. All durations and savings are <strong>modeled</strong> from category baselines, not measured outcomes.</p></div>
      </div>
      <Workspace />
      <h2 style={{ marginTop: 24 }}>Analytics</h2>
      <div className="filters" role="group" aria-label="Dashboard filters">
        <div className="field auto"><span>Date range</span><div className="seg" role="group" aria-label="Date presets">{PRESETS.map((x) => <button key={x.k} aria-pressed={preset === x.k} onClick={() => set({ preset: x.k, from: null, to: null })}>{x.l}</button>)}<button aria-pressed={preset === 'custom'} onClick={() => set({ preset: 'custom', from: f.from, to: f.to })}>Custom</button></div></div>
        {preset === 'custom' && <><label className="field">From<input type="date" value={f.from} max={localDateKey(now)} onChange={(e) => e.target.value && set({ from: e.target.value })} /></label><label className="field">To<input type="date" value={f.to} max={localDateKey(now)} onChange={(e) => e.target.value && set({ to: e.target.value })} /></label></>}
        <label className="field">Source<select value={f.source ?? ''} onChange={(e) => set({ source: e.target.value })}><option value="">All</option><option value="EMPLOYEE">Employee</option><option value="DETECTION">Detection</option></select></label>
        <label className="field">Category<select value={f.category ?? ''} onChange={(e) => set({ category: e.target.value })}><option value="">All</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>
        <label className="field">Device group<select value={f.group ?? ''} onChange={(e) => set({ group: e.target.value })}><option value="">All</option><option>Standard</option><option>Critical</option></select></label>
        <label className="field">Path<select value={f.path ?? ''} onChange={(e) => set({ path: e.target.value })}><option value="">All</option><option value="AUTO_POLICY">Auto (policy)</option><option value="HUMAN_APPROVED">Human-approved</option><option value="MANUAL">Manual</option><option value="NONE">Pending / none</option></select></label>
        <button className="btn" disabled={!dims && preset === '30'} onClick={() => set({ preset: null, from: null, to: null, source: null, category: null, group: null, path: null })}><FilterX size={14} aria-hidden />Clear filters</button>
      </div>

      <h2 style={{ marginTop: 8 }}>Outcomes &amp; guardrails</h2>
      <div className="grid grid-4" style={{ marginBottom: 16 }} data-testid="kpis">
        <Kpi label="Total incidents" value={String(k.total)} sub={`${k.employee} employee · ${k.detection} proactive`} delta={delta(k.total, kp.total)} to={drillLink(f, 'all')} />
        <Kpi label="Auto-closed" value={String(k.autoClosed)} sub="Closed · policy-preapproved path" delta={delta(k.autoClosed, kp.autoClosed)} to={drillLink(f, 'autoClosed')} />
        <Kpi label="Human-approved closed" value={String(k.assistedClosed)} sub="Closed · per-ticket approval" delta={delta(k.assistedClosed, kp.assistedClosed)} to={drillLink(f, 'assistedClosed')} />
        <Kpi label="Review needed" value={String(k.review)} sub="Review, approval or consent pending" delta={delta(k.review, kp.review)} to={drillLink(f, 'review')} />
        <Kpi label="Unsupported / new" value={String(k.unsupported)} sub="No executable runbook or OS unsupported (can overlap review)" delta={delta(k.unsupported, kp.unsupported)} to={drillLink(f, 'unsupported')} />
        <Kpi label="Verified AI-assisted resolution rate" value={fmtPct(k.northStar)} sub={`North star: ${k.northStarNum} of ${k.eligible} eligible · coverage ${fmtPct(k.coverage)} of intake`} delta={delta(k.northStar, kp.northStar, true)} to={drillLink(f, 'aiVerified')} />
        <Kpi label="Modeled agent time saved" value={k.agentSavedMin === null ? '—' : `${(k.agentSavedMin / 60).toFixed(1)} h`} sub={`Efficiency ${fmtPct(k.efficiency)} vs baseline agent minutes (${k.aiVerifiedCount} AI resolutions)`} delta={delta(k.agentSavedMin === null ? null : k.agentSavedMin / 60, kp.agentSavedMin === null ? null : kp.agentSavedMin / 60)} to={drillLink(f, 'aiVerified')} />
        <Kpi label="Modeled MTTR improvement" value={fmtPct(k.mttrImprovement)} sub={`Modeled MTTR ${fmtNum(k.mttrModeled)} min (all resolved/closed)`} delta={delta(k.mttrImprovement, kp.mttrImprovement, true)} to={drillLink(f, 'aiVerified')} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card chart-card" aria-labelledby="h-daily">
          <h2 id="h-daily">Daily resolved by path</h2>
          <p className="chart-summary">Activity basis: current resolution date. {totalResolved} resolved in range — {(['AUTO_POLICY', 'HUMAN_APPROVED', 'MANUAL'] as Path[]).map((p) => `${PATH_LABEL[p]} ${data.daily.reduce((a, r) => a + r[p], 0)}`).join(', ')}. Closure activity (current closedAt in range, reopened excluded): <Link to={drillLink(f, null, {}, 'closed')}>{data.closed} closed</Link>. Click a bar to drill down.</p>
          <div className="legend">{(['AUTO_POLICY', 'HUMAN_APPROVED', 'MANUAL'] as Path[]).map((p) => <span key={p}><i style={{ background: PATH_COLOR[p] }} />{PATH_LABEL[p]}</span>)}</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barCategoryGap={1}>
                <CartesianGrid vertical={false} stroke="#edf1f5" />
                <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: '#52677c', fontSize: 11 }} minTickGap={16} />
                <YAxis allowDecimals={false} tick={{ fill: '#52677c', fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'rgba(8,126,131,.06)' }} content={({ active, payload, label }) => active && payload?.length ? <div className="chart-tooltip"><strong>{label}</strong>{payload.map((x) => <div key={String(x.dataKey)}>{PATH_LABEL[x.dataKey as Path]}: {String(x.value)}</div>)}</div> : null} />
                {(['AUTO_POLICY', 'HUMAN_APPROVED', 'MANUAL'] as Path[]).map((p, i, arr) => <Bar key={p} dataKey={p} stackId="a" fill={PATH_COLOR[p]} stroke="#fff" strokeWidth={1} radius={i === arr.length - 1 ? [3, 3, 0, 0] : undefined} cursor="pointer" onClick={(d: unknown) => { const x = d as { day?: string; payload?: { day: string } }; const day = x.payload?.day ?? x.day; if (day) nav(drillLink(f, null, { from: day, to: day, path: p }, 'resolved')); }} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card chart-card" aria-labelledby="h-dur">
          <h2 id="h-dur">Modeled resolution duration by path</h2>
          <p className="chart-summary">Mean modeled minutes for currently resolved/closed intake-cohort tickets vs their category-matched baseline. Live demo runs take seconds of actual wall time (accelerated) — not presented as measured savings.</p>
          <BarList items={data.dur.map((d) => ({ label: `${PATH_LABEL[d.path]} (n=${d.n})`, n: d.modeled ?? 0, display: d.modeled === null ? '—' : `${d.modeled.toFixed(0)}m`, to: drillLink(f, null, { path: d.path }) }))} max={Math.max(1, ...data.dur.map((d) => d.baseline ?? 0))} />
          <p className="small muted">Baselines for the same tickets: {data.dur.map((d) => `${PATH_LABEL[d.path]} ${d.baseline === null ? '—' : `${d.baseline.toFixed(0)}m`}`).join(' · ')}</p>
        </section>
        <section className="card chart-card" aria-labelledby="h-funnel">
          <h2 id="h-funnel">Automation funnel</h2>
          <p className="chart-summary">One intake cohort and date range, nested stages: reported → eligible at intake → remediation attempted (execution started) → currently verified AI resolution. {data.fun.map((x) => `${x.label} ${x.count}`).join(' → ')}.</p>
          <BarList items={data.fun.map((x) => ({ label: x.label, n: x.count, to: drillLink(f, x.key) }))} color="var(--accent)" />
        </section>
        <section className="card chart-card" aria-labelledby="h-status">
          <h2 id="h-status">Current status of intake cohort</h2>
          <p className="chart-summary">Mutually exclusive buckets summing to {k.total}.</p>
          <BarList items={data.buckets.map((b) => ({ label: b.label, n: b.count, to: drillLink(f, b.key) }))} color="#52677c" />
        </section>
        <section className="card chart-card" aria-labelledby="h-cat">
          <h2 id="h-cat">Category breakdown</h2>
          <p className="chart-summary">Intake cohort by reported category. {data.cats.slice(0, 3).map((c) => `${CATEGORY_LABEL[c.category]} ${c.count}`).join(', ')}{data.cats.length > 3 ? '…' : ''}</p>
          {data.cats.length ? <BarList items={data.cats.map((c) => ({ label: CATEGORY_LABEL[c.category], n: c.count, to: drillLink(f, null, { category: c.category }) }))} /> : <p className="muted">No incidents in range.</p>}
        </section>
        <section className="card chart-card" aria-labelledby="h-guard">
          <h2 id="h-guard">Trust guardrails</h2>
          <p className="chart-summary">Execution metrics use execution start time in range ({g.started} started, {g.completed} completed).</p>
          <table className="data"><tbody>
            <tr><td>Verified remediation success</td><td className="num"><strong>{fmtPct(g.verifiedSuccess, 1)}</strong></td><td className="small muted">target ≥ 95%</td></tr>
            <tr><td>First-attempt success</td><td className="num"><strong>{fmtPct(g.firstAttempt, 1)}</strong></td><td className="small muted">per ticket</td></tr>
            <tr><td>Unauthorized executions</td><td className="num"><strong style={{ color: g.unauthorized ? 'var(--danger)' : undefined }}>{g.unauthorized}</strong></td><td className="small muted">expected 0 · {g.blockedAttempts} blocked attempts</td></tr>
            <tr><td>Rollback rate</td><td className="num"><strong>{fmtPct(g.rollbackRate, 1)}</strong></td><td className="small muted">of completed executions</td></tr>
            <tr><td>Reopen rate</td><td className="num"><strong>{fmtPct(g.reopenRate, 1)}</strong></td><td className="small muted"><Link to={drillLink(f, 'reopened')}>ever-resolved cohort</Link></td></tr>
            <tr><td>Audit completeness</td><td className="num"><strong>{fmtPct(g.auditCompleteness, 1)}</strong></td><td className="small muted">decision + start + terminal</td></tr>
            <tr><td>Approval turnaround (median)</td><td className="num"><strong>{g.approvalTurnaroundMin === null ? '—' : `${g.approvalTurnaroundMin.toFixed(1)} min`}</strong></td><td className="small muted">actual, by revision</td></tr>
          </tbody></table>
        </section>
      </div>
      <div style={{ marginBottom: 16 }}><BusinessImpact f={f} drill={(m, extra) => drillLink(f, m, extra)} /></div>
      <section className="card" aria-labelledby="h-gaps">
        <div className="row-between"><h2 id="h-gaps">Top automation gaps</h2><Link to="/opportunities">All opportunities</Link></div>
        <p className="chart-summary">All-time unsupported/manual tickets by category — modeled potential agent hours, not realized savings.</p>
        {data.gaps.length ? <BarList items={data.gaps.map((x) => ({ label: `${CATEGORY_LABEL[x.category]} (${x.tickets.length})`, n: x.hours, display: `${x.hours.toFixed(1)}h`, to: `/incidents?category=${x.category}` }))} color="var(--series-2)" /> : <p className="muted">No gaps.</p>}
      </section>
      <p className="small muted" style={{ marginTop: 16 }}><Info size={12} aria-hidden /> Baselines are category-matched modeled values (e.g. Storage 20 agent-min / 30 resolution-min), not measured organizational outcomes. Pilot targets (−30% median resolution time, −25% agent handling time, ≥95% verified success, zero unauthorized executions) are proposals. Previous period = the {Math.round((Date.parse(f.to) - Date.parse(f.from)) / 864e5) + 1} days before {f.from}. <CalendarClock size={12} aria-hidden /> Range end {addDaysKey(f.to, 0)}.</p>
    </div>
  );
}
