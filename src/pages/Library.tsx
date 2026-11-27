import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArrowDownCircle, ArrowUpCircle, BookOpen, CheckCircle2, Circle, CircleDashed, FilePlus2, Pencil, Send, Sparkles, Undo2, Upload, XCircle } from 'lucide-react';
import { useStore } from '../app/store';
import { CATEGORY_LABEL, MATURITY_LABEL, SIM_ACTIONS, isExecutable } from '../domain/catalog';
import { validateRunbook } from '../domain/engine';
import { fmtPct } from '../domain/metrics';
import { LIFECYCLE, lifecycleStage, maturityCriteria, runbookRecord, type LifecycleStage } from '../domain/maturity';
import type { AppState, Category, Device, Maturity, Risk, Runbook } from '../domain/types';
import { DisabledReason, Empty, Modal, RiskBadge, fmtShort } from '../components/ui';
import { ratio } from '../domain/util';
import { NotFoundPage } from './NotFound';

export function runbookStats(s: AppState, id: string) {
  const r = runbookRecord(s, id);
  return { attempts: r.completed, success: ratio(r.passed, r.completed) };
}
const STAGE_LABEL: Record<LifecycleStage, string> = { DRAFT: 'Draft', UNDER_REVIEW: 'Under review', APPROVED: 'Approved', SUPERVISED: 'Supervised execution', ELIGIBLE: 'Eligible for automation', AUTOMATED: 'Policy-based automation', RETIRED: 'Retired' };
const stageBadge = (st: LifecycleStage) => <span className={`badge ${st === 'RETIRED' ? 'b-outline' : st === 'DRAFT' || st === 'UNDER_REVIEW' ? 'b-warning' : st === 'AUTOMATED' || st === 'ELIGIBLE' ? 'b-accent' : 'b-success'}`}>{st === 'RETIRED' ? <Archive size={12} aria-hidden /> : st === 'DRAFT' ? <Pencil size={12} aria-hidden /> : st === 'UNDER_REVIEW' ? <CircleDashed size={12} aria-hidden /> : <CheckCircle2 size={12} aria-hidden />}{STAGE_LABEL[st]}</span>;
export const MaturityBadge = ({ m }: { m: Maturity }) => <span className={`badge ${m >= 3 ? 'b-accent' : m === 2 ? 'b-neutral' : 'b-outline'}`} title={MATURITY_LABEL[m]}>L{m}</span>;

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
    return { id, display, versions, stats: runbookStats(state, id), stage: lifecycleStage(state, display) };
  }).filter((r) => (!q || `${r.id} ${r.display.title} ${CATEGORY_LABEL[r.display.category]}`.toLowerCase().includes(q)) && (!status || r.versions.some((v) => v.status === status)));
  const set = (k: string, v: string) => setP((x) => { const n = new URLSearchParams(x); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  return (
    <div>
      <div className="page-head"><div><h1>Runbook library</h1><p>Governed, versioned catalog. Lifecycle: Draft → Under review → Approved → Supervised execution → Eligible for policy-based automation. Only administrator-validated runbooks with a catalog simulator action can execute; success rates are derived from execution records.</p></div></div>
      <div className="filters" role="search">
        <label className="field wide">Search<input type="search" value={p.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} placeholder="ID, title or category" /></label>
        <label className="field">Status<select value={status} onChange={(e) => set('status', e.target.value)}><option value="">All</option><option value="APPROVED">Approved</option><option value="UNDER_REVIEW">Under review</option><option value="DRAFT">Draft</option><option value="RETIRED">Retired</option></select></label>
      </div>
      <div className="table-wrap">
        <table className="data"><thead><tr><th>Runbook</th><th>Category</th><th>Risk</th><th>Lifecycle</th><th>Maturity</th><th>Owner</th><th className="num">Attempts</th><th className="num">Verified success</th><th>Versions</th></tr></thead>
          <tbody>{rows.map(({ id, display: r, versions, stats, stage }) => (
            <tr key={id} className="clickable" onClick={() => nav(`/library/${id}`)}>
              <td><Link to={`/library/${id}`} onClick={(e) => e.stopPropagation()}><strong>{id}</strong></Link> v{r.version}{r.aiGenerated && <span className="badge b-outline" style={{ marginLeft: 6 }}><Sparkles size={12} aria-hidden />AI draft</span>}<div>{r.title}</div></td>
              <td>{CATEGORY_LABEL[r.category]}</td><td><RiskBadge risk={r.risk} /></td>
              <td>{stageBadge(stage)}{versions.some((v) => v.status === 'DRAFT' || v.status === 'UNDER_REVIEW') && r.status === 'APPROVED' && <span className="badge b-warning" style={{ marginLeft: 4 }}>New version pending</span>}</td>
              <td><MaturityBadge m={r.maturity} /> <span className="small muted">{MATURITY_LABEL[r.maturity].split(' · ')[1]}</span></td>
              <td>{r.owner}</td>
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
  const isAdmin = useStore((s) => s.state.settings.role === 'ADMIN');
  const [f, setF] = useState({
    title: rb.title, risk: rb.risk, supportedOS: rb.supportedOS, steps: rb.steps.join('\n'), checks: rb.checks.join('\n'), rollbackSteps: rb.rollbackSteps.join('\n'),
    prerequisites: rb.prerequisites.join('\n'), reversible: rb.reversible, disruptive: rb.disruptive, expectedMin: rb.expectedMin, actionKey: rb.actionKey ?? '', testedScenario: rb.testedScenario ?? '', recoveryNote: rb.recoveryNote,
    rootCause: rb.rootCause ?? '', applicability: rb.applicability ?? '', risks: (rb.risks ?? []).join('\n'),
  });
  const patch = (): Partial<Runbook> => ({ title: f.title, risk: f.risk, supportedOS: f.supportedOS, steps: lines(f.steps), checks: lines(f.checks), rollbackSteps: lines(f.rollbackSteps), prerequisites: lines(f.prerequisites), reversible: f.reversible, disruptive: f.disruptive, expectedMin: Number(f.expectedMin) || 1, actionKey: (f.actionKey || undefined) as Category | undefined, diagnosticOnly: !f.actionKey, testedScenario: f.testedScenario, recoveryNote: f.recoveryNote, rootCause: f.rootCause, applicability: f.applicability, risks: lines(f.risks) });
  const errs = validateRunbook({ ...rb, ...patch(), stepDefs: rb.stepDefs.length ? rb.stepDefs : [{ id: 'S1' } as Runbook['stepDefs'][number]] });
  return (
    <Modal title={`Edit draft ${rb.id} v${rb.version}`} wide onClose={onDone} footer={<><span className="small muted grow">{errs.length ? `Review submission blocked: ${errs.join('; ')}` : 'Ready to submit for review after saving.'}</span><button className="btn" onClick={onDone}>Cancel</button><button className="btn btn-primary" data-testid="save-draft" onClick={() => { const r = dispatch({ type: 'UPDATE_DRAFT', runbookId: rb.id, version: rb.version, patch: patch() }); if (r.ok) onDone(); }}>Save draft</button></>}>
      <div className="grid grid-2">
        <label className="field">Title<input type="text" data-autofocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field">Simulator action (fixed catalog)<select value={f.actionKey} disabled={!isAdmin} onChange={(e) => setF({ ...f, actionKey: e.target.value })}><option value="">None — guidance only (never executable)</option>{Object.values(SIM_ACTIONS).map((a) => <option key={a!.key} value={a!.key}>{CATEGORY_LABEL[a!.key]}: {a!.label}</option>)}</select><span className="hint">{isAdmin ? `Must match category ${CATEGORY_LABEL[rb.category]}. No free-form commands.` : 'Only an administrator can attach an executable action.'}</span></label>
        <label className="field">Root cause<textarea value={f.rootCause} onChange={(e) => setF({ ...f, rootCause: e.target.value })} /></label>
        <label className="field">Applicability<textarea value={f.applicability} onChange={(e) => setF({ ...f, applicability: e.target.value })} /></label>
        <label className="field">Risk<select value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value as Risk })}><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label>
        <label className="field">Expected minutes<input type="number" value={f.expectedMin} onChange={(e) => setF({ ...f, expectedMin: Number(e.target.value) })} /></label>
        <label className="field">Remediation steps (one per line)<textarea value={f.steps} onChange={(e) => setF({ ...f, steps: e.target.value })} /></label>
        <label className="field">Verification criteria (one per line)<textarea value={f.checks} onChange={(e) => setF({ ...f, checks: e.target.value })} /></label>
        <label className="field">Prerequisites (one per line)<textarea value={f.prerequisites} onChange={(e) => setF({ ...f, prerequisites: e.target.value })} /></label>
        <label className="field">Risks (one per line)<textarea value={f.risks} onChange={(e) => setF({ ...f, risks: e.target.value })} /></label>
        <label className="field">Rollback steps (one per line)<textarea value={f.rollbackSteps} onChange={(e) => setF({ ...f, rollbackSteps: e.target.value })} /></label>
        <label className="field">Recovery instructions<textarea value={f.recoveryNote} onChange={(e) => setF({ ...f, recoveryNote: e.target.value })} /></label>
        <label className="field">Tested scenario<input type="text" value={f.testedScenario} onChange={(e) => setF({ ...f, testedScenario: e.target.value })} placeholder="e.g. Scenario E replay in simulator" /></label>
      </div>
      <fieldset style={{ border: 0, padding: 0 }}><legend className="small" style={{ fontWeight: 600 }}>Supported OS</legend><div className="row">{(['Windows 11', 'macOS'] as Device['os'][]).map((o) => <label key={o} className="check"><input type="checkbox" checked={f.supportedOS.includes(o)} onChange={(e) => setF({ ...f, supportedOS: e.target.checked ? [...f.supportedOS, o] : f.supportedOS.filter((x) => x !== o) })} />{o}</label>)}</div></fieldset>
      <div className="row"><label className="check"><input type="checkbox" checked={f.reversible} onChange={(e) => setF({ ...f, reversible: e.target.checked })} />Reversible</label><label className="check"><input type="checkbox" checked={f.disruptive} onChange={(e) => setF({ ...f, disruptive: e.target.checked })} />Disruptive (needs consent)</label></div>
    </Modal>
  );
}

export function RunbookDetailPage() {
  const { id } = useParams();
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const versions = useMemo(() => state.runbooks.filter((r) => r.id === id).sort((a, b) => b.version - a.version), [state.runbooks, id]);
  const [sel, setSel] = useState<number | null>(null);
  const [modal, setModal] = useState<null | 'edit' | 'publish' | 'retire' | 'return' | { maturity: Maturity }>(null);
  const [text, setText] = useState('');
  useEffect(() => { setSel(null); }, [id]);
  if (!versions.length) return <NotFoundPage />;
  const rb = versions.find((v) => v.version === sel) ?? versions.find((v) => v.status === 'DRAFT' || v.status === 'UNDER_REVIEW') ?? versions[0];
  const role = state.settings.role;
  const isAdmin = role === 'ADMIN';
  const ro = role === 'MANAGER';
  const stats = runbookStats(state, rb.id);
  const errs = validateRunbook(rb);
  const stage = lifecycleStage(state, rb);
  const stageIdx = stage === 'AUTOMATED' ? LIFECYCLE.length : LIFECYCLE.findIndex((x) => x.key === stage);
  const pending = Object.values(state.tickets).filter((t) => ['AWAITING_APPROVAL', 'AWAITING_CONSENT', 'SCHEDULED', 'WAITING_DEVICE', 'READY', 'STEP_APPROVAL'].includes(t.status) && state.diagnoses.find((d) => d.id === t.diagnosisId)?.runbookId === rb.id);
  const next = (Math.min(4, rb.maturity + 1)) as Maturity;
  const crit = isExecutable(rb) && rb.maturity < 4 ? maturityCriteria(state, rb, next) : [];
  const versionOutcomes = (v: number) => runbookRecord(state, rb.id, v);
  return (
    <div>
      <div className="page-head">
        <div><div className="row"><h1>{rb.id} v{rb.version}</h1>{stageBadge(stage)}<RiskBadge risk={rb.risk} /><MaturityBadge m={rb.maturity} />{rb.aiGenerated && <span className="badge b-outline"><Sparkles size={12} aria-hidden />AI-generated (simulated)</span>}</div><p>{rb.title}</p></div>
        <div className="row">
          {rb.status === 'DRAFT' && <button className="btn" disabled={ro} onClick={() => setModal('edit')}><Pencil size={14} aria-hidden />Edit draft</button>}
          {rb.status === 'DRAFT' && <button className="btn btn-primary" data-testid="submit-review" disabled={ro || errs.length > 0} onClick={() => dispatch({ type: 'SUBMIT_REVIEW', runbookId: rb.id, version: rb.version })}><Send size={14} aria-hidden />Submit for review</button>}
          {rb.status === 'UNDER_REVIEW' && <button className="btn" disabled={!isAdmin} onClick={() => { setText(''); setModal('return'); }}><Undo2 size={14} aria-hidden />Return to draft</button>}
          {rb.status === 'UNDER_REVIEW' && <button className="btn btn-primary" data-testid="publish" disabled={!isAdmin || errs.length > 0} onClick={() => { setText(''); setModal('publish'); }}><Upload size={14} aria-hidden />Approve &amp; publish</button>}
          {(rb.status === 'APPROVED' || rb.status === 'RETIRED') && <button className="btn" disabled={!isAdmin || versions.some((v) => v.status === 'DRAFT' || v.status === 'UNDER_REVIEW')} onClick={() => dispatch({ type: 'NEW_VERSION', runbookId: rb.id })}><FilePlus2 size={14} aria-hidden />New version</button>}
          {rb.status === 'APPROVED' && <button className="btn btn-danger" disabled={!isAdmin} onClick={() => { setText(''); setModal('retire'); }}><Archive size={14} aria-hidden />Retire</button>}
        </div>
      </div>
      <DisabledReason reason={ro ? 'Manager role is read-only.' : rb.status === 'DRAFT' && errs.length ? `Submission blocked: ${errs.join('; ')}` : rb.status === 'UNDER_REVIEW' && !isAdmin ? 'Only an administrator can approve and publish. AI-generated runbooks never become executable without administrator validation.' : !isAdmin && rb.status === 'APPROVED' ? 'Only Admin can change maturity, create versions or retire.' : null} />

      <ol className="lifecycle" aria-label="Runbook lifecycle">
        {LIFECYCLE.map((st, i) => <li key={st.key} className={i < stageIdx ? 'done' : i === stageIdx ? 'current' : ''}>{i < stageIdx ? <CheckCircle2 size={14} aria-hidden /> : i === stageIdx ? <CircleDashed size={14} aria-hidden /> : <Circle size={14} aria-hidden />}{st.label}</li>)}
        <li className={stage === 'AUTOMATED' ? 'current' : ''}>{stage === 'AUTOMATED' ? <CheckCircle2 size={14} aria-hidden /> : <Circle size={14} aria-hidden />}Policy-based automation (L3/L4)</li>
      </ol>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <section className="card stack">
          <h2>Definition</h2>
          <dl className="kv">
            <dt>Category</dt><dd>{CATEGORY_LABEL[rb.category]}</dd>
            {rb.rootCause && <><dt>Root cause</dt><dd>{rb.rootCause}</dd></>}
            {rb.applicability && <><dt>Applicability</dt><dd>{rb.applicability}</dd></>}
            <dt>Executable</dt><dd>{isExecutable(rb) ? `Yes — simulator action: ${SIM_ACTIONS[rb.actionKey!]!.label}` : rb.actionKey ? 'Not until approved and published' : 'No — guidance only (L1)'}</dd>
            <dt>Supported OS</dt><dd>{rb.supportedOS.join(', ') || '—'}</dd>
            <dt>Impact</dt><dd>{rb.disruptive ? 'Disruptive (employee consent)' : 'Non-disruptive'} · ~{rb.expectedMin} min · restart {rb.restartRequired ? 'required' : 'not required'}</dd>
            <dt>Owner</dt><dd>{rb.owner}</dd>
            <dt>Reviewer</dt><dd>{rb.reviewedBy ?? '—'}{rb.submittedBy ? ` · submitted by ${rb.submittedBy} ${fmtShort(rb.submittedAt)}` : ''}</dd>
            <dt>Approved</dt><dd>{fmtShort(rb.publishedAt)}</dd>
            <dt>Tested scenario</dt><dd>{rb.testedScenario || <span className="muted">Not provided</span>}</dd>
            <dt>Attempts / success</dt><dd>{stats.attempts} completed · {fmtPct(stats.success, 1)} verified (all versions)</dd>
            {rb.sourceTicketIds.length > 0 && <><dt>Source tickets</dt><dd className="row">{rb.sourceTicketIds.slice(0, 8).map((t) => <Link key={t} to={`/incidents/${t}`}>{state.tickets[t]?.displayId}</Link>)}{rb.sourceTicketIds.length > 8 && <span className="muted">+{rb.sourceTicketIds.length - 8}</span>}</dd></>}
          </dl>
          <h3>Steps</h3>
          <div className="table-wrap"><table className="data"><thead><tr><th>ID</th><th>Description</th><th>Type</th><th>Risk</th><th>Approval</th><th>Depends</th></tr></thead>
            <tbody>{rb.stepDefs.map((s) => <tr key={s.id}><td>{s.id}</td><td>{s.description}<div className="small muted">Expected: {s.expectedResult}</div></td><td className="small">{s.type.toLowerCase()}</td><td><RiskBadge risk={s.risk} /></td><td className="small">{s.approval === 'STEP' ? 'Step approval' : s.approval === 'PLAN' ? 'Plan approval' : 'Auto (read-only)'}</td><td className="small">{s.dependsOn.join(', ') || '—'}</td></tr>)}</tbody></table></div>
          <h3>Prerequisites</h3><ul>{rb.prerequisites.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <h3>Verification criteria</h3><ul>{rb.checks.map((s, i) => <li key={i}>{s}</li>)}</ul>
          {rb.risks && rb.risks.length > 0 && <><h3>Risks</h3><ul>{rb.risks.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
          <h3>Recovery</h3><p>{rb.reversible ? `Reversible: ${rb.rollbackSteps.join('; ')}.` : 'Irreversible.'} {rb.recoveryNote || <span className="muted">No recovery declaration yet.</span>}</p>
        </section>
        <div className="stack-16">
          <section className="card stack" aria-label="Automation maturity">
            <h2>Automation maturity</h2>
            <p><MaturityBadge m={rb.maturity} /> <strong>{MATURITY_LABEL[rb.maturity]}</strong></p>
            <ul className="clean small">{([0, 1, 2, 3, 4] as Maturity[]).map((m) => <li key={m} style={{ opacity: m === rb.maturity ? 1 : 0.65 }}>{m <= rb.maturity ? <CheckCircle2 size={14} color="var(--success)" aria-hidden /> : <Circle size={14} aria-hidden />}{MATURITY_LABEL[m]}</li>)}</ul>
            {isExecutable(rb) && rb.maturity < 4 && (
              <div className="stack">
                <h3>Eligibility for {MATURITY_LABEL[next]}</h3>
                <ul className="clean small" data-testid="maturity-criteria">{crit.map((c) => <li key={c.label}>{c.met ? <CheckCircle2 size={14} color="var(--success)" aria-hidden /> : <XCircle size={14} color="var(--danger)" aria-hidden />}<span>{c.label} <span className="muted">— {c.detail}</span></span></li>)}</ul>
                <div className="row"><button className="btn btn-primary btn-sm" data-testid="promote" disabled={!isAdmin || crit.some((c) => !c.met)} onClick={() => { setText(''); setModal({ maturity: next }); }}><ArrowUpCircle size={14} aria-hidden />Promote to L{next}</button>
                  {rb.maturity > 2 && <button className="btn btn-sm" disabled={!isAdmin} onClick={() => { setText(''); setModal({ maturity: (rb.maturity - 1) as Maturity }); }}><ArrowDownCircle size={14} aria-hidden />Demote to L{rb.maturity - 1}</button>}</div>
                <DisabledReason reason={!isAdmin ? 'Promotion requires explicit administrator authorization' : crit.some((c) => !c.met) ? 'Eligibility criteria not met' : null} />
              </div>
            )}
            {rb.maturity === 4 && <button className="btn btn-sm" disabled={!isAdmin} onClick={() => { setText(''); setModal({ maturity: 3 }); }}><ArrowDownCircle size={14} aria-hidden />Demote to L3</button>}
            <p className="small muted" style={{ margin: 0 }}>New and re-published versions start at L2 (supervised). Mandatory preflight checks, consent and the global policy switch apply at every level; L3 covers employee-reported incidents, L4 also proactive detections.</p>
            {rb.maturityHistory.length > 0 && <details className="disclosure"><summary>Maturity history ({rb.maturityHistory.length})</summary><ul className="small">{rb.maturityHistory.map((h, i) => <li key={i}>{fmtShort(h.at)} · L{h.from} → L{h.to} by {h.actor}: {h.reason}</li>)}</ul></details>}
          </section>
          <section className="card"><h2>Version history</h2>
            <div className="table-wrap"><table className="data"><thead><tr><th>Version</th><th>Status</th><th>Reviewer · approved</th><th>Outcomes</th><th>Note</th></tr></thead>
              <tbody>{versions.map((v) => { const o = versionOutcomes(v.version); return <tr key={v.version} className="clickable" onClick={() => setSel(v.version)} aria-selected={v.version === rb.version}><td><button className="btn-link" onClick={() => setSel(v.version)}>v{v.version}</button>{v.version === rb.version && ' (viewing)'}</td><td>{stageBadge(lifecycleStage(state, v))}</td><td className="small">{v.reviewedBy ?? '—'} · {fmtShort(v.publishedAt)}{v.retiredAt ? ` · retired ${fmtShort(v.retiredAt)}` : ''}</td><td className="small">{o.completed ? `${o.passed}/${o.completed} verified${o.rolledBack ? ` · ${o.rolledBack} rolled back` : ''}${o.rollbackFailed ? ` · ${o.rollbackFailed} rollback failed` : ''}` : '—'}</td><td className="small">{v.changeNote}</td></tr>; })}</tbody></table></div>
            <p className="small muted" style={{ marginTop: 8 }}>Previous versions are never overwritten. Publishing a new version retires the prior approved version and invalidates pending plans and step approvals.</p>
          </section>
          <section className="card"><h2>Pending plans using {rb.id}</h2>
            {pending.length ? <ul className="clean">{pending.map((t) => <li key={t.id}><Link to={`/incidents/${t.id}`}>{t.displayId}</Link> {t.title}</li>)}</ul> : <p className="muted small">None.</p>}
          </section>
        </div>
      </div>
      {modal === 'edit' && <DraftEditor rb={rb} onDone={() => setModal(null)} />}
      {modal === 'publish' && (
        <Modal title={`Approve & publish ${rb.id} v${rb.version}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" data-testid="confirm-publish" disabled={text.trim().length < 3} onClick={() => { const r = dispatch({ type: 'PUBLISH_RUNBOOK', runbookId: rb.id, version: rb.version, note: text }); if (r.ok) setModal(null); }}>Publish</button></>}>
          <p>{rb.actionKey ? 'This version becomes executable at L2 (supervised, human-approved) — never autonomous until separately promoted.' : 'This publishes guidance only (L1); it can never execute device actions.'} Any approved version of {rb.id} will be retired and pending plans re-evaluated.</p>
          <label className="field">Review note<input type="text" data-autofocus value={text} onChange={(e) => setText(e.target.value)} /></label>
        </Modal>
      )}
      {(modal === 'retire' || modal === 'return') && (
        <Modal title={modal === 'retire' ? `Retire ${rb.id} v${rb.version}` : 'Return to draft'} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className={`btn ${modal === 'retire' ? 'btn-danger-solid' : 'btn-primary'}`} disabled={text.trim().length < 3} onClick={() => { const r = dispatch(modal === 'retire' ? { type: 'RETIRE_RUNBOOK', runbookId: rb.id, version: rb.version, reason: text } : { type: 'RETURN_TO_DRAFT', runbookId: rb.id, version: rb.version, reason: text }); if (r.ok) setModal(null); }}>{modal === 'retire' ? 'Retire' : 'Return'}</button></>}>
          {modal === 'retire' && <p>{pending.length} pending plan(s) reference this runbook and will be invalidated and re-diagnosed.</p>}
          <label className="field">Reason<input type="text" data-autofocus value={text} onChange={(e) => setText(e.target.value)} /></label>
        </Modal>
      )}
      {modal && typeof modal === 'object' && (
        <Modal title={`Change maturity to ${MATURITY_LABEL[modal.maturity]}`} onClose={() => setModal(null)} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" data-testid="confirm-maturity" disabled={text.trim().length < 3} onClick={() => { const r = dispatch({ type: 'SET_MATURITY', runbookId: rb.id, version: rb.version, to: modal.maturity, reason: text }); if (r.ok) setModal(null); }}>Confirm</button></>}>
          <p>{modal.maturity > rb.maturity ? 'Promotion grants more autonomy. It takes effect only when the global policy preapproval switch is on, and every preflight, consent and risk rule still applies.' : 'Demotion reduces autonomy immediately for new plans.'}</p>
          <label className="field">Documented reason (required)<input type="text" data-autofocus value={text} onChange={(e) => setText(e.target.value)} /></label>
        </Modal>
      )}
    </div>
  );
}
