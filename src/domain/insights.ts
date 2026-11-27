import { currentDiagnosis } from './engine';
import { productStatus } from './lifecycle';
import { words, overlap } from './knowledge';
import type { AppState, IssueType, Path, Ticket } from './types';
import { HOUR, localDateKey, ms } from './util';

// ---------------------------------------------------------------------------------------------
// SLA — an indicator, never a status (V1.2 §12).
// ---------------------------------------------------------------------------------------------
export type SlaState = 'MET' | 'MISSED' | 'BREACHED' | 'AT_RISK' | 'OK';
export function slaState(t: Ticket, now: number): SlaState {
  const due = ms(t.slaDueAt);
  if (t.status === 'CLOSED' && t.closedAt) return ms(t.closedAt) <= due ? 'MET' : 'MISSED';
  if (now > due) return 'BREACHED';
  return due - now <= Math.min(HOUR, (due - ms(t.createdAt)) * 0.25) ? 'AT_RISK' : 'OK';
}
export const SLA_LABEL: Record<SlaState, string> = { MET: 'SLA met', MISSED: 'SLA missed', BREACHED: 'Overdue', AT_RISK: 'Due soon', OK: 'Within SLA' };

// ---------------------------------------------------------------------------------------------
// Relevant historical incidents and their outcomes (V1.2 §9), including failures.
// ---------------------------------------------------------------------------------------------
export type HistOutcome = 'SELF_SERVICE' | 'HUMAN_APPROVED' | 'MANUAL' | 'FAILED_ROLLED_BACK' | 'FAILED' | 'OPEN';
export const HIST_LABEL: Record<HistOutcome, string> = { SELF_SERVICE: 'Fixed by employee self-service', HUMAN_APPROVED: 'Fixed by approved AI remediation', MANUAL: 'Fixed manually', FAILED_ROLLED_BACK: 'AI fix failed → rolled back', FAILED: 'AI fix failed', OPEN: 'Still open' };
export const HIST_SHORT: Record<HistOutcome, string> = { SELF_SERVICE: 'fixed by employee self-service', HUMAN_APPROVED: 'fixed by an approved AI fix', MANUAL: 'fixed manually', FAILED_ROLLED_BACK: 'AI fix failed → rolled back', FAILED: 'AI fix failed', OPEN: 'still open' };
export const HIST_ORDER: HistOutcome[] = ['HUMAN_APPROVED', 'SELF_SERVICE', 'MANUAL', 'FAILED_ROLLED_BACK', 'FAILED', 'OPEN'];

/**
 * Similar incidents = every other incident of the same issue category, most similar first. The summary
 * counts are computed from exactly the incidents returned, so the list and its summary always agree.
 */
export function similarIncidents(s: AppState, ticketId: string) {
  const t = s.tickets[ticketId];
  const tw = words(`${t.title} ${t.description}`);
  const items = Object.values(s.tickets).filter((o) => o.id !== t.id && o.category === t.category).map((o) => {
    const ex = s.executions.filter((e) => e.ticketId === o.id && e.phase !== 'CANCELLED');
    const failed = ex.find((e) => ['FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'].includes(e.phase));
    const outcome: HistOutcome = failed ? (failed.phase === 'FAILED' ? 'FAILED' : 'FAILED_ROLLED_BACK') : o.status === 'CLOSED' && o.path ? (o.path as Path) : 'OPEN';
    const score = 60 + Math.min(30, overlap(tw, words(`${o.title} ${o.description}`)) * 10) + (o.issueType === t.issueType ? 10 : 0);
    const later = failed && o.status === 'CLOSED' ? 'then fixed manually' : failed ? 'still open' : undefined;
    return { ticket: o, outcome, score: Math.min(100, score), later, failReason: failed?.verificationOutput[0]?.replace(/^FAIL · /, '') };
  }).sort((a, b) => b.score - a.score || ms(b.ticket.createdAt) - ms(a.ticket.createdAt));
  const counts = Object.fromEntries(HIST_ORDER.map((k) => [k, items.filter((x) => x.outcome === k).length])) as Record<HistOutcome, number>;
  return { items, total: items.length, counts, failures: items.filter((x) => x.outcome.startsWith('FAILED')) };
}

/**
 * Historical success of one specific fix: every earlier admin-approved run of the same runbook on other
 * incidents. This is a different question from diagnostic confidence ("is the cause right?") — it answers
 * "when admins approved this exact fix before, did verification pass?".
 */
export type RunResult = 'VERIFIED' | 'FAILED' | 'IN_PROGRESS';
export function fixTrackRecord(s: AppState, runbookId: string | undefined, excludeTicketId: string) {
  const runs = runbookId ? s.executions.filter((e) => e.runbookId === runbookId && e.ticketId !== excludeTicketId && e.phase !== 'CANCELLED').map((e) => {
    const result: RunResult = e.phase === 'PASSED' || (e.verificationPassed && e.verificationOutput.length > 0) ? 'VERIFIED'
      : e.verificationOutput.length > 0 || ['FAILED', 'ROLLING_BACK', 'ROLLED_BACK', 'ROLLBACK_FAILED'].includes(e.phase) ? 'FAILED' : 'IN_PROGRESS';
    return { execution: e, ticket: s.tickets[e.ticketId], result, rolledBack: e.phase === 'ROLLED_BACK', reason: e.verificationOutput[0]?.replace(/^(FAIL|PASS) · /, '') };
  }).sort((a, b) => ms(b.execution.startedAt) - ms(a.execution.startedAt)) : [];
  const verified = runs.filter((r) => r.result === 'VERIFIED').length;
  const failed = runs.filter((r) => r.result === 'FAILED').length;
  const finished = verified + failed;
  return { runs, verified, failed, inProgress: runs.length - finished, finished, rate: finished ? verified / finished : null };
}

// ---------------------------------------------------------------------------------------------
// Admin workspace (V1.2 §13).
// ---------------------------------------------------------------------------------------------
export type QueueFilter = 'ALL' | 'PENDING' | 'INVESTIGATION' | 'OVERDUE';
export interface QueueItem { ticket: Ticket; score: number; why: string; action: string; overdue: boolean; kind: 'PENDING' | 'INVESTIGATION' }
export function actionQueue(s: AppState, now: number, filter: QueueFilter = 'ALL'): QueueItem[] {
  const items: QueueItem[] = [];
  for (const t of Object.values(s.tickets)) {
    const ps = productStatus(t);
    const pending = ps === 'REVIEW_NEEDED';
    const invest = ps === 'UNSUPPORTED' || ps === 'MANUAL' || ps === 'REOPENED';
    if (!pending && !invest) continue;
    const sla = slaState(t, now);
    const overdue = sla === 'BREACHED';
    if (filter === 'PENDING' && !pending) continue;
    if (filter === 'INVESTIGATION' && !invest) continue;
    if (filter === 'OVERDUE' && !overdue) continue;
    const d = currentDiagnosis(s, t);
    const why = pending ? `AI proposes “${s.runbooks.find((r) => r.id === d?.runbookId)?.title ?? 'a fix'}” (diagnosis confidence ${d?.confidence}%) — needs your approval`
      : ps === 'UNSUPPORTED' ? 'AI has no reliable fix — needs a human to investigate'
      : ps === 'REOPENED' ? `Employee reopened it: the problem came back`
      : t.investigation?.reason ?? 'Under manual investigation';
    const score = { P2: 30, P3: 20, P4: 10 }[t.priority] + (overdue ? 30 : sla === 'AT_RISK' ? 20 : 0) + (pending ? 15 : 10) + (ps === 'REOPENED' ? 5 : 0);
    items.push({ ticket: t, score, why: `${why}${overdue ? ' · overdue' : sla === 'AT_RISK' ? ' · due soon' : ''}`, action: pending ? 'Review & decide' : ps === 'REOPENED' ? 'Re-diagnose' : 'Investigate', overdue, kind: pending ? 'PENDING' : 'INVESTIGATION' });
  }
  return items.sort((a, b) => b.score - a.score || ms(a.ticket.slaDueAt) - ms(b.ticket.slaDueAt));
}
export function workspaceCounts(s: AppState, now: number) {
  const ts = Object.values(s.tickets);
  const today = localDateKey(now);
  const closedToday = ts.filter((t) => t.status === 'CLOSED' && t.verified && t.closedAt && localDateKey(t.closedAt) === today);
  return {
    awaitingApproval: ts.filter((t) => productStatus(t) === 'REVIEW_NEEDED').length,
    inProgress: ts.filter((t) => productStatus(t) === 'REMEDIATION').length,
    investigation: ts.filter((t) => ['UNSUPPORTED', 'MANUAL', 'REOPENED'].includes(productStatus(t))).length,
    verifiedToday: closedToday.length,
    closedToday,
  };
}

// ---------------------------------------------------------------------------------------------
// Opportunities & continuous learning (V1.2 §16): recurring incidents AI cannot resolve yet.
// ---------------------------------------------------------------------------------------------
export interface Opportunity {
  key: IssueType; tickets: Ticket[]; open: number; closed: number; last7: number;
  /** Admin minutes actually spent on the closed ones + the manual baseline for each still-open one. */
  effortMin: number; avgMin: number;
  /** Estimated minutes saved per future incident once AI can recommend an approvable fix (baseline − review effort). */
  savingPerIncident: number;
  knowledge: { id: string; status: string; title: string }[]; covered: boolean;
  next: { text: string; ticketId?: string; knowledgeId?: string }; rank: number;
}
/**
 * Which unsupported incidents to teach AI first. Unsupported = AI had no reliable recommendation at least
 * once (the same cohort as the Overview's unsupported rate). Grouped by issue type and ranked by total
 * manual handling effort = frequency × effort per incident. Groups already covered by validated knowledge
 * drop to the bottom.
 */
export function opportunities(s: AppState, now: number): Opportunity[] {
  const groups = new Map<IssueType, Ticket[]>();
  for (const t of Object.values(s.tickets)) if (t.everUnsupported) groups.set(t.issueType, [...(groups.get(t.issueType) ?? []), t]);
  const out: Opportunity[] = [];
  for (const [key, ts] of groups) {
    const kn = s.knowledge.filter((k) => k.issueType === key).map((k) => ({ id: k.id, status: k.status, title: k.title }));
    const open = ts.filter((t) => t.status !== 'CLOSED');
    const manualClosed = ts.filter((t) => t.status === 'CLOSED' && t.path === 'MANUAL' && t.resolution);
    const pending = kn.find((k) => k.status === 'PENDING_VALIDATION');
    const covered = kn.some((k) => k.status === 'VALIDATED');
    const fromTicket = manualClosed.find((t) => !s.knowledge.some((k) => k.sourceTicketId === t.id));
    const next = pending ? { text: `Validate ${pending.id} so AI can use it`, knowledgeId: pending.id }
      : !covered && fromTicket ? { text: `Save the fix from ${fromTicket.displayId} as a reusable resolution`, ticketId: fromTicket.id }
      : !covered && open.length ? { text: `Resolve ${open[0].displayId} and save the fix as a reusable resolution`, ticketId: open[0].id }
      : { text: covered ? 'Taught — AI now suggests the validated fix' : 'Monitor for recurrence' };
    const baseline = s.settings.baselines[ts[0].category];
    const effortMin = ts.reduce((a, t) => a + (t.status === 'CLOSED' ? t.adminMin || baseline : baseline), 0);
    out.push({
      key, tickets: ts.sort((a, b) => ms(b.createdAt) - ms(a.createdAt)), open: open.length, closed: ts.length - open.length,
      last7: ts.filter((t) => now - ms(t.createdAt) <= 7 * 24 * HOUR).length,
      effortMin, avgMin: Math.round(effortMin / ts.length), savingPerIncident: Math.max(0, baseline - s.settings.reviewEffortMin),
      knowledge: kn, covered, next, rank: 0,
    });
  }
  out.sort((a, b) => Number(a.covered) - Number(b.covered) || b.effortMin - a.effortMin || b.tickets.length - a.tickets.length);
  out.forEach((o, i) => { o.rank = i + 1; });
  return out;
}
