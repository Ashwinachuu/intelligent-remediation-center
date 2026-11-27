import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, BookOpen, CheckCircle2, FilePlus2, Pencil, Upload } from 'lucide-react';
import { useStore } from '../app/store';
import { CATEGORIES, CATEGORY_LABEL, SIM_ACTIONS, isExecutable } from '../domain/catalog';
import { validateRunbook } from '../domain/engine';
import { COMPLETED_PHASES, fmtPct } from '../domain/metrics';
import type { AppState, Category, Device, Risk, Runbook } from '../domain/types';
import { DisabledReason, Empty, Modal, RiskBadge, fmtShort } from '../components/ui';
import { ratio } from '../domain/util';
import { NotFoundPage } from './NotFound';

export function runbookStats(s: AppState, id: string) {
  const ex = s.executions.filter((e) => e.runbookId === id && COMPLETED_PHASES.includes(e.phase));
  return { attempts: ex.length, success: ratio(ex.filter((e) => e.verificationPassed).length, ex.length) };
}
const statusBadge = (r: Runbook) => <span className={`badge ${r.status === 'APPROVED' ? 'b-success' : r.status === 'DRAFT' ? 'b-warning' : 'b-outline'}`}>{r.status === 'APPROVED' ? <CheckCircle2 size={12} aria-hidden /> : r.status === 'DRAFT' ? <Pencil size={12} aria-hidden /> : <Archive size={12} aria-hidden />}{r.status === 'APPROVED' ? 'Approved' : r.status === 'DRAFT' ? 'Draft' : 'Retired'}</span>;

export function LibraryPage() {
  const state = useStore((s) => s.state);
  const nav = useNavigate();
  const [p, setP] = useSearchParams();
  const q = (p.get('q') ?? '').toLowerCase();
  const status = p.get('status') ?? '';
  const ids = useMemo(() => [...new Set(state.runbooks.map((r) => r.id))].sort(), [state.runbooks]);
  const rows = ids.map((id) => {
    const versions = state.runbooks.filter((r) => r.id === id).sort((a, b) => b.version - a.version);
    const display = versions.find((r) => r.status === 'APPROVED') ?? versions[0];
    return { id, display, versions, stats: runbookStats(state, id) };
  }).filter((r) => (!q || `${r.id} ${r.display.title} ${CATEGORY_LABEL[r.display.category]}`.toLowerCase().includes(q)) && (!status || r.versions.some((v) => v.status === status)));
  return (
    <div>
      <div className="page-head"><div><h1>Runbook library</h1><p>Governed, versioned catalog. Only published, validated runbooks with a catalog simulator action are executable. Success rates are derived from execution records.</p></div></div>
      <div className="filters" role="search">
        <label className="field wide">Search<input type="search" value={p.get('q') ?? ''} onChange={(e) => setP((x) => { const n = new URLSearchParams(x); if (e.target.value) n.set('q', e.target.value); else n.delete('q'); return n; }, { replace: true })} placeholder="ID, title or category" /></label>
        <label className="field">Status<select value={status} onChange={(e) => setP((x) => { const n = new URLSearchParams(x); if (e.target.value) n.set('status', e.target.value); else n.delete('status'); return n; }, { replace: true })}><option value="">All</option><option value="APPROVED">Approved</option><option value="DRAFT">Draft</option><option value="RETIRED">Retired</option></select></label>
      </div>
      <div className="table-wrap">
        <table className="data"><thead><tr><th>Runbook</th><th>Category</th><th>Risk</th><th>Owner</th><th>Status</th><th>Executable</th><th>Preapproval</th><th className="num">Attempts</th><th className="num">Verified success</th><th>Versions</th></tr></thead>
          <tbody>{rows.map(({ id, display: r, versions, stats }) => (
            <tr key={id} className="clickable" onClick={() => nav(`/library/${id}`)}>
              <td><Link to={`/library/${id}`} onClick={(e) => e.stopPropagation()}><strong>{id}</strong></Link> v{r.version}<div>{r.title}</div></td>
              <td>{CATEGORY_LABEL[r.category]}</td><td><RiskBadge risk={r.risk} /></td><td>{r.owner}</td>
              <td>{statusBadge(r)}{versions.some((v) => v.status === 'DRAFT') && r.status !== 'DRAFT' && <span className="badge b-warning" style={{ marginLeft: 4 }}>Draft pending</span>}</td>
              <td>{isExecutable(r) ? 'Yes' : r.diagnosticOnly ? 'Diagnostic only' : 'No'}</td>
              <td>{r.preapproved ? 'Eligible' : '—'}</td>
              <td className="num">{stats.attempts}</td><td className="num">{fmtPct(stats.success, 1)}</td><td>{versions.length}</td>
            </tr>))}</tbody></table>
        {!rows.length && <Empty title="No runbooks match" icon={<BookOpen size={28} aria-hidden />} />}
      </div>
    </div>
  );
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function DraftEditor({ rb, onDone }: { rb: Runbook; onDone: () => void }) {
  const dispatch = useStore((s) => s.dispatch);
  const [f, setF] = useState({
    title: rb.title, risk: rb.risk, supportedOS: rb.supportedOS, steps: rb.steps.join('\n'), checks: rb.checks.join('\n'), rollbackSteps: rb.rollbackSteps.join('\n'),
    prerequisites: rb.prerequisites.join('\n'), reversible: rb.reversible, disruptive: rb.disruptive, expectedMin: rb.expectedMin, actionKey: rb.actionKey ?? '', testedScenario: rb.testedScenario ?? '', preapproved: rb.preapproved, recoveryNote: rb.recoveryNote,
  });
  const patch = (): Partial<Runbook> => ({ title: f.title, risk: f.risk, supportedOS: f.supportedOS, steps: lines(f.steps), checks: lines(f.checks), rollbackSteps: lines(f.rollbackSteps), prerequisites: lines(f.prerequisites), reversible: f.reversible, disruptive: f.disruptive, expectedMin: Number(f.expectedMin) || 1, actionKey: (f.actionKey || undefined) as Category | undefined, diagnosticOnly: !f.actionKey, testedScenario: f.testedScenario, preapproved: f.preapproved, recoveryNote: f.recoveryNote });
  const errs = validateRunbook({ ...rb, ...patch() });
  return (
    <Modal title={`Edit draft ${rb.id} v${rb.version}`} wide onClose={onDone} footer={<><span className="small muted grow">{errs.length ? `Publication blocked: ${errs.join('; ')}` : 'Ready to publish after saving.'}</span><button className="btn" onClick={onDone}>Cancel</button><button className="btn btn-primary" onClick={() => { const r = dispatch({ type: 'UPDATE_DRAFT', runbookId: rb.id, version: rb.version, patch: patch() }); if (r.ok) onDone(); }}>Save draft</button></>}>
      <div className="grid grid-2">
        <label className="field">Title<input type="text" data-autofocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field">Simulator action (from fixed catalog)<select value={f.actionKey} onChange={(e) => setF({ ...f, actionKey: e.target.value })}><option value="">None — diagnostic-only guidance (never executable)</option>{Object.values(SIM_ACTIONS).map((a) => <option key={a!.key} value={a!.key}>{CATEGORY_LABEL[a!.key]}: {a!.label}</option>)}</select><span className="hint">Category is {CATEGORY_LABEL[rb.category]}; an executable action must match it. No free-form commands.</span></label>
        <label className="field">Risk<select value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value as Risk })}><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label>
        <label className="field">Expected minutes<input type="number" value={f.expectedMin} onChange={(e) => setF({ ...f, expectedMin: Number(e.target.value) })} /></label>
        <label className="field">Steps (one per line)<textarea value={f.steps} onChange={(e) => setF({ ...f, steps: e.target.value })} /></label>
        <label className="field">Verification checks (one per line)<textarea value={f.checks} onChange={(e) => setF({ ...f, checks: e.target.value })} /></label>
        <label className="field">Prerequisites (one per line)<textarea value={f.prerequisites} onChange={(e) => setF({ ...f, prerequisites: e.target.value })} /></label>
        <label className="field">Rollback steps (one per line)<textarea value={f.rollbackSteps} onChange={(e) => setF({ ...f, rollbackSteps: e.target.value })} /></label>
        <label className="field">Recovery declaration<input type="text" value={f.recoveryNote} onChange={(e) => setF({ ...f, recoveryNote: e.target.value })} placeholder="How is this recovered if it fails?" /></label>
        <label className="field">Tested scenario<input type="text" value={f.testedScenario} onChange={(e) => setF({ ...f, testedScenario: e.target.value })} placeholder="e.g. Scenario E replay in simulator" /></label>
      </div>
      <fieldset style={{ border: 0, padding: 0 }}><legend className="small" style={{ fontWeight: 600 }}>Supported OS</legend><div className="row">{(['Windows 11', 'macOS'] as Device['os'][]).map((o) => <label key={o} className="check"><input type="checkbox" checked={f.supportedOS.includes(o)} onChange={(e) => setF({ ...f, supportedOS: e.target.checked ? [...f.supportedOS, o] : f.supportedOS.filter((x) => x !== o) })} />{o}</label>)}</div></fieldset>
      <div className="row"><label className="check"><input type="checkbox" checked={f.reversible} onChange={(e) => setF({ ...f, reversible: e.target.checked })} />Reversible</label><label className="check"><input type="checkbox" checked={f.disruptive} onChange={(e) => setF({ ...f, disruptive: e.target.checked })} />Disruptive (needs consent)</label><label className="check"><input type="checkbox" checked={f.preapproved} onChange={(e) => setF({ ...f, preapproved: e.target.checked })} />Preapproval eligible (LOW, non-disruptive only)</label></div>
    </Modal>
  );
}

export function RunbookDetailPage() {
  const { id } = useParams();
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const versions = useMemo(() => state.runbooks.filter((r) => r.id === id).sort((a, b) => b.version - a.version), [state.runbooks, id]);
  const [sel, setSel] = useState<number | null>(null);
  const [modal, setModal] = useState<null | 'edit' | 'publish' | 'retire'>(null);
  const [text, setText] = useState('');
  useEffect(() => { setSel(null); }, [id]);
  if (!versions.length) return <NotFoundPage />;
  const rb = versions.find((v) => v.version === sel) ?? versions.find((v) => v.status === 'DRAFT') ?? versions[0];
  const isAdmin = state.settings.role === 'ADMIN';
  const stats = runbookStats(state, rb.id);
  const errs = validateRunbook(rb);
  const pending = Object.values(state.tickets).filter((t) => ['AWAITING_APPROVAL', 'AWAITING_CONSENT', 'SCHEDULED', 'WAITING_DEVICE', 'READY'].includes(t.status) && state.diagnoses.find((d) => d.id === t.diagnosisId)?.runbookId === rb.id);
  return (
    <div>
      <div className="page-head">
        <div><div className="row"><h1>{rb.id} v{rb.version}</h1>{statusBadge(rb)}<RiskBadge risk={rb.risk} /></div><p>{rb.title}</p></div>
        <div className="row">
          {rb.status === 'DRAFT' && <button className="btn" disabled={!isAdmin} onClick={() => setModal('edit')}><Pencil size={14} aria-hidden />Edit draft</button>}
          {rb.status === 'DRAFT' && <button className="btn btn-primary" disabled={!isAdmin || errs.length > 0} onClick={() => { setText(''); setModal('publish'); }}><Upload size={14} aria-hidden />Approve &amp; publish</button>}
          {rb.status !== 'DRAFT' && <button className="btn" disabled={!isAdmin || versions.some((v) => v.status === 'DRAFT')} onClick={() => dispatch({ type: 'NEW_VERSION', runbookId: rb.id })}><FilePlus2 size={14} aria-hidden />New version</button>}
          {rb.status === 'APPROVED' && <button className="btn btn-danger" disabled={!isAdmin} onClick={() => { setText(''); setModal('retire'); }}><Archive size={14} aria-hidden />Retire</button>}
        </div>
      </div>
      <DisabledReason reason={!isAdmin ? 'Only Admin can edit, publish or retire runbooks. Agents propose drafts from manually resolved tickets.' : rb.status === 'DRAFT' && errs.length ? `Publication blocked: ${errs.join('; ')}` : null} />
      <div className="grid grid-2" style={{ marginTop: 8 }}>
        <section className="card stack">
          <h2>Definition</h2>
          <dl className="kv">
            <dt>Category</dt><dd>{CATEGORY_LABEL[rb.category]}</dd>
            <dt>Executable</dt><dd>{isExecutable(rb) ? `Yes — simulator action: ${SIM_ACTIONS[rb.actionKey!]!.label}` : rb.actionKey ? 'Not until published' : 'No — diagnostic-only guidance'}</dd>
            <dt>Supported OS</dt><dd>{rb.supportedOS.join(', ') || '—'}</dd>
            <dt>Impact</dt><dd>{rb.disruptive ? 'Disruptive (employee consent)' : 'Non-disruptive'} · ~{rb.expectedMin} min</dd>
            <dt>Preapproval</dt><dd>{rb.preapproved ? 'Eligible when policy preapproval is on' : 'Not eligible'}</dd>
            <dt>Owner</dt><dd>{rb.owner}</dd>
            <dt>Tested scenario</dt><dd>{rb.testedScenario || '—'}</dd>
            <dt>Published</dt><dd>{fmtShort(rb.publishedAt)}</dd>
            <dt>Attempts / success</dt><dd>{stats.attempts} completed · {fmtPct(stats.success, 1)} verified (all versions)</dd>
            {rb.sourceTicketIds.length > 0 && <><dt>Source tickets</dt><dd className="row">{rb.sourceTicketIds.slice(0, 8).map((t) => <Link key={t} to={`/incidents/${t}`}>{state.tickets[t]?.displayId}</Link>)}{rb.sourceTicketIds.length > 8 && <span className="muted">+{rb.sourceTicketIds.length - 8}</span>}</dd></>}
          </dl>
          <h3>Steps</h3><ol>{rb.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <h3>Prerequisites</h3><ul>{rb.prerequisites.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <h3>Verification checks</h3><ul>{rb.checks.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <h3>Recovery</h3><p>{rb.reversible ? `Reversible: ${rb.rollbackSteps.join('; ')}` : 'Irreversible.'} {rb.recoveryNote || <span className="muted">No recovery declaration yet.</span>}</p>
        </section>
        <div className="stack-16">
          <section className="card"><h2>Version history</h2>
            <div className="table-wrap"><table className="data"><thead><tr><th>Version</th><th>Status</th><th>Created</th><th>Published / retired</th><th>Note</th></tr></thead>
              <tbody>{versions.map((v) => <tr key={v.version} className="clickable" onClick={() => setSel(v.version)} aria-selected={v.version === rb.version}><td><button className="btn-link" onClick={() => setSel(v.version)}>v{v.version}</button>{v.version === rb.version && ' (viewing)'}</td><td>{statusBadge(v)}</td><td>{fmtShort(v.createdAt)}</td><td>{v.publishedAt ? fmtShort(v.publishedAt) : '—'}{v.retiredAt ? ` / ${fmtShort(v.retiredAt)}` : ''}</td><td className="small">{v.changeNote}</td></tr>)}</tbody></table></div>
            <p className="small muted" style={{ marginTop: 8 }}>Previous versions are never overwritten. Publishing a new version retires the prior approved version and invalidates pending plans.</p>
          </section>
          <section className="card"><h2>Pending plans using {rb.id}</h2>
            {pending.length ? <ul className="clean">{pending.map((t) => <li key={t.id}><Link to={`/incidents/${t.id}`}>{t.displayId}</Link> {t.title}</li>)}</ul> : <p className="muted small">None. Changing or retiring this runbook would invalidate pending plans.</p>}
          </section>
        </div>
      </div>
      {modal === 'edit' && <DraftEditor rb={rb} onDone={() => setModal(null)} />}
      {modal === 'publish' && (
        <Modal title={`Approve & publish ${rb.id} v${rb.version}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={text.trim().length < 3} onClick={() => { const r = dispatch({ type: 'PUBLISH_RUNBOOK', runbookId: rb.id, version: rb.version, note: text }); if (r.ok) setModal(null); }}>Publish</button></>}>
          <p>{rb.actionKey ? 'This version becomes executable for matching plans (subject to policy and approval).' : 'This publishes diagnostic-only guidance; it can never execute device actions.'} Any currently approved version of {rb.id} will be retired, and pending plans re-evaluated.</p>
          <label className="field">Publication note<input type="text" data-autofocus value={text} onChange={(e) => setText(e.target.value)} /></label>
        </Modal>
      )}
      {modal === 'retire' && (
        <Modal title={`Retire ${rb.id} v${rb.version}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-danger-solid" disabled={text.trim().length < 3} onClick={() => { const r = dispatch({ type: 'RETIRE_RUNBOOK', runbookId: rb.id, version: rb.version, reason: text }); if (r.ok) setModal(null); }}>Retire</button></>}>
          <p>{pending.length} pending plan(s) reference this runbook and will be invalidated and re-diagnosed.</p>
          <label className="field">Reason<input type="text" data-autofocus value={text} onChange={(e) => setText(e.target.value)} /></label>
        </Modal>
      )}
    </div>
  );
}
void CATEGORIES;
