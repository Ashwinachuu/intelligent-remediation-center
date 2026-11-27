import { gatesFor } from './engine';
import { recoveryCheck, resourceChecks } from './policy';
import type { AppState, Execution, PreflightCheck } from './types';

export interface PreflightResult { checks: PreflightCheck[]; ok: boolean; blocking: PreflightCheck[] }

/**
 * Execution prerequisites (V1.2 §11.1). Re-validated immediately before execution starts and again
 * before the device-changing step. Administrator approval never overrides a failed check.
 */
export function preflight(s: AppState, ticketId: string, now: number, opts: { execution?: Execution } = {}): PreflightResult {
  const t = s.tickets[ticketId];
  const g = gatesFor(s, ticketId, now);
  const d = g.diagnosis, rb = g.runbook, dev = g.device, e = opts.execution;
  const checks: PreflightCheck[] = [];
  const add = (key: string, label: string, status: PreflightCheck['status'], detail: string) => checks.push({ key, label, status, detail });
  add('reach', 'Laptop reachable', dev.online ? 'PASS' : 'FAIL', dev.online ? 'Management connection online' : 'Laptop is offline');
  add('compat', 'Device compatible', !rb ? 'NA' : dev.managed && rb.supportedOS.includes(dev.os) ? 'PASS' : 'FAIL', rb ? `${dev.os}, ${dev.managed ? 'managed' : 'unmanaged'}` : 'No fix planned');
  const res = resourceChecks(dev, rb);
  add('battery', 'Battery', !res.battery.applicable ? 'NA' : res.battery.ok ? 'PASS' : 'FAIL', res.battery.detail);
  add('storage', 'Storage', !res.storage.applicable ? 'NA' : res.storage.ok ? 'PASS' : 'FAIL', res.storage.detail);
  add('runbook', 'Approved fix and version', !d?.runbookId ? 'NA' : rb && (!e || (e.runbookId === rb.id && e.version === rb.version)) ? 'PASS' : 'FAIL', rb ? `${rb.id} v${rb.version}` : 'Fix no longer available');
  add('approval', 'Administrator approval', e ? 'PASS' : g.approval ? 'PASS' : rb ? 'PENDING' : 'NA', e ? `Approved by ${e.approvedBy}` : g.approval ? `Approved by ${g.approval.actor}` : 'Required for every AI-executed fix');
  add('consent', 'Employee consent', !g.needsConsent ? 'NA' : g.consentOk ? 'PASS' : t.consent && !t.consent.granted ? 'FAIL' : 'PENDING', !g.needsConsent ? 'Not disruptive' : g.consentOk ? 'Employee agreed' : 'Waiting for the employee');
  add('availability', 'Employee available', dev.busy ? 'PENDING' : 'PASS', dev.busy ? 'Employee is busy' : 'Available');
  const rec = recoveryCheck(rb, d?.risk ?? 'LOW');
  add('recovery', 'Recovery plan', !rec.applicable ? 'NA' : rec.ok ? 'PASS' : 'FAIL', rec.detail);
  const blocking = checks.filter((c) => c.status === 'FAIL' || c.status === 'PENDING');
  return { checks, ok: blocking.length === 0, blocking };
}
export const preflightSummary = (r: PreflightResult) => r.checks.filter((c) => c.status !== 'NA').map((c) => `${c.label}: ${c.status}`).join(' · ');
