import type { Category, Device, Maturity, Risk, Runbook, RunbookStep, Outcome, ScenarioKey } from './types';

export const CATEGORIES: Category[] = ['STORAGE', 'DNS', 'SERVICE', 'WIFI', 'RESTART', 'APP_UPDATE', 'OS_UPDATE', 'CRASH', 'UNKNOWN'];
export const CATEGORY_LABEL: Record<Category, string> = {
  STORAGE: 'Storage', DNS: 'DNS', SERVICE: 'Service', WIFI: 'Wi-Fi', RESTART: 'Restart', APP_UPDATE: 'App update',
  OS_UPDATE: 'OS update', CRASH: 'Crash', UNKNOWN: 'Unknown',
};

/** Category-matched modeled baselines (agent min / resolution min). Spec §9. Modeled, not measured. */
export const BASELINES: Record<Category, { agentMin: number; resolutionMin: number }> = {
  STORAGE: { agentMin: 20, resolutionMin: 30 }, DNS: { agentMin: 15, resolutionMin: 25 }, SERVICE: { agentMin: 20, resolutionMin: 35 },
  WIFI: { agentMin: 30, resolutionMin: 45 }, RESTART: { agentMin: 15, resolutionMin: 35 }, APP_UPDATE: { agentMin: 25, resolutionMin: 60 },
  OS_UPDATE: { agentMin: 40, resolutionMin: 120 }, CRASH: { agentMin: 60, resolutionMin: 180 }, UNKNOWN: { agentMin: 45, resolutionMin: 120 },
};

/** Default, editable estimate assumptions (enhancement §9). Fictional currency amounts; estimates only. */
export const DEFAULT_ASSUMPTIONS = { hourlyCost: 40, currency: 'USD', baselines: JSON.parse(JSON.stringify(BASELINES)) as typeof BASELINES };

/** Default simulated scores and risk (Spec §5). Labelled simulated — not calibrated probabilities. */
export const DEFAULT_SCORE: Record<Category, { score: number; risk: Risk }> = {
  STORAGE: { score: 98, risk: 'LOW' }, DNS: { score: 97, risk: 'LOW' }, SERVICE: { score: 96, risk: 'LOW' },
  WIFI: { score: 94, risk: 'MEDIUM' }, RESTART: { score: 99, risk: 'MEDIUM' }, APP_UPDATE: { score: 92, risk: 'MEDIUM' },
  OS_UPDATE: { score: 93, risk: 'HIGH' }, CRASH: { score: 68, risk: 'HIGH' }, UNKNOWN: { score: 42, risk: 'HIGH' },
};
export const INCONSISTENT_SCORE = 65;

export const HEALTHY_DEVICE: Omit<Device, 'id' | 'name'> = {
  os: 'Windows 11', group: 'Standard', online: true, busy: false, managed: true, freeGB: 48, appVersion: '2.1',
  osVersion: '24H2', wifiHealthy: true, serviceHealthy: true, restartPending: false, dnsHealthy: true,
  batteryPct: 82, location: 'Remote · home office', networkId: 'HOME', kind: 'ENDPOINT',
};
/** Shared office network used by the correlation demo (scenario J). Fictional. */
export const SHARED_NETWORK = { location: 'Site B · Floor 2', networkId: 'NET-B2' };

/** Resolution SLA targets by priority (enhancement §1). */
export const SLA_HOURS: Record<'P2' | 'P3' | 'P4', number> = { P2: 4, P3: 8, P4: 24 };

export const MATURITY_LABEL: Record<Maturity, string> = {
  0: 'L0 · Manual resolution', 1: 'L1 · AI recommendation only', 2: 'L2 · Human-approved execution', 3: 'L3 · Policy-based autonomous', 4: 'L4 · Proactive policy-based',
};

const step = (id: string, description: string, type: RunbookStep['type'], risk: Risk, approval: RunbookStep['approval'], dependsOn: string[], expectedResult: string, verification: string, recoverable: boolean): RunbookStep =>
  ({ id, description, type, risk, approval, dependsOn, expectedResult, verification, recoverable });

/** Default 3-step structure: read-only preflight/snapshot -> plan-authorized action -> read-only post-check. */
export function defaultStepDefs(steps: string[], risk: Risk, checks: string[], reversible: boolean): RunbookStep[] {
  return [
    step('S1', steps[0] ?? 'Preflight', 'SNAPSHOT', 'LOW', 'NONE', [], 'Snapshot captured; prerequisites confirmed', 'Snapshot stored', true),
    step('S2', steps[1] ?? 'Action', 'ACTION', risk, 'PLAN', ['S1'], 'Intended change applied', checks.join('; ') || 'Change applied', reversible),
    step('S3', steps[2] ?? 'Post-check', 'DIAGNOSTIC', 'LOW', 'NONE', ['S2'], 'Post-change signals collected', 'Signals available for verification', true),
  ];
}

/** Fictional device condition that reproduces each category's symptom. */
export function symptomFor(cat: Category): Partial<Device> {
  switch (cat) {
    case 'STORAGE': return { freeGB: 3 };
    case 'DNS': return { dnsHealthy: false };
    case 'SERVICE': return { serviceHealthy: false };
    case 'WIFI': return { wifiHealthy: false };
    case 'RESTART': return { restartPending: true };
    case 'APP_UPDATE': return { appVersion: '2.0' };
    case 'OS_UPDATE': return { osVersion: '23H2' };
    default: return {};
  }
}

export interface TelemetryFinding { consistent: boolean; evidence: string[]; uncertainty: string[] }
/** Evidence must match current telemetry (Spec §5). */
export function telemetryFor(cat: Category, d: Device): TelemetryFinding {
  const ev = (ok: boolean, yes: string, no: string): TelemetryFinding =>
    ok ? { consistent: true, evidence: [yes], uncertainty: [] } : { consistent: false, evidence: [no], uncertainty: ['Reported symptom is not confirmed by current telemetry — request validation before acting.'] };
  switch (cat) {
    case 'STORAGE': return ev(d.freeGB < 10, `Free disk space ${d.freeGB} GB is below the 10 GB health threshold`, `Free disk space ${d.freeGB} GB is above the 10 GB threshold`);
    case 'DNS': return ev(!d.dnsHealthy, 'DNS probe failing: internal name resolution timed out (3/3 probes)', 'DNS probe currently passing');
    case 'SERVICE': return ev(!d.serviceHealthy, 'Background sync service reported stopped; non-critical service', 'Background sync service is running');
    case 'WIFI': return ev(!d.wifiHealthy, `Wi-Fi adapter unhealthy; management channel ${d.online ? 'reachable' : 'unreachable'}`, 'Wi-Fi adapter healthy and associated');
    case 'RESTART': return ev(d.restartPending, 'Pending restart flag set by servicing stack', 'No pending restart flag');
    case 'APP_UPDATE': return ev(d.appVersion !== '2.1', `Productivity app version ${d.appVersion}; allowlisted target 2.1`, `App already on allowlisted version ${d.appVersion}`);
    case 'OS_UPDATE': return ev(d.osVersion !== '24H2', `OS build ${d.osVersion}; approved patch 24H2 available`, `OS already on ${d.osVersion}`);
    case 'CRASH': return { consistent: true, evidence: ['Simulated crash evidence collected: 3 application faults in 24h, faulting module not in known-issue catalog'], uncertainty: ['Root cause not identified; no approved runbook for crash remediation.'] };
    default: return { consistent: true, evidence: ['Telemetry within normal ranges; symptom description does not match a catalog pattern'], uncertainty: ['Insufficient evidence to classify the incident.'] };
  }
}

/** Fixed simulator action catalog. No free-form commands — every action is an in-memory change to fictional state. */
export interface SimAction {
  key: Category; label: string;
  patch: (d: Device) => Partial<Device>;
  verify: (d: Device) => { pass: boolean; output: string };
  failOutput: string;
}
export const SIM_ACTIONS: Partial<Record<Category, SimAction>> = {
  STORAGE: { key: 'STORAGE', label: 'Clear approved disposable cache (+8 GB)', patch: (d) => ({ freeGB: d.freeGB + 8 }),
    verify: (d) => ({ pass: d.freeGB >= 10, output: `Free disk ${d.freeGB} GB (required ≥ 10 GB)` }), failOutput: 'Disk health probe reported write errors after cleanup' },
  DNS: { key: 'DNS', label: 'Refresh DNS resolver cache', patch: () => ({ dnsHealthy: true }),
    verify: (d) => ({ pass: d.dnsHealthy, output: `DNS probe ${d.dnsHealthy ? 'resolved 3/3 internal names' : 'failed'}` }), failOutput: 'DNS probe still failing 2/3 names' },
  SERVICE: { key: 'SERVICE', label: 'Restart non-critical background service', patch: () => ({ serviceHealthy: true }),
    verify: (d) => ({ pass: d.serviceHealthy, output: `Service state ${d.serviceHealthy ? 'Running' : 'Stopped'}` }), failOutput: 'Service stopped again 20s after restart' },
  WIFI: { key: 'WIFI', label: 'Snapshot config, reset adapter, renew config', patch: () => ({ wifiHealthy: true }),
    verify: (d) => ({ pass: d.wifiHealthy, output: `Connectivity probe ${d.wifiHealthy ? '3/3 endpoints reachable' : 'failed'}` }), failOutput: 'Connectivity probe 0/3 endpoints reachable after adapter reset' },
  RESTART: { key: 'RESTART', label: 'Check availability and simulate reboot', patch: () => ({ restartPending: false }),
    verify: (d) => ({ pass: !d.restartPending, output: `Device reconnected; restart pending=${d.restartPending}; uptime 2 min` }), failOutput: 'Device did not reconnect within verification window' },
  APP_UPDATE: { key: 'APP_UPDATE', label: 'Install allowlisted app version 2.1', patch: () => ({ appVersion: '2.1' }),
    verify: (d) => ({ pass: d.appVersion === '2.1', output: `App version ${d.appVersion}; health check passing` }), failOutput: 'App health check failing: launch crash after update' },
  OS_UPDATE: { key: 'OS_UPDATE', label: 'Apply approved patch 24H2', patch: () => ({ osVersion: '24H2' }),
    verify: (d) => ({ pass: d.osVersion === '24H2', output: `OS build ${d.osVersion}; post-patch health passing` }), failOutput: 'Post-patch health check failing: driver not loaded' },
};

export function seedRunbooks(at: string): Runbook[] {
  const base = (r: Partial<Runbook> & Pick<Runbook, 'id' | 'title' | 'category' | 'risk' | 'steps' | 'checks' | 'rollbackSteps' | 'reversible' | 'disruptive' | 'expectedMin' | 'maturity' | 'recoveryNote' | 'prerequisites'>): Runbook => ({
    version: 1, status: 'APPROVED', supportedOS: ['Windows 11'], owner: 'Morgan (Admin)', publishedAt: at, actionKey: r.category, reviewedBy: 'Morgan',
    diagnosticOnly: false, sourceTicketIds: [], createdAt: at, testedScenario: 'Simulator catalog scenario', changeNote: 'Initial catalog publication',
    stepDefs: r.stepDefs ?? defaultStepDefs(r.steps, r.risk, r.checks, r.reversible), restartRequired: false,
    maturityHistory: r.maturity > 2 ? [{ from: 2, to: r.maturity, at, actor: 'Morgan', reason: 'Pilot promotion (synthetic): LOW risk, non-disruptive, criteria met in pre-production' }] : [],
    ...r,
  });
  return [
    base({ id: 'RB-001', title: 'Clear approved disposable cache', category: 'STORAGE', risk: 'LOW', expectedMin: 3, maturity: 4, reversible: false, disruptive: false,
      steps: ['Preflight: confirm managed channel, record free space snapshot', 'Action: clear approved disposable cache locations only (no user files)', 'Verify: re-measure free disk space'],
      checks: ['Free disk space ≥ 10 GB'], rollbackSteps: [], recoveryNote: 'Cache removal is not reversible; only approved disposable cache is removed, never user files.', prerequisites: ['Managed endpoint online', 'Free space below 10 GB'] }),
    base({ id: 'RB-002', title: 'Refresh DNS resolver cache', category: 'DNS', risk: 'LOW', expectedMin: 2, maturity: 2, reversible: false, disruptive: false,
      steps: ['Preflight: confirm DNS probe failure, snapshot resolver settings', 'Action: flush and refresh DNS resolver cache', 'Verify: run DNS probe against 3 internal names'],
      checks: ['DNS probe resolves 3/3 internal names'], rollbackSteps: [], recoveryNote: 'No exact cache restoration exists; refresh is safe and self-healing.', prerequisites: ['Managed endpoint online', 'DNS probe failing'] }),
    base({ id: 'RB-003', title: 'Restart non-critical background service', category: 'SERVICE', risk: 'LOW', expectedMin: 4, maturity: 2, reversible: true, disruptive: false,
      steps: ['Preflight: snapshot service state, confirm service is non-critical', 'Action: restart background sync service', 'Verify: check service is running'],
      checks: ['Service state = Running'], rollbackSteps: ['Restore previous service state from snapshot'], recoveryNote: 'Previous service state is restored from the preflight snapshot.', prerequisites: ['Managed endpoint online', 'Service listed as non-critical'] }),
    base({ id: 'RB-004', title: 'Reset Wi-Fi adapter and renew configuration', category: 'WIFI', risk: 'MEDIUM', expectedMin: 5, maturity: 2, reversible: true, disruptive: true,
      steps: ['Preflight: snapshot network configuration', 'Action: reset adapter and renew configuration', 'Verify: connectivity probe to 3 endpoints'],
      checks: ['Connectivity probe 3/3 endpoints reachable'], rollbackSteps: ['Restore snapshotted network fields'], recoveryNote: 'Network fields are restored from the snapshot taken in preflight.', prerequisites: ['Management channel reachable', 'Employee consent (brief network drop)', 'Explicit agent approval'] }),
    base({ id: 'RB-005', title: 'Scheduled restart to clear pending reboot', category: 'RESTART', risk: 'MEDIUM', expectedMin: 8, maturity: 2, reversible: false, disruptive: true,
      steps: ['Preflight: check employee availability and unsaved-work signal', 'Action: simulate reboot', 'Verify: reconnect and uptime check'],
      restartRequired: true, checks: ['Device reconnects', 'Restart pending flag cleared'], rollbackSteps: [], recoveryNote: 'A reboot is irreversible; consent and agent approval are required.', prerequisites: ['Employee consent', 'Agent approval', 'Device not busy'] }),
    base({ id: 'RB-006', title: 'Install allowlisted app version 2.1', category: 'APP_UPDATE', risk: 'MEDIUM', expectedMin: 12, maturity: 2, reversible: true, disruptive: true,
      steps: ['Preflight: snapshot installed version, confirm 2.1 allowlisted', 'Action: install app version 2.1', 'Verify: version and app health check'],
      checks: ['App version = 2.1', 'App health check passing'], rollbackSteps: ['Restore previous app version from snapshot'], recoveryNote: 'Previous app version restored from snapshot.', prerequisites: ['Agent approval', 'Employee consent (app restarts)'] }),
    base({ id: 'RB-007', title: 'Apply approved OS patch 24H2', category: 'OS_UPDATE', risk: 'HIGH', expectedMin: 25, maturity: 2, reversible: true, disruptive: true,
      steps: ['Preflight: validate compatibility and maintenance window', 'Action: apply approved patch 24H2', 'Verify: OS version and post-patch health'],
      restartRequired: true,
      stepDefs: [
        step('S1', 'Compatibility & driver scan (read-only)', 'DIAGNOSTIC', 'LOW', 'NONE', [], 'Device compatible with 24H2; drivers on allowlist', 'Scan report generated', true),
        step('S2', 'Create restore point (snapshot)', 'SNAPSHOT', 'MEDIUM', 'PLAN', ['S1'], 'Restore point created', 'Restore point listed', true),
        step('S3', 'Apply approved OS patch 24H2 (restart)', 'ACTION', 'HIGH', 'STEP', ['S2'], 'OS build 24H2 installed', 'OS build = 24H2', true),
        step('S4', 'Post-patch signal collection (read-only)', 'DIAGNOSTIC', 'LOW', 'NONE', ['S3'], 'Health signals collected', 'Signals available for verification', true),
      ],
      checks: ['OS build = 24H2', 'Post-patch health passing'], rollbackSteps: ['Simulated restore to prior OS build (supported on Windows 11 only)'], recoveryNote: 'Simulated restore to the prior OS build where supported.', prerequisites: ['Admin approval', 'Employee consent', 'Scheduled maintenance window'] }),
    { id: 'RB-008', version: 1, title: 'Application crash triage (diagnostic only)', category: 'CRASH', status: 'DRAFT', risk: 'HIGH', supportedOS: ['Windows 11'],
      steps: ['Collect simulated crash evidence', 'Compare faulting module with known-issue list', 'Hand off to human reviewer'], checks: ['Crash evidence attached to ticket'], rollbackSteps: [],
      reversible: false, disruptive: false, expectedMin: 10, owner: 'Morgan (Admin)', maturity: 1, diagnosticOnly: true, prerequisites: ['Human review'],
      stepDefs: [step('S1', 'Collect simulated crash evidence', 'DIAGNOSTIC', 'LOW', 'NONE', [], 'Evidence attached', 'Evidence present', true)], maturityHistory: [], restartRequired: false,
      recoveryNote: 'Diagnostic only — no device change is made.', sourceTicketIds: [], createdAt: at, changeNote: 'Draft: safe diagnostic-only guidance; not executable' },
  ];
}

export const isExecutable = (r: Runbook) => r.status === 'APPROVED' && r.maturity >= 2 && !r.diagnosticOnly && !!r.actionKey && !!SIM_ACTIONS[r.actionKey] && r.actionKey === r.category;

/** Keyword inference for custom text (Spec §5). Multiple conflicting matches or no match -> UNKNOWN. */
const KEYWORDS: [Category, RegExp][] = [
  ['STORAGE', /\b(storage|disk|disk space|low space|drive full)\b/],
  ['DNS', /\bdns\b/],
  ['SERVICE', /\bservice\b/],
  ['WIFI', /\b(wi-?fi|wifi|wireless|network)\b/],
  ['RESTART', /\b(restart|reboot)\b/],
  ['APP_UPDATE', /\bapp(lication)? update\b/],
  ['OS_UPDATE', /\b(os update|os patch|windows update)\b/],
  ['CRASH', /\b(crash|crashes|crashing)\b/],
];
export function inferCategory(text: string): { category: Category; matches: Category[] } {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const matches = KEYWORDS.filter(([, re]) => re.test(t)).map(([c]) => c);
  return { category: matches.length === 1 ? matches[0] : 'UNKNOWN', matches };
}

export interface ScenarioDef { key: ScenarioKey; label: string; category: Category; outcome: Outcome; title: string; description: string; device: Partial<Device>; priority: 'P2' | 'P3' | 'P4'; source: 'EMPLOYEE' | 'DETECTION'; expected: string }
export const SCENARIOS: ScenarioDef[] = [
  { key: 'A', label: 'A · Storage cleanup', category: 'STORAGE', outcome: 'SUCCESS', title: 'Laptop almost out of disk space', description: 'Low disk warning; cannot save large files.', device: { freeGB: 3 }, priority: 'P3', source: 'DETECTION', expected: 'Approve then verified closed' },
  { key: 'B', label: 'B · Wi-Fi failure', category: 'WIFI', outcome: 'SUCCESS', title: 'Wi-Fi keeps disconnecting', description: 'Wi-Fi drops every few minutes in the office.', device: { wifiHealthy: false }, priority: 'P2', source: 'EMPLOYEE', expected: 'Approve, employee consent, verified closed' },
  { key: 'C', label: 'C · OS patch', category: 'OS_UPDATE', outcome: 'SUCCESS', title: 'Security patch 24H2 not installed', description: 'Compliance scan flagged missing OS patch.', device: { osVersion: '23H2' }, priority: 'P3', source: 'DETECTION', expected: 'Admin approval, consent, schedule' },
  { key: 'D', label: 'D · Wi-Fi verification failure', category: 'WIFI', outcome: 'VERIFY_FAIL', title: 'Wi-Fi unstable after dock change', description: 'Wireless connection unreliable since new dock.', device: { wifiHealthy: false }, priority: 'P2', source: 'EMPLOYEE', expected: 'Verification fails, rollback, escalated' },
  { key: 'E', label: 'E · Unknown crash', category: 'CRASH', outcome: 'SUCCESS', title: 'Design tool crashes on export', description: 'Application crashes whenever exporting a file.', device: {}, priority: 'P3', source: 'EMPLOYEE', expected: 'Review, manual resolution, draft' },
  { key: 'F', label: 'F · Offline Wi-Fi', category: 'WIFI', outcome: 'SUCCESS', title: 'Wi-Fi not working at home', description: 'Cannot connect to home Wi-Fi.', device: { wifiHealthy: false, online: false }, priority: 'P3', source: 'EMPLOYEE', expected: 'Reconnect, then approval/consent' },
  { key: 'G', label: 'G · Unknown hardware issue', category: 'UNKNOWN', outcome: 'SUCCESS', title: 'Laptop makes clicking noise', description: 'Intermittent clicking sound and slow response.', device: {}, priority: 'P3', source: 'EMPLOYEE', expected: 'Escalated, investigate manually' },
  { key: 'H', label: 'H · App rollback failure', category: 'APP_UPDATE', outcome: 'ROLLBACK_FAIL', title: 'Productivity app outdated', description: 'App shows update-required banner.', device: { appVersion: '2.0' }, priority: 'P4', source: 'DETECTION', expected: 'Failure, rollback fails, escalated' },
  { key: 'I', label: 'I · Multi-step OS patch', category: 'OS_UPDATE', outcome: 'SUCCESS', title: 'Quarterly OS patch with driver check', description: 'Multi-step patch: read-only scan runs automatically, pauses for admin at the high-risk install step.', device: { osVersion: '23H2' }, priority: 'P3', source: 'DETECTION', expected: 'Pauses at high-risk step for admin step approval' },
  { key: 'J', label: 'J · Shared network outage', category: 'WIFI', outcome: 'SUCCESS', title: 'Wi-Fi not connecting on Floor 2', description: 'Multiple employees on Site B Floor 2 report Wi-Fi connectivity drops.', device: { wifiHealthy: false, ...SHARED_NETWORK }, priority: 'P2', source: 'EMPLOYEE', expected: '3 reports correlated; parent incident, endpoint fixes paused' },
];

export const REQUESTERS = Array.from({ length: 40 }, (_, i) => `Employee ${String(i + 1).padStart(3, '0')}`);
export const ACTORS: Record<'AGENT' | 'ADMIN' | 'MANAGER', string> = { AGENT: 'Alex', ADMIN: 'Morgan', MANAGER: 'Riley' };

export const EVIDENCE_KINDS: { kind: import('./types').EvidenceKind; label: string; category?: Category }[] = [
  { kind: 'DISK_USAGE', label: 'Disk usage reading', category: 'STORAGE' },
  { kind: 'DNS_PROBE', label: 'DNS probe result', category: 'DNS' },
  { kind: 'SERVICE_STATUS', label: 'Service status', category: 'SERVICE' },
  { kind: 'WIFI_ADAPTER', label: 'Wi-Fi adapter status', category: 'WIFI' },
  { kind: 'RESTART_FLAG', label: 'Pending restart flag', category: 'RESTART' },
  { kind: 'APP_VERSION', label: 'App version check', category: 'APP_UPDATE' },
  { kind: 'OS_BUILD', label: 'OS build check', category: 'OS_UPDATE' },
  { kind: 'CRASH_DUMP', label: 'Crash dump summary', category: 'CRASH' },
  { kind: 'FREE_TEXT', label: 'Other observation (free text)' },
];
