import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, CircleHelp, ClipboardCheck, FilePlus2, Info, Play, RotateCcw, ShieldAlert, Undo2, UserCheck, UserX, Wifi, WifiOff, XCircle, Clock, OctagonAlert, Search, Hourglass } from 'lucide-react';
import { useStore } from '../app/store';
import { CATEGORY_LABEL, EVIDENCE_KINDS, SIM_ACTIONS } from '../domain/catalog';
import { activeExecution, attemptsForRevision, currentDiagnosis, deviceFieldLabel, gatesFor, latestAppliedExecution } from '../domain/engine';
import { canRoleApprove } from '../domain/policy';
import { ESCALATABLE, STATUS_LABEL } from '../domain/transitions';
import type { AppState, Device, EvidenceKind, Execution, Role, Ticket } from '../domain/types';
import { DisabledReason, Modal, PathBadge, ResultIcon, RiskBadge, ScoreBadge, StatusBadge, TZ, fmtShort, fmtTime } from '../components/ui';
import { TelemetryPreview } from '../components/TicketCreator';
import { MIN, ms } from '../domain/util';
import { NotFoundPage } from './NotFound';

type Tab = 'summary' | 'remediation' | 'activity';

function toLocalInput(t: number) {
  const d = new Date(t); const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function rollbackInfo(s: AppState, t: Ticket, role: Role, now: number): { available: boolean; reason?: string; exec?: Execution } {
  const e = latestAppliedExecution(s, t.id);
  if (!e) return { available: false, reason: 'No device change has been applied' };
  if (!['ROLLBACK_AVAILABLE', 'RESOLVED', 'CLOSED'].includes(t.status)) return { available: false, reason: `Rollback is not offered while ${STATUS_LABEL[t.status].toLowerCase()}`, exec: e };
  if (!['PASSED', 'FAILED'].includes(e.phase)) return { available: false, reason: `Last execution is ${e.phase.toLowerCase().replace('_', ' ')}`, exec: e };
  const rb = s.runbooks.find((r) => r.id === e.runbookId && r.version === e.version);
  if (!e.reversible) return { available: false, reason: `Irreversible action — ${rb?.recoveryNote ?? ''}`, exec: e };
  if (!e.rollbackDeadline || ms(e.rollbackDeadline) <= now) return { available: false, reason: 'Rollback deadline (30 min after action) has passed', exec: e };
  if (role === 'MANAGER') return { available: false, reason: 'Manager role is read-only', exec: e };
  if (e.risk === 'HIGH' && role !== 'ADMIN') return { available: false, reason: 'Rolling back a HIGH-risk action requires Admin', exec: e };
  const dev = s.devices[e.deviceId];
  const conflicts = e.changes.filter((c) => dev[c.field] !== c.after);
  if (conflicts.length) return { available: false, reason: `Device changed since action (${conflicts.map((c) => deviceFieldLabel(c.field)).join(', ')}) — rollback refused`, exec: e };
  return { available: true, exec: e };
}

function ScoreMeter({ score, review, approval, auto }: { score: number; review: number; approval: number; auto: number }) {
  return (
    <div>
      <div className="score"><span className="big">{score}</span><span className="muted small">/ 100 simulated score · not a calibrated probability</span></div>
      <div className="meter" role="img" aria-label={`Score ${score}; review threshold ${review}, approval ${approval}, auto ${auto}`}>
        <div className="fill" style={{ width: `${score}%`, background: score >= approval ? 'var(--accent)' : score >= review ? 'var(--warning)' : 'var(--danger)' }} />
        {[['Review', review], ['Approve', approval], ['Auto', auto]].map(([l, v]) => <div key={l as string} className="tick" style={{ left: `${v}%` }}><span>{l} {v}</span></div>)}
      </div>
    </div>
  );
}

function ExecutionView({ e, s }: { e: Execution; s: AppState }) {
  const rb = s.runbooks.find((r) => r.id === e.runbookId && r.version === e.version);
  const steps = [...(rb?.steps ?? []), 'Verification checks'];
  const failed = e.phase === 'FAILED' || e.phase === 'ROLLBACK_FAILED';
  const stateOf = (i: number) => {
    if (e.phase === 'CANCELLED') return i < e.stepIndex ? 'done' : i === e.stepIndex ? 'fail' : '';
    if (i < 3) { if (i < e.stepIndex) return 'done'; if (i === e.stepIndex && e.phase === 'RUNNING') return 'active'; if (e.outcome === 'EXEC_FAIL' && i === 0 && failed) return 'fail'; return e.stepIndex > i ? 'done' : ''; }
    if (e.phase === 'VERIFYING') return 'active';
    if (e.verificationOutput.length) return e.verificationPassed ? 'done' : 'fail';
    return '';
  };
  return (
    <div className="stack">
      <div className="row-between"><strong>Execution {e.id.slice(0, 8)} · {e.runbookId} v{e.version}</strong><span className="badge b-neutral">{e.phase.replace(/_/g, ' ').toLowerCase()}</span></div>
      <div className="small muted">Started {fmtTime(e.startedAt)}{e.endedAt && ` · ended ${fmtTime(e.endedAt)} (actual elapsed ${Math.max(0, Math.round((ms(e.endedAt) - ms(e.startedAt)) / 1000))}s — accelerated demo)`} · authorization: {e.authorization.kind === 'APPROVAL' ? `approval by ${e.authorization.actor} (${e.authorization.role})` : `policy v${e.authorization.policyVersion} preapproval`}</div>
      <ol className="steps" aria-label="Execution steps">
        {steps.map((st, i) => { const k = stateOf(i); return <li key={i}><span className={`step-dot ${k}`} aria-hidden>{k === 'done' ? '✓' : k === 'fail' ? '!' : i + 1}</span><div><div>{st}</div><div className="small muted">{e.results[i] ?? (k === 'active' ? 'In progress…' : 'Pending')}</div></div></li>; })}
      </ol>
      {e.changes.length > 0 && (
        <table className="data change-table"><thead><tr><th>Field</th><th>Before (snapshot)</th><th>After action</th><th>Current</th></tr></thead>
          <tbody>{e.changes.map((c) => <tr key={c.field}><td>{deviceFieldLabel(c.field)}</td><td className="diff-before">{String(c.before)}</td><td className="diff-after">{String(c.after)}</td><td>{String(s.devices[e.deviceId][c.field])}</td></tr>)}</tbody></table>
      )}
      {e.verificationOutput.length > 0 && <div className={`banner ${e.verificationPassed ? 'success' : 'danger'}`} style={{ margin: 0 }}>{e.verificationPassed ? <CheckCircle2 size={16} aria-hidden /> : <XCircle size={16} aria-hidden />}<div><strong>Actual verification output:</strong> {e.verificationOutput.join(' · ')}</div></div>}
      {e.rollbackDeadline && <div className="small muted">Rollback deadline: {fmtTime(e.rollbackDeadline)}</div>}
      {e.cancelReason && <div className="banner warn" style={{ margin: 0 }}><AlertTriangle size={16} aria-hidden />Stopped before mutation: {e.cancelReason}</div>}
      {e.rollbackResults.length > 0 && (<div><strong className="small">Rollback{e.rollbackBy ? ` by ${e.rollbackBy}` : ''}</strong><ul className="clean small">{e.rollbackResults.map((r, i) => <li key={i}>{r.startsWith('FAIL') || r.includes('FAILED') ? <XCircle size={14} color="var(--danger)" aria-hidden /> : <Undo2 size={14} aria-hidden />}{r}</li>)}</ul></div>)}
    </div>
  );
}

export function IncidentDetailPage() {
  const { id } = useParams();
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const dispatch = useStore((s) => s.dispatch);
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('remediation');
  const [modal, setModal] = useState<null | { kind: 'REJECT' | 'REQUEST_REVIEW' | 'ESCALATE' | 'REOPEN' | 'REOPEN_EMP' } | { kind: 'SCHEDULE' } | { kind: 'MANUAL' }>(null);
  const [reason, setReason] = useState('');
  const [schedAt, setSchedAt] = useState('');
  const [impactOk, setImpactOk] = useState(false);
  const [manual, setManual] = useState({ note: '', evidence: '', verified: false });
  const [ev, setEv] = useState<{ kind: EvidenceKind; note: string }>({ kind: 'DISK_USAGE', note: '' });
  const [submitting, setSubmitting] = useState(false);
  const t = id ? state.tickets[id] : undefined;
  const g = useMemo(() => (t ? gatesFor(state, t.id, now) : undefined), [state, t, now]);
  const hyp = useMemo(() => (t ? gatesFor(state, t.id, now, { approvalValid: true, scheduleDueAt: undefined }) : undefined), [state, t, now]);
  if (!t || !g || !hyp) return <NotFoundPage />;
  const role = state.settings.role;
  const ro = role === 'MANAGER';
  const d = currentDiagnosis(state, t);
  const dev = state.devices[t.deviceId];
  const rb = d?.runbookId ? state.runbooks.find((r) => r.id === d.runbookId && r.version === d.runbookVersion) : undefined;
  const executions = state.executions.filter((e) => e.ticketId === t.id);
  const lastExec = executions[executions.length - 1];
  const running = activeExecution(state, t.id);
  const rbInfo = rollbackInfo(state, t, role, now);
  const audit = state.audit.filter((a) => a.ticketId === t.id).slice().reverse();
  const notes = state.notifications.filter((n) => n.ticketId === t.id).slice().reverse();
  const approvals = state.approvals.filter((a) => a.ticketId === t.id).slice().reverse();
  const revisions = state.diagnoses.filter((x) => x.ticketId === t.id).sort((a, b) => b.revision - a.revision);
  const act = SIM_ACTIONS[rb?.actionKey ?? 'UNKNOWN'];
  const preview = act ? (Object.entries(act.patch(dev)) as [keyof Device, unknown][]).map(([f, v]) => ({ f, before: dev[f], after: v })) : [];
  const perm = d ? canRoleApprove(role, d.risk) : { ok: false, reason: 'No diagnosis' };
  const draftExists = state.runbooks.some((r) => r.sourceTicketIds.includes(t.id));
  const job = g.job;
  const attempts = d ? attemptsForRevision(state, t.id, d.revision) : 0;

  const run = (a: Parameters<typeof dispatch>[0]) => { if (submitting) return; setSubmitting(true); try { return dispatch(a); } finally { setTimeout(() => setSubmitting(false), 250); } };
  const openReason = (kind: 'REJECT' | 'REQUEST_REVIEW' | 'ESCALATE' | 'REOPEN' | 'REOPEN_EMP') => { setReason(''); setModal({ kind }); };
  const approveNow = () => run({ type: 'APPROVE', ticketId: t.id });
  const openSchedule = () => { setSchedAt(toLocalInput(now + 10 * MIN)); setImpactOk(false); setModal({ kind: 'SCHEDULE' }); };

  const approveLabel = d?.risk === 'HIGH' ? 'Approve & schedule' : hyp.route === 'AWAITING_CONSENT' ? 'Approve & request consent' : hyp.route === 'READY' ? 'Approve & execute' : 'Approve';
  const approveDisabled = ro ? 'Manager role is read-only' : !perm.ok ? perm.reason : t.status !== 'AWAITING_APPROVAL' ? null : !rb ? 'No executable runbook' : null;

  const liveText = running ? `${t.displayId}: ${running.phase === 'ROLLING_BACK' ? 'rolling back' : running.phase === 'VERIFYING' ? 'verifying' : `executing step ${running.stepIndex + 1} of 3`}` : `${t.displayId}: ${STATUS_LABEL[t.status]}`;

  const primary = (() => {
    switch (t.status) {
      case 'OPEN': case 'REOPENED':
        return <div className="stack"><button className="btn btn-primary" disabled={ro || submitting} onClick={() => run({ type: 'RUN_DIAGNOSIS', ticketId: t.id })}><Search size={16} aria-hidden />Run diagnosis</button><DisabledReason reason={ro ? 'Manager role is read-only' : null} /></div>;
      case 'AWAITING_APPROVAL':
        return (
          <div className="stack">
            <div className="row">
              <button className="btn btn-primary" data-testid="approve" disabled={!!approveDisabled || submitting} onClick={d?.risk === 'HIGH' ? openSchedule : approveNow}>{d?.risk === 'HIGH' ? <CalendarClock size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}{approveLabel}</button>
              {d?.risk !== 'HIGH' && <button className="btn" disabled={!!approveDisabled || submitting} onClick={openSchedule}><CalendarClock size={16} aria-hidden />Approve &amp; schedule</button>}
            </div>
            <DisabledReason reason={approveDisabled} />
            <p className="small muted">Requires {g.requiredRole === 'ADMIN' ? 'Admin' : 'Agent or Admin'} · approval binds plan {d?.planHash.slice(0, 8)} and policy v{state.policy.version}; expires after {state.policy.approvalTTLMin} min if not started.</p>
          </div>
        );
      case 'AWAITING_CONSENT':
        return <div className="banner warn" style={{ margin: 0 }}><UserCheck size={16} aria-hidden /><div>Waiting for employee consent. Consent is never inferred from agent approval. Use the labelled simulation buttons below.</div></div>;
      case 'WAITING_DEVICE':
        return <div className="banner" style={{ margin: 0 }}><WifiOff size={16} aria-hidden /><div>{g.reasons[g.reasons.length - 1]}. Use the simulation controls to reconnect or mark the employee available — all gates are re-evaluated.</div></div>;
      case 'SCHEDULED':
        return <div className="stack"><div className="banner" style={{ margin: 0 }}><CalendarClock size={16} aria-hidden /><div>Scheduled for <strong>{fmtTime(job?.dueAt)}</strong>. Gates (approval, consent, device, pause) are re-checked when due.</div></div>
          <button className="btn btn-primary" data-testid="advance" disabled={ro || submitting} onClick={() => run({ type: 'ADVANCE_SCHEDULE', ticketId: t.id })}><Clock size={16} aria-hidden />Advance scheduled job to now (demo)</button>
          <DisabledReason reason={ro ? 'Manager role is read-only' : null} /></div>;
      case 'READY':
        return <div className="stack"><div className="banner success" style={{ margin: 0 }}><Play size={16} aria-hidden />All gates satisfied — starting automatically…</div><button className="btn" disabled={ro || submitting} onClick={() => run({ type: 'START', ticketId: t.id })}><Play size={16} aria-hidden />Start now</button></div>;
      case 'EXECUTING': case 'VERIFYING': case 'ROLLING_BACK':
        return <div className="banner" style={{ margin: 0 }}><Hourglass size={16} aria-hidden /><div>{t.status === 'ROLLING_BACK' ? 'Rollback in progress' : 'Remediation in progress'} — no unsafe cancellation mid-action. Policy pause stops before the next mutation only.</div></div>;
      case 'ROLLBACK_AVAILABLE':
        return <div className="stack"><div className="banner danger" style={{ margin: 0 }}><XCircle size={16} aria-hidden /><div>Verification failed — the ticket is <strong>not</strong> resolved. Roll back the applied change, then follow up manually.</div></div>
          <button className="btn btn-danger-solid" data-testid="rollback" disabled={!rbInfo.available || submitting} onClick={() => run({ type: 'ROLLBACK', ticketId: t.id })}><Undo2 size={16} aria-hidden />Roll back now</button><DisabledReason reason={rbInfo.available ? null : rbInfo.reason} /></div>;
      case 'REVIEW_REQUIRED': case 'ESCALATED':
        return <div className="stack"><div className={`banner ${t.status === 'ESCALATED' ? 'danger' : 'warn'}`} style={{ margin: 0 }}>{t.status === 'ESCALATED' ? <OctagonAlert size={16} aria-hidden /> : <CircleHelp size={16} aria-hidden />}<div>{t.status === 'ESCALATED' ? 'Escalated — no automated execution. Investigate and resolve manually.' : 'Human review required — add validated evidence to re-diagnose, or resolve manually.'}<div className="small">{g.reasons.join(' · ')}</div></div></div>
          <button className="btn btn-primary" data-testid="resolve-manual" disabled={ro || submitting} onClick={() => { setManual({ note: '', evidence: '', verified: false }); setModal({ kind: 'MANUAL' }); }}><ClipboardCheck size={16} aria-hidden />Resolve manually…</button><DisabledReason reason={ro ? 'Manager role is read-only' : null} /></div>;
      case 'RESOLVED': case 'CLOSED':
        return <div className="stack"><div className="banner success" style={{ margin: 0 }}><CheckCircle2 size={16} aria-hidden /><div>{t.status === 'CLOSED' ? 'Closed' : 'Resolved'} via {t.path === 'MANUAL' ? 'manual resolution' : t.path === 'AUTO_POLICY' ? 'policy-preapproved remediation' : 'human-approved remediation'}{t.verified ? ' · verified' : ''}.{t.status === 'RESOLVED' && state.policy.closureMode === 'EMPLOYEE_CONFIRM' ? ' Awaiting employee confirmation.' : ''}</div></div>
          {t.path === 'MANUAL' && <button className="btn" disabled={ro || draftExists || submitting} onClick={() => { const r = run({ type: 'PROPOSE_DRAFT', fromTicketId: t.id }); if (r?.ok && r.ticketId) nav(`/library/${r.ticketId}`); }}><FilePlus2 size={16} aria-hidden />Propose runbook draft</button>}
          {t.path === 'MANUAL' && <DisabledReason reason={draftExists ? 'A draft already exists for this ticket' : null} />}</div>;
      default: return null;
    }
  })();

  return (
    <div>
      <div className="sr-only" aria-live="polite" role="status">{liveText}</div>
      <section className="detail-head" aria-label="Ticket header">
        <div className="row-between">
          <div className="row"><h1>{t.displayId}</h1><StatusBadge status={t.status} />{t.demo && <span className="badge b-accent">Demo scenario{t.scenario && t.scenario !== 'CUSTOM' ? ` ${t.scenario}` : ''}</span>}</div>
          <div className="row"><PathBadge path={t.path} /><RiskBadge risk={d?.risk} /></div>
        </div>
        <p style={{ marginTop: 6, fontSize: 15 }}>{t.title}</p>
        <dl className="meta-grid">
          <div><dt>Requester</dt><dd>{t.requester}</dd></div>
          <div><dt>Device</dt><dd>{dev.name}</dd></div>
          <div><dt>Owner</dt><dd>{t.owner}</dd></div>
          <div><dt>Source · priority</dt><dd>{t.source === 'DETECTION' ? 'Proactive detection' : 'Employee report'} · {t.priority}</dd></div>
          <div><dt>Created</dt><dd>{fmtShort(t.createdAt)}</dd></div>
          <div><dt>Updated</dt><dd>{fmtShort(t.updatedAt)}</dd></div>
          <div><dt>Resolved</dt><dd>{fmtShort(t.resolvedAt)}</dd></div>
          <div><dt>Closed</dt><dd>{fmtShort(t.closedAt)}</dd></div>
          <div><dt>Eligible at intake</dt><dd title={t.eligibilityReason}>{t.eligibleAtIntake ? 'Yes' : 'No'} <span className="small muted">(policy v{t.intakePolicyVersion})</span></dd></div>
          <div><dt>Reopened</dt><dd>{t.reopenedCount}×</dd></div>
        </dl>
        <p className="small muted" style={{ marginTop: 8 }}>Times shown in {TZ}.</p>
      </section>

      <div className="tabs" role="tablist" aria-label="Ticket sections">
        {(['summary', 'remediation', 'activity'] as Tab[]).map((k) => <button key={k} role="tab" aria-selected={tab === k} aria-controls={`panel-${k}`} id={`tab-${k}`} onClick={() => setTab(k)}>{k === 'summary' ? 'Summary' : k === 'remediation' ? 'Remediation' : `Activity (${audit.length})`}</button>)}
      </div>

      {tab === 'summary' && (
        <div role="tabpanel" id="panel-summary" aria-labelledby="tab-summary" className="grid grid-2">
          <div className="card stack">
            <h2>Description</h2><p>{t.description}</p>
            <h3>Eligibility at intake</h3><p className="small">{t.eligibleAtIntake ? 'Eligible' : 'Not eligible'} — {t.eligibilityReason} (immutable; policy v{t.intakePolicyVersion})</p>
            {t.resolutionNote && <><h3>Resolution note</h3><p>{t.resolutionNote}</p><p className="small muted">Evidence: {t.manualEvidence}</p></>}
            <h3>Diagnosis revisions</h3>
            <ul className="clean small">{revisions.map((r) => <li key={r.id}><Info size={14} aria-hidden />Rev {r.revision} · {fmtShort(r.createdAt)} · {CATEGORY_LABEL[r.category]} · score {r.confidence} · {r.risk} · policy v{r.policyVersion} · plan <span className="mono">{r.planHash.slice(0, 8)}</span> → {STATUS_LABEL[r.recommendedRoute]}</li>)}</ul>
            <h3>Decisions</h3>
            {approvals.length === 0 ? <p className="small muted">No approval decisions yet.</p> : <ul className="clean small">{approvals.map((a) => <li key={a.id}><UserCheck size={14} aria-hidden />{a.decision} by {a.actor} ({a.role}) · {fmtShort(a.at)} · rev {a.diagnosisRevision}{a.reason ? ` · “${a.reason}”` : ''}{a.consumedBy ? ' · used' : ''}{a.invalidatedAt ? ` · invalidated: ${a.invalidReason}` : ''}{a.expiredLoggedAt ? ' · expired' : ''}</li>)}</ul>}
            {t.consent && <p className="small">Consent: {t.consent.granted ? 'granted' : 'denied'} {fmtShort(t.consent.at)}{t.consent.granted ? ` · expires ${fmtShort(t.consent.expiresAt)}` : ''}</p>}
          </div>
          <div className="card"><h2>Device context · {dev.name}</h2><TelemetryPreview d={dev} /><p className="small muted" style={{ marginTop: 8 }}>“Online” means the management channel is reachable — not necessarily that Wi-Fi is healthy.</p></div>
        </div>
      )}

      {tab === 'remediation' && (
        <div role="tabpanel" id="panel-remediation" aria-labelledby="tab-remediation" className="split">
          <section className="card stack" aria-label="Evidence">
            <h2>Diagnosis &amp; evidence {d && <span className="badge b-outline">Revision {d.revision}</span>}</h2>
            {!d ? <p className="muted">Not diagnosed yet.</p> : (
              <>
                <div className="row"><span className="badge b-neutral">{CATEGORY_LABEL[d.category]}</span>{!d.telemetryConsistent && <span className="badge b-warning"><AlertTriangle size={12} aria-hidden />Telemetry mismatch — validation requested</span>}</div>
                <ScoreMeter score={d.confidence} review={state.policy.reviewThreshold} approval={state.policy.approvalThreshold} auto={state.policy.autoThreshold} />
                <h3>Evidence (from current telemetry)</h3>
                <ul className="clean">{d.evidence.map((x, i) => <li key={i}><CheckCircle2 size={14} color="var(--success)" aria-hidden />{x}</li>)}</ul>
                <h3>Uncertainty</h3>
                <ul className="clean">{d.uncertainty.map((x, i) => <li key={i}><CircleHelp size={14} color="var(--warning)" aria-hidden />{x}</li>)}</ul>
                <h3>Policy route</h3>
                <ul className="clean">{g.reasons.map((x, i) => <li key={i}><ShieldAlert size={14} aria-hidden />{x}</li>)}</ul>
              </>
            )}
            {t.status === 'REVIEW_REQUIRED' && (
              <div className="sim-box stack">
                <h3>Additional diagnostics</h3>
                <p className="small muted">Scenario-supported evidence is checked against current telemetry before it can change the plan. Free text stays uncertain. Scores cannot be edited.</p>
                <div className="grid grid-2">
                  <label className="field">Evidence type<select value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value as EvidenceKind })}>{EVIDENCE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label>
                  <label className="field">Observation<input type="text" value={ev.note} onChange={(e) => setEv({ ...ev, note: e.target.value })} placeholder="e.g. disk 96% used" /></label>
                </div>
                <div><button className="btn" disabled={ro || ev.note.trim().length < 3 || submitting} onClick={() => { const r = run({ type: 'ADD_EVIDENCE', ticketId: t.id, kind: ev.kind, note: ev.note }); if (r?.ok) setEv({ ...ev, note: '' }); }}><Search size={14} aria-hidden />Add evidence &amp; re-diagnose</button></div>
              </div>
            )}
          </section>

          <section className="card action-card stack" aria-label="Recommended action">
            <h2>Recommended plan</h2>
            {rb ? (
              <dl className="kv">
                <dt>Runbook</dt><dd><Link to={`/library/${rb.id}`}>{rb.id} v{rb.version}</Link> — {rb.title}{rb.status !== 'APPROVED' && <span className="badge b-danger" style={{ marginLeft: 6 }}>{rb.status}</span>}</dd>
                <dt>Risk / impact</dt><dd><RiskBadge risk={d?.risk} /> {rb.disruptive ? 'Disruptive — employee consent required' : 'Non-disruptive'}</dd>
                <dt>Expected duration</dt><dd>~{rb.expectedMin} min (simulated); demo runs in seconds</dd>
                <dt>Prerequisites</dt><dd>{rb.prerequisites.join(' · ')}</dd>
                <dt>Change preview</dt><dd>{preview.length ? preview.map((p) => <div key={p.f}>{deviceFieldLabel(p.f)}: <span className="diff-before">{String(p.before)}</span> → <span className="diff-after">{String(p.after)}</span></div>) : '—'}</dd>
                <dt>Verification</dt><dd>{rb.checks.join(' · ')}</dd>
                <dt>Rollback</dt><dd>{rb.reversible ? `Available for 30 min after action: ${rb.rollbackSteps.join('; ')}` : `Not available — ${rb.recoveryNote}`}</dd>
                <dt>Required approver</dt><dd>{g.requiredRole === 'ADMIN' ? 'Admin (HIGH risk)' : g.autoEligible ? 'None — preapproved by policy' : 'Agent or Admin'}</dd>
                <dt>Attempts</dt><dd>{attempts} of {state.policy.maxAttempts} for revision {d?.revision}</dd>
              </dl>
            ) : <p className="muted">No approved executable runbook for {CATEGORY_LABEL[d?.category ?? t.category]}. No device action will be executed.</p>}
            <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>{primary}</div>
            <div className="row">
              {t.status === 'AWAITING_APPROVAL' && <><button className="btn" disabled={ro} onClick={() => openReason('REQUEST_REVIEW')}>Request review</button><button className="btn btn-danger" disabled={ro} onClick={() => openReason('REJECT')}>Reject</button></>}
              {ESCALATABLE.includes(t.status) && <button className="btn btn-danger" disabled={ro} onClick={() => openReason('ESCALATE')}><OctagonAlert size={14} aria-hidden />Escalate</button>}
              {(t.status === 'RESOLVED' || t.status === 'CLOSED') && <button className="btn" disabled={ro} onClick={() => openReason('REOPEN')}><RotateCcw size={14} aria-hidden />Reopen</button>}
              {(t.status === 'RESOLVED' || t.status === 'CLOSED') && rbInfo.exec?.reversible && <button className="btn btn-danger" disabled={!rbInfo.available || submitting} onClick={() => run({ type: 'ROLLBACK', ticketId: t.id })}><Undo2 size={14} aria-hidden />Roll back</button>}
            </div>
            {(t.status === 'RESOLVED' || t.status === 'CLOSED') && rbInfo.exec && <DisabledReason reason={rbInfo.available ? null : `Rollback unavailable: ${rbInfo.reason}`} />}

            <div className="sim-box stack" aria-label="Simulation controls">
              <h3><AlertTriangle size={12} aria-hidden />Simulation controls (demo)</h3>
              <div className="row">
                <button className="btn btn-sm" disabled={ro} onClick={() => run({ type: 'SET_DEVICE', ticketId: t.id, online: !dev.online })}>{dev.online ? <><WifiOff size={14} aria-hidden />Take device offline</> : <><Wifi size={14} aria-hidden />Simulate device reconnect</>}</button>
                <button className="btn btn-sm" disabled={ro} onClick={() => run({ type: 'SET_DEVICE', ticketId: t.id, busy: !dev.busy })}>{dev.busy ? 'Mark employee available' : 'Mark employee busy'}</button>
              </div>
              {t.status === 'AWAITING_CONSENT' && <div className="row"><button className="btn btn-sm" data-testid="consent-grant" disabled={ro || submitting} onClick={() => run({ type: 'CONSENT', ticketId: t.id, grant: true })}><UserCheck size={14} aria-hidden />Simulate employee: grant consent</button><button className="btn btn-sm btn-danger" disabled={ro || submitting} onClick={() => run({ type: 'CONSENT', ticketId: t.id, grant: false })}><UserX size={14} aria-hidden />Simulate employee: deny consent</button></div>}
              {t.status === 'RESOLVED' && state.policy.closureMode === 'EMPLOYEE_CONFIRM' && <div className="row"><button className="btn btn-sm" disabled={ro} onClick={() => run({ type: 'EMPLOYEE_CONFIRM', ticketId: t.id })}>Simulate employee: confirm fixed</button><button className="btn btn-sm" disabled={ro} onClick={() => openReason('REOPEN_EMP')}>Simulate employee: still broken</button></div>}
              {t.status === 'CLOSED' && <div className="row"><button className="btn btn-sm" disabled={ro} onClick={() => openReason('REOPEN_EMP')}>Simulate employee: issue recurred</button></div>}
              <p className="small muted">Toggles change only this fictional device and re-evaluate gates; they never bypass approval, consent or pause.</p>
            </div>
          </section>

          {executions.length > 0 && (
            <section className="card stack" style={{ gridColumn: '1 / -1' }} aria-label="Execution history">
              <h2>Execution progress &amp; history</h2>
              {[...executions].reverse().map((e) => <div key={e.id} style={{ borderTop: e === lastExec ? undefined : '1px solid var(--border)', paddingTop: 8 }}><ExecutionView e={e} s={state} /></div>)}
            </section>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" className="grid grid-2">
          <section className="card"><h2>Audit timeline</h2>
            <ol className="timeline">{audit.map((a) => <li key={a.id}><span className={`tdot ${a.result}`} aria-hidden /><div><div className="row"><strong>{a.action.replace(/_/g, ' ').toLowerCase()}</strong>{a.from && a.to && <span className="small muted">{STATUS_LABEL[a.from]} → {STATUS_LABEL[a.to]}</span>}<ResultIcon result={a.result} /></div><div className="small">{a.reason}</div><div className="small muted">{fmtTime(a.at)} · {a.actor} ({a.role}) · <Link to={`/audit?q=${t.displayId}&event=${a.id}`}>#{a.seq}</Link></div></div></li>)}</ol>
          </section>
          <section className="card"><h2>Employee &amp; agent notifications (simulated)</h2>
            {notes.length === 0 ? <p className="muted">None.</p> : <ul className="clean">{notes.map((n) => <li key={n.id}><Info size={14} aria-hidden /><div><div className="small muted">To {n.recipient.toLowerCase()} · {fmtTime(n.at)}</div>{n.message}</div></li>)}</ul>}
          </section>
        </div>
      )}

      {modal && 'kind' in modal && (modal.kind === 'REJECT' || modal.kind === 'REQUEST_REVIEW' || modal.kind === 'ESCALATE' || modal.kind === 'REOPEN' || modal.kind === 'REOPEN_EMP') && (
        <Modal title={{ REJECT: 'Reject plan', REQUEST_REVIEW: 'Request review', ESCALATE: 'Escalate ticket', REOPEN: 'Reopen ticket', REOPEN_EMP: 'Simulate employee reopening' }[modal.kind]} onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className={`btn ${modal.kind === 'REJECT' || modal.kind === 'ESCALATE' ? 'btn-danger-solid' : 'btn-primary'}`} disabled={reason.trim().length < 3 || submitting} onClick={() => {
            const k = modal.kind;
            const r = k === 'REOPEN' || k === 'REOPEN_EMP' ? run({ type: 'REOPEN', ticketId: t.id, reason, byEmployee: k === 'REOPEN_EMP' }) : run({ type: k, ticketId: t.id, reason });
            if (r?.ok) setModal(null);
          }}>Confirm</button></>}>
          <label className="field">Reason (required)<textarea data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <p className="small muted">{modal.kind === 'REOPEN' || modal.kind === 'REOPEN_EMP' ? 'Reopening clears the verified flag and closure timestamps; previous executions and audit are retained.' : 'Recorded in the audit log with your simulated role.'}</p>
        </Modal>
      )}
      {modal && modal.kind === 'SCHEDULE' && d && rb && (
        <Modal title={d.risk === 'HIGH' ? 'Approve high-risk plan & schedule' : 'Approve & schedule'} onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" data-testid="confirm-schedule" disabled={submitting || (d.risk === 'HIGH' && !impactOk) || !schedAt} onClick={() => { const r = run({ type: 'APPROVE', ticketId: t.id, scheduleAt: new Date(schedAt).toISOString(), impactConfirmed: impactOk }); if (r?.ok) setModal(null); }}>Approve &amp; schedule</button></>}>
          <dl className="kv"><dt>Plan</dt><dd>{rb.id} v{rb.version} — {rb.title}</dd><dt>Device</dt><dd>{dev.name}</dd><dt>Risk</dt><dd><RiskBadge risk={d.risk} /> score <ScoreBadge score={d.confidence} /></dd><dt>Impact</dt><dd>{rb.disruptive ? `Disruptive for ~${rb.expectedMin} min; employee consent required before execution` : 'Non-disruptive'}</dd><dt>Rollback</dt><dd>{rb.reversible ? rb.rollbackSteps.join('; ') : rb.recoveryNote}</dd></dl>
          <label className="field">Maintenance window start ({TZ})<input type="datetime-local" data-autofocus value={schedAt} min={toLocalInput(now + MIN)} max={toLocalInput(now + 24 * 60 * MIN)} onChange={(e) => setSchedAt(e.target.value)} /><span className="hint">Between now + 1 minute and now + 24 hours. Approval remains valid until {state.policy.approvalTTLMin} min after the window.</span></label>
          <label className="check"><input type="checkbox" checked={impactOk} onChange={(e) => setImpactOk(e.target.checked)} data-testid="impact-confirm" />I confirm the impact, maintenance window and rollback limits above{d.risk === 'HIGH' ? ' (required for HIGH risk)' : ''}.</label>
        </Modal>
      )}
      {modal && modal.kind === 'MANUAL' && (
        <Modal title="Resolve manually" onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" data-testid="confirm-manual" disabled={submitting || manual.note.trim().length < 5 || manual.evidence.trim().length < 3 || !manual.verified} onClick={() => { const r = run({ type: 'RESOLVE_MANUAL', ticketId: t.id, ...manual }); if (r?.ok) setModal(null); }}>Resolve</button></>}>
          <label className="field">Resolution note (required)<textarea data-autofocus value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} placeholder="What you did to fix it" /></label>
          <label className="field">Verification evidence (required)<input type="text" value={manual.evidence} onChange={(e) => setManual({ ...manual, evidence: e.target.value })} placeholder="e.g. app launched 5 times without crash" /></label>
          <label className="check"><input type="checkbox" checked={manual.verified} onChange={(e) => setManual({ ...manual, verified: e.target.checked })} />I verified the fix with the employee/device (recorded as {role === 'ADMIN' ? 'Morgan' : 'Alex'}, path Manual).</label>
        </Modal>
      )}
    </div>
  );
}
