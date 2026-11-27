import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, Info } from 'lucide-react';
import { useStore } from '../app/store';
import { CATEGORIES, CATEGORY_LABEL, DEFAULT_ASSUMPTIONS } from '../domain/catalog';
import { businessImpact, fmtNum, fmtPct, type Filters, type MetricKey } from '../domain/metrics';
import type { Assumptions } from '../domain/types';
import { DisabledReason, Modal, fmtShort } from './ui';

/** Business impact estimates (enhancement §9). Every value is derived from records + editable assumptions. */
export function BusinessImpact({ f, drill }: { f: Filters; drill: (m: MetricKey | null, extra?: Record<string, string>) => string }) {
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const [open, setOpen] = useState(false);
  const a = state.settings.assumptions;
  const b = useMemo(() => businessImpact(state, f), [state, f]);
  const money = (x: number | null) => (x === null ? '—' : `${a.currency} ${Math.round(x).toLocaleString()}`);
  const rows: { label: string; value: string; method: string; to: string; est?: boolean }[] = [
    { label: 'Agent handling hours saved', value: b.agentHoursSaved === null ? '—' : `${fmtNum(b.agentHoursSaved, 1)} h`, method: 'Σ (baseline agent min − modeled agent min) over verified AI resolutions ÷ 60', to: drill('aiVerified'), est: true },
    { label: 'Employee downtime avoided', value: b.downtimeHoursAvoided === null ? '—' : `${fmtNum(b.downtimeHoursAvoided, 1)} h`, method: 'Σ max(0, baseline resolution min − modeled resolution min) over verified AI resolutions ÷ 60', to: drill('aiVerified'), est: true },
    { label: 'IT operational cost savings', value: money(b.costSavings), method: `Agent hours saved × hourly cost (${a.currency} ${a.hourlyCost}/h)`, to: drill('aiVerified'), est: true },
    { label: 'MTTR improvement', value: fmtPct(b.mttrImprovement), method: '(Σ baseline resolution − Σ modeled resolution) ÷ Σ baseline resolution, verified AI resolutions', to: drill('aiVerified'), est: true },
    { label: 'Verified resolution rate', value: fmtPct(b.verifiedRate), method: 'Eligible-at-intake tickets currently verified via AI path ÷ eligible tickets (north star)', to: drill('aiVerified') },
    { label: 'SLA compliance', value: fmtPct(b.slaCompliance), method: `Resolved within SLA (${b.slaMet}) ÷ (within SLA + missed/breached ${b.slaMissed}); open tickets within SLA excluded`, to: drill('sla_missed') },
    { label: 'Incident reopening rate', value: fmtPct(b.reopenRate, 1), method: 'Ever-resolved cohort tickets with reopenedCount > 0 ÷ ever-resolved', to: drill('reopened') },
    { label: 'Automation-related disruption', value: `${b.disruptiveExecutions} runs · ~${b.disruptionMin} min`, method: `Disruptive executions started in range × runbook expected minutes; ${b.disruptiveFailures} failed or rolled back`, to: '/audit?action=EXECUTION_STARTED' },
  ];
  return (
    <section className="card" aria-labelledby="h-impact">
      <div className="row-between"><h2 id="h-impact">Business impact <span className="badge b-warning">Estimated</span></h2>
        <button className="btn btn-sm" data-testid="open-assumptions" onClick={() => setOpen(true)}><Calculator size={14} aria-hidden />Assumptions &amp; methodology</button></div>
      <p className="chart-summary">Same intake cohort and date range as the KPIs. Estimates combine simulated records with the configurable baselines and hourly cost below — they are not measured savings.</p>
      <div className="table-wrap"><table className="data impact-table" data-testid="impact-table">
        <thead><tr><th>Metric</th><th className="num">Value</th><th>How it is calculated</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.label}><td><Link to={r.to}>{r.label}</Link>{r.est && <span className="badge b-outline" style={{ marginLeft: 6 }}>est.</span>}</td><td className="num"><strong>{r.value}</strong></td><td className="small muted">{r.method}</td></tr>)}</tbody>
      </table></div>
      {open && <AssumptionsModal a={a} onClose={() => setOpen(false)} onSave={(x) => { const r = dispatch({ type: 'UPDATE_ASSUMPTIONS', assumptions: x }); if (r.ok) setOpen(false); }} role={state.settings.role} />}
    </section>
  );
}

function AssumptionsModal({ a, onClose, onSave, role }: { a: Assumptions; onClose: () => void; onSave: (a: Assumptions) => void; role: string }) {
  const [d, setD] = useState<Assumptions>(JSON.parse(JSON.stringify(a)));
  const can = role === 'ADMIN' || role === 'MANAGER';
  const num = (v: string) => (v === '' ? NaN : Number(v));
  return (
    <Modal title="Estimate assumptions & methodology" wide onClose={onClose} footer={<><button className="btn" onClick={() => setD(JSON.parse(JSON.stringify(DEFAULT_ASSUMPTIONS)))} disabled={!can}>Reset to defaults</button><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" data-testid="save-assumptions" disabled={!can} onClick={() => onSave(d)}>Save assumptions</button></>}>
      <p className="banner small" style={{ margin: 0 }}><Info size={14} aria-hidden /><span>Manual-resolution baselines are <strong>modeled assumptions</strong> per category, not measured organizational outcomes. Changing them recalculates estimates immediately; ticket records are not modified. {a.updatedAt ? `Last changed by ${a.updatedBy} ${fmtShort(a.updatedAt)}.` : ''}</span></p>
      <DisabledReason reason={can ? null : 'Only Admin or Manager can change analytics assumptions'} />
      <div className="row">
        <label className="field" style={{ maxWidth: 200 }}>Hourly operational cost<input type="number" min={0} value={Number.isFinite(d.hourlyCost) ? d.hourlyCost : ''} disabled={!can} onChange={(e) => setD({ ...d, hourlyCost: num(e.target.value) })} data-testid="hourly-cost" /></label>
        <label className="field" style={{ maxWidth: 140 }}>Currency label<input type="text" value={d.currency} disabled={!can} onChange={(e) => setD({ ...d, currency: e.target.value.slice(0, 6) })} /></label>
      </div>
      <div className="table-wrap"><table className="data"><thead><tr><th>Category</th><th>Manual agent handling (min)</th><th>Manual resolution time (min)</th></tr></thead>
        <tbody>{CATEGORIES.map((c) => <tr key={c}><td>{CATEGORY_LABEL[c]}</td>
          <td><input type="number" min={0} aria-label={`${CATEGORY_LABEL[c]} agent minutes`} value={Number.isFinite(d.baselines[c].agentMin) ? d.baselines[c].agentMin : ''} disabled={!can} onChange={(e) => setD({ ...d, baselines: { ...d.baselines, [c]: { ...d.baselines[c], agentMin: num(e.target.value) } } })} /></td>
          <td><input type="number" min={0} aria-label={`${CATEGORY_LABEL[c]} resolution minutes`} value={Number.isFinite(d.baselines[c].resolutionMin) ? d.baselines[c].resolutionMin : ''} disabled={!can} onChange={(e) => setD({ ...d, baselines: { ...d.baselines, [c]: { ...d.baselines[c], resolutionMin: num(e.target.value) } } })} /></td></tr>)}</tbody></table></div>
      <details className="disclosure"><summary>Methodology</summary>
        <ul className="small">
          <li>Modeled AI resolution minutes: policy path = runbook expected minutes; human-approved = expected + 8 + scheduled delay (Spec §7).</li>
          <li>Modeled agent minutes: 1 (policy) / 4 (approved) + 2 per reject/review, 5 per recovery, 1 per approval rework.</li>
          <li>Savings use only verified AI resolutions (currently resolved/closed, verified, auto or human-approved path) in the intake cohort.</li>
          <li>Live demo executions take seconds of real time; analytics never present that as measured savings.</li>
        </ul>
      </details>
    </Modal>
  );
}
