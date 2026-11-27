import type { Device, Path, Policy, Risk, Role, Runbook, Status } from './types';

export const DEFAULT_POLICY: Policy = {
  version: 1, enabled: true, autoEnabled: false, reviewThreshold: 60, approvalThreshold: 80, autoThreshold: 95,
  allowedGroups: ['Standard'], approvalTTLMin: 60, maxAttempts: 1, closureMode: 'AUTO',
};
/** Historical synthetic pilot policy used only for seeded AUTO_POLICY history. */
export const HISTORICAL_POLICY_V0: Policy = { ...DEFAULT_POLICY, version: 0, autoEnabled: true, autoThreshold: 97 };

export function validatePolicy(p: Policy): string[] {
  const errs: string[] = [];
  const ints: (keyof Policy)[] = ['reviewThreshold', 'approvalThreshold', 'autoThreshold', 'approvalTTLMin', 'maxAttempts'];
  for (const k of ints) if (!Number.isInteger(p[k] as number)) errs.push(`${k} must be an integer`);
  if (!(p.reviewThreshold >= 0 && p.reviewThreshold < p.approvalThreshold && p.approvalThreshold < p.autoThreshold && p.autoThreshold <= 100))
    errs.push('Thresholds must satisfy 0 ≤ review < approval < auto ≤ 100');
  if (p.approvalTTLMin < 5 || p.approvalTTLMin > 1440) errs.push('Approval expiry must be between 5 and 1440 minutes');
  if (p.maxAttempts < 1 || p.maxAttempts > 3) errs.push('Attempt limit must be between 1 and 3');
  if (!p.allowedGroups.length) errs.push('At least one device group must be allowed');
  return errs;
}

export interface GateContext {
  confidence: number; risk: Risk; runbook?: Runbook; device: Device; policy: Policy;
  approvalValid: boolean; consentValid: boolean; scheduleDueAt?: string; now: number;
}
export interface GateResult {
  route: Status; path?: Path; reasons: string[]; requiredRole: Role | null; needsConsent: boolean;
  needsSchedule: boolean; autoEligible: boolean; hardBlock: boolean; blocker?: 'UNMANAGED' | 'GROUP' | 'OS' | 'NO_RUNBOOK' | 'CONFIDENCE' | 'PAUSED' | 'OFFLINE' | 'BUSY';
}

/**
 * Deterministic policy gate (Spec §6). Pure: same inputs => same route.
 * Ordering note: authorization (approval/policy) is evaluated before consent so an employee is never asked
 * to consent to a plan no human/policy has authorized yet. Busy + disruptive without consent -> AWAITING_CONSENT;
 * busy with consent (or non-disruptive) -> WAITING_DEVICE. No execution while busy, offline or paused.
 */
export function evaluateRoute(c: GateContext): GateResult {
  const p = c.policy, rb = c.runbook, d = c.device;
  const out = (route: Status, reasons: string[], extra: Partial<GateResult> = {}): GateResult => ({
    route, reasons, requiredRole: c.risk === 'HIGH' ? 'ADMIN' : 'AGENT', needsConsent: !!rb?.disruptive,
    needsSchedule: c.risk === 'HIGH', autoEligible: false, hardBlock: false, ...extra,
  });
  // 1. Hard blockers — no approval can override these.
  if (!d.managed) return out('ESCALATED', ['Unmanaged endpoint: manual handling only'], { hardBlock: true, blocker: 'UNMANAGED', requiredRole: null });
  if (!p.allowedGroups.includes(d.group)) return out('ESCALATED', [`Device group "${d.group}" is not allowed by policy v${p.version}`], { hardBlock: true, blocker: 'GROUP', requiredRole: null });
  if (rb && !rb.supportedOS.includes(d.os)) return out('ESCALATED', [`${rb.id} v${rb.version} does not support ${d.os}`], { hardBlock: true, blocker: 'OS', requiredRole: null });
  if (!rb) {
    if (c.confidence < p.reviewThreshold) return out('ESCALATED', [`No approved executable runbook and score ${c.confidence} < review threshold ${p.reviewThreshold}`], { hardBlock: true, blocker: 'NO_RUNBOOK', requiredRole: null });
    return out('REVIEW_REQUIRED', ['No approved executable runbook — human review required'], { blocker: 'NO_RUNBOOK', requiredRole: null });
  }
  // 2. Confidence bands.
  if (c.confidence < p.reviewThreshold) return out('ESCALATED', [`Score ${c.confidence} < review threshold ${p.reviewThreshold}`], { blocker: 'CONFIDENCE', requiredRole: null });
  if (c.confidence < p.approvalThreshold) return out('REVIEW_REQUIRED', [`Score ${c.confidence} < approval threshold ${p.approvalThreshold} — human review`], { blocker: 'CONFIDENCE', requiredRole: null });
  // 3. Pause / availability.
  if (!p.enabled) return out('REVIEW_REQUIRED', ['Automation paused by policy — manual handling allowed'], { blocker: 'PAUSED' });
  if (!d.online) return out('WAITING_DEVICE', ['Management channel unreachable — device offline'], { blocker: 'OFFLINE' });
  // 4. Authorization.
  const autoEligible = p.autoEnabled && c.risk === 'LOW' && c.confidence >= p.autoThreshold && rb.preapproved && !rb.disruptive;
  const reasons: string[] = [];
  if (autoEligible) reasons.push(`Preapproved by policy v${p.version}: LOW risk, score ${c.confidence} ≥ ${p.autoThreshold}, ${rb.id} preapproved, non-disruptive`);
  else {
    const why: string[] = [];
    if (!p.autoEnabled) why.push('policy preapproval is off');
    if (c.risk !== 'LOW') why.push(`${c.risk} risk is never auto-executed`);
    else if (c.confidence < p.autoThreshold) why.push(`score ${c.confidence} < auto threshold ${p.autoThreshold}`);
    if (!rb.preapproved) why.push(`${rb.id} not marked preapproved`);
    if (rb.disruptive) why.push('action is disruptive');
    reasons.push(`Explicit ${c.risk === 'HIGH' ? 'admin' : 'agent'} approval required (${why.join('; ')})`);
  }
  if (!autoEligible && !c.approvalValid) return out('AWAITING_APPROVAL', reasons, { autoEligible });
  if (c.approvalValid) reasons.push('Valid approval bound to current plan and policy');
  // 5. Consent / busy / schedule.
  if (rb.disruptive && !c.consentValid) return out('AWAITING_CONSENT', [...reasons, d.busy ? 'Employee busy — disruptive action needs fresh employee consent' : 'Disruptive action — employee consent required'], { autoEligible });
  if (d.busy) return out('WAITING_DEVICE', [...reasons, 'Employee/device busy — execution deferred'], { autoEligible, blocker: 'BUSY' });
  if (c.risk === 'HIGH' && !c.scheduleDueAt) return out('AWAITING_APPROVAL', [...reasons, 'High-risk action requires a scheduled maintenance window'], { autoEligible });
  if (c.scheduleDueAt && Date.parse(c.scheduleDueAt) > c.now) return out('SCHEDULED', [...reasons, `Scheduled for ${c.scheduleDueAt}`], { autoEligible });
  return out('READY', [...reasons, 'All gates satisfied'], { autoEligible, path: c.approvalValid ? 'HUMAN_APPROVED' : 'AUTO_POLICY' });
}

export function canRoleApprove(role: Role, risk: Risk): { ok: boolean; reason?: string } {
  if (role === 'MANAGER') return { ok: false, reason: 'Manager role is read-only and cannot approve' };
  if (risk === 'HIGH' && role !== 'ADMIN') return { ok: false, reason: 'HIGH-risk plans require an Admin approver' };
  return { ok: true };
}

/** Live route matrix computed from the same policy function (Spec §8.6). */
export function routeMatrix(policy: Policy, device: Device) {
  const scores = [40, 70, 85, 96];
  const risks: Risk[] = ['LOW', 'MEDIUM', 'HIGH'];
  return risks.map((risk) => ({
    risk,
    cells: scores.map((score) => {
      const rb: Runbook = {
        id: 'RB-SAMPLE', version: 1, title: 'Sample', category: 'STORAGE', status: 'APPROVED', risk, supportedOS: ['Windows 11'], steps: [], checks: [], rollbackSteps: [],
        reversible: true, disruptive: risk !== 'LOW', expectedMin: 5, owner: '', preapproved: risk === 'LOW', diagnosticOnly: false, prerequisites: [], recoveryNote: '', sourceTicketIds: [], createdAt: '', actionKey: 'STORAGE',
      };
      const r = evaluateRoute({ confidence: score, risk, runbook: rb, device, policy, approvalValid: false, consentValid: false, now: 0 });
      return { score, route: r.route, reason: r.reasons[0] };
    }),
  }));
}
export const MATRIX_SCORES = [40, 70, 85, 96];
