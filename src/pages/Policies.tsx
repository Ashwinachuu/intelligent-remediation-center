import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, History, RotateCcw, Save } from 'lucide-react';
import { useStore } from '../app/store';
import { CATEGORY_LABEL, DEFAULT_SCORE, HEALTHY_DEVICE, SCENARIOS, symptomFor } from '../domain/catalog';
import { findRunbook } from '../domain/diagnosis';
import { previewPolicyImpact } from '../domain/engine';
import { MATRIX_SCORES, evaluateRoute, routeMatrix, validatePolicy } from '../domain/policy';
import { STATUS_LABEL } from '../domain/transitions';
import type { Device, Policy } from '../domain/types';
import { DisabledReason, Modal, fmtShort } from '../components/ui';

type Draft = Omit<Policy, 'version'>;
const strip = (p: Policy): Draft => { const { version: _v, ...r } = p; void _v; return r; };

export function PoliciesPage() {
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const isAdmin = state.settings.role === 'ADMIN';
  const [draft, setDraft] = useState<Draft>(strip(state.policy));
  const [reason, setReason] = useState('');
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [restore, setRestore] = useState(false);
  const [restoreReason, setRestoreReason] = useState('');
  const [sample, setSample] = useState({ key: 'A', group: 'Standard' as Device['group'], online: true, managed: true });
  useEffect(() => { setDraft(strip(state.policy)); }, [state.policy]);
  const errs = validatePolicy({ ...draft, version: 0 });
  const dirty = JSON.stringify(draft) !== JSON.stringify(strip(state.policy));
  const impact = useMemo(() => previewPolicyImpact(state, draft), [state, draft]);
  const matrix = useMemo(() => routeMatrix({ ...draft, version: state.policy.version + 1 }, { ...HEALTHY_DEVICE, id: 'sample', name: 'Sample' }), [draft, state.policy.version]);
  const sampleResult = useMemo(() => {
    const sc = SCENARIOS.find((s) => s.key === sample.key)!;
    const rb = findRunbook(state.runbooks, sc.category);
    const device: Device = { ...HEALTHY_DEVICE, ...symptomFor(sc.category), ...sc.device, id: 's', name: 's', group: sample.group, online: sample.online && (sc.device.online ?? true), managed: sample.managed };
    const risk = rb ? (sample.group === 'Critical' && rb.disruptive ? 'HIGH' : rb.risk) : DEFAULT_SCORE[sc.category].risk;
    return { sc, rb, r: evaluateRoute({ confidence: DEFAULT_SCORE[sc.category].score, risk, runbook: rb, device, policy: { ...draft, version: 0 }, approvalValid: false, consentValid: false, now: Date.now() }) };
  }, [sample, draft, state.runbooks]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const num = (k: 'reviewThreshold' | 'approvalThreshold' | 'autoThreshold' | 'approvalTTLMin' | 'maxAttempts') => (
    <input type="number" step={1} value={Number.isFinite(draft[k]) ? draft[k] : ''} disabled={!isAdmin} onChange={(e) => set(k, e.target.value === '' ? NaN : Number(e.target.value))} />
  );

  return (
    <div>
      <div className="page-head"><div><h1>Policies</h1><p>Deterministic policy engine controlling routes, preapproval and closure. Current version: <strong>v{state.policy.version}</strong>.</p></div>
        <button className="btn" disabled={!isAdmin} onClick={() => { setRestoreReason('Restore default policy'); setRestore(true); }}><RotateCcw size={14} aria-hidden />Restore defaults</button>
      </div>
      {!isAdmin && <div className="banner"><AlertTriangle size={16} aria-hidden />Read-only: only the Admin role can change policy. Switch the simulated role to Admin to edit.</div>}
      <div className="grid grid-2">
        <section className="card stack" aria-label="Policy settings">
          <h2>Settings</h2>
          <label className="switch"><input type="checkbox" role="switch" checked={!draft.enabled} disabled={!isAdmin} onChange={(e) => set('enabled', !e.target.checked)} aria-describedby="pause-hint" />Master pause (stop new automated starts)</label>
          <span id="pause-hint" className="small muted">Pause routes new/pending plans to review. In-flight actions stop before the next mutation; already-applied changes still verify and can roll back.</span>
          <label className="switch"><input type="checkbox" role="switch" data-testid="preapproval" checked={draft.autoEnabled} disabled={!isAdmin} onChange={(e) => { if (e.target.checked) setConfirmAuto(true); else set('autoEnabled', false); }} />Policy preapproval for LOW-risk catalog runbooks</label>
          <span className="small muted">Only LOW-risk, non-disruptive, published runbooks marked preapproved with score ≥ auto threshold. MEDIUM/HIGH never auto-execute.</span>
          <div className="grid grid-3">
            <label className="field">Review threshold{num('reviewThreshold')}</label>
            <label className="field">Approval threshold{num('approvalThreshold')}</label>
            <label className="field">Auto threshold{num('autoThreshold')}</label>
            <label className="field">Approval expiry (min){num('approvalTTLMin')}</label>
            <label className="field">Attempt limit{num('maxAttempts')}</label>
            <label className="field">Closure mode<select value={draft.closureMode} disabled={!isAdmin} onChange={(e) => set('closureMode', e.target.value as Policy['closureMode'])}><option value="AUTO">Auto-close after verification</option><option value="EMPLOYEE_CONFIRM">Employee confirmation</option></select></label>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Allowed device groups</legend>
            <div className="row">{(['Standard', 'Critical'] as const).map((g) => <label key={g} className="check"><input type="checkbox" disabled={!isAdmin} checked={draft.allowedGroups.includes(g)} onChange={(e) => set('allowedGroups', e.target.checked ? [...draft.allowedGroups, g] : draft.allowedGroups.filter((x) => x !== g))} />{g}</label>)}</div>
          </fieldset>
          {errs.length > 0 && <div className="banner danger" role="alert"><AlertTriangle size={16} aria-hidden /><div>{errs.join('; ')}</div></div>}
          <label className="field">Reason for this version (required)<textarea value={reason} disabled={!isAdmin} onChange={(e) => setReason(e.target.value)} placeholder="Why is this change needed?" /></label>
          <p className="small" aria-live="polite">{dirty ? <>Saving will create <strong>v{state.policy.version + 1}</strong> and re-evaluate <strong>{impact.tickets}</strong> nonrunning ticket(s); <strong>{impact.approvals}</strong> outstanding approval(s) will be invalidated (plans bind policy version).</> : 'No changes.'}</p>
          <div className="row"><button className="btn btn-primary" data-testid="save-policy" disabled={!isAdmin || !dirty || errs.length > 0 || reason.trim().length < 3} onClick={() => { const r = dispatch({ type: 'SAVE_POLICY', policy: draft, reason }); if (r.ok) setReason(''); }}><Save size={14} aria-hidden />Save new version</button>
            <button className="btn" disabled={!dirty} onClick={() => setDraft(strip(state.policy))}>Discard changes</button></div>
          <DisabledReason reason={!isAdmin ? 'Admin role required' : dirty && reason.trim().length < 3 ? 'Enter a reason to save' : null} />
        </section>
        <div className="stack-16">
          <section className="card" aria-label="Route matrix">
            <h2>Live route matrix</h2>
            <p className="small muted">Computed by the same policy function with the settings on the left, for a healthy managed Standard device and a catalog runbook (LOW: preapproved, non-disruptive; MEDIUM/HIGH: disruptive), before any approval.</p>
            <div className="table-wrap"><table className="data matrix"><thead><tr><th>Risk \ score</th>{MATRIX_SCORES.map((s) => <th key={s}>{s}</th>)}</tr></thead>
              <tbody>{matrix.map((row) => <tr key={row.risk}><th scope="row">{row.risk}</th>{row.cells.map((c) => <td key={c.score} title={c.reason}>{STATUS_LABEL[c.route]}</td>)}</tr>)}</tbody></table></div>
          </section>
          <section className="card stack" aria-label="Sample evaluator">
            <h2>Sample scenario evaluator (read-only)</h2>
            <div className="grid grid-2">
              <label className="field">Scenario<select value={sample.key} onChange={(e) => setSample({ ...sample, key: e.target.value })}>{SCENARIOS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
              <label className="field">Device group<select value={sample.group} onChange={(e) => setSample({ ...sample, group: e.target.value as Device['group'] })}><option>Standard</option><option>Critical</option></select></label>
              <label className="check"><input type="checkbox" checked={sample.online} onChange={(e) => setSample({ ...sample, online: e.target.checked })} />Online</label>
              <label className="check"><input type="checkbox" checked={sample.managed} onChange={(e) => setSample({ ...sample, managed: e.target.checked })} />Managed</label>
            </div>
            <p><strong>{CATEGORY_LABEL[sampleResult.sc.category]}</strong> · score {DEFAULT_SCORE[sampleResult.sc.category].score} · {sampleResult.rb ? `${sampleResult.rb.id} v${sampleResult.rb.version}` : 'no runbook'} → <strong>{STATUS_LABEL[sampleResult.r.route]}</strong></p>
            <ul className="clean small">{sampleResult.r.reasons.map((x, i) => <li key={i}>• {x}</li>)}</ul>
          </section>
          <section className="card" aria-label="Policy history">
            <h2><History size={16} aria-hidden />Version history</h2>
            <div className="table-wrap"><table className="data"><thead><tr><th>Version</th><th>When</th><th>By</th><th>Summary</th><th>Reason</th></tr></thead>
              <tbody>{[...state.policyHistory].reverse().map((h) => <tr key={h.policy.version}><td>v{h.policy.version}{h.policy.version === state.policy.version && <span className="badge b-success" style={{ marginLeft: 6 }}>Current</span>}</td><td>{fmtShort(h.at)}</td><td>{h.actor}</td><td className="small">{h.policy.enabled ? 'active' : 'PAUSED'} · preapproval {h.policy.autoEnabled ? 'on' : 'off'} · {h.policy.reviewThreshold}/{h.policy.approvalThreshold}/{h.policy.autoThreshold} · {h.policy.allowedGroups.join('+')} · TTL {h.policy.approvalTTLMin}m · {h.policy.closureMode === 'AUTO' ? 'auto-close' : 'employee confirm'}</td><td className="small">{h.reason}</td></tr>)}</tbody></table></div>
          </section>
        </div>
      </div>
      {confirmAuto && (
        <Modal title="Enable policy preapproval?" onClose={() => setConfirmAuto(false)} footer={<><button className="btn" onClick={() => setConfirmAuto(false)}>Cancel</button><button className="btn btn-primary" data-testid="confirm-preapproval" onClick={() => { set('autoEnabled', true); setConfirmAuto(false); }}>Enable preapproval</button></>}>
          <p>With preapproval, eligible LOW-risk plans (score ≥ {draft.autoThreshold}, runbook published and marked preapproved, non-disruptive, managed Standard device) execute <strong>without a per-ticket approval</strong>. Authorization is recorded as this policy version.</p>
          <p className="muted">MEDIUM and HIGH risk always require explicit approval. You still need to save the new policy version with a reason.</p>
        </Modal>
      )}
      {restore && (
        <Modal title="Restore default policy" onClose={() => setRestore(false)} footer={<><button className="btn" onClick={() => setRestore(false)}>Cancel</button><button className="btn btn-primary" disabled={restoreReason.trim().length < 3} onClick={() => { const r = dispatch({ type: 'RESTORE_DEFAULT_POLICY', reason: restoreReason }); if (r.ok) setRestore(false); }}>Create default version</button></>}>
          <p>Creates a new version with default values (history is preserved, nothing is erased).</p>
          <label className="field">Reason<input type="text" data-autofocus value={restoreReason} onChange={(e) => setRestoreReason(e.target.value)} /></label>
        </Modal>
      )}
    </div>
  );
}
