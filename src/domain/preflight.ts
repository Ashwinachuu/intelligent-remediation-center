import { isExecutable } from './catalog';
import { gatesFor, holdReasonFor, validStepApproval } from './engine';
import { canRoleApprove, maturityAllowsAuto, recoveryCheck, resourceChecks } from './policy';
import type { AppState, Execution, PreflightCheck, Role } from './types';
import { ms } from './util';

export interface PreflightResult { checks: PreflightCheck[]; ok: boolean; blocking: PreflightCheck[]; pending: number; failed: number }

/**
 * Reusable preflight validation (enhancement §3). Pure and deterministic; the same function drives the
 * detail-page panel, the execution start gate and the re-validation immediately before an action step.
 * Every check is mandatory: a FAIL or PENDING blocks execution; NA does not.
 */
export function preflight(s: AppState, ticketId: string, now: number, opts: { execution?: Execution; viewerRole?: Role } = {}): PreflightResult {
  const t = s.tickets[ticketId];
  const g = gatesFor(s, ticketId, now);
  const d = g.diagnosis;
  const rb = g.runbook;
  const dev = g.device;
  const e = opts.execution;
  const checks: PreflightCheck[] = [];
  const add = (key: string, label: string, status: PreflightCheck['status'], detail: string) => checks.push({ key, label, status, detail, mandatory: true });

  add('reach', 'Endpoint reachability', dev.online ? 'PASS' : 'FAIL', dev.online ? 'Management channel reachable' : 'Management channel unreachable — device offline');
  if (!rb) add('compat', 'Device compatibility', d?.runbookId ? 'FAIL' : 'NA', d?.runbookId ? 'Planned runbook is no longer executable' : 'No executable runbook for this incident');
  else {
    const issues = [!dev.managed && 'unmanaged endpoint', !s.policy.allowedGroups.includes(dev.group) && `group ${dev.group} not allowed`, !rb.supportedOS.includes(dev.os) && `${dev.os} not supported by ${rb.id}`].filter(Boolean);
    add('compat', 'Device compatibility', issues.length ? 'FAIL' : 'PASS', issues.length ? issues.join('; ') : `${dev.os} ${dev.osVersion}, ${dev.group} group, managed — supported by ${rb.id}`);
  }
  const res = resourceChecks(dev, rb);
  add('battery', 'Battery', !res.battery.applicable ? 'NA' : res.battery.ok ? 'PASS' : 'FAIL', res.battery.detail);
  add('storage', 'Storage availability', !res.storage.applicable ? 'NA' : res.storage.ok ? 'PASS' : 'FAIL', res.storage.detail);
  if (!d) add('runbook', 'Approved runbook & version', 'PENDING', 'Not diagnosed yet');
  else if (!d.runbookId) add('runbook', 'Approved runbook & version', 'NA', 'No runbook — human handling');
  else {
    const current = s.runbooks.find((r) => r.id === d.runbookId && r.version === d.runbookVersion);
    const ok = !!current && isExecutable(current) && (!e || (e.runbookId === current.id && e.version === current.version));
    add('runbook', 'Approved runbook & version', ok ? 'PASS' : 'FAIL', ok ? `${current!.id} v${current!.version} · ${current!.status.toLowerCase()} · maturity L${current!.maturity}` : `${d.runbookId} v${d.runbookVersion} is ${current?.status.toLowerCase() ?? 'missing'} — plan must be re-diagnosed`);
  }
  // Authorization & user permissions
  if (!rb || !d) add('auth', 'Authorization & user permissions', 'NA', 'Nothing to authorize');
  else if (e) {
    const stepDef = rb.stepDefs[e.stepIndex];
    if (stepDef?.approval === 'STEP' && e.phase !== 'VERIFYING') {
      const sa = validStepApproval(s, e, now);
      add('auth', 'Authorization & user permissions', sa ? 'PASS' : 'PENDING', sa ? `Step ${stepDef.id} approved by ${sa.actor} (${sa.role})` : `Step ${stepDef.id} (${stepDef.risk} risk) needs ${stepDef.risk === 'HIGH' ? 'Admin' : 'Agent or Admin'} step approval`);
    } else add('auth', 'Authorization & user permissions', e.authorization.valid ? 'PASS' : 'FAIL', e.authorization.kind === 'APPROVAL' ? `Plan approved by ${e.authorization.actor} (${e.authorization.role})` : `Policy v${e.authorization.policyVersion} preapproval`);
  } else if (g.approval) add('auth', 'Authorization & user permissions', 'PASS', `Approved by ${g.approval.actor} (${g.approval.role}); bound to plan ${g.approval.planHash.slice(0, 8)}, policy v${g.approval.policyVersion}`);
  else if (g.autoEligible) add('auth', 'Authorization & user permissions', 'PASS', `Policy v${s.policy.version} preapproval at maturity L${rb.maturity}`);
  else {
    const viewer = opts.viewerRole ? canRoleApprove(opts.viewerRole, d.risk) : { ok: true };
    add('auth', 'Authorization & user permissions', 'PENDING', `Requires ${d.risk === 'HIGH' ? 'Admin' : 'Agent or Admin'} approval${opts.viewerRole ? ` — your role ${viewer.ok ? 'can approve' : 'cannot approve'}` : ''}`);
  }
  // Consent
  if (!rb?.disruptive) add('consent', 'Employee consent', 'NA', 'Non-disruptive action — consent not required');
  else if (g.consentOk) add('consent', 'Employee consent', 'PASS', `Granted by ${t.requester}; expires ${new Date(t.consent!.expiresAt).toLocaleString()}`);
  else if (t.consent && !t.consent.granted && t.consent.planHash === d?.planHash) add('consent', 'Employee consent', 'FAIL', 'Employee declined');
  else add('consent', 'Employee consent', 'PENDING', 'Awaiting employee response (never inferred from agent approval)');
  // Availability
  add('availability', 'Employee availability', dev.busy ? 'PENDING' : 'PASS', dev.busy ? 'Employee marked busy — execution deferred' : 'Employee available');
  // Maintenance window
  const job = g.job;
  if (e) add('window', 'Maintenance window', e.stepScheduledFor && ms(e.stepScheduledFor) > now ? 'PENDING' : 'PASS', e.stepScheduledFor ? `Step window ${new Date(e.stepScheduledFor).toLocaleString()}` : 'Window open (execution started)');
  else if (job) add('window', 'Maintenance window', ms(job.dueAt) <= now ? 'PASS' : 'PENDING', `Scheduled ${new Date(job.dueAt).toLocaleString()}`);
  else if (d?.risk === 'HIGH') add('window', 'Maintenance window', 'PENDING', 'HIGH risk requires a scheduled maintenance window');
  else add('window', 'Maintenance window', 'NA', 'Not required (may run now)');
  // Recovery
  const rec = recoveryCheck(rb, d?.risk ?? 'LOW');
  add('recovery', 'Recovery capability', !rec.applicable ? 'NA' : rec.ok ? 'PASS' : 'FAIL', rec.detail);
  // Policy compliance
  if (!d) add('policy', 'Automation policy compliance', 'PENDING', 'Not diagnosed yet');
  else {
    const hold = holdReasonFor(s, t);
    const issues = [!s.policy.enabled && 'automation paused', d.confidence < s.policy.approvalThreshold && `score ${d.confidence} < approval threshold ${s.policy.approvalThreshold}`, hold].filter(Boolean) as string[];
    const auto = rb ? maturityAllowsAuto(rb, t.source) : { ok: false };
    add('policy', 'Automation policy compliance', issues.length ? 'FAIL' : 'PASS', issues.length ? issues.join('; ') : `Policy v${s.policy.version}: score ${d.confidence} ≥ ${s.policy.approvalThreshold}${auto.ok && s.policy.autoEnabled ? '; maturity permits policy-based execution' : '; human-approved execution'}`);
  }
  const blocking = checks.filter((c) => c.mandatory && (c.status === 'FAIL' || c.status === 'PENDING'));
  return { checks, ok: blocking.length === 0, blocking, pending: checks.filter((c) => c.status === 'PENDING').length, failed: checks.filter((c) => c.status === 'FAIL').length };
}

/** Compact snapshot for audit metadata. */
export const preflightSummary = (r: PreflightResult) => r.checks.map((c) => `${c.label}: ${c.status}`).join(' · ');
