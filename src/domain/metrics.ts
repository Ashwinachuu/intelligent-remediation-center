import type { AppState, Category, Path, Ticket, Execution, Status } from './types';
import { currentDiagnosis, planRunbook } from './engine';
import { MIN, addDaysKey, daysBetweenInclusive, localDateKey, localDayStart, median, ms, ratio } from './util';
import { slaState } from './insights';

export interface Filters {
  from: string; to: string; // inclusive local dates YYYY-MM-DD
  source?: 'EMPLOYEE' | 'DETECTION'; category?: Category; group?: 'Standard' | 'Critical'; path?: Path | 'NONE';
}

export function defaultRange(now: number, days = 30): { from: string; to: string } {
  const to = localDateKey(now);
  return { from: addDaysKey(to, -(days - 1)), to };
}
export function rangeBounds(f: { from: string; to: string }) { return { start: localDayStart(f.from), end: localDayStart(addDaysKey(f.to, 1)) }; }
export const inRange = (t: string | undefined, f: { from: string; to: string }) => {
  if (!t) return false;
  const { start, end } = rangeBounds(f);
  const x = ms(t);
  return x >= start && x < end;
};
export function previousPeriod(f: Filters): Filters {
  const n = daysBetweenInclusive(f.from, f.to);
  return { ...f, from: addDaysKey(f.from, -n), to: addDaysKey(f.from, -1) };
}

/** Non-date dimension filters. */
export function matchesDims(s: AppState, t: Ticket, f: Partial<Filters>) {
  if (f.source && t.source !== f.source) return false;
  if (f.category && t.category !== f.category) return false;
  if (f.group && s.devices[t.deviceId]?.group !== f.group) return false;
  if (f.path) { if (f.path === 'NONE' ? !!t.path : t.path !== f.path) return false; }
  return true;
}
/** Intake cohort: tickets created within range and matching filters. */
export const cohort = (s: AppState, f: Filters) => Object.values(s.tickets).filter((t) => inRange(t.createdAt, f) && matchesDims(s, t, f));

export const isAI = (t: Ticket) => t.path === 'AUTO_POLICY' || t.path === 'HUMAN_APPROVED';
export const isVerifiedAIResolution = (t: Ticket) => (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.verified && isAI(t);
export function isUnsupported(s: AppState, t: Ticket) {
  const d = currentDiagnosis(s, t);
  if (!d) return false;
  return !planRunbook(s, d) || !d.osSupported;
}
export const COMPLETED_PHASES: Execution['phase'][] = ['PASSED', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'];

// ------- Named predicates for drill-down. Every displayed count links to exactly one of these. -------
export type MetricKey =
  | 'all' | 'autoClosed' | 'assistedClosed' | 'manualClosed' | 'review' | 'unsupported' | 'aiVerified' | 'eligible' | 'everResolved' | 'reopened'
  | 'b_closedAuto' | 'b_closedAssisted' | 'b_closedManual' | 'b_resolvedAwaiting' | 'b_decision' | 'b_waiting' | 'b_inProgress' | 'b_escalated' | 'b_other'
  | 'f_executed' | 'f_verified' | 'f_closed' | 'f_attempted' | 'verifiedAny' | 'sla_breached' | 'sla_at_risk' | 'sla_met' | 'sla_missed' | 'inProgress' | 'investigation';
export const METRIC_DEFS: Record<MetricKey, { label: string; predicate: string; test: (t: Ticket, s: AppState) => boolean }> = {
  all: { label: 'All incidents', predicate: 'every ticket in the intake cohort', test: () => true },
  autoClosed: { label: 'Auto-closed', predicate: 'status = Closed AND path = Auto (policy)', test: (t) => t.status === 'CLOSED' && t.path === 'AUTO_POLICY' },
  assistedClosed: { label: 'Human-approved closed', predicate: 'status = Closed AND path = Human-approved', test: (t) => t.status === 'CLOSED' && t.path === 'HUMAN_APPROVED' },
  manualClosed: { label: 'Manual closed', predicate: 'status = Closed AND path = Manual', test: (t) => t.status === 'CLOSED' && t.path === 'MANUAL' },
  review: { label: 'Review needed', predicate: 'status ∈ {Review required, Awaiting approval, Awaiting consent}', test: (t) => ['REVIEW_REQUIRED', 'AWAITING_APPROVAL', 'AWAITING_CONSENT'].includes(t.status) },
  unsupported: { label: 'Unsupported / new', predicate: 'current plan has no approved executable runbook OR OS unsupported (may overlap Review needed)', test: (t, s) => isUnsupported(s, t) },
  aiVerified: { label: 'Verified AI-assisted resolutions (eligible)', predicate: 'eligibleAtIntake AND currently Resolved/Closed AND verified AND path ∈ {Auto, Human-approved}', test: (t) => t.eligibleAtIntake && isVerifiedAIResolution(t) },
  eligible: { label: 'Eligible at intake', predicate: 'eligibleAtIntake = true', test: (t) => t.eligibleAtIntake },
  everResolved: { label: 'Ever resolved', predicate: 'firstResolvedAt is set', test: (t) => !!t.firstResolvedAt },
  reopened: { label: 'Reopened at least once', predicate: 'firstResolvedAt set AND reopenedCount > 0', test: (t) => !!t.firstResolvedAt && t.reopenedCount > 0 },
  b_closedAuto: { label: 'Closed · auto', predicate: 'Closed AND path Auto', test: (t) => t.status === 'CLOSED' && t.path === 'AUTO_POLICY' },
  b_closedAssisted: { label: 'Closed · assisted', predicate: 'Closed AND path Human-approved', test: (t) => t.status === 'CLOSED' && t.path === 'HUMAN_APPROVED' },
  b_closedManual: { label: 'Closed · manual', predicate: 'Closed AND path Manual (or none)', test: (t) => t.status === 'CLOSED' && (t.path === 'MANUAL' || !t.path) },
  b_resolvedAwaiting: { label: 'Resolved · awaiting closure', predicate: 'status = Resolved', test: (t) => t.status === 'RESOLVED' },
  b_decision: { label: 'Review / approval / consent', predicate: 'status ∈ {Review required, Awaiting approval, Awaiting consent}', test: (t) => ['REVIEW_REQUIRED', 'AWAITING_APPROVAL', 'AWAITING_CONSENT'].includes(t.status) },
  b_waiting: { label: 'Waiting / scheduled', predicate: 'status ∈ {Waiting for device, Scheduled, Ready}', test: (t) => ['WAITING_DEVICE', 'SCHEDULED', 'READY'].includes(t.status) },
  b_inProgress: { label: 'In progress', predicate: 'status ∈ {Diagnosing, Executing, Awaiting step approval, Verifying, Rollback available, Rolling back}', test: (t) => ['DIAGNOSING', 'EXECUTING', 'STEP_APPROVAL', 'VERIFYING', 'ROLLBACK_AVAILABLE', 'ROLLING_BACK'].includes(t.status) },
  b_escalated: { label: 'Escalated', predicate: 'status = Escalated', test: (t) => t.status === 'ESCALATED' },
  b_other: { label: 'Other open / reopened', predicate: 'status ∈ {Open, Reopened}', test: (t) => t.status === 'OPEN' || t.status === 'REOPENED' },
  f_executed: { label: 'Executed', predicate: 'eligibleAtIntake AND has ≥ 1 completed execution', test: (t, s) => t.eligibleAtIntake && s.executions.some((e) => e.ticketId === t.id && COMPLETED_PHASES.includes(e.phase)) },
  f_verified: { label: 'Verified', predicate: 'eligibleAtIntake AND currently verified AI resolution', test: (t) => t.eligibleAtIntake && isVerifiedAIResolution(t) },
  f_attempted: { label: 'Remediation attempted', predicate: 'eligibleAtIntake AND ≥ 1 execution started (not cancelled before start)', test: (t, s) => t.eligibleAtIntake && s.executions.some((e) => e.ticketId === t.id && e.phase !== 'CANCELLED') },
  verifiedAny: { label: 'Verified resolutions', predicate: 'currently Resolved/Closed AND verified (any path)', test: (t) => (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.verified },
  sla_breached: { label: 'SLA breached', predicate: 'open AND now > SLA due time (as of now)', test: (t) => slaState(t, Date.now()) === 'BREACHED' },
  sla_at_risk: { label: 'Approaching SLA breach', predicate: 'open AND due within min(1h, 25% of SLA window) (as of now)', test: (t) => slaState(t, Date.now()) === 'AT_RISK' },
  sla_met: { label: 'Resolved within SLA', predicate: 'resolvedAt ≤ SLA due time', test: (t) => slaState(t, Date.now()) === 'MET' },
  sla_missed: { label: 'SLA missed or breached', predicate: 'resolved after SLA due OR open past due', test: (t) => ['MISSED', 'BREACHED'].includes(slaState(t, Date.now())) },
  inProgress: { label: 'AI remediation in progress', predicate: 'status ∈ {Ready, Scheduled, Executing, Verifying, Rolling back}', test: (t) => ['READY', 'EXECUTING', 'VERIFYING', 'SCHEDULED', 'ROLLING_BACK'].includes(t.status) },
  investigation: { label: 'Human investigation required', predicate: 'status ∈ {Review required, Escalated, Rollback available}', test: (t) => ['REVIEW_REQUIRED', 'ESCALATED', 'ROLLBACK_AVAILABLE'].includes(t.status) },
  f_closed: { label: 'Closed', predicate: 'eligibleAtIntake AND verified AI resolution AND status Closed', test: (t) => t.eligibleAtIntake && isVerifiedAIResolution(t) && t.status === 'CLOSED' },
};
export const BUCKETS: MetricKey[] = ['b_closedAuto', 'b_closedAssisted', 'b_closedManual', 'b_resolvedAwaiting', 'b_decision', 'b_waiting', 'b_inProgress', 'b_escalated', 'b_other'];

export interface Kpis {
  total: number; employee: number; detection: number; autoClosed: number; assistedClosed: number; manualClosed: number; review: number; unsupported: number;
  eligible: number; coverage: number | null; northStarNum: number; northStar: number | null;
  agentSavedMin: number | null; efficiency: number | null; mttrModeled: number | null; mttrImprovement: number | null; reopenRate: number | null; aiVerifiedCount: number;
}
export function kpis(s: AppState, f: Filters): Kpis {
  const c = cohort(s, f);
  const count = (k: MetricKey) => c.filter((t) => METRIC_DEFS[k].test(t, s)).length;
  const eligible = c.filter((t) => t.eligibleAtIntake);
  const ns = eligible.filter(isVerifiedAIResolution);
  const ai = c.filter(isVerifiedAIResolution);
  const base = s.settings.assumptions.baselines;
  const sumB = ai.reduce((a, t) => a + base[t.category].agentMin, 0);
  const saved = ai.reduce((a, t) => a + (base[t.category].agentMin - t.agentMin), 0);
  const sumBR = ai.reduce((a, t) => a + base[t.category].resolutionMin, 0);
  const sumMR = ai.reduce((a, t) => a + (t.modeledResolutionMin ?? base[t.category].resolutionMin), 0);
  const resolved = c.filter((t) => (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.modeledResolutionMin !== undefined);
  const ever = c.filter((t) => t.firstResolvedAt);
  return {
    total: c.length, employee: c.filter((t) => t.source === 'EMPLOYEE').length, detection: c.filter((t) => t.source === 'DETECTION').length,
    autoClosed: count('autoClosed'), assistedClosed: count('assistedClosed'), manualClosed: count('manualClosed'), review: count('review'), unsupported: count('unsupported'),
    eligible: eligible.length, coverage: ratio(eligible.length, c.length), northStarNum: ns.length, northStar: ratio(ns.length, eligible.length),
    agentSavedMin: ai.length ? saved : null, efficiency: ratio(saved, sumB), mttrModeled: resolved.length ? resolved.reduce((a, t) => a + (t.modeledResolutionMin ?? 0), 0) / resolved.length : null,
    mttrImprovement: ratio(sumBR - sumMR, sumBR), reopenRate: ratio(ever.filter((t) => t.reopenedCount > 0).length, ever.length), aiVerifiedCount: ai.length,
  };
}

/** Execution metrics use execution timestamps in range and linked ticket dimension filters. */
export function executionsInRange(s: AppState, f: Filters) {
  return s.executions.filter((e) => inRange(e.startedAt, f) && s.tickets[e.ticketId] && matchesDims(s, s.tickets[e.ticketId], f));
}
export interface Guardrails {
  completed: number; verifiedSuccess: number | null; firstAttempt: number | null; rollbackRate: number | null; unauthorized: number; blockedAttempts: number;
  auditCompleteness: number | null; approvalTurnaroundMin: number | null; reopenRate: number | null; started: number;
}
const TERMINAL_ACTIONS = ['VERIFICATION_PASSED', 'VERIFICATION_FAILED', 'EXECUTION_FAILED', 'EXECUTION_CANCELLED', 'ROLLBACK_COMPLETED', 'ROLLBACK_FAILED'];
export function guardrails(s: AppState, f: Filters): Guardrails {
  const ex = executionsInRange(s, f);
  const completed = ex.filter((e) => COMPLETED_PHASES.includes(e.phase));
  const byTicket = new Map<string, Execution[]>();
  for (const e of s.executions) if (COMPLETED_PHASES.includes(e.phase)) byTicket.set(e.ticketId, [...(byTicket.get(e.ticketId) ?? []), e]);
  const ticketsWithCompleted = [...new Set(completed.map((e) => e.ticketId))];
  const firstOk = ticketsWithCompleted.filter((id) => byTicket.get(id)!.sort((a, b) => ms(a.startedAt) - ms(b.startedAt))[0].verificationPassed).length;
  const auditByExec = new Map<string, string[]>();
  for (const a of s.audit) { const id = a.metadata.executionId as string | undefined; if (id) auditByExec.set(id, [...(auditByExec.get(id) ?? []), a.action]); }
  const complete = ex.filter((e) => {
    const acts = auditByExec.get(e.id) ?? [];
    const decision = e.authorization.kind === 'APPROVAL' ? s.approvals.some((a) => a.id === (e.authorization as { approvalId: string }).approvalId) : !!e.authorization.decision;
    const terminal = e.endedAt || e.phase === 'CANCELLED' ? acts.some((x) => TERMINAL_ACTIONS.includes(x)) : true;
    return decision && acts.includes('EXECUTION_STARTED') && terminal;
  }).length;
  const turn: number[] = [];
  for (const a of s.approvals) {
    const t = s.tickets[a.ticketId];
    if (!t || !inRange(a.at, f) || !matchesDims(s, t, f)) continue;
    const d = s.diagnoses.find((x) => x.ticketId === a.ticketId && x.revision === a.diagnosisRevision);
    if (d) turn.push((ms(a.at) - ms(d.createdAt)) / MIN);
  }
  const c = cohort(s, f);
  const ever = c.filter((t) => t.firstResolvedAt);
  return {
    started: ex.filter((e) => e.phase !== 'CANCELLED').length, completed: completed.length, verifiedSuccess: ratio(completed.filter((e) => e.verificationPassed).length, completed.length),
    firstAttempt: ratio(firstOk, ticketsWithCompleted.length), rollbackRate: ratio(completed.filter((e) => e.phase === 'ROLLED_BACK' || e.phase === 'ROLLBACK_FAILED').length, completed.length),
    unauthorized: ex.filter((e) => !e.authorization.valid).length,
    blockedAttempts: s.audit.filter((a) => a.action === 'AUTHORIZATION_BLOCKED' && inRange(a.at, f)).length,
    auditCompleteness: ratio(complete, ex.length), approvalTurnaroundMin: median(turn), reopenRate: ratio(ever.filter((t) => t.reopenedCount > 0).length, ever.length),
  };
}

export function statusBreakdown(s: AppState, f: Filters) {
  const c = cohort(s, f);
  return BUCKETS.map((k) => ({ key: k, label: METRIC_DEFS[k].label, count: c.filter((t) => METRIC_DEFS[k].test(t, s)).length }));
}

/** Automation funnel (enhancement §9): nested subsets of one intake cohort and date range. */
export function funnel(s: AppState, f: Filters) {
  const c = cohort(s, f);
  const stage = (key: MetricKey) => c.filter((t) => METRIC_DEFS[key].test(t, s)).length;
  return [
    { key: 'all' as MetricKey, label: 'Reported incidents', count: c.length },
    { key: 'eligible' as MetricKey, label: 'Eligible incidents', count: stage('eligible') },
    { key: 'f_attempted' as MetricKey, label: 'Remediation attempted', count: stage('f_attempted') },
    { key: 'f_verified' as MetricKey, label: 'Verified AI resolutions', count: stage('f_verified') },
  ];
}

/** Business impact estimates (enhancement §9). All values are ESTIMATES from configurable assumptions. */
export function businessImpact(s: AppState, f: Filters) {
  const c = cohort(s, f);
  const a = s.settings.assumptions;
  const ai = c.filter(isVerifiedAIResolution);
  const agentMinSaved = ai.reduce((x, t) => x + (a.baselines[t.category].agentMin - t.agentMin), 0);
  const downtimeMin = ai.reduce((x, t) => x + Math.max(0, a.baselines[t.category].resolutionMin - (t.modeledResolutionMin ?? a.baselines[t.category].resolutionMin)), 0);
  const sumBR = ai.reduce((x, t) => x + a.baselines[t.category].resolutionMin, 0);
  const sumMR = ai.reduce((x, t) => x + (t.modeledResolutionMin ?? 0), 0);
  const now = Date.now();
  const met = c.filter((t) => slaState(t, now) === 'MET').length;
  const missed = c.filter((t) => ['MISSED', 'BREACHED'].includes(slaState(t, now))).length;
  const eligible = c.filter((t) => t.eligibleAtIntake);
  const ever = c.filter((t) => t.firstResolvedAt);
  const ex = executionsInRange(s, f).filter((e) => e.phase !== 'CANCELLED' && e.phase !== 'AWAITING_STEP');
  const disruptive = ex.filter((e) => s.runbooks.find((r) => r.id === e.runbookId && r.version === e.version)?.disruptive);
  return {
    aiResolutions: ai.length,
    agentHoursSaved: ai.length ? agentMinSaved / 60 : null,
    downtimeHoursAvoided: ai.length ? downtimeMin / 60 : null,
    costSavings: ai.length ? (agentMinSaved / 60) * a.hourlyCost : null,
    mttrImprovement: ratio(sumBR - sumMR, sumBR),
    verifiedRate: ratio(eligible.filter(isVerifiedAIResolution).length, eligible.length),
    slaCompliance: ratio(met, met + missed), slaMet: met, slaMissed: missed,
    reopenRate: ratio(ever.filter((t) => t.reopenedCount > 0).length, ever.length),
    disruptiveExecutions: disruptive.length,
    disruptionMin: disruptive.reduce((x, e) => x + (s.runbooks.find((r) => r.id === e.runbookId && r.version === e.version)?.expectedMin ?? 0), 0),
    disruptiveFailures: disruptive.filter((e) => ['FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'].includes(e.phase)).length,
  };
}

/** Resolved throughput uses current resolvedAt within range (activity basis). */
export function dailyResolvedByPath(s: AppState, f: Filters) {
  const days: string[] = [];
  for (let k = f.from; k <= f.to; k = addDaysKey(k, 1)) days.push(k);
  const rows = days.map((d) => ({ day: d, AUTO_POLICY: 0, HUMAN_APPROVED: 0, MANUAL: 0 }));
  const idx = new Map(days.map((d, i) => [d, i]));
  for (const t of Object.values(s.tickets)) {
    if (!t.resolvedAt || !inRange(t.resolvedAt, f) || !matchesDims(s, t, f)) continue;
    const i = idx.get(localDateKey(t.resolvedAt));
    if (i !== undefined && t.path) rows[i][t.path]++;
  }
  return rows;
}
/** Closure activity: current closedAt in range (reopened tickets have no current closedAt and are excluded). */
export const closedInRange = (s: AppState, f: Filters) => Object.values(s.tickets).filter((t) => t.closedAt && inRange(t.closedAt, f) && matchesDims(s, t, f));

export function durationByPath(s: AppState, f: Filters) {
  const c = cohort(s, f).filter((t) => (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.modeledResolutionMin !== undefined && t.path);
  return (['AUTO_POLICY', 'HUMAN_APPROVED', 'MANUAL'] as Path[]).map((p) => {
    const xs = c.filter((t) => t.path === p);
    return { path: p, n: xs.length, modeled: xs.length ? xs.reduce((a, t) => a + t.modeledResolutionMin!, 0) / xs.length : null, baseline: xs.length ? xs.reduce((a, t) => a + t.baselineResolutionMin, 0) / xs.length : null };
  });
}
export function categoryBreakdown(s: AppState, f: Filters) {
  const c = cohort(s, f);
  const m = new Map<Category, number>();
  for (const t of c) m.set(t.category, (m.get(t.category) ?? 0) + 1);
  return [...m.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}

/** Operational queue snapshot — current, independent of date filter. */
export function queueSnapshot(s: AppState, now: number) {
  const ts = Object.values(s.tickets);
  const ttl = s.policy.approvalTTLMin * MIN;
  const pending = ts.filter((t) => t.status === 'AWAITING_APPROVAL');
  const overdue = pending.filter((t) => { const d = currentDiagnosis(s, t); return d && now - ms(d.createdAt) > ttl; });
  return {
    pending: pending.length, overdue: overdue.length,
    rollback: ts.filter((t) => t.status === 'ROLLBACK_AVAILABLE' || t.status === 'ROLLING_BACK').length,
    waiting: ts.filter((t) => t.status === 'WAITING_DEVICE').length,
    consent: ts.filter((t) => t.status === 'AWAITING_CONSENT').length,
  };
}

// ------- Opportunities (P1) -------
export interface Opportunity { category: Category; tickets: Ticket[]; hours: number; drafts: { id: string; version: number; status: string }[] }
export function opportunities(s: AppState) {
  const gaps = new Map<Category, Ticket[]>();
  const blockers = new Map<string, Ticket[]>();
  for (const t of Object.values(s.tickets)) {
    const d = currentDiagnosis(s, t);
    if (!d) continue;
    const manualOrStuck = t.path === 'MANUAL' || ['ESCALATED', 'REVIEW_REQUIRED'].includes(t.status);
    if (!manualOrStuck) continue;
    const dev = s.devices[t.deviceId];
    const hasRunbook = !!planRunbook(s, d) || !!d.runbookId;
    if (!hasRunbook) { gaps.set(d.category, [...(gaps.get(d.category) ?? []), t]); continue; }
    // Known runbook but blocked by safety controls -> separate list, excluded from new-runbook gaps.
    const reason = !dev.managed ? 'Unmanaged endpoint' : !s.policy.allowedGroups.includes(dev.group) ? `Disallowed group (${dev.group})` : !d.osSupported ? `Unsupported OS (${dev.os})` : d.confidence < s.policy.approvalThreshold ? 'Low score / telemetry mismatch' : t.status === 'ESCALATED' ? 'Failed / rolled back / rejected' : 'Human review requested';
    blockers.set(reason, [...(blockers.get(reason) ?? []), t]);
  }
  const list: Opportunity[] = [...gaps.entries()].map(([category, tickets]) => ({
    category, tickets, hours: (tickets.length * Math.max(0, s.settings.assumptions.baselines[category].agentMin - 4)) / 60,
    drafts: s.runbooks.filter((r) => r.category === category && !(r.status === 'APPROVED' && r.actionKey)).map((r) => ({ id: r.id, version: r.version, status: r.status })),
  })).sort((a, b) => b.hours - a.hours);
  const blockerList = [...blockers.entries()].map(([reason, tickets]) => ({ reason, tickets, hours: tickets.reduce((a, t) => a + Math.max(0, t.baselineAgentMin - 4), 0) / 60 })).sort((a, b) => b.tickets.length - a.tickets.length);
  return { gaps: list, blockers: blockerList };
}

export const fmtPct = (x: number | null, digits = 0) => (x === null ? '—' : `${(x * 100).toFixed(digits)}%`);
export const fmtNum = (x: number | null, digits = 0) => (x === null || !Number.isFinite(x) ? '—' : x.toFixed(digits));
export const ageMs = (t: Ticket, now: number) => now - ms(t.createdAt);
export function fmtAge(msv: number) {
  const m = Math.max(0, Math.floor(msv / MIN));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
export const STATUS_ORDER: Status[] = ['OPEN', 'DIAGNOSING', 'REVIEW_REQUIRED', 'AWAITING_APPROVAL', 'AWAITING_CONSENT', 'WAITING_DEVICE', 'SCHEDULED', 'READY', 'EXECUTING', 'VERIFYING', 'ROLLBACK_AVAILABLE', 'ROLLING_BACK', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED'];

