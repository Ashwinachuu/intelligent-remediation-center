import { DEFAULT_SETTINGS, EMPLOYEES, seedRunbooks } from '../domain/catalog';
import { applyAction, processDue, type Action, type CreateTicketInput, type KnowledgeDraft, type Timing } from '../domain/engine';
import type { Actor, AppState } from '../domain/types';
import { DAY, MIN, iso, ms, setDeterministicIds } from '../domain/util';

const ADMIN: Actor = { name: 'Morgan (IT Admin)', role: 'ADMIN' };
const emp = (id: string): Actor => ({ name: EMPLOYEES.find((e) => e.id === id)!.name, role: 'EMPLOYEE' });

export function emptyState(anchorMs: number): AppState {
  return {
    schemaVersion: 4, anchor: iso(anchorMs), seq: { ticket: 0, audit: 0, knowledge: 0, device: 0 }, devices: {}, tickets: {}, diagnoses: [], runbooks: seedRunbooks(), knowledge: [],
    settings: { ...DEFAULT_SETTINGS, baselines: { ...DEFAULT_SETTINGS.baselines } }, settingsHistory: [{ settings: DEFAULT_SETTINGS, reason: 'Prototype defaults (illustrative assumptions)', actor: 'System', at: iso(anchorMs - 8 * DAY) }],
    approvals: [], executions: [], audit: [], notifications: [], ui: { role: 'ADMIN' },
  };
}

/** Answer sequences that walk each guided flow to a known outcome. */
export const PATHS = {
  slowResolved: ['TODAY', 'WHOLE', 'NO', 'YES', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'RESOLVED'],
  slowPartial: ['TODAY', 'WHOLE', 'NO'],
  wifiEscalate: ['YES', 'YES', 'YES', 'YES'],
  wifiTurnedOn: ['NO', 'COMPLETED', 'RESOLVED'],
  wifiNetworkWide: ['YES', 'YES', 'NO'],
  storageResolved: ['YES', 'COMPLETED', 'COMPLETED', 'RESOLVED'],
  storageEscalate: ['YES', 'COMPLETED', 'COMPLETED', 'PERSISTS'],
  restartEscalate: ['YES', 'COMPLETED', 'PERSISTS'],
  appUpdateEscalate: ['YES', 'COMPLETED', 'COMPLETED', 'PERSISTS'],
  osEscalate: ['YES', 'COMPLETED', 'PERSISTS'],
  appHangEscalate: ['ALWAYS', 'COMPLETED', 'COMPLETED', 'PERSISTS'],
  otherEscalate: ['NO', 'COMPLETED', 'COMPLETED', 'PERSISTS'],
};

/** Small driver used by the seed and the demo scenario loader: runs real actions on a given clock. */
export function driver(start: AppState) {
  let s = start;
  const run = (a: Action, at: number, actor: Actor) => {
    const r = applyAction(s, a, at, { actor });
    if (!r.ok) throw new Error(`${a.type} failed: ${r.error?.message}`);
    s = r.state;
    return r;
  };
  const create = (empId: string, input: Omit<CreateTicketInput, 'employeeId'>, at: number) => run({ type: 'CREATE_TICKET', input: { ...input, employeeId: empId } }, at, emp(empId)).ticketId!;
  const answers = (id: string, list: string[], at: number) => { list.forEach((a, i) => run({ type: 'TS_ANSWER', ticketId: id, answer: a }, at + i * 20_000, emp(s.tickets[id].employeeId))); return at + list.length * 20_000; };
  const settle = (from: number, until: number, timing: Timing) => {
    s = processDue(s, from, timing);
    for (let g = 0; g < 100; g++) {
      const due = s.executions.filter((e) => e.nextAt).map((e) => ms(e.nextAt!));
      if (!due.length || Math.min(...due) > until) break;
      s = processDue(s, Math.min(...due), timing);
    }
  };
  return { run, create, answers, settle, get: () => s };
}
const T = (expectedMin: number): Timing => ({ stepMs: Math.round((expectedMin * MIN) / 4), verifyMs: Math.round((expectedMin * MIN) / 4), closeMs: MIN });

/**
 * Small curated history: ~16 incidents over the last week, each illustrating one path through the
 * V1.2 lifecycle — self-service, escalation + approval, unsupported + learning, failure + rollback,
 * rejection, declined consent and reopening. Generated with the real actions so every audit trail is genuine.
 */
export function buildSeed(anchorMs: number): AppState {
  setDeterministicIds(20241201);
  try {
    const d = driver(emptyState(anchorMs));
    const base = new Date(anchorMs); base.setHours(10, 0, 0, 0);
    const day = (k: number) => { const x = new Date(base); x.setDate(x.getDate() - k); return x.getTime(); };
    const A = (a: Action, at: number) => d.run(a, at, ADMIN);
    const E = (id: string, a: Action, at: number) => d.run(a, at, emp(d.get().tickets[id].employeeId));

    // 6 days ago — two self-service fixes and one approved AI fix
    { const b = day(6);
      const a = d.create('EMP-031', { title: 'Laptop very slow this morning', description: 'Everything takes ages to open.', issueType: 'SLOW' }, b); d.answers(a, PATHS.slowResolved, b + MIN);
      const w = d.create('EMP-044', { title: 'No Wi-Fi after travelling', description: 'Cannot get online in the office.', issueType: 'WIFI' }, b + 60 * MIN); d.answers(w, PATHS.wifiTurnedOn, b + 61 * MIN);
      const st = d.create('EMP-063', { title: 'Disk full warning', description: 'Cannot save files, says disk is full.', issueType: 'STORAGE' }, b + 120 * MIN);
      const t1 = d.answers(st, PATHS.storageEscalate, b + 121 * MIN);
      A({ type: 'APPROVE', ticketId: st, acknowledged: true }, t1 + 6 * MIN); d.settle(t1 + 6 * MIN + 1, t1 + 30 * MIN, T(3)); }
    // 5 days ago — Wi-Fi: self-service fails → approved AI fix; storage self-service
    { const b = day(5);
      const w = d.create('EMP-078', { title: 'Wi-Fi keeps dropping', description: 'Disconnects every few minutes at my desk.', issueType: 'WIFI' }, b);
      const t1 = d.answers(w, PATHS.wifiEscalate, b + MIN);
      A({ type: 'APPROVE', ticketId: w, acknowledged: true }, t1 + 8 * MIN);
      E(w, { type: 'CONSENT', ticketId: w, grant: true }, t1 + 12 * MIN); d.settle(t1 + 12 * MIN + 1, t1 + 40 * MIN, T(5));
      const st = d.create('EMP-031', { title: 'Low disk space', description: 'Low disk space warning keeps popping up.', issueType: 'STORAGE' }, b + 180 * MIN); d.answers(st, PATHS.storageResolved, b + 181 * MIN); }
    // 4 days ago — failed AI fix → rollback → manual; unfamiliar VPN issue → manual fix → reusable resolution
    { const b = day(4);
      const w = d.create('EMP-044', { title: 'Wi-Fi unstable since new dock', description: 'Wireless drops whenever docked.', issueType: 'WIFI', outcome: 'VERIFY_FAIL' }, b);
      const t1 = d.answers(w, PATHS.wifiEscalate, b + MIN);
      A({ type: 'APPROVE', ticketId: w, acknowledged: true }, t1 + 5 * MIN);
      E(w, { type: 'CONSENT', ticketId: w, grant: true }, t1 + 9 * MIN); d.settle(t1 + 9 * MIN + 1, t1 + 20 * MIN, T(5));
      A({ type: 'ROLLBACK', ticketId: w }, t1 + 22 * MIN); d.settle(t1 + 22 * MIN + 1, t1 + 40 * MIN, T(5));
      A({ type: 'RESOLVE_MANUAL', ticketId: w, rootCause: 'Faulty Wi-Fi driver after dock firmware update', steps: 'Rolled back the adapter driver to the previous version', verification: 'Connectivity stable for 30 minutes' }, t1 + 90 * MIN);
      const v = d.create('EMP-063', { title: 'VPN disconnects every hour', description: 'The VPN client drops my connection about every hour.', issueType: 'OTHER' }, b + 120 * MIN);
      const t2 = d.answers(v, PATHS.otherEscalate, b + 121 * MIN);
      A({ type: 'INVESTIGATE', ticketId: v, reason: 'Unfamiliar issue — investigating' }, t2 + 10 * MIN);
      const kd: KnowledgeDraft = { title: 'VPN drops hourly — expired VPN profile', pattern: 'VPN client disconnects every hour', diagnosticQuestions: ['Does the VPN drop at roughly the same interval?'],
        conditions: 'Windows 11 laptops using the company VPN client', employeeSteps: ['Open the VPN app and sign out', 'Sign in again with your company account'], adminSteps: ['Push the refreshed VPN profile to the laptop', 'Confirm the new certificate is installed'],
        expectedOutcome: 'VPN stays connected for a full working day', verification: 'VPN session stable for 2 hours', risks: 'Brief VPN reconnect while the profile updates', rollback: 'Re-apply the previous VPN profile' };
      A({ type: 'RESOLVE_MANUAL', ticketId: v, rootCause: 'Expired VPN profile certificate', steps: 'Pushed a refreshed VPN profile; employee signed in again', verification: 'VPN stable for 2 hours', knowledge: kd }, t2 + 70 * MIN);
      A({ type: 'VALIDATE_KNOWLEDGE', knowledgeId: 'K-001' }, t2 + 90 * MIN); }
    // 3 days ago — rejection; declined consent
    { const b = day(3);
      const o = d.create('EMP-078', { title: 'Windows update failing', description: 'Update keeps failing overnight.', issueType: 'OS_UPDATE' }, b);
      const t1 = d.answers(o, PATHS.osEscalate, b + MIN);
      A({ type: 'REJECT', ticketId: o, reason: 'Release freeze this week — patch after Friday' }, t1 + 15 * MIN);
      A({ type: 'RESOLVE_MANUAL', ticketId: o, rootCause: 'Pending OS patch', steps: 'Installed the patch manually after the freeze', verification: 'OS build 24H2, health check passing' }, t1 + 300 * MIN);
      const r = d.create('EMP-031', { title: 'Restart message every hour', description: 'Keeps asking me to restart.', issueType: 'RESTART' }, b + 60 * MIN);
      const t2 = d.answers(r, PATHS.restartEscalate, b + 61 * MIN);
      A({ type: 'APPROVE', ticketId: r, acknowledged: true }, t2 + 5 * MIN);
      E(r, { type: 'CONSENT', ticketId: r, grant: false }, t2 + 9 * MIN);
      A({ type: 'RESOLVE_MANUAL', ticketId: r, rootCause: 'Pending updates', steps: 'Restarted together with the employee after their meetings', verification: 'No restart pending' }, t2 + 240 * MIN); }
    // 2 days ago — self-service then reopened → re-diagnosed → approved AI fix; app update with consent
    { const b = day(2);
      const s1 = d.create('EMP-063', { title: 'Laptop sluggish', description: 'Apps freeze for seconds at a time.', issueType: 'SLOW' }, b);
      const t1 = d.answers(s1, PATHS.slowResolved, b + MIN);
      E(s1, { type: 'REOPEN', ticketId: s1, reason: 'Slow again after lunch' }, t1 + 180 * MIN);
      A({ type: 'RUN_DIAGNOSIS', ticketId: s1 }, t1 + 200 * MIN);
      A({ type: 'APPROVE', ticketId: s1, acknowledged: true }, t1 + 205 * MIN); d.settle(t1 + 205 * MIN + 1, t1 + 230 * MIN, T(4));
      const a = d.create('EMP-044', { title: 'Productivity app says update required', description: 'Banner says I must update the app.', issueType: 'SOFTWARE_UPDATE' }, b + 60 * MIN);
      const t2 = d.answers(a, PATHS.appUpdateEscalate, b + 61 * MIN);
      A({ type: 'APPROVE', ticketId: a, acknowledged: true }, t2 + 10 * MIN);
      E(a, { type: 'CONSENT', ticketId: a, grant: true }, t2 + 15 * MIN); d.settle(t2 + 15 * MIN + 1, t2 + 60 * MIN, T(12)); }
    // Yesterday — still needing a human: network-wide Wi-Fi (unsupported) and an app hang under investigation
    { const b = day(1);
      const n = d.create('EMP-078', { title: 'No internet in meeting room 3', description: 'Wi-Fi connects but nothing loads.', issueType: 'WIFI' }, b); d.answers(n, PATHS.wifiNetworkWide, b + MIN);
      const h = d.create('EMP-031', { title: 'Expense app freezes on submit', description: 'Expense tool hangs every time I submit.', issueType: 'APP_HANG' }, b + 90 * MIN);
      const t1 = d.answers(h, PATHS.appHangEscalate, b + 91 * MIN);
      A({ type: 'INVESTIGATE', ticketId: h, reason: 'Checking with the app vendor' }, t1 + 30 * MIN); }
    // Today — Jordan (the demo employee): one waiting for approval, one mid-troubleshooting, one resolved by self-service
    { const now = anchorMs;
      const w = d.create('EMP-012', { title: 'Wi-Fi disconnects in the afternoon', description: 'Loses connection several times a day.', issueType: 'WIFI', demo: true }, now - 90 * MIN);
      d.answers(w, PATHS.wifiEscalate, now - 89 * MIN);
      const sl = d.create('EMP-012', { title: 'Laptop running slowly', description: 'Takes a long time to open spreadsheets.', issueType: 'SLOW', demo: true }, now - 40 * MIN);
      d.answers(sl, PATHS.slowPartial, now - 39 * MIN);
      const st = d.create('EMP-012', { title: 'Storage almost full', description: 'Low disk space warning.', issueType: 'STORAGE', demo: true }, now - 25 * MIN);
      d.answers(st, PATHS.storageResolved, now - 24 * MIN); }
    const s = d.get();
    return { ...s, ui: { role: 'ADMIN' }, notifications: s.notifications.map((n) => (ms(n.at) < anchorMs - DAY ? { ...n, read: true } : n)) };
  } finally {
    setDeterministicIds(null);
  }
}
