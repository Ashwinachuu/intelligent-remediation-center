import { useEffect, useState } from 'react';
import { Lock, Save } from 'lucide-react';
import { useStore } from '../app/store';
import { CATEGORIES, CATEGORY_LABEL, DEFAULT_SETTINGS } from '../domain/catalog';
import { validateSettings } from '../domain/policy';
import type { Category, Settings } from '../domain/types';
import { DisabledReason, fmtShort } from '../components/ui';

type Draft = Omit<Settings, 'version'>;
const strip = (s: Settings): Draft => { const { version: _v, ...r } = s; void _v; return JSON.parse(JSON.stringify(r)); };

/** AI Settings (V1.2 §17) — only the essentials. Approval and verification are always on. */
export function AiSettingsPage() {
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const [d, setD] = useState<Draft>(strip(state.settings));
  const [reason, setReason] = useState('');
  useEffect(() => { setD(strip(state.settings)); }, [state.settings]);
  const errs = validateSettings({ ...d, version: 0 });
  const dirty = JSON.stringify(d) !== JSON.stringify(strip(state.settings));
  const num = (v: string) => (v === '' ? NaN : Number(v));
  return (
    <div className="narrow">
      <div className="page-head"><div><h1>AI Settings</h1><p>A few controls for how AI behaves; the safety controls are fixed. Current version v{state.settings.version}.</p></div></div>
      <h2 className="settings-group-title">AI behavior — you can tune</h2>
      <div className="card stack-16">
        <section className="setting"><div><h3>Confidence threshold</h3><p className="small muted">Minimum AI confidence needed to <strong>recommend</strong> a fix. Below it, AI escalates to a human instead. 80% is an illustrative prototype assumption — scores are simulated, not calibrated.</p></div>
          <label className="field" style={{ maxWidth: 140 }}>Threshold (%)<input type="number" min={50} max={99} value={Number.isFinite(d.confidenceThreshold) ? d.confidenceThreshold : ''} onChange={(e) => setD({ ...d, confidenceThreshold: num(e.target.value) })} data-testid="threshold" /></label></section>
        <section className="setting"><div><h3>Troubleshooting limit</h3><p className="small muted">Unsuccessful employee troubleshooting attempts before the ticket goes to IT automatically.</p></div>
          <label className="field" style={{ maxWidth: 140 }}>Attempts<input type="number" min={1} max={5} value={Number.isFinite(d.troubleshootingAttempts) ? d.troubleshootingAttempts : ''} onChange={(e) => setD({ ...d, troubleshootingAttempts: num(e.target.value) })} /></label></section>
        <section className="setting"><div><h3>Employee consent</h3><p className="small muted">Ask the employee before disruptive fixes (restarts, adapter resets, updates).</p></div>
          <label className="switch"><input type="checkbox" role="switch" checked={d.consentRequired} onChange={(e) => setD({ ...d, consentRequired: e.target.checked })} />Required</label></section>
        <section className="setting"><div><h3>Approval expiry</h3><p className="small muted">An approval that hasn’t started running within this time expires and needs a fresh decision.</p></div>
          <label className="field" style={{ maxWidth: 140 }}>Minutes<input type="number" min={5} max={1440} value={Number.isFinite(d.approvalTTLMin) ? d.approvalTTLMin : ''} onChange={(e) => setD({ ...d, approvalTTLMin: num(e.target.value) })} /></label></section>
      </div>
      <h2 className="settings-group-title" style={{ marginTop: 20 }}>Safety controls — always on, not configurable</h2>
      <div className="card stack-16" data-testid="safety-controls">
        <section className="setting locked"><div><h3><Lock size={14} aria-hidden /> Human approval</h3><p className="small muted">Every AI-executed fix needs explicit IT administrator approval. Confidence only decides whether a fix can be recommended — never whether it runs.</p></div><span className="badge b-success">Always on</span></section>
        <section className="setting locked"><div><h3><Lock size={14} aria-hidden /> Resolution verification</h3><p className="small muted">AI-remediated incidents close only after the expected outcome is verified.</p></div><span className="badge b-success">Always on</span></section>
        <section className="setting locked"><div><h3><Lock size={14} aria-hidden /> Prerequisite checks</h3><p className="small muted">Laptop online, compatible, battery and storage are checked right before every run. An approval never overrides a failed check.</p></div><span className="badge b-success">Always on</span></section>
      </div>
      <div className="card stack-16" style={{ marginTop: 16 }}>
        <details className="disclosure" data-testid="reporting-assumptions"><summary>Reporting assumptions — estimated admin time saved (doesn’t change AI behavior)</summary>
          <section className="stack" style={{ marginTop: 8 }}>
          <p className="small muted">Used only for the Overview’s <em>estimated</em> admin time saved: manual handling baseline − admin minutes actually spent (review/approval, rollback, manual work).</p>
          <div className="row">
            <label className="field" style={{ maxWidth: 200 }}>Admin review &amp; approval effort (min)<input type="number" min={0} value={Number.isFinite(d.reviewEffortMin) ? d.reviewEffortMin : ''} onChange={(e) => setD({ ...d, reviewEffortMin: num(e.target.value) })} /></label>
            <label className="field" style={{ maxWidth: 200 }}>Rollback effort (min)<input type="number" min={0} value={Number.isFinite(d.rollbackEffortMin) ? d.rollbackEffortMin : ''} onChange={(e) => setD({ ...d, rollbackEffortMin: num(e.target.value) })} /></label>
          </div>
          <div className="table-wrap"><table className="data"><thead><tr><th>Incident category</th><th>Manual handling baseline (min)</th></tr></thead>
            <tbody>{CATEGORIES.map((c: Category) => <tr key={c}><td>{CATEGORY_LABEL[c]}</td><td><input type="number" min={0} aria-label={`${CATEGORY_LABEL[c]} baseline minutes`} value={Number.isFinite(d.baselines[c]) ? d.baselines[c] : ''} onChange={(e) => setD({ ...d, baselines: { ...d.baselines, [c]: num(e.target.value) } })} style={{ maxWidth: 120 }} /></td></tr>)}</tbody></table></div>
        </section>
        </details>
        {errs.length > 0 && <div className="banner danger" role="alert">{errs.join('; ')}</div>}
        <label className="field">Reason for the change *<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pilot data shows 85% is safer" data-testid="settings-reason" /></label>
        <div className="row">
          <button className="btn btn-primary" data-testid="save-settings" disabled={!dirty || errs.length > 0 || reason.trim().length < 3} onClick={() => { const r = dispatch({ type: 'SAVE_SETTINGS', settings: d, reason }); if (r.ok) setReason(''); }}><Save size={14} aria-hidden />Save settings</button>
          <button className="btn" disabled={!dirty} onClick={() => setD(strip(state.settings))}>Discard</button>
          <button className="btn btn-ghost" onClick={() => setD(strip(DEFAULT_SETTINGS))}>Reset to defaults</button>
        </div>
        <DisabledReason reason={dirty && reason.trim().length < 3 ? 'Enter a reason to save' : null} />
        <p className="small muted">Changing the confidence threshold re-evaluates pending recommendations; any approvals for them are invalidated.</p>
      </div>
      <h2 style={{ marginTop: 24 }}>History</h2>
      <ul className="clean small">{state.settingsHistory.slice().reverse().map((h) => <li key={h.settings.version}>v{h.settings.version} · {fmtShort(h.at)} · {h.actor}: {h.reason} (threshold {h.settings.confidenceThreshold}%, attempts {h.settings.troubleshootingAttempts}, consent {h.settings.consentRequired ? 'on' : 'off'})</li>)}</ul>
    </div>
  );
}
