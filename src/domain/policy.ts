import type { Device, Risk, Runbook, Settings, Status } from './types';

/** Validation for AI Settings (V1.2 §17). Human approval and verification are not configurable. */
export function validateSettings(p: Settings): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(p.confidenceThreshold) || p.confidenceThreshold < 50 || p.confidenceThreshold > 99) errs.push('Confidence threshold must be a whole number between 50 and 99');
  if (!Number.isInteger(p.troubleshootingAttempts) || p.troubleshootingAttempts < 1 || p.troubleshootingAttempts > 5) errs.push('Troubleshooting attempts must be between 1 and 5');
  if (!Number.isInteger(p.approvalTTLMin) || p.approvalTTLMin < 5 || p.approvalTTLMin > 1440) errs.push('Approval expiry must be between 5 and 1440 minutes');
  for (const [k, v] of Object.entries(p.baselines)) if (!Number.isFinite(v) || v < 0 || v > 600) errs.push(`Baseline for ${k} must be 0–600 minutes`);
  if (!(p.reviewEffortMin >= 0 && p.reviewEffortMin <= 60)) errs.push('Review effort must be 0–60 minutes');
  if (!(p.rollbackEffortMin >= 0 && p.rollbackEffortMin <= 120)) errs.push('Rollback effort must be 0–120 minutes');
  return errs;
}

const BATTERY_MIN = 30;
export function resourceChecks(d: Device, rb?: Runbook) {
  const needsBattery = !!rb && (rb.disruptive || rb.restartRequired);
  const minGB = rb?.actionKey === 'OS_UPDATE' ? 10 : rb?.actionKey === 'APP_UPDATE' ? 2 : undefined;
  return {
    battery: needsBattery ? { applicable: true, ok: d.batteryPct >= BATTERY_MIN, detail: `Battery ${d.batteryPct}% (needs ≥ ${BATTERY_MIN}% or mains power)` } : { applicable: false, ok: true, detail: 'Not needed' },
    storage: minGB !== undefined ? { applicable: true, ok: d.freeGB >= minGB, detail: `Free disk ${d.freeGB} GB (needs ≥ ${minGB} GB)` } : { applicable: false, ok: true, detail: 'Not needed' },
  };
}
export function recoveryCheck(rb: Runbook | undefined, risk: Risk) {
  if (!rb) return { applicable: false, ok: true, detail: 'No remediation' };
  if (rb.reversible) return { applicable: true, ok: true, detail: `Rollback available: ${rb.rollbackSteps.join('; ')}` };
  if (risk === 'HIGH') return { applicable: true, ok: false, detail: 'HIGH-risk action without rollback is not permitted' };
  return { applicable: true, ok: true, detail: `No rollback — ${rb.recoveryNote}` };
}

export interface GateContext { confidence: number; risk: Risk; runbook?: Runbook; device: Device; settings: Settings; approvalValid: boolean; consentValid: boolean }
export interface GateResult { route: Status; reasons: string[]; recommendable: boolean; needsConsent: boolean }

/**
 * The single routing rule (V1.2 §10). There is NO autonomous path: confidence only decides whether AI may
 * recommend a fix; every execution needs an explicit administrator approval, and approval never overrides
 * the safety prerequisites below.
 */
export function evaluateRoute(c: GateContext): GateResult {
  const rb = c.runbook, d = c.device, s = c.settings;
  const needsConsent = !!rb?.disruptive && s.consentRequired;
  const out = (route: Status, reasons: string[], recommendable = true): GateResult => ({ route, reasons, recommendable, needsConsent });
  if (!rb) return out('REVIEW_REQUIRED', ['AI has no reliable fix for this issue — human investigation needed'], false);
  if (c.confidence < s.confidenceThreshold) return out('REVIEW_REQUIRED', [`AI confidence ${c.confidence} is below the ${s.confidenceThreshold} threshold — not recommending a fix`], false);
  if (!d.managed) return out('REVIEW_REQUIRED', ['Device is not managed by IT — fix must be done manually'], false);
  if (!rb.supportedOS.includes(d.os)) return out('REVIEW_REQUIRED', [`The approved fix does not support ${d.os} — fix must be done manually`], false);
  if (d.group !== 'Standard') return out('REVIEW_REQUIRED', [`${d.group} devices are excluded from AI remediation`], false);
  const rec = recoveryCheck(rb, c.risk);
  if (!rec.ok) return out('REVIEW_REQUIRED', [rec.detail], false);
  if (!c.approvalValid) return out('AWAITING_APPROVAL', ['AI recommends a fix — waiting for administrator approval (always required)']);
  if (needsConsent && !c.consentValid) return out('AWAITING_CONSENT', ['Approved — waiting for the employee to agree (the fix is disruptive)']);
  if (!d.online) return out('WAITING_DEVICE', ['Approved — waiting for the laptop to come online']);
  if (d.busy) return out('WAITING_DEVICE', ['Approved — waiting until the employee is available']);
  const res = resourceChecks(d, rb);
  if (!res.battery.ok || !res.storage.ok) return out('WAITING_DEVICE', [`Approved — prerequisite not met: ${[!res.battery.ok && res.battery.detail, !res.storage.ok && res.storage.detail].filter(Boolean).join('; ')}`]);
  return out('READY', ['Approved and all prerequisites met — starting']);
}
