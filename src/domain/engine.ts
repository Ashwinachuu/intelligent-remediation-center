import { ACTORS, BASELINES, CATEGORY_LABEL, HEALTHY_DEVICE, MATURITY_LABEL, SIM_ACTIONS, SLA_HOURS, defaultStepDefs, inferCategory, isExecutable, symptomFor, telemetryFor } from './catalog';
import { preflight, preflightSummary } from './preflight';
import { maturityCriteria } from './maturity';
import { computeDiagnosis, findRunbook, intakeEligibility } from './diagnosis';
import { DEFAULT_POLICY, canRoleApprove, evaluateRoute, validatePolicy, type GateResult } from './policy';
import { DomainError, ESCALATABLE, GATE_STATES, RUNNING_STATES, assertTransition, STATUS_LABEL } from './transitions';
import type {
  Actor, AppNotification, AppState, Approval, AuditEvent, Category, Device, Diagnosis, EvidenceKind, Execution,
  Outcome, Policy, Role, Runbook, ScenarioKey, ScheduledJob, Status, Ticket, StepApproval, EmployeeChoice, Maturity, Assumptions,
} from './types';
import { DAY, MIN, iso, ms, uuid } from './util';

// ---------------------------------------------------------------------------------------------
// Transaction helper: copy-on-write updates so the input state is never mutated.
// ---------------------------------------------------------------------------------------------
export interface Timing { stepMs: number; verifyMs: number; closeMs: number }
export const LIVE_TIMING: Timing = { stepMs: 700, verifyMs: 900, closeMs: 700 };

export class Tx {
  s: AppState;
  dirty = false;
  nowIso: string;
  constructor(state: AppState, public now: number, public user: Actor, public timing: Timing = LIVE_TIMING) {
    this.s = { ...state };
    this.nowIso = iso(now);
  }
  get policy() { return this.s.policy; }
  ticket(id: string): Ticket {
    const t = this.s.tickets[id];
    if (!t) throw new DomainError('NOT_FOUND', `Ticket ${id} not found`);
    return t;
  }
  device(id: string): Device {
    const d = this.s.devices[id];
    if (!d) throw new DomainError('NOT_FOUND', `Device ${id} not found`);
    return d;
  }
  patchTicket(id: string, patch: Partial<Ticket>) {
    this.s.tickets = { ...this.s.tickets, [id]: { ...this.ticket(id), ...patch, updatedAt: this.nowIso } };
    this.dirty = true;
  }
  putDevice(d: Device) { this.s.devices = { ...this.s.devices, [d.id]: d }; this.dirty = true; }
  patchDevice(id: string, patch: Partial<Device>) { this.putDevice({ ...this.device(id), ...patch }); }
  audit(e: Omit<AuditEvent, 'id' | 'seq' | 'at' | 'actor' | 'role' | 'metadata' | 'result'> & { actor?: Actor; metadata?: Record<string, unknown>; result?: AuditEvent['result'] }) {
    const seq = this.s.seq.audit + 1;
    this.s.seq = { ...this.s.seq, audit: seq };
    const actor = e.actor ?? this.user;
    const ev: AuditEvent = { id: uuid(), seq, at: this.nowIso, actor: actor.name, role: actor.role, action: e.action, ticketId: e.ticketId, from: e.from, to: e.to, reason: e.reason, metadata: e.metadata ?? {}, result: e.result ?? 'SUCCESS' };
    this.s.audit = [...this.s.audit, ev];
    this.dirty = true;
    return ev;
  }
  notify(n: Omit<AppNotification, 'id' | 'at' | 'read'>) {
    this.s.notifications = [...this.s.notifications, { ...n, id: uuid(), at: this.nowIso, read: false }];
    this.dirty = true;
  }
  addDiagnosis(d: Diagnosis) { this.s.diagnoses = [...this.s.diagnoses, d]; this.dirty = true; }
  addApproval(a: Approval) { this.s.approvals = [...this.s.approvals, a]; this.dirty = true; }
  patchApproval(id: string, patch: Partial<Approval>) { this.s.approvals = this.s.approvals.map((a) => (a.id === id ? { ...a, ...patch } : a)); this.dirty = true; }
  addExecution(e: Execution) { this.s.executions = [...this.s.executions, e]; this.dirty = true; }
  exec(id: string) { const e = this.s.executions.find((x) => x.id === id); if (!e) throw new DomainError('NOT_FOUND', 'Execution not found'); return e; }
  patchExecution(id: string, patch: Partial<Execution>) { this.s.executions = this.s.executions.map((e) => (e.id === id ? { ...e, ...patch } : e)); this.dirty = true; }
  addStepApproval(a: StepApproval) { this.s.stepApprovals = [...this.s.stepApprovals, a]; this.dirty = true; }
  patchStepApproval(id: string, patch: Partial<StepApproval>) { this.s.stepApprovals = this.s.stepApprovals.map((a) => (a.id === id ? { ...a, ...patch } : a)); this.dirty = true; }
  addJob(j: ScheduledJob) { this.s.jobs = [...this.s.jobs, j]; this.dirty = true; }
  patchJob(id: string, patch: Partial<ScheduledJob>) { this.s.jobs = this.s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)); this.dirty = true; }
  /** Central guarded status change. Illegal transitions throw and the transaction is discarded. */
  move(ticketId: string, to: Status, action: string, reason: string, metadata: Record<string, unknown> = {}, actor?: Actor, result: AuditEvent['result'] = 'SUCCESS') {
    const t = this.ticket(ticketId);
    assertTransition(t.status, to);
    this.patchTicket(ticketId, { status: to });
    this.audit({ ticketId, action, from: t.status, to, reason, metadata, actor, result });
  }
}

const SYSTEM: Actor = { name: 'System', role: 'SYSTEM' };
export const actorFor = (role: Role): Actor => ({ name: ACTORS[role], role });
const employeeOf = (t: Ticket): Actor => ({ name: t.requester, role: 'EMPLOYEE' });

// ---------------------------------------------------------------------------------------------
// Selectors used by both engine and UI.
// ---------------------------------------------------------------------------------------------
export const currentDiagnosis = (s: AppState, t: Ticket) => (t.diagnosisId ? s.diagnoses.find((d) => d.id === t.diagnosisId) : undefined);
export function planRunbook(s: AppState, d?: Diagnosis): Runbook | undefined {
  if (!d?.runbookId) return undefined;
  const rb = s.runbooks.find((r) => r.id === d.runbookId && r.version === d.runbookVersion);
  return rb && isExecutable(rb) ? rb : undefined;
}
export function validApproval(s: AppState, t: Ticket, d: Diagnosis | undefined, now: number): Approval | undefined {
  if (!d) return undefined;
  return s.approvals.find((a) => a.ticketId === t.id && a.decision === 'APPROVE' && a.planHash === d.planHash && a.policyVersion === s.policy.version && !a.consumedBy && !a.invalidatedAt && ms(a.expiresAt) > now);
}
export const consentValid = (t: Ticket, d: Diagnosis | undefined, now: number) => !!(d && t.consent?.granted && t.consent.planHash === d.planHash && ms(t.consent.expiresAt) > now);
export const pendingJob = (s: AppState, t: Ticket) => s.jobs.find((j) => j.ticketId === t.id && j.status === 'PENDING');
export const activeExecution = (s: AppState, ticketId: string) => s.executions.find((e) => e.ticketId === ticketId && ['RUNNING', 'VERIFYING', 'ROLLING_BACK', 'AWAITING_STEP'].includes(e.phase));
export const deviceBusyWithJob = (s: AppState, deviceId: string) => s.executions.find((e) => e.deviceId === deviceId && ['RUNNING', 'VERIFYING', 'ROLLING_BACK', 'AWAITING_STEP'].includes(e.phase));
export const latestAppliedExecution = (s: AppState, ticketId: string) => [...s.executions].reverse().find((e) => e.ticketId === ticketId && !!e.appliedAt);
export const attemptsForRevision = (s: AppState, ticketId: string, revision: number) => s.executions.filter((e) => e.ticketId === ticketId && e.diagnosisRevision === revision && e.phase !== 'CANCELLED').length;

/** Shared-incident hold: endpoint remediation pauses while the linked parent incident is open (enhancement §7). */
export function holdReasonFor(s: AppState, t: Ticket): string | undefined {
  if (!t.parentId) return undefined;
  const p = s.tickets[t.parentId];
  if (!p || p.status === 'RESOLVED' || p.status === 'CLOSED') return undefined;
  return `On hold: linked to shared incident ${p.displayId} under investigation — individual endpoint remediation paused`;
}
export const runbookOf = (s: AppState, e: Execution) => s.runbooks.find((r) => r.id === e.runbookId && r.version === e.version);
/** A step approval is valid only for the same execution, step, endpoint, action, runbook version and plan — and only while that runbook version is still approved. */
export function validStepApproval(s: AppState, e: Execution, now: number): StepApproval | undefined {
  const rb = runbookOf(s, e);
  const sd = rb?.stepDefs[e.stepIndex];
  if (!rb || !sd || rb.status !== 'APPROVED') return undefined;
  return s.stepApprovals.find((a) => a.decision === 'APPROVE' && a.executionId === e.id && a.stepId === sd.id && a.deviceId === e.deviceId && a.runbookId === rb.id
    && a.runbookVersion === rb.version && a.actionKey === (rb.actionKey ?? '') && a.planHash === e.planHash && !a.invalidatedAt && ms(a.expiresAt) > now);
}
export const pausedExecution = (s: AppState, ticketId: string) => s.executions.find((e) => e.ticketId === ticketId && (e.phase === 'AWAITING_STEP' || (e.phase === 'RUNNING' && !!e.stepScheduledFor && !e.appliedAt)));

export interface Gates extends GateResult { diagnosis?: Diagnosis; runbook?: Runbook; approval?: Approval; job?: ScheduledJob; device: Device; consentOk: boolean }
export function gatesFor(s: AppState, ticketId: string, now: number, override: { approvalValid?: boolean; scheduleDueAt?: string } = {}): Gates {
  const t = s.tickets[ticketId];
  const device = s.devices[t.deviceId];
  const diagnosis = currentDiagnosis(s, t);
  const runbook = planRunbook(s, diagnosis);
  const approval = validApproval(s, t, diagnosis, now);
  const job = pendingJob(s, t);
  const consentOk = consentValid(t, diagnosis, now);
  if (!diagnosis) {
    return { route: 'OPEN', reasons: ['Not yet diagnosed'], requiredRole: null, needsConsent: false, needsSchedule: false, autoEligible: false, hardBlock: false, device, consentOk };
  }
  const g = evaluateRoute({
    confidence: diagnosis.confidence, risk: diagnosis.risk, runbook, device, policy: s.policy,
    approvalValid: override.approvalValid ?? !!approval, consentValid: consentOk, scheduleDueAt: override.scheduleDueAt ?? job?.dueAt, now,
    source: t.source, holdReason: holdReasonFor(s, t),
  });
  return { ...g, diagnosis, runbook, approval, job, device, consentOk };
}

// ---------------------------------------------------------------------------------------------
// Internal engine operations.
// ---------------------------------------------------------------------------------------------
function invalidateApprovals(tx: Tx, ticketId: string, reason: string) {
  for (const a of tx.s.approvals) {
    if (a.ticketId === ticketId && a.decision === 'APPROVE' && !a.consumedBy && !a.invalidatedAt && !a.expiredLoggedAt) {
      tx.patchApproval(a.id, { invalidatedAt: tx.nowIso, invalidReason: reason });
      tx.patchTicket(ticketId, { reworks: tx.ticket(ticketId).reworks + 1 });
      tx.audit({ ticketId, action: 'APPROVAL_INVALIDATED', reason, metadata: { approvalId: a.id, planHash: a.planHash, policyVersion: a.policyVersion }, actor: SYSTEM, result: 'INFO' });
    }
  }
}
function cancelJobs(tx: Tx, ticketId: string, reason: string) {
  for (const j of tx.s.jobs) if (j.ticketId === ticketId && j.status === 'PENDING') {
    tx.patchJob(j.id, { status: 'CANCELLED' });
    tx.audit({ ticketId, action: 'SCHEDULE_CANCELLED', reason, metadata: { jobId: j.id, dueAt: j.dueAt }, actor: SYSTEM, result: 'INFO' });
  }
}
function invalidateConsent(tx: Tx, ticketId: string, newHash: string, reason: string) {
  const t = tx.ticket(ticketId);
  if (t.consent && t.consent.planHash !== newHash) {
    tx.patchTicket(ticketId, { consent: undefined });
    tx.audit({ ticketId, action: 'CONSENT_INVALIDATED', reason, metadata: { previousPlanHash: t.consent.planHash }, actor: SYSTEM, result: 'INFO' });
  }
}

function invalidateStepApprovals(tx: Tx, execId: string, reason: string) {
  for (const a of tx.s.stepApprovals) if (a.executionId === execId && a.decision === 'APPROVE' && !a.invalidatedAt && !a.usedAt) {
    tx.patchStepApproval(a.id, { invalidatedAt: tx.nowIso, invalidReason: reason });
    tx.audit({ ticketId: a.ticketId, action: 'STEP_APPROVAL_INVALIDATED', reason, metadata: { stepApprovalId: a.id, stepId: a.stepId, runbook: `${a.runbookId} v${a.runbookVersion}` }, actor: SYSTEM, result: 'INFO' });
  }
}
/** Cancel an execution that is paused before any device mutation (approved action changed, escalated, rejected or held). */
function cancelPausedExecution(tx: Tx, ticketId: string, reason: string) {
  const e = pausedExecution(tx.s, ticketId);
  if (!e) return;
  tx.patchExecution(e.id, { phase: 'CANCELLED', endedAt: tx.nowIso, nextAt: undefined, stepScheduledFor: undefined, cancelReason: reason });
  invalidateStepApprovals(tx, e.id, reason);
  tx.audit({ ticketId, action: 'EXECUTION_CANCELLED', reason: `${reason}; no device change applied`, metadata: { executionId: e.id }, actor: SYSTEM, result: 'BLOCKED' });
}

/** Fresh diagnosis revision. Changes plan hash => outstanding approvals/consent/schedules are invalidated. */
function diagnose(tx: Tx, ticketId: string, reason: string, actor: Actor = SYSTEM) {
  const t = tx.ticket(ticketId);
  cancelPausedExecution(tx, ticketId, `Plan changed: ${reason}`);
  if (t.status !== 'DIAGNOSING') tx.move(ticketId, 'DIAGNOSING', 'DIAGNOSIS_STARTED', reason, {}, actor);
  const prev = tx.s.diagnoses.filter((d) => d.ticketId === ticketId).reduce((m, d) => Math.max(m, d.revision), 0);
  const dev = tx.device(t.deviceId);
  const d = computeDiagnosis(tx.ticket(ticketId), dev, tx.s.runbooks, tx.policy, prev + 1, tx.nowIso);
  tx.addDiagnosis(d);
  tx.patchTicket(ticketId, { diagnosisId: d.id });
  invalidateApprovals(tx, ticketId, `Plan changed (diagnosis revision ${d.revision})`);
  invalidateConsent(tx, ticketId, d.planHash, `Plan changed (diagnosis revision ${d.revision})`);
  cancelJobs(tx, ticketId, `Plan changed (diagnosis revision ${d.revision})`);
  const g = gatesFor(tx.s, ticketId, tx.now);
  tx.move(ticketId, g.route, 'DIAGNOSIS_COMPLETED', g.reasons.join('; '), {
    diagnosisId: d.id, revision: d.revision, category: d.category, confidence: d.confidence, risk: d.risk, runbook: d.runbookId ? `${d.runbookId} v${d.runbookVersion}` : null,
    planHash: d.planHash, policyVersion: d.policyVersion,
  }, SYSTEM);
  if (g.route === 'AWAITING_APPROVAL') tx.notify({ ticketId, recipient: g.requiredRole === 'ADMIN' ? 'ADMIN' : 'AGENT', message: `${t.displayId} needs ${g.requiredRole === 'ADMIN' ? 'admin' : 'agent'} approval (${d.risk} risk, score ${d.confidence})` });
  return d;
}

/** Re-evaluate all gates for a nonrunning ticket; re-diagnose if the plan is stale. */
function reroute(tx: Tx, ticketId: string, reason: string) {
  const t = tx.ticket(ticketId);
  if (!GATE_STATES.includes(t.status)) return;
  const d = currentDiagnosis(tx.s, t);
  if (!d || d.policyVersion !== tx.policy.version || (d.runbookId && !planRunbook(tx.s, d))) { diagnose(tx, ticketId, `${reason}: plan is stale`); return; }
  const g = gatesFor(tx.s, ticketId, tx.now);
  if (g.route !== t.status) {
    tx.move(ticketId, g.route, 'GATES_REEVALUATED', `${reason}: ${g.reasons[g.reasons.length - 1]}`, { gateReasons: g.reasons }, SYSTEM);
    if (g.route === 'AWAITING_CONSENT') tx.notify({ ticketId, recipient: 'EMPLOYEE', message: `${t.displayId}: IT requests your consent for "${g.runbook?.title}" (${g.runbook?.expectedMin} min, may briefly disrupt work).` });
    if (g.route === 'ESCALATED') { invalidateApprovals(tx, ticketId, 'Escalated by gate re-evaluation'); cancelJobs(tx, ticketId, 'Escalated'); }
  }
}

function startExecution(tx: Tx, ticketId: string) {
  const t = tx.ticket(ticketId);
  if (t.status !== 'READY') throw new DomainError('ILLEGAL_TRANSITION', `Cannot start from ${STATUS_LABEL[t.status]}`);
  const g = gatesFor(tx.s, ticketId, tx.now);
  if (g.route !== 'READY' || !g.runbook || !g.diagnosis) { reroute(tx, ticketId, 'Pre-start gate check failed'); throw new DomainError('BLOCKED', `Pre-start check failed: ${g.reasons.join('; ')}`); }
  if (activeExecution(tx.s, ticketId) || deviceBusyWithJob(tx.s, t.deviceId)) throw new DomainError('DUPLICATE', 'An execution is already in flight for this ticket or device');
  if (attemptsForRevision(tx.s, ticketId, g.diagnosis.revision) >= tx.policy.maxAttempts) throw new DomainError('RETRY_LIMIT', `Attempt limit (${tx.policy.maxAttempts}) reached for diagnosis revision ${g.diagnosis.revision}; a new human-reviewed plan is required`);
  const id = uuid();
  const authorization: Execution['authorization'] = g.approval
    ? { kind: 'APPROVAL', approvalId: g.approval.id, actor: g.approval.actor, role: g.approval.role, approvedAt: g.approval.at, policyVersion: g.approval.policyVersion, valid: true }
    : { kind: 'POLICY', policyVersion: tx.policy.version, decision: g.reasons[0], valid: g.autoEligible };
  if (!authorization.valid) throw new DomainError('UNAUTHORIZED', 'No valid approval or policy authorization at start');
  // Re-validate every preflight prerequisite immediately before execution.
  const pf = preflight(tx.s, ticketId, tx.now);
  if (!pf.ok) {
    tx.audit({ ticketId, action: 'PREFLIGHT_BLOCKED', reason: pf.blocking.map((c) => `${c.label}: ${c.detail}`).join('; '), metadata: { checks: pf.checks }, actor: SYSTEM, result: 'BLOCKED' });
    throw new DomainError('BLOCKED', `Preflight blocked: ${pf.blocking.map((c) => c.label).join(', ')}`);
  }
  tx.audit({ ticketId, action: 'PREFLIGHT_PASSED', reason: preflightSummary(pf), metadata: { checks: pf.checks }, actor: SYSTEM });
  if (g.approval) tx.patchApproval(g.approval.id, { consumedBy: id });
  let scheduledDelayMin = 0;
  if (g.job) {
    tx.patchJob(g.job.id, { status: 'DONE' });
    scheduledDelayMin = Math.max(0, Math.round((ms(g.job.originalDueAt) - ms(g.job.createdAt)) / MIN));
  }
  const path = g.approval ? 'HUMAN_APPROVED' : 'AUTO_POLICY';
  const e: Execution = {
    id, ticketId, planHash: g.diagnosis.planHash, runbookId: g.runbook.id, version: g.runbook.version, path, startedAt: tx.nowIso, phase: 'RUNNING', stepIndex: 0,
    nextAt: iso(tx.now + tx.timing.stepMs), snapshot: { ...g.device }, results: [], outcome: t.outcome, verificationPassed: false, deviceId: t.deviceId,
    diagnosisRevision: g.diagnosis.revision, simOutcome: t.outcome, authorization, changes: [], reversible: g.runbook.reversible, risk: g.diagnosis.risk,
    stepMs: tx.timing.stepMs, verifyMs: tx.timing.verifyMs, closeMs: tx.timing.closeMs, rollbackResults: [], verificationOutput: [], preflight: pf.checks,
  };
  tx.addExecution(e);
  tx.patchTicket(ticketId, { path, executionIds: [...t.executionIds, id], scheduledDelayMin: t.scheduledDelayMin + scheduledDelayMin });
  tx.move(ticketId, 'EXECUTING', 'EXECUTION_STARTED', `${g.runbook.id} v${g.runbook.version} started via ${path === 'AUTO_POLICY' ? `policy v${tx.policy.version}` : `approval by ${g.approval?.actor}`}`, {
    executionId: id, runbook: `${g.runbook.id} v${g.runbook.version}`, planHash: e.planHash, authorization, policyVersion: tx.policy.version,
  }, SYSTEM);
}

function modeled(t: Ticket, path: Ticket['path'], expectedMin: number) {
  const extra = 2 * t.reviewDecisions + 5 * t.recoveries + 1 * t.reworks;
  if (path === 'AUTO_POLICY') return { modeledResolutionMin: expectedMin, agentMin: 1 + extra };
  if (path === 'HUMAN_APPROVED') return { modeledResolutionMin: expectedMin + 8 + t.scheduledDelayMin, agentMin: 4 + extra };
  return { modeledResolutionMin: t.baselineResolutionMin, agentMin: t.baselineAgentMin + extra };
}

function finishExecFailure(tx: Tx, e: Execution, outcome: Outcome, msg: string) {
  const t = tx.ticket(e.ticketId);
  const canRollback = e.reversible && e.changes.length > 0;
  tx.patchExecution(e.id, { phase: 'FAILED', outcome, endedAt: tx.nowIso, nextAt: undefined, verificationPassed: false });
  const to: Status = canRollback ? 'ROLLBACK_AVAILABLE' : 'ESCALATED';
  tx.move(e.ticketId, to, outcome === 'EXEC_FAIL' ? 'EXECUTION_FAILED' : 'VERIFICATION_FAILED', `${msg}${canRollback ? ' — rollback available' : e.changes.length ? ' — action irreversible, escalated' : ' — no change applied, escalated'}`, { executionId: e.id, outcome, results: tx.exec(e.id).results }, SYSTEM, 'FAILURE');
  tx.notify({ ticketId: e.ticketId, recipient: 'AGENT', message: `${t.displayId}: ${outcome === 'EXEC_FAIL' ? 'execution failed before action' : 'verification failed'}${canRollback ? ' — one-click rollback available' : ' — escalated'}` });
}

const DEVICE_LABELS: Partial<Record<keyof Device, string>> = { freeGB: 'Free disk (GB)', dnsHealthy: 'DNS healthy', serviceHealthy: 'Service healthy', wifiHealthy: 'Wi-Fi healthy', restartPending: 'Restart pending', appVersion: 'App version', osVersion: 'OS version' };
export const deviceFieldLabel = (f: keyof Device) => DEVICE_LABELS[f] ?? String(f);

/** Advance one due step of an execution. Idempotent: each step moves stepIndex/phase forward exactly once. */
function stepExecution(tx: Tx, e0: Execution) {
  const e = tx.exec(e0.id);
  if (!e.nextAt || ms(e.nextAt) > tx.now) return;
  const t = tx.ticket(e.ticketId);
  const dev = tx.device(e.deviceId);
  const rb = tx.s.runbooks.find((r) => r.id === e.runbookId && r.version === e.version)!;
  const act = SIM_ACTIONS[rb.actionKey!]!;
  const res = (line: string) => [...tx.exec(e.id).results, line];

  const cancel = (stage: string, why: string, action = 'EXECUTION_CANCELLED') => {
    tx.patchExecution(e.id, { phase: 'CANCELLED', endedAt: tx.nowIso, nextAt: undefined, stepScheduledFor: undefined, cancelReason: why, results: res(`${stage}: stopped before mutation — ${why}`) });
    invalidateStepApprovals(tx, e.id, why);
    tx.patchTicket(e.ticketId, { reworks: t.reworks + 1 });
    const g = gatesFor(tx.s, e.ticketId, tx.now);
    const to: Status = g.route === 'READY' ? 'REVIEW_REQUIRED' : g.route;
    tx.move(e.ticketId, to, action, `${why}; no device change applied. ${to === g.route ? g.reasons[g.reasons.length - 1] : 'Human review required before retry'}`, { executionId: e.id }, SYSTEM, 'BLOCKED');
  };

  if (e.phase === 'RUNNING') {
    const sd = rb.stepDefs[e.stepIndex];
    if (!sd) {
      tx.patchExecution(e.id, { phase: 'VERIFYING', nextAt: iso(tx.now + e.verifyMs) });
      tx.move(e.ticketId, 'VERIFYING', 'VERIFICATION_STARTED', `Checks: ${rb.checks.join('; ')}`, { executionId: e.id }, SYSTEM);
      return;
    }
    const label = `Step ${sd.id} · ${sd.description}`;
    if (!e.appliedAt) {
      // Before any mutation: offline always stops; pause/busy stop upcoming change steps (read-only steps may continue).
      const why = !dev.online ? 'Device went offline' : sd.type === 'ACTION' && !tx.policy.enabled ? 'Automation paused by policy' : sd.type === 'ACTION' && dev.busy ? 'Device became busy' : null;
      if (why) { cancel(label, why); return; }
    }
    if (e.stepIndex === 0 && e.simOutcome === 'EXEC_FAIL') {
      tx.patchExecution(e.id, { results: res(`${label} — FAILED: simulated prerequisite check error; no change applied`) });
      finishExecFailure(tx, tx.exec(e.id), 'EXEC_FAIL', 'Execution failed before action');
      return;
    }
    if (sd.approval === 'STEP') {
      const sa = validStepApproval(tx.s, e, tx.now);
      if (!sa) {
        tx.patchExecution(e.id, { phase: 'AWAITING_STEP', nextAt: undefined, pausedStepId: sd.id, stepScheduledFor: undefined });
        tx.move(e.ticketId, 'STEP_APPROVAL', 'STEP_APPROVAL_REQUIRED', `Paused at ${label} (${sd.risk} risk) — explicit ${sd.risk === 'HIGH' ? 'admin' : 'agent'} step approval required`, { executionId: e.id, stepId: sd.id, risk: sd.risk, dependsOn: sd.dependsOn }, SYSTEM, 'INFO');
        tx.notify({ ticketId: e.ticketId, recipient: sd.risk === 'HIGH' ? 'ADMIN' : 'AGENT', message: `${t.displayId}: paused at high-impact step ${sd.id} — step approval required` });
        return;
      }
    }
    if (sd.type === 'ACTION') {
      const pf = preflight(tx.s, e.ticketId, tx.now, { execution: e });
      if (!pf.ok) {
        tx.audit({ ticketId: e.ticketId, action: 'PREFLIGHT_BLOCKED', reason: pf.blocking.map((c) => `${c.label}: ${c.detail}`).join('; '), metadata: { executionId: e.id, stepId: sd.id, checks: pf.checks }, actor: SYSTEM, result: 'BLOCKED' });
        cancel(label, `Preflight re-validation failed (${pf.blocking.map((c) => c.label).join(', ')})`);
        return;
      }
      tx.audit({ ticketId: e.ticketId, action: 'PREFLIGHT_REVALIDATED', reason: `Before ${sd.id}: ${preflightSummary(pf)}`, metadata: { executionId: e.id, stepId: sd.id, checks: pf.checks }, actor: SYSTEM });
      const sa = validStepApproval(tx.s, e, tx.now);
      if (sa) tx.patchStepApproval(sa.id, { usedAt: tx.nowIso });
      const patch = act.patch(dev);
      const changes = (Object.keys(patch) as (keyof Device)[]).filter((k) => patch[k] !== dev[k]).map((k) => ({ field: k, before: dev[k], after: patch[k] }));
      tx.patchDevice(dev.id, patch);
      const deadline = e.reversible ? iso(tx.now + 30 * MIN) : undefined;
      tx.patchExecution(e.id, { changes, appliedAt: tx.nowIso, rollbackDeadline: deadline, stepIndex: e.stepIndex + 1, nextAt: iso(tx.now + e.stepMs), stepScheduledFor: undefined, results: res(`${label} — applied: ${changes.map((c) => `${deviceFieldLabel(c.field)} ${String(c.before)} → ${String(c.after)}`).join(', ') || 'no field change needed'}`) });
      tx.audit({ ticketId: e.ticketId, action: 'ACTION_APPLIED', reason: `${sd.id}: ${act.label}`, metadata: { executionId: e.id, stepId: sd.id, changes, rollbackDeadline: deadline ?? 'not reversible' }, actor: SYSTEM });
      return;
    }
    const isSnapshot = sd.type === 'SNAPSHOT' || e.stepIndex === 0;
    tx.patchExecution(e.id, { ...(isSnapshot ? { snapshot: { ...dev } } : {}), stepIndex: e.stepIndex + 1, nextAt: iso(tx.now + e.stepMs), results: res(`${label} — ${sd.type === 'DIAGNOSTIC' ? 'read-only, auto-executed' : 'snapshot captured'}: ${sd.expectedResult}`) });
    tx.audit({ ticketId: e.ticketId, action: 'STEP_COMPLETED', reason: `${sd.id} ${sd.description} (${sd.type.toLowerCase()}, auto)`, metadata: { executionId: e.id, stepId: sd.id, type: sd.type }, actor: SYSTEM });
    return;
  }
  if (e.phase === 'VERIFYING') {
    const v = act.verify(dev);
    const pass = e.simOutcome === 'SUCCESS' && v.pass;
    const output = pass ? [`PASS · ${v.output}`] : [`FAIL · ${e.simOutcome === 'SUCCESS' ? v.output : act.failOutput}`];
    tx.patchExecution(e.id, { verificationOutput: output });
    if (!pass) { finishExecFailure(tx, tx.exec(e.id), e.simOutcome === 'SUCCESS' ? 'VERIFY_FAIL' : e.simOutcome, `Verification failed: ${output[0]}`); return; }
    const m = modeled(t, e.path, rb.expectedMin);
    tx.patchExecution(e.id, { phase: 'PASSED', outcome: 'SUCCESS', verificationPassed: true, endedAt: tx.nowIso, closurePending: true, nextAt: iso(tx.now + e.closeMs) });
    tx.patchTicket(e.ticketId, { verified: true, resolvedAt: tx.nowIso, firstResolvedAt: t.firstResolvedAt ?? tx.nowIso, ...m });
    tx.move(e.ticketId, 'RESOLVED', 'VERIFICATION_PASSED', `Verified: ${v.output}`, { executionId: e.id, verificationOutput: output, modeledResolutionMin: m.modeledResolutionMin, agentMin: m.agentMin }, SYSTEM);
    tx.notify({ ticketId: e.ticketId, recipient: 'EMPLOYEE', message: `${t.displayId} was fixed and verified (${rb.title}).${tx.policy.closureMode === 'EMPLOYEE_CONFIRM' ? ' Please confirm it works.' : ' Reply if the issue returns.'}` });
    return;
  }
  if (e.phase === 'PASSED' && e.closurePending) {
    tx.patchExecution(e.id, { closurePending: false, nextAt: undefined });
    if (t.status === 'RESOLVED' && tx.policy.closureMode === 'AUTO') {
      tx.patchTicket(e.ticketId, { closedAt: tx.nowIso });
      tx.move(e.ticketId, 'CLOSED', 'TICKET_CLOSED', 'Auto-closed by policy after verified remediation', { executionId: e.id, closureMode: 'AUTO' }, SYSTEM);
    }
    return;
  }
  if (e.phase === 'ROLLING_BACK') {
    const step = e.rollbackStep ?? 0;
    const rres = (line: string) => [...tx.exec(e.id).rollbackResults, line];
    if (step === 0) {
      const conflicts = e.changes.filter((c) => dev[c.field] !== c.after);
      if (conflicts.length) { finishRollback(tx, e.id, false, `Conflicting device change on ${conflicts.map((c) => deviceFieldLabel(c.field)).join(', ')} — rollback refused`); return; }
      tx.patchExecution(e.id, { rollbackStep: 1, nextAt: iso(tx.now + e.stepMs), rollbackResults: rres('Rollback step 1 · prerequisites verified (deadline, no conflicting changes)') });
    } else if (step === 1) {
      if (e.simOutcome === 'ROLLBACK_FAIL') {
        tx.patchExecution(e.id, { rollbackStep: 2, nextAt: iso(tx.now + e.verifyMs), rollbackResults: rres('Rollback step 2 · restore FAILED — simulated restore error; snapshot NOT restored') });
      } else {
        const patch: Partial<Device> = {};
        for (const c of e.changes) (patch as Record<string, unknown>)[c.field] = c.before;
        tx.patchDevice(dev.id, patch);
        tx.patchExecution(e.id, { rollbackStep: 2, nextAt: iso(tx.now + e.verifyMs), rollbackResults: rres(`Rollback step 2 · restored ${e.changes.map((c) => `${deviceFieldLabel(c.field)} → ${String(c.before)}`).join(', ')}`) });
      }
    } else {
      const restored = e.changes.every((c) => dev[c.field] === c.before);
      finishRollback(tx, e.id, restored, restored ? 'Snapshot fields restored and verified' : 'Restore verification failed — device not in snapshot state');
    }
  }
}

function finishRollback(tx: Tx, execId: string, ok: boolean, msg: string) {
  const e = tx.exec(execId);
  const t = tx.ticket(e.ticketId);
  const rb = tx.s.runbooks.find((r) => r.id === e.runbookId && r.version === e.version);
  tx.patchExecution(execId, { phase: ok ? 'ROLLED_BACK' : 'ROLLBACK_FAILED', outcome: ok ? e.outcome : 'ROLLBACK_FAIL', rollbackEndedAt: tx.nowIso, nextAt: undefined, rollbackResults: [...e.rollbackResults, `${ok ? 'PASS' : 'FAIL'} · ${msg}`] });
  tx.patchTicket(e.ticketId, { verified: false, resolvedAt: undefined, closedAt: undefined, recoveries: t.recoveries + 1 });
  const manual = ok ? '' : ` Manual recovery: ${rb?.rollbackSteps.join('; ') || 'restore device manually'} — values to restore: ${e.changes.map((c) => `${deviceFieldLabel(c.field)}=${String(c.before)}`).join(', ')}.`;
  tx.move(e.ticketId, 'ESCALATED', ok ? 'ROLLBACK_COMPLETED' : 'ROLLBACK_FAILED', `${msg}. Rollback does not resolve the incident — escalated for human follow-up.${manual}`, { executionId: execId, previousOutcome: e.outcome, previousVerification: e.verificationPassed, rollbackResults: tx.exec(execId).rollbackResults }, SYSTEM, ok ? 'SUCCESS' : 'FAILURE');
  tx.notify({ ticketId: e.ticketId, recipient: 'AGENT', message: `${t.displayId}: rollback ${ok ? 'completed' : 'FAILED — manual recovery required'}; ticket escalated` });
}

/** Process all due work: approval expiry, schedules, auto starts and execution steps. Returns same object when nothing changed. */
export function processDue(state: AppState, now: number, timing: Timing = LIVE_TIMING): AppState {
  const tx = new Tx(state, now, SYSTEM, timing);
  // Expired approvals (recorded once).
  for (const a of state.approvals) {
    if (a.decision === 'APPROVE' && !a.consumedBy && !a.invalidatedAt && !a.expiredLoggedAt && ms(a.expiresAt) <= now) {
      tx.patchApproval(a.id, { expiredLoggedAt: tx.nowIso });
      const t = tx.ticket(a.ticketId);
      tx.patchTicket(t.id, { reworks: t.reworks + 1 });
      tx.audit({ ticketId: a.ticketId, action: 'APPROVAL_EXPIRED', reason: `Approval by ${a.actor} expired before start (TTL ${state.policy.approvalTTLMin} min)`, metadata: { approvalId: a.id }, actor: SYSTEM, result: 'INFO' });
    }
  }
  // Gate re-evaluation for nonrunning tickets (expiry, consent expiry, due schedules).
  for (const t of Object.values(tx.s.tickets)) if (GATE_STATES.includes(t.status) && t.status !== 'READY') {
    const g = gatesFor(tx.s, t.id, now);
    if (g.route !== t.status) reroute(tx, t.id, t.status === 'SCHEDULED' ? 'Scheduled window due' : 'Gate change');
  }
  // Auto-start READY tickets (asynchronous start for policy-preapproved and due scheduled jobs).
  for (const t of Object.values(tx.s.tickets)) if (t.status === 'READY') {
    try { startExecution(tx, t.id); } catch (err) { if (!(err instanceof DomainError)) throw err; }
  }
  // Execution steps, catching up after refresh using persisted nextAt timestamps.
  for (let guard = 0; guard < 5000; guard++) {
    const due = tx.s.executions.filter((e) => e.nextAt && ms(e.nextAt) <= now).sort((a, b) => ms(a.nextAt!) - ms(b.nextAt!))[0];
    if (!due) break;
    stepExecution(tx, due);
  }
  return tx.dirty ? tx.s : state;
}

// ---------------------------------------------------------------------------------------------
// Public guarded actions.
// ---------------------------------------------------------------------------------------------
export interface CreateTicketInput {
  title: string; description: string; requester: string; source: 'EMPLOYEE' | 'DETECTION'; priority: 'P2' | 'P3' | 'P4';
  category: Category | 'CUSTOM'; outcome: Outcome; deviceId?: string; newDevice?: Partial<Device>; scenario?: ScenarioKey | 'CUSTOM' | 'HISTORICAL'; demo?: boolean; owner?: string;
}
export type Action =
  | { type: 'CREATE_TICKET'; input: CreateTicketInput }
  | { type: 'RUN_DIAGNOSIS'; ticketId: string }
  | { type: 'ADD_EVIDENCE'; ticketId: string; kind: EvidenceKind; note: string }
  | { type: 'APPROVE'; ticketId: string; scheduleAt?: string; impactConfirmed?: boolean }
  | { type: 'REJECT'; ticketId: string; reason: string }
  | { type: 'REQUEST_REVIEW'; ticketId: string; reason: string }
  | { type: 'CONSENT'; ticketId: string; grant: boolean }
  | { type: 'SET_DEVICE'; ticketId: string; online?: boolean; busy?: boolean; batteryPct?: number }
  | { type: 'ADVANCE_SCHEDULE'; ticketId: string }
  | { type: 'START'; ticketId: string }
  | { type: 'ROLLBACK'; ticketId: string }
  | { type: 'REOPEN'; ticketId: string; byEmployee?: boolean; reason: string }
  | { type: 'EMPLOYEE_CONFIRM'; ticketId: string }
  | { type: 'ESCALATE'; ticketId: string; reason: string }
  | { type: 'RESOLVE_MANUAL'; ticketId: string; note: string; evidence: string; verified: boolean }
  | { type: 'SAVE_POLICY'; policy: Omit<Policy, 'version'>; reason: string }
  | { type: 'RESTORE_DEFAULT_POLICY'; reason: string }
  | { type: 'PROPOSE_DRAFT'; fromTicketId?: string; category?: Category; ticketIds?: string[] }
  | { type: 'UPDATE_DRAFT'; runbookId: string; version: number; patch: Partial<Runbook> }
  | { type: 'PUBLISH_RUNBOOK'; runbookId: string; version: number; note: string }
  | { type: 'NEW_VERSION'; runbookId: string }
  | { type: 'RETIRE_RUNBOOK'; runbookId: string; version: number; reason: string }
  | { type: 'APPROVE_STEP'; ticketId: string; scheduleAt?: string; impactConfirmed?: boolean }
  | { type: 'REJECT_STEP'; ticketId: string; reason: string }
  | { type: 'ADVANCE_STEP'; ticketId: string }
  | { type: 'EMPLOYEE_RESPOND'; ticketId: string; choice: EmployeeChoice; windowAt?: string; note?: string }
  | { type: 'LINK_SHARED'; ticketIds: string[] }
  | { type: 'VERIFY_RECOVERY'; ticketId: string }
  | { type: 'SUBMIT_REVIEW'; runbookId: string; version: number }
  | { type: 'RETURN_TO_DRAFT'; runbookId: string; version: number; reason: string }
  | { type: 'SET_MATURITY'; runbookId: string; version: number; to: Maturity; reason: string }
  | { type: 'UPDATE_ASSUMPTIONS'; assumptions: Assumptions }
  | { type: 'MARK_NOTIFICATIONS_READ' }
  | { type: 'SET_ROLE'; role: Role };

export interface ActionResult { ok: boolean; state: AppState; message?: string; error?: { code: string; message: string }; ticketId?: string }

const req = (cond: unknown, code: DomainError['code'], msg: string) => { if (!cond) throw new DomainError(code, msg); };
const notManager = (tx: Tx) => req(tx.user.role !== 'MANAGER', 'UNAUTHORIZED', 'Manager role is read-only');
const adminOnly = (tx: Tx) => req(tx.user.role === 'ADMIN', 'UNAUTHORIZED', 'Admin role required');

function createTicket(tx: Tx, input: CreateTicketInput): string {
  notManager(tx);
  const title = input.title.trim(), description = input.description.trim();
  req(title.length >= 3 && title.length <= 120, 'VALIDATION', 'Title must be 3–120 characters');
  req(description.length >= 3 && description.length <= 1000, 'VALIDATION', 'Description must be 3–1000 characters');
  req(input.requester.trim().length > 0, 'VALIDATION', 'Requester is required');
  const inferred = inferCategory(`${title} ${description}`);
  const category: Category = input.category === 'CUSTOM' ? inferred.category : input.category;
  let device: Device;
  if (input.deviceId) {
    device = tx.device(input.deviceId);
  } else {
    const n = tx.s.seq.device + 1;
    tx.s.seq = { ...tx.s.seq, device: n };
    const os = input.newDevice?.os ?? 'Windows 11';
    device = { ...HEALTHY_DEVICE, networkId: `HOME-${String(n).padStart(4, '0')}`, ...symptomFor(category), ...input.newDevice, id: uuid(), name: `${os === 'macOS' ? 'LT-MAC' : 'LT-W11'}-${String(n).padStart(4, '0')}`, os } as Device;
    tx.putDevice(device);
  }
  const seq = tx.s.seq.ticket + 1;
  tx.s.seq = { ...tx.s.seq, ticket: seq };
  const id = uuid();
  const b = BASELINES[category];
  const t: Ticket = {
    id, displayId: `INC-${1000 + seq}`, title, description, requester: input.requester, deviceId: device.id, source: input.source, category, priority: input.priority,
    status: 'OPEN', createdAt: tx.nowIso, updatedAt: tx.nowIso, owner: input.owner ?? 'Alex', eligibleAtIntake: false, intakePolicyVersion: tx.policy.version,
    baselineAgentMin: b.agentMin, baselineResolutionMin: b.resolutionMin, agentMin: 0, verified: false, reopenedCount: 0, outcome: input.outcome, executionIds: [],
    eligibilityReason: '', slaDueAt: iso(tx.now + SLA_HOURS[input.priority] * 60 * MIN), scenario: input.scenario ?? (input.category === 'CUSTOM' ? 'CUSTOM' : undefined), addedEvidence: [], reviewDecisions: 0, recoveries: 0, reworks: 0, scheduledDelayMin: 0, demo: input.demo,
  };
  tx.s.tickets = { ...tx.s.tickets, [id]: t };
  tx.audit({ ticketId: id, action: 'TICKET_CREATED', to: 'OPEN', reason: `${input.source === 'DETECTION' ? 'Proactive detection' : 'Employee report'}: ${title}`, metadata: {
    category: CATEGORY_LABEL[category], inferredFromText: input.category === 'CUSTOM' ? inferred.matches : undefined, device: device.name, existingDevice: !!input.deviceId,
    telemetry: { ...device }, simulatedOutcome: input.outcome, priority: input.priority,
  } });
  const d = diagnose(tx, id, 'Intake diagnosis');
  const elig = intakeEligibility(device, findRunbook(tx.s.runbooks, d.category), d.confidence, tx.policy);
  tx.patchTicket(id, { eligibleAtIntake: elig.eligible, eligibilityReason: elig.reason, intakePolicyVersion: tx.policy.version });
  return id;
}

function approve(tx: Tx, a: Extract<Action, { type: 'APPROVE' }>) {
  const t = tx.ticket(a.ticketId);
  notManager(tx);
  req(t.status === 'AWAITING_APPROVAL', 'ILLEGAL_TRANSITION', `Cannot approve from ${STATUS_LABEL[t.status]}`);
  const g = gatesFor(tx.s, t.id, tx.now);
  req(g.diagnosis && g.runbook, 'BLOCKED', 'No executable plan to approve');
  const perm = canRoleApprove(tx.user.role as Role, g.diagnosis!.risk);
  req(perm.ok, 'UNAUTHORIZED', perm.reason ?? 'Not permitted');
  req(!g.approval, 'DUPLICATE', 'This plan already has a valid approval');
  req(g.route === 'AWAITING_APPROVAL', 'BLOCKED', `Gates changed: ${g.reasons.join('; ')}`);
  let dueAt: number | undefined;
  if (a.scheduleAt) {
    dueAt = ms(a.scheduleAt);
    req(Number.isFinite(dueAt) && dueAt >= tx.now + MIN - 1000 && dueAt <= tx.now + DAY, 'VALIDATION', 'Schedule must be between now + 1 minute and now + 24 hours');
  }
  if (g.diagnosis!.risk === 'HIGH') {
    req(dueAt !== undefined, 'VALIDATION', 'HIGH-risk plans require a scheduled maintenance window');
    req(a.impactConfirmed, 'VALIDATION', 'Confirm the impact statement before approving a HIGH-risk plan');
  }
  const ttl = tx.policy.approvalTTLMin * MIN;
  const approval: Approval = {
    id: uuid(), ticketId: t.id, planHash: g.diagnosis!.planHash, policyVersion: tx.policy.version, actor: tx.user.name, role: tx.user.role as Role, decision: 'APPROVE',
    at: tx.nowIso, expiresAt: iso(Math.max(tx.now, dueAt ?? 0) + ttl), diagnosisRevision: g.diagnosis!.revision, requestedAt: g.diagnosis!.createdAt, scheduledFor: dueAt ? iso(dueAt) : undefined,
  };
  tx.addApproval(approval);
  if (dueAt !== undefined) tx.addJob({ id: uuid(), ticketId: t.id, dueAt: iso(dueAt), originalDueAt: iso(dueAt), planHash: approval.planHash, status: 'PENDING', createdAt: tx.nowIso });
  tx.audit({ ticketId: t.id, action: 'APPROVED', reason: `Approved ${g.runbook!.id} v${g.runbook!.version} (${g.diagnosis!.risk} risk, score ${g.diagnosis!.confidence})${dueAt ? ` for ${iso(dueAt)}` : ''}`, metadata: {
    approvalId: approval.id, planHash: approval.planHash, policyVersion: approval.policyVersion, expiresAt: approval.expiresAt, revision: approval.diagnosisRevision, scheduledFor: approval.scheduledFor, impactConfirmed: !!a.impactConfirmed,
  } });
  const after = gatesFor(tx.s, t.id, tx.now);
  tx.move(t.id, after.route, 'GATES_REEVALUATED', after.reasons[after.reasons.length - 1], { gateReasons: after.reasons }, SYSTEM);
  if (after.route === 'AWAITING_CONSENT') tx.notify({ ticketId: t.id, recipient: 'EMPLOYEE', message: `${t.displayId}: IT requests your consent for "${g.runbook!.title}" (~${g.runbook!.expectedMin} min, may briefly disrupt work).` });
  if (after.route === 'READY') startExecution(tx, t.id);
  return after.route === 'READY' ? 'Approved — execution started' : after.route === 'AWAITING_CONSENT' ? 'Approved — employee consent requested' : after.route === 'SCHEDULED' ? 'Approved — scheduled' : `Approved — ${STATUS_LABEL[after.route]}`;
}

function employeeRespond(tx: Tx, a: Extract<Action, { type: 'EMPLOYEE_RESPOND' }>): string {
  notManager(tx);
  const t = tx.ticket(a.ticketId);
  req(t.status === 'AWAITING_CONSENT', 'ILLEGAL_TRANSITION', 'No consent request is pending');
  const d = currentDiagnosis(tx.s, t)!;
  const emp = employeeOf(t);
  let windowAt: number | undefined;
  if (a.choice === 'SCHEDULE') {
    windowAt = a.windowAt ? ms(a.windowAt) : NaN;
    req(Number.isFinite(windowAt) && windowAt! >= tx.now + MIN - 1000 && windowAt! <= tx.now + DAY, 'VALIDATION', 'Choose a maintenance window between now + 1 minute and now + 24 hours');
  }
  tx.patchTicket(t.id, { employeeResponse: { choice: a.choice, at: tx.nowIso, windowAt: windowAt ? iso(windowAt) : undefined, note: a.note?.trim() || undefined, planHash: d.planHash } });
  tx.audit({ ticketId: t.id, action: 'EMPLOYEE_RESPONSE', reason: `Employee chose: ${{ PROCEED: 'proceed now', SCHEDULE: `maintenance window ${windowAt ? iso(windowAt) : ''}`, DECLINE: 'decline', ASSIST: 'request IT assistance' }[a.choice]} (simulated)`, metadata: { choice: a.choice, windowAt: windowAt ? iso(windowAt) : undefined, note: a.note, planHash: d.planHash }, actor: emp, result: 'INFO' });
  if (a.choice === 'PROCEED' || a.choice === 'SCHEDULE') {
    const expires = Math.max(tx.now + DAY, (windowAt ?? 0) + tx.policy.approvalTTLMin * MIN);
    tx.patchTicket(t.id, { consent: { granted: true, at: tx.nowIso, expiresAt: iso(expires), planHash: d.planHash } });
    tx.audit({ ticketId: t.id, action: 'CONSENT_GRANTED', reason: `Employee granted consent${windowAt ? ' for a selected maintenance window' : ' to proceed now'} (simulated)`, metadata: { planHash: d.planHash, expiresAt: iso(expires) }, actor: emp });
    if (windowAt !== undefined) {
      for (const j of tx.s.jobs) if (j.ticketId === t.id && j.status === 'PENDING') tx.patchJob(j.id, { status: 'CANCELLED' });
      tx.addJob({ id: uuid(), ticketId: t.id, dueAt: iso(windowAt), originalDueAt: iso(windowAt), planHash: d.planHash, status: 'PENDING', createdAt: tx.nowIso });
      const appr = validApproval(tx.s, t, d, tx.now);
      const needed = windowAt + tx.policy.approvalTTLMin * MIN;
      if (appr && ms(appr.expiresAt) < needed) {
        tx.patchApproval(appr.id, { expiresAt: iso(needed), scheduledFor: iso(windowAt) });
        tx.audit({ ticketId: t.id, action: 'APPROVAL_WINDOW_ALIGNED', reason: `Approval by ${appr.actor} aligned to the employee-selected window (same plan, policy and action)`, metadata: { approvalId: appr.id, expiresAt: iso(needed) }, actor: SYSTEM, result: 'INFO' });
      }
    }
    const g = gatesFor(tx.s, t.id, tx.now);
    if (g.route !== t.status) tx.move(t.id, g.route, 'GATES_REEVALUATED', g.reasons[g.reasons.length - 1], { gateReasons: g.reasons }, SYSTEM);
    tx.notify({ ticketId: t.id, recipient: 'AGENT', message: `${t.displayId}: employee ${windowAt ? `scheduled a window (${new Date(windowAt).toLocaleString()})` : 'consented to proceed now'}` });
    return g.route === 'READY' ? 'Consent granted — execution starting' : `Consent recorded — ${STATUS_LABEL[g.route]}`;
  }
  if (a.choice === 'DECLINE') {
    tx.patchTicket(t.id, { consent: { granted: false, at: tx.nowIso, expiresAt: tx.nowIso, planHash: d.planHash } });
    tx.move(t.id, 'ESCALATED', 'CONSENT_DENIED', 'Employee declined consent (simulated) — escalated', { planHash: d.planHash }, emp, 'BLOCKED');
  } else {
    tx.move(t.id, 'ESCALATED', 'EMPLOYEE_REQUESTED_ASSISTANCE', `Employee requested IT assistance instead of automated remediation${a.note ? `: ${a.note.trim()}` : ''} (simulated)`, { planHash: d.planHash }, emp, 'INFO');
  }
  invalidateApprovals(tx, t.id, a.choice === 'DECLINE' ? 'Consent denied' : 'Employee requested IT assistance');
  cancelJobs(tx, t.id, a.choice === 'DECLINE' ? 'Consent denied' : 'Employee requested IT assistance');
  tx.notify({ ticketId: t.id, recipient: 'AGENT', message: `${t.displayId}: employee ${a.choice === 'DECLINE' ? 'declined consent' : 'requested IT assistance'} — escalated to you` });
  return a.choice === 'DECLINE' ? 'Consent denied — ticket escalated' : 'IT assistance requested — ticket escalated';
}

function approveStep(tx: Tx, a: Extract<Action, { type: 'APPROVE_STEP' }>): string {
  notManager(tx);
  const t = tx.ticket(a.ticketId);
  const e = pausedExecution(tx.s, t.id);
  req(t.status === 'STEP_APPROVAL' && e && e.phase === 'AWAITING_STEP', 'ILLEGAL_TRANSITION', 'No step is awaiting approval');
  const rb = runbookOf(tx.s, e!)!;
  const sd = rb.stepDefs[e!.stepIndex];
  req(rb.status === 'APPROVED' && isExecutable(rb), 'BLOCKED', `${rb.id} v${rb.version} is no longer approved — the plan must be re-diagnosed`);
  const perm = canRoleApprove(tx.user.role as Role, sd.risk);
  req(perm.ok, 'UNAUTHORIZED', perm.reason === 'HIGH-risk plans require an Admin approver' ? `Step ${sd.id} is HIGH risk and requires an Admin step approver` : perm.reason ?? 'Not permitted');
  if (sd.risk === 'HIGH') req(a.impactConfirmed, 'VALIDATION', 'Confirm the step impact before approving a HIGH-risk step');
  let due: number | undefined;
  if (a.scheduleAt) {
    due = ms(a.scheduleAt);
    req(Number.isFinite(due) && due >= tx.now + MIN - 1000 && due <= tx.now + DAY, 'VALIDATION', 'Schedule must be between now + 1 minute and now + 24 hours');
  }
  const pf = preflight(tx.s, t.id, tx.now, { execution: e! });
  const blocking = pf.blocking.filter((c) => c.key !== 'auth' && c.key !== 'window');
  if (blocking.length) throw new DomainError('BLOCKED', `Preflight blocks this step: ${blocking.map((c) => `${c.label} (${c.detail})`).join('; ')}`);
  const sa: StepApproval = {
    id: uuid(), ticketId: t.id, executionId: e!.id, stepId: sd.id, deviceId: e!.deviceId, actionKey: rb.actionKey ?? '', runbookId: rb.id, runbookVersion: rb.version, planHash: e!.planHash,
    actor: tx.user.name, role: tx.user.role as Role, decision: 'APPROVE', at: tx.nowIso, expiresAt: iso(Math.max(tx.now, due ?? 0) + tx.policy.approvalTTLMin * MIN), scheduledFor: due ? iso(due) : undefined,
  };
  tx.addStepApproval(sa);
  tx.patchExecution(e!.id, { phase: 'RUNNING', nextAt: due ? iso(due) : tx.nowIso, stepScheduledFor: due ? iso(due) : undefined, pausedStepId: undefined });
  tx.move(t.id, 'EXECUTING', 'STEP_APPROVED', `Step ${sd.id} (${sd.description}) approved${due ? ` for ${iso(due)}` : ' — resuming'}; preflight re-checked before the action`, {
    stepApprovalId: sa.id, executionId: e!.id, stepId: sd.id, scope: { ticket: t.displayId, device: e!.deviceId, action: sa.actionKey, runbook: `${rb.id} v${rb.version}`, planHash: sa.planHash }, expiresAt: sa.expiresAt, impactConfirmed: !!a.impactConfirmed,
  });
  return due ? `Step ${sd.id} approved and scheduled` : `Step ${sd.id} approved — resuming`;
}

function linkShared(tx: Tx, ids: string[]): string {
  notManager(tx);
  req(ids.length >= 2, 'VALIDATION', 'Select at least two incidents to link');
  const kids = ids.map((id) => tx.ticket(id));
  req(kids.every((k) => !k.parentId && !k.isParent), 'DUPLICATE', 'One or more incidents are already linked');
  req(kids.every((k) => k.status !== 'RESOLVED' && k.status !== 'CLOSED'), 'BLOCKED', 'Only open incidents can be linked');
  const nets = new Set(kids.map((k) => tx.device(k.deviceId).networkId));
  req(nets.size === 1, 'VALIDATION', 'Linked incidents must share a network identifier');
  const networkId = [...nets][0];
  const loc = tx.device(kids[0].deviceId).location;
  const n = tx.s.seq.device + 1;
  tx.s.seq = { ...tx.s.seq, device: n };
  const seg: Device = { ...HEALTHY_DEVICE, id: uuid(), name: `${networkId} network segment`, kind: 'NETWORK_SEGMENT', managed: false, location: loc, networkId, wifiHealthy: false };
  tx.putDevice(seg);
  const seq = tx.s.seq.ticket + 1;
  tx.s.seq = { ...tx.s.seq, ticket: seq };
  const id = uuid();
  const cat = kids[0].category;
  const b = BASELINES[cat];
  const parent: Ticket = {
    id, displayId: `INC-${1000 + seq}`, title: `Shared incident: ${CATEGORY_LABEL[cat]} on ${networkId} (${kids.length} reports)`, description: `Correlated ${kids.length} reports from ${new Set(kids.map((k) => k.requester)).size} employees at ${loc} on network ${networkId}: ${kids.map((k) => k.displayId).join(', ')}.`,
    requester: 'Network operations (simulated)', deviceId: seg.id, source: 'DETECTION', category: cat, priority: 'P2', status: 'OPEN', createdAt: tx.nowIso, updatedAt: tx.nowIso, owner: tx.user.name,
    eligibleAtIntake: false, intakePolicyVersion: tx.policy.version, baselineAgentMin: b.agentMin, baselineResolutionMin: b.resolutionMin, agentMin: 0, verified: false, reopenedCount: 0, outcome: 'SUCCESS', executionIds: [],
    eligibilityReason: 'Shared network incident — no endpoint remediation', addedEvidence: [], reviewDecisions: 0, recoveries: 0, reworks: 0, scheduledDelayMin: 0, slaDueAt: iso(tx.now + SLA_HOURS.P2 * 60 * MIN),
    isParent: true, childIds: ids, demo: kids.some((k) => k.demo),
  };
  tx.s.tickets = { ...tx.s.tickets, [id]: parent };
  tx.audit({ ticketId: id, action: 'SHARED_INCIDENT_CREATED', to: 'OPEN', reason: `Parent incident created from ${kids.length} correlated reports on ${networkId}`, metadata: { children: kids.map((k) => k.displayId), networkId, location: loc } });
  tx.move(id, 'ESCALATED', 'ESCALATED', 'Shared network incident — investigate the network segment; endpoint remediation for linked incidents is paused');
  for (const k of kids) {
    tx.patchTicket(k.id, { parentId: id });
    const hold = holdReasonFor(tx.s, tx.ticket(k.id))!;
    tx.audit({ ticketId: k.id, action: 'INCIDENT_LINKED', reason: `Linked to shared incident ${parent.displayId}`, metadata: { parentId: id }, result: 'INFO' });
    if (GATE_STATES.includes(k.status) || k.status === 'STEP_APPROVAL') {
      cancelPausedExecution(tx, k.id, 'Linked to shared incident');
      invalidateApprovals(tx, k.id, 'Linked to shared incident — endpoint remediation paused');
      cancelJobs(tx, k.id, 'Linked to shared incident');
      tx.move(k.id, 'REVIEW_REQUIRED', 'REMEDIATION_HELD', hold, { parentId: id }, SYSTEM, 'BLOCKED');
    } else if (RUNNING_STATES.includes(k.status)) {
      tx.audit({ ticketId: k.id, action: 'REMEDIATION_HELD', reason: 'Already executing — not interrupted mid-action (no unsafe cancellation)', metadata: { parentId: id }, actor: SYSTEM, result: 'INFO' });
    }
  }
  (tx as Tx & { createdId?: string }).createdId = id;
  return `${parent.displayId} created; ${kids.length} incidents linked and endpoint remediation paused`;
}

function policyAffected(s: AppState, next: Policy) {
  const ids: string[] = [];
  for (const t of Object.values(s.tickets)) {
    if (GATE_STATES.includes(t.status) || t.status === 'STEP_APPROVAL') { ids.push(t.id); continue; }
    if (t.status === 'REVIEW_REQUIRED') {
      const d = currentDiagnosis(s, t);
      if (!d || d.recommendedRoute !== 'REVIEW_REQUIRED') continue;
      const rb = planRunbook(s, d);
      const r = evaluateRoute({ confidence: d.confidence, risk: d.risk, runbook: rb, device: s.devices[t.deviceId], policy: next, approvalValid: false, consentValid: false, now: 0 });
      if (r.route !== 'REVIEW_REQUIRED') ids.push(t.id);
    }
  }
  return ids;
}
/** Preview for the Policies page: how many nonrunning tickets / approvals a save will re-evaluate. */
export function previewPolicyImpact(s: AppState, next: Omit<Policy, 'version'>) {
  const p = { ...next, version: s.policy.version + 1 };
  const ids = policyAffected(s, p);
  const approvals = s.approvals.filter((a) => a.decision === 'APPROVE' && !a.consumedBy && !a.invalidatedAt && !a.expiredLoggedAt).length;
  return { tickets: ids.length, approvals, ticketIds: ids };
}

function savePolicy(tx: Tx, next: Omit<Policy, 'version'>, reason: string, action = 'POLICY_UPDATED') {
  adminOnly(tx);
  req(reason.trim().length >= 3, 'VALIDATION', 'A reason (≥ 3 characters) is required to save a policy version');
  const version = Math.max(...tx.s.policyHistory.map((h) => h.policy.version), tx.policy.version) + 1;
  const p: Policy = { ...next, version };
  const errs = validatePolicy(p);
  req(!errs.length, 'VALIDATION', errs.join('; '));
  const affected = policyAffected(tx.s, p);
  const prev = tx.policy;
  tx.s.policy = p;
  tx.s.policyHistory = [...tx.s.policyHistory, { policy: p, reason: reason.trim(), actor: tx.user.name, role: tx.user.role, at: tx.nowIso }];
  const diff = (Object.keys(p) as (keyof Policy)[]).filter((k) => JSON.stringify(p[k]) !== JSON.stringify(prev[k])).map((k) => ({ field: k, before: prev[k], after: p[k] }));
  tx.audit({ action, reason: reason.trim(), metadata: { policyVersion: version, previousVersion: prev.version, diff, affectedTickets: affected.length } });
  for (const t of Object.values(tx.s.tickets)) if (t.status === 'EXECUTING' && pausedExecution(tx.s, t.id)) {
    cancelPausedExecution(tx, t.id, `Policy v${version} saved — scheduled step approval no longer bound to current policy`);
    tx.move(t.id, 'REVIEW_REQUIRED', 'REMEDIATION_HELD', `Policy v${version} changed before the scheduled step ran`, {}, SYSTEM, 'BLOCKED');
    affected.push(t.id);
  }
  for (const id of affected) diagnose(tx, id, `Policy v${version} saved — re-evaluating`);
  return `Policy v${version} saved; ${affected.length} ticket(s) re-evaluated`;
}

function invalidateRunbookPlans(tx: Tx, rb: Runbook, why: string) {
  for (const t of Object.values(tx.s.tickets)) {
    const d = currentDiagnosis(tx.s, t);
    if (!d) continue;
    const refs = d.runbookId === rb.id || d.category === rb.category;
    if (!refs) continue;
    if (t.status === 'EXECUTING' && pausedExecution(tx.s, t.id)) {
      // Approved step scheduled but not yet applied: changing the approved action invalidates it.
      cancelPausedExecution(tx, t.id, why);
      tx.move(t.id, 'REVIEW_REQUIRED', 'REMEDIATION_HELD', `${why} — scheduled step will not run`, {}, SYSTEM, 'BLOCKED');
      diagnose(tx, t.id, why);
      continue;
    }
    if (GATE_STATES.includes(t.status) || t.status === 'STEP_APPROVAL' || (t.status === 'REVIEW_REQUIRED' && d.recommendedRoute === 'REVIEW_REQUIRED' && !d.runbookId && !t.parentId)) diagnose(tx, t.id, why);
  }
}

function validateRunbook(rb: Runbook): string[] {
  const errs: string[] = [];
  if (!rb.title.trim()) errs.push('Title required');
  if (!rb.steps.filter((s) => s.trim()).length) errs.push('At least one step required');
  if (!rb.checks.filter((s) => s.trim()).length) errs.push('At least one verification check required');
  if (!rb.recoveryNote.trim()) errs.push('Recovery declaration required');
  if (rb.reversible && !rb.rollbackSteps.filter((s) => s.trim()).length) errs.push('Reversible runbooks need rollback steps');
  if (!rb.supportedOS.length) errs.push('Select at least one supported OS');
  if (!rb.testedScenario?.trim()) errs.push('Tested scenario required');
  if (rb.actionKey) {
    if (!SIM_ACTIONS[rb.actionKey]) errs.push('Unknown action — cannot be executable');
    else if (rb.actionKey !== rb.category) errs.push(`Simulator action ${rb.actionKey} does not match category ${rb.category}; publish as diagnostic-only instead`);
  }
  if (!rb.stepDefs.length) errs.push('Structured steps are required');
  return errs;
}
export { validateRunbook };

function runbookAt(tx: Tx, id: string, version: number) {
  const rb = tx.s.runbooks.find((r) => r.id === id && r.version === version);
  if (!rb) throw new DomainError('NOT_FOUND', `${id} v${version} not found`);
  return rb;
}
function replaceRunbook(tx: Tx, rb: Runbook) { tx.s.runbooks = tx.s.runbooks.map((r) => (r.id === rb.id && r.version === rb.version ? rb : r)); tx.dirty = true; }

function act(tx: Tx, a: Action): string | void {
  switch (a.type) {
    case 'CREATE_TICKET': {
      const id = createTicket(tx, a.input);
      (tx as Tx & { createdId?: string }).createdId = id;
      return `${tx.ticket(id).displayId} created and diagnosed`;
    }
    case 'RUN_DIAGNOSIS': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'OPEN' || t.status === 'REOPENED', 'ILLEGAL_TRANSITION', `Diagnosis runs from Open/Reopened, not ${STATUS_LABEL[t.status]}`);
      diagnose(tx, t.id, 'Diagnosis requested', tx.user);
      return 'Diagnosis completed';
    }
    case 'ADD_EVIDENCE': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'REVIEW_REQUIRED', 'ILLEGAL_TRANSITION', 'Additional diagnostics are accepted in Review required');
      req(a.note.trim().length >= 3, 'VALIDATION', 'Describe the evidence (≥ 3 characters)');
      tx.patchTicket(t.id, { addedEvidence: [...t.addedEvidence, { kind: a.kind, note: a.note.trim(), at: tx.nowIso, actor: tx.user.name }] });
      tx.audit({ ticketId: t.id, action: 'EVIDENCE_ADDED', reason: a.note.trim(), metadata: { kind: a.kind } });
      const d = diagnose(tx, t.id, 'Re-diagnosis with new evidence', tx.user);
      return `Re-diagnosed: ${CATEGORY_LABEL[d.category]}, score ${d.confidence} → ${STATUS_LABEL[tx.ticket(t.id).status]}`;
    }
    case 'APPROVE': return approve(tx, a);
    case 'REJECT': case 'REQUEST_REVIEW': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'AWAITING_APPROVAL', 'ILLEGAL_TRANSITION', `Only plans awaiting approval can be ${a.type === 'REJECT' ? 'rejected' : 'sent to review'}`);
      req(a.reason.trim().length >= 3, 'VALIDATION', 'A reason is required');
      const d = currentDiagnosis(tx.s, t)!;
      tx.addApproval({ id: uuid(), ticketId: t.id, planHash: d.planHash, policyVersion: tx.policy.version, actor: tx.user.name, role: tx.user.role as Role, decision: a.type === 'REJECT' ? 'REJECT' : 'REVIEW', reason: a.reason.trim(), at: tx.nowIso, expiresAt: tx.nowIso, diagnosisRevision: d.revision, requestedAt: d.createdAt });
      tx.patchTicket(t.id, { reviewDecisions: t.reviewDecisions + 1 });
      tx.move(t.id, a.type === 'REJECT' ? 'ESCALATED' : 'REVIEW_REQUIRED', a.type === 'REJECT' ? 'REJECTED' : 'REVIEW_REQUESTED', a.reason.trim(), { planHash: d.planHash, revision: d.revision });
      cancelJobs(tx, t.id, 'Plan rejected/sent to review');
      return a.type === 'REJECT' ? 'Plan rejected — ticket escalated' : 'Sent to review';
    }
    case 'CONSENT': return employeeRespond(tx, { type: 'EMPLOYEE_RESPOND', ticketId: a.ticketId, choice: a.grant ? 'PROCEED' : 'DECLINE' });
    case 'EMPLOYEE_RESPOND': return employeeRespond(tx, a);
    case 'APPROVE_STEP': return approveStep(tx, a);
    case 'REJECT_STEP': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      const e = pausedExecution(tx.s, t.id);
      req(t.status === 'STEP_APPROVAL' && e, 'ILLEGAL_TRANSITION', 'No step is awaiting approval');
      req(a.reason.trim().length >= 3, 'VALIDATION', 'A reason is required');
      const rb = runbookOf(tx.s, e!)!;
      const sd = rb.stepDefs[e!.stepIndex];
      tx.addStepApproval({ id: uuid(), ticketId: t.id, executionId: e!.id, stepId: sd.id, deviceId: e!.deviceId, actionKey: rb.actionKey ?? '', runbookId: rb.id, runbookVersion: rb.version, planHash: e!.planHash, actor: tx.user.name, role: tx.user.role as Role, decision: 'REJECT', reason: a.reason.trim(), at: tx.nowIso, expiresAt: tx.nowIso });
      cancelPausedExecution(tx, t.id, `Step ${sd.id} rejected by ${tx.user.name}`);
      tx.patchTicket(t.id, { reviewDecisions: t.reviewDecisions + 1 });
      tx.move(t.id, 'ESCALATED', 'STEP_REJECTED', `Step ${sd.id} rejected: ${a.reason.trim()}`, { executionId: e!.id, stepId: sd.id });
      return `Step ${sd.id} rejected — escalated`;
    }
    case 'ADVANCE_STEP': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      const e = pausedExecution(tx.s, t.id);
      req(e && e.phase === 'RUNNING' && e.stepScheduledFor, 'ILLEGAL_TRANSITION', 'No scheduled step to advance');
      tx.patchExecution(e!.id, { nextAt: tx.nowIso, stepScheduledFor: tx.nowIso });
      tx.audit({ ticketId: t.id, action: 'STEP_SCHEDULE_ADVANCED', reason: 'Demo: scheduled step advanced to now; preflight re-validated before the action (no bypass)', metadata: { executionId: e!.id, originalWindow: e!.stepScheduledFor }, result: 'INFO' });
      return 'Scheduled step advanced';
    }
    case 'LINK_SHARED': return linkShared(tx, a.ticketIds);
    case 'VERIFY_RECOVERY': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      const parent = t.parentId ? tx.s.tickets[t.parentId] : undefined;
      req(parent && (parent.status === 'RESOLVED' || parent.status === 'CLOSED'), 'BLOCKED', 'The shared parent incident must be resolved first');
      req(t.status === 'REVIEW_REQUIRED' || t.status === 'ESCALATED', 'ILLEGAL_TRANSITION', `Recovery verification is available from Review required or Escalated, not ${STATUS_LABEL[t.status]}`);
      const dev = tx.device(t.deviceId);
      const probe = telemetryFor(t.category, dev);
      req(!probe.consistent, 'BLOCKED', `Read-only probe still shows the symptom (${probe.evidence[0]}); not resolved`);
      const m = modeled(t, 'MANUAL', 0);
      tx.patchTicket(t.id, { path: 'MANUAL', verified: true, resolutionNote: `Recovered via shared incident ${parent!.displayId}`, manualEvidence: `Read-only probe: ${probe.evidence[0]}`, resolvedAt: tx.nowIso, firstResolvedAt: t.firstResolvedAt ?? tx.nowIso, ...m });
      tx.move(t.id, 'RESOLVED', 'RECOVERY_VERIFIED', `Verified recovery after shared incident ${parent!.displayId}: ${probe.evidence[0]}`, { parentId: parent!.id, probe: probe.evidence });
      if (tx.policy.closureMode === 'AUTO') { tx.patchTicket(t.id, { closedAt: tx.nowIso }); tx.move(t.id, 'CLOSED', 'TICKET_CLOSED', 'Closed after verified recovery', { closureMode: 'AUTO' }, SYSTEM); }
      tx.notify({ ticketId: t.id, recipient: 'EMPLOYEE', message: `${t.displayId}: connectivity restored (shared fix ${parent!.displayId}) and verified.` });
      return 'Recovery verified';
    }
    case 'SUBMIT_REVIEW': {
      notManager(tx);
      const rb = runbookAt(tx, a.runbookId, a.version);
      req(rb.status === 'DRAFT', 'BLOCKED', 'Only drafts can be submitted for review');
      const errs = validateRunbook(rb);
      req(!errs.length, 'VALIDATION', errs.join('; '));
      replaceRunbook(tx, { ...rb, status: 'UNDER_REVIEW', submittedBy: tx.user.name, submittedAt: tx.nowIso });
      tx.audit({ action: 'RUNBOOK_SUBMITTED', reason: `${rb.id} v${rb.version} submitted for administrator review`, metadata: { runbook: rb.id, version: rb.version } });
      return `${rb.id} v${rb.version} submitted for review`;
    }
    case 'RETURN_TO_DRAFT': {
      adminOnly(tx);
      const rb = runbookAt(tx, a.runbookId, a.version);
      req(rb.status === 'UNDER_REVIEW', 'BLOCKED', 'Only runbooks under review can be returned');
      req(a.reason.trim().length >= 3, 'VALIDATION', 'A reason is required');
      replaceRunbook(tx, { ...rb, status: 'DRAFT' });
      tx.audit({ action: 'RUNBOOK_RETURNED', reason: a.reason.trim(), metadata: { runbook: rb.id, version: rb.version } });
      return 'Returned to draft';
    }
    case 'SET_MATURITY': {
      adminOnly(tx);
      const rb = runbookAt(tx, a.runbookId, a.version);
      req(rb.status === 'APPROVED' && isExecutable(rb), 'BLOCKED', 'Maturity applies to approved executable runbooks');
      req(a.to >= 2 && a.to <= 4 && a.to !== rb.maturity, 'VALIDATION', 'Choose a different level between L2 and L4');
      req(a.reason.trim().length >= 3, 'VALIDATION', 'Document the reason for this maturity change');
      if (a.to > rb.maturity) {
        req(a.to === rb.maturity + 1, 'VALIDATION', 'Promote one level at a time');
        const unmet = maturityCriteria(tx.s, rb, a.to).filter((c) => !c.met);
        req(!unmet.length, 'BLOCKED', `Eligibility criteria not met: ${unmet.map((c) => c.label).join('; ')}`);
      }
      replaceRunbook(tx, { ...rb, maturity: a.to, maturityHistory: [...rb.maturityHistory, { from: rb.maturity, to: a.to, at: tx.nowIso, actor: tx.user.name, reason: a.reason.trim() }] });
      tx.audit({ action: 'MATURITY_CHANGED', reason: `${rb.id} v${rb.version}: ${MATURITY_LABEL[rb.maturity]} → ${MATURITY_LABEL[a.to]} — ${a.reason.trim()}`, metadata: { runbook: rb.id, version: rb.version, from: rb.maturity, to: a.to } });
      return `${rb.id} now ${MATURITY_LABEL[a.to]}`;
    }
    case 'UPDATE_ASSUMPTIONS': {
      req(tx.user.role === 'ADMIN' || tx.user.role === 'MANAGER', 'UNAUTHORIZED', 'Admin or Manager role required to change analytics assumptions');
      const as = a.assumptions;
      const nums = [as.hourlyCost, ...Object.values(as.baselines).flatMap((b) => [b.agentMin, b.resolutionMin])];
      req(nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 100000), 'VALIDATION', 'Assumptions must be non-negative numbers');
      tx.s.settings = { ...tx.s.settings, assumptions: { ...as, updatedAt: tx.nowIso, updatedBy: tx.user.name } };
      tx.dirty = true;
      tx.audit({ action: 'ASSUMPTIONS_UPDATED', reason: `Estimate assumptions updated (hourly cost ${as.currency} ${as.hourlyCost})`, metadata: { hourlyCost: as.hourlyCost }, result: 'INFO' });
      return 'Assumptions saved — estimates recalculated';
    }
    case 'SET_DEVICE': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      const dev = tx.device(t.deviceId);
      const patch: Partial<Device> = {};
      if (a.online !== undefined) patch.online = a.online;
      if (a.busy !== undefined) patch.busy = a.busy;
      if (a.batteryPct !== undefined) patch.batteryPct = Math.max(0, Math.min(100, Math.round(a.batteryPct)));
      tx.patchDevice(dev.id, patch);
      tx.audit({ ticketId: t.id, action: a.online === true ? 'DEVICE_RECONNECTED' : 'DEVICE_STATE_CHANGED', reason: `Simulated: ${[a.online !== undefined && `management channel ${a.online ? 'online' : 'offline'}`, a.busy !== undefined && `employee ${a.busy ? 'busy' : 'available'}`, a.batteryPct !== undefined && `battery ${a.batteryPct}%`].filter(Boolean).join(', ')}`, metadata: { device: dev.name, ...patch }, result: 'INFO' });
      for (const other of Object.values(tx.s.tickets)) if (other.deviceId === dev.id) reroute(tx, other.id, 'Device state changed');
      return `Device ${dev.name} updated; gates re-evaluated`;
    }
    case 'ADVANCE_SCHEDULE': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      const j = pendingJob(tx.s, t);
      req(t.status === 'SCHEDULED' && j, 'ILLEGAL_TRANSITION', 'No scheduled job to advance');
      tx.patchJob(j!.id, { dueAt: tx.nowIso });
      tx.audit({ ticketId: t.id, action: 'SCHEDULE_ADVANCED', reason: 'Demo: scheduled job advanced to now; all gates re-checked (no bypass)', metadata: { jobId: j!.id, originalDueAt: j!.originalDueAt, newDueAt: tx.nowIso }, result: 'INFO' });
      reroute(tx, t.id, 'Scheduled window advanced');
      return `Schedule advanced — ${STATUS_LABEL[tx.ticket(t.id).status]}`;
    }
    case 'START': { notManager(tx); startExecution(tx, a.ticketId); return 'Execution started'; }
    case 'ROLLBACK': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      req(['ROLLBACK_AVAILABLE', 'RESOLVED', 'CLOSED'].includes(t.status), 'ILLEGAL_TRANSITION', `Rollback not available from ${STATUS_LABEL[t.status]}`);
      const e = latestAppliedExecution(tx.s, t.id);
      req(e && ['PASSED', 'FAILED'].includes(e.phase), 'BLOCKED', 'No applied action available to roll back');
      const rb = tx.s.runbooks.find((r) => r.id === e!.runbookId && r.version === e!.version);
      req(e!.reversible, 'BLOCKED', `Irreversible action: ${rb?.recoveryNote ?? 'no rollback defined'}`);
      req(e!.rollbackDeadline && ms(e!.rollbackDeadline) > tx.now, 'EXPIRED', 'Rollback deadline (30 min after action) has passed');
      req(e!.risk !== 'HIGH' || tx.user.role === 'ADMIN', 'UNAUTHORIZED', 'Rolling back a HIGH-risk action requires Admin');
      const dev = tx.device(t.deviceId);
      const conflicts = e!.changes.filter((c) => dev[c.field] !== c.after);
      req(!conflicts.length, 'CONFLICT', `Device changed since action (${conflicts.map((c) => deviceFieldLabel(c.field)).join(', ')}); rollback refused to avoid overwriting unrelated changes`);
      req(!deviceBusyWithJob(tx.s, dev.id), 'DUPLICATE', 'Another job is running on this device');
      tx.patchExecution(e!.id, { phase: 'ROLLING_BACK', rollbackStep: 0, nextAt: iso(tx.now + e!.stepMs), rollbackBy: tx.user.name, rollbackStartedAt: tx.nowIso, closurePending: false });
      tx.move(t.id, 'ROLLING_BACK', 'ROLLBACK_STARTED', `Rollback of ${e!.runbookId} v${e!.version} requested`, { executionId: e!.id, fields: e!.changes.map((c) => c.field), deadline: e!.rollbackDeadline });
      return 'Rollback started';
    }
    case 'REOPEN': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'RESOLVED' || t.status === 'CLOSED', 'ILLEGAL_TRANSITION', 'Only resolved or closed tickets can be reopened');
      req(a.reason.trim().length >= 3, 'VALIDATION', 'A reason is required');
      for (const e of tx.s.executions) if (e.ticketId === t.id && e.closurePending) tx.patchExecution(e.id, { closurePending: false, nextAt: undefined });
      tx.patchTicket(t.id, { verified: false, resolvedAt: undefined, closedAt: undefined, reopenedCount: t.reopenedCount + 1 });
      tx.move(t.id, 'REOPENED', 'REOPENED', a.reason.trim(), { previousPath: t.path, previousStatus: t.status }, a.byEmployee ? employeeOf(t) : undefined);
      tx.notify({ ticketId: t.id, recipient: 'AGENT', message: `${t.displayId} reopened${a.byEmployee ? ' by employee' : ''}: ${a.reason.trim()}` });
      return 'Ticket reopened';
    }
    case 'EMPLOYEE_CONFIRM': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'RESOLVED', 'ILLEGAL_TRANSITION', 'Nothing to confirm');
      tx.patchTicket(t.id, { closedAt: tx.nowIso });
      tx.move(t.id, 'CLOSED', 'TICKET_CLOSED', 'Employee confirmed the fix (simulated)', { closureMode: 'EMPLOYEE_CONFIRM' }, employeeOf(t));
      return 'Employee confirmed — closed';
    }
    case 'ESCALATE': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      req(ESCALATABLE.includes(t.status), 'ILLEGAL_TRANSITION', `Cannot escalate from ${STATUS_LABEL[t.status]}${RUNNING_STATES.includes(t.status) ? ' — no unsafe cancellation mid-action' : ''}`);
      req(a.reason.trim().length >= 3, 'VALIDATION', 'A reason is required');
      cancelPausedExecution(tx, t.id, 'Manually escalated');
      tx.move(t.id, 'ESCALATED', 'ESCALATED', a.reason.trim());
      invalidateApprovals(tx, t.id, 'Manually escalated');
      cancelJobs(tx, t.id, 'Manually escalated');
      return 'Escalated';
    }
    case 'RESOLVE_MANUAL': {
      notManager(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'ESCALATED' || t.status === 'REVIEW_REQUIRED', 'ILLEGAL_TRANSITION', 'Manual resolution is available from Escalated or Review required');
      req(a.note.trim().length >= 5, 'VALIDATION', 'Resolution note (≥ 5 characters) is required');
      req(a.evidence.trim().length >= 3, 'VALIDATION', 'Verification evidence is required');
      req(a.verified, 'VALIDATION', 'Confirm that you verified the fix');
      const m = modeled(t, 'MANUAL', 0);
      tx.patchTicket(t.id, { path: 'MANUAL', verified: true, resolutionNote: a.note.trim(), manualEvidence: a.evidence.trim(), resolvedAt: tx.nowIso, firstResolvedAt: t.firstResolvedAt ?? tx.nowIso, owner: tx.user.name, ...m });
      tx.move(t.id, 'RESOLVED', 'MANUAL_RESOLUTION', a.note.trim(), { evidence: a.evidence.trim(), verifiedByHuman: true, path: 'MANUAL' });
      if (tx.policy.closureMode === 'AUTO') {
        tx.patchTicket(t.id, { closedAt: tx.nowIso });
        tx.move(t.id, 'CLOSED', 'TICKET_CLOSED', 'Closed after human-verified manual resolution', { closureMode: 'AUTO' }, SYSTEM);
      }
      tx.notify({ ticketId: t.id, recipient: 'EMPLOYEE', message: `${t.displayId} was resolved by ${tx.user.name}.` });
      if (t.isParent) {
        const field: keyof Device | undefined = t.category === 'WIFI' ? 'wifiHealthy' : t.category === 'DNS' ? 'dnsHealthy' : undefined;
        for (const cid of t.childIds ?? []) {
          const c = tx.ticket(cid);
          if (field) tx.patchDevice(c.deviceId, { [field]: true } as Partial<Device>);
          tx.audit({ ticketId: cid, action: 'NETWORK_RECOVERY_OBSERVED', reason: `Shared fix ${t.displayId} completed; endpoint telemetry ${field ? `${deviceFieldLabel(field)} = true` : 'unchanged'} (simulated). Not closed until recovery is verified.`, metadata: { parentId: t.id }, actor: SYSTEM, result: 'INFO' });
          tx.notify({ ticketId: cid, recipient: 'AGENT', message: `${c.displayId}: shared incident ${t.displayId} resolved — verify recovery` });
        }
      }
      return t.isParent ? 'Shared incident resolved — verify recovery on linked incidents' : 'Resolved manually';
    }
    case 'SAVE_POLICY': return savePolicy(tx, a.policy, a.reason);
    case 'RESTORE_DEFAULT_POLICY': {
      const { version: _v, ...rest } = DEFAULT_POLICY; void _v;
      return savePolicy(tx, rest, a.reason || 'Restore defaults', 'POLICY_RESTORED_DEFAULTS');
    }
    case 'PROPOSE_DRAFT': {
      notManager(tx);
      let category: Category, steps: string[], checks: string[], src: string[], title: string, rootCause: string;
      if (a.fromTicketId) {
        const t = tx.ticket(a.fromTicketId);
        req(t.path === 'MANUAL' && (t.status === 'RESOLVED' || t.status === 'CLOSED'), 'BLOCKED', 'Drafts can be proposed from manually resolved tickets');
        req(!tx.s.runbooks.some((r) => r.sourceTicketIds.includes(t.id)), 'DUPLICATE', 'A draft already exists for this ticket');
        category = currentDiagnosis(tx.s, t)?.category ?? t.category;
        steps = ['Preflight: confirm symptom and capture device snapshot', `Action (from ${t.displayId}): ${t.resolutionNote ?? ''}`, 'Verify: confirm the evidence below'];
        checks = [t.manualEvidence ?? 'Human-verified outcome'];
        src = [t.id];
        title = `Draft from ${t.displayId}: ${t.title}`;
        rootCause = `Recorded resolution of ${t.displayId}: ${t.resolutionNote ?? 'n/a'}`;
      } else {
        req(a.category, 'VALIDATION', 'Category required');
        category = a.category!;
        src = a.ticketIds ?? [];
        const notes = src.map((id) => tx.s.tickets[id]?.resolutionNote).filter(Boolean) as string[];
        steps = ['Preflight: confirm symptom and capture device snapshot', notes[0] ? `Action (from resolved examples): ${notes[0]}` : 'Action: define with SMEs', 'Verify: confirm resolution evidence'];
        checks = ['Define verification check with SMEs'];
        title = `Draft: ${CATEGORY_LABEL[category]} remediation (from ${src.length} tickets)`;
        rootCause = notes[0] ? `Most common recorded resolution: ${notes[0]}` : 'Root cause not yet identified — requires SME analysis';
      }
      const n = tx.s.seq.runbook + 1;
      tx.s.seq = { ...tx.s.seq, runbook: n };
      const rb: Runbook = {
        id: `RB-${String(n).padStart(3, '0')}`, version: 1, title, category, status: 'DRAFT', risk: 'HIGH', supportedOS: ['Windows 11'], steps, checks, rollbackSteps: [], reversible: false, disruptive: false,
        expectedMin: 15, owner: tx.user.name, diagnosticOnly: true, prerequisites: ['Human review', 'Symptom confirmed by telemetry or employee report'],
        recoveryNote: 'Manual recovery: an agent reverses the step-2 change by hand; no automated rollback is defined', sourceTicketIds: src, createdAt: tx.nowIso,
        changeNote: 'AI-generated draft (simulated, template-based) — not executable until reviewed, validated and published by an administrator',
        stepDefs: defaultStepDefs(steps, 'HIGH', checks, false), maturity: 0, maturityHistory: [], restartRequired: false, aiGenerated: true,
        rootCause: rootCause, applicability: `${CATEGORY_LABEL[category]} incidents on managed Windows 11 Standard-group devices with matching symptoms`,
        risks: ['Generated from limited resolved examples — validate with SMEs', 'Disruption and reversibility not yet characterised', 'No simulator action selected — guidance only until an admin selects one'],
      };
      tx.s.runbooks = [...tx.s.runbooks, rb];
      tx.audit({ ticketId: a.fromTicketId, action: 'RUNBOOK_DRAFTED', reason: `${rb.id} v1 drafted (${CATEGORY_LABEL[category]}); default HIGH risk, not preapproved`, metadata: { runbook: rb.id, sourceTickets: src.length } });
      (tx as Tx & { createdId?: string }).createdId = rb.id;
      return `${rb.id} draft created — no automatic activation`;
    }
    case 'UPDATE_DRAFT': {
      notManager(tx);
      const rb = runbookAt(tx, a.runbookId, a.version);
      req(rb.status === 'DRAFT', 'BLOCKED', 'Only drafts can be edited — create a new version instead');
      const { id: _i, version: _v, status: _s, ...patch } = a.patch; void _i; void _v; void _s;
      req(tx.user.role === 'ADMIN' || patch.actionKey === undefined || patch.actionKey === rb.actionKey, 'UNAUTHORIZED', 'Only an administrator can attach an executable simulator action');
      const next: Runbook = { ...rb, ...patch };
      if (!next.actionKey) next.diagnosticOnly = true;
      if (patch.steps || patch.checks || patch.risk || patch.reversible !== undefined) next.stepDefs = rb.id === 'RB-007' && next.steps.length === rb.steps.length ? rb.stepDefs : defaultStepDefs(next.steps, next.risk, next.checks, next.reversible);
      replaceRunbook(tx, next);
      tx.audit({ action: 'RUNBOOK_UPDATED', reason: `${rb.id} v${rb.version} draft edited`, metadata: { runbook: rb.id, version: rb.version, fields: Object.keys(patch) } });
      return 'Draft saved';
    }
    case 'PUBLISH_RUNBOOK': {
      adminOnly(tx);
      const rb = runbookAt(tx, a.runbookId, a.version);
      req(rb.status === 'UNDER_REVIEW', 'BLOCKED', 'Submit the draft for review first — only runbooks under review can be approved and published');
      const errs = validateRunbook(rb);
      req(!errs.length, 'VALIDATION', errs.join('; '));
      for (const r of tx.s.runbooks) if (r.id === rb.id && r.status === 'APPROVED') replaceRunbook(tx, { ...r, status: 'RETIRED', retiredAt: tx.nowIso, changeNote: `${r.changeNote ?? ''} · superseded by v${rb.version}` });
      const to: Maturity = rb.actionKey ? 2 : 1;
      const pub: Runbook = { ...rb, status: 'APPROVED', publishedAt: tx.nowIso, diagnosticOnly: !rb.actionKey, changeNote: a.note || rb.changeNote, reviewedBy: tx.user.name, maturity: to,
        maturityHistory: [...rb.maturityHistory, { from: rb.maturity, to, at: tx.nowIso, actor: tx.user.name, reason: to === 2 ? 'Published: new versions default to supervised (human-approved) execution' : 'Published as guidance only (no executable action)' }] };
      replaceRunbook(tx, pub);
      tx.audit({ action: 'RUNBOOK_PUBLISHED', reason: `${rb.id} v${rb.version} published${pub.diagnosticOnly ? ' as diagnostic-only guidance (not executable)' : ''}`, metadata: { runbook: rb.id, version: rb.version, actionKey: rb.actionKey ?? null, maturity: to, reviewedBy: tx.user.name, note: a.note } });
      invalidateRunbookPlans(tx, pub, `${rb.id} v${rb.version} published — pending plans re-evaluated`);
      return `${rb.id} v${rb.version} published`;
    }
    case 'NEW_VERSION': {
      adminOnly(tx);
      const versions = tx.s.runbooks.filter((r) => r.id === a.runbookId);
      req(versions.length, 'NOT_FOUND', 'Runbook not found');
      req(!versions.some((r) => r.status === 'DRAFT'), 'DUPLICATE', 'A draft version already exists');
      const latest = versions.sort((x, y) => y.version - x.version)[0];
      const draft: Runbook = { ...latest, version: latest.version + 1, status: 'DRAFT', publishedAt: undefined, retiredAt: undefined, reviewedBy: undefined, submittedBy: undefined, submittedAt: undefined, maturity: 0, maturityHistory: [], createdAt: tx.nowIso, changeNote: `Draft v${latest.version + 1} from v${latest.version} (maturity resets to supervised on publication)` };
      tx.s.runbooks = [...tx.s.runbooks, draft];
      tx.audit({ action: 'RUNBOOK_DRAFTED', reason: `${draft.id} v${draft.version} draft created from v${latest.version}`, metadata: { runbook: draft.id, version: draft.version } });
      return `${draft.id} v${draft.version} draft created`;
    }
    case 'RETIRE_RUNBOOK': {
      adminOnly(tx);
      const rb = runbookAt(tx, a.runbookId, a.version);
      req(rb.status === 'APPROVED', 'BLOCKED', 'Only approved versions can be retired');
      req(a.reason.trim().length >= 3, 'VALIDATION', 'A reason is required');
      replaceRunbook(tx, { ...rb, status: 'RETIRED', retiredAt: tx.nowIso });
      tx.audit({ action: 'RUNBOOK_RETIRED', reason: a.reason.trim(), metadata: { runbook: rb.id, version: rb.version } });
      invalidateRunbookPlans(tx, rb, `${rb.id} v${rb.version} retired — pending plans invalidated`);
      return `${rb.id} v${rb.version} retired`;
    }
    case 'MARK_NOTIFICATIONS_READ': tx.s.notifications = tx.s.notifications.map((n) => (n.read ? n : { ...n, read: true })); tx.dirty = true; return;
    case 'SET_ROLE': tx.s.settings = { ...tx.s.settings, role: a.role }; tx.dirty = true; return `Role: ${a.role}`;
  }
}

/** Run a guarded action. Errors never mutate business state; authorization blocks are logged. */
export function applyAction(state: AppState, action: Action, now: number, opts: { actor?: Actor; timing?: Timing } = {}): ActionResult {
  const user = opts.actor ?? actorFor(state.settings.role);
  const tx = new Tx(state, now, user, opts.timing);
  try {
    const message = act(tx, action) ?? undefined;
    return { ok: true, state: tx.s, message, ticketId: (tx as Tx & { createdId?: string }).createdId ?? ('ticketId' in action ? action.ticketId : undefined) };
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    let s = state;
    if (err.code === 'UNAUTHORIZED') {
      const btx = new Tx(state, now, user);
      btx.audit({ ticketId: 'ticketId' in action ? action.ticketId : undefined, action: 'AUTHORIZATION_BLOCKED', reason: err.message, metadata: { attempted: action.type }, result: 'BLOCKED' });
      s = btx.s;
    }
    return { ok: false, state: s, error: { code: err.code, message: err.message } };
  }
}

