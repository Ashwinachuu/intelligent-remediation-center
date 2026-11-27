import type { Status } from './types';

export type ErrorCode = 'ILLEGAL_TRANSITION' | 'UNAUTHORIZED' | 'BLOCKED' | 'VALIDATION' | 'NOT_FOUND' | 'DUPLICATE' | 'RETRY_LIMIT' | 'CONFLICT' | 'EXPIRED';
export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); this.name = 'DomainError'; }
}

const GATE: Status[] = ['AWAITING_APPROVAL', 'AWAITING_CONSENT', 'WAITING_DEVICE', 'SCHEDULED', 'READY', 'REVIEW_REQUIRED', 'ESCALATED', 'DIAGNOSING'];
/** Central transition table (Spec §7). Anything not listed is illegal. */
export const TRANSITIONS: Record<Status, Status[]> = {
  OPEN: ['DIAGNOSING', 'ESCALATED'],
  REOPENED: ['DIAGNOSING', 'ESCALATED'],
  DIAGNOSING: ['REVIEW_REQUIRED', 'AWAITING_APPROVAL', 'AWAITING_CONSENT', 'WAITING_DEVICE', 'SCHEDULED', 'READY', 'ESCALATED'],
  REVIEW_REQUIRED: ['DIAGNOSING', 'ESCALATED', 'RESOLVED'],
  AWAITING_APPROVAL: GATE.filter((s) => s !== 'AWAITING_APPROVAL'),
  AWAITING_CONSENT: GATE.filter((s) => s !== 'AWAITING_CONSENT'),
  WAITING_DEVICE: GATE.filter((s) => s !== 'WAITING_DEVICE'),
  SCHEDULED: GATE.filter((s) => s !== 'SCHEDULED'),
  READY: [...GATE.filter((s) => s !== 'READY'), 'EXECUTING'],
  EXECUTING: ['VERIFYING', 'ROLLBACK_AVAILABLE', 'ESCALATED', 'AWAITING_APPROVAL', 'REVIEW_REQUIRED', 'WAITING_DEVICE', 'AWAITING_CONSENT', 'STEP_APPROVAL'],
  STEP_APPROVAL: ['EXECUTING', 'ESCALATED', 'DIAGNOSING', 'REVIEW_REQUIRED', 'WAITING_DEVICE', 'AWAITING_APPROVAL'],
  VERIFYING: ['RESOLVED', 'ROLLBACK_AVAILABLE', 'ESCALATED'],
  ROLLBACK_AVAILABLE: ['ROLLING_BACK', 'ESCALATED'],
  ROLLING_BACK: ['ESCALATED'],
  RESOLVED: ['CLOSED', 'ROLLING_BACK', 'REOPENED'],
  CLOSED: ['ROLLING_BACK', 'REOPENED'],
  ESCALATED: ['RESOLVED'],
};
export const canTransition = (from: Status, to: Status) => TRANSITIONS[from].includes(to);
export function assertTransition(from: Status, to: Status) {
  if (!canTransition(from, to)) throw new DomainError('ILLEGAL_TRANSITION', `Illegal transition ${from} → ${to}`);
}

export const GATE_STATES: Status[] = ['AWAITING_APPROVAL', 'AWAITING_CONSENT', 'WAITING_DEVICE', 'SCHEDULED', 'READY'];
export const RUNNING_STATES: Status[] = ['EXECUTING', 'VERIFYING', 'ROLLING_BACK'];
export const ESCALATABLE: Status[] = ['OPEN', 'REOPENED', 'REVIEW_REQUIRED', 'AWAITING_APPROVAL', 'AWAITING_CONSENT', 'WAITING_DEVICE', 'SCHEDULED', 'READY', 'ROLLBACK_AVAILABLE', 'STEP_APPROVAL'];

export const STATUS_LABEL: Record<Status, string> = {
  OPEN: 'Open', DIAGNOSING: 'Diagnosing', REVIEW_REQUIRED: 'Review required', AWAITING_APPROVAL: 'Awaiting approval',
  AWAITING_CONSENT: 'Awaiting consent', WAITING_DEVICE: 'Waiting for device', SCHEDULED: 'Scheduled', READY: 'Ready',
  EXECUTING: 'Executing', VERIFYING: 'Verifying', ROLLBACK_AVAILABLE: 'Rollback available', ROLLING_BACK: 'Rolling back',
  ESCALATED: 'Escalated', RESOLVED: 'Resolved', CLOSED: 'Closed', REOPENED: 'Reopened', STEP_APPROVAL: 'Awaiting step approval',
};
