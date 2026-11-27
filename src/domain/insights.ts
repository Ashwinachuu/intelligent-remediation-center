import { CATEGORY_LABEL } from './catalog';
import { currentDiagnosis, gatesFor, pausedExecution, runbookOf } from './engine';
import { runbookRecord } from './maturity';
import { canRoleApprove } from './policy';
import { preflight, type PreflightResult } from './preflight';
import type { AppState, Execution, Role, Ticket } from './types';
import { HOUR, MIN, ms, localDateKey } from './util';

// ------------------------------------------------------------------------------------------------
// Similar incident intelligence (enhancement §6) — deterministic similarity, derived from records.
// ------------------------------------------------------------------------------------------------
export type HistoricalOutcome = 'VERIFIED_AI' | 'MANUAL' | 'VERIFY_FAILED' | 'ROLLED_BACK' | 'ROLLBACK_FAILED' | 'EXEC_FAILED' | 'OPEN';
export interface SimilarIncident { ticket: Ticket; score: number; reasons: string[]; outcome: HistoricalOutcome; durationMin: number | null; durationBasis: 'modeled' | 'none'; runbook?: string; runbookId?: string }

const tokens = (x: string) => new Set(x.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let i = 0; for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
}
function outcomeOf(s: AppState, t: Ticket): { outcome: HistoricalOutcome; exec?: Execution } {
  const ex = s.executions.filter((e) => e.ticketId === t.id && e.phase !== 'CANCELLED' && e.phase !== 'AWAITING_STEP');
  const last = ex[ex.length - 1];
  if (last) {
    if (last.phase === 'ROLLBACK_FAILED') return { outcome: 'ROLLBACK_FAILED', exec: last };
    if (last.phase === 'ROLLED_BACK') return { outcome: 'ROLLED_BACK', exec: last };
    if (last.phase === 'FAILED') return { outcome: last.outcome === 'EXEC_FAIL' ? 'EXEC_FAILED' : 'VERIFY_FAILED', exec: last };
    if (last.phase === 'PASSED' && t.verified && (t.status === 'RESOLVED' || t.status === 'CLOSED')) return { outcome: 'VERIFIED_AI', exec: last };
  }
  if (t.path === 'MANUAL' && (t.status === 'RESOLVED' || t.status === 'CLOSED')) return { outcome: 'MANUAL' };
  return { outcome: 'OPEN', exec: last };
}
export const OUTCOME_LABEL: Record<HistoricalOutcome, string> = {
  VERIFIED_AI: 'Verified AI resolution', MANUAL: 'Resolved manually', VERIFY_FAILED: 'Verification failed', ROLLED_BACK: 'Failed → rolled back',
  ROLLBACK_FAILED: 'Rollback failed', EXEC_FAILED: 'Failed before action', OPEN: 'Still open',
};

export function similarIncidents(s: AppState, ticketId: string, limit = 8) {
  const t = s.tickets[ticketId];
  const d = currentDiagnosis(s, t);
  const cat = d?.category ?? t.category;
  const dev = s.devices[t.deviceId];
  const tk = tokens(`${t.title} ${t.description}`);
  const all: SimilarIncident[] = [];
  for (const o of Object.values(s.tickets)) {
    if (o.id === t.id || o.isParent) continue;
    const od = currentDiagnosis(s, o);
    if ((od?.category ?? o.category) !== cat) continue;
    const odev = s.devices[o.deviceId];
    const reasons = [`Same category (${CATEGORY_LABEL[cat]})`];
    let score = 50;
    if (d?.runbookId && od?.runbookId === d.runbookId) { score += 15; reasons.push(`Same runbook ${d.runbookId}`); }
    if (odev.os === dev.os) { score += 10; reasons.push(`Same OS (${dev.os})`); }
    if (odev.group === dev.group) { score += 5; reasons.push(`${dev.group} group`); }
    if (o.source === t.source) { score += 5; reasons.push(o.source === 'DETECTION' ? 'Also proactive detection' : 'Also employee-reported'); }
    const j = jaccard(tk, tokens(`${o.title} ${o.description}`));
    if (j > 0) { score += Math.round(15 * j); if (j >= 0.3) reasons.push('Similar description'); }
    const { outcome, exec } = outcomeOf(s, o);
    all.push({ ticket: o, score: Math.min(100, score), reasons, outcome, durationMin: o.modeledResolutionMin ?? null, durationBasis: o.modeledResolutionMin !== undefined ? 'modeled' : 'none', runbook: exec ? `${exec.runbookId} v${exec.version}` : od?.runbookId ? `${od.runbookId} v${od.runbookVersion}` : undefined, runbookId: exec?.runbookId ?? od?.runbookId });
  }
  all.sort((a, b) => b.score - a.score || ms(b.ticket.createdAt) - ms(a.ticket.createdAt));
  // Always surface failed attempts so failure patterns are visible even if they rank lower.
  const top = all.slice(0, limit);
  const failures = all.filter((x) => ['VERIFY_FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED', 'EXEC_FAILED'].includes(x.outcome));
  for (const f of failures.slice(0, 3)) if (!top.includes(f)) top.push(f);
  const attempted = all.filter((x) => x.outcome !== 'OPEN' && x.outcome !== 'MANUAL');
  const aiOk = attempted.filter((x) => x.outcome === 'VERIFIED_AI').length;
  const durations = all.filter((x) => x.durationMin !== null).map((x) => x.durationMin!);
  const patterns: string[] = [];
  const failExecs = failures.map((f) => s.executions.filter((e) => e.ticketId === f.ticket.id && e.verificationOutput.length).slice(-1)[0]).filter(Boolean) as Execution[];
  const byMsg = new Map<string, number>();
  for (const e of failExecs) { const m = e.verificationOutput[0]?.replace(/^FAIL · /, '') ?? 'unknown'; byMsg.set(m, (byMsg.get(m) ?? 0) + 1); }
  for (const [m, n] of byMsg) patterns.push(`${n} of ${attempted.length} similar remediation attempts failed verification: “${m}”${failures.some((f) => f.outcome === 'ROLLED_BACK') ? ' — rolled back and escalated' : ''}`);
  const rbFail = failures.filter((f) => f.outcome === 'ROLLBACK_FAILED').length;
  if (rbFail) patterns.push(`${rbFail} rollback failure(s) required manual recovery`);
  const pre = failures.filter((f) => f.outcome === 'EXEC_FAILED').length;
  if (pre) patterns.push(`${pre} attempt(s) failed before the action (no change applied)`);
  return {
    items: top, total: all.length, attempted: attempted.length, aiVerified: aiOk, manual: all.filter((x) => x.outcome === 'MANUAL').length,
    successRate: attempted.length ? aiOk / attempted.length : null, medianModeledMin: durations.length ? durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null, patterns,
  };
}

// ------------------------------------------------------------------------------------------------
// Explainable assessment (enhancement §2): three separate signals, none of which overrides gates.
// ------------------------------------------------------------------------------------------------
export interface Assessment {
  diagnosisConfidence?: number; remediationConfidence: number | null; remediationBasis: string;
  readiness: 'READY' | 'PENDING' | 'BLOCKED' | 'N/A'; readinessDetail: string; preflight: PreflightResult;
  why: string[]; compatibility: string;
}
export function assessment(s: AppState, ticketId: string, now: number, viewerRole?: Role): Assessment {
  const g = gatesFor(s, ticketId, now);
  const d = g.diagnosis;
  const rb = g.runbook;
  const paused = pausedExecution(s, ticketId);
  const pf = preflight(s, ticketId, now, { execution: paused, viewerRole });
  const sim = similarIncidents(s, ticketId, 5);
  let remediationConfidence: number | null = null;
  let remediationBasis = 'No executable runbook — remediation confidence not applicable';
  if (rb) {
    const rec = runbookRecord(s, rb.id);
    remediationConfidence = Math.round(((rec.passed + 1) / (rec.completed + 2)) * 100);
    remediationBasis = `Simulated estimate: (verified + 1) / (completed + 2) over ${rec.completed} historical ${rb.id} executions (${rec.passed} verified)`;
  }
  const readiness: Assessment['readiness'] = !rb ? 'N/A' : pf.failed ? 'BLOCKED' : pf.pending ? 'PENDING' : 'READY';
  const why: string[] = [];
  if (d) {
    why.push(`Classified as ${CATEGORY_LABEL[d.category]} — ${d.evidence[0]}${d.telemetryConsistent ? ' (symptom confirmed by telemetry)' : ' — telemetry does NOT confirm the reported symptom'}`);
    if (rb) why.push(`${rb.id} v${rb.version} is the only approved, executable runbook for ${CATEGORY_LABEL[d.category]} (maturity L${rb.maturity})`);
    if (sim.attempted) why.push(`${sim.total} similar incidents on record; ${sim.aiVerified} of ${sim.attempted} automated attempts verified (${Math.round((sim.successRate ?? 0) * 100)}%)`);
    else if (sim.total) why.push(`${sim.total} similar incidents on record, none remediated automatically`);
  }
  const dev = g.device;
  const compatibility = rb ? (rb.supportedOS.includes(dev.os) && dev.managed ? `${dev.os} ${dev.osVersion}, managed, ${dev.group} — compatible with ${rb.id}` : `${dev.os} / ${dev.managed ? 'managed' : 'unmanaged'} — NOT compatible`) : 'No runbook to check';
  return {
    diagnosisConfidence: d?.confidence, remediationConfidence, remediationBasis, readiness, preflight: pf, why, compatibility,
    readinessDetail: !rb ? 'No automated execution planned' : readiness === 'READY' ? 'All mandatory preflight checks pass' : `${pf.failed} failed, ${pf.pending} pending (${pf.blocking.map((c) => c.label).join(', ')})`,
  };
}

// ------------------------------------------------------------------------------------------------
// SLA (enhancement §1).
// ------------------------------------------------------------------------------------------------
export type SlaState = 'MET' | 'MISSED' | 'BREACHED' | 'AT_RISK' | 'OK';
const DONE = (t: Ticket) => t.status === 'RESOLVED' || t.status === 'CLOSED';
export function slaState(t: Ticket, now: number): SlaState {
  const due = ms(t.slaDueAt);
  if (DONE(t) && t.resolvedAt) return ms(t.resolvedAt) <= due ? 'MET' : 'MISSED';
  if (now > due) return 'BREACHED';
  const window = due - ms(t.createdAt);
  return due - now <= Math.min(HOUR, window * 0.25) ? 'AT_RISK' : 'OK';
}
export const SLA_LABEL: Record<SlaState, string> = { MET: 'SLA met', MISSED: 'SLA missed', BREACHED: 'SLA breached', AT_RISK: 'SLA at risk', OK: 'Within SLA' };

// ------------------------------------------------------------------------------------------------
// Incident correlation (enhancement §7) — deterministic: category, network, location and time window.
// ------------------------------------------------------------------------------------------------
export const CORRELATION_WINDOW_MIN = 30;
const CORRELATED_CATEGORIES = ['WIFI', 'DNS', 'UNKNOWN'];
export interface Cluster { key: string; networkId: string; location: string; category: string; tickets: Ticket[]; spanMin: number; requesters: number; evidence: string[] }
export function detectClusters(s: AppState): Cluster[] {
  const open = Object.values(s.tickets).filter((t) => !t.parentId && !t.isParent && !DONE(t) && t.status !== 'ESCALATED' && CORRELATED_CATEGORIES.includes(t.category));
  const groups = new Map<string, Ticket[]>();
  for (const t of open) {
    const dev = s.devices[t.deviceId];
    if (!dev || dev.networkId.startsWith('HOME')) continue;
    const k = `${dev.networkId}|${t.category}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: Cluster[] = [];
  for (const [k, ts] of groups) {
    const sorted = ts.sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    let i = 0;
    while (i < sorted.length) {
      const start = ms(sorted[i].createdAt);
      const win = sorted.filter((t) => ms(t.createdAt) >= start && ms(t.createdAt) - start <= CORRELATION_WINDOW_MIN * MIN);
      const requesters = new Set(win.map((t) => t.requester)).size;
      if (win.length >= 3 && requesters >= 2) {
        const dev = s.devices[win[0].deviceId];
        const span = Math.round((ms(win[win.length - 1].createdAt) - start) / MIN);
        out.push({ key: `${k}|${win[0].id}`, networkId: dev.networkId, location: dev.location, category: win[0].category, tickets: win, spanMin: span, requesters, evidence: [
          `${win.length} ${CATEGORY_LABEL[win[0].category as Ticket['category']]} reports from ${requesters} different employees`,
          `All devices on network ${dev.networkId} at ${dev.location}`,
          `Reported within ${span} minutes (window ${CORRELATION_WINDOW_MIN} min)`,
          'Management channels reachable — symptom points to the shared network rather than individual endpoints (simulated)',
        ] });
        i += win.length;
      } else i++;
    }
  }
  return out;
}
export const clusterFor = (s: AppState, ticketId: string) => detectClusters(s).find((c) => c.tickets.some((t) => t.id === ticketId));

// ------------------------------------------------------------------------------------------------
// Agent workspace & prioritized action queue (enhancement §1).
// ------------------------------------------------------------------------------------------------
export interface QueueItem { ticket: Ticket; score: number; action: string; reason: string; sla: SlaState; factors: string[]; href: string; mine: boolean; aged: boolean }
/** Items older than this are shown as a separate aged backlog rather than crowding the active queue. */
export const AGED_BACKLOG_DAYS = 7;
const HUMAN: Record<string, string> = {
  AWAITING_APPROVAL: 'Review & approve plan', STEP_APPROVAL: 'Approve high-impact step', REVIEW_REQUIRED: 'Investigate', ESCALATED: 'Investigate & resolve',
  ROLLBACK_AVAILABLE: 'Roll back failed change', AWAITING_CONSENT: 'Follow up employee consent', WAITING_DEVICE: 'Check device availability', OPEN: 'Run diagnosis', REOPENED: 'Re-diagnose',
};
export function awaitingMyApproval(s: AppState, role: Role) {
  if (role === 'MANAGER') return [] as Ticket[];
  return Object.values(s.tickets).filter((t) => {
    if (t.status === 'AWAITING_APPROVAL') { const d = currentDiagnosis(s, t); return !!d && canRoleApprove(role, d.risk).ok; }
    if (t.status === 'STEP_APPROVAL') { const e = pausedExecution(s, t.id); const sd = e ? runbookOf(s, e)?.stepDefs[e.stepIndex] : undefined; return !!sd && canRoleApprove(role, sd.risk).ok; }
    return false;
  });
}
export function actionQueue(s: AppState, now: number, role: Role): QueueItem[] {
  const mine = new Set(awaitingMyApproval(s, role).map((t) => t.id));
  const items: QueueItem[] = [];
  for (const t of Object.values(s.tickets)) {
    const action = HUMAN[t.status];
    if (!action) continue;
    const d = currentDiagnosis(s, t);
    const dev = s.devices[t.deviceId];
    const sla = slaState(t, now);
    const factors: string[] = [];
    let score = { P2: 40, P3: 25, P4: 10 }[t.priority]; factors.push(`Severity ${t.priority}`);
    const overdueMs = now - ms(t.slaDueAt);
    if (sla === 'BREACHED') { score += overdueMs <= 24 * HOUR ? 30 : 10; factors.push(overdueMs <= 24 * HOUR ? 'SLA breached' : 'SLA breached (aged)'); } else if (sla === 'AT_RISK') { score += 30; factors.push('SLA at risk'); }
    if (dev.group === 'Critical' || t.isParent) { score += 15; factors.push(t.isParent ? 'Multiple employees affected' : 'Critical device group'); }
    if (t.source === 'EMPLOYEE') { score += 5; factors.push('Employee waiting'); }
    if (d?.risk === 'HIGH') { score += 10; factors.push('High risk'); } else if (d?.risk === 'MEDIUM') { score += 5; factors.push('Medium risk'); }
    if (['AWAITING_APPROVAL', 'STEP_APPROVAL', 'ROLLBACK_AVAILABLE', 'REVIEW_REQUIRED', 'ESCALATED'].includes(t.status)) { score += 15; factors.push('Human intervention required'); }
    if (mine.has(t.id)) { score += 10; factors.push('Awaiting your approval'); }
    const aged = now - ms(t.createdAt) > AGED_BACKLOG_DAYS * 24 * HOUR;
    items.push({ ticket: t, score, action, reason: `${action}${d ? ` · ${d.risk.toLowerCase()} risk` : ''}`, sla, factors, href: `/incidents/${t.id}?focus=action`, mine: mine.has(t.id), aged });
  }
  return items.sort((a, b) => Number(a.aged) - Number(b.aged) || b.score - a.score || ms(a.ticket.slaDueAt) - ms(b.ticket.slaDueAt));
}

export function workspaceCounts(s: AppState, now: number, role: Role) {
  const ts = Object.values(s.tickets);
  const today = localDateKey(now);
  const verifiedToday = ts.filter((t) => t.verified && t.resolvedAt && localDateKey(t.resolvedAt) === today && DONE(t));
  const aiToday = verifiedToday.filter((t) => t.path === 'AUTO_POLICY' || t.path === 'HUMAN_APPROVED');
  const base = s.settings.assumptions.baselines;
  return {
    myApprovals: role === 'MANAGER' ? null : awaitingMyApproval(s, role).length,
    inProgress: ts.filter((t) => ['READY', 'EXECUTING', 'VERIFYING', 'SCHEDULED', 'ROLLING_BACK'].includes(t.status)).length,
    investigation: ts.filter((t) => ['REVIEW_REQUIRED', 'ESCALATED', 'ROLLBACK_AVAILABLE'].includes(t.status)).length,
    breached: ts.filter((t) => slaState(t, now) === 'BREACHED').length,
    atRisk: ts.filter((t) => slaState(t, now) === 'AT_RISK').length,
    verifiedToday: verifiedToday.length,
    savedTodayMin: aiToday.reduce((a, t) => a + (base[t.category].agentMin - t.agentMin), 0),
    clusters: detectClusters(s).length,
  };
}
