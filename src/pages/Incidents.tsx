import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, FilterX, Plus } from 'lucide-react';
import { useStore } from '../app/store';
import { useUi } from '../app/ui-store';
import { loadScenario } from '../app/scenarios';
import { CATEGORIES, CATEGORY_LABEL, SCENARIOS } from '../domain/catalog';
import { currentDiagnosis } from '../domain/engine';
import { METRIC_DEFS, STATUS_ORDER, ageMs, fmtAge, inRange, matchesDims, type MetricKey } from '../domain/metrics';
import { STATUS_LABEL } from '../domain/transitions';
import type { AppState, Ticket } from '../domain/types';
import { Empty, PathBadge, RiskBadge, ScoreBadge, StatusBadge, fmtShort } from '../components/ui';

const PAGE = 20;
const PRIORITY_RANK = { P2: 0, P3: 1, P4: 2 } as const;
const BANDS: Record<string, [number, number]> = { lt60: [0, 59], '60-79': [60, 79], '80-94': [80, 94], '95+': [95, 100] };

export function filterTickets(s: AppState, p: URLSearchParams, now: number) {
  const q = (p.get('q') ?? '').trim().toLowerCase();
  const statuses = p.get('status')?.split(',').filter(Boolean);
  const metric = p.get('metric') as MetricKey | null;
  const from = p.get('from'), to = p.get('to');
  const basis = p.get('basis') ?? 'created';
  const conf = p.get('conf'), risk = p.get('risk');
  const dims = { source: p.get('source') || undefined, category: p.get('category') || undefined, group: p.get('group') || undefined, path: p.get('path') || undefined } as Parameters<typeof matchesDims>[2];
  let rows = Object.values(s.tickets).filter((t) => {
    if (!matchesDims(s, t, dims)) return false;
    if (statuses?.length && !statuses.includes(t.status)) return false;
    if (from && to) {
      const ts = basis === 'closed' ? t.closedAt : basis === 'resolved' ? t.resolvedAt : t.createdAt;
      if (!inRange(ts, { from, to })) return false;
    }
    if (metric && METRIC_DEFS[metric] && !METRIC_DEFS[metric].test(t, s)) return false;
    const d = currentDiagnosis(s, t);
    if (conf && BANDS[conf]) { if (!d || d.confidence < BANDS[conf][0] || d.confidence > BANDS[conf][1]) return false; }
    if (risk && d?.risk !== risk) return false;
    if (q && !(`${t.displayId} ${t.title} ${t.requester}`.toLowerCase().includes(q))) return false;
    return true;
  });
  const sort = p.get('sort') ?? 'created';
  const dir = p.get('dir') === 'asc' ? 1 : -1;
  const key = (t: Ticket): number => sort === 'priority' ? -PRIORITY_RANK[t.priority] : sort === 'score' ? currentDiagnosis(s, t)?.confidence ?? -1 : sort === 'age' ? ageMs(t, now) : Date.parse(t.createdAt);
  rows = rows.sort((a, b) => (key(a) - key(b)) * dir || a.displayId.localeCompare(b.displayId) * dir);
  return rows;
}

export function IncidentsPage() {
  const [p, setP] = useSearchParams();
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const { openCreator } = useUi();
  const nav = useNavigate();
  const role = state.settings.role;
  const rows = useMemo(() => filterTickets(state, p, now), [state, p, now]);
  const page = Math.max(1, Number(p.get('page') ?? 1));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE);
  const set = (k: string, v: string) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); n.delete('page'); setP(n, { replace: true }); };
  const sortBy = (k: string) => { const n = new URLSearchParams(p); const same = (p.get('sort') ?? 'created') === k; n.set('sort', k); n.set('dir', same && p.get('dir') !== 'asc' ? 'asc' : 'desc'); setP(n, { replace: true }); };
  const metric = p.get('metric') as MetricKey | null;
  const hasFilters = [...p.keys()].some((k) => !['sort', 'dir', 'page'].includes(k));
  const basis = p.get('basis') ?? 'created';
  const SortTh = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <th aria-sort={(p.get('sort') ?? 'created') === k ? (p.get('dir') === 'asc' ? 'ascending' : 'descending') : 'none'}><button className="sort" onClick={() => sortBy(k)}>{children}<ArrowDownUp size={12} aria-hidden /></button></th>
  );

  return (
    <div>
      <div className="page-head">
        <div><h1>Incidents</h1><p>Endpoint-health tickets with simulated diagnosis, policy route and remediation path.</p></div>
        <button className="btn btn-primary" onClick={() => openCreator()} disabled={role === 'MANAGER'}><Plus size={16} aria-hidden />Create ticket</button>
      </div>
      <div className="card card-tight" style={{ marginBottom: 16 }}>
        <div className="row"><strong className="small">Load scenario</strong><span className="small muted">creates a fresh demo ticket</span>
          {SCENARIOS.map((s) => <button key={s.key} className="btn btn-sm" disabled={role === 'MANAGER'} title={s.expected} onClick={() => { const id = loadScenario(s.key); if (id) nav(`/incidents/${id}`); }}>{s.label}</button>)}
        </div>
      </div>
      {(metric || (p.get('from') && p.get('to'))) && (
        <div className="banner" role="status">
          <div className="grow">
            <strong>{metric && METRIC_DEFS[metric] ? METRIC_DEFS[metric].label : 'Filtered cohort'}</strong>
            {metric && METRIC_DEFS[metric] && <span className="muted"> · predicate: {METRIC_DEFS[metric].predicate}</span>}
            {p.get('from') && <span className="muted"> · date basis: {basis === 'closed' ? 'current closure date (closure activity)' : basis === 'resolved' ? 'current resolution date (throughput activity)' : 'created date (intake cohort)'} {p.get('from')} → {p.get('to')} (inclusive, local time)</span>}
          </div>
        </div>
      )}
      <div className="filters" role="search">
        <label className="field wide">Search<input type="search" placeholder="ID, title or requester" value={p.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} /></label>
        <label className="field">Status<select value={p.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}><option value="">All</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label className="field">Score band<select value={p.get('conf') ?? ''} onChange={(e) => set('conf', e.target.value)}><option value="">All</option><option value="lt60">&lt; 60</option><option value="60-79">60–79</option><option value="80-94">80–94</option><option value="95+">95+</option></select></label>
        <label className="field">Risk<select value={p.get('risk') ?? ''} onChange={(e) => set('risk', e.target.value)}><option value="">All</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
        <label className="field">Category<select value={p.get('category') ?? ''} onChange={(e) => set('category', e.target.value)}><option value="">All</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>
        <label className="field">Source<select value={p.get('source') ?? ''} onChange={(e) => set('source', e.target.value)}><option value="">All</option><option value="EMPLOYEE">Employee</option><option value="DETECTION">Detection</option></select></label>
        <label className="field">Path<select value={p.get('path') ?? ''} onChange={(e) => set('path', e.target.value)}><option value="">All</option><option value="AUTO_POLICY">Auto (policy)</option><option value="HUMAN_APPROVED">Human-approved</option><option value="MANUAL">Manual</option><option value="NONE">Pending / none</option></select></label>
        <label className="field">Created from<input type="date" value={p.get('from') ?? ''} onChange={(e) => { const n = new URLSearchParams(p); if (e.target.value) { n.set('from', e.target.value); if (!n.get('to')) n.set('to', e.target.value); } else { n.delete('from'); n.delete('to'); } n.delete('page'); setP(n, { replace: true }); }} /></label>
        <label className="field">to<input type="date" value={p.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
        <button className="btn" onClick={() => setP(new URLSearchParams(), { replace: true })} disabled={!hasFilters}><FilterX size={14} aria-hidden />Clear filters</button>
      </div>
      <p className="small muted" aria-live="polite">{rows.length} incident{rows.length === 1 ? '' : 's'} match</p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Ticket</th><th>Requester / device</th><th>Category</th><th>Source</th><SortTh k="priority">Priority</SortTh><th>Status</th><SortTh k="score">Score</SortTh><th>Risk</th><th>Path</th><SortTh k="age">Age</SortTh><SortTh k="created">Created</SortTh><th>Owner</th></tr></thead>
          <tbody>
            {view.map((t) => {
              const d = currentDiagnosis(state, t);
              return (
                <tr key={t.id} className="clickable" onClick={() => nav(`/incidents/${t.id}`)}>
                  <td style={{ minWidth: 220 }}><Link to={`/incidents/${t.id}`} onClick={(e) => e.stopPropagation()}><strong>{t.displayId}</strong></Link>{t.demo && <span className="badge b-accent" style={{ marginLeft: 6 }}>Demo{t.scenario && t.scenario !== 'CUSTOM' ? ` ${t.scenario}` : ''}</span>}<div>{t.title}</div></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{t.requester}<div className="small muted">{state.devices[t.deviceId]?.name}</div></td>
                  <td>{CATEGORY_LABEL[d?.category ?? t.category]}</td>
                  <td>{t.source === 'DETECTION' ? 'Detection' : 'Employee'}</td>
                  <td>{t.priority}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td><ScoreBadge score={d?.confidence} /></td>
                  <td><RiskBadge risk={d?.risk} /></td>
                  <td><PathBadge path={t.path} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtAge(ageMs(t, now))}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtShort(t.createdAt)}</td>
                  <td>{t.owner}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty title="No incidents match these filters"><button className="btn" onClick={() => setP(new URLSearchParams(), { replace: true })}><FilterX size={14} aria-hidden />Clear filters</button></Empty>}
      </div>
      {rows.length > PAGE && (
        <nav className="pager" aria-label="Pagination">
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => { const n = new URLSearchParams(p); n.set('page', String(page - 1)); setP(n, { replace: true }); }}>Previous</button>
          <span className="small">Page {Math.min(page, pages)} of {pages}</span>
          <button className="btn btn-sm" disabled={page >= pages} onClick={() => { const n = new URLSearchParams(p); n.set('page', String(page + 1)); setP(n, { replace: true }); }}>Next</button>
        </nav>
      )}
    </div>
  );
}
