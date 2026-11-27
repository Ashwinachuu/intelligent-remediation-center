import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookCheck, Lightbulb } from 'lucide-react';
import { useStore } from '../app/store';
import { ISSUE_LABEL } from '../domain/catalog';
import { opportunities } from '../domain/insights';
import { fmtMin } from '../domain/metrics';
import type { Knowledge } from '../domain/types';
import { Empty, Modal, fmtShort } from '../components/ui';

const K_STATUS: Record<Knowledge['status'], { cls: string; label: string }> = { VALIDATED: { cls: 'b-success', label: 'Validated — used by AI' }, PENDING_VALIDATION: { cls: 'b-warning', label: 'Waiting for validation' }, REJECTED: { cls: 'b-outline', label: 'Rejected' } };

/** Opportunities & continuous learning (V1.2 §16): where AI can't help yet, and turning human fixes into knowledge. */
export function OpportunitiesPage() {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const dispatch = useStore((s) => s.dispatch);
  const ops = useMemo(() => opportunities(state, now), [state, now]);
  const maxEffort = Math.max(1, ...ops.map((o) => o.effortMin));
  const unsupportedTotal = ops.reduce((a, o) => a + o.tickets.length, 0);
  const [review, setReview] = useState<Knowledge | null>(null);
  const [reason, setReason] = useState('');
  return (
    <div>
      <div className="page-head"><div><h1>Opportunities</h1><p>Where teaching AI saves the most admin time, and the validated human fixes that teach it. Nothing is learned or executed until an administrator validates it.</p></div></div>
      <h2><Lightbulb size={16} aria-hidden /> What to teach AI first</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Incidents AI couldn’t help with (the same {unsupportedTotal} counted in the Overview’s unsupported rate), grouped by issue and ranked by <strong>manual handling effort = how often it happens × admin minutes each time</strong>. Teaching AI one of these means: resolve an incident manually, save the fix as a reusable resolution, then validate it.</p>
      {ops.length === 0 ? <div className="card"><Empty title="No unsupported incidents" /></div> : (
        <div className="table-wrap"><table className="data" data-testid="opportunities">
          <thead><tr><th>Priority</th><th>Issue</th><th className="num">Incidents</th><th className="num">Manual effort</th><th className="num">Saving once taught</th><th>Knowledge</th><th>Next step</th></tr></thead>
          <tbody>{ops.map((o) => (
            <tr key={o.key} data-testid={`opp-${o.key}`}>
              <td><span className={`rank${o.covered ? ' done' : ''}`}>{o.rank}</span></td>
              <td><strong>{ISSUE_LABEL[o.key]}</strong><div className="small">{o.tickets.slice(0, 3).map((t, i) => <span key={t.id}>{i ? ', ' : ''}<Link to={`/incidents/${t.id}`}>{t.displayId}</Link></span>)} <span className="muted">· e.g. “{o.tickets[0].title}”</span></div></td>
              <td className="num"><Link to={`/incidents?metric=everUnsupported&issue=${o.key}`}>{o.tickets.length}</Link><div className="small muted">{o.open} open · {o.last7} in last 7 days</div></td>
              <td className="num"><strong>{fmtMin(o.effortMin)}</strong><div className="small muted">{o.tickets.length} × ~{o.avgMin} min</div><span className="effort-bar" style={{ width: `${Math.max(8, (o.effortMin / maxEffort) * 100)}%`, opacity: o.covered ? 0.35 : 1 }} aria-hidden /></td>
              <td className="num">{o.covered ? <span className="muted">—</span> : <>~{fmtMin(o.savingPerIncident)}<div className="small muted">per future incident</div></>}</td>
              <td className="small">{o.knowledge.length ? o.knowledge.map((k) => <div key={k.id}><span className={`badge ${K_STATUS[k.status as Knowledge['status']].cls}`}>{k.id}</span> {K_STATUS[k.status as Knowledge['status']].label}</div>) : <span className="muted">None yet</span>}</td>
              <td className="small">{o.next.knowledgeId ? <button className="btn btn-sm btn-primary" onClick={() => { setReason(''); setReview(state.knowledge.find((k) => k.id === o.next.knowledgeId) ?? null); }}>{o.next.text}</button> : o.next.ticketId ? <Link className="btn btn-sm" to={`/incidents/${o.next.ticketId}`}>{o.next.text}</Link> : <span className="muted">{o.next.text}</span>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <p className="small muted">Manual effort = admin minutes actually spent on resolved incidents + the manual baseline for open ones (estimates; baselines are in AI Settings). Saving once taught = baseline − {state.settings.reviewEffortMin} min admin review, because a taught fix still needs approval.</p>
      <h2 style={{ marginTop: 24 }}><BookCheck size={16} aria-hidden /> Reusable resolutions</h2>
      <div className="table-wrap"><table className="data" data-testid="knowledge">
        <thead><tr><th>ID</th><th>Title</th><th>From incident</th><th>Status</th><th>Created</th><th /></tr></thead>
        <tbody>{state.knowledge.slice().reverse().map((k) => (
          <tr key={k.id}><td><strong>{k.id}</strong></td><td>{k.title}<div className="small muted">{k.pattern}</div></td><td><Link to={`/incidents/${k.sourceTicketId}`}>{state.tickets[k.sourceTicketId]?.displayId}</Link></td>
            <td><span className={`badge ${K_STATUS[k.status].cls}`}>{K_STATUS[k.status].label}</span>{k.validatedBy && <div className="small muted">by {k.validatedBy}, {fmtShort(k.validatedAt)}</div>}</td><td>{fmtShort(k.createdAt)} · {k.createdBy}</td>
            <td><button className="btn btn-sm" data-testid={`review-${k.id}`} onClick={() => { setReason(''); setReview(k); }}>{k.status === 'PENDING_VALIDATION' ? 'Review & validate' : 'View'}</button></td></tr>))}</tbody>
      </table>{state.knowledge.length === 0 && <Empty title="No reusable resolutions yet — save one when you resolve an incident manually" />}</div>

      {review && (
        <Modal title={`${review.id} · ${review.title}`} wide onClose={() => setReview(null)} footer={review.status === 'PENDING_VALIDATION' ? <>
          <input type="text" aria-label="Rejection reason" placeholder="Reason (to reject)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ maxWidth: 260 }} />
          <button className="btn btn-danger" disabled={reason.trim().length < 3} onClick={() => { const r = dispatch({ type: 'REJECT_KNOWLEDGE', knowledgeId: review.id, reason }); if (r.ok) setReview(null); }}>Reject</button>
          <button className="btn btn-primary" data-testid="validate-knowledge" onClick={() => { const r = dispatch({ type: 'VALIDATE_KNOWLEDGE', knowledgeId: review.id }); if (r.ok) setReview(null); }}>Validate — make available to AI</button></> : <button className="btn" onClick={() => setReview(null)}>Close</button>}>
          <dl className="kv">
            <dt>Issue pattern</dt><dd>{review.pattern}</dd>
            <dt>Applies when</dt><dd>{review.conditions}</dd>
            <dt>Diagnostic questions</dt><dd>{review.diagnosticQuestions.join(' · ') || '—'}</dd>
            <dt>Safe employee steps</dt><dd>{review.employeeSteps.length ? <ol style={{ margin: 0, paddingLeft: 18 }}>{review.employeeSteps.map((s) => <li key={s}>{s}</li>)}</ol> : '—'}</dd>
            <dt>Admin remediation steps</dt><dd>{review.adminSteps.length ? <ol style={{ margin: 0, paddingLeft: 18 }}>{review.adminSteps.map((s) => <li key={s}>{s}</li>)}</ol> : '—'}</dd>
            <dt>Expected outcome</dt><dd>{review.expectedOutcome}</dd>
            <dt>Verification</dt><dd>{review.verification}</dd>
            <dt>Risks</dt><dd>{review.risks}</dd>
            <dt>Rollback</dt><dd>{review.rollback || 'None'}</dd>
          </dl>
          {review.status === 'PENDING_VALIDATION' && <p className="small muted">Once validated, similar new incidents get these employee steps in guided troubleshooting, and the admin steps become an AI recommendation — still requiring approval like any other fix.</p>}
        </Modal>
      )}
    </div>
  );
}
