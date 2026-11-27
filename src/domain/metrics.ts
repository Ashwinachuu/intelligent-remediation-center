import type { AppState, IssueType, Path, ProductStatus, Ticket } from './types';
import { productStatus } from './lifecycle';
import { slaState } from './insights';
import { addDaysKey, daysBetweenInclusive, localDateKey, localDayStart, ms, ratio, HOUR } from './util';

export interface Filters { from: string; to: string; issueType?: IssueType }

export function defaultRange(now: number, days = 7) { const to = localDateKey(now); return { from: addDaysKey(to, -(days - 1)), to }; }
export function rangeBounds(f: { from: string; to: string }) { return { start: localDayStart(f.from), end: localDayStart(addDaysKey(f.to, 1)) }; }
export const inRange = (t: string | undefined, f: { from: string; to: string }) => { if (!t) return false; const { start, end } = rangeBounds(f); const x = ms(t); return x >= start && x < end; };
export const matchesDims = (t: Ticket, f: Partial<Filters>) => !f.issueType || t.issueType === f.issueType;
/** Incident creation cohort: every KPI and success metric uses this one denominator. */
export const cohort = (s: AppState, f: Filters) => Object.values(s.tickets).filter((t) => inRange(t.createdAt, f) && matchesDims(t, f));

const closedBy = (t: Ticket, p: Path) => t.status === 'CLOSED' && t.verified && t.path === p;
const hadFailedAI = (s: AppState, t: Ticket) => s.executions.some((e) => e.ticketId === t.id && ['FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'].includes(e.phase));

/** Named predicates — every displayed count drills down to exactly one of these. */
export type MetricKey = 'all' | 'selfService' | 'humanApproved' | 'manual' | 'aiAssisted' | 'everUnsupported' | 'currentUnsupported' | 'unsupportedResolved' | 'reopened'
  | `status_${ProductStatus}` | 'actionRequired' | 'pendingApproval' | 'humanInvestigation' | 'overdue' | 'inProgress' | 'slaMissed';
export const METRIC_DEFS: Record<string, { label: string; predicate: string; test: (t: Ticket, s: AppState) => boolean }> = {
  all: { label: 'All reported incidents', predicate: 'created in the date range', test: () => true },
  selfService: { label: 'Auto-closed — Employee Self-Service', predicate: 'Closed, verified, resolution method = Employee Self-Service', test: (t) => closedBy(t, 'SELF_SERVICE') },
  humanApproved: { label: 'Human-approved closures', predicate: 'Closed, verified, resolution method = Human-approved AI remediation', test: (t) => closedBy(t, 'HUMAN_APPROVED') },
  manual: { label: 'Manually resolved', predicate: 'Closed, resolution method = Manual resolution', test: (t) => closedBy(t, 'MANUAL') },
  aiAssisted: { label: 'Verified AI-assisted resolutions', predicate: 'Closed & verified via Self-Service or Human-approved AI remediation (reopened excluded)', test: (t) => closedBy(t, 'SELF_SERVICE') || closedBy(t, 'HUMAN_APPROVED') },
  everUnsupported: { label: 'Ever classified unsupported', predicate: 'AI could not provide a reliable recommendation at least once', test: (t) => t.everUnsupported },
  currentUnsupported: { label: 'Currently unsupported', predicate: 'Status = New / Unsupported', test: (t) => productStatus(t) === 'UNSUPPORTED' },
  unsupportedResolved: { label: 'Previously unsupported, now resolved', predicate: 'Ever unsupported AND currently Closed', test: (t) => t.everUnsupported && t.status === 'CLOSED' },
  closedVerified: { label: 'Verified resolutions', predicate: 'Closed and verified (any method)', test: (t) => t.status === 'CLOSED' && t.verified },
  reopened: { label: 'Reopened at least once', predicate: 'reopened count > 0', test: (t) => t.reopenedCount > 0 },
  actionRequired: { label: 'All action required', predicate: 'Review needed, New / Unsupported, Manual investigation or Reopened', test: (t) => ['REVIEW_NEEDED', 'UNSUPPORTED', 'MANUAL', 'REOPENED'].includes(productStatus(t)) },
  pendingApproval: { label: 'Pending approval', predicate: 'AI-proposed remediation waiting for administrator authorization', test: (t) => productStatus(t) === 'REVIEW_NEEDED' },
  humanInvestigation: { label: 'Human investigation', predicate: 'New / Unsupported, Manual investigation or Reopened', test: (t) => ['UNSUPPORTED', 'MANUAL', 'REOPENED'].includes(productStatus(t)) },
  overdue: { label: 'Overdue', predicate: 'Open and past its SLA target (SLA indicator, not a status)', test: (t) => slaState(t, Date.now()) === 'BREACHED' },
  inProgress: { label: 'AI remediation in progress', predicate: 'Status = Remediation in progress', test: (t) => productStatus(t) === 'REMEDIATION' },
  slaMissed: { label: 'SLA missed or breached', predicate: 'Closed after SLA due, or open past due', test: (t) => ['MISSED', 'BREACHED'].includes(slaState(t, Date.now())) },
};
for (const st of ['OPEN', 'SELF_SERVICE', 'REVIEW_NEEDED', 'REMEDIATION', 'UNSUPPORTED', 'MANUAL', 'CLOSED', 'REOPENED'] as ProductStatus[]) {
  METRIC_DEFS[`status_${st}`] = { label: st, predicate: `Current status = ${st}`, test: (t) => productStatus(t) === st };
}

/**
 * Estimated administrator time saved (V1.2 §14, metric 4). Transparent and per incident:
 *   closed & verified:            manual baseline − admin minutes actually spent (self-service spends 0)
 *   open after a failed AI fix:   − admin minutes spent (review + rollback) — counts against AI
 *   everything else still open:   0 (not yet known)
 * A manual fix with no AI attempt therefore nets 0; a failed AI attempt followed by manual work nets negative.
 */
export function timeSaved(s: AppState, tickets: Ticket[]) {
  let selfService = 0, approved = 0, failed = 0;
  for (const t of tickets) {
    const base = s.settings.baselines[t.category];
    if (t.status === 'CLOSED' && t.verified) {
      const v = base - t.adminMin;
      if (t.path === 'SELF_SERVICE') selfService += v; else if (t.path === 'HUMAN_APPROVED') approved += v; else failed += v;
    } else if (hadFailedAI(s, t)) failed -= t.adminMin;
  }
  return { selfService, approved, failedOrManual: failed, total: selfService + approved + failed };
}
export function savedForTicket(s: AppState, t: Ticket) {
  const base = s.settings.baselines[t.category];
  if (t.status === 'CLOSED' && t.verified) return base - t.adminMin;
  return hadFailedAI(s, t) ? -t.adminMin : 0;
}

export function dashboard(s: AppState, f: Filters) {
  const c = cohort(s, f);
  const n = (k: string) => c.filter((t) => METRIC_DEFS[k].test(t, s)).length;
  const total = c.length;
  const ss = n('selfService'), ha = n('humanApproved');
  const dist: { key: string; label: string; count: number }[] = [
    { key: 'selfService', label: 'Auto-closed — Employee Self-Service', count: ss },
    { key: 'humanApproved', label: 'Human-approved closures', count: ha },
    { key: 'manual', label: 'Manually resolved', count: n('manual') },
    { key: 'status_REVIEW_NEEDED', label: 'Review needed', count: n('status_REVIEW_NEEDED') },
    { key: 'status_UNSUPPORTED', label: 'New / Unsupported', count: n('status_UNSUPPORTED') },
    { key: 'status_REMEDIATION', label: 'Remediation in progress', count: n('status_REMEDIATION') },
    { key: 'status_MANUAL', label: 'Manual investigation', count: n('status_MANUAL') },
    { key: 'status_SELF_SERVICE', label: 'Self-service in progress', count: n('status_SELF_SERVICE') },
    { key: 'status_REOPENED', label: 'Reopened', count: n('status_REOPENED') },
    { key: 'status_OPEN', label: 'Open', count: n('status_OPEN') },
  ];
  const everClosed = c.filter((t) => t.firstClosedAt);
  const now = Date.now();
  const met = c.filter((t) => slaState(t, now) === 'MET').length;
  const missed = c.filter((t) => ['MISSED', 'BREACHED'].includes(slaState(t, now))).length;
  return {
    total, dist, distSum: dist.reduce((a, d) => a + d.count, 0),
    aiRate: ratio(ss + ha, total), ssRate: ratio(ss, total), aiCount: ss + ha, ssCount: ss,
    unsupportedRate: ratio(n('everUnsupported'), total), everUnsupported: n('everUnsupported'), currentUnsupported: n('currentUnsupported'), unsupportedResolved: n('unsupportedResolved'),
    saved: timeSaved(s, c),
    reopenRate: ratio(everClosed.filter((t) => t.reopenedCount > 0).length, everClosed.length), reopened: everClosed.filter((t) => t.reopenedCount > 0).length, everClosed: everClosed.length,
    slaCompliance: ratio(met, met + missed), slaMet: met, slaMissed: missed,
  };
}

/** Closure activity basis: tickets with a current closedAt in the range (reopened tickets drop out). */
export function resolvedPerDay(s: AppState, f: Filters) {
  const rows: { day: string; SELF_SERVICE: number; HUMAN_APPROVED: number; MANUAL: number }[] = [];
  for (let k = f.from; k <= f.to; k = addDaysKey(k, 1)) rows.push({ day: k, SELF_SERVICE: 0, HUMAN_APPROVED: 0, MANUAL: 0 });
  const idx = new Map(rows.map((r, i) => [r.day, i]));
  for (const t of Object.values(s.tickets)) if (t.status === 'CLOSED' && t.path && inRange(t.closedAt, f) && matchesDims(t, f)) {
    const i = idx.get(localDateKey(t.closedAt!)); if (i !== undefined) rows[i][t.path]++;
  }
  return rows;
}
/** Creation basis: incidents AI could not support, by the day they were reported. */
export function unsupportedPerDay(s: AppState, f: Filters) {
  const rows: { day: string; unsupported: number; reported: number }[] = [];
  for (let k = f.from; k <= f.to; k = addDaysKey(k, 1)) rows.push({ day: k, unsupported: 0, reported: 0 });
  const idx = new Map(rows.map((r, i) => [r.day, i]));
  for (const t of cohort(s, f)) { const i = idx.get(localDateKey(t.createdAt)); if (i !== undefined) { rows[i].reported++; if (t.everUnsupported) rows[i].unsupported++; } }
  return rows;
}
/** Average elapsed turnaround (created → closed) by resolution method — elapsed time, NOT admin effort. */
export function turnaround(s: AppState, f: Filters) {
  const c = cohort(s, f).filter((t) => t.status === 'CLOSED' && t.closedAt && t.path);
  return (['SELF_SERVICE', 'HUMAN_APPROVED', 'MANUAL'] as Path[]).map((p) => {
    const xs = c.filter((t) => t.path === p).map((t) => (ms(t.closedAt!) - ms(t.createdAt)) / HOUR);
    return { path: p, n: xs.length, hours: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null };
  });
}
export function previousPeriod(f: Filters): Filters { const n = daysBetweenInclusive(f.from, f.to); return { ...f, from: addDaysKey(f.from, -n), to: addDaysKey(f.from, -1) }; }

export const fmtPct = (x: number | null, d = 0) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);
export const fmtMin = (m: number) => { const a = Math.abs(Math.round(m)); const s = m < 0 ? '−' : ''; return a >= 60 ? `${s}${(a / 60).toFixed(1)} h` : `${s}${a} min`; };
export function fmtAge(msv: number) { const m = Math.max(0, Math.floor(msv / 60000)); if (m < 60) return `${m}m`; const h = Math.floor(m / 60); return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`; }
