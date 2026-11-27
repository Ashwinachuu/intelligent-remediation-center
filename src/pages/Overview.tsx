import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FilterX, Info } from 'lucide-react';
import { useStore } from '../app/store';
import { ISSUE_TYPES } from '../domain/catalog';
import { METHOD_LABEL } from '../domain/lifecycle';
import { dashboard, defaultRange, fmtMin, fmtPct, resolvedPerDay, turnaround, unsupportedPerDay, type Filters } from '../domain/metrics';
import { localDateKey } from '../domain/util';
import type { IssueType, Path } from '../domain/types';

const PRESETS = [{ k: 'today', l: 'Today', d: 1 }, { k: '7', l: 'Last 7 days', d: 7 }, { k: '30', l: 'Last 30 days', d: 30 }, { k: '90', l: 'Last 90 days', d: 90 }];
const COLOR: Record<Path, string> = { SELF_SERVICE: 'var(--series-3)', HUMAN_APPROVED: 'var(--series-1)', MANUAL: '#9fb0c1' };

function useFilters(now: number): [Filters, string, (kv: Record<string, string | null>) => void] {
  const [p, setP] = useSearchParams();
  const preset = p.get('preset') ?? '7';
  const def = defaultRange(now, PRESETS.find((x) => x.k === preset)?.d ?? 7);
  let from = preset === 'custom' ? p.get('from') ?? def.from : def.from;
  let to = preset === 'custom' ? p.get('to') ?? def.to : def.to;
  if (from > to) [from, to] = [to, from];
  const set = (kv: Record<string, string | null>) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(kv)) { if (v) n.set(k, v); else n.delete(k); } setP(n, { replace: true }); };
  return [{ from, to, issueType: (p.get('issue') || undefined) as IssueType | undefined }, preset, set];
}
export const drill = (f: Filters, metric: string | null, extra: Record<string, string> = {}, basis: 'created' | 'closed' = 'created') => {
  const q = new URLSearchParams({ from: extra.from ?? f.from, to: extra.to ?? f.to, basis });
  if (metric) q.set('metric', metric);
  if (f.issueType) q.set('issue', f.issueType);
  for (const [k, v] of Object.entries(extra)) if (k !== 'from' && k !== 'to') q.set(k, v);
  return `/incidents?${q}`;
};

function Kpi({ label, value, to, sub, testid }: { label: string; value: string | number; to: string; sub?: string; testid?: string }) {
  return <Link className="kpi" to={to} data-testid={testid}><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="sub">{sub}</span>}</Link>;
}

/** Admin Overview (V1.2 §14): how much AI helps, where it can't, and the admin effort it removes. */
export function OverviewPage() {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const nav = useNavigate();
  const [f, preset, set] = useFilters(now);
  const m = useMemo(() => ({ d: dashboard(state, f), perDay: resolvedPerDay(state, f), unsup: unsupportedPerDay(state, f), turn: turnaround(state, f) }), [state, f.from, f.to, f.issueType]); // eslint-disable-line react-hooks/exhaustive-deps
  const { d } = m;
  const other = d.dist.filter((x) => ['status_SELF_SERVICE', 'status_MANUAL', 'status_REOPENED', 'status_OPEN'].includes(x.key));
  const resolvedTotal = m.perDay.reduce((a, r) => a + r.SELF_SERVICE + r.HUMAN_APPROVED + r.MANUAL, 0);
  const s = state.settings;
  const savedTip = `Estimated, not measured. For each incident: manual handling baseline (per category, e.g. Wi-Fi ${s.baselines.WIFI} min) − admin minutes actually spent. Self-service spends 0; approving costs ${s.reviewEffortMin} min; a rollback adds ${s.rollbackEffortMin} min; manual work costs the full baseline. Failed AI attempts therefore count against the total. Elapsed resolution time is NOT used.`;

  return (
    <div>
      <div className="page-head"><div><h1>Overview</h1><p>Incidents reported {f.from} → {f.to}. Every number is calculated from the incidents below and opens the matching list.</p></div></div>
      <div className="filters" role="group" aria-label="Dashboard filters">
        <div className="field auto"><span>Date range</span><div className="seg" role="group" aria-label="Date presets">{PRESETS.map((x) => <button key={x.k} aria-pressed={preset === x.k} onClick={() => set({ preset: x.k, from: null, to: null })}>{x.l}</button>)}<button aria-pressed={preset === 'custom'} onClick={() => set({ preset: 'custom', from: f.from, to: f.to })}>Custom</button></div></div>
        {preset === 'custom' && <><label className="field">From<input type="date" value={f.from} max={localDateKey(now)} onChange={(e) => e.target.value && set({ from: e.target.value })} /></label><label className="field">To<input type="date" value={f.to} max={localDateKey(now)} onChange={(e) => e.target.value && set({ to: e.target.value })} /></label></>}
        <label className="field">Issue<select value={f.issueType ?? ''} onChange={(e) => set({ issue: e.target.value })}><option value="">All</option>{ISSUE_TYPES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
        <button className="btn" disabled={preset === '7' && !f.issueType} onClick={() => set({ preset: null, from: null, to: null, issue: null })}><FilterX size={14} aria-hidden />Clear</button>
      </div>

      <div className="kpi-row" data-testid="kpis">
        <Kpi label="Total reported" value={d.total} to={drill(f, 'all')} testid="kpi-total" />
        <Kpi label="Auto-closed — Employee Self-Service" value={d.ssCount} to={drill(f, 'selfService')} testid="kpi-selfservice" />
        <Kpi label="Human-approved closures" value={d.dist[1].count} to={drill(f, 'humanApproved')} testid="kpi-approved" />
        <Kpi label="Review needed" value={d.dist[3].count} to={drill(f, 'status_REVIEW_NEEDED')} testid="kpi-review" />
        <Kpi label="New / Unsupported" value={d.dist[4].count} to={drill(f, 'status_UNSUPPORTED')} testid="kpi-unsupported" />
        <Kpi label="Remediation in progress" value={d.dist[5].count} to={drill(f, 'status_REMEDIATION')} testid="kpi-remediation" />
        <Kpi label="Manually resolved" value={d.dist[2].count} to={drill(f, 'manual')} testid="kpi-manual" />
      </div>
      <p className="small muted" data-testid="reconcile">Other open: {other.map((o, i) => <span key={o.key}>{i ? ' · ' : ''}<Link to={drill(f, o.key)}>{o.label} {o.count}</Link></span>)}. All states together = {d.distSum} = total reported {d.total}.</p>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <section className="card stack" aria-labelledby="q1">
          <h2 id="q1">1 · How many incidents is AI helping resolve?</h2>
          <Link to={drill(f, 'aiAssisted')} className="big-metric" data-testid="ai-rate"><span className="big">{fmtPct(d.aiRate)}</span><span>Verified AI-assisted resolution rate</span></Link>
          <p className="small muted">(Self-service closures {d.ssCount} + human-approved AI closures {d.aiCount - d.ssCount}) ÷ {d.total} reported. Primary success metric. Reopened incidents are excluded until closed again.</p>
          <Link to={drill(f, 'selfService')} className="big-metric small-big" data-testid="ss-rate"><span className="big">{fmtPct(d.ssRate)}</span><span>Employee self-service resolution rate</span></Link>
          <p className="small muted">{d.ssCount} ÷ {d.total} — resolved with no administrator involvement.</p>
        </section>
        <section className="card stack" aria-labelledby="q2">
          <h2 id="q2">2 · Where is AI unable to help?</h2>
          <Link to={drill(f, 'everUnsupported')} className="big-metric" data-testid="unsupported-rate"><span className="big">{fmtPct(d.unsupportedRate)}</span><span>Unsupported incident rate</span></Link>
          <p className="small muted">{d.everUnsupported} of {d.total} incidents where AI had no reliable recommendation — <Link to={drill(f, 'currentUnsupported')}>{d.currentUnsupported} still unsupported</Link>, <Link to={drill(f, 'unsupportedResolved')}>{d.unsupportedResolved} since resolved</Link>. <Link to="/opportunities">Turn them into knowledge →</Link></p>
          <div style={{ height: 120 }} aria-label="Unsupported incidents by day reported">
            <ResponsiveContainer width="100%" height="100%"><BarChart data={m.unsup} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <XAxis dataKey="day" tickFormatter={(x: string) => x.slice(5)} tick={{ fontSize: 10, fill: '#52677c' }} minTickGap={12} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#52677c' }} />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="chart-tooltip"><strong>{label}</strong><div>{String(payload[0].value)} unsupported of {(payload[0].payload as { reported: number }).reported} reported</div></div> : null} />
              <Bar dataKey="unsupported" fill="var(--danger)" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(x: unknown) => { const day = (x as { payload?: { day: string } }).payload?.day; if (day) nav(drill(f, 'everUnsupported', { from: day, to: day })); }} />
            </BarChart></ResponsiveContainer>
          </div>
          <p className="chart-summary">Unsupported incidents by the day they were reported.</p>
        </section>
        <section className="card stack" aria-labelledby="q3">
          <h2 id="q3">3 · How much admin effort is AI eliminating?</h2>
          <Link to={drill(f, 'closedVerified')} className="big-metric" data-testid="time-saved" title={savedTip}><span className="big">{fmtMin(d.saved.total)}</span><span>Estimated admin time saved <span className="badge b-warning">Estimate</span></span></Link>
          <table className="data compact"><tbody>
            <tr><td>Employee self-service</td><td className="num">{fmtMin(d.saved.selfService)}</td></tr>
            <tr><td>Human-approved AI fixes</td><td className="num">{fmtMin(d.saved.approved)}</td></tr>
            <tr><td>Failed AI attempts &amp; manual follow-up</td><td className="num">{fmtMin(d.saved.failedOrManual)}</td></tr>
          </tbody></table>
          <details className="disclosure"><summary><Info size={13} aria-hidden /> How is this calculated?</summary><p className="small" style={{ marginTop: 6 }}>{savedTip} Baselines are editable in <Link to="/settings">AI Settings</Link>.</p></details>
        </section>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card chart-card" aria-labelledby="h-day">
          <h2 id="h-day">Tickets resolved per day</h2>
          <p className="chart-summary">Closure basis: incidents with a current close date in the range ({resolvedTotal}). Reopened incidents drop out until closed again. Click a bar to drill down.</p>
          <div className="legend">{(['SELF_SERVICE', 'HUMAN_APPROVED', 'MANUAL'] as Path[]).map((p) => <span key={p}><i style={{ background: COLOR[p] }} />{METHOD_LABEL[p]}</span>)}</div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%"><BarChart data={m.perDay} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#edf1f5" /><XAxis dataKey="day" tickFormatter={(x: string) => x.slice(5)} tick={{ fontSize: 11, fill: '#52677c' }} minTickGap={12} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#52677c' }} />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="chart-tooltip"><strong>{label}</strong>{payload.map((x) => <div key={String(x.dataKey)}>{METHOD_LABEL[x.dataKey as Path]}: {String(x.value)}</div>)}</div> : null} />
              {(['SELF_SERVICE', 'HUMAN_APPROVED', 'MANUAL'] as Path[]).map((p) => <Bar key={p} dataKey={p} stackId="a" fill={COLOR[p]} stroke="#fff" cursor="pointer" onClick={(x: unknown) => { const day = (x as { payload?: { day: string } }).payload?.day; if (day) nav(drill(f, null, { from: day, to: day, method: p }, 'closed')); }} />)}
            </BarChart></ResponsiveContainer>
          </div>
        </section>
        <section className="card stack" aria-labelledby="h-dist">
          <h2 id="h-dist">Incident resolution distribution</h2>
          <p className="chart-summary">Every reported incident in exactly one state — sums to {d.total}.</p>
          <ul className="bar-list">{d.dist.map((x) => <li key={x.key}><Link to={drill(f, x.key)}><span>{x.label}</span><span className="bar-track" aria-hidden><span className="bar-fill" style={{ width: `${d.total ? (x.count / d.total) * 100 : 0}%`, display: 'block', background: x.key === 'selfService' ? COLOR.SELF_SERVICE : x.key === 'humanApproved' ? COLOR.HUMAN_APPROVED : x.key === 'manual' ? COLOR.MANUAL : '#c9d4de' }} /></span><span className="n">{x.count}</span></Link></li>)}</ul>
          <p className="small"><strong>AI-assisted vs manual (closed):</strong> {d.aiCount} AI-assisted · {d.dist[2].count} manual</p>
        </section>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <section className="card stack"><h3>Average resolution turnaround</h3>
          <table className="data compact"><tbody>{m.turn.map((x) => <tr key={x.path}><td>{METHOD_LABEL[x.path]}</td><td className="num">{x.hours === null ? '—' : x.hours < 1 ? `${Math.round(x.hours * 60)} min` : `${x.hours.toFixed(1)} h`}</td><td className="small muted">n={x.n}</td></tr>)}</tbody></table>
          <p className="small muted">Elapsed time from report to close (not admin effort).</p></section>
        <section className="card stack"><h3>Incident reopening rate</h3><Link to={drill(f, 'reopened')} className="big-metric small-big"><span className="big">{fmtPct(d.reopenRate)}</span></Link><p className="small muted">{d.reopened} of {d.everClosed} incidents that were ever closed were reopened.</p></section>
        <section className="card stack"><h3>SLA compliance</h3><Link to={drill(f, 'slaMissed')} className="big-metric small-big"><span className="big">{fmtPct(d.slaCompliance)}</span></Link><p className="small muted">{d.slaMet} closed within SLA ÷ ({d.slaMet} + {d.slaMissed} missed or overdue). Overdue is an indicator, not a status.</p></section>
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>Simulated data and AI. Rates use the incidents reported in the selected range as the denominator; “resolved per day” uses close dates.</p>
    </div>
  );
}
