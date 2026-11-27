import type { ScenarioKey } from './types';

/**
 * One small, curated example per path through the system — happy and unhappy.
 * The seed creates a real ticket for every example that has `seeded: true` (by driving the actual
 * domain actions), and the "How it works" page links to it. Keeping one ticket per path keeps every
 * dashboard number explainable in a demo.
 */
export type ExampleGroup = 'Fixed automatically or with one approval' | 'Stopped before any change' | 'Needs human judgement' | 'Something went wrong after a change';
export interface ExampleDef {
  key: string; group: ExampleGroup; title: string;
  situation: string; system: string; outcome: string;
  seeded: boolean; tryIt?: { scenario?: ScenarioKey; how: string };
}

export const EXAMPLES: ExampleDef[] = [
  // ---- Happy paths ----
  { key: 'auto-fix', group: 'Fixed automatically or with one approval', title: 'Low-risk fix runs by policy', seeded: true,
    situation: 'Laptop low on disk space, found by proactive detection.', system: 'LOW risk, score 98, runbook trusted at maturity L4 and policy preapproval on → no human needed. Preflight passes, cache is cleared, free space is re-measured.',
    outcome: 'Verified, then auto-closed. Authorization recorded as the policy version.', tryIt: { scenario: 'A', how: 'Admin → Policies → enable preapproval, then load scenario A' } },
  { key: 'approved-fix', group: 'Fixed automatically or with one approval', title: 'One-click agent approval', seeded: true,
    situation: 'Employee reports internal sites not resolving (DNS).', system: 'Runbook is trusted only for supervised use (L2), so an agent reviews the evidence and clicks Approve & execute.',
    outcome: 'Verified, closed. Approval is bound to this plan and expires in 60 min if unused.', tryIt: { scenario: 'A', how: 'Load scenario A and click Approve & execute' } },
  { key: 'consent-fix', group: 'Fixed automatically or with one approval', title: 'Disruptive fix with employee consent', seeded: true,
    situation: 'Wi-Fi keeps dropping; the fix briefly disconnects the employee.', system: 'MEDIUM risk → agent approves; disruptive → the employee is asked and chooses Proceed now (or a later time).',
    outcome: 'Verified, closed. Consent is never inferred from the agent approval.', tryIt: { scenario: 'B', how: 'Load scenario B → approve → employee view: Proceed now' } },
  { key: 'step-approval', group: 'Fixed automatically or with one approval', title: 'High-risk step needs its own approval', seeded: false,
    situation: 'OS patch with a restart (HIGH risk).', system: 'Admin approves the plan and a maintenance window, employee consents; read-only steps run, then the install step pauses for an explicit admin step approval.',
    outcome: 'Runs only after the step approval and a fresh preflight; otherwise nothing changes.', tryIt: { scenario: 'I', how: 'Open scenario I (already paused) and approve the step as Admin' } },
  // ---- Stopped before any change ----
  { key: 'unsupported-os', group: 'Stopped before any change', title: 'Unsupported device', seeded: true,
    situation: 'Low disk space on a macOS laptop.', system: 'The runbook only supports Windows 11 → hard blocker; no approval can override it.',
    outcome: 'Escalated and fixed manually by an agent.' },
  { key: 'critical-blocked', group: 'Stopped before any change', title: 'Device group not allowed by policy', seeded: true,
    situation: 'DNS failure on a Critical-group device.', system: 'Policy only allows the Standard group → escalated; the plan is shown but cannot be approved.',
    outcome: 'Waiting for a human (still open).' },
  { key: 'offline', group: 'Stopped before any change', title: 'Device offline', seeded: false,
    situation: 'Employee at home, management channel unreachable.', system: 'Route = Waiting for device. Reconnecting re-evaluates every gate from scratch.',
    outcome: 'Nothing runs while offline.', tryIt: { scenario: 'F', how: 'Load scenario F → Simulate device reconnect' } },
  { key: 'battery', group: 'Stopped before any change', title: 'Preflight fails (low battery / busy)', seeded: false,
    situation: 'Battery at 12% or the employee is presenting.', system: 'Preflight check fails or is pending → execution blocked; re-checked immediately before every device change.',
    outcome: 'Waits; resumes automatically once the check passes.', tryIt: { scenario: 'B', how: 'Load scenario B → Drain battery → approve → grant consent' } },
  { key: 'consent-declined', group: 'Stopped before any change', title: 'Employee declines', seeded: true,
    situation: 'A restart is needed but the employee says no.', system: 'Approved by the agent, but the employee declines → escalated; the approval is cancelled.',
    outcome: 'Agent arranges the restart with the employee and resolves manually.' },
  { key: 'approval-expired', group: 'Stopped before any change', title: 'Approval expires before it can run', seeded: true,
    situation: 'Agent approves while the employee is busy; it stays busy for over an hour.', system: 'Approvals expire after 60 min if unused → back to Awaiting approval. A fresh approval is needed.',
    outcome: 'Re-approved later, then verified and closed.' },
  { key: 'paused', group: 'Stopped before any change', title: 'Automation paused mid-run', seeded: false,
    situation: 'Admin hits the master pause during an incident freeze.', system: 'New starts stop; an in-flight run stops before its next device change (already-applied changes still verify / roll back).',
    outcome: 'No change made; ticket goes to review.', tryIt: { how: 'Approve scenario A, then Admin → Policies → Master pause' } },
  // ---- Human judgement ----
  { key: 'low-confidence', group: 'Needs human judgement', title: 'Evidence does not match', seeded: true,
    situation: 'User reports low disk, but telemetry shows 40 GB free.', system: 'Telemetry contradicts the report → score drops to 65 (below the approval threshold of 80) → review, no execution.',
    outcome: 'Agent investigates (still open).' },
  { key: 'unknown-open', group: 'Needs human judgement', title: 'Unknown problem', seeded: true,
    situation: '“Laptop making clicking noise”.', system: 'No matching pattern, score 42 → escalated; nothing to execute.',
    outcome: 'Investigated by a human (still open).', tryIt: { scenario: 'G', how: 'Load scenario G' } },
  { key: 'rejected', group: 'Needs human judgement', title: 'Agent rejects the plan', seeded: true,
    situation: 'App update during a release freeze.', system: 'Agent clicks Reject with a reason → escalated; nothing runs.',
    outcome: 'Updated manually after the freeze.' },
  { key: 'manual-new-runbook', group: 'Needs human judgement', title: 'Manual fix becomes a draft runbook', seeded: true,
    situation: 'App crash with no runbook.', system: 'Agent resolves it manually with a note and evidence, then proposes a draft runbook. The draft cannot run until an admin reviews and publishes it.',
    outcome: 'Closed; draft waiting in the Library.', tryIt: { scenario: 'E', how: 'Load scenario E → Resolve manually → Propose runbook draft' } },
  { key: 'shared-outage', group: 'Needs human judgement', title: 'Many people, one cause', seeded: false,
    situation: 'Three people on the same office network report Wi-Fi drops within minutes.', system: 'Correlation flags a likely shared cause; the agent links them to one parent incident and individual laptop fixes are paused.',
    outcome: 'Each child closes only after its own recovery check.', tryIt: { scenario: 'J', how: 'Click the shared-incident banner on the Overview' } },
  // ---- Failures after a change ----
  { key: 'exec-fail', group: 'Something went wrong after a change', title: 'Fails before changing anything', seeded: true,
    situation: 'Automated cleanup starts but its first check errors.', system: 'Failure happens before the action step → no device change, nothing to roll back → escalated.',
    outcome: 'Fixed manually.' },
  { key: 'verify-fail-rollback', group: 'Something went wrong after a change', title: 'Fix applied but verification fails → rollback', seeded: true,
    situation: 'Wi-Fi adapter reset completes but connectivity is still down.', system: 'Ticket is NOT resolved. One-click rollback restores only the fields that run changed, then escalates.',
    outcome: 'Fixed manually (driver replaced).', tryIt: { scenario: 'D', how: 'Load scenario D → approve → consent → Roll back now' } },
  { key: 'rollback-fail', group: 'Something went wrong after a change', title: 'Rollback itself fails', seeded: true,
    situation: 'App update breaks the app and the restore also fails.', system: 'Escalated with manual recovery instructions (which values to restore).',
    outcome: 'Agent restores the previous version manually.', tryIt: { scenario: 'H', how: 'Load scenario H → approve → consent → Roll back now' } },
  { key: 'reopened', group: 'Something went wrong after a change', title: 'Fixed, then the problem comes back', seeded: true,
    situation: 'Disk fills up again two hours after an automated cleanup.', system: 'Employee reopens → verified flag cleared, history kept → re-diagnosis now sees healthy telemetry and asks for review.',
    outcome: 'Root cause handled manually (large sync folder moved).' },
];
export const EXAMPLE_GROUPS: ExampleGroup[] = ['Fixed automatically or with one approval', 'Stopped before any change', 'Needs human judgement', 'Something went wrong after a change'];
