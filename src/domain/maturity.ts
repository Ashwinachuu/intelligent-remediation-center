import { MATURITY_LABEL, isExecutable } from './catalog';
import type { AppState, Maturity, Runbook } from './types';

export interface Criterion { label: string; met: boolean; detail: string }
const COMPLETED = ['PASSED', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'];

/** Verified execution record for a runbook id (all versions), derived from execution data. */
export function runbookRecord(s: AppState, id: string, version?: number) {
  const ex = s.executions.filter((e) => e.runbookId === id && (version === undefined || e.version === version) && COMPLETED.includes(e.phase));
  return {
    completed: ex.length,
    passed: ex.filter((e) => e.verificationPassed).length,
    failed: ex.filter((e) => !e.verificationPassed).length,
    rolledBack: ex.filter((e) => e.phase === 'ROLLED_BACK').length,
    rollbackFailed: ex.filter((e) => e.phase === 'ROLLBACK_FAILED').length,
  };
}

/** Documented eligibility criteria for promotion to a maturity level (enhancement §10). */
export function maturityCriteria(s: AppState, rb: Runbook, to: Maturity): Criterion[] {
  const r = runbookRecord(s, rb.id);
  const rate = r.completed ? r.passed / r.completed : 0;
  const base: Criterion[] = [
    { label: 'Published and validated by an administrator', met: rb.status === 'APPROVED' && !!rb.reviewedBy, detail: rb.reviewedBy ? `Reviewed by ${rb.reviewedBy}` : 'Not reviewed' },
    { label: 'Executable catalog action (not guidance-only)', met: isExecutable({ ...rb, maturity: Math.max(rb.maturity, 2) as Maturity }), detail: rb.actionKey ? `Simulator action ${rb.actionKey}` : 'Diagnostic-only guidance' },
  ];
  if (to <= 2) return base;
  const l3: Criterion[] = [
    ...base,
    { label: 'LOW risk and non-disruptive', met: rb.risk === 'LOW' && !rb.disruptive, detail: `${rb.risk} risk, ${rb.disruptive ? 'disruptive' : 'non-disruptive'}` },
    { label: '≥ 3 supervised executions completed', met: r.completed >= 3, detail: `${r.completed} completed` },
    { label: '≥ 95% verified success', met: r.completed > 0 && rate >= 0.95, detail: r.completed ? `${(rate * 100).toFixed(1)}% (${r.passed}/${r.completed})` : 'No data' },
    { label: 'No rollback failures', met: r.rollbackFailed === 0, detail: `${r.rollbackFailed} rollback failures` },
  ];
  if (to === 3) return l3;
  return [
    ...l3,
    { label: 'Currently at L3 (policy-based)', met: rb.maturity >= 3, detail: MATURITY_LABEL[rb.maturity] },
    { label: '≥ 5 executions with ≥ 97% verified success', met: r.completed >= 5 && rate >= 0.97, detail: `${r.completed} completed, ${(rate * 100).toFixed(1)}%` },
  ];
}

export type LifecycleStage = 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'SUPERVISED' | 'ELIGIBLE' | 'AUTOMATED' | 'RETIRED';
export const LIFECYCLE: { key: LifecycleStage; label: string }[] = [
  { key: 'DRAFT', label: 'Draft' }, { key: 'UNDER_REVIEW', label: 'Under review' }, { key: 'APPROVED', label: 'Approved' },
  { key: 'SUPERVISED', label: 'Supervised execution' }, { key: 'ELIGIBLE', label: 'Eligible for policy-based automation' },
];
export function lifecycleStage(s: AppState, rb: Runbook): LifecycleStage {
  if (rb.status === 'RETIRED') return 'RETIRED';
  if (rb.status === 'DRAFT') return 'DRAFT';
  if (rb.status === 'UNDER_REVIEW') return 'UNDER_REVIEW';
  if (rb.maturity >= 3) return 'AUTOMATED';
  if (!isExecutable(rb)) return 'APPROVED';
  if (maturityCriteria(s, rb, 3).every((c) => c.met)) return 'ELIGIBLE';
  return runbookRecord(s, rb.id, rb.version).completed > 0 ? 'SUPERVISED' : 'APPROVED';
}
