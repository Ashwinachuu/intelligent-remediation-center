import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../app/store';
import { useUi } from '../app/ui-store';
import { CATEGORIES, CATEGORY_LABEL, HEALTHY_DEVICE, REQUESTERS, SCENARIOS, inferCategory, symptomFor } from '../domain/catalog';
import type { Category, Device, Outcome } from '../domain/types';
import { Modal } from './ui';

const OUTCOMES: { v: Outcome; label: string }[] = [
  { v: 'SUCCESS', label: 'Success' },
  { v: 'VERIFY_FAIL', label: 'Verification failure after action' },
  { v: 'EXEC_FAIL', label: 'Execution failure before action' },
  { v: 'ROLLBACK_FAIL', label: 'Rollback failure after verification failure' },
];

export function TelemetryPreview({ d }: { d: Omit<Device, 'id'> }) {
  const rows: [string, string, boolean][] = [
    ['OS', `${d.os} ${d.osVersion}`, d.os === 'Windows 11' && d.osVersion === '24H2'], ['Group', d.group, d.group === 'Standard'], ['Managed', d.managed ? 'Yes' : 'No', d.managed],
    ['Mgmt channel', d.online ? 'Online' : 'Offline', d.online], ['Employee busy', d.busy ? 'Yes' : 'No', !d.busy], ['Free disk', `${d.freeGB} GB`, d.freeGB >= 10],
    ['DNS', d.dnsHealthy ? 'Healthy' : 'Failing', d.dnsHealthy], ['Service', d.serviceHealthy ? 'Running' : 'Stopped', d.serviceHealthy], ['Wi-Fi', d.wifiHealthy ? 'Healthy' : 'Unhealthy', d.wifiHealthy],
    ['Restart pending', d.restartPending ? 'Yes' : 'No', !d.restartPending], ['App version', d.appVersion, d.appVersion === '2.1'],
  ];
  return (
    <dl className="kv" aria-label="Telemetry preview">
      {rows.map(([k, v, ok]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd style={{ color: ok ? undefined : 'var(--warning)', fontWeight: ok ? 400 : 600 }}>{v}{!ok && ' ⚠'}</dd></div>)}
    </dl>
  );
}

export function TicketCreator() {
  const { preset, closeCreator } = useUi();
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const nav = useNavigate();
  const sc0 = SCENARIOS.find((s) => s.key === preset) ?? SCENARIOS[0];
  const [title, setTitle] = useState(sc0.title);
  const [description, setDescription] = useState(sc0.description);
  const [requester, setRequester] = useState(REQUESTERS[0]);
  const [source, setSource] = useState<'EMPLOYEE' | 'DETECTION'>(sc0.source);
  const [priority, setPriority] = useState<'P2' | 'P3' | 'P4'>(sc0.priority);
  const [category, setCategory] = useState<Category | 'CUSTOM'>(sc0.category);
  const [outcome, setOutcome] = useState<Outcome>(sc0.outcome);
  const [deviceMode, setDeviceMode] = useState<'NEW' | string>('NEW');
  const [dev, setDev] = useState<Partial<Device>>({ os: 'Windows 11', group: 'Standard', managed: true, online: sc0.device.online ?? true, busy: false });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const applyScenario = (key: string) => {
    const sc = SCENARIOS.find((s) => s.key === key);
    if (!sc) return;
    setTitle(sc.title); setDescription(sc.description); setSource(sc.source); setPriority(sc.priority); setCategory(sc.category); setOutcome(sc.outcome);
    setDeviceMode('NEW'); setDev({ os: 'Windows 11', group: 'Standard', managed: true, online: sc.device.online ?? true, busy: false });
  };
  const inferred = useMemo(() => inferCategory(`${title} ${description}`), [title, description]);
  const effCat: Category = category === 'CUSTOM' ? inferred.category : category;
  const existing = Object.values(state.devices).filter((d) => d.name.includes('demo fleet') || Object.values(state.tickets).some((t) => t.demo && t.deviceId === d.id));
  const preview: Omit<Device, 'id'> = deviceMode === 'NEW'
    ? { ...HEALTHY_DEVICE, name: 'New demo device', ...symptomFor(effCat), ...dev } as Omit<Device, 'id'>
    : state.devices[deviceMode];
  const titleErr = title.trim().length < 3 || title.trim().length > 120 ? 'Title must be 3–120 characters' : '';
  const descErr = description.trim().length < 3 || description.trim().length > 1000 ? 'Description must be 3–1000 characters' : '';
  const valid = !titleErr && !descErr;

  const submit = () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    const r = dispatch({ type: 'CREATE_TICKET', input: {
      title, description, requester, source, priority, category, outcome, scenario: category === 'CUSTOM' ? 'CUSTOM' : undefined, demo: true,
      deviceId: deviceMode === 'NEW' ? undefined : deviceMode, newDevice: deviceMode === 'NEW' ? { ...symptomFor(effCat), ...dev } : undefined,
    } });
    setBusy(false);
    if (r.ok && r.ticketId) { closeCreator(); nav(`/incidents/${r.ticketId}`); }
  };

  return (
    <Modal title="Create ticket" onClose={closeCreator} wide footer={<><button className="btn" onClick={closeCreator}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={busy || (touched && !valid)} data-testid="submit-ticket">Create &amp; diagnose</button></>}>
      <div className="row">
        <span className="small muted">Load scenario:</span>
        {SCENARIOS.map((s) => <button key={s.key} type="button" className="btn btn-sm" onClick={() => applyScenario(s.key)} title={s.label}>{s.label}</button>)}
      </div>
      <div className="grid grid-2">
        <div className="stack">
          <label className="field">Title *<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-invalid={touched && !!titleErr} />{touched && titleErr && <span className="error-text">{titleErr}</span>}</label>
          <label className="field">Description *<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} aria-invalid={touched && !!descErr} />{touched && descErr && <span className="error-text">{descErr}</span>}<span className="hint">Fictional details only — no personal or sensitive data.</span></label>
          <div className="grid grid-2">
            <label className="field">Requester<select value={requester} onChange={(e) => setRequester(e.target.value)}>{REQUESTERS.map((r) => <option key={r}>{r}</option>)}</select></label>
            <label className="field">Source<select value={source} onChange={(e) => setSource(e.target.value as 'EMPLOYEE')}><option value="EMPLOYEE">Employee report</option><option value="DETECTION">Proactive detection</option></select></label>
            <label className="field">Priority<select value={priority} onChange={(e) => setPriority(e.target.value as 'P2')}><option>P2</option><option>P3</option><option>P4</option></select></label>
            <label className="field">Simulated outcome<select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>{OUTCOMES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></label>
          </div>
          <label className="field">Scenario / category
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              <option value="CUSTOM">Custom — infer from text</option>
            </select>
            <span className="hint">{category === 'CUSTOM' ? `Inferred category: ${CATEGORY_LABEL[inferred.category]}${inferred.matches.length > 1 ? ` (conflicting matches: ${inferred.matches.map((m) => CATEGORY_LABEL[m]).join(', ')})` : inferred.matches.length === 0 ? ' (no keyword match)' : ''}` : 'Scenario selection takes precedence over text.'}</span>
          </label>
        </div>
        <div className="stack">
          <label className="field">Device
            <select value={deviceMode} onChange={(e) => setDeviceMode(e.target.value)}>
              <option value="NEW">New demo device (configured for scenario)</option>
              {existing.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.os} · {d.group}{d.managed ? '' : ' · unmanaged'}</option>)}
            </select>
          </label>
          {deviceMode === 'NEW' ? (
            <div className="grid grid-2">
              <label className="field">OS<select value={dev.os} onChange={(e) => setDev({ ...dev, os: e.target.value as Device['os'], osVersion: e.target.value === 'macOS' ? '14.6' : effCat === 'OS_UPDATE' ? '23H2' : '24H2' })}><option>Windows 11</option><option>macOS</option></select></label>
              <label className="field">Group<select value={dev.group} onChange={(e) => setDev({ ...dev, group: e.target.value as Device['group'] })}><option>Standard</option><option>Critical</option></select></label>
              <label className="check"><input type="checkbox" checked={dev.managed} onChange={(e) => setDev({ ...dev, managed: e.target.checked })} />Managed endpoint</label>
              <label className="check"><input type="checkbox" checked={dev.online} onChange={(e) => setDev({ ...dev, online: e.target.checked })} />Management channel online</label>
              <label className="check"><input type="checkbox" checked={dev.busy} onChange={(e) => setDev({ ...dev, busy: e.target.checked })} />Employee busy</label>
            </div>
          ) : <p className="banner warn small" style={{ margin: 0 }}>Existing device: its current telemetry is used as-is and is NOT changed by creating this ticket. Evidence that does not match telemetry lowers the score to 65 and requests validation.</p>}
          <div className="card card-tight"><h3>Telemetry preview</h3><TelemetryPreview d={preview} /></div>
        </div>
      </div>
    </Modal>
  );
}
