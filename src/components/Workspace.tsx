import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, ArrowRight, CheckCircle2, Hand, Hourglass, Network, Search, Timer } from 'lucide-react';
import { useStore } from '../app/store';
import { actionQueue, detectClusters, workspaceCounts } from '../domain/insights';
import { localDateKey } from '../domain/util';
import { queueSnapshot } from '../domain/metrics';
import { RiskBadge, StatusBadge } from './ui';
import { SlaBadge } from './Insights';
import { currentDiagnosis } from '../domain/engine';

/** Action-oriented agent workspace (enhancement §1). Current snapshot, independent of the dashboard date filter. */
export function Workspace() {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const role = state.settings.role;
  const [all, setAll] = useState(false);
  const c = useMemo(() => workspaceCounts(state, now, role), [state, now, role]);
  const queue = useMemo(() => actionQueue(state, now, role), [state, now, role]);
  const clusters = useMemo(() => detectClusters(state), [state]);
  const q = useMemo(() => queueSnapshot(state, now), [state, now]);
  const today = localDateKey(now);
  const active = queue.filter((q) => !q.aged);
  const aged = queue.length - active.length;
  const shown = active.slice(0, all ? 25 : 8);
  const tiles = [
    { label: 'Awaiting my approval', n: c.myApprovals === null ? '—' : String(c.myApprovals), sub: c.myApprovals === null ? 'Manager view is read-only' : role === 'ADMIN' ? 'All risks incl. HIGH & step approvals' : 'LOW/MEDIUM plans & steps you can approve', to: '/approvals', Icon: Hand, tone: c.myApprovals ? 'warn' : '' },
    { label: 'AI remediation in progress', n: String(c.inProgress), sub: 'Ready, scheduled, executing, verifying', to: '/incidents?metric=inProgress', Icon: Hourglass, tone: '' },
    { label: 'Human investigation required', n: String(c.investigation), sub: 'Review, escalated, rollback available', to: '/incidents?metric=investigation', Icon: Search, tone: c.investigation ? 'warn' : '' },
    { label: 'SLA breached', n: String(c.breached), sub: `${c.atRisk} approaching breach (≤ 1h or 25% of window left)`, to: c.atRisk ? '/incidents?metric=sla_at_risk' : '/incidents?metric=sla_breached', Icon: AlarmClock, tone: c.breached || c.atRisk ? 'bad' : '' },
    { label: 'Verified resolutions today', n: String(c.verifiedToday), sub: 'Resolved/closed today with verification', to: `/incidents?metric=verifiedAny&basis=resolved&from=${today}&to=${today}`, Icon: CheckCircle2, tone: 'ok' },
    { label: 'Est. agent time saved today', n: `${(c.savedTodayMin / 60).toFixed(1)} h`, sub: 'Estimate: baseline − modeled agent minutes', to: `/incidents?metric=aiVerified&basis=resolved&from=${today}&to=${today}`, Icon: Timer, tone: '' },
  ];
  return (
    <section className="workspace" aria-labelledby="h-ws">
      <div className="row-between"><h2 id="h-ws" style={{ margin: 0 }}>My workspace</h2><span className="small muted">Current snapshot · independent of the date filter · role {role.toLowerCase()}</span></div>
      <div className="ws-tiles" data-testid="workspace-tiles">
        {tiles.map((t) => <Link key={t.label} to={t.to} className={`ws-tile tone-${t.tone}`}><t.Icon size={18} aria-hidden /><div><div className="ws-n">{t.n}</div><div className="ws-l">{t.label}</div><div className="ws-s">{t.sub}</div></div></Link>)}
      </div>
      <nav className="queue-chips" aria-label="Operational queue snapshot">
        <span className="small muted">Queue:</span>
        <Link to="/approvals">{q.pending} pending approvals</Link>
        <Link to="/approvals" className={q.overdue ? 'warn' : ''}>{q.overdue} overdue (&gt; {state.policy.approvalTTLMin} min)</Link>
        <Link to="/approvals?tab=consent">{q.consent} awaiting consent</Link>
        <Link to="/approvals?tab=steps">{Object.values(state.tickets).filter((t) => t.status === 'STEP_APPROVAL').length} step approvals</Link>
        <Link to="/incidents?status=ROLLBACK_AVAILABLE" className={q.rollback ? 'bad' : ''}>{q.rollback} rollback attention</Link>
        <Link to="/incidents?status=WAITING_DEVICE">{q.waiting} waiting for device</Link>
      </nav>
      {clusters.map((cl) => (
        <Link key={cl.key} to={`/incidents/${cl.tickets[0].id}?focus=action`} className="banner warn ws-cluster" data-testid="cluster-banner"><Network size={18} aria-hidden /><div className="grow"><strong>Potential shared incident:</strong> {cl.tickets.length} {cl.category === 'WIFI' ? 'Wi-Fi' : cl.category} reports on {cl.networkId} ({cl.location}) within {cl.spanMin} min — review evidence and link</div><ArrowRight size={16} aria-hidden /></Link>
      ))}
      <div className="card" style={{ padding: 0 }}>
        <div className="row-between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><h3 style={{ margin: 0 }}>Prioritized action queue</h3><span className="small muted">Ranked by severity, SLA urgency, business impact, risk and required human action</span></div>
        {active.length === 0 ? <p className="muted" style={{ padding: 16 }}>Nothing recent needs human action right now.</p> : (
          <ol className="aq" data-testid="action-queue">
            {shown.map((q, i) => { const d = currentDiagnosis(state, q.ticket); return (
              <li key={q.ticket.id}>
                <Link to={q.href} className="aq-row">
                  <span className="aq-rank">{i + 1}</span>
                  <span className="aq-main"><span className="aq-title"><strong>{q.ticket.displayId}</strong> {q.ticket.title}</span><span className="aq-why small muted" title={q.factors.join(' · ')}>{q.factors.slice(0, 4).join(' · ')}</span></span>
                  <span className="aq-tags"><StatusBadge status={q.ticket.status} />{d && <RiskBadge risk={d.risk} />}<SlaBadge t={q.ticket} now={now} /></span>
                  <span className="aq-action">{q.action}<ArrowRight size={14} aria-hidden /></span>
                </Link>
              </li>); })}
          </ol>
        )}
        <div className="row-between" style={{ padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
          {active.length > 8 ? <button className="btn-link" onClick={() => setAll((x) => !x)}>{all ? 'Show top 8' : `Show more (${Math.min(25, active.length)} of ${active.length})`}</button> : <span />}
          {aged > 0 && <Link className="small" to="/incidents?metric=sla_breached&sort=age&dir=desc">{aged} aged backlog item{aged === 1 ? '' : 's'} (created &gt; 7 days ago) — review in worklist</Link>}
        </div>
      </div>
    </section>
  );
}
