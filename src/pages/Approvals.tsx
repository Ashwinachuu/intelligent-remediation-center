import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, ChevronUp, CircleHelp, ExternalLink, Inbox } from 'lucide-react';
import { useStore } from '../app/store';
import { CATEGORY_LABEL } from '../domain/catalog';
import { currentDiagnosis, gatesFor, planRunbook } from '../domain/engine';
import { canRoleApprove } from '../domain/policy';
import { fmtAge } from '../domain/metrics';
import type { Risk, Ticket } from '../domain/types';
import { ms } from '../domain/util';
import { DisabledReason, Empty, Modal, RiskBadge, ScoreBadge, StatusBadge, fmtShort } from '../components/ui';

const RISK_RANK: Record<Risk, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function ApprovalCard({ t }: { t: Ticket }) {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const dispatch = useStore((s) => s.dispatch);
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | 'REJECT' | 'REQUEST_REVIEW'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const d = currentDiagnosis(state, t)!;
  const rb = planRunbook(state, d);
  const g = gatesFor(state, t.id, now);
  const hyp = gatesFor(state, t.id, now, { approvalValid: true });
  const role = state.settings.role;
  const perm = canRoleApprove(role, d.risk);
  const waited = now - ms(d.createdAt);
  const overdue = waited > state.policy.approvalTTLMin * 60_000;
  const disabled = !perm.ok ? perm.reason : !open ? 'Expand and review the complete evidence to enable approval' : d.risk === 'HIGH' ? 'HIGH risk requires a maintenance window — approve from the ticket to schedule' : null;
  const label = hyp.route === 'AWAITING_CONSENT' ? 'Approve & request consent' : 'Approve & execute';
  return (
    <article className={`approval-card ${d.risk}`} aria-label={`${t.displayId} approval`}>
      <div className="row-between">
        <div className="row"><Link to={`/incidents/${t.id}`}><strong>{t.displayId}</strong></Link><span>{t.title}</span>{t.demo && <span className="badge b-accent">Demo</span>}</div>
        <div className="row"><ScoreBadge score={d.confidence} /><RiskBadge risk={d.risk} /></div>
      </div>
      <div className="row small muted">
        <span>{CATEGORY_LABEL[d.category]}</span>·<span>{state.devices[t.deviceId].name}</span>·<span>{rb ? `${rb.id} v${rb.version} · ~${rb.expectedMin} min` : 'no runbook'}</span>·<span>Required approver: <strong>{g.requiredRole === 'ADMIN' ? 'Admin' : 'Agent or Admin'}</strong></span>·<span className={overdue ? 'delta-down' : ''}>Waiting {fmtAge(waited)}{overdue ? ' (overdue)' : ''}</span>
      </div>
      <p className="small" style={{ margin: 0 }}>{g.reasons[0]}</p>
      <button className="btn-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}{open ? 'Hide evidence' : 'Review complete evidence'}</button>
      {open && (
        <div className="grid grid-2">
          <div><h3>Evidence</h3><ul className="clean small">{d.evidence.map((x, i) => <li key={i}><CheckCircle2 size={14} color="var(--success)" aria-hidden />{x}</li>)}</ul>
            <h3 style={{ marginTop: 8 }}>Uncertainty</h3><ul className="clean small">{d.uncertainty.map((x, i) => <li key={i}><CircleHelp size={14} color="var(--warning)" aria-hidden />{x}</li>)}</ul></div>
          {rb && <dl className="kv"><dt>Steps</dt><dd>{rb.steps.join(' → ')}</dd><dt>Prerequisites</dt><dd>{rb.prerequisites.join(' · ')}</dd><dt>Checks</dt><dd>{rb.checks.join(' · ')}</dd><dt>Rollback</dt><dd>{rb.reversible ? rb.rollbackSteps.join('; ') : `Not available — ${rb.recoveryNote}`}</dd><dt>Impact</dt><dd>{rb.disruptive ? 'Disruptive — employee consent required' : 'Non-disruptive'}</dd><dt>Plan / policy</dt><dd className="mono">{d.planHash.slice(0, 12)} · policy v{d.policyVersion} · rev {d.revision}</dd></dl>}
        </div>
      )}
      <div className="row">
        {d.risk === 'HIGH' ? <Link className="btn btn-primary" to={`/incidents/${t.id}`}><ExternalLink size={14} aria-hidden />Open to approve &amp; schedule</Link>
          : <button className="btn btn-primary" disabled={!!disabled || busy || role === 'MANAGER'} onClick={() => { setBusy(true); dispatch({ type: 'APPROVE', ticketId: t.id }); }}>{label}</button>}
        <button className="btn" disabled={role === 'MANAGER'} onClick={() => { setReason(''); setModal('REQUEST_REVIEW'); }}>Request review</button>
        <button className="btn btn-danger" disabled={role === 'MANAGER'} onClick={() => { setReason(''); setModal('REJECT'); }}>Reject</button>
      </div>
      <DisabledReason reason={role === 'MANAGER' ? 'Manager role is read-only' : d.risk === 'HIGH' && role !== 'ADMIN' ? perm.reason : disabled && d.risk !== 'HIGH' ? disabled : null} />
      {modal && (
        <Modal title={modal === 'REJECT' ? `Reject ${t.displayId}` : `Request review for ${t.displayId}`} onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={reason.trim().length < 3} onClick={() => { const r = dispatch({ type: modal, ticketId: t.id, reason }); if (r.ok) setModal(null); }}>Confirm</button></>}>
          <label className="field">Reason (required)<textarea data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </Modal>
      )}
    </article>
  );
}

export function ApprovalsPage() {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const [p, setP] = useSearchParams();
  const tab = p.get('tab') ?? 'queue';
  const queue = useMemo(() => Object.values(state.tickets).filter((t) => t.status === 'AWAITING_APPROVAL').sort((a, b) => {
    const da = currentDiagnosis(state, a)!, db = currentDiagnosis(state, b)!;
    return RISK_RANK[da.risk] - RISK_RANK[db.risk] || ms(da.createdAt) - ms(db.createdAt);
  }), [state]);
  const consent = Object.values(state.tickets).filter((t) => t.status === 'AWAITING_CONSENT');
  const expired = state.approvals.filter((a) => a.expiredLoggedAt || a.invalidatedAt).slice().reverse();
  return (
    <div>
      <div className="page-head"><div><h1>Approvals</h1><p>Highest risk first, then oldest. No bulk approval — each plan is approved individually against its evidence.</p></div></div>
      <div className="tabs" role="tablist">
        {[['queue', `Approval queue (${queue.length})`], ['consent', `Awaiting consent (${consent.length})`], ['expired', `Expired / invalidated (${expired.length})`]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setP({ tab: k }, { replace: true })}>{l}</button>)}
      </div>
      {tab === 'queue' && (queue.length ? <div className="stack-16">{queue.map((t) => <ApprovalCard key={t.id} t={t} />)}</div> : <div className="card"><Empty title="No plans awaiting approval" icon={<Inbox size={28} aria-hidden />} /></div>)}
      {tab === 'consent' && (
        <div className="table-wrap"><table className="data"><thead><tr><th>Ticket</th><th>Requester</th><th>Approved by</th><th>Waiting since</th><th>Status</th></tr></thead><tbody>
          {consent.map((t) => { const a = state.approvals.filter((x) => x.ticketId === t.id && x.decision === 'APPROVE').slice(-1)[0]; return <tr key={t.id}><td><Link to={`/incidents/${t.id}`}>{t.displayId}</Link> {t.title}</td><td>{t.requester}</td><td>{a ? `${a.actor} · ${fmtShort(a.at)} (expires ${fmtShort(a.expiresAt)})` : '—'}</td><td>{fmtAge(now - ms(t.updatedAt))}</td><td><StatusBadge status={t.status} /></td></tr>; })}
        </tbody></table>{!consent.length && <Empty title="No consent requests pending" />}</div>
      )}
      {tab === 'expired' && (
        <div className="table-wrap"><table className="data"><thead><tr><th>Ticket</th><th>Approver</th><th>Approved</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>
          {expired.map((a) => <tr key={a.id}><td><Link to={`/incidents/${a.ticketId}`}>{state.tickets[a.ticketId]?.displayId}</Link></td><td>{a.actor} ({a.role})</td><td>{fmtShort(a.at)}</td><td>{a.invalidatedAt ? 'Invalidated' : 'Expired'}</td><td>{a.invalidReason ?? `Not started before ${fmtShort(a.expiresAt)} (TTL ${state.policy.approvalTTLMin} min)`}</td></tr>)}
        </tbody></table>{!expired.length && <Empty title="No expired or invalidated approvals" />}</div>
      )}
    </div>
  );
}
