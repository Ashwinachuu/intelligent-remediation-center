import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Inbox } from 'lucide-react';
import { useStore } from '../app/store';
import { currentDiagnosis, planRunbook } from '../domain/engine';
import { approvalStatus } from '../domain/lifecycle';
import { fmtAge } from '../domain/metrics';
import { ApprovalBadge, ConfidenceBadge, Empty, RiskBadge, fmtShort } from '../components/ui';
import { ms } from '../domain/util';

/**
 * Approvals (V1.2 §15). Decisions are made on the incident page, where the proposed action, evidence and
 * risks are always visible — so nobody approves from a list without seeing what they approve.
 */
export function ApprovalsPage() {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const nav = useNavigate();
  const pending = useMemo(() => Object.values(state.tickets).filter((t) => t.status === 'AWAITING_APPROVAL').sort((a, b) => ms(currentDiagnosis(state, a)!.createdAt) - ms(currentDiagnosis(state, b)!.createdAt)), [state]);
  const recent = useMemo(() => state.approvals.slice().reverse().slice(0, 12), [state.approvals]);
  return (
    <div>
      <div className="page-head"><div><h1>Approvals</h1><p>AI-proposed fixes waiting for your decision, oldest first. Open an incident to review the evidence and risks, then approve or reject.</p></div></div>
      <h2>Waiting for a decision ({pending.length})</h2>
      {pending.length === 0 ? <div className="card"><Empty title="No fixes are waiting for approval" icon={<Inbox size={28} aria-hidden />} /></div> : (
        <div className="table-wrap"><table className="data" data-testid="approval-queue">
          <thead><tr><th>Incident</th><th>Employee</th><th>Proposed remediation</th><th>AI confidence</th><th>Expected impact</th><th>Waiting</th><th>Status</th><th /></tr></thead>
          <tbody>{pending.map((t) => { const d = currentDiagnosis(state, t)!; const rb = planRunbook(state, d); return (
            <tr key={t.id} className="clickable" onClick={() => nav(`/incidents/${t.id}`)}>
              <td><Link to={`/incidents/${t.id}`} onClick={(e) => e.stopPropagation()}><strong>{t.displayId}</strong></Link><div>{t.title}</div></td>
              <td>{t.requester}</td>
              <td>{rb?.title}<div><RiskBadge risk={d.risk} /></div></td>
              <td><ConfidenceBadge value={d.confidence} threshold={state.settings.confidenceThreshold} /></td>
              <td className="small">{rb?.employeeImpact}{rb?.reversible ? '' : ' · not reversible'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtAge(now - ms(d.createdAt))}</td>
              <td><ApprovalBadge status="PENDING" /></td>
              <td><Link className="btn btn-sm" to={`/incidents/${t.id}`} onClick={(e) => e.stopPropagation()}>Review<ArrowRight size={14} aria-hidden /></Link></td>
            </tr>); })}</tbody>
        </table></div>
      )}
      <h2 style={{ marginTop: 24 }}>Recent decisions</h2>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Incident</th><th>Decision</th><th>By</th><th>When</th><th>Now</th></tr></thead>
        <tbody>{recent.map((a) => { const t = state.tickets[a.ticketId]; return (
          <tr key={a.id}><td><Link to={`/incidents/${a.ticketId}`}>{t?.displayId}</Link> <span className="small muted">{t?.title}</span></td>
            <td>{a.decision === 'APPROVE' ? (a.invalidatedAt ? `Approved — invalidated (${a.invalidReason})` : a.expiredLoggedAt ? 'Approved — expired before it ran' : 'Approved') : `Rejected — ${a.reason}`}</td>
            <td>{a.actor}</td><td>{fmtShort(a.at)}</td><td>{t && <ApprovalBadge status={approvalStatus(state, t)} />}</td></tr>); })}</tbody>
      </table>{recent.length === 0 && <Empty title="No decisions yet" />}</div>
    </div>
  );
}
