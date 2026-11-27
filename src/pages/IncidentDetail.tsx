import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Bot, CheckCircle2, ChevronRight, CircleHelp, History, Loader2, MessageSquare, RefreshCw, Search, ShieldCheck, Undo2, Wrench, XCircle } from 'lucide-react';
import { useStore } from '../app/store';
import { ISSUE_LABEL, employeeById } from '../domain/catalog';
import { currentDiagnosis, deviceFieldLabel, gatesFor, latestAppliedExecution, runbookOf } from '../domain/engine';
import { HIST_LABEL, similarIncidents } from '../domain/insights';
import { approvalStatus, productStatus } from '../domain/lifecycle';
import { fmtAge, savedForTicket, fmtMin } from '../domain/metrics';
import { preflight } from '../domain/preflight';
import type { AppState, Ticket } from '../domain/types';
import { ApprovalBadge, ConfidenceBadge, DisabledReason, MethodBadge, Modal, ResultIcon, RiskBadge, SlaBadge, StatusBadge, fmtShort, fmtTime } from '../components/ui';
import { NotFoundPage } from './NotFound';

function rollbackInfo(s: AppState, t: Ticket, now: number) {
  const e = latestAppliedExecution(s, t.id);
  if (!e || !['ROLLBACK_AVAILABLE', 'RESOLVED', 'CLOSED'].includes(t.status) || !['PASSED', 'FAILED'].includes(e.phase)) return { available: false as const, e };
  if (!e.reversible) return { available: false as const, e, reason: `This fix can’t be rolled back — ${runbookOf(s, e)?.recoveryNote}` };
  if (!e.rollbackDeadline || Date.parse(e.rollbackDeadline) <= now) return { available: false as const, e, reason: 'The 30-minute rollback window has passed' };
  return { available: true as const, e };
}
const lines = (x: string) => x.split('\n').map((l) => l.trim()).filter(Boolean);

/** Administrator incident view (V1.2 §8–11): what the employee tried, what AI proposes, and the decision. */
export function IncidentDetailPage() {
  const { id } = useParams();
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const dispatch = useStore((s) => s.dispatch);
  const [modal, setModal] = useState<null | 'approve' | 'reject' | 'investigate' | 'resolve'>(null);
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState('');
  const [res, setRes] = useState({ rootCause: '', steps: '', verification: '', save: false, title: '', pattern: '', questions: '', employeeSteps: '', adminSteps: '', conditions: '', expectedOutcome: '', risks: '', rollback: '' });
  const [busy, setBusy] = useState(false);
  const t = id ? state.tickets[id] : undefined;
  const sim = useMemo(() => (t ? similarIncidents(state, t.id) : undefined), [state, t]);
  if (!t || !sim) return <NotFoundPage />;
  const emp = employeeById(t.employeeId);
  const dev = state.devices[t.deviceId];
  const d = currentDiagnosis(state, t);
  const g = gatesFor(state, t.id, now);
  const rb = g.runbook;
  const ps = productStatus(t);
  const ap = approvalStatus(state, t);
  const ts = t.troubleshooting;
  const exec = state.executions.filter((e) => e.ticketId === t.id).slice(-1)[0];
  const rbInfo = rollbackInfo(state, t, now);
  const audit = state.audit.filter((a) => a.ticketId === t.id).slice().reverse();
  const kn = d?.knowledgeId ? state.knowledge.find((k) => k.id === d.knowledgeId) : undefined;
  const pf = preflight(state, t.id, now, { execution: exec && ['RUNNING', 'VERIFYING'].includes(exec.phase) ? exec : undefined });
  const recommends = !!(rb && d?.recommendable);
  const run = (a: Parameters<typeof dispatch>[0]) => { if (busy) return; setBusy(true); const r = dispatch(a); setTimeout(() => setBusy(false), 200); return r; };
  const canResolve = ['REVIEW_REQUIRED', 'ESCALATED', 'REOPENED'].includes(t.status);
  const canInvestigate = ['REVIEW_REQUIRED', 'REOPENED', 'ROLLBACK_AVAILABLE', 'AWAITING_CONSENT'].includes(t.status) || (t.status === 'ESCALATED' && !t.investigation);
  const openResolve = () => {
    const tried = ts.entries.filter((e) => e.kind === 'STEP' && e.answer === 'COMPLETED').map((e) => e.text);
    setRes({ rootCause: '', steps: '', verification: '', save: !rb, title: t.title, pattern: `${t.title}. ${t.description}`, questions: ts.entries.filter((e) => e.kind === 'QUESTION').map((e) => e.text).slice(0, 2).join('\n'),
      employeeSteps: tried.slice(0, 2).join('\n'), adminSteps: '', conditions: `${dev.os} laptops reporting: ${ISSUE_LABEL[t.issueType]}`, expectedOutcome: 'The issue no longer occurs', risks: 'Minimal', rollback: '' });
    setModal('resolve');
  };

  return (
    <div>
      <section className="detail-head" aria-label="Incident summary">
        <div className="row-between">
          <div className="row"><h1>{t.displayId}</h1><StatusBadge t={t} /><ApprovalBadge status={ap} />{t.status === 'CLOSED' && <MethodBadge path={t.path} />}</div>
          <SlaBadge t={t} now={now} />
        </div>
        <p style={{ marginTop: 6, fontSize: 15 }}><strong>{t.title}</strong> — {t.description}</p>
        <dl className="meta-grid">
          <div><dt>Employee</dt><dd>{emp.name} <span className="small muted">· {emp.department}</span></dd></div>
          <div><dt>Device</dt><dd>{dev.name} <span className="small muted">· {dev.os}</span></dd></div>
          <div><dt>Issue</dt><dd>{ISSUE_LABEL[t.issueType]}</dd></div>
          <div><dt>Created</dt><dd>{fmtShort(t.createdAt)} <span className="small muted">· {fmtAge(now - Date.parse(t.createdAt))} ago</span></dd></div>
          <div><dt>Priority</dt><dd>{t.priority}</dd></div>
          {t.status === 'CLOSED' && <div><dt>Est. admin time saved</dt><dd>{fmtMin(savedForTicket(state, t))}</dd></div>}
        </dl>
      </section>

      <div className="split">
        <div className="stack-16">
          <section className="card stack" aria-label="Employee troubleshooting">
            <h2><MessageSquare size={16} aria-hidden />Employee troubleshooting</h2>
            {ts.entries.length === 0 ? <p className="muted">No guided troubleshooting yet.</p> : <>
              <p className="small">{ts.state === 'RESOLVED' ? 'Resolved by the employee with guided troubleshooting.' : ts.state === 'ESCALATED' ? <>Escalated to IT: <strong>{ts.escalationReason}</strong>. No need to repeat these steps.</> : 'Troubleshooting in progress.'}</p>
              <ol className="history">{ts.entries.map((e, i) => <li key={i}><span className="small muted">{e.kind === 'QUESTION' ? 'Q' : e.kind === 'STEP' ? 'Step' : 'Check'}</span><span>{e.text}</span><span className={`badge ${e.answer === 'RESOLVED' || e.answer === 'COMPLETED' ? 'b-success' : e.answer === 'PERSISTS' || e.answer === 'UNABLE' ? 'b-danger' : 'b-neutral'}`}>{e.answerLabel}</span></li>)}</ol>
            </>}
          </section>

          {!d && (t.status === 'REOPENED' || t.status === 'OPEN') && (
            <section className="card action-card stack" aria-label="Next action" id="action-card">
              <h2><Bot size={16} aria-hidden />AI assessment</h2>
              <p className="small">{t.status === 'REOPENED' ? 'The employee reopened this ticket — the problem came back after self-service. AI has not assessed it yet.' : 'AI has not assessed this incident yet.'}</p>
              <div className="row">
                <button className="btn btn-primary" data-testid="rediagnose" disabled={busy} onClick={() => run({ type: 'RUN_DIAGNOSIS', ticketId: t.id })}><RefreshCw size={14} aria-hidden />Run AI diagnosis</button>
                {canInvestigate && <button className="btn" data-testid="investigate" onClick={() => { setReason(''); setModal('investigate'); }}><Search size={14} aria-hidden />Investigate Manually</button>}
                {canResolve && <button className="btn" data-testid="resolve-manual" onClick={openResolve}><Wrench size={14} aria-hidden />Resolve manually…</button>}
              </div>
            </section>
          )}
          {d && (
            <section className="card action-card stack" aria-label="AI recommendation" id="action-card">
              <div className="row-between"><h2><Bot size={16} aria-hidden />{recommends ? 'AI recommendation' : 'AI assessment'}</h2>
                <span className="row small">Confidence <ConfidenceBadge value={d.confidence} threshold={state.settings.confidenceThreshold} /><span className="muted">threshold {state.settings.confidenceThreshold}% · simulated</span></span></div>
              <dl className="kv">
                <dt>{recommends ? 'Root cause' : 'Suspected cause'}</dt><dd>{d.rootCause}</dd>
                {recommends && rb && <>
                  <dt>Proposed fix</dt><dd><strong>{rb.title}</strong>{kn && <span className="badge b-outline" style={{ marginLeft: 6 }}>From validated resolution {kn.id}</span>}<ol className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{rb.steps.map((s) => <li key={s.id}>{s.description}</li>)}</ol></dd>
                  <dt>Why AI recommends it</dt><dd><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{d.evidence.slice(0, 3).map((x) => <li key={x}>{x}</li>)}{sim.resolvedCount > 0 && <li>{sim.fixed} of {sim.resolvedCount} similar past incidents were fixed through AI-assisted paths</li>}</ul></dd>
                  <dt>Expected duration</dt><dd>~{rb.expectedMin} min</dd>
                  <dt>Employee impact</dt><dd>{rb.employeeImpact}{g.needsConsent ? ' · the employee is asked to agree first' : ''}</dd>
                  <dt>Expected outcome</dt><dd>{rb.expectedOutcome} — verified by: {rb.checks.join('; ')}</dd>
                  <dt>Risk</dt><dd><RiskBadge risk={d.risk} /></dd>
                  <dt>Rollback</dt><dd>{rb.reversible ? <>Available for 30 min: {rb.rollbackSteps.join('; ')}</> : <span className="warn-text"><AlertTriangle size={13} aria-hidden /> Not reversible — {rb.recoveryNote}</span>}</dd>
                </>}
              </dl>
              {!recommends && ps !== 'CLOSED' && <div className="banner warn" style={{ margin: 0 }}><CircleHelp size={16} aria-hidden /><div>{g.reasons[0]}.<ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{d.uncertainty.filter((u) => !u.startsWith('Confidence is simulated')).map((u) => <li key={u}>{u}</li>)}</ul></div></div>}

              {t.status === 'AWAITING_APPROVAL' && (
                <div className="stack decision">
                  <div className="row">
                    <button className="btn btn-primary" data-testid="approve" disabled={busy} onClick={() => { setAck(false); setModal('approve'); }}><CheckCircle2 size={16} aria-hidden />Approve &amp; Execute</button>
                    <button className="btn btn-danger" data-testid="reject" onClick={() => { setReason(''); setModal('reject'); }}><XCircle size={16} aria-hidden />Reject Recommendation</button>
                    <button className="btn" data-testid="investigate" onClick={() => { setReason(''); setModal('investigate'); }}><Search size={16} aria-hidden />Investigate Manually</button>
                  </div>
                  <p className="small muted" style={{ margin: 0 }}>Every AI-executed fix needs your explicit approval — high confidence never bypasses it. Approval applies only to this incident, {dev.name} and this exact fix; if the proposal changes, the approval is invalidated.</p>
                </div>
              )}
              {ps === 'REMEDIATION' && <div className="banner" style={{ margin: 0 }}><Loader2 size={16} className="spin-slow" aria-hidden /><div>{t.status === 'AWAITING_CONSENT' ? 'Approved — waiting for the employee to agree (disruptive fix).' : t.status === 'WAITING_DEVICE' ? g.reasons[0] : 'Approved — AI is executing and will verify the result before closing.'}</div></div>}
              {rbInfo.available && <div className="row"><button className="btn btn-danger-solid" data-testid="rollback" disabled={busy} onClick={() => run({ type: 'ROLLBACK', ticketId: t.id })}><Undo2 size={16} aria-hidden />Roll back</button><span className="small muted">Restores only what this fix changed. A rollback is not a resolution.</span></div>}
              {t.status === 'ROLLBACK_AVAILABLE' && !rbInfo.available && <DisabledReason reason={rbInfo.reason} />}
              <div className="row">
                {(t.status === 'REOPENED' || (ps === 'UNSUPPORTED' && t.status !== 'AWAITING_APPROVAL')) && <button className="btn" data-testid="rediagnose" disabled={busy} onClick={() => run({ type: 'RUN_DIAGNOSIS', ticketId: t.id })}><RefreshCw size={14} aria-hidden />Run AI diagnosis again</button>}
                {canInvestigate && <button className="btn" data-testid="investigate" onClick={() => { setReason(''); setModal('investigate'); }}><Search size={14} aria-hidden />Investigate Manually</button>}
                {canResolve && <button className="btn btn-primary" data-testid="resolve-manual" onClick={openResolve}><Wrench size={14} aria-hidden />Resolve manually…</button>}
              </div>
              {t.investigation && t.status !== 'CLOSED' && <p className="small"><Wrench size={13} aria-hidden /> Manual investigation: {t.investigation.reason} <span className="muted">({t.investigation.by}, {fmtShort(t.investigation.at)})</span></p>}
            </section>
          )}

          {exec && (
            <section className="card stack" aria-label="Execution">
              <div className="row-between"><h2><ShieldCheck size={16} aria-hidden />Execution &amp; verification</h2><span className="small muted">simulated · approved by {exec.approvedBy}</span></div>
              <ol className="history">{runbookOf(state, exec)?.steps.map((s, i) => { const r = exec.results[i]; const stopped = !!r && (r.includes('FAILED') || r.includes('stopped')); const active = !r && exec.phase === 'RUNNING' && exec.stepIndex === i; return <li key={s.id}><span className="small muted">{s.id}</span><span>{s.description}</span><span className={`badge ${r ? (stopped ? 'b-danger' : 'b-success') : active ? 'b-accent' : 'b-outline'}`}>{r ? (stopped ? 'Stopped' : 'Done') : active ? 'Running…' : 'Pending'}</span></li>; })}
                <li><span className="small muted">V</span><span>Verify the expected outcome</span><span className={`badge ${exec.phase === 'VERIFYING' ? 'b-accent' : exec.verificationOutput.length ? (exec.verificationPassed ? 'b-success' : 'b-danger') : 'b-outline'}`} data-testid="verify-state">{exec.phase === 'VERIFYING' ? 'Checking…' : exec.verificationOutput.length ? (exec.verificationPassed ? 'Passed' : 'Failed') : 'Pending'}</span></li></ol>
              {exec.verificationOutput[0] && <div className={`banner ${exec.verificationPassed ? 'success' : 'danger'}`} style={{ margin: 0 }}>{exec.verificationPassed ? <CheckCircle2 size={16} aria-hidden /> : <XCircle size={16} aria-hidden />}<div><strong>{exec.verificationPassed ? 'Verified' : 'Verification failed — the incident stays open'}:</strong> {exec.verificationOutput[0].slice(7)}</div></div>}
              {exec.rollbackResults.length > 0 && <div className="small"><strong>Rollback{exec.rollbackBy ? ` by ${exec.rollbackBy}` : ''}:</strong> {exec.rollbackResults.join(' · ')}</div>}
              <details className="disclosure"><summary>Prerequisites and change log</summary>
                <ul className="clean small" style={{ marginTop: 8 }}>{(exec.preflight.length ? exec.preflight : pf.checks).filter((c) => c.status !== 'NA').map((c) => <li key={c.key}>{c.status === 'PASS' ? <CheckCircle2 size={14} color="var(--success)" aria-hidden /> : <AlertTriangle size={14} color="var(--warning)" aria-hidden />}{c.label}: {c.detail}</li>)}</ul>
                {exec.changes.length > 0 && <table className="data change-table" style={{ marginTop: 8 }}><thead><tr><th>Setting</th><th>Before</th><th>After fix</th><th>Now</th></tr></thead><tbody>{exec.changes.map((c) => <tr key={c.field}><td>{deviceFieldLabel(c.field)}</td><td>{String(c.before)}</td><td>{String(c.after)}</td><td>{String(dev[c.field])}</td></tr>)}</tbody></table>}
              </details>
            </section>
          )}

          {t.resolution && t.status === 'CLOSED' && (
            <section className="card stack" aria-label="Resolution"><h2><CheckCircle2 size={16} aria-hidden />Resolution</h2>
              <dl className="kv"><dt>Root cause</dt><dd>{t.resolution.rootCause}</dd><dt>What fixed it</dt><dd>{t.resolution.steps}</dd><dt>Verification</dt><dd>{t.resolution.verification}</dd><dt>By</dt><dd>{t.resolution.by} · {fmtShort(t.resolution.at)}</dd></dl>
              {state.knowledge.filter((k) => k.sourceTicketId === t.id).map((k) => <p key={k.id} className="small" data-testid="knowledge-status">Reusable resolution <strong>{k.id}</strong> — {k.status === 'VALIDATED' ? 'validated, used by AI for similar incidents' : k.status === 'PENDING_VALIDATION' ? <>waiting for validation · <Link to="/opportunities">Review in Opportunities</Link></> : 'rejected'}</p>)}
            </section>
          )}
        </div>

        <div className="stack-16">
          <section className="card stack" aria-label="Historical incidents"><h2><History size={16} aria-hidden />Similar past incidents</h2>
            {sim.items.length === 0 ? <p className="small muted">No similar incidents on record.</p> : <ul className="clean small">{sim.items.map((x) => <li key={x.ticket.id}><ChevronRight size={14} aria-hidden /><span><Link to={`/incidents/${x.ticket.id}`}>{x.ticket.displayId}</Link> {x.ticket.title} — <span className={x.outcome.startsWith('FAILED') ? 'warn-text' : ''}>{HIST_LABEL[x.outcome]}</span>{x.failReason ? ` (${x.failReason})` : ''}</span></li>)}</ul>}
            {sim.failures.length > 0 && <p className="small warn-text"><AlertTriangle size={13} aria-hidden /> {sim.failures.length} similar AI fix{sim.failures.length > 1 ? 'es' : ''} failed before — check the reason above.</p>}
          </section>
          <section className="card stack" aria-label="Activity"><h2>Activity</h2>
            <ol className="timeline">{audit.slice(0, 8).map((a) => <li key={a.id}><span className={`tdot ${a.result}`} aria-hidden /><div><div className="row" style={{ gap: 6 }}><strong className="small">{a.action.replace(/_/g, ' ').toLowerCase()}</strong><ResultIcon result={a.result} /></div><div className="small">{a.reason}</div><div className="small muted">{fmtTime(a.at)} · {a.actor}</div></div></li>)}</ol>
            {audit.length > 8 && <Link className="small" to={`/audit?q=${t.displayId}`}>All {audit.length} events in Audit Logs →</Link>}
          </section>
        </div>
      </div>

      {modal === 'approve' && rb && d && (
        <Modal title="Approve & execute this fix?" onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" data-testid="confirm-approve" disabled={!ack || busy} onClick={() => { const r = run({ type: 'APPROVE', ticketId: t.id, acknowledged: ack }); if (r?.ok) setModal(null); }}>Approve &amp; Execute</button></>}>
          <dl className="kv">
            <dt>Incident · device</dt><dd>{t.displayId} · {dev.name} ({emp.name})</dd>
            <dt>Action</dt><dd>{rb.title}</dd>
            <dt>Confidence</dt><dd>{d.confidence}% (simulated, threshold {state.settings.confidenceThreshold}%)</dd>
            <dt>Risk &amp; impact</dt><dd><RiskBadge risk={d.risk} /> {rb.employeeImpact}</dd>
            <dt>Employee consent</dt><dd>{g.needsConsent ? 'Required — the employee is asked before it starts' : 'Not needed'}</dd>
            <dt>Rollback</dt><dd>{rb.reversible ? rb.rollbackSteps.join('; ') : <strong className="warn-text">Not reversible — {rb.recoveryNote}</strong>}</dd>
            {sim.failures.length > 0 && <><dt>History</dt><dd className="warn-text">{sim.failures.length} similar AI fix(es) failed before</dd></>}
          </dl>
          <p className="small muted">Prerequisites (laptop online, compatible, battery, consent) are re-checked right before execution — approval never overrides them.</p>
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="ack" />I have reviewed the proposed action and its risks.</label>
        </Modal>
      )}
      {(modal === 'reject' || modal === 'investigate') && (
        <Modal title={modal === 'reject' ? 'Reject recommendation' : 'Investigate manually'} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className={`btn ${modal === 'reject' ? 'btn-danger-solid' : 'btn-primary'}`} data-testid="confirm-decision" disabled={modal === 'reject' && reason.trim().length < 3} onClick={() => { const r = run(modal === 'reject' ? { type: 'REJECT', ticketId: t.id, reason } : { type: 'INVESTIGATE', ticketId: t.id, reason }); if (r?.ok) setModal(null); }}>{modal === 'reject' ? 'Reject' : 'Start investigation'}</button></>}>
          <label className="field">{modal === 'reject' ? 'Reason (required)' : 'Note (optional)'}<textarea data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <p className="small muted">Nothing will be executed. The incident moves to manual investigation with its full history.</p>
        </Modal>
      )}
      {modal === 'resolve' && (
        <Modal title="Resolve manually" wide onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" data-testid="confirm-resolve" disabled={busy || res.rootCause.trim().length < 3 || res.steps.trim().length < 3 || res.verification.trim().length < 3 || (res.save && (!res.title.trim() || !res.pattern.trim() || !(lines(res.employeeSteps).length || lines(res.adminSteps).length)))}
          onClick={() => { const r = run({ type: 'RESOLVE_MANUAL', ticketId: t.id, rootCause: res.rootCause, steps: res.steps, verification: res.verification, knowledge: res.save ? { title: res.title, pattern: res.pattern, diagnosticQuestions: lines(res.questions), conditions: res.conditions, employeeSteps: lines(res.employeeSteps), adminSteps: lines(res.adminSteps), expectedOutcome: res.expectedOutcome, verification: res.verification, risks: res.risks, rollback: res.rollback } : undefined }); if (r?.ok) setModal(null); }}>Resolve{res.save ? ' & save resolution' : ''}</button></>}>
          <div className="grid grid-3">
            <label className="field">Root cause *<textarea data-autofocus value={res.rootCause} onChange={(e) => setRes({ ...res, rootCause: e.target.value })} /></label>
            <label className="field">What you did to fix it *<textarea value={res.steps} onChange={(e) => setRes({ ...res, steps: e.target.value })} /></label>
            <label className="field">How you verified it *<textarea value={res.verification} onChange={(e) => setRes({ ...res, verification: e.target.value })} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={res.save} onChange={(e) => setRes({ ...res, save: e.target.checked })} data-testid="save-knowledge" />Save as reusable resolution (AI uses it for similar incidents once validated)</label>
          {res.save && (
            <div className="grid grid-2 sim-box">
              <label className="field">Title *<input type="text" value={res.title} onChange={(e) => setRes({ ...res, title: e.target.value })} /></label>
              <label className="field">Issue pattern (words that describe it) *<input type="text" value={res.pattern} onChange={(e) => setRes({ ...res, pattern: e.target.value })} data-testid="k-pattern" /></label>
              <label className="field">Diagnostic questions (one per line)<textarea value={res.questions} onChange={(e) => setRes({ ...res, questions: e.target.value })} /></label>
              <label className="field">Applicable conditions<textarea value={res.conditions} onChange={(e) => setRes({ ...res, conditions: e.target.value })} /></label>
              <label className="field">Safe employee steps (one per line)<textarea value={res.employeeSteps} onChange={(e) => setRes({ ...res, employeeSteps: e.target.value })} data-testid="k-employee-steps" /></label>
              <label className="field">Administrator remediation steps (one per line)<textarea value={res.adminSteps} onChange={(e) => setRes({ ...res, adminSteps: e.target.value })} data-testid="k-admin-steps" /></label>
              <label className="field">Expected outcome<input type="text" value={res.expectedOutcome} onChange={(e) => setRes({ ...res, expectedOutcome: e.target.value })} /></label>
              <label className="field">Relevant risks<input type="text" value={res.risks} onChange={(e) => setRes({ ...res, risks: e.target.value })} /></label>
              <label className="field">Rollback instructions (if any)<input type="text" value={res.rollback} onChange={(e) => setRes({ ...res, rollback: e.target.value })} /></label>
              <p className="small muted" style={{ gridColumn: '1 / -1', margin: 0 }}>Verification criteria = “How you verified it”. Saved resolutions are not used until an administrator validates them.</p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
