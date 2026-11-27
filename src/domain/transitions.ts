import type { Status } from './types';

export type ErrorCode = 'ILLEGAL_TRANSITION' | 'UNAUTHORIZED' | 'BLOCKED' | 'VALIDATION' | 'NOT_FOUND' | 'DUPLICATE' | 'RETRY_LIMIT' | 'CONFLICT' | 'EXPIRED';
export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); this.name = 'DomainError'; }
}

const GATE: Status[] = ['AWAITING_APPROVAL', 'AWAITING_CONSENT', 'WAITING_DEVICE', 'READY', 'REVIEW_REQUIRED', 'ESCALATED', 'DIAGNOSING'];
/** Central internal transition table. Anything not listed is illegal. */
export const TRANSITIONS: Record<Status, Status[]> = {
  OPEN: ['SELF_SERVICE', 'DIAGNOSING', 'ESCALATED'],
  SELF_SERVICE: ['DIAGNOSING', 'CLOSED'],
  REOPENED: ['DIAGNOSING', 'ESCALATED', 'RESOLVED'],
  DIAGNOSING: ['REVIEW_REQUIRED', 'AWAITING_APPROVAL', 'AWAITING_CONSENT', 'WAITING_DEVICE', 'READY', 'ESCALATED'],
  REVIEW_REQUIRED: ['DIAGNOSING', 'ESCALATED', 'RESOLVED'],
  AWAITING_APPROVAL: GATE.filter((s) => s !== 'AWAITING_APPROVAL'),
  AWAITING_CONSENT: GATE.filter((s) => s !== 'AWAITING_CONSENT'),
  WAITING_DEVICE: GATE.filter((s) => s !== 'WAITING_DEVICE'),
  READY: [...GATE.filter((s) => s !== 'READY'), 'EXECUTING'],
  EXECUTING: ['VERIFYING', 'ROLLBACK_AVAILABLE', 'ESCALATED', 'AWAITING_APPROVAL', 'WAITING_DEVICE', 'REVIEW_REQUIRED'],
  VERIFYING: ['RESOLVED', 'ROLLBACK_AVAILABLE', 'ESCALATED'],
  ROLLBACK_AVAILABLE: ['ROLLING_BACK', 'ESCALATED'],
  ROLLING_BACK: ['ESCALATED'],
  RESOLVED: ['CLOSED', 'ROLLING_BACK', 'REOPENED'],
  CLOSED: ['ROLLING_BACK', 'REOPENED'],
  ESCALATED: ['RESOLVED', 'DIAGNOSING'],
};
export const canTransition = (from: Status, to: Status) => TRANSITIONS[from].includes(to);
export function assertTransition(from: Status, to: Status) {
  if (!canTransition(from, to)) throw new DomainError('ILLEGAL_TRANSITION', `Illegal transition ${from} → ${to}`);
}
export const GATE_STATES: Status[] = ['AWAITING_APPROVAL', 'AWAITING_CONSENT', 'WAITING_DEVICE', 'READY'];
export const RUNNING_STATES: Status[] = ['EXECUTING', 'VERIFYING', 'ROLLING_BACK'];
