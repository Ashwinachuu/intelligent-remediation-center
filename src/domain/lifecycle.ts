import type { AppState, ApprovalStatus, Path, ProductStatus, Ticket } from './types';

/**
 * The simplified product lifecycle (V1.2 §12), derived from the internal engine state so incident status,
 * approval status and resolution method stay synchronized everywhere.
 */
export function productStatus(t: Ticket): ProductStatus {
  switch (t.status) {
    case 'OPEN': case 'DIAGNOSING': return 'OPEN';
    case 'SELF_SERVICE': return 'SELF_SERVICE';
    case 'AWAITING_APPROVAL': return 'REVIEW_NEEDED';
    case 'AWAITING_CONSENT': case 'WAITING_DEVICE': case 'READY': case 'EXECUTING': case 'VERIFYING': case 'ROLLING_BACK': case 'RESOLVED': return 'REMEDIATION';
    case 'ROLLBACK_AVAILABLE': return 'MANUAL';
    case 'REVIEW_REQUIRED': case 'ESCALATED': return t.investigation ? 'MANUAL' : 'UNSUPPORTED';
    case 'CLOSED': return 'CLOSED';
    case 'REOPENED': return 'REOPENED';
  }
}
export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  OPEN: 'Open', SELF_SERVICE: 'Self-service in progress', REVIEW_NEEDED: 'Review needed', REMEDIATION: 'Remediation in progress',
  UNSUPPORTED: 'New / Unsupported', MANUAL: 'Manual investigation', CLOSED: 'Closed', REOPENED: 'Reopened',
};
export const PRODUCT_STATUSES = Object.keys(PRODUCT_STATUS_LABEL) as ProductStatus[];

export function approvalStatus(s: AppState, t: Ticket): ApprovalStatus {
  if (t.status === 'AWAITING_APPROVAL') return 'PENDING';
  if (t.status === 'REOPENED' || t.status === 'SELF_SERVICE' || t.status === 'OPEN') return 'NOT_REQUIRED';
  const mine = s.approvals.filter((a) => a.ticketId === t.id).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = mine[mine.length - 1];
  if (!last) return 'NOT_REQUIRED';
  if (last.decision === 'REJECT') return 'REJECTED';
  if (last.invalidatedAt || last.expiredLoggedAt) return 'EXPIRED';
  return 'APPROVED';
}
export const APPROVAL_LABEL: Record<ApprovalStatus, string> = { NOT_REQUIRED: 'Not required', PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', EXPIRED: 'Expired / invalidated' };
export const METHOD_LABEL: Record<Path, string> = { SELF_SERVICE: 'Employee self-service', HUMAN_APPROVED: 'Human-approved AI remediation', MANUAL: 'Manual resolution' };

/** Employee-friendly status (V1.2 §7). */
export function employeeStatus(t: Ticket): string {
  if (t.status === 'AWAITING_CONSENT') return 'Fix in progress — your OK is needed';
  switch (productStatus(t)) {
    case 'SELF_SERVICE': return 'Troubleshooting in progress';
    case 'MANUAL': return 'IT reviewing your issue';
    case 'REMEDIATION': return 'Fix in progress';
    case 'CLOSED': return 'Resolved';
    default: return 'Sent to IT support';
  }
}
export const isClosedVerified = (t: Ticket) => t.status === 'CLOSED' && t.verified;

/** Readable labels for internal engine states (used in the audit trail). */
export const INTERNAL_LABEL: Record<string, string> = {
  OPEN: 'Open', SELF_SERVICE: 'Self-service', DIAGNOSING: 'AI diagnosing', REVIEW_REQUIRED: 'Unsupported / review', AWAITING_APPROVAL: 'Review needed',
  AWAITING_CONSENT: 'Awaiting employee consent', WAITING_DEVICE: 'Waiting for prerequisites', READY: 'Ready', EXECUTING: 'Executing', VERIFYING: 'Verifying',
  ROLLBACK_AVAILABLE: 'Failed — rollback available', ROLLING_BACK: 'Rolling back', ESCALATED: 'Manual investigation', RESOLVED: 'Resolved', CLOSED: 'Closed', REOPENED: 'Reopened',
};
