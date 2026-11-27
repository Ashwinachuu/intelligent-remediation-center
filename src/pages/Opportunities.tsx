import { Link, useNavigate } from 'react-router-dom';
import { FilePlus2, Lightbulb, ShieldAlert } from 'lucide-react';
import { useStore } from '../app/store';
import { CATEGORY_LABEL } from '../domain/catalog';
import { opportunities } from '../domain/metrics';
import { DisabledReason, Empty } from '../components/ui';
import { useMemo } from 'react';

export function OpportunitiesPage() {
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const nav = useNavigate();
  const { gaps, blockers } = useMemo(() => opportunities(state), [state]);
  const ro = state.settings.role === 'MANAGER';
  return (
    <div>
      <div className="page-head"><div><h1>Automation opportunities</h1><p>Unsupported or manually handled tickets grouped by category. Hours are <strong>modeled potential</strong> savings (count × max(0, baseline agent min − 4) / 60), not realized savings.</p></div></div>
      <section className="stack-16" aria-label="New runbook gaps">
        <h2><Lightbulb size={16} aria-hidden />New-runbook gaps</h2>
        {!gaps.length && <div className="card"><Empty title="No gaps — every manual ticket has a known runbook" /></div>}
        <div className="table-wrap">
          <table className="data"><thead><tr><th>Category</th><th className="num">Tickets</th><th className="num">Potential agent hours</th><th>Sample tickets</th><th>Draft status</th><th>Action</th></tr></thead>
            <tbody>{gaps.map((g) => (
              <tr key={g.category}>
                <td><strong>{CATEGORY_LABEL[g.category]}</strong></td>
                <td className="num"><Link to={`/incidents?category=${g.category}`}>{g.tickets.length}</Link></td>
                <td className="num">{g.hours.toFixed(1)} h</td>
                <td>{g.tickets.slice(0, 3).map((t) => <div key={t.id}><Link to={`/incidents/${t.id}`}>{t.displayId}</Link> <span className="small muted">{t.title}</span></div>)}</td>
                <td>{g.drafts.length ? g.drafts.map((d) => <div key={`${d.id}${d.version}`}><Link to={`/library/${d.id}`}>{d.id} v{d.version}</Link> <span className="small muted">{d.status.toLowerCase()}</span></div>) : <span className="muted">None</span>}</td>
                <td><button className="btn btn-sm" disabled={ro} onClick={() => { const r = dispatch({ type: 'PROPOSE_DRAFT', category: g.category, ticketIds: g.tickets.map((t) => t.id) }); if (r.ok && r.ticketId) nav(`/library/${r.ticketId}`); }}><FilePlus2 size={14} aria-hidden />Create draft</button>{ro && <DisabledReason reason="Read-only" />}</td>
              </tr>))}</tbody></table>
        </div>
        <p className="small muted">Drafts are never auto-published or auto-approved; an Admin must validate and publish them.</p>
      </section>
      <section className="stack-16" style={{ marginTop: 24 }} aria-label="Policy and endpoint blockers">
        <h2><ShieldAlert size={16} aria-hidden />Policy &amp; endpoint blockers (known runbook exists)</h2>
        <p className="small muted" style={{ marginTop: -8 }}>Excluded from new-runbook gaps: these are safety controls or failed attempts, not missing knowledge.</p>
        <div className="table-wrap"><table className="data"><thead><tr><th>Blocker</th><th className="num">Tickets</th><th className="num">Modeled hours</th><th>Samples</th></tr></thead>
          <tbody>{blockers.map((b) => <tr key={b.reason}><td>{b.reason}</td><td className="num">{b.tickets.length}</td><td className="num">{b.hours.toFixed(1)} h</td><td>{b.tickets.slice(0, 3).map((t) => <Link key={t.id} to={`/incidents/${t.id}`} style={{ marginRight: 8 }}>{t.displayId}</Link>)}</td></tr>)}</tbody></table>
          {!blockers.length && <Empty title="No blocked tickets" />}</div>
      </section>
    </div>
  );
}
