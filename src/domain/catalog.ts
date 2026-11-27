import type { Category, Device, Employee, IssueType, Risk, Runbook, Settings } from './types';

export const CATEGORIES: Category[] = ['STORAGE', 'DNS', 'SERVICE', 'WIFI', 'RESTART', 'APP_UPDATE', 'OS_UPDATE', 'CRASH', 'UNKNOWN'];
export const CATEGORY_LABEL: Record<Category, string> = {
  STORAGE: 'Storage', DNS: 'DNS', SERVICE: 'Performance', WIFI: 'Wi-Fi', RESTART: 'Restart', APP_UPDATE: 'Software update',
  OS_UPDATE: 'OS update', CRASH: 'Application hang', UNKNOWN: 'Other',
};

/** Employee-facing issue categories (V1.2 §5) and the internal category each maps to. */
export const ISSUE_TYPES: { key: IssueType; label: string; category: Category; hint: string }[] = [
  { key: 'SLOW', label: 'Laptop running slowly', category: 'SERVICE', hint: 'Everything feels sluggish or freezes' },
  { key: 'WIFI', label: 'Unable to connect to Wi-Fi', category: 'WIFI', hint: 'No internet, or Wi-Fi keeps dropping' },
  { key: 'RESTART', label: 'Laptop restart required', category: 'RESTART', hint: 'You keep getting a restart message' },
  { key: 'STORAGE', label: 'Insufficient storage', category: 'STORAGE', hint: 'Disk full or "low space" warnings' },
  { key: 'APP_HANG', label: 'Application not responding', category: 'CRASH', hint: 'An app freezes or crashes' },
  { key: 'SOFTWARE_UPDATE', label: 'Software update required', category: 'APP_UPDATE', hint: 'An app asks to be updated' },
  { key: 'OS_UPDATE', label: 'Operating system update required', category: 'OS_UPDATE', hint: 'Windows update pending or failing' },
  { key: 'OTHER', label: 'Other issue', category: 'UNKNOWN', hint: 'Something else — describe it below' },
];
export const ISSUE_LABEL = Object.fromEntries(ISSUE_TYPES.map((x) => [x.key, x.label])) as Record<IssueType, string>;

/** Default manual handling baselines in minutes (illustrative prototype assumptions, editable in AI Settings). */
export const DEFAULT_BASELINES: Record<Category, number> = {
  STORAGE: 20, DNS: 15, SERVICE: 20, WIFI: 30, RESTART: 15, APP_UPDATE: 25, OS_UPDATE: 40, CRASH: 45, UNKNOWN: 45,
};
export const DEFAULT_SETTINGS: Settings = {
  version: 1, confidenceThreshold: 80, troubleshootingAttempts: 2, consentRequired: true, approvalTTLMin: 60,
  baselines: { ...DEFAULT_BASELINES }, reviewEffortMin: 3, rollbackEffortMin: 5,
};
export const SLA_HOURS: Record<'P2' | 'P3' | 'P4', number> = { P2: 4, P3: 8, P4: 24 };

/** Simulated, deterministic confidence per category (not calibrated probabilities). */
export const DEFAULT_SCORE: Record<Category, number> = {
  STORAGE: 98, DNS: 97, SERVICE: 92, WIFI: 94, RESTART: 96, APP_UPDATE: 92, OS_UPDATE: 93, CRASH: 55, UNKNOWN: 42,
};

export const HEALTHY_DEVICE: Omit<Device, 'id' | 'name'> = {
  os: 'Windows 11', group: 'Standard', online: true, busy: false, managed: true, freeGB: 48, appVersion: '2.1',
  osVersion: '24H2', wifiHealthy: true, serviceHealthy: true, restartPending: false, dnsHealthy: true, batteryPct: 82,
};
/** The simulated device condition behind each reported problem. */
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
/** What a successful employee self-fix changes in the simulated telemetry. */
export function healthyFor(cat: Category): Partial<Device> {
  switch (cat) {
    case 'STORAGE': return { freeGB: 24 };
    case 'DNS': return { dnsHealthy: true };
    case 'SERVICE': return { serviceHealthy: true };
    case 'WIFI': return { wifiHealthy: true };
    case 'RESTART': return { restartPending: false };
    case 'APP_UPDATE': return { appVersion: '2.1' };
    case 'OS_UPDATE': return { osVersion: '24H2' };
    default: return {};
  }
}

export interface TelemetryFinding { consistent: boolean; evidence: string }
export function telemetryFor(cat: Category, d: Device): TelemetryFinding {
  const f = (ok: boolean, yes: string, no: string) => ({ consistent: ok, evidence: ok ? yes : no });
  switch (cat) {
    case 'STORAGE': return f(d.freeGB < 10, `Free disk space ${d.freeGB} GB (below the 10 GB health threshold)`, `Free disk space ${d.freeGB} GB looks healthy`);
    case 'DNS': return f(!d.dnsHealthy, 'DNS probe failing for internal names', 'DNS probe passing');
    case 'SERVICE': return f(!d.serviceHealthy, 'Background sync service stuck and using high CPU', 'Background services healthy');
    case 'WIFI': return f(!d.wifiHealthy, 'Wi-Fi adapter reports repeated disconnects; device management channel still reachable', 'Wi-Fi adapter healthy');
    case 'RESTART': return f(d.restartPending, 'Pending restart flag set by the update service', 'No pending restart');
    case 'APP_UPDATE': return f(d.appVersion !== '2.1', `App version ${d.appVersion}; approved version is 2.1`, `App already on ${d.appVersion}`);
    case 'OS_UPDATE': return f(d.osVersion !== '24H2', `OS build ${d.osVersion}; approved patch 24H2 available`, `OS already on ${d.osVersion}`);
    case 'CRASH': return { consistent: true, evidence: 'Application fault events recorded; faulting module not in the known-issue list' };
    default: return { consistent: true, evidence: 'Telemetry within normal ranges; symptom does not match a known pattern' };
  }
}

/** Fixed simulator actions. No free-form commands; every action is an in-memory change to fictional state. */
export interface SimAction { label: string; patch: (d: Device) => Partial<Device>; verify: (d: Device) => { pass: boolean; output: string }; failOutput: string }
export const SIM_ACTIONS: Record<string, SimAction> = {
  STORAGE: { label: 'Clear approved temporary cache', patch: (d) => ({ freeGB: d.freeGB + 8 }), verify: (d) => ({ pass: d.freeGB >= 10, output: `Free disk ${d.freeGB} GB (needs ≥ 10 GB)` }), failOutput: 'Disk check reported errors after cleanup' },
  DNS: { label: 'Refresh DNS cache', patch: () => ({ dnsHealthy: true }), verify: (d) => ({ pass: d.dnsHealthy, output: 'DNS probe resolved 3/3 internal names' }), failOutput: 'DNS probe still failing' },
  SERVICE: { label: 'Restart the stuck background service', patch: () => ({ serviceHealthy: true }), verify: (d) => ({ pass: d.serviceHealthy, output: 'Service running; CPU back to normal' }), failOutput: 'Service stopped again 20 seconds after restart' },
  WIFI: { label: 'Reset Wi-Fi adapter and renew network settings', patch: () => ({ wifiHealthy: true }), verify: (d) => ({ pass: d.wifiHealthy, output: 'Connectivity check: 3/3 endpoints reachable' }), failOutput: 'Connectivity check: 0/3 endpoints reachable after adapter reset' },
  RESTART: { label: 'Restart the laptop', patch: () => ({ restartPending: false }), verify: (d) => ({ pass: !d.restartPending, output: 'Laptop reconnected; no restart pending' }), failOutput: 'Laptop did not reconnect in time' },
  APP_UPDATE: { label: 'Install approved app version 2.1', patch: () => ({ appVersion: '2.1' }), verify: (d) => ({ pass: d.appVersion === '2.1', output: 'App 2.1 installed; health check passing' }), failOutput: 'App crashes on launch after the update' },
  OS_UPDATE: { label: 'Install approved OS patch 24H2', patch: () => ({ osVersion: '24H2' }), verify: (d) => ({ pass: d.osVersion === '24H2', output: 'OS build 24H2; post-update health passing' }), failOutput: 'Post-update health check failing' },
  KNOWLEDGE: { label: 'Apply validated resolution', patch: () => ({}), verify: () => ({ pass: true, output: 'Verification criteria met (simulated)' }), failOutput: 'Verification criteria not met' },
};

const rb = (r: Omit<Runbook, 'version' | 'status' | 'supportedOS' | 'actionKey'> & { actionKey?: Runbook['actionKey'] }): Runbook =>
  ({ version: 1, status: 'APPROVED', supportedOS: ['Windows 11'], actionKey: r.actionKey ?? r.category, ...r });
const steps = (...xs: string[]) => xs.map((description, i) => ({ id: `S${i + 1}`, description }));

/** Approved remediation catalog (kept internal — no standalone library screen in V1.2). */
export function seedRunbooks(): Runbook[] {
  return [
    rb({ id: 'RB-001', title: 'Clear approved temporary cache', category: 'STORAGE', risk: 'LOW', expectedMin: 3, reversible: false, disruptive: false, restartRequired: false,
      steps: steps('Check free space and take a snapshot', 'Clear approved temporary cache (never user files)', 'Re-measure free space'), checks: ['Free disk space ≥ 10 GB'], rollbackSteps: [],
      rootCause: 'Temporary cache has filled the disk', employeeImpact: 'None — runs in the background', expectedOutcome: 'At least 10 GB free', recoveryNote: 'Not reversible: only disposable cache is removed, never user files.' }),
    rb({ id: 'RB-002', title: 'Refresh DNS cache', category: 'DNS', risk: 'LOW', expectedMin: 2, reversible: false, disruptive: false, restartRequired: false,
      steps: steps('Confirm DNS probe failure', 'Flush and refresh DNS cache', 'Probe 3 internal names'), checks: ['DNS resolves 3/3 internal names'], rollbackSteps: [],
      rootCause: 'Stale DNS cache entries', employeeImpact: 'None', expectedOutcome: 'Internal sites resolve again', recoveryNote: 'Not reversible, but safe: the cache rebuilds itself.' }),
    rb({ id: 'RB-003', title: 'Restart the stuck background service', category: 'SERVICE', risk: 'LOW', expectedMin: 4, reversible: true, disruptive: false, restartRequired: false,
      steps: steps('Snapshot service state', 'Restart the background sync service', 'Check service health and CPU'), checks: ['Service running', 'CPU usage normal'], rollbackSteps: ['Restore previous service state'],
      rootCause: 'A background sync service is stuck and consuming CPU', employeeImpact: 'None — the laptop stays usable', expectedOutcome: 'Laptop performance back to normal', recoveryNote: 'Previous service state can be restored.' }),
    rb({ id: 'RB-004', title: 'Reset Wi-Fi adapter and renew network settings', category: 'WIFI', risk: 'MEDIUM', expectedMin: 5, reversible: true, disruptive: true, restartRequired: false,
      steps: steps('Snapshot network configuration', 'Reset adapter and renew settings', 'Run connectivity check'), checks: ['Connectivity 3/3 endpoints reachable'], rollbackSteps: ['Restore saved network settings'],
      rootCause: 'Corrupted Wi-Fi adapter configuration on this laptop', employeeImpact: 'Network drops for about one minute', expectedOutcome: 'Stable Wi-Fi connection', recoveryNote: 'Saved network settings are restored on rollback.' }),
    rb({ id: 'RB-005', title: 'Restart the laptop', category: 'RESTART', risk: 'MEDIUM', expectedMin: 8, reversible: false, disruptive: true, restartRequired: true,
      steps: steps('Check for unsaved work', 'Restart the laptop', 'Confirm it reconnects'), checks: ['Laptop reconnects', 'No restart pending'], rollbackSteps: [],
      rootCause: 'Pending updates need a restart to finish', employeeImpact: 'Laptop unavailable for ~5 minutes; save your work', expectedOutcome: 'Updates finished, no restart pending', recoveryNote: 'A restart cannot be undone.' }),
    rb({ id: 'RB-006', title: 'Install approved app version 2.1', category: 'APP_UPDATE', risk: 'MEDIUM', expectedMin: 12, reversible: true, disruptive: true, restartRequired: false,
      steps: steps('Snapshot installed version', 'Install approved version 2.1', 'Check app health'), checks: ['App version 2.1', 'App health passing'], rollbackSteps: ['Reinstall the previous version'],
      rootCause: 'Outdated app version', employeeImpact: 'The app closes and reopens', expectedOutcome: 'App up to date and working', recoveryNote: 'The previous version can be reinstalled.' }),
    rb({ id: 'RB-007', title: 'Install approved OS patch 24H2', category: 'OS_UPDATE', risk: 'HIGH', expectedMin: 25, reversible: true, disruptive: true, restartRequired: true,
      steps: steps('Check compatibility and create a restore point', 'Install OS patch 24H2 (restart)', 'Post-update health check'), checks: ['OS build 24H2', 'Health check passing'], rollbackSteps: ['Restore the previous OS build from the restore point'],
      rootCause: 'Required OS security patch is missing', employeeImpact: 'Laptop restarts; unavailable for ~20 minutes', expectedOutcome: 'Patched and compliant', recoveryNote: 'Restore point allows rollback to the previous build.' }),
  ];
}
export const isExecutable = (r: Runbook) => r.status === 'APPROVED' && !!SIM_ACTIONS[r.actionKey];

/** Keyword inference for "Other issue" descriptions. Conflicting or no matches stay UNKNOWN. */
const KEYWORDS: [Category, RegExp][] = [
  ['STORAGE', /\b(storage|disk|space|drive full)\b/], ['DNS', /\bdns\b/], ['SERVICE', /\b(slow|sluggish|lag|freez(e|ing))\b/],
  ['WIFI', /\b(wi-?fi|wifi|wireless|internet)\b/], ['RESTART', /\b(restart|reboot)\b/], ['APP_UPDATE', /\b(app|software) update\b/],
  ['OS_UPDATE', /\b(os|windows) (update|patch)\b/], ['CRASH', /\b(crash|crashes|crashing|not responding)\b/],
];
export function inferCategory(text: string): Category {
  const t = text.toLowerCase();
  const m = KEYWORDS.filter(([, re]) => re.test(t)).map(([c]) => c);
  return m.length === 1 ? m[0] : 'UNKNOWN';
}

/** Fictional employees. The demo employee is the person signed in to the employee portal. */
export const EMPLOYEES: Employee[] = [
  { id: 'EMP-012', name: 'Jordan Lee', department: 'Finance', email: 'jordan.lee@example.test', deviceName: 'LT-W11-0412', os: 'Windows 11' },
  { id: 'EMP-031', name: 'Priya Nair', department: 'Sales', email: 'priya.nair@example.test', deviceName: 'LT-W11-0431', os: 'Windows 11' },
  { id: 'EMP-044', name: 'Chris Morgan', department: 'Engineering', email: 'chris.morgan@example.test', deviceName: 'LT-W11-0444', os: 'Windows 11' },
  { id: 'EMP-057', name: 'Alex Kim', department: 'Marketing', email: 'alex.kim@example.test', deviceName: 'LT-MAC-0457', os: 'macOS' },
  { id: 'EMP-063', name: 'Sam Rivera', department: 'Operations', email: 'sam.rivera@example.test', deviceName: 'LT-W11-0463', os: 'Windows 11' },
  { id: 'EMP-078', name: 'Taylor Brooks', department: 'HR', email: 'taylor.brooks@example.test', deviceName: 'LT-W11-0478', os: 'Windows 11' },
];
export const DEMO_EMPLOYEE = EMPLOYEES[0];
export const ADMIN_NAME = 'Morgan (IT Admin)';
export const employeeById = (id: string) => EMPLOYEES.find((e) => e.id === id) ?? DEMO_EMPLOYEE;
export const riskLabel = (r: Risk) => (r === 'HIGH' ? 'High' : r === 'MEDIUM' ? 'Medium' : 'Low');
