import { DEFAULT_SCORE, isExecutable, telemetryFor } from './catalog';
import { matchKnowledge } from './knowledge';
import type { AppState, Category, Device, Diagnosis, Runbook, Settings, Ticket } from './types';
import { hashString, stableStringify, uuid } from './util';

export function findRunbook(runbooks: Runbook[], category: Category): Runbook | undefined {
  return runbooks.filter((r) => r.category === category && !r.knowledgeId && isExecutable(r)).sort((a, b) => b.version - a.version)[0];
}
export function planHashOf(p: { ticketId: string; deviceId: string; revision: number; runbookId?: string; runbookVersion?: number; threshold: number }) {
  return hashString(stableStringify(p));
}

/**
 * Deterministic simulated AI diagnosis (not a calibrated model). Inputs: reported category, current
 * telemetry, the employee's troubleshooting answers and any validated reusable resolution.
 */
export function computeDiagnosis(s: AppState, t: Ticket, device: Device, settings: Settings, revision: number, nowIso: string): Diagnosis {
  const ts = t.troubleshooting;
  const evidence: string[] = [];
  const uncertainty: string[] = ['Confidence is simulated and deterministic — not a calibrated production probability'];
  const k = matchKnowledge(s, t);
  let runbook: Runbook | undefined;
  let confidence: number;
  let rootCause: string;
  let telemetry: Diagnosis['telemetry'];
  if (k) {
    runbook = s.runbooks.find((r) => r.knowledgeId === k.id && r.status === 'APPROVED');
    confidence = 85;
    rootCause = k.pattern;
    evidence.push(`Matches validated resolution ${k.id} “${k.title}” (validated by ${k.validatedBy})`);
  } else {
    runbook = findRunbook(s.runbooks, t.category);
    const tf = telemetryFor(t.category, device);
    confidence = DEFAULT_SCORE[t.category];
    rootCause = runbook?.rootCause ?? 'Unknown — no known pattern matches this issue';
    evidence.push(tf.evidence);
    telemetry = { text: tf.evidence, consistent: tf.consistent };
    if (!tf.consistent) { confidence = 65; uncertainty.push('Telemetry does not confirm the reported problem'); }
  }
  if (ts.signals.includes('NETWORK_WIDE')) {
    confidence = Math.min(confidence, 55);
    rootCause = 'Likely a network-side problem (other devices are affected) — a laptop fix is not appropriate';
    uncertainty.push('Employee reports other devices are also affected');
  }
  if (ts.signals.includes('ONE_APP') && t.category === 'SERVICE') { confidence = Math.min(confidence, 75); uncertainty.push('Only one application is slow — may be app-specific'); }
  const unsure = ts.entries.filter((e) => e.answer === 'NOT_SURE').length;
  if (unsure >= 2) { confidence -= 5 * unsure; uncertainty.push(`${unsure} “not sure” answers reduce certainty`); }
  if (ts.entries.length) evidence.push(`Employee already tried: ${ts.entries.filter((e) => e.kind === 'STEP').map((e) => e.text.replace(/\.$/, '')).join('; ') || 'answered diagnostic questions only'}`);
  for (const f of ts.findings.slice(0, 4)) evidence.push(`Employee answer: ${f}`);
  evidence.push(`Device ${device.name}: ${device.os} ${device.osVersion}, ${device.managed ? 'managed' : 'unmanaged'}, ${device.online ? 'online' : 'offline'}`);
  if (!runbook) uncertainty.push('No approved fix or validated resolution exists for this issue yet');
  confidence = Math.max(0, Math.min(99, confidence));
  const recommendable = !!runbook && confidence >= settings.confidenceThreshold && device.managed && runbook.supportedOS.includes(device.os) && device.group === 'Standard';
  return {
    id: uuid(), ticketId: t.id, revision, category: t.category, confidence, risk: runbook?.risk ?? 'HIGH', rootCause, evidence, uncertainty,
    runbookId: runbook?.id, runbookVersion: runbook?.version, knowledgeId: k?.id,
    planHash: planHashOf({ ticketId: t.id, deviceId: device.id, revision, runbookId: runbook?.id, runbookVersion: runbook?.version, threshold: settings.confidenceThreshold }),
    settingsVersion: settings.version, createdAt: nowIso, recommendable, reasons: [], telemetry,
    match: k ? { kind: 'KNOWLEDGE', id: k.id, title: k.title } : runbook ? { kind: 'RUNBOOK', id: runbook.id, title: runbook.title } : { kind: 'NONE' },
  };
}
