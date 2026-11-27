import { applyAction, processDue, type Action, type CreateTicketInput } from '../domain/engine';
import { DEFAULT_POLICY, evaluateRoute, validatePolicy } from '../domain/policy';
import { HEALTHY_DEVICE, seedRunbooks, inferCategory } from '../domain/catalog';
import { computeDiagnosis } from '../domain/diagnosis';
import type { Actor, AppState, Category, Device, Outcome, Policy, Runbook } from '../domain/types';
import { DAY, MIN, iso } from '../domain/util';
import { canTransition } from '../domain/transitions';

const T0 = Date.parse('2026-11-20T10:00:00Z');
const ALEX: Actor = { name: 'Alex', role: 'AGENT' };
const MORGAN: Actor = { name: 'Morgan', role: 'ADMIN' };
const RILEY: Actor = { name: 'Riley', role: 'MANAGER' };

export function emptyState(policy: Partial<Policy> = {}): AppState {
  return {
    schemaVersion: 1, anchor: iso(T0), seq: { ticket: 0, audit: 0, runbook: 8, device: 0 }, devices: {}, tickets: {}, diagnoses: [], runbooks: seedRunbooks(iso(T0 - DAY)),
    policy: { ...DEFAULT_POLICY, ...policy }, policyHistory: [{ policy: { ...DEFAULT_POLICY, ...policy }, reason: 'test', actor: 'Morgan', role: 'ADMIN', at: iso(T0 - DAY) }],
    approvals: [], executions: [], jobs: [], audit: [], notifications: [], settings: { role: 'AGENT' },
  };
}
function act(s: AppState, a: Action, t = T0, actor: Actor = ALEX) {
  return applyAction(s, a, t, { actor });
}
function ok(s: AppState, a: Action, t = T0, actor: Actor = ALEX) {
  const r = act(s, a, t, actor);
  if (!r.ok) throw new Error(`${a.type}: ${r.error?.message}`);
  return r;
}
function create(s: AppState, category: Category, opts: { outcome?: Outcome; device?: Partial<Device>; t?: number } = {}) {
  const input: CreateTicketInput = { title: `Test ${category}`, description: 'synthetic test', requester: 'Employee 001', source: 'EMPLOYEE', priority: 'P3', category, outcome: opts.outcome ?? 'SUCCESS', newDevice: opts.device };
  const r = ok(s, { type: 'CREATE_TICKET', input }, opts.t ?? T0);
  return { s: r.state, id: r.ticketId! };
}
/** Run due work until idle, advancing the clock to each next due time. */
function drain(s: AppState, from: number, limit = 60) {
  let t = from;
  for (let i = 0; i < limit; i++) {
    s = processDue(s, t);
    const next = s.executions.map((e) => (e.nextAt ? Date.parse(e.nextAt) : Infinity)).concat(s.jobs.filter((j) => j.status === 'PENDING').map((j) => Date.parse(j.dueAt)));
    const n = Math.min(...next);
    if (!Number.isFinite(n) || n > from + 2 * DAY) break;
    t = Math.max(t, n);
  }
  return { s, t };
}
const status = (s: AppState, id: string) => s.tickets[id].status;

const rbFor = (cat: Category, s = emptyState()): Runbook => s.runbooks.find((r) => r.category === cat && r.status === 'APPROVED')!;
const dev = (p: Partial<Device> = {}): Device => ({ ...HEALTHY_DEVICE, id: 'd', name: 'd', ...p });

describe('policy engine boundaries', () => {
  const p = { ...DEFAULT_POLICY, autoEnabled: true };
  const route = (score: number, risk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW', policy: Policy = p, device = dev(), rb: Runbook | undefined = rbFor('STORAGE')) =>
    evaluateRoute({ confidence: score, risk, runbook: rb, device, policy, approvalValid: false, consentValid: false, now: T0 }).route;
  it.each([[59, 'ESCALATED'], [60, 'REVIEW_REQUIRED'], [79, 'REVIEW_REQUIRED'], [80, 'AWAITING_APPROVAL'], [94, 'AWAITING_APPROVAL'], [95, 'READY'], [100, 'READY']])('score %i -> %s', (score, expected) => {
    expect(route(score)).toBe(expected);
  });
  it('HIGH and MEDIUM risk are never auto-executed, even at 100', () => {
    expect(route(100, 'HIGH')).toBe('AWAITING_APPROVAL');
    expect(route(100, 'MEDIUM')).toBe('AWAITING_APPROVAL');
  });
  it('preapproval off requires approval at 100', () => { expect(route(100, 'LOW', DEFAULT_POLICY)).toBe('AWAITING_APPROVAL'); });
  it('global pause -> REVIEW_REQUIRED', () => { expect(route(98, 'LOW', { ...p, enabled: false })).toBe('REVIEW_REQUIRED'); });
  it('unsupported OS, unmanaged, disallowed group are hard-escalated', () => {
    expect(route(98, 'LOW', p, dev({ os: 'macOS' }))).toBe('ESCALATED');
    expect(route(98, 'LOW', p, dev({ managed: false }))).toBe('ESCALATED');
    expect(route(98, 'LOW', p, dev({ group: 'Critical' }))).toBe('ESCALATED');
  });
  it('offline -> WAITING_DEVICE; busy non-disruptive -> WAITING_DEVICE; busy disruptive w/o consent -> AWAITING_CONSENT', () => {
    expect(route(98, 'LOW', p, dev({ online: false }))).toBe('WAITING_DEVICE');
    expect(route(98, 'LOW', p, dev({ busy: true }))).toBe('WAITING_DEVICE');
    const wifi = rbFor('WIFI');
    expect(evaluateRoute({ confidence: 94, risk: 'MEDIUM', runbook: wifi, device: dev({ busy: true }), policy: p, approvalValid: true, consentValid: false, now: T0 }).route).toBe('AWAITING_CONSENT');
    expect(evaluateRoute({ confidence: 94, risk: 'MEDIUM', runbook: wifi, device: dev({ busy: true }), policy: p, approvalValid: true, consentValid: true, now: T0 }).route).toBe('WAITING_DEVICE');
  });
  it('missing runbook: review if score >= review threshold else escalate', () => {
    expect(route(68, 'HIGH', p, dev(), undefined)).toBe('REVIEW_REQUIRED');
    expect(route(42, 'HIGH', p, dev(), undefined)).toBe('ESCALATED');
  });
  it('validates threshold ordering and integers', () => {
    expect(validatePolicy({ ...DEFAULT_POLICY, reviewThreshold: 80 })).not.toHaveLength(0);
    expect(validatePolicy({ ...DEFAULT_POLICY, autoThreshold: 101 })).not.toHaveLength(0);
    expect(validatePolicy({ ...DEFAULT_POLICY, approvalThreshold: 80.5 })).not.toHaveLength(0);
    expect(validatePolicy(DEFAULT_POLICY)).toHaveLength(0);
  });
  it('transition table rejects illegal moves', () => {
    expect(canTransition('CLOSED', 'EXECUTING')).toBe(false);
    expect(canTransition('AWAITING_APPROVAL', 'READY')).toBe(true);
  });
});

describe('diagnosis', () => {
  it('keyword inference with conflicts -> UNKNOWN', () => {
    expect(inferCategory('My disk is full').category).toBe('STORAGE');
    expect(inferCategory('DNS and wifi broken').category).toBe('UNKNOWN');
    expect(inferCategory('hello there').category).toBe('UNKNOWN');
  });
  it('telemetry mismatch drops score to 65 and is deterministic', () => {
    const s = emptyState();
    const { s: s1, id } = create(s, 'STORAGE', { device: { freeGB: 40 } });
    const d = s1.diagnoses.find((x) => x.ticketId === id)!;
    expect(d.confidence).toBe(65);
    expect(status(s1, id)).toBe('REVIEW_REQUIRED');
    const again = computeDiagnosis(s1.tickets[id], s1.devices[s1.tickets[id].deviceId], s1.runbooks, s1.policy, 1, iso(T0));
    expect(again.confidence).toBe(65);
    expect(again.planHash).toBe(d.planHash);
  });
});

describe('approval & execution lifecycle', () => {
  it('storage: approve -> execute -> verify -> auto close, with audit trail', () => {
    let { s, id } = create(emptyState(), 'STORAGE');
    expect(status(s, id)).toBe('AWAITING_APPROVAL');
    expect(s.tickets[id].eligibleAtIntake).toBe(true);
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    expect(status(s, id)).toBe('EXECUTING');
    s = drain(s, T0).s;
    expect(status(s, id)).toBe('CLOSED');
    expect(s.tickets[id].verified).toBe(true);
    expect(s.tickets[id].path).toBe('HUMAN_APPROVED');
    expect(s.devices[s.tickets[id].deviceId].freeGB).toBe(11);
    const actions = s.audit.filter((a) => a.ticketId === id).map((a) => a.action);
    for (const x of ['APPROVED', 'EXECUTION_STARTED', 'ACTION_APPLIED', 'VERIFICATION_PASSED', 'TICKET_CLOSED']) expect(actions).toContain(x);
    expect(s.tickets[id].modeledResolutionMin).toBe(3 + 8);
    expect(s.tickets[id].agentMin).toBe(4);
  });
  it('wrong role: agent cannot approve HIGH; manager cannot approve; block is audited without business mutation', () => {
    const { s, id } = create(emptyState(), 'OS_UPDATE');
    const r = act(s, { type: 'APPROVE', ticketId: id, scheduleAt: iso(T0 + 10 * MIN), impactConfirmed: true });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('UNAUTHORIZED');
    expect(r.state.tickets).toBe(s.tickets);
    expect(r.state.audit.at(-1)?.action).toBe('AUTHORIZATION_BLOCKED');
    const m = act(s, { type: 'APPROVE', ticketId: id }, T0, RILEY);
    expect(m.error?.code).toBe('UNAUTHORIZED');
  });
  it('HIGH requires schedule + impact confirmation; schedule re-checks gates when due', () => {
    let { s, id } = create(emptyState(), 'OS_UPDATE');
    expect(act(s, { type: 'APPROVE', ticketId: id }, T0, MORGAN).error?.code).toBe('VALIDATION');
    s = ok(s, { type: 'APPROVE', ticketId: id, scheduleAt: iso(T0 + 30 * MIN), impactConfirmed: true }, T0, MORGAN).state;
    expect(status(s, id)).toBe('AWAITING_CONSENT');
    s = ok(s, { type: 'CONSENT', ticketId: id, grant: true }, T0 + MIN).state;
    expect(status(s, id)).toBe('SCHEDULED');
    // device goes offline before the window -> not executed when due
    s = ok(s, { type: 'SET_DEVICE', ticketId: id, online: false }, T0 + 2 * MIN).state;
    expect(status(s, id)).toBe('WAITING_DEVICE');
    s = processDue(s, T0 + 31 * MIN);
    expect(s.executions).toHaveLength(0);
    s = ok(s, { type: 'SET_DEVICE', ticketId: id, online: true }, T0 + 32 * MIN).state;
    s = drain(s, T0 + 32 * MIN).s;
    expect(status(s, id)).toBe('CLOSED');
  });
  it('advance scheduled job to now re-checks gates and executes', () => {
    let { s, id } = create(emptyState(), 'OS_UPDATE');
    s = ok(s, { type: 'APPROVE', ticketId: id, scheduleAt: iso(T0 + 3 * 60 * MIN), impactConfirmed: true }, T0, MORGAN).state;
    s = ok(s, { type: 'CONSENT', ticketId: id, grant: true }, T0 + MIN).state;
    s = ok(s, { type: 'ADVANCE_SCHEDULE', ticketId: id }, T0 + 2 * MIN).state;
    expect(status(s, id)).toBe('READY');
    s = drain(s, T0 + 2 * MIN).s;
    expect(status(s, id)).toBe('CLOSED');
    expect(s.audit.some((a) => a.action === 'SCHEDULE_ADVANCED')).toBe(true);
  });
  it('duplicate approval / start are rejected', () => {
    let { s, id } = create(emptyState(), 'STORAGE');
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    expect(act(s, { type: 'APPROVE', ticketId: id }).ok).toBe(false);
    expect(act(s, { type: 'START', ticketId: id }).ok).toBe(false);
    expect(s.executions).toHaveLength(1);
  });
  it('consent denial escalates; consent expiry returns to awaiting consent', () => {
    let { s, id } = create(emptyState(), 'WIFI');
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    expect(status(s, id)).toBe('AWAITING_CONSENT');
    const denied = ok(s, { type: 'CONSENT', ticketId: id, grant: false }).state;
    expect(status(denied, id)).toBe('ESCALATED');
    expect(denied.audit.at(-3)?.role ?? denied.audit.find((a) => a.action === 'CONSENT_DENIED')?.role).toBeDefined();
    expect(denied.audit.find((a) => a.action === 'CONSENT_DENIED')?.role).toBe('EMPLOYEE');
    // expiry: grant consent while device busy, wait > 24h
    s = ok(s, { type: 'SET_DEVICE', ticketId: id, busy: true }).state;
    s = ok(s, { type: 'CONSENT', ticketId: id, grant: true }, T0 + MIN).state;
    expect(status(s, id)).toBe('WAITING_DEVICE');
    s = processDue(s, T0 + DAY + 2 * MIN);
    expect(status(s, id)).toBe('AWAITING_APPROVAL'); // approval TTL (60m) expired first
    expect(s.audit.some((a) => a.action === 'APPROVAL_EXPIRED')).toBe(true);
  });
  it('consent expires after 24h while approval (bound to window) is still valid', () => {
    let { s, id } = create(emptyState(), 'OS_UPDATE');
    s = ok(s, { type: 'APPROVE', ticketId: id, scheduleAt: iso(T0 + DAY), impactConfirmed: true }, T0, MORGAN).state;
    s = ok(s, { type: 'CONSENT', ticketId: id, grant: true }, T0 + MIN).state;
    s = ok(s, { type: 'SET_DEVICE', ticketId: id, busy: true }, T0 + 2 * MIN).state;
    expect(status(s, id)).toBe('WAITING_DEVICE');
    s = processDue(s, T0 + DAY + 3 * MIN);
    expect(status(s, id)).toBe('AWAITING_CONSENT');
    expect(s.executions).toHaveLength(0);
  });
  it('stale approval: expires before start -> AWAITING_APPROVAL', () => {
    let { s, id } = create(emptyState(), 'WIFI');
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    s = processDue(s, T0 + 61 * MIN);
    expect(status(s, id)).toBe('AWAITING_APPROVAL');
    const r = act(s, { type: 'CONSENT', ticketId: id, grant: true }, T0 + 62 * MIN);
    expect(r.ok).toBe(false);
  });
  it('policy version change invalidates outstanding approvals and consent', () => {
    let { s, id } = create(emptyState(), 'WIFI');
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    const { version: _v, ...p } = s.policy; void _v;
    s = ok(s, { type: 'SAVE_POLICY', policy: { ...p, approvalTTLMin: 30 }, reason: 'tighten TTL' }, T0 + MIN, MORGAN).state;
    expect(s.policy.version).toBe(2);
    expect(status(s, id)).toBe('AWAITING_APPROVAL');
    expect(s.approvals[0].invalidatedAt).toBeDefined();
    expect(s.diagnoses.filter((d) => d.ticketId === id)).toHaveLength(2);
    expect(act(s, { type: 'SAVE_POLICY', policy: p, reason: 'x' }, T0, ALEX).error?.code).toBe('UNAUTHORIZED');
  });
  it('runbook retirement invalidates pending plans', () => {
    let { s, id } = create(emptyState(), 'DNS');
    s = ok(s, { type: 'RETIRE_RUNBOOK', runbookId: 'RB-002', version: 1, reason: 'superseded' }, T0 + MIN, MORGAN).state;
    expect(status(s, id)).toBe('REVIEW_REQUIRED');
    expect(s.runbooks.find((r) => r.id === 'RB-002')!.status).toBe('RETIRED');
  });
  it('policy pause before action step -> cancelled, no device mutation', () => {
    let { s, id } = create(emptyState(), 'STORAGE');
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    s = processDue(s, T0 + 800); // preflight done
    const { version: _v, ...p } = s.policy; void _v;
    s = ok(s, { type: 'SAVE_POLICY', policy: { ...p, enabled: false }, reason: 'incident freeze' }, T0 + 900, MORGAN).state;
    s = drain(s, T0 + 1000).s;
    expect(s.executions[0].phase).toBe('CANCELLED');
    expect(s.devices[s.tickets[id].deviceId].freeGB).toBe(3);
    expect(status(s, id)).toBe('REVIEW_REQUIRED');
  });
  it('verification failure -> rollback available (not resolved) -> rollback restores snapshot -> escalated', () => {
    let { s, id } = create(emptyState(), 'WIFI', { outcome: 'VERIFY_FAIL' });
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    s = ok(s, { type: 'CONSENT', ticketId: id, grant: true }).state;
    let r = drain(s, T0); s = r.s;
    expect(status(s, id)).toBe('ROLLBACK_AVAILABLE');
    expect(s.tickets[id].verified).toBe(false);
    expect(s.tickets[id].resolvedAt).toBeUndefined();
    expect(s.devices[s.tickets[id].deviceId].wifiHealthy).toBe(true);
    s = ok(s, { type: 'ROLLBACK', ticketId: id }, r.t + 1000).state;
    r = drain(s, r.t + 1000); s = r.s;
    expect(status(s, id)).toBe('ESCALATED');
    expect(s.devices[s.tickets[id].deviceId].wifiHealthy).toBe(false);
    expect(s.executions[0].phase).toBe('ROLLED_BACK');
  });
  it('rollback failure escalates without restoring', () => {
    let { s, id } = create(emptyState(), 'APP_UPDATE', { outcome: 'ROLLBACK_FAIL' });
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    s = ok(s, { type: 'CONSENT', ticketId: id, grant: true }).state;
    let r = drain(s, T0); s = r.s;
    s = ok(s, { type: 'ROLLBACK', ticketId: id }, r.t + 1).state;
    r = drain(s, r.t + 1); s = r.s;
    expect(status(s, id)).toBe('ESCALATED');
    expect(s.executions[0].phase).toBe('ROLLBACK_FAILED');
    expect(s.devices[s.tickets[id].deviceId].appVersion).toBe('2.1');
    expect(s.audit.find((a) => a.action === 'ROLLBACK_FAILED')?.reason).toMatch(/Manual recovery/);
  });
  it('irreversible rollback is denied with reason', () => {
    let { s, id } = create(emptyState(), 'STORAGE');
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    const r = drain(s, T0); s = r.s;
    const rb = act(s, { type: 'ROLLBACK', ticketId: id }, r.t + 1);
    expect(rb.ok).toBe(false);
    expect(rb.error?.message).toMatch(/Irreversible/);
  });
  it('exec failure before action: no mutation, escalated; retry limit enforced', () => {
    let { s, id } = create(emptyState({ autoEnabled: true }), 'STORAGE', { outcome: 'EXEC_FAIL' });
    expect(status(s, id)).toBe('READY');
    s = drain(s, T0).s;
    expect(status(s, id)).toBe('ESCALATED');
    expect(s.devices[s.tickets[id].deviceId].freeGB).toBe(3);
    // force READY to prove the attempt guard (no loops)
    const forced: AppState = { ...s, tickets: { ...s.tickets, [id]: { ...s.tickets[id], status: 'READY' } } };
    const r = act(forced, { type: 'START', ticketId: id });
    expect(r.error?.code).toBe('RETRY_LIMIT');
  });
  it('reopen clears verified + closure and keeps execution history', () => {
    let { s, id } = create(emptyState(), 'STORAGE');
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    const r = drain(s, T0); s = r.s;
    s = ok(s, { type: 'REOPEN', ticketId: id, reason: 'came back', byEmployee: true }, r.t + 1).state;
    expect(status(s, id)).toBe('REOPENED');
    expect(s.tickets[id].verified).toBe(false);
    expect(s.tickets[id].closedAt).toBeUndefined();
    expect(s.tickets[id].reopenedCount).toBe(1);
    expect(s.executions).toHaveLength(1);
    s = ok(s, { type: 'RUN_DIAGNOSIS', ticketId: id }, r.t + 2).state;
    expect(status(s, id)).toBe('REVIEW_REQUIRED'); // telemetry now healthy -> 65
  });
  it('preapproval: LOW auto-runs with policy authorization; MEDIUM still needs approval', () => {
    let { s, id } = create(emptyState({ autoEnabled: true }), 'STORAGE');
    expect(status(s, id)).toBe('READY');
    s = drain(s, T0).s;
    expect(status(s, id)).toBe('CLOSED');
    expect(s.tickets[id].path).toBe('AUTO_POLICY');
    expect(s.executions[0].authorization.kind).toBe('POLICY');
    const w = create(s, 'WIFI');
    expect(status(w.s, w.id)).toBe('AWAITING_APPROVAL');
  });
  it('manual resolution and draft proposal never auto-activate', () => {
    let { s, id } = create(emptyState(), 'CRASH');
    expect(status(s, id)).toBe('REVIEW_REQUIRED');
    expect(act(s, { type: 'RESOLVE_MANUAL', ticketId: id, note: 'fixed it', evidence: 'ok now', verified: false }).ok).toBe(false);
    s = ok(s, { type: 'RESOLVE_MANUAL', ticketId: id, note: 'Reinstalled plugin', evidence: 'No crash in 5 runs', verified: true }).state;
    expect(status(s, id)).toBe('CLOSED');
    const r = ok(s, { type: 'PROPOSE_DRAFT', fromTicketId: id });
    const draft = r.state.runbooks.find((x) => x.id === r.ticketId)!;
    expect(draft.status).toBe('DRAFT');
    expect(draft.risk).toBe('HIGH');
    expect(draft.preapproved).toBe(false);
    expect(act(r.state, { type: 'PUBLISH_RUNBOOK', runbookId: draft.id, version: 1, note: 'x' }, T0, MORGAN).ok).toBe(false); // validation fails
  });
});

describe('persistence & runner idempotency', () => {
  it('resumes persisted jobs after refresh and duplicate ticks add no audit', () => {
    let { s, id } = create(emptyState(), 'STORAGE');
    s = ok(s, { type: 'APPROVE', ticketId: id }).state;
    const reloaded: AppState = JSON.parse(JSON.stringify(s));
    const a = processDue(reloaded, T0 + 10_000);
    const b = processDue(a, T0 + 10_000);
    expect(b).toBe(a);
    const c = processDue(a, T0 + 10_000);
    expect(c.audit.length).toBe(a.audit.length);
    const done = drain(a, T0 + 10_000).s;
    expect(done.tickets[id].status).toBe('CLOSED');
    expect(done.audit.filter((x) => x.action === 'TICKET_CLOSED' && x.ticketId === id)).toHaveLength(1);
  });
});
