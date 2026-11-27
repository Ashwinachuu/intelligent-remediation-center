import type { AppState, Knowledge, Runbook, Ticket } from './types';

const STOP = new Set(['the', 'and', 'for', 'with', 'when', 'from', 'that', 'this', 'not', 'are', 'was', 'have', 'has', 'into', 'issue', 'problem', 'laptop', 'keeps', 'after', 'only', 'very', 'cannot', 'can', 'any', 'all', 'my', 'our', 'your', 'its', 'every', 'hour', 'hourly', 'day', 'daily', 'time', 'times', 'minute', 'keep', 'again', 'still', 'getting', 'some', 'about']);
const stem = (w: string) => w.replace(/(ing|ers|er|ed|es|s)$/, '');
/** Normalized significant words, used for deterministic similarity. */
export function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
}
export function overlap(a: Set<string>, b: Set<string>) { let n = 0; for (const x of a) if (b.has(x)) n++; return n; }

/**
 * Retrieve a VALIDATED reusable resolution for a ticket (V1.2 §16). Unvalidated knowledge is never used.
 * Match: same employee issue type AND at least one meaningful shared word with the issue pattern/title.
 */
export function matchKnowledge(s: AppState, t: Pick<Ticket, 'title' | 'description' | 'issueType'>): Knowledge | undefined {
  const tw = words(`${t.title} ${t.description}`);
  let best: { k: Knowledge; score: number } | undefined;
  for (const k of s.knowledge) {
    if (k.status !== 'VALIDATED') continue;
    const n = overlap(tw, words(`${k.pattern} ${k.title}`));
    const ok = k.issueType === t.issueType && n >= 1;
    if (ok && (!best || n > best.score)) best = { k, score: n };
  }
  return best?.k;
}

/** An admin-validated resolution becomes an executable (simulated) plan — still subject to approval like any other. */
export function runbookFromKnowledge(k: Knowledge): Runbook {
  const steps = (k.adminSteps.length ? k.adminSteps : ['Apply the validated resolution steps']).map((description, i) => ({ id: `S${i + 1}`, description }));
  while (steps.length < 3) steps.push({ id: `S${steps.length + 1}`, description: steps.length === 1 ? 'Apply resolution' : 'Confirm the expected outcome' });
  return {
    id: `KB-${k.id.replace(/\D/g, '')}`, version: 1, title: `Validated resolution: ${k.title}`, category: k.category, status: 'APPROVED', risk: 'LOW', supportedOS: ['Windows 11', 'macOS'],
    steps, checks: [k.verification], rollbackSteps: k.rollback ? [k.rollback] : [], reversible: false, disruptive: false, restartRequired: false, expectedMin: 10,
    rootCause: k.pattern, employeeImpact: 'Minimal', expectedOutcome: k.expectedOutcome, recoveryNote: k.rollback || 'Manual recovery by IT if needed', actionKey: 'KNOWLEDGE', knowledgeId: k.id,
  };
}
