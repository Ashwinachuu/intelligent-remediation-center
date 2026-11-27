import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Hand, Loader2, Search, Timer } from 'lucide-react';
import { useStore } from '../app/store';
import { actionQueue, workspaceCounts, type QueueFilter } from '../domain/insights';
import { fmtMin, savedForTicket } from '../domain/metrics';
import { localDateKey } from '../domain/util';
import { ConfidenceBadge, Empty, SlaBadge, StatusBadge } from '../components/ui';
import { currentDiagnosis } from '../domain/engine';

const FILTERS: { key: QueueFilter; label: string }[] = [
  { key: 'ALL', label: 'All action required' }, { key: 'PENDING', label: 'Pending approval' }, { key: 'INVESTIGATION', label: 'Human investigation' }, { key: 'OVERDUE', label: 'Overdue' },
];

/** Admin My Workspace (V1.2 §13): what needs me now, ranked and explained. */
export function WorkspacePage() {
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const [p, setP] = useSearchParams();
  const filter = (p.get('q') as QueueFilter) || 'ALL';
  const c = useMemo(() => workspaceCounts(state, now), [state, now]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, actionQueue(state, now, f.key).length])) as Record<QueueFilter, number>, [state, now]);
  const queue = useMemo(() => actionQueue(state, now, filter), [state, now, filter]);
  const today = localDateKey(now);
  const savedToday = c.closedToday.reduce((a, t) => a + savedForTicket(state, t), 0);
  const tiles = [
    { label: 'Awaiting my approval', n: String(c.awaitingApproval), to: '/incidents?metric=pendingApproval', Icon: Hand, tone: c.awaitingApproval ? 'warn' : '' },
    { label: 'AI remediation in progress', n: String(c.inProgress), to: '/incidents?metric=inProgress', Icon: Loader2, tone: '' },
    { label: 'Human investigation required', n: String(c.investigation), to: '/incidents?metric=humanInvestigation', Icon: Search, tone: c.investigation ? 'warn' : '' },
    { label: 'Verified resolutions today', n: String(c.verifiedToday), to: `/incidents?metric=closedVerified&basis=closed&from=${today}&to=${today}`, Icon: CheckCircle2, tone: 'ok' },
    { label: 'Est. admin time saved today', n: fmtMin(savedToday), to: `/incidents?metric=closedVerified&basis=closed&from=${today}&to=${today}`, Icon: Timer, tone: '', title: 'Sum over incidents closed today of (manual handling baseline − admin minutes actually spent). Estimate — see AI Settings for assumptions.' },
  ];
  return (
    <div>
      <div className="page-head"><div><h1>My Workspace</h1><p>What needs an IT administrator right now — ranked by severity, SLA urgency and the action required.</p></div></div>
      <div className="ws-tiles five" data-testid="workspace-tiles">
        {tiles.map((t) => <Link key={t.label} to={t.to} className={`ws-tile tone-${t.tone}`} title={t.title}><t.Icon size={18} aria-hidden /><div><div className="ws-n">{t.n}</div><div className="ws-l">{t.label}</div></div></Link>)}
      </div>
      <div className="row" role="tablist" aria-label="Queue filter" style={{ margin: '16px 0 8px' }}>
        {FILTERS.map((f) => <button key={f.key} role="tab" aria-selected={filter === f.key} className={`chip${filter === f.key ? ' on' : ''}`} data-testid={`filter-${f.key}`} onClick={() => setP(f.key === 'ALL' ? {} : { q: f.key }, { replace: true })}>{f.label} <span className="chip-n">{counts[f.key]}</span></button>)}
        <span className="small muted">Filters can overlap — an overdue ticket can also be pending approval.</span>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {queue.length === 0 ? <Empty title="Nothing needs you here right now" /> : (
          <ol className="aq" data-testid="action-queue">
            {queue.map((q, i) => (
              <li key={q.ticket.id}>
                <Link to={`/incidents/${q.ticket.id}`} className="aq-row">
                  <span className="aq-rank">{i + 1}</span>
                  <span className="aq-main"><span className="aq-title"><strong>{q.ticket.displayId}</strong> {q.ticket.title} <span className="muted">· {q.ticket.requester}</span></span><span className="aq-why small">{q.why}</span></span>
                  <span className="aq-tags"><StatusBadge t={q.ticket} />{q.kind === 'PENDING' && <ConfidenceBadge value={currentDiagnosis(state, q.ticket)?.confidence} threshold={state.settings.confidenceThreshold} />}<SlaBadge t={q.ticket} now={now} /></span>
                  <span className="aq-action">{q.action}<ArrowRight size={14} aria-hidden /></span>
                </Link>
              </li>))}
          </ol>
        )}
      </div>
    </div>
  );
}
