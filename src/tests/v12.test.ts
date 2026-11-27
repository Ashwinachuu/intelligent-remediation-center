import { applyAction, processDue, type Action, type CreateTicketInput, type KnowledgeDraft } from '../domain/engine';
import { approvalStatus, productStatus } from '../domain/lifecycle';
import { METRIC_DEFS, cohort, dashboard, savedForTicket, type Filters } from '../domain/metrics';
import { actionQueue, fixTrackRecord, opportunities, similarIncidents, workspaceCounts } from '../domain/insights';
import { currentDiagnosis } from '../domain/engine';
import { emptyState, buildSeed, PATHS } from '../data/seed';
import { loadState, validateState, STORAGE_KEY } from '../data/persistence';
import { csvCell } from '../pages/Audit';
import type { Actor, AppState } from '../domain/types';
import { DAY, MIN, localDateKey } from '../domain/util';

const T0 = Date.parse('2026-11-20T10:00:00Z');
const EMP: Actor = { name: 'Ashwin', role: 'EMPLOYEE' };
const ADMIN: Actor = { name: 'Morgan (IT Admin)', role: 'ADMIN' };
const act = (s: AppState, a: Action, actor: Actor, t = T0) => applyAction(s, a, t, { actor });
function ok(s: AppState, a: Action, actor: Actor, t = T0) { const r = act(s, a, actor, t); if (!r.ok) throw new Error(`${a.type}: ${r.error?.message}`); return r; }
function raise(s: AppState, input: Omit<CreateTicketInput, 'employeeId'>, t = T0) { const r = ok(s, { type: 'CREATE_TICKET', input: { ...input, employeeId: 'EMP-012' } }, EMP, t); return { s: r.state, id: r.ticketId! }; }
function answer(s: AppState, id: string, list: string[], t = T0) { for (const a of list) s = ok(s, { type: 'TS_ANSWER', ticketId: id, answer: a }, EMP, t).state; return s; }
function drain(s: AppState, from: number) {
  let t = from;
  for (let i = 0; i < 40; i++) { s = processDue(s, t); const n = Math.min(...s.executions.map((e) => (e.nextAt ? Date.parse(e.nextAt) : Infinity))); if (!Number.isFinite(n)) break; t = Math.max(t, n); }
  return s;
}
const wifi = (s = emptyState(T0), outcome?: 'VERIFY_FAIL') => { const r = raise(s, { title: 'Wi-Fi drops', description: 'Keeps disconnecting', issueType: 'WIFI', outcome }); return { s: answer(r.s, r.id, PATHS.wifiEscalate), id: r.id }; };
const ps = (s: AppState, id: string) => productStatus(s.tickets[id]);

describe('guided troubleshooting (adaptive)', () => {
  it('branches on answers: Wi-Fi off → turn-on step; on → asks about networks', () => {
    const { s, id } = raise(emptyState(T0), { title: 'No Wi-Fi', description: 'x x x', issueType: 'WIFI' });
    expect(s.tickets[id].status).toBe('SELF_SERVICE');
    expect(answer(s, id, ['NO']).tickets[id].troubleshooting.current).toBe('w1s');
    expect(answer(s, id, ['YES']).tickets[id].troubleshooting.current).toBe('w2');
    expect(act(s, { type: 'TS_ANSWER', ticketId: id, answer: 'COMPLETED' }, EMP).error?.code).toBe('VALIDATION');
  });
  it('self-service success closes the ticket with no approval and records every step', () => {
    const { s: s0, id } = raise(emptyState(T0), { title: 'Slow laptop', description: 'very slow', issueType: 'SLOW' });
    const s = answer(s0, id, PATHS.slowResolved);
    const t = s.tickets[id];
    expect(t).toMatchObject({ status: 'CLOSED', path: 'SELF_SERVICE', verified: true });
    expect(approvalStatus(s, t)).toBe('NOT_REQUIRED');
    expect(s.executions).toHaveLength(0);
    expect(t.troubleshooting.entries).toHaveLength(8);
    expect(s.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['TICKET_CREATED', 'DIAGNOSTIC_RESPONSE', 'TROUBLESHOOTING_STEP', 'EMPLOYEE_CONFIRMATION', 'TICKET_CLOSED']));
  });
  it('escalation keeps the same incident and its full history; AI proposes a fix for the admin', () => {
    const { s, id } = wifi();
    expect(Object.keys(s.tickets)).toHaveLength(1);
    const t = s.tickets[id];
    expect(ps(s, id)).toBe('REVIEW_NEEDED');
    expect(t.troubleshooting.entries).toHaveLength(4);
    expect(t.troubleshooting.state).toBe('ESCALATED');
    const d = s.diagnoses.find((x) => x.id === t.diagnosisId)!;
    expect(d.runbookId).toBe('RB-004');
    expect(d.evidence.join(' ')).toMatch(/Employee answer/);
  });
  it('attempt limit escalates automatically; employee can ask for help at any time', () => {
    const { s: s0, id } = raise(emptyState(T0), { title: 'Disk full', description: 'disk full', issueType: 'STORAGE' });
    const s = answer(s0, id, ['YES', 'UNABLE', 'UNABLE']);
    expect(s.tickets[id].troubleshooting.escalationReason).toMatch(/attempt limit/);
    const r = raise(emptyState(T0), { title: 'Disk full', description: 'disk full', issueType: 'STORAGE' });
    const h = ok(r.s, { type: 'TS_ESCALATE', ticketId: r.id }, EMP).state;
    expect(h.tickets[r.id].troubleshooting.escalationReason).toBe('Employee asked for IT help');
    expect(ps(h, r.id)).toBe('REVIEW_NEEDED');
  });
  it('network-wide answers lower confidence → unsupported (no laptop fix proposed)', () => {
    const { s: s0, id } = raise(emptyState(T0), { title: 'No internet', description: 'meeting room', issueType: 'WIFI' });
    const s = answer(s0, id, PATHS.wifiNetworkWide);
    expect(ps(s, id)).toBe('UNSUPPORTED');
    expect(s.tickets[id].everUnsupported).toBe(true);
  });
});

describe('mandatory human approval', () => {
  it('nothing executes without explicit admin approval — even at high confidence and after a long time', () => {
    const { s: s0, id } = raise(emptyState(T0), { title: 'Disk full', description: 'disk full', issueType: 'STORAGE' });
    let s = answer(s0, id, PATHS.storageEscalate);
    expect(s.diagnoses[0].confidence).toBe(98);
    s = drain(s, T0 + DAY);
    expect(s.executions).toHaveLength(0);
    expect(ps(s, id)).toBe('REVIEW_NEEDED');
  });
  it('employees cannot approve; approval requires acknowledging action and risks; no duplicates', () => {
    const { s, id } = wifi();
    const e = act(s, { type: 'APPROVE', ticketId: id, acknowledged: true }, EMP);
    expect(e.error?.code).toBe('UNAUTHORIZED');
    expect(e.state.audit.at(-1)?.action).toBe('AUTHORIZATION_BLOCKED');
    expect(act(s, { type: 'APPROVE', ticketId: id, acknowledged: false }, ADMIN).error?.code).toBe('VALIDATION');
    const a = ok(s, { type: 'APPROVE', ticketId: id, acknowledged: true }, ADMIN).state;
    expect(approvalStatus(a, a.tickets[id])).toBe('APPROVED');
    expect(act(a, { type: 'APPROVE', ticketId: id, acknowledged: true }, ADMIN).ok).toBe(false);
  });
  it('approval is bound to the incident, device and exact fix; a changed proposal invalidates it', () => {
    const { s, id } = wifi();
    let a = ok(s, { type: 'APPROVE', ticketId: id, acknowledged: true }, ADMIN).state;
    expect(a.tickets[id].status).toBe('AWAITING_CONSENT');
    expect(a.approvals[0]).toMatchObject({ ticketId: id, deviceId: a.tickets[id].deviceId, runbookId: 'RB-004' });
    a = ok(a, { type: 'SAVE_SETTINGS', settings: { ...a.settings, confidenceThreshold: 85 }, reason: 'tighter' }, ADMIN, T0 + MIN).state;
    expect(a.approvals[0].invalidatedAt).toBeDefined();
    expect(ps(a, id)).toBe('REVIEW_NEEDED');
    expect(act(a, { type: 'CONSENT', ticketId: id, grant: true }, EMP).ok).toBe(false);
  });
  it('confidence threshold decides whether AI may recommend', () => {
    let s = emptyState(T0);
    s = ok(s, { type: 'SAVE_SETTINGS', settings: { ...s.settings, confidenceThreshold: 95 }, reason: 'strict' }, ADMIN).state;
    const hi = wifi(s);
    expect(ps(hi.s, hi.id)).toBe('UNSUPPORTED');
    const lo = wifi();
    expect(ps(lo.s, lo.id)).toBe('REVIEW_NEEDED');
  });
});

describe('execution, verification, rollback', () => {
  it('approved disruptive fix waits for consent, executes, verifies and closes as human-approved', () => {
    const { s: s0, id } = wifi();
    let s = ok(s0, { type: 'APPROVE', ticketId: id, acknowledged: true }, ADMIN).state;
    s = ok(s, { type: 'CONSENT', ticketId: id, grant: true }, EMP).state;
    s = drain(s, T0);
    expect(s.tickets[id]).toMatchObject({ status: 'CLOSED', path: 'HUMAN_APPROVED', verified: true });
    expect(s.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['APPROVED', 'EMPLOYEE_CONSENT_GRANTED', 'PREREQUISITES_PASSED', 'REMEDIATION_STARTED', 'REMEDIATION_APPLIED', 'VERIFICATION_PASSED', 'TICKET_CLOSED']));
  });
  it('declined consent → manual investigation, nothing runs', () => {
    const { s: s0, id } = wifi();
    let s = ok(s0, { type: 'APPROVE', ticketId: id, acknowledged: true }, ADMIN).state;
    s = drain(ok(s, { type: 'CONSENT', ticketId: id, grant: false }, EMP).state, T0);
    expect(ps(s, id)).toBe('MANUAL');
    expect(s.executions).toHaveLength(0);
  });
  it('failed verification keeps the incident open; rollback restores; rollback is not a resolution', () => {
    const { s: s0, id } = wifi(emptyState(T0), 'VERIFY_FAIL');
    let s = ok(s0, { type: 'APPROVE', ticketId: id, acknowledged: true }, ADMIN).state;
    s = drain(ok(s, { type: 'CONSENT', ticketId: id, grant: true }, EMP).state, T0);
    expect(s.tickets[id]).toMatchObject({ status: 'ROLLBACK_AVAILABLE', verified: false });
    expect(ps(s, id)).toBe('MANUAL');
    s = drain(ok(s, { type: 'ROLLBACK', ticketId: id }, ADMIN, T0 + 10_000).state, T0 + 10_000);
    expect(ps(s, id)).toBe('MANUAL');
    expect(s.devices[s.tickets[id].deviceId].wifiHealthy).toBe(false);
    expect(s.executions[0].phase).toBe('ROLLED_BACK');
    expect(s.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['VERIFICATION_FAILED', 'ROLLBACK_STARTED', 'ROLLBACK_COMPLETED']));
    const d = dashboard(s, { from: localDateKey(T0), to: localDateKey(T0) });
    expect(d.aiCount).toBe(0);
  });
  it('irreversible fixes cannot be rolled back', () => {
    const { s: s0, id } = raise(emptyState(T0), { title: 'Disk full', description: 'disk full', issueType: 'STORAGE' });
    let s = ok(answer(s0, id, PATHS.storageEscalate), { type: 'APPROVE', ticketId: id, acknowledged: true }, ADMIN).state;
    s = drain(s, T0);
    expect(s.tickets[id].status).toBe('CLOSED');
    expect(act(s, { type: 'ROLLBACK', ticketId: id }, ADMIN, T0 + 5000).error?.message).toMatch(/cannot be rolled back/);
  });
});

describe('unsupported incidents and continuous learning', () => {
  const kd: KnowledgeDraft = { title: 'Dock firmware causes monitor flicker', pattern: 'external monitor flicker dock', diagnosticQuestions: ['Does it only happen on the dock?'], conditions: 'Docked laptops',
    employeeSteps: ['Unplug the dock power for 10 seconds and reconnect it'], adminSteps: ['Push dock firmware 2.4'], expectedOutcome: 'No flicker', verification: 'No flicker for 30 min', risks: 'Dock restarts', rollback: '' };
  it('manual fix → saved knowledge is unused until validated → then guides employees and powers an approvable recommendation', () => {
    const r1 = raise(emptyState(T0), { title: 'External monitor flickers when docked', description: 'Second monitor flickers on the dock', issueType: 'OTHER' });
    let s = answer(r1.s, r1.id, PATHS.otherEscalate);
    expect(ps(s, r1.id)).toBe('UNSUPPORTED');
    s = ok(s, { type: 'RESOLVE_MANUAL', ticketId: r1.id, rootCause: 'Dock firmware', steps: 'Updated dock firmware', verification: 'No flicker', knowledge: kd }, ADMIN).state;
    expect(s.tickets[r1.id]).toMatchObject({ status: 'CLOSED', path: 'MANUAL' });
    expect(s.knowledge[0].status).toBe('PENDING_VALIDATION');
    const before = raise(s, { title: 'Monitor flickering on dock', description: 'screen flickers', issueType: 'OTHER' }, T0 + MIN);
    expect(before.s.tickets[before.id].troubleshooting.knowledgeId).toBeUndefined();
    expect(act(s, { type: 'VALIDATE_KNOWLEDGE', knowledgeId: 'K-001' }, EMP).ok).toBe(false);
    s = ok(s, { type: 'VALIDATE_KNOWLEDGE', knowledgeId: 'K-001' }, ADMIN).state;
    const r2 = raise(s, { title: 'Monitor flickering on dock', description: 'screen flickers', issueType: 'OTHER' }, T0 + 2 * MIN);
    s = r2.s;
    expect(s.tickets[r2.id].troubleshooting.knowledgeId).toBe('K-001');
    expect(s.tickets[r2.id].troubleshooting.current).toBe('k_q0');
    s = ok(s, { type: 'TS_ESCALATE', ticketId: r2.id }, EMP, T0 + 3 * MIN).state;
    const d = s.diagnoses.find((x) => x.id === s.tickets[r2.id].diagnosisId)!;
    expect(d).toMatchObject({ knowledgeId: 'K-001', confidence: 85, recommendable: true });
    expect(ps(s, r2.id)).toBe('REVIEW_NEEDED');
    s = drain(ok(s, { type: 'APPROVE', ticketId: r2.id, acknowledged: true }, ADMIN, T0 + 4 * MIN).state, T0 + 4 * MIN);
    expect(s.tickets[r2.id]).toMatchObject({ status: 'CLOSED', path: 'HUMAN_APPROVED' });
    expect(s.tickets[r2.id].everUnsupported).toBe(false);
  });
  it('unrelated issues do not retrieve the knowledge', () => {
    let s = buildSeed(T0);
    const r = raise(s, { title: 'Restart message every hour', description: 'asks me to restart', issueType: 'RESTART' }, T0 + MIN);
    s = r.s;
    expect(s.tickets[r.id].troubleshooting.knowledgeId).toBeUndefined();
  });
});

describe('reopening', () => {
  it('employee reopens the same incident; metrics and worklists update; admin can re-diagnose', () => {
    const { s: s0, id } = raise(emptyState(T0), { title: 'Disk full', description: 'disk full', issueType: 'STORAGE' });
    let s = answer(s0, id, PATHS.storageResolved);
    const f: Filters = { from: localDateKey(T0), to: localDateKey(T0) };
    expect(dashboard(s, f).ssCount).toBe(1);
    expect(act(s, { type: 'REOPEN', ticketId: id, reason: 'came back' }, ADMIN).error?.code).toBe('UNAUTHORIZED');
    s = ok(s, { type: 'REOPEN', ticketId: id, reason: 'Disk full again' }, EMP, T0 + MIN).state;
    expect(ps(s, id)).toBe('REOPENED');
    expect(s.tickets[id]).toMatchObject({ verified: false, reopenedCount: 1 });
    expect(dashboard(s, f).ssCount).toBe(0);
    expect(dashboard(s, f).reopenRate).toBe(1);
    expect(workspaceCounts(s, T0 + MIN).investigation).toBe(1);
    s = ok(s, { type: 'RUN_DIAGNOSIS', ticketId: id }, ADMIN, T0 + 2 * MIN).state;
    expect(ps(s, id)).toBe('REVIEW_NEEDED');
  });
});

describe('dashboard calculations', () => {
  const NOW = new Date(2026, 10, 27, 15, 0, 0).getTime();
  const seed = buildSeed(NOW);
  const f: Filters = { from: localDateKey(NOW - 6 * DAY), to: localDateKey(NOW) };
  it('distribution reconciles with total and rates follow the V1.2 formulas', () => {
    const d = dashboard(seed, f);
    expect(d.total).toBe(18);
    expect(d.distSum).toBe(d.total);
    const ss = cohort(seed, f).filter((t) => METRIC_DEFS.selfService.test(t, seed)).length;
    const ha = cohort(seed, f).filter((t) => METRIC_DEFS.humanApproved.test(t, seed)).length;
    expect(d.aiRate).toBeCloseTo((ss + ha) / d.total);
    expect(d.ssRate).toBeCloseTo(ss / d.total);
    expect(d.unsupportedRate).toBeCloseTo(d.everUnsupported / d.total);
    expect(d.unsupportedBreakdown.reduce((a, r) => a + r.count, 0)).toBe(d.everUnsupported);
  });
  it('time saved = Σ(baseline − admin minutes); failed AI attempts count against it', () => {
    const d = dashboard(seed, f);
    const sum = cohort(seed, f).reduce((a, t) => a + savedForTicket(seed, t), 0);
    expect(d.saved.total).toBe(sum);
    expect(d.saved.failedOrManual).toBeLessThan(0);
    const t = Object.values(seed.tickets).find((x) => x.path === 'HUMAN_APPROVED' && x.category === 'STORAGE')!;
    expect(savedForTicket(seed, t)).toBe(seed.settings.baselines.STORAGE - seed.settings.reviewEffortMin); // 20 − 3 = 17
    const doubled = { ...seed, settings: { ...seed.settings, baselines: { ...seed.settings.baselines, STORAGE: 40 } } };
    expect(savedForTicket(doubled, t)).toBe(37);
  });
  it('date filters are inclusive local days; zero-data ranges show no rates', () => {
    expect(dashboard(seed, { from: localDateKey(NOW), to: localDateKey(NOW) }).total).toBe(3);
    const z = dashboard(seed, { from: '2020-01-01', to: '2020-01-02' });
    expect(z.total).toBe(0);
    expect(z.aiRate).toBeNull();
    expect(z.slaCompliance).toBeNull();
  });
  it('workspace defaults to all action required; filters can overlap', () => {
    const all = actionQueue(seed, NOW, 'ALL');
    const pending = actionQueue(seed, NOW, 'PENDING');
    const inv = actionQueue(seed, NOW, 'INVESTIGATION');
    expect(all.length).toBe(pending.length + inv.length);
    expect(all.every((x) => x.why.length > 10)).toBe(true);
    const overdue = actionQueue(seed, NOW, 'OVERDUE');
    expect(overdue.every((x) => all.some((y) => y.ticket.id === x.ticket.id))).toBe(true);
  });
  it('recommendation evidence: diagnosis confidence and fix track record are separate, and the similar-incident summary matches its list', () => {
    const w = Object.values(seed.tickets).find((t) => t.status === 'AWAITING_APPROVAL' && t.issueType === 'WIFI')!;
    const d = currentDiagnosis(seed, w)!;
    expect(d.match).toEqual(expect.objectContaining({ kind: 'RUNBOOK', id: d.runbookId }));
    expect(d.telemetry?.consistent).toBe(true);
    const tr = fixTrackRecord(seed, d.runbookId, w.id);
    // Only admin-approved runs of this exact fix count — self-service closures never ran it.
    expect(tr.runs.every((r) => r.execution.runbookId === d.runbookId && seed.approvals.some((a) => a.id === r.execution.approvalId))).toBe(true);
    expect([tr.verified, tr.failed, tr.finished]).toEqual([1, 1, 2]);
    const sim = similarIncidents(seed, w.id);
    expect(Object.values(sim.counts).reduce((a, b) => a + b, 0)).toBe(sim.items.length);
    expect(sim.total).toBe(sim.items.length);
    expect(sim.counts.SELF_SERVICE).toBeGreaterThan(0);
  });
  it('unsupported breakdown is exhaustive; opportunities rank by frequency × manual effort with taught issues last', () => {
    const all = dashboard(seed, { from: '2000-01-01', to: localDateKey(NOW) });
    expect(all.unsupportedBreakdown.reduce((a, r) => a + r.count, 0)).toBe(all.everUnsupported);
    const ops = opportunities(seed, NOW);
    expect(ops.reduce((a, o) => a + o.tickets.length, 0)).toBe(all.everUnsupported);
    const untaught = ops.filter((o) => !o.covered);
    for (let i = 1; i < untaught.length; i++) expect(untaught[i - 1].effortMin).toBeGreaterThanOrEqual(untaught[i].effortMin);
    expect(ops[ops.length - 1].covered).toBe(true);
    expect(ops.map((o) => o.rank)).toEqual(ops.map((_, i) => i + 1));
    expect(ops[0].tickets.length).toBeGreaterThan(1);
  });
  it('seeded history contains no autonomous executions — every execution has an approval', () => {
    expect(seed.executions.length).toBeGreaterThan(0);
    for (const e of seed.executions) expect(seed.approvals.some((a) => a.id === e.approvalId && a.decision === 'APPROVE')).toBe(true);
  });
});

describe('persistence and audit export', () => {
  it('older or corrupt saved data quietly reloads the demo seed', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } as unknown as Storage;
    store.set(STORAGE_KEY, JSON.stringify({ schemaVersion: 3, tickets: {} }));
    const r = loadState(storage, T0);
    expect(r.warning).toBeUndefined();
    expect(r.fresh).toBe(true);
    expect(validateState(r.state)).toBe(true);
    store.set(STORAGE_KEY, '{not json');
    expect(validateState(loadState(storage, T0).state)).toBe(true);
  });
  it('CSV export protects against spreadsheet injection', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});
