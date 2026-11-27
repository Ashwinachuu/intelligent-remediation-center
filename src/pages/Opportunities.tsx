import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookCheck, Lightbulb } from 'lucide-react';
import { useStore } from '../app/store';
import { ISSUE_LABEL } from '../domain/catalog';
import { opportunities } from '../domain/insights';
import { fmtMin } from '../domain/metrics';
import type { IssueType, Knowledge } from '../domain/types';
import { Empty, Modal, fmtShort } from '../components/ui';

const K_STATUS: Record<Knowledge['status'], { cls: string; label: string }> = { VALIDATED: { cls: 'b-success', label: 'Validated — used by AI' }, PENDING_VALIDATION: { cls: 'b-warning', label: 'Waiting for validation' }, REJECTED: { cls: 'b-outline', label: 'Rejected' } };

/** Opportunities & continuous learning (V1.2 §16): where AI can't help yet, and turning human fixes into knowledge. */
export function OpportunitiesPage() {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const dispatch = useStore((s) => s.dispatch);
  const ops = useMemo(() => opportunities(state, now), [state, now]);
  const [review, setReview] = useState<Knowledge | null>(null);
  const [reason, setReason] = useState('');
  return (
    <div>
      <div className="page-head"><div><h1>Opportunities</h1><p>Recurring incidents AI couldn’t resolve, and the validated human fixes that teach it. Nothing is learned or executed until an administrator validates it.</p></div></div>
      <h2><Lightbulb size={16} aria-hidden /> Where AI can’t help yet</h2>
      {ops.length === 0 ? <div className="card"><Empty title="No unsupported incidents" /></div> : (
        <div className="table-wrap"><table className="data" data-testid="opportunities">
          <thead><tr><th>Issue category</th><th className="num">Occurrences</th><th>Related incidents</th><th>Frequency</th><th className="num">Est. admin effort</th><th>Knowledge</th><th>Recommended next action</th></tr></thead>
          <tbody>{ops.map((o) => (
            <tr key={o.key}>
              <td><strong>{ISSUE_LABEL[o.key as IssueType]}</strong></td>
              <td className="num"><Link to={`/incidents?metric=everUnsupported&issue=${o.key}`}>{o.tickets.length}</Link>{o.open ? <div className="small muted">{o.open} open</div> : null}</td>
              <td className="small">{o.tickets.slice(0, 3).map((t) => <div key={t.id}><Link to={`/incidents/${t.id}`}>{t.displayId}</Link> {t.title}</div>)}</td>
              <td className="small">{o.last7} in last 7 days{o.prior ? ` · ${o.prior} earlier` : ''}</td>
              <td className="num">{fmtMin(o.effortMin)}</td>
              <td className="small">{o.knowledge.length ? o.knowledge.map((k) => <div key={k.id}><span className={`badge ${K_STATUS[k.status as Knowledge['status']].cls}`}>{k.id}</span> {K_STATUS[k.status as Knowledge['status']].label}</div>) : <span className="muted">None yet</span>}</td>
              <td className="small">{o.next.knowledgeId ? <button className="btn btn-sm btn-primary" onClick={() => { setReason(''); setReview(state.knowledge.find((k) => k.id === o.next.knowledgeId) ?? null); }}>{o.next.text}</button> : o.next.ticketId ? <Link className="btn btn-sm" to={`/incidents/${o.next.ticketId}`}>{o.next.text}</Link> : o.next.text}</td>
            </tr>))}</tbody>
        </table></div>
      )}
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
