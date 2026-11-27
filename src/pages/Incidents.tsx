import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FilterX } from 'lucide-react';
import { useStore } from '../app/store';
import { ISSUE_LABEL, ISSUE_TYPES } from '../domain/catalog';
import { currentDiagnosis } from '../domain/engine';
import { slaState } from '../domain/insights';
import { APPROVAL_LABEL, METHOD_LABEL, PRODUCT_STATUS_LABEL, PRODUCT_STATUSES, approvalStatus, productStatus } from '../domain/lifecycle';
import { METRIC_DEFS, fmtAge, inRange } from '../domain/metrics';
import type { AppState, ApprovalStatus, Path } from '../domain/types';
import { ApprovalBadge, ConfidenceBadge, Empty, MethodBadge, SlaBadge, StatusBadge, fmtShort } from '../components/ui';

const PAGE = 20;
export function filterTickets(s: AppState, p: URLSearchParams, now: number) {
  const q = (p.get('q') ?? '').trim().toLowerCase();
  const status = p.get('status'), approval = p.get('approval'), method = p.get('method'), issue = p.get('issue'), metric = p.get('metric');
  const from = p.get('from'), to = p.get('to'), basis = p.get('basis') ?? 'created';
  return Object.values(s.tickets).filter((t) => {
    if (status && productStatus(t) !== status) return false;
    if (approval && approvalStatus(s, t) !== approval) return false;
    if (method && !(t.status === 'CLOSED' && t.path === method)) return false;
    if (issue && t.issueType !== issue) return false;
    if (p.get('overdue') && slaState(t, now) !== 'BREACHED') return false;
    if (from && to && !inRange(basis === 'closed' ? t.closedAt : t.createdAt, { from, to })) return false;
    if (metric && METRIC_DEFS[metric] && !METRIC_DEFS[metric].test(t, s)) return false;
    if (q && !`${t.displayId} ${t.title} ${t.requester}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Admin incident list — every KPI drill-down lands here with its exact predicate. */
export function IncidentsPage() {
  const [p, setP] = useSearchParams();
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const nav = useNavigate();
  const rows = useMemo(() => filterTickets(state, p, now), [state, p, now]);
  const page = Math.max(1, Number(p.get('page') ?? 1));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE);
  const set = (k: string, v: string) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setP(n, { replace: true }); };
  const metric = p.get('metric');
  const hasFilters = [...p.keys()].some((k) => k !== 'page');
  return (
    <div>
      <div className="page-head"><div><h1>Incidents</h1><p>Every incident reported by employees — the same records employees see in My Tickets.</p></div></div>
      {(metric || p.get('from')) && (
        <div className="banner" role="status"><div className="grow">
          <strong>{metric && METRIC_DEFS[metric] ? METRIC_DEFS[metric].label : 'Filtered incidents'}</strong>
          {metric && METRIC_DEFS[metric] && <span className="muted"> · {METRIC_DEFS[metric].predicate}</span>}
          {p.get('from') && <span className="muted"> · {p.get('basis') === 'closed' ? 'closed' : 'created'} {p.get('from')} → {p.get('to')}</span>}
        </div></div>
      )}
      <div className="filters" role="search">
        <label className="field wide">Search<input type="search" placeholder="ID, title or employee" value={p.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} /></label>
        <label className="field">Status<select value={p.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}><option value="">All</option>{PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{PRODUCT_STATUS_LABEL[s]}</option>)}</select></label>
        <label className="field">Approval<select value={p.get('approval') ?? ''} onChange={(e) => set('approval', e.target.value)}><option value="">All</option>{(Object.keys(APPROVAL_LABEL) as ApprovalStatus[]).map((s) => <option key={s} value={s}>{APPROVAL_LABEL[s]}</option>)}</select></label>
        <label className="field">Resolution<select value={p.get('method') ?? ''} onChange={(e) => set('method', e.target.value)}><option value="">All</option>{(Object.keys(METHOD_LABEL) as Path[]).map((s) => <option key={s} value={s}>{METHOD_LABEL[s]}</option>)}</select></label>
        <label className="field">Issue<select value={p.get('issue') ?? ''} onChange={(e) => set('issue', e.target.value)}><option value="">All</option>{ISSUE_TYPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        <label className="check" style={{ alignSelf: 'center' }}><input type="checkbox" checked={!!p.get('overdue')} onChange={(e) => set('overdue', e.target.checked ? '1' : '')} />Overdue only</label>
        <button className="btn" onClick={() => setP(new URLSearchParams(), { replace: true })} disabled={!hasFilters}><FilterX size={14} aria-hidden />Clear filters</button>
      </div>
      <p className="small muted" aria-live="polite">{rows.length} incident{rows.length === 1 ? '' : 's'}</p>
      <div className="table-wrap">
        <table className="data" data-testid="incident-table">
          <thead><tr><th>Incident</th><th>Employee · device</th><th>Issue</th><th>Status</th><th>Approval</th><th>Resolution</th><th>AI confidence</th><th>SLA</th><th>Age</th></tr></thead>
          <tbody>{view.map((t) => (
            <tr key={t.id} className="clickable" onClick={() => nav(`/incidents/${t.id}`)}>
              <td style={{ minWidth: 200 }}><Link to={`/incidents/${t.id}`} onClick={(e) => e.stopPropagation()}><strong>{t.displayId}</strong></Link><div>{t.title}</div></td>
              <td style={{ whiteSpace: 'nowrap' }}>{t.requester}<div className="small muted">{state.devices[t.deviceId]?.name}</div></td>
              <td className="small">{ISSUE_LABEL[t.issueType]}</td>
              <td><StatusBadge t={t} /></td>
              <td><ApprovalBadge status={approvalStatus(state, t)} /></td>
              <td>{t.status === 'CLOSED' ? <MethodBadge path={t.path} /> : <span className="muted small">—</span>}</td>
              <td><ConfidenceBadge value={currentDiagnosis(state, t)?.confidence} threshold={state.settings.confidenceThreshold} /></td>
              <td><SlaBadge t={t} now={now} /></td>
              <td style={{ whiteSpace: 'nowrap' }} title={fmtShort(t.createdAt)}>{fmtAge(now - Date.parse(t.createdAt))}</td>
            </tr>))}</tbody>
        </table>
        {rows.length === 0 && <Empty title="No incidents match these filters"><button className="btn" onClick={() => setP(new URLSearchParams(), { replace: true })}><FilterX size={14} aria-hidden />Clear filters</button></Empty>}
      </div>
      {rows.length > PAGE && <nav className="pager" aria-label="Pagination"><button className="btn btn-sm" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>Previous</button><span className="small">Page {Math.min(page, pages)} of {pages}</span><button className="btn btn-sm" disabled={page >= pages} onClick={() => set('page', String(page + 1))}>Next</button></nav>}
    </div>
  );
}
