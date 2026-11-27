import { DEFAULT_SCORE, EVIDENCE_KINDS, isExecutable, telemetryFor, CATEGORY_LABEL } from './catalog';
import { evaluateRoute } from './policy';
import type { Category, Device, Diagnosis, Policy, Runbook, Ticket } from './types';
import { hashString, stableStringify, uuid } from './util';

export function findRunbook(runbooks: Runbook[], category: Category): Runbook | undefined {
  return runbooks.filter((r) => r.category === category && isExecutable(r)).sort((a, b) => b.version - a.version)[0];
}
export function findGuidance(runbooks: Runbook[], category: Category): Runbook | undefined {
  return runbooks.filter((r) => r.category === category && r.status === 'APPROVED' && !isExecutable(r)).sort((a, b) => b.version - a.version)[0];
}

export function planHashOf(p: { deviceId: string; revision: number; runbookId?: string; runbookVersion?: number; risk: string; policyVersion: number; category: Category }) {
  return hashString(stableStringify(p));
}

/** Deterministic simulated diagnosis from scenario category + current telemetry (Spec §5). Never random. */
export function computeDiagnosis(ticket: Ticket, device: Device, runbooks: Runbook[], policy: Policy, revision: number, nowIso: string): Diagnosis {
  let category = ticket.category;
  const evidence: string[] = [];
  const uncertainty: string[] = [];
  let reclassified = false;
  // Agent-supplied diagnostics: only scenario-supported evidence that telemetry confirms can change the plan.
  const confirmed = new Set<Category>();
  for (const e of ticket.addedEvidence) {
    const def = EVIDENCE_KINDS.find((k) => k.kind === e.kind);
    if (!def?.category || def.category === 'CRASH') {
      uncertainty.push(`Agent observation recorded ("${e.note.slice(0, 80)}") — not machine-verifiable, remains uncertain`);
      continue;
    }
    const tf = telemetryFor(def.category, device);
    if (tf.consistent) { confirmed.add(def.category); evidence.push(`Agent-supplied ${def.label.toLowerCase()} confirmed by telemetry: ${tf.evidence[0]}`); }
    else uncertainty.push(`Agent-supplied ${def.label.toLowerCase()} not confirmed by current telemetry (${tf.evidence[0]})`);
  }
  if ((category === 'CRASH' || category === 'UNKNOWN') && confirmed.size === 1) {
    category = [...confirmed][0];
    reclassified = true;
  }
  const def = DEFAULT_SCORE[category];
  const tf = telemetryFor(category, device);
  let confidence = def.score;
  if (!tf.consistent) confidence = 65;
  else if (reclassified) confidence = def.score - 3;
  evidence.unshift(...tf.evidence);
  if (reclassified) evidence.unshift(`Re-classified ${CATEGORY_LABEL[ticket.category]} → ${CATEGORY_LABEL[category]} from validated agent evidence`);
  uncertainty.unshift(...tf.uncertainty);
  if (confirmed.size > 1) uncertainty.push('Multiple conflicting evidence categories confirmed — classification left unchanged');
  evidence.push(`Device ${device.name}: ${device.os} ${device.osVersion}, ${device.group} group, ${device.managed ? 'managed' : 'UNMANAGED'}, management channel ${device.online ? 'online' : 'offline'}${device.busy ? ', employee busy' : ''}`);
  const runbook = findRunbook(runbooks, category);
  let risk = runbook ? runbook.risk : def.risk;
  if (device.group === 'Critical' && runbook?.disruptive) { risk = 'HIGH'; evidence.push('Critical device group + disruptive action ⇒ HIGH risk'); }
  const osSupported = runbook ? runbook.supportedOS.includes(device.os) : true;
  if (!runbook) uncertainty.push(findGuidance(runbooks, category) ? 'Only diagnostic-only guidance is published for this category' : 'No approved executable runbook for this category');
  uncertainty.push('Score is simulated and deterministic — not a calibrated probability');
  const gate = evaluateRoute({ confidence, risk, runbook, device, policy, approvalValid: false, consentValid: false, now: Date.parse(nowIso) });
  return {
    id: uuid(), ticketId: ticket.id, revision, category, confidence, risk, evidence, uncertainty,
    runbookId: runbook?.id, runbookVersion: runbook?.version,
    planHash: planHashOf({ deviceId: device.id, revision, runbookId: runbook?.id, runbookVersion: runbook?.version, risk, policyVersion: policy.version, category }),
    policyVersion: policy.version, createdAt: nowIso, recommendedRoute: gate.route, reasons: gate.reasons, osSupported, telemetryConsistent: tf.consistent,
  };
}

/** Immutable intake eligibility (Spec §9) — uses default approval threshold 80 regardless of later policy changes. */
export function intakeEligibility(device: Device, runbook: Runbook | undefined, confidence: number, policy: Policy): { eligible: boolean; reason: string } {
  if (!device.managed) return { eligible: false, reason: 'Unmanaged device' };
  if (!policy.allowedGroups.includes(device.group)) return { eligible: false, reason: `Group ${device.group} not allowed` };
  if (!runbook) return { eligible: false, reason: 'No approved executable runbook' };
  if (!runbook.supportedOS.includes(device.os)) return { eligible: false, reason: `Unsupported OS ${device.os}` };
  if (confidence < 80) return { eligible: false, reason: `Score ${confidence} < 80 at intake` };
  return { eligible: true, reason: `Managed ${device.os} ${device.group} device, ${runbook.id} v${runbook.version}, score ${confidence}` };
}
