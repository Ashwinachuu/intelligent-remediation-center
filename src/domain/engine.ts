import { ADMIN_NAME, CATEGORY_LABEL, HEALTHY_DEVICE, ISSUE_TYPES, SIM_ACTIONS, SLA_HOURS, employeeById, healthyFor, inferCategory, symptomFor } from './catalog';
import { computeDiagnosis } from './diagnosis';
import { matchKnowledge, runbookFromKnowledge } from './knowledge';
import { evaluateRoute, validateSettings, type GateResult } from './policy';
import { preflight, preflightSummary } from './preflight';
import { flowFor, newTroubleshooting } from './troubleshooting';
import { DomainError, GATE_STATES, assertTransition } from './transitions';
import type {
  Actor, AppNotification, AppState, Approval, AuditEvent, Device, Diagnosis, Execution, IssueType, Knowledge, Outcome, Role, Runbook, Settings, Status, Ticket,
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
  createdId?: string;
  constructor(state: AppState, public now: number, public user: Actor, public timing: Timing = LIVE_TIMING) {
    this.s = { ...state };
    this.nowIso = iso(now);
  }
  get settings() { return this.s.settings; }
  ticket(id: string): Ticket { const t = this.s.tickets[id]; if (!t) throw new DomainError('NOT_FOUND', `Ticket ${id} not found`); return t; }
  device(id: string): Device { const d = this.s.devices[id]; if (!d) throw new DomainError('NOT_FOUND', `Device ${id} not found`); return d; }
  patchTicket(id: string, patch: Partial<Ticket>) { this.s.tickets = { ...this.s.tickets, [id]: { ...this.ticket(id), ...patch, updatedAt: this.nowIso } }; this.dirty = true; }
  putDevice(d: Device) { this.s.devices = { ...this.s.devices, [d.id]: d }; this.dirty = true; }
  patchDevice(id: string, patch: Partial<Device>) { this.putDevice({ ...this.device(id), ...patch }); }
  audit(e: { action: string; reason: string; ticketId?: string; from?: Status; to?: Status; actor?: Actor; metadata?: Record<string, unknown>; result?: AuditEvent['result'] }) {
    const seq = this.s.seq.audit + 1;
    this.s.seq = { ...this.s.seq, audit: seq };
    const a = e.actor ?? this.user;
    this.s.audit = [...this.s.audit, { id: uuid(), seq, at: this.nowIso, actor: a.name, role: a.role, action: e.action, ticketId: e.ticketId, from: e.from, to: e.to, reason: e.reason, metadata: e.metadata ?? {}, result: e.result ?? 'SUCCESS' }];
    this.dirty = true;
  }
  notify(n: Omit<AppNotification, 'id' | 'at' | 'read'>) { this.s.notifications = [...this.s.notifications, { ...n, id: uuid(), at: this.nowIso, read: false }]; this.dirty = true; }
  addDiagnosis(d: Diagnosis) { this.s.diagnoses = [...this.s.diagnoses, d]; this.dirty = true; }
  patchDiagnosis(id: string, patch: Partial<Diagnosis>) { this.s.diagnoses = this.s.diagnoses.map((d) => (d.id === id ? { ...d, ...patch } : d)); this.dirty = true; }
  addApproval(a: Approval) { this.s.approvals = [...this.s.approvals, a]; this.dirty = true; }
  patchApproval(id: string, patch: Partial<Approval>) { this.s.approvals = this.s.approvals.map((a) => (a.id === id ? { ...a, ...patch } : a)); this.dirty = true; }
  addExecution(e: Execution) { this.s.executions = [...this.s.executions, e]; this.dirty = true; }
  exec(id: string) { const e = this.s.executions.find((x) => x.id === id); if (!e) throw new DomainError('NOT_FOUND', 'Execution not found'); return e; }
  patchExecution(id: string, patch: Partial<Execution>) { this.s.executions = this.s.executions.map((e) => (e.id === id ? { ...e, ...patch } : e)); this.dirty = true; }
  /** Central guarded status change. Illegal transitions throw and the whole transaction is discarded. */
  move(ticketId: string, to: Status, action: string, reason: string, metadata: Record<string, unknown> = {}, actor?: Actor, result: AuditEvent['result'] = 'SUCCESS') {
    const t = this.ticket(ticketId);
    assertTransition(t.status, to);
    this.patchTicket(ticketId, { status: to });
    this.audit({ ticketId, action, from: t.status, to, reason, metadata, actor, result });
  }
}

const AI: Actor = { name: 'AI assistant (simulated)', role: 'SYSTEM' };
const SYSTEM: Actor = { name: 'System', role: 'SYSTEM' };
export const actorFor = (role: Role, employeeName = employeeById('EMP-012').name): Actor => ({ name: role === 'ADMIN' ? ADMIN_NAME : employeeName, role });

// ---------------------------------------------------------------------------------------------
// Selectors shared by the engine and the UI.
// ---------------------------------------------------------------------------------------------
export const currentDiagnosis = (s: AppState, t: Ticket) => (t.diagnosisId ? s.diagnoses.find((d) => d.id === t.diagnosisId) : undefined);
export function planRunbook(s: AppState, d?: Diagnosis): Runbook | undefined {
  if (!d?.runbookId) return undefined;
  const rb = s.runbooks.find((r) => r.id === d.runbookId && r.version === d.runbookVersion);
  return rb && rb.status === 'APPROVED' ? rb : undefined;
}
/** Approval is bound to the exact incident, device and plan (diagnosis revision + fix version + threshold). */
export function validApproval(s: AppState, t: Ticket, d: Diagnosis | undefined, now: number): Approval | undefined {
  if (!d) return undefined;
  return s.approvals.find((a) => a.ticketId === t.id && a.decision === 'APPROVE' && a.planHash === d.planHash && a.deviceId === t.deviceId
    && a.runbookId === d.runbookId && !a.consumedBy && !a.invalidatedAt && ms(a.expiresAt) > now);
}
export const consentValid = (t: Ticket, d: Diagnosis | undefined, now: number) => !!(d && t.consent?.granted && t.consent.planHash === d.planHash && ms(t.consent.expiresAt) > now);
export const activeExecution = (s: AppState, ticketId: string) => s.executions.find((e) => e.ticketId === ticketId && ['RUNNING', 'VERIFYING', 'ROLLING_BACK'].includes(e.phase));
export const latestAppliedExecution = (s: AppState, ticketId: string) => [...s.executions].reverse().find((e) => e.ticketId === ticketId && !!e.appliedAt);
export const runbookOf = (s: AppState, e: Execution) => s.runbooks.find((r) => r.id === e.runbookId && r.version === e.version);

export interface Gates extends GateResult { diagnosis?: Diagnosis; runbook?: Runbook; approval?: Approval; device: Device; consentOk: boolean }
export function gatesFor(s: AppState, ticketId: string, now: number, override: { approvalValid?: boolean } = {}): Gates {
  const t = s.tickets[ticketId];
  const device = s.devices[t.deviceId];
  const diagnosis = currentDiagnosis(s, t);
  const runbook = planRunbook(s, diagnosis);
  const approval = validApproval(s, t, diagnosis, now);
  const consentOk = consentValid(t, diagnosis, now);
  if (!diagnosis) return { route: 'OPEN', reasons: ['Not yet diagnosed'], recommendable: false, needsConsent: false, device, consentOk };
  const g = evaluateRoute({ confidence: diagnosis.confidence, risk: diagnosis.risk, runbook, device, settings: s.settings, approvalValid: override.approvalValid ?? !!approval, consentValid: consentOk });
  return { ...g, diagnosis, runbook, approval, device, consentOk };
}

// ---------------------------------------------------------------------------------------------
// Internal engine operations.
// ---------------------------------------------------------------------------------------------
function invalidateApprovals(tx: Tx, ticketId: string, reason: string) {
  for (const a of tx.s.approvals) if (a.ticketId === ticketId && a.decision === 'APPROVE' && !a.consumedBy && !a.invalidatedAt && !a.expiredLoggedAt) {
    tx.patchApproval(a.id, { invalidatedAt: tx.nowIso, invalidReason: reason });
    tx.audit({ ticketId, action: 'APPROVAL_INVALIDATED', reason, metadata: { approvalId: a.id }, actor: SYSTEM, result: 'INFO' });
  }
}
function investigate(tx: Tx, ticketId: string, reason: string, by: string) {
  tx.patchTicket(ticketId, { investigation: { reason, at: tx.nowIso, by } });
}

/** AI diagnosis + recommendation. A new revision changes the plan, so older approvals and consent stop applying. */
function diagnose(tx: Tx, ticketId: string, reason: string) {
  const t = tx.ticket(ticketId);
  if (t.status !== 'DIAGNOSING') tx.move(ticketId, 'DIAGNOSING', 'AI_DIAGNOSIS_STARTED', reason, {}, AI);
  const prev = tx.s.diagnoses.filter((d) => d.ticketId === ticketId).reduce((m, d) => Math.max(m, d.revision), 0);
  const d = computeDiagnosis(tx.s, tx.ticket(ticketId), tx.device(t.deviceId), tx.settings, prev + 1, tx.nowIso);
  tx.addDiagnosis(d);
  tx.patchTicket(ticketId, { diagnosisId: d.id, consent: t.consent?.planHash === d.planHash ? t.consent : undefined });
  invalidateApprovals(tx, ticketId, `Proposed remediation changed (AI diagnosis revision ${d.revision})`);
  const g = gatesFor(tx.s, ticketId, tx.now);
  tx.patchDiagnosis(d.id, { reasons: g.reasons, recommendable: g.recommendable });
  if (!g.recommendable) tx.patchTicket(ticketId, { everUnsupported: true });
  tx.move(ticketId, g.route, g.recommendable ? 'AI_RECOMMENDATION' : 'AI_UNSUPPORTED', g.reasons.join('; '), {
    diagnosisId: d.id, revision: d.revision, confidence: d.confidence, rootCause: d.rootCause, recommendation: d.runbookId ? `${d.runbookId} v${d.runbookVersion}` : null,
    knowledge: d.knowledgeId ?? null, threshold: tx.settings.confidenceThreshold,
  }, AI, g.recommendable ? 'SUCCESS' : 'INFO');
  if (g.route === 'AWAITING_APPROVAL') tx.notify({ ticketId, recipient: 'ADMIN', message: `${t.displayId}: AI recommends a fix (confidence ${d.confidence}) — approval needed` });
  if (!g.recommendable) tx.notify({ ticketId, recipient: 'ADMIN', message: `${t.displayId}: AI could not recommend a reliable fix — investigation needed` });
  return d;
}

function reroute(tx: Tx, ticketId: string, reason: string) {
  const t = tx.ticket(ticketId);
  if (!GATE_STATES.includes(t.status)) return;
  const g = gatesFor(tx.s, ticketId, tx.now);
  if (g.route !== t.status) {
    tx.move(ticketId, g.route, 'GATES_REEVALUATED', `${reason}: ${g.reasons[0]}`, {}, SYSTEM, 'INFO');
    if (g.route === 'AWAITING_CONSENT') tx.notify({ ticketId, recipient: 'EMPLOYEE', message: `${t.displayId}: IT needs your OK before fixing your laptop` });
  }
}

function startExecution(tx: Tx, ticketId: string) {
  const t = tx.ticket(ticketId);
  if (t.status !== 'READY') throw new DomainError('ILLEGAL_TRANSITION', 'Not ready to start');
  const g = gatesFor(tx.s, ticketId, tx.now);
  if (g.route !== 'READY' || !g.runbook || !g.diagnosis || !g.approval) { reroute(tx, ticketId, 'Pre-start check'); throw new DomainError('BLOCKED', `Cannot start: ${g.reasons.join('; ')}`); }
  if (activeExecution(tx.s, ticketId)) throw new DomainError('DUPLICATE', 'A remediation is already running for this incident');
  if (tx.s.executions.some((e) => e.ticketId === ticketId && e.planHash === g.diagnosis!.planHash && e.phase !== 'CANCELLED')) throw new DomainError('DUPLICATE', 'This approved plan has already been executed');
  const pf = preflight(tx.s, ticketId, tx.now);
  if (!pf.ok) {
    tx.audit({ ticketId, action: 'PREREQUISITES_BLOCKED', reason: pf.blocking.map((c) => `${c.label}: ${c.detail}`).join('; '), metadata: { checks: pf.checks }, actor: SYSTEM, result: 'BLOCKED' });
    throw new DomainError('BLOCKED', `Prerequisites not met: ${pf.blocking.map((c) => c.label).join(', ')}`);
  }
  tx.audit({ ticketId, action: 'PREREQUISITES_PASSED', reason: preflightSummary(pf), metadata: { checks: pf.checks }, actor: SYSTEM });
  const id = uuid();
  tx.patchApproval(g.approval.id, { consumedBy: id });
  const e: Execution = {
    id, ticketId, planHash: g.diagnosis.planHash, runbookId: g.runbook.id, version: g.runbook.version, startedAt: tx.nowIso, phase: 'RUNNING', stepIndex: 0,
    nextAt: iso(tx.now + tx.timing.stepMs), snapshot: { ...g.device }, results: [], outcome: t.outcome, verificationPassed: false, deviceId: t.deviceId,
    diagnosisRevision: g.diagnosis.revision, simOutcome: t.outcome, approvalId: g.approval.id, approvedBy: g.approval.actor, changes: [], reversible: g.runbook.reversible, risk: g.diagnosis.risk,
    stepMs: tx.timing.stepMs, verifyMs: tx.timing.verifyMs, closeMs: tx.timing.closeMs, rollbackResults: [], verificationOutput: [], preflight: pf.checks,
  };
  tx.addExecution(e);
  tx.patchTicket(ticketId, { executionIds: [...t.executionIds, id] });
  tx.move(ticketId, 'EXECUTING', 'REMEDIATION_STARTED', `${g.runbook.title} started (approved by ${g.approval.actor})`, { executionId: id, runbook: `${g.runbook.id} v${g.runbook.version}`, approvalId: g.approval.id }, AI);
}

function failExecution(tx: Tx, e: Execution, outcome: Outcome, msg: string) {
  const t = tx.ticket(e.ticketId);
  const canRollback = e.reversible && e.changes.length > 0;
  tx.patchExecution(e.id, { phase: 'FAILED', outcome, endedAt: tx.nowIso, nextAt: undefined, verificationPassed: false });
  investigate(tx, e.ticketId, canRollback ? 'AI remediation failed verification — rollback available' : 'AI remediation failed', SYSTEM.name);
  tx.move(e.ticketId, canRollback ? 'ROLLBACK_AVAILABLE' : 'ESCALATED', outcome === 'EXEC_FAIL' ? 'REMEDIATION_FAILED' : 'VERIFICATION_FAILED',
    `${msg}${canRollback ? ' — incident stays open; rollback available' : e.changes.length ? ' — not reversible; manual investigation' : ' — no change was made; manual investigation'}`, { executionId: e.id, outcome }, AI, 'FAILURE');
  tx.notify({ ticketId: e.ticketId, recipient: 'ADMIN', message: `${t.displayId}: AI remediation failed${canRollback ? ' — rollback available' : ''}` });
  tx.notify({ ticketId: e.ticketId, recipient: 'EMPLOYEE', message: `${t.displayId}: the automated fix didn't work. IT is looking into it.` });
}

const DEVICE_LABELS: Partial<Record<keyof Device, string>> = { freeGB: 'Free disk (GB)', dnsHealthy: 'DNS healthy', serviceHealthy: 'Service healthy', wifiHealthy: 'Wi-Fi healthy', restartPending: 'Restart pending', appVersion: 'App version', osVersion: 'OS version' };
export const deviceFieldLabel = (f: keyof Device) => DEVICE_LABELS[f] ?? String(f);

/** Advance one due execution step. Idempotent — each call moves the phase/step forward exactly once. */
function stepExecution(tx: Tx, e0: Execution) {
  const e = tx.exec(e0.id);
  if (!e.nextAt || ms(e.nextAt) > tx.now) return;
  const t = tx.ticket(e.ticketId);
  const dev = tx.device(e.deviceId);
  const rb = runbookOf(tx.s, e)!;
  const act = SIM_ACTIONS[rb.actionKey];
  const res = (line: string) => [...tx.exec(e.id).results, line];
  if (e.phase === 'RUNNING') {
    const sd = rb.steps[e.stepIndex];
    if (!sd) {
      tx.patchExecution(e.id, { phase: 'VERIFYING', nextAt: iso(tx.now + e.verifyMs) });
      tx.move(e.ticketId, 'VERIFYING', 'VERIFICATION_STARTED', `Checking: ${rb.checks.join('; ')}`, { executionId: e.id }, AI);
      return;
    }
    const label = `${sd.id} · ${sd.description}`;
    if (!e.appliedAt && (!dev.online || dev.busy)) {
      const why = !dev.online ? 'Laptop went offline' : 'Employee became busy';
      tx.patchExecution(e.id, { phase: 'CANCELLED', endedAt: tx.nowIso, nextAt: undefined, cancelReason: why, results: res(`${label} — stopped before any change: ${why}`) });
      const g = gatesFor(tx.s, e.ticketId, tx.now);
      tx.move(e.ticketId, g.route === 'READY' ? 'AWAITING_APPROVAL' : g.route, 'REMEDIATION_CANCELLED', `${why}; no change made — a fresh approval is needed`, { executionId: e.id }, SYSTEM, 'BLOCKED');
      return;
    }
    if (e.stepIndex === 0 && e.simOutcome === 'EXEC_FAIL') {
      tx.patchExecution(e.id, { results: res(`${label} — FAILED: prerequisite check error; no change made`) });
      failExecution(tx, tx.exec(e.id), 'EXEC_FAIL', 'Remediation failed before making any change');
      return;
    }
    if (e.stepIndex === 1) {
      const pf = preflight(tx.s, e.ticketId, tx.now, { execution: e });
      if (!pf.ok) {
        tx.audit({ ticketId: e.ticketId, action: 'PREREQUISITES_BLOCKED', reason: pf.blocking.map((c) => `${c.label}: ${c.detail}`).join('; '), metadata: { executionId: e.id }, actor: SYSTEM, result: 'BLOCKED' });
        tx.patchExecution(e.id, { phase: 'CANCELLED', endedAt: tx.nowIso, nextAt: undefined, cancelReason: 'Prerequisites failed', results: res(`${label} — stopped before any change: prerequisites failed`) });
        tx.move(e.ticketId, 'AWAITING_APPROVAL', 'REMEDIATION_CANCELLED', 'Prerequisites failed before the change; no change made', { executionId: e.id }, SYSTEM, 'BLOCKED');
        return;
      }
      const patch = act.patch(dev);
      const changes = (Object.keys(patch) as (keyof Device)[]).filter((k) => patch[k] !== dev[k]).map((k) => ({ field: k, before: dev[k], after: patch[k] }));
      tx.patchDevice(dev.id, patch);
      const deadline = e.reversible ? iso(tx.now + 30 * MIN) : undefined;
      tx.patchExecution(e.id, { changes, appliedAt: tx.nowIso, rollbackDeadline: deadline, stepIndex: 2, nextAt: iso(tx.now + e.stepMs), results: res(`${label} — done${changes.length ? `: ${changes.map((c) => `${deviceFieldLabel(c.field)} ${String(c.before)} → ${String(c.after)}`).join(', ')}` : ''}`) });
      tx.audit({ ticketId: e.ticketId, action: 'REMEDIATION_APPLIED', reason: act.label, metadata: { executionId: e.id, changes }, actor: AI });
      return;
    }
    tx.patchExecution(e.id, { ...(e.stepIndex === 0 ? { snapshot: { ...dev } } : {}), stepIndex: e.stepIndex + 1, nextAt: iso(tx.now + e.stepMs), results: res(`${label} — done`) });
    return;
  }
  if (e.phase === 'VERIFYING') {
    const v = act.verify(dev);
    const pass = e.simOutcome === 'SUCCESS' && v.pass;
    const output = pass ? `PASS · ${v.output}` : `FAIL · ${e.simOutcome === 'SUCCESS' ? v.output : act.failOutput}`;
    tx.patchExecution(e.id, { verificationOutput: [output] });
    if (!pass) { failExecution(tx, tx.exec(e.id), e.simOutcome === 'SUCCESS' ? 'VERIFY_FAIL' : e.simOutcome, `Verification failed (${output.slice(7)})`); return; }
    tx.patchExecution(e.id, { phase: 'PASSED', outcome: 'SUCCESS', verificationPassed: true, endedAt: tx.nowIso, closurePending: true, nextAt: iso(tx.now + e.closeMs) });
    tx.patchTicket(e.ticketId, { verified: true, resolvedAt: tx.nowIso, path: 'HUMAN_APPROVED' });
    tx.move(e.ticketId, 'RESOLVED', 'VERIFICATION_PASSED', `Verified: ${v.output}`, { executionId: e.id }, AI);
    tx.notify({ ticketId: e.ticketId, recipient: 'EMPLOYEE', message: `${t.displayId}: fixed and verified. Reopen the ticket if the problem comes back.` });
    return;
  }
  if (e.phase === 'PASSED' && e.closurePending) {
    tx.patchExecution(e.id, { closurePending: false, nextAt: undefined });
    if (t.status === 'RESOLVED') {
      tx.patchTicket(e.ticketId, { closedAt: tx.nowIso, firstClosedAt: t.firstClosedAt ?? tx.nowIso });
      tx.move(e.ticketId, 'CLOSED', 'TICKET_CLOSED', 'Closed after successful verification (Human-approved AI remediation)', { executionId: e.id }, SYSTEM);
    }
    return;
  }
  if (e.phase === 'ROLLING_BACK') {
    const step = e.rollbackStep ?? 0;
    const rres = (line: string) => [...tx.exec(e.id).rollbackResults, line];
    if (step === 0) {
      const conflicts = e.changes.filter((c) => dev[c.field] !== c.after);
      if (conflicts.length) { finishRollback(tx, e.id, false, 'Device changed since the fix — rollback refused to avoid overwriting other changes'); return; }
      tx.patchExecution(e.id, { rollbackStep: 1, nextAt: iso(tx.now + e.stepMs), rollbackResults: rres('Rollback prerequisites checked') });
    } else if (step === 1) {
      if (e.simOutcome === 'ROLLBACK_FAIL') tx.patchExecution(e.id, { rollbackStep: 2, nextAt: iso(tx.now + e.verifyMs), rollbackResults: rres('Restore FAILED — previous settings not restored') });
      else {
        const patch: Partial<Device> = {};
        for (const c of e.changes) (patch as Record<string, unknown>)[c.field] = c.before;
        tx.patchDevice(dev.id, patch);
        tx.patchExecution(e.id, { rollbackStep: 2, nextAt: iso(tx.now + e.verifyMs), rollbackResults: rres(`Restored ${e.changes.map((c) => `${deviceFieldLabel(c.field)} → ${String(c.before)}`).join(', ')}`) });
      }
    } else {
      const ok = e.changes.every((c) => dev[c.field] === c.before);
      finishRollback(tx, e.id, ok, ok ? 'Previous settings restored and verified' : 'Restore could not be verified');
    }
  }
}

function finishRollback(tx: Tx, execId: string, ok: boolean, msg: string) {
  const e = tx.exec(execId);
  const t = tx.ticket(e.ticketId);
  tx.patchExecution(execId, { phase: ok ? 'ROLLED_BACK' : 'ROLLBACK_FAILED', outcome: ok ? e.outcome : 'ROLLBACK_FAIL', rollbackEndedAt: tx.nowIso, nextAt: undefined, rollbackResults: [...e.rollbackResults, `${ok ? 'PASS' : 'FAIL'} · ${msg}`] });
  tx.patchTicket(e.ticketId, { verified: false, resolvedAt: undefined, closedAt: undefined, path: undefined });
  investigate(tx, e.ticketId, ok ? 'Rolled back after a failed fix' : 'Rollback failed — manual recovery needed', e.rollbackBy ?? ADMIN_NAME);
  const rb = runbookOf(tx.s, e);
  const manual = ok ? '' : ` Manual recovery: ${rb?.rollbackSteps.join('; ') || 'restore manually'} (${e.changes.map((c) => `${deviceFieldLabel(c.field)}=${String(c.before)}`).join(', ')}).`;
  tx.move(e.ticketId, 'ESCALATED', ok ? 'ROLLBACK_COMPLETED' : 'ROLLBACK_FAILED', `${msg}. A rollback is not a resolution — the incident stays open for investigation.${manual}`, { executionId: execId }, SYSTEM, ok ? 'SUCCESS' : 'FAILURE');
  tx.notify({ ticketId: e.ticketId, recipient: 'ADMIN', message: `${t.displayId}: rollback ${ok ? 'completed' : 'FAILED'}` });
}

/** Process due work: approval expiry, consent/availability gates, approved starts and execution steps. */
export function processDue(state: AppState, now: number, timing: Timing = LIVE_TIMING): AppState {
  const tx = new Tx(state, now, SYSTEM, timing);
  for (const a of state.approvals) if (a.decision === 'APPROVE' && !a.consumedBy && !a.invalidatedAt && !a.expiredLoggedAt && ms(a.expiresAt) <= now) {
    tx.patchApproval(a.id, { expiredLoggedAt: tx.nowIso });
    tx.audit({ ticketId: a.ticketId, action: 'APPROVAL_EXPIRED', reason: `Approval by ${a.actor} expired before the fix could start (${state.settings.approvalTTLMin} min)`, metadata: { approvalId: a.id }, actor: SYSTEM, result: 'INFO' });
  }
  for (const t of Object.values(tx.s.tickets)) if (GATE_STATES.includes(t.status) && t.status !== 'READY') reroute(tx, t.id, 'Gate change');
  for (const t of Object.values(tx.s.tickets)) if (t.status === 'READY') {
    try { startExecution(tx, t.id); } catch (err) { if (!(err instanceof DomainError)) throw err; }
  }
  for (let guard = 0; guard < 5000; guard++) {
    const due = tx.s.executions.filter((e) => e.nextAt && ms(e.nextAt) <= now).sort((a, b) => ms(a.nextAt!) - ms(b.nextAt!))[0];
    if (!due) break;
    stepExecution(tx, due);
  }
  return tx.dirty ? tx.s : state;
}

// ---------------------------------------------------------------------------------------------
// Guarded actions.
// ---------------------------------------------------------------------------------------------
export interface CreateTicketInput { title: string; description: string; issueType: IssueType; employeeId?: string; priority?: 'P2' | 'P3' | 'P4'; outcome?: Outcome; device?: Partial<Device>; scenario?: string; demo?: boolean }
export interface KnowledgeDraft { title: string; pattern: string; diagnosticQuestions: string[]; conditions: string; employeeSteps: string[]; adminSteps: string[]; expectedOutcome: string; verification: string; risks: string; rollback: string }
export type Action =
  | { type: 'CREATE_TICKET'; input: CreateTicketInput }
  | { type: 'TS_ANSWER'; ticketId: string; answer: string }
  | { type: 'TS_ESCALATE'; ticketId: string; reason?: string }
  | { type: 'APPROVE'; ticketId: string; acknowledged: boolean }
  | { type: 'REJECT'; ticketId: string; reason: string }
  | { type: 'INVESTIGATE'; ticketId: string; reason?: string }
  | { type: 'CONSENT'; ticketId: string; grant: boolean }
  | { type: 'ROLLBACK'; ticketId: string }
  | { type: 'REOPEN'; ticketId: string; reason: string }
  | { type: 'RUN_DIAGNOSIS'; ticketId: string }
  | { type: 'RESOLVE_MANUAL'; ticketId: string; rootCause: string; steps: string; verification: string; knowledge?: KnowledgeDraft }
  | { type: 'VALIDATE_KNOWLEDGE'; knowledgeId: string }
  | { type: 'REJECT_KNOWLEDGE'; knowledgeId: string; reason: string }
  | { type: 'SAVE_SETTINGS'; settings: Omit<Settings, 'version'>; reason: string }
  | { type: 'SET_ROLE'; role: Role }
  | { type: 'MARK_NOTIFICATIONS_READ' };
export interface ActionResult { ok: boolean; state: AppState; message?: string; error?: { code: string; message: string }; ticketId?: string }

const req = (cond: unknown, code: DomainError['code'], msg: string) => { if (!cond) throw new DomainError(code, msg); };
const adminOnly = (tx: Tx) => req(tx.user.role === 'ADMIN', 'UNAUTHORIZED', 'Only an IT administrator can do this');
const employeeOnly = (tx: Tx) => req(tx.user.role === 'EMPLOYEE', 'UNAUTHORIZED', 'Only the employee can do this');

function createTicket(tx: Tx, input: CreateTicketInput): string {
  employeeOnly(tx);
  const title = input.title.trim(), description = input.description.trim();
  req(title.length >= 3 && title.length <= 120, 'VALIDATION', 'Please give your issue a short title (3–120 characters)');
  req(description.length >= 3 && description.length <= 1000, 'VALIDATION', 'Please describe the issue (3–1000 characters)');
  const it = ISSUE_TYPES.find((x) => x.key === input.issueType);
  req(it, 'VALIDATION', 'Choose a category');
  const category = input.issueType === 'OTHER' ? inferCategory(`${title} ${description}`) : it!.category;
  const emp = employeeById(input.employeeId ?? 'EMP-012');
  const n = tx.s.seq.device + 1;
  tx.s.seq = { ...tx.s.seq, device: n };
  const device: Device = { ...HEALTHY_DEVICE, os: emp.os, osVersion: emp.os === 'macOS' ? '14.6' : HEALTHY_DEVICE.osVersion, ...symptomFor(category), ...input.device, id: uuid(), name: emp.deviceName };
  tx.putDevice(device);
  const seq = tx.s.seq.ticket + 1;
  tx.s.seq = { ...tx.s.seq, ticket: seq };
  const id = uuid();
  const priority = input.priority ?? (category === 'WIFI' ? 'P2' : 'P3');
  const k = matchKnowledge(tx.s, { title, description, issueType: input.issueType });
  const fl = flowFor(category, k);
  const t: Ticket = {
    id, displayId: `INC-${1000 + seq}`, title, description, employeeId: emp.id, requester: emp.name, deviceId: device.id, issueType: input.issueType, category, priority,
    status: 'OPEN', createdAt: tx.nowIso, updatedAt: tx.nowIso, slaDueAt: iso(tx.now + SLA_HOURS[priority] * 60 * MIN), verified: false, reopenedCount: 0,
    outcome: input.outcome ?? 'SUCCESS', executionIds: [], troubleshooting: newTroubleshooting(fl.start, k?.id), everUnsupported: false, adminMin: 0, scenario: input.scenario, demo: input.demo,
  };
  tx.s.tickets = { ...tx.s.tickets, [id]: t };
  tx.audit({ ticketId: id, action: 'TICKET_CREATED', to: 'OPEN', reason: `${emp.name} reported: ${title}`, metadata: { issueType: it!.label, device: device.name, category: CATEGORY_LABEL[category] } });
  tx.move(id, 'SELF_SERVICE', 'GUIDED_TROUBLESHOOTING_STARTED', k ? `AI started guided troubleshooting using validated resolution ${k.id}` : 'AI started guided troubleshooting', { knowledge: k?.id ?? null }, AI);
  tx.createdId = id;
  return id;
}

/** Employee answers the current question/step (V1.2 §6). The next node adapts to the answer. */
function answer(tx: Tx, ticketId: string, ans: string) {
  employeeOnly(tx);
  const t = tx.ticket(ticketId);
  req(t.status === 'SELF_SERVICE' && t.troubleshooting.state === 'ACTIVE', 'ILLEGAL_TRANSITION', 'Troubleshooting is not active for this ticket');
  const k = t.troubleshooting.knowledgeId ? tx.s.knowledge.find((x) => x.id === t.troubleshooting.knowledgeId) : undefined;
  const fl = flowFor(t.category, k);
  const node = fl.nodes[t.troubleshooting.current ?? fl.start];
  const opt = node?.options.find((o) => o.answer === ans);
  req(node && opt, 'VALIDATION', 'That answer is not available for this question');
  const ts = t.troubleshooting;
  const entries = [...ts.entries, { nodeId: node!.id, kind: node!.kind, text: node!.text, answer: opt!.answer, answerLabel: opt!.label, at: tx.nowIso, source: node!.source }];
  const findings = opt!.finding ? [...ts.findings, opt!.finding] : ts.findings;
  const signals = opt!.signal ? [...ts.signals, opt!.signal] : ts.signals;
  const failedAttempts = ts.failedAttempts + (opt!.fail ? 1 : 0);
  tx.audit({ ticketId, action: node!.kind === 'QUESTION' ? 'DIAGNOSTIC_RESPONSE' : node!.kind === 'STEP' ? 'TROUBLESHOOTING_STEP' : 'EMPLOYEE_CONFIRMATION', reason: `${node!.text} → ${opt!.label}`, metadata: { nodeId: node!.id, answer: opt!.answer, knowledge: node!.source ?? null } });
  const unsure = entries.filter((e) => e.answer === 'NOT_SURE').length;
  if (opt!.next === 'RESOLVED') {
    tx.patchTicket(ticketId, { troubleshooting: { ...ts, entries, findings, signals, failedAttempts, state: 'RESOLVED', current: undefined } });
    tx.patchDevice(t.deviceId, healthyFor(t.category));
    tx.patchTicket(ticketId, { path: 'SELF_SERVICE', verified: true, resolvedAt: tx.nowIso, closedAt: tx.nowIso, firstClosedAt: t.firstClosedAt ?? tx.nowIso,
      resolution: { rootCause: 'Resolved by the employee with AI-guided troubleshooting', steps: entries.filter((e) => e.kind === 'STEP').map((e) => e.text).join(' → ') || 'Guided checks', verification: 'Employee confirmed the issue is resolved', by: t.requester, at: tx.nowIso } });
    tx.move(ticketId, 'CLOSED', 'TICKET_CLOSED', 'Employee confirmed the issue is resolved — closed by Employee Self-Service (no administrator approval needed)', { method: 'SELF_SERVICE' });
    tx.notify({ ticketId, recipient: 'EMPLOYEE', message: `${t.displayId} resolved. You can reopen it if the problem returns.` });
    return 'Great — your ticket is resolved and closed';
  }
  const limit = failedAttempts >= tx.settings.troubleshootingAttempts;
  const lowInfo = unsure >= 3;
  if (opt!.next === 'ESCALATE' || limit || lowInfo) {
    const reason = limit ? `Troubleshooting attempt limit reached (${failedAttempts} unsuccessful)` : lowInfo ? 'Not enough information to continue safely — AI confidence too low' : opt!.signal === 'NETWORK_WIDE' ? 'Likely a network-wide problem — needs IT' : 'Guided steps did not resolve the issue';
    escalate(tx, ticketId, { ...ts, entries, findings, signals, failedAttempts }, reason);
    return 'Sent to IT support with everything you already tried';
  }
  tx.patchTicket(ticketId, { troubleshooting: { ...ts, entries, findings, signals, failedAttempts, current: opt!.next } });
}

function escalate(tx: Tx, ticketId: string, ts: Ticket['troubleshooting'], reason: string) {
  const t = tx.ticket(ticketId);
  tx.patchTicket(ticketId, { troubleshooting: { ...ts, state: 'ESCALATED', escalationReason: reason, current: undefined } });
  tx.audit({ ticketId, action: 'ESCALATED_TO_IT', reason, metadata: { answers: ts.entries.length, stepsTried: ts.entries.filter((e) => e.kind === 'STEP').length, findings: ts.findings }, actor: AI });
  tx.notify({ ticketId, recipient: 'ADMIN', message: `${t.displayId} escalated by self-service: ${reason}` });
  diagnose(tx, ticketId, `Escalated from self-service: ${reason}`);
}

function act(tx: Tx, a: Action): string | void {
  switch (a.type) {
    case 'CREATE_TICKET': { const id = createTicket(tx, a.input); return `${tx.ticket(id).displayId} created — let's try to fix it together`; }
    case 'TS_ANSWER': return answer(tx, a.ticketId, a.answer);
    case 'TS_ESCALATE': {
      employeeOnly(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'SELF_SERVICE', 'ILLEGAL_TRANSITION', 'This ticket is already with IT');
      escalate(tx, a.ticketId, t.troubleshooting, a.reason?.trim() || 'Employee asked for IT help');
      return 'Sent to IT support';
    }
    case 'APPROVE': {
      adminOnly(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'AWAITING_APPROVAL', 'ILLEGAL_TRANSITION', 'There is no recommendation waiting for approval');
      req(a.acknowledged, 'VALIDATION', 'Review the proposed action and its risks before approving');
      const g = gatesFor(tx.s, t.id, tx.now);
      req(g.diagnosis && g.runbook && g.recommendable, 'BLOCKED', 'No valid recommendation to approve');
      req(!g.approval, 'DUPLICATE', 'This recommendation is already approved');
      const ap: Approval = {
        id: uuid(), ticketId: t.id, planHash: g.diagnosis!.planHash, settingsVersion: tx.settings.version, actor: tx.user.name, decision: 'APPROVE', at: tx.nowIso,
        expiresAt: iso(tx.now + tx.settings.approvalTTLMin * MIN), diagnosisRevision: g.diagnosis!.revision, requestedAt: g.diagnosis!.createdAt, deviceId: t.deviceId, runbookId: g.runbook!.id, runbookVersion: g.runbook!.version,
      };
      tx.addApproval(ap);
      tx.patchTicket(t.id, { adminMin: t.adminMin + tx.settings.reviewEffortMin });
      tx.audit({ ticketId: t.id, action: 'APPROVED', reason: `Approved “${g.runbook!.title}” for ${tx.device(t.deviceId).name} (AI confidence ${g.diagnosis!.confidence})`, metadata: { approvalId: ap.id, planHash: ap.planHash, runbook: `${ap.runbookId} v${ap.runbookVersion}`, expiresAt: ap.expiresAt } });
      const after = gatesFor(tx.s, t.id, tx.now);
      tx.move(t.id, after.route, 'GATES_REEVALUATED', after.reasons[0], {}, SYSTEM, 'INFO');
      if (after.route === 'AWAITING_CONSENT') tx.notify({ ticketId: t.id, recipient: 'EMPLOYEE', message: `${t.displayId}: IT needs your OK before fixing your laptop` });
      if (after.route === 'READY') startExecution(tx, t.id);
      return after.route === 'AWAITING_CONSENT' ? 'Approved — waiting for the employee’s OK' : after.route === 'READY' ? 'Approved — remediation started' : 'Approved';
    }
    case 'REJECT': {
      adminOnly(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'AWAITING_APPROVAL', 'ILLEGAL_TRANSITION', 'There is no recommendation waiting for a decision');
      req(a.reason.trim().length >= 3, 'VALIDATION', 'Give a reason for rejecting');
      const d = currentDiagnosis(tx.s, t)!;
      tx.addApproval({ id: uuid(), ticketId: t.id, planHash: d.planHash, settingsVersion: tx.settings.version, actor: tx.user.name, decision: 'REJECT', reason: a.reason.trim(), at: tx.nowIso, expiresAt: tx.nowIso, diagnosisRevision: d.revision, requestedAt: d.createdAt, deviceId: t.deviceId, runbookId: d.runbookId ?? '', runbookVersion: d.runbookVersion ?? 0 });
      tx.patchTicket(t.id, { adminMin: t.adminMin + tx.settings.reviewEffortMin });
      investigate(tx, t.id, `Recommendation rejected: ${a.reason.trim()}`, tx.user.name);
      tx.move(t.id, 'ESCALATED', 'RECOMMENDATION_REJECTED', a.reason.trim());
      return 'Recommendation rejected — moved to manual investigation';
    }
    case 'INVESTIGATE': {
      adminOnly(tx);
      const t = tx.ticket(a.ticketId);
      req(['AWAITING_APPROVAL', 'REVIEW_REQUIRED', 'ESCALATED', 'REOPENED', 'ROLLBACK_AVAILABLE', 'WAITING_DEVICE', 'AWAITING_CONSENT'].includes(t.status), 'ILLEGAL_TRANSITION', 'This incident cannot be taken over right now');
      req(!(t.status === 'ESCALATED' && t.investigation), 'DUPLICATE', 'Already under manual investigation');
      invalidateApprovals(tx, t.id, 'Administrator chose to investigate manually');
      investigate(tx, t.id, a.reason?.trim() || 'Administrator chose to investigate manually', tx.user.name);
      if (t.status === 'ESCALATED') tx.audit({ ticketId: t.id, action: 'MANUAL_INVESTIGATION', reason: a.reason?.trim() || 'Investigation started' });
      else tx.move(t.id, 'ESCALATED', 'MANUAL_INVESTIGATION', a.reason?.trim() || 'Administrator chose to investigate manually');
      tx.notify({ ticketId: t.id, recipient: 'EMPLOYEE', message: `${t.displayId}: an IT administrator is looking into your issue` });
      return 'Moved to manual investigation';
    }
    case 'CONSENT': {
      employeeOnly(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'AWAITING_CONSENT', 'ILLEGAL_TRANSITION', 'Nothing is waiting for your OK');
      const d = currentDiagnosis(tx.s, t)!;
      if (a.grant) {
        tx.patchTicket(t.id, { consent: { granted: true, at: tx.nowIso, expiresAt: iso(tx.now + DAY), planHash: d.planHash } });
        tx.audit({ ticketId: t.id, action: 'EMPLOYEE_CONSENT_GRANTED', reason: 'Employee agreed to the disruptive fix', metadata: { planHash: d.planHash } });
        const g = gatesFor(tx.s, t.id, tx.now);
        if (g.route !== t.status) tx.move(t.id, g.route, 'GATES_REEVALUATED', g.reasons[0], {}, SYSTEM, 'INFO');
        return 'Thanks — the fix will start now';
      }
      tx.patchTicket(t.id, { consent: { granted: false, at: tx.nowIso, expiresAt: tx.nowIso, planHash: d.planHash } });
      investigate(tx, t.id, 'Employee declined the disruptive fix — arrange a suitable time', t.requester);
      tx.move(t.id, 'ESCALATED', 'EMPLOYEE_CONSENT_DECLINED', 'Employee declined the disruptive fix', {}, undefined, 'BLOCKED');
      invalidateApprovals(tx, t.id, 'Employee declined');
      tx.notify({ ticketId: t.id, recipient: 'ADMIN', message: `${t.displayId}: employee declined the fix — manual follow-up needed` });
      return 'OK — IT will contact you to find a better time';
    }
    case 'ROLLBACK': {
      adminOnly(tx);
      const t = tx.ticket(a.ticketId);
      req(['ROLLBACK_AVAILABLE', 'RESOLVED', 'CLOSED'].includes(t.status), 'ILLEGAL_TRANSITION', 'Rollback is not available now');
      const e = latestAppliedExecution(tx.s, t.id);
      req(e && ['PASSED', 'FAILED'].includes(e.phase), 'BLOCKED', 'No applied change to roll back');
      req(e!.reversible, 'BLOCKED', `This fix cannot be rolled back: ${runbookOf(tx.s, e!)?.recoveryNote ?? ''}`);
      req(e!.rollbackDeadline && ms(e!.rollbackDeadline) > tx.now, 'EXPIRED', 'Rollback window (30 min) has passed');
      const dev = tx.device(t.deviceId);
      req(e!.changes.every((c) => dev[c.field] === c.after), 'CONFLICT', 'The device changed since the fix — rollback refused');
      tx.patchExecution(e!.id, { phase: 'ROLLING_BACK', rollbackStep: 0, nextAt: iso(tx.now + e!.stepMs), rollbackBy: tx.user.name, rollbackStartedAt: tx.nowIso, closurePending: false });
      tx.patchTicket(t.id, { adminMin: t.adminMin + tx.settings.rollbackEffortMin });
      tx.move(t.id, 'ROLLING_BACK', 'ROLLBACK_STARTED', `Rollback of ${e!.runbookId} requested`, { executionId: e!.id });
      return 'Rollback started';
    }
    case 'REOPEN': {
      employeeOnly(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'CLOSED' || t.status === 'RESOLVED', 'ILLEGAL_TRANSITION', 'Only resolved tickets can be reopened');
      req(a.reason.trim().length >= 3, 'VALIDATION', 'Tell IT what is still wrong');
      for (const e of tx.s.executions) if (e.ticketId === t.id && e.closurePending) tx.patchExecution(e.id, { closurePending: false, nextAt: undefined });
      tx.patchTicket(t.id, { verified: false, resolvedAt: undefined, closedAt: undefined, reopenedCount: t.reopenedCount + 1, investigation: undefined });
      tx.patchDevice(t.deviceId, symptomFor(t.category)); // simulated: the reported problem has recurred
      tx.move(t.id, 'REOPENED', 'TICKET_REOPENED', a.reason.trim(), { previousMethod: t.path });
      tx.notify({ ticketId: t.id, recipient: 'ADMIN', message: `${t.displayId} reopened by ${t.requester}: ${a.reason.trim()}` });
      return 'Ticket reopened — IT has been notified';
    }
    case 'RUN_DIAGNOSIS': {
      adminOnly(tx);
      const t = tx.ticket(a.ticketId);
      req(t.status === 'REOPENED' || ((t.status === 'REVIEW_REQUIRED' || t.status === 'ESCALATED') && !t.investigation), 'ILLEGAL_TRANSITION', 'AI diagnosis can be re-run for reopened or unsupported incidents');
      diagnose(tx, t.id, 'Administrator requested a fresh AI diagnosis');
      return tx.ticket(t.id).status === 'AWAITING_APPROVAL' ? 'AI proposed a fix — review it below' : 'AI still has no reliable fix — investigate manually';
    }
    case 'RESOLVE_MANUAL': {
      adminOnly(tx);
      const t = tx.ticket(a.ticketId);
      req(['REVIEW_REQUIRED', 'ESCALATED', 'REOPENED'].includes(t.status), 'ILLEGAL_TRANSITION', 'Manual resolution is available for unsupported or investigated incidents');
      req(a.rootCause.trim().length >= 3 && a.steps.trim().length >= 3 && a.verification.trim().length >= 3, 'VALIDATION', 'Root cause, resolution steps and verification are required');
      if (a.knowledge) {
        const kd = a.knowledge;
        req(kd.title.trim() && kd.pattern.trim() && (kd.employeeSteps.length || kd.adminSteps.length), 'VALIDATION', 'A reusable resolution needs a title, issue pattern and at least one step');
      }
      tx.patchDevice(t.deviceId, healthyFor(t.category));
      tx.patchTicket(t.id, {
        path: 'MANUAL', verified: true, resolvedAt: tx.nowIso, closedAt: tx.nowIso, firstClosedAt: t.firstClosedAt ?? tx.nowIso, adminMin: t.adminMin + tx.settings.baselines[t.category],
        resolution: { rootCause: a.rootCause.trim(), steps: a.steps.trim(), verification: a.verification.trim(), by: tx.user.name, at: tx.nowIso },
      });
      tx.move(t.id, 'RESOLVED', 'MANUAL_RESOLUTION', `Root cause: ${a.rootCause.trim()}. Fix: ${a.steps.trim()}`, { verification: a.verification.trim() });
      tx.move(t.id, 'CLOSED', 'TICKET_CLOSED', 'Closed after manual resolution and verification', {}, SYSTEM);
      tx.notify({ ticketId: t.id, recipient: 'EMPLOYEE', message: `${t.displayId}: resolved by IT. Reopen if the problem comes back.` });
      if (a.knowledge) {
        const n = tx.s.seq.knowledge + 1;
        tx.s.seq = { ...tx.s.seq, knowledge: n };
        const k: Knowledge = { ...a.knowledge, id: `K-${String(n).padStart(3, '0')}`, category: t.category, issueType: t.issueType, status: 'PENDING_VALIDATION', sourceTicketId: t.id, createdBy: tx.user.name, createdAt: tx.nowIso };
        tx.s.knowledge = [...tx.s.knowledge, k];
        tx.audit({ ticketId: t.id, action: 'REUSABLE_RESOLUTION_SAVED', reason: `${k.id} “${k.title}” saved — waiting for validation before AI can use it`, metadata: { knowledgeId: k.id } });
        return `Resolved and ${k.id} saved — validate it to make it available to AI`;
      }
      return 'Resolved manually and closed';
    }
    case 'VALIDATE_KNOWLEDGE': case 'REJECT_KNOWLEDGE': {
      adminOnly(tx);
      const k = tx.s.knowledge.find((x) => x.id === a.knowledgeId);
      req(k, 'NOT_FOUND', 'Resolution not found');
      req(k!.status === 'PENDING_VALIDATION', 'BLOCKED', 'Already reviewed');
      if (a.type === 'REJECT_KNOWLEDGE') {
        req(a.reason.trim().length >= 3, 'VALIDATION', 'Give a reason');
        tx.s.knowledge = tx.s.knowledge.map((x) => (x.id === k!.id ? { ...x, status: 'REJECTED' } : x)); tx.dirty = true;
        tx.audit({ action: 'REUSABLE_RESOLUTION_REJECTED', reason: `${k!.id}: ${a.reason.trim()}`, metadata: { knowledgeId: k!.id } });
        return `${k!.id} rejected`;
      }
      const v: Knowledge = { ...k!, status: 'VALIDATED', validatedBy: tx.user.name, validatedAt: tx.nowIso };
      tx.s.knowledge = tx.s.knowledge.map((x) => (x.id === k!.id ? v : x));
      tx.s.runbooks = [...tx.s.runbooks, runbookFromKnowledge(v)];
      tx.dirty = true;
      tx.audit({ action: 'REUSABLE_RESOLUTION_VALIDATED', reason: `${k!.id} “${k!.title}” validated — AI can now recommend it for similar incidents`, metadata: { knowledgeId: k!.id } });
      return `${k!.id} validated — AI will use it for similar incidents`;
    }
    case 'SAVE_SETTINGS': {
      adminOnly(tx);
      req(a.reason.trim().length >= 3, 'VALIDATION', 'Give a reason for the change');
      const next: Settings = { ...a.settings, version: tx.settings.version + 1 };
      const errs = validateSettings(next);
      req(!errs.length, 'VALIDATION', errs.join('; '));
      const prev = tx.settings;
      tx.s.settings = next;
      tx.s.settingsHistory = [...tx.s.settingsHistory, { settings: next, reason: a.reason.trim(), actor: tx.user.name, at: tx.nowIso }];
      const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => k !== 'version' && JSON.stringify(next[k]) !== JSON.stringify(prev[k]));
      tx.audit({ action: 'AI_SETTINGS_CHANGED', reason: a.reason.trim(), metadata: { version: next.version, changed } });
      // A different threshold changes the plan: re-diagnose pending recommendations (invalidating their approvals).
      if (next.confidenceThreshold !== prev.confidenceThreshold) for (const t of Object.values(tx.s.tickets)) if (GATE_STATES.includes(t.status)) diagnose(tx, t.id, `AI settings v${next.version}: confidence threshold changed`);
      return `AI settings v${next.version} saved`;
    }
    case 'SET_ROLE': tx.s.ui = { ...tx.s.ui, role: a.role }; tx.dirty = true; return a.role === 'ADMIN' ? 'Viewing as IT Administrator' : 'Viewing as Employee';
    case 'MARK_NOTIFICATIONS_READ': tx.s.notifications = tx.s.notifications.map((n) => (n.recipient === tx.user.role && !n.read ? { ...n, read: true } : n)); tx.dirty = true; return;
  }
}

/** Run a guarded action. Errors never mutate business state; authorization blocks are audited. */
export function applyAction(state: AppState, action: Action, now: number, opts: { actor?: Actor; timing?: Timing } = {}): ActionResult {
  const user = opts.actor ?? actorFor(state.ui.role);
  const tx = new Tx(state, now, user, opts.timing);
  try {
    const message = act(tx, action) ?? undefined;
    return { ok: true, state: tx.s, message, ticketId: tx.createdId ?? ('ticketId' in action ? action.ticketId : undefined) };
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    let s = state;
    if (err.code === 'UNAUTHORIZED') {
      const b = new Tx(state, now, user);
      b.audit({ ticketId: 'ticketId' in action ? action.ticketId : undefined, action: 'AUTHORIZATION_BLOCKED', reason: err.message, metadata: { attempted: action.type }, result: 'BLOCKED' });
      s = b.s;
    }
    return { ok: false, state: s, error: { code: err.code, message: err.message } };
  }
}
