import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, CircleHelp, Clock, Gauge, History, Link2, MinusCircle, Network, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { useStore } from '../app/store';
import { CATEGORY_LABEL } from '../domain/catalog';
import { OUTCOME_LABEL, SLA_LABEL, assessment, clusterFor, similarIncidents, slaState, type SlaState } from '../domain/insights';
import { currentDiagnosis, gatesFor } from '../domain/engine';
import type { EmployeeChoice, PreflightCheck, Ticket } from '../domain/types';
import { STATUS_LABEL } from '../domain/transitions';
import { DisabledReason, Modal, StatusBadge, fmtShort } from './ui';
import { MIN } from '../domain/util';

const CHECK_ICON = { PASS: CheckCircle2, FAIL: XCircle, PENDING: CircleDashed, NA: MinusCircle } as const;
const CHECK_COLOR = { PASS: 'var(--success)', FAIL: 'var(--danger)', PENDING: 'var(--warning)', NA: 'var(--muted)' } as const;
const CHECK_TEXT = { PASS: 'Passed', FAIL: 'Failed', PENDING: 'Pending', NA: 'Not applicable' } as const;

/** Reusable preflight checklist (enhancement §3). */
export function PreflightPanel({ checks, title = 'Preflight safety checks', note }: { checks: PreflightCheck[]; title?: string; note?: string }) {
  const failed = checks.filter((c) => c.status === 'FAIL').length;
  const pending = checks.filter((c) => c.status === 'PENDING').length;
  return (
    <section aria-label={title} className="preflight">
      <div className="row-between"><h3 style={{ margin: 0 }}>{title}</h3>
        <span className={`badge ${failed ? 'b-danger' : pending ? 'b-warning' : 'b-success'}`} data-testid="preflight-summary">{failed ? <XCircle size={12} aria-hidden /> : pending ? <CircleDashed size={12} aria-hidden /> : <CheckCircle2 size={12} aria-hidden />}{failed ? `Blocked · ${failed} failed` : pending ? `${pending} pending` : 'All checks passed'}</span></div>
      <ul className="check-list">
        {checks.map((c) => { const I = CHECK_ICON[c.status]; return (
          <li key={c.key} data-check={c.key} data-status={c.status}><I size={15} color={CHECK_COLOR[c.status]} aria-hidden /><span className="cl-label">{c.label}</span><span className={`cl-status s-${c.status}`}>{CHECK_TEXT[c.status]}</span><span className="cl-detail">{c.detail}</span></li>
        ); })}
      </ul>
      <p className="small muted" style={{ margin: 0 }}>{note ?? 'Every applicable check is mandatory. Execution is blocked while any check is failed or pending, and all checks are re-validated immediately before each device-changing step.'}</p>
    </section>
  );
}

export function SlaBadge({ t, now }: { t: Ticket; now: number }) {
  const st: SlaState = slaState(t, now);
  const cls = st === 'BREACHED' || st === 'MISSED' ? 'b-danger' : st === 'AT_RISK' ? 'b-warning' : st === 'MET' ? 'b-success' : 'b-outline';
  const left = Date.parse(t.slaDueAt) - now;
  const extra = st === 'OK' || st === 'AT_RISK' ? ` · ${left < 60 * MIN ? `${Math.max(0, Math.round(left / MIN))}m` : `${Math.round(left / 3600000)}h`} left` : '';
  return <span className={`badge ${cls}`} title={`Resolution SLA (${t.priority}) due ${fmtShort(t.slaDueAt)}`}><Clock size={12} aria-hidden />{SLA_LABEL[st]}{extra}</span>;
}

function Signal({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  return <div className={`signal tone-${tone}`}><span className="signal-label">{label}</span><span className="signal-value">{value}</span><span className="signal-sub">{sub}</span></div>;
}

/** Explainable AI assessment (enhancement §2): three separate signals; none overrides policy gates. */
export function AssessmentPanel({ ticketId }: { ticketId: string }) {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const a = useMemo(() => assessment(state, ticketId, now, state.settings.role), [state, ticketId, now]);
  const d = currentDiagnosis(state, state.tickets[ticketId]);
  if (!d) return null;
  const p = state.policy;
  return (
    <section className="stack" aria-label="AI assessment">
      <div className="signals">
        <Signal label="Diagnosis confidence" value={`${a.diagnosisConfidence}`} sub={`How sure the classification is (${CATEGORY_LABEL[d.category]}). Thresholds: review ${p.reviewThreshold} · approve ${p.approvalThreshold} · auto ${p.autoThreshold}`} tone={d.confidence >= p.approvalThreshold ? 'ok' : d.confidence >= p.reviewThreshold ? 'warn' : 'bad'} />
        <Signal label="Remediation confidence" value={a.remediationConfidence === null ? '—' : `${a.remediationConfidence}`} sub={a.remediationBasis} tone={a.remediationConfidence === null ? 'muted' : a.remediationConfidence >= 90 ? 'ok' : 'warn'} />
        <Signal label="Execution readiness" value={a.readiness === 'N/A' ? 'N/A' : a.readiness === 'READY' ? 'Ready' : a.readiness === 'PENDING' ? 'Pending' : 'Blocked'} sub={a.readinessDetail} tone={a.readiness === 'READY' ? 'ok' : a.readiness === 'PENDING' ? 'warn' : a.readiness === 'BLOCKED' ? 'bad' : 'muted'} />
      </div>
      <p className="banner small" style={{ margin: 0 }}><ShieldCheck size={14} aria-hidden /><span>Scores are <strong>simulated and deterministic</strong>, not calibrated production probabilities. Confidence never overrides risk, authorization, consent or execution prerequisites — the policy gate and preflight checks decide what can run.</span></p>
      <div>
        <h3>Why this recommendation</h3>
        <ul className="clean">{a.why.map((x, i) => <li key={i}><Sparkles size={14} aria-hidden />{x}</li>)}<li><ShieldCheck size={14} aria-hidden />Device compatibility: {a.compatibility}</li></ul>
      </div>
      <details className="disclosure"><summary>Diagnostic evidence ({d.evidence.length}) and remaining uncertainty ({d.uncertainty.length})</summary>
        <h3 style={{ marginTop: 8 }}>Diagnostic evidence (current telemetry)</h3>
        <ul className="clean">{d.evidence.map((x, i) => <li key={i}><CheckCircle2 size={14} color="var(--success)" aria-hidden />{x}</li>)}</ul>
        <h3 style={{ marginTop: 8 }}>Remaining uncertainty</h3>
        <ul className="clean">{d.uncertainty.map((x, i) => <li key={i}><CircleHelp size={14} color="var(--warning)" aria-hidden />{x}</li>)}</ul>
      </details>
    </section>
  );
}

/** Similar incident intelligence (enhancement §6). */
export function SimilarIncidentsPanel({ ticketId }: { ticketId: string }) {
  const state = useStore((s) => s.state);
  const sim = useMemo(() => similarIncidents(state, ticketId, 6), [state, ticketId]);
  return (
    <section className="card stack" aria-label="Similar incidents">
      <h2><History size={16} aria-hidden />Similar incidents</h2>
      {sim.total === 0 ? <p className="muted">No historical incidents match this category yet.</p> : <>
        <p className="small">{sim.total} matching incidents · {sim.attempted ? <>automated success <strong>{Math.round((sim.successRate ?? 0) * 100)}%</strong> ({sim.aiVerified}/{sim.attempted} attempts)</> : 'no automated attempts'} · {sim.manual} resolved manually{sim.medianModeledMin !== null ? ` · median modeled resolution ${sim.medianModeledMin} min` : ''}. Derived from incident records (synthetic history).</p>
        {sim.patterns.length > 0 && <div className="banner warn" style={{ margin: 0 }}><AlertTriangle size={16} aria-hidden /><div><strong>Failure patterns</strong><ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{sim.patterns.map((p) => <li key={p}>{p}</li>)}</ul></div></div>}
        <div className="table-wrap"><table className="data"><thead><tr><th>Incident</th><th className="num">Similarity</th><th>Outcome</th><th className="num">Resolution</th><th>Runbook</th></tr></thead>
          <tbody>{sim.items.map((x) => (
            <tr key={x.ticket.id}>
              <td><Link to={`/incidents/${x.ticket.id}`}>{x.ticket.displayId}</Link><div className="small muted">{x.ticket.title} · {fmtShort(x.ticket.createdAt)}</div></td>
              <td className="num" title={x.reasons.join(' · ')}>{x.score}</td>
              <td><span className={`badge ${x.outcome === 'VERIFIED_AI' ? 'b-success' : x.outcome === 'MANUAL' ? 'b-neutral' : x.outcome === 'OPEN' ? 'b-outline' : 'b-danger'}`}>{OUTCOME_LABEL[x.outcome]}</span></td>
              <td className="num">{x.durationMin === null ? '—' : `${x.durationMin}m`}</td>
              <td>{x.runbookId ? <Link to={`/library/${x.runbookId}`}>{x.runbook}</Link> : '—'}</td>
            </tr>))}</tbody></table></div>
        <p className="small muted" style={{ margin: 0 }}>Similarity = same category 50 + same runbook 15 + same OS 10 + same group 5 + same source 5 + description overlap ≤ 15 (deterministic). Resolution minutes are modeled values.</p>
      </>}
    </section>
  );
}

/** Simulated employee notification & consent interface (enhancement §5). */
export function EmployeeConsentCard({ ticketId }: { ticketId: string }) {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const dispatch = useStore((s) => s.dispatch);
  const [mode, setMode] = useState<null | 'SCHEDULE' | 'DECLINE' | 'ASSIST'>(null);
  const [win, setWin] = useState('');
  const [note, setNote] = useState('');
  const t = state.tickets[ticketId];
  const g = gatesFor(state, ticketId, now);
  const rb = g.runbook;
  const ro = state.settings.role === 'MANAGER';
  if (!rb) return null;
  const local = (x: number) => { const d = new Date(x); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const respond = (choice: EmployeeChoice, extra: { windowAt?: string; note?: string } = {}) => { const r = dispatch({ type: 'EMPLOYEE_RESPOND', ticketId, choice, ...extra }); if (r.ok) setMode(null); };
  return (
    <section className="employee-card" aria-label="Employee consent request (simulated)">
      <div className="employee-head"><span className="badge b-neutral">Simulated employee view</span><span className="small muted">What {t.requester} sees · not a real notification</span></div>
      <h3 style={{ margin: '6px 0 4px' }}>IT would like to fix “{t.title}”</h3>
      <dl className="kv">
        <dt>Proposed action</dt><dd>{rb.title}</dd>
        <dt>Why</dt><dd>{g.diagnosis?.evidence[0]}</dd>
        <dt>Estimated duration</dt><dd>~{rb.expectedMin} min</dd>
        <dt>Expected disruption</dt><dd>{rb.disruptive ? (rb.category === 'WIFI' ? 'Network drops for about a minute' : rb.category === 'APP_UPDATE' ? 'The app will close and reopen' : 'Device unavailable while the action runs') : 'None expected'}</dd>
        <dt>Restart required</dt><dd>{rb.restartRequired ? 'Yes — save your work first' : 'No'}</dd>
        <dt>Approved by IT</dt><dd>{g.approval ? `${g.approval.actor} (${g.approval.role})` : '—'}</dd>
      </dl>
      <div className="row">
        <button className="btn btn-primary" data-testid="consent-grant" disabled={ro} onClick={() => respond('PROCEED')}>Proceed now</button>
        <button className="btn" data-testid="consent-schedule" disabled={ro} onClick={() => { setWin(local(now + 30 * MIN)); setMode('SCHEDULE'); }}>Choose a later time</button>
        <button className="btn" disabled={ro} onClick={() => { setNote(''); setMode('ASSIST'); }}>Ask IT for help instead</button>
        <button className="btn btn-danger" data-testid="consent-deny" disabled={ro} onClick={() => { setNote(''); setMode('DECLINE'); }}>Decline</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Employee consent never replaces the IT approval above; both are required for disruptive actions.</p>
      <DisabledReason reason={ro ? 'Manager role is read-only' : null} />
      {mode === 'SCHEDULE' && (
        <Modal title="Choose a maintenance window" onClose={() => setMode(null)} footer={<><button className="btn" onClick={() => setMode(null)}>Cancel</button><button className="btn btn-primary" data-testid="confirm-window" disabled={!win} onClick={() => respond('SCHEDULE', { windowAt: new Date(win).toISOString() })}>Confirm window</button></>}>
          <label className="field">Start time (between now + 1 minute and 24 hours)<input type="datetime-local" data-autofocus value={win} min={local(now + MIN)} max={local(now + 24 * 60 * MIN)} onChange={(e) => setWin(e.target.value)} /></label>
          <p className="small muted">The plan runs at this time if all prerequisites still pass then (approval, device online, not busy, battery).</p>
        </Modal>
      )}
      {(mode === 'DECLINE' || mode === 'ASSIST') && (
        <Modal title={mode === 'DECLINE' ? 'Decline this fix' : 'Ask IT for help'} onClose={() => setMode(null)} footer={<><button className="btn" onClick={() => setMode(null)}>Cancel</button><button className={`btn ${mode === 'DECLINE' ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => respond(mode, { note })}>{mode === 'DECLINE' ? 'Decline' : 'Request assistance'}</button></>}>
          <label className="field">Message to IT (optional)<textarea data-autofocus value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <p className="small muted">The ticket is escalated to an agent; no automated action will run.</p>
        </Modal>
      )}
    </section>
  );
}

/** Correlation context for an incident (enhancement §7). */
export function CorrelationPanel({ ticketId }: { ticketId: string }) {
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const t = state.tickets[ticketId];
  const cluster = useMemo(() => clusterFor(state, ticketId), [state, ticketId]);
  const ro = state.settings.role === 'MANAGER';
  const parent = t.parentId ? state.tickets[t.parentId] : undefined;
  if (t.isParent) {
    return (
      <section className="banner" aria-label="Linked incidents"><Network size={18} aria-hidden /><div className="grow">
        <strong>Shared incident · {t.childIds?.length ?? 0} linked reports</strong> — endpoint remediation is paused on linked incidents until this is resolved. Resolving it does <strong>not</strong> close them; each needs verified recovery.
        <ul className="clean small" style={{ marginTop: 6 }}>{(t.childIds ?? []).map((id) => <li key={id}><Link2 size={14} aria-hidden /><Link to={`/incidents/${id}`}>{state.tickets[id].displayId}</Link> {state.tickets[id].requester} · <StatusBadge status={state.tickets[id].status} /></li>)}</ul>
      </div></section>
    );
  }
  if (parent) {
    const done = parent.status === 'RESOLVED' || parent.status === 'CLOSED';
    const canVerify = done && (t.status === 'REVIEW_REQUIRED' || t.status === 'ESCALATED');
    return (
      <section className={`banner ${done ? 'success' : 'warn'}`} aria-label="Shared incident link"><Link2 size={18} aria-hidden /><div className="grow">
        Linked to shared incident <Link to={`/incidents/${parent.id}`}><strong>{parent.displayId}</strong></Link> ({STATUS_LABEL[parent.status]}). {done ? 'The shared fix is complete — verify this endpoint has recovered before closing.' : 'Individual endpoint remediation is paused while the shared incident is investigated.'}
        {canVerify && <div style={{ marginTop: 8 }}><button className="btn btn-primary btn-sm" data-testid="verify-recovery" disabled={ro} onClick={() => dispatch({ type: 'VERIFY_RECOVERY', ticketId })}>Verify recovery (read-only probe)</button></div>}
      </div></section>
    );
  }
  if (!cluster) return null;
  return (
    <section className="banner warn" aria-label="Potential shared incident"><Network size={18} aria-hidden /><div className="grow">
      <strong>Potential shared incident detected (simulated correlation)</strong>
      <ul className="small" style={{ margin: '4px 0', paddingLeft: 18 }}>{cluster.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
      <div className="small">Related: {cluster.tickets.map((x) => <Link key={x.id} to={`/incidents/${x.id}`} style={{ marginRight: 8 }}>{x.displayId}</Link>)}</div>
      <div style={{ marginTop: 8 }}><button className="btn btn-primary btn-sm" data-testid="link-shared" disabled={ro} onClick={() => dispatch({ type: 'LINK_SHARED', ticketIds: cluster.tickets.map((x) => x.id) })}><Link2 size={14} aria-hidden />Create parent incident &amp; link {cluster.tickets.length}</button>
        <span className="small muted" style={{ marginLeft: 8 }}>Pauses individual endpoint fixes; nothing is closed automatically.</span></div>
      <DisabledReason reason={ro ? 'Manager role is read-only' : null} />
    </div></section>
  );
}

export const QueueChevron = ChevronRight;
export const GaugeIcon = Gauge;
