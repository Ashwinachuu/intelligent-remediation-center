import { applyAction, processDue, type Action } from '../domain/engine';
import { preflight } from '../domain/preflight';
import { actionQueue, assessment, detectClusters, similarIncidents, slaState, workspaceCounts } from '../domain/insights';
import { businessImpact, funnel, type Filters } from '../domain/metrics';
import { lifecycleStage, maturityCriteria } from '../domain/maturity';
import { SHARED_NETWORK, DEFAULT_ASSUMPTIONS } from '../domain/catalog';
import { buildSeed } from '../data/seed';
import type { Actor, AppState, Category, Device } from '../domain/types';
import { DAY, MIN, iso, localDateKey } from '../domain/util';
import { emptyState } from './domain.test';

const T0 = Date.parse('2026-11-20T10:00:00Z');
const ALEX: Actor = { name: 'Alex', role: 'AGENT' };
const MORGAN: Actor = { name: 'Morgan', role: 'ADMIN' };
const act = (s: AppState, a: Action, t = T0, actor: Actor = ALEX) => applyAction(s, a, t, { actor });
function ok(s: AppState, a: Action, t = T0, actor: Actor = ALEX) { const r = act(s, a, t, actor); if (!r.ok) throw new Error(`${a.type}: ${r.error?.message}`); return r; }
function create(s: AppState, category: Category, o: { device?: Partial<Device>; t?: number; source?: 'EMPLOYEE' | 'DETECTION'; requester?: string } = {}) {
  const r = ok(s, { type: 'CREATE_TICKET', input: { title: `Test ${category}`, description: 'synthetic', requester: o.requester ?? 'Employee 001', source: o.source ?? 'EMPLOYEE', priority: 'P3', category, outcome: 'SUCCESS', newDevice: o.device } }, o.t ?? T0);
  return { s: r.state, id: r.ticketId! };
}
function drain(s: AppState, from: number) {
  let t = from;
  for (let i = 0; i < 60; i++) {
    s = processDue(s, t);
    const n = Math.min(...s.executions.map((e) => (e.nextAt ? Date.parse(e.nextAt) : Infinity)), ...s.jobs.filter((j) => j.status === 'PENDING').map((j) => Date.parse(j.dueAt)));
    if (!Number.isFinite(n)) break;
    t = Math.max(t, n);
  }
  return { s, t };
}
const st = (s: AppState, id: string) => s.tickets[id].status;
const check = (s: AppState, id: string, key: string, now = T0) => preflight(s, id, now).checks.find((c) => c.key === key)!;

describe('preflight safety gate', () => {
  it('reports pass / pending / not-applicable states', () => {
    const a = create(emptyState(), 'STORAGE');
    expect(check(a.s, a.id, 'reach').status).toBe('PASS');
    expect(check(a.s, a.id, 'consent').status).toBe('NA');
    expect(check(a.s, a.id, 'battery').status).toBe('NA');
    expect(check(a.s, a.id, 'auth').status).toBe('PENDING');
    expect(preflight(a.s, a.id, T0).ok).toBe(false);
    const w = create(emptyState(), 'WIFI');
    expect(check(w.s, w.id, 'consent').status).toBe('PENDING');
    expect(check(w.s, w.id, 'recovery').status).toBe('PASS');
  });
  it('low battery blocks execution until resolved; results recorded in audit', () => {
    let { s, id } = create(emptyState(), 'WIFI', { device: { batteryPct: 12 } });
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    s = ok(s, { type: 'CONSENT', ticketId: id, grant: true }).state;
    expect(st(s, id)).toBe('WAITING_DEVICE');
    expect(check(s, id, 'battery').status).toBe('FAIL');
    s = processDue(s, T0 + 5000);
    expect(s.executions).toHaveLength(0);
    s = ok(s, { type: 'SET_DEVICE', ticketId: id, batteryPct: 90 }, T0 + 6000).state;
    expect(st(s, id)).toBe('READY');
    s = drain(s, T0 + 6000).s;
    expect(st(s, id)).toBe('CLOSED');
    const actions = s.audit.filter((e) => e.ticketId === id).map((e) => e.action);
    expect(actions).toContain('PREFLIGHT_PASSED');
    expect(actions).toContain('PREFLIGHT_REVALIDATED');
    expect(s.executions[0].preflight.length).toBeGreaterThan(8);
  });
  it('revalidates immediately before the action step (device goes offline → no mutation)', () => {
    let { s, id } = create(emptyState(), 'STORAGE');
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    s = processDue(s, T0 + 800);
    s = ok(s, { type: 'SET_DEVICE', ticketId: id, online: false }, T0 + 900).state;
    s = drain(s, T0 + 1000).s;
    expect(s.executions[0].phase).toBe('CANCELLED');
    expect(s.devices[s.tickets[id].deviceId].freeGB).toBe(3);
  });
});

function osPaused() {
  let { s, id } = create(emptyState(), 'OS_UPDATE');
  s = ok(s, { type: 'APPROVE', ticketId: id, scheduleAt: iso(T0 + 2 * MIN), impactConfirmed: true }, T0, MORGAN).state;
  s = ok(s, { type: 'CONSENT', ticketId: id, grant: true }, T0 + MIN).state;
  const r = drain(s, T0 + 2 * MIN);
  return { s: r.s, id, t: r.t };
}
describe('step-level approval', () => {
  it('auto-runs read-only steps then pauses at the HIGH-risk action with no device change', () => {
    const { s, id } = osPaused();
    expect(st(s, id)).toBe('STEP_APPROVAL');
    const e = s.executions[0];
    expect(e.phase).toBe('AWAITING_STEP');
    expect(e.pausedStepId).toBe('S3');
    expect(s.devices[e.deviceId].osVersion).toBe('23H2');
    expect(s.audit.filter((a) => a.action === 'STEP_COMPLETED' && a.ticketId === id)).toHaveLength(2);
  });
  it('requires admin + impact confirmation; approval is scoped and resumes after preflight', () => {
    const { s, id, t } = osPaused();
    expect(act(s, { type: 'APPROVE_STEP', ticketId: id, impactConfirmed: true }, t + 1, ALEX).error?.code).toBe('UNAUTHORIZED');
    expect(act(s, { type: 'APPROVE_STEP', ticketId: id }, t + 1, MORGAN).error?.code).toBe('VALIDATION');
    let s2 = ok(s, { type: 'APPROVE_STEP', ticketId: id, impactConfirmed: true }, t + 1, MORGAN).state;
    const sa = s2.stepApprovals[0];
    expect(sa).toMatchObject({ stepId: 'S3', runbookId: 'RB-007', runbookVersion: 1, actionKey: 'OS_UPDATE', deviceId: s2.tickets[id].deviceId });
    s2 = drain(s2, t + 1).s;
    expect(st(s2, id)).toBe('CLOSED');
    expect(s2.stepApprovals[0].usedAt).toBeDefined();
  });
  it('rejection escalates without mutation; scheduling + advance works', () => {
    const { s, id, t } = osPaused();
    const rej = ok(s, { type: 'REJECT_STEP', ticketId: id, reason: 'Change freeze' }, t + 1, MORGAN).state;
    expect(st(rej, id)).toBe('ESCALATED');
    expect(rej.executions[0].phase).toBe('CANCELLED');
    let sch = ok(s, { type: 'APPROVE_STEP', ticketId: id, impactConfirmed: true, scheduleAt: iso(t + 60 * MIN) }, t + 1, MORGAN).state;
    sch = processDue(sch, t + 10 * MIN);
    expect(sch.executions[0].appliedAt).toBeUndefined();
    sch = ok(sch, { type: 'ADVANCE_STEP', ticketId: id }, t + 11 * MIN).state;
    sch = drain(sch, t + 11 * MIN).s;
    expect(st(sch, id)).toBe('CLOSED');
  });
  it('changing the approved action (runbook retired) invalidates the step approval and cancels the paused run', () => {
    const { s, id, t } = osPaused();
    let s2 = ok(s, { type: 'APPROVE_STEP', ticketId: id, impactConfirmed: true, scheduleAt: iso(t + 30 * MIN) }, t + 1, MORGAN).state;
    s2 = ok(s2, { type: 'RETIRE_RUNBOOK', runbookId: 'RB-007', version: 1, reason: 'Patch withdrawn' }, t + 2, MORGAN).state;
    expect(s2.stepApprovals[0].invalidatedAt).toBeDefined();
    expect(s2.executions[0].phase).toBe('CANCELLED');
    s2 = drain(s2, t + 31 * MIN).s;
    expect(s2.devices[s2.tickets[id].deviceId].osVersion).toBe('23H2');
    expect(st(s2, id)).toBe('REVIEW_REQUIRED');
  });
});

describe('employee consent experience', () => {
  it('employee-selected window schedules execution and syncs to workspace + audit', () => {
    let { s, id } = create(emptyState(), 'WIFI');
    expect(act(s, { type: 'EMPLOYEE_RESPOND', ticketId: id, choice: 'PROCEED' }).ok).toBe(false); // consent never replaces agent approval
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    s = ok(s, { type: 'EMPLOYEE_RESPOND', ticketId: id, choice: 'SCHEDULE', windowAt: iso(T0 + 3 * 60 * MIN) }, T0 + MIN).state;
    expect(st(s, id)).toBe('SCHEDULED');
    expect(s.tickets[id].employeeResponse?.choice).toBe('SCHEDULE');
    expect(s.audit.find((a) => a.action === 'EMPLOYEE_RESPONSE')?.role).toBe('EMPLOYEE');
    expect(workspaceCounts(s, T0 + 2 * MIN, 'AGENT').inProgress).toBe(1);
    s = drain(s, T0 + 3 * 60 * MIN).s;
    expect(st(s, id)).toBe('CLOSED');
  });
  it('request IT assistance escalates and notifies the agent', () => {
    let { s, id } = create(emptyState(), 'WIFI');
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    s = ok(s, { type: 'EMPLOYEE_RESPOND', ticketId: id, choice: 'ASSIST', note: 'Presenting at 3pm' }).state;
    expect(st(s, id)).toBe('ESCALATED');
    expect(s.notifications.at(-1)?.recipient).toBe('AGENT');
  });
});

describe('incident correlation', () => {
  const three = () => {
    let s = emptyState();
    const ids: string[] = [];
    for (let k = 0; k < 3; k++) { const r = create(s, 'WIFI', { device: { ...SHARED_NETWORK, wifiHealthy: false }, t: T0 + k * 4 * MIN, requester: `Employee 00${k + 1}` }); s = r.s; ids.push(r.id); }
    return { s, ids };
  };
  it('detects a cluster only with ≥3 reports on a shared network within the window', () => {
    const { s } = three();
    expect(detectClusters(s)).toHaveLength(1);
    expect(detectClusters(s)[0].evidence.join(' ')).toMatch(/NET-B2/);
    let h = emptyState();
    for (let k = 0; k < 3; k++) h = create(h, 'WIFI', { t: T0 + k * MIN }).s; // home networks
    expect(detectClusters(h)).toHaveLength(0);
  });
  it('parent incident pauses endpoint remediation; linked incidents close only after verified recovery', () => {
    let { s, ids } = three();
    const r = ok(s, { type: 'LINK_SHARED', ticketIds: ids }, T0 + 15 * MIN);
    s = r.state;
    const pid = r.ticketId!;
    expect(st(s, pid)).toBe('ESCALATED');
    for (const id of ids) expect(st(s, id)).toBe('REVIEW_REQUIRED');
    expect(detectClusters(s)).toHaveLength(0);
    expect(act(s, { type: 'VERIFY_RECOVERY', ticketId: ids[0] }).error?.code).toBe('BLOCKED');
    s = ok(s, { type: 'RESOLVE_MANUAL', ticketId: pid, note: 'Replaced faulty access point', evidence: 'AP healthy, clients reassociated', verified: true }, T0 + 30 * MIN).state;
    for (const id of ids) expect(st(s, id)).toBe('REVIEW_REQUIRED'); // never auto-closed
    s = ok(s, { type: 'VERIFY_RECOVERY', ticketId: ids[0] }, T0 + 31 * MIN).state;
    expect(st(s, ids[0])).toBe('CLOSED');
    expect(s.tickets[ids[0]].verified).toBe(true);
  });
});

describe('automation maturity and draft lifecycle', () => {
  it('L3 automates employee-reported only; proactive detection needs L4; promotion needs admin + criteria', () => {
    const base = emptyState({ autoEnabled: true });
    const det = create(base, 'STORAGE', { source: 'DETECTION' });
    expect(st(det.s, det.id)).toBe('READY'); // RB-001 is L4
    const dns = create(base, 'DNS');
    expect(st(dns.s, dns.id)).toBe('AWAITING_APPROVAL'); // RB-002 L2
    expect(act(dns.s, { type: 'SET_MATURITY', runbookId: 'RB-002', version: 1, to: 3, reason: 'try' }, T0, MORGAN).error?.code).toBe('BLOCKED');
    expect(act(dns.s, { type: 'SET_MATURITY', runbookId: 'RB-002', version: 1, to: 3, reason: 'try' }, T0, ALEX).error?.code).toBe('UNAUTHORIZED');
    const l3: AppState = { ...base, runbooks: base.runbooks.map((r) => (r.id === 'RB-002' ? { ...r, maturity: 3 } : r)) };
    const d1 = create(l3, 'DNS');
    expect(st(d1.s, d1.id)).toBe('READY');
    const d2 = create(l3, 'DNS', { source: 'DETECTION' });
    expect(st(d2.s, d2.id)).toBe('AWAITING_APPROVAL');
    expect(maturityCriteria(base, base.runbooks.find((r) => r.id === 'RB-002')!, 3).some((c) => !c.met)).toBe(true);
  });
  it('AI draft: Draft → Under review → Approved (guidance, not executable) with reviewer', () => {
    let { s, id } = create(emptyState(), 'CRASH');
    s = ok(s, { type: 'RESOLVE_MANUAL', ticketId: id, note: 'Cleared plugin cache', evidence: 'No crash in 5 runs', verified: true }).state;
    const r = ok(s, { type: 'PROPOSE_DRAFT', fromTicketId: id });
    s = r.state;
    const rid = r.ticketId!;
    const draft = s.runbooks.find((x) => x.id === rid)!;
    expect(draft).toMatchObject({ aiGenerated: true, status: 'DRAFT', maturity: 0 });
    expect(draft.rootCause).toMatch(/Cleared plugin cache/);
    expect(act(s, { type: 'PUBLISH_RUNBOOK', runbookId: rid, version: 1, note: 'x' }, T0, MORGAN).ok).toBe(false);
    expect(act(s, { type: 'SUBMIT_REVIEW', runbookId: rid, version: 1 }).error?.code).toBe('VALIDATION'); // tested scenario missing
    s = ok(s, { type: 'UPDATE_DRAFT', runbookId: rid, version: 1, patch: { testedScenario: 'Replayed in simulator' } }).state;
    s = ok(s, { type: 'SUBMIT_REVIEW', runbookId: rid, version: 1 }).state;
    expect(lifecycleStage(s, s.runbooks.find((x) => x.id === rid)!)).toBe('UNDER_REVIEW');
    expect(act(s, { type: 'PUBLISH_RUNBOOK', runbookId: rid, version: 1, note: 'ok' }, T0, ALEX).error?.code).toBe('UNAUTHORIZED');
    s = ok(s, { type: 'PUBLISH_RUNBOOK', runbookId: rid, version: 1, note: 'Reviewed with SMEs' }, T0, MORGAN).state;
    const pub = s.runbooks.find((x) => x.id === rid)!;
    expect(pub).toMatchObject({ status: 'APPROVED', maturity: 1, reviewedBy: 'Morgan' });
    const e = create(s, 'CRASH');
    expect(st(e.s, e.id)).toBe('REVIEW_REQUIRED'); // guidance never executes
  });
});

describe('dashboard calculations', () => {
  const NOW = new Date(2026, 10, 27, 15, 0, 0).getTime();
  const seed = buildSeed(NOW);
  const f: Filters = { from: '2026-09-01', to: localDateKey(NOW) };
  it('funnel stages are nested subsets of one cohort', () => {
    const fu = funnel(seed, f).map((x) => x.count);
    for (let i = 1; i < fu.length; i++) expect(fu[i]).toBeLessThanOrEqual(fu[i - 1]);
    expect(fu[3]).toBeGreaterThan(0);
  });
  it('business impact follows configurable assumptions (no hardcoded values)', () => {
    const a = businessImpact(seed, f);
    const doubled: AppState = { ...seed, settings: { ...seed.settings, assumptions: { ...DEFAULT_ASSUMPTIONS, hourlyCost: DEFAULT_ASSUMPTIONS.hourlyCost * 2 } } };
    expect(businessImpact(doubled, f).costSavings).toBeCloseTo(a.costSavings! * 2, 5);
    expect(a.slaCompliance).not.toBeNull();
    expect(a.agentHoursSaved).toBeGreaterThan(0);
    const empty = businessImpact(seed, { from: '2020-01-01', to: '2020-01-02' });
    expect(empty.costSavings).toBeNull();
    expect(empty.slaCompliance).toBeNull();
  });
  it('workspace queue is prioritized and every item deep-links to its action', () => {
    const q = actionQueue(seed, NOW, 'AGENT');
    expect(q.length).toBeGreaterThan(0);
    const active = q.filter((x) => !x.aged);
    for (let i = 1; i < active.length; i++) expect(active[i].score).toBeLessThanOrEqual(active[i - 1].score);
    expect(q.findIndex((x) => x.aged)).toBeGreaterThanOrEqual(active.length); // aged backlog listed after active work
    expect(active.slice(0, 5).some((x) => x.ticket.demo)).toBe(true);
    expect(q.every((x) => x.href.includes(x.ticket.id) && x.href.includes('focus=action'))).toBe(true);
    const ws = workspaceCounts(seed, NOW, 'AGENT');
    expect(ws.clusters).toBe(1);
    expect(workspaceCounts(seed, NOW, 'MANAGER').myApprovals).toBeNull();
  });
  it('SLA states, similar incidents and assessment derive from records', () => {
    const t = Object.values(seed.tickets).find((x) => x.scenario === 'D')!;
    expect(slaState(t, NOW)).toBe('OK');
    expect(slaState(t, NOW + DAY)).toBe('BREACHED');
    const sim = similarIncidents(seed, t.id);
    expect(sim.total).toBeGreaterThan(50);
    expect(sim.patterns.join(' ')).toMatch(/failed verification/);
    const as = assessment(seed, t.id, NOW, 'AGENT');
    expect(as.diagnosisConfidence).toBe(94);
    expect(as.remediationConfidence).toBeGreaterThan(80);
    expect(as.readiness).toBe('PENDING');
  });
});
