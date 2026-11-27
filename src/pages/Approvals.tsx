import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Inbox } from 'lucide-react';
import { useStore } from '../app/store';
import { currentDiagnosis, planRunbook } from '../domain/engine';
import { approvalStatus } from '../domain/lifecycle';
import { fixTrackRecord } from '../domain/insights';
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
          <thead><tr><th>Proposed fix</th><th>Diagnosis confidence</th><th>Fix track record</th><th>Risk &amp; rollback</th><th>Employee impact</th><th>Waiting</th><th /></tr></thead>
          <tbody>{pending.map((t) => { const d = currentDiagnosis(state, t)!; const rb = planRunbook(state, d); const tr = fixTrackRecord(state, rb?.id, t.id); return (
            <tr key={t.id} className="clickable" onClick={() => nav(`/incidents/${t.id}`)}>
              <td><strong>{rb?.title}</strong><div className="small"><Link to={`/incidents/${t.id}`} onClick={(e) => e.stopPropagation()}>{t.displayId}</Link> {t.title} · {t.requester}</div></td>
              <td><ConfidenceBadge value={d.confidence} threshold={state.settings.confidenceThreshold} /><div className="small muted">that the cause is right</div></td>
              <td>{tr.finished ? <><strong>{tr.verified} of {tr.finished}</strong> verified{tr.failed ? <div className="small warn-text">{tr.failed} failed before</div> : null}</> : <span className="muted">First use</span>}</td>
              <td><RiskBadge risk={d.risk} /><div className="small muted">{rb?.reversible ? 'Rollback available' : 'Not reversible'}</div></td>
              <td className="small">{rb?.employeeImpact}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtAge(now - ms(d.createdAt))}</td>
              <td><Link className="btn btn-sm btn-primary" to={`/incidents/${t.id}`} onClick={(e) => e.stopPropagation()}>Review &amp; decide<ArrowRight size={14} aria-hidden /></Link></td>
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
