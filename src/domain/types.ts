// V1.2 domain model. Two user roles; AI is the intelligence layer, not a role.
export type Role = 'EMPLOYEE' | 'ADMIN';
export type ActorRole = Role | 'SYSTEM';
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Internal engine state (fine-grained, used for safe execution). Every screen shows the
 * simplified product status from `lifecycle.ts` instead.
 */
export type Status =
  | 'OPEN' | 'SELF_SERVICE' | 'DIAGNOSING' | 'REVIEW_REQUIRED' | 'AWAITING_APPROVAL' | 'AWAITING_CONSENT'
  | 'WAITING_DEVICE' | 'READY' | 'EXECUTING' | 'VERIFYING' | 'ROLLBACK_AVAILABLE' | 'ROLLING_BACK'
  | 'ESCALATED' | 'RESOLVED' | 'CLOSED' | 'REOPENED';

/** Product lifecycle (V1.2 §12). */
export type ProductStatus = 'OPEN' | 'SELF_SERVICE' | 'REVIEW_NEEDED' | 'REMEDIATION' | 'UNSUPPORTED' | 'MANUAL' | 'CLOSED' | 'REOPENED';
export type ApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
/** Resolution method for closed incidents. */
export type Path = 'SELF_SERVICE' | 'HUMAN_APPROVED' | 'MANUAL';

export type Category = 'STORAGE' | 'DNS' | 'SERVICE' | 'WIFI' | 'RESTART' | 'APP_UPDATE' | 'OS_UPDATE' | 'CRASH' | 'UNKNOWN';
/** Employee-facing categories (V1.2 §5). Mapped to an internal category; employees never see technical terms. */
export type IssueType = 'SLOW' | 'WIFI' | 'RESTART' | 'STORAGE' | 'APP_HANG' | 'SOFTWARE_UPDATE' | 'OS_UPDATE' | 'OTHER';
export type Outcome = 'SUCCESS' | 'VERIFY_FAIL' | 'EXEC_FAIL' | 'ROLLBACK_FAIL';

export interface Device {
  id: string; name: string; os: 'Windows 11' | 'macOS'; group: 'Standard' | 'Critical';
  online: boolean; busy: boolean; managed: boolean; freeGB: number; appVersion: string; osVersion: string;
  wifiHealthy: boolean; serviceHealthy: boolean; restartPending: boolean; dnsHealthy: boolean; batteryPct: number;
}

export interface Employee { id: string; name: string; department: string; email: string; deviceName: string; os: Device['os'] }

// ---- Guided troubleshooting (V1.2 §6) ----
export type Answer = 'YES' | 'NO' | 'NOT_SURE' | 'COMPLETED' | 'UNABLE' | 'RESOLVED' | 'PERSISTS' | string;
export interface TroubleshootingEntry { nodeId: string; kind: 'QUESTION' | 'STEP' | 'CHECK'; text: string; answer: Answer; answerLabel: string; at: string; source?: string }
export interface Troubleshooting {
  state: 'ACTIVE' | 'RESOLVED' | 'ESCALATED';
  entries: TroubleshootingEntry[];
  findings: string[];
  failedAttempts: number;
  knowledgeId?: string;
  escalationReason?: string;
  /** Id of the node currently shown to the employee. */
  current?: string;
  /** Diagnostic signals derived from answers (e.g. NETWORK_WIDE) that the AI uses on escalation. */
  signals: string[];
}

export interface Consent { granted: boolean; at: string; expiresAt: string; planHash: string }

export interface Ticket {
  id: string; displayId: string; title: string; description: string; employeeId: string; requester: string; deviceId: string;
  issueType: IssueType; category: Category; priority: 'P2' | 'P3' | 'P4'; status: Status;
  createdAt: string; updatedAt: string; resolvedAt?: string; closedAt?: string; firstClosedAt?: string; slaDueAt: string;
  path?: Path; verified: boolean; reopenedCount: number;
  /** Simulated outcome of an AI remediation for this incident (deterministic, set by the scenario). */
  outcome: Outcome;
  diagnosisId?: string; executionIds: string[]; consent?: Consent;
  troubleshooting: Troubleshooting;
  /** True once AI could not provide a reliable recommendation — kept even after the incident is resolved. */
  everUnsupported: boolean;
  /** Set when a human took the incident over (investigate manually, rejection, failure, declined consent, rollback, reopen). */
  investigation?: { reason: string; at: string; by: string };
  resolution?: { rootCause: string; steps: string; verification: string; by: string; at: string };
  /** Estimated administrator handling minutes actually spent (review, approval, rollback, manual work). */
  adminMin: number;
  scenario?: string;
  demo?: boolean;
}

export interface Diagnosis {
  id: string; ticketId: string; revision: number; category: Category; confidence: number; risk: Risk;
  rootCause: string; evidence: string[]; uncertainty: string[]; runbookId?: string; runbookVersion?: number; knowledgeId?: string;
  planHash: string; settingsVersion: number; createdAt: string; recommendable: boolean; reasons: string[];
  /** What the laptop's health data showed when AI checked it (absent when a validated resolution matched first). */
  telemetry?: { text: string; consistent: boolean };
  /** What AI matched the incident to. */
  match?: { kind: 'KNOWLEDGE' | 'RUNBOOK' | 'NONE'; id?: string; title?: string };
}

export interface RunbookStep { id: string; description: string }
export interface Runbook {
  id: string; version: number; title: string; category: Category; status: 'APPROVED' | 'RETIRED';
  risk: Risk; supportedOS: Device['os'][]; steps: RunbookStep[]; checks: string[]; rollbackSteps: string[];
  reversible: boolean; disruptive: boolean; restartRequired: boolean; expectedMin: number;
  rootCause: string; employeeImpact: string; expectedOutcome: string; recoveryNote: string;
  /** Simulator action key; `KNOWLEDGE` for an admin-validated reusable resolution. */
  actionKey: Category | 'KNOWLEDGE';
  knowledgeId?: string;
}

/** Reusable resolution captured from a manual fix (V1.2 §16). Never used until an administrator validates it. */
export interface Knowledge {
  id: string; title: string; category: Category; issueType: IssueType; pattern: string;
  diagnosticQuestions: string[]; conditions: string; employeeSteps: string[]; adminSteps: string[];
  expectedOutcome: string; verification: string; risks: string; rollback: string;
  status: 'PENDING_VALIDATION' | 'VALIDATED' | 'REJECTED';
  sourceTicketId: string; createdBy: string; createdAt: string; validatedBy?: string; validatedAt?: string;
}

/** AI Settings (V1.2 §17). Human approval and verification are always on and not configurable. */
export interface Settings {
  version: number;
  confidenceThreshold: number;
  troubleshootingAttempts: number;
  consentRequired: boolean;
  approvalTTLMin: number;
  /** Manual handling baselines (minutes) used for "Estimated administrator time saved". */
  baselines: Record<Category, number>;
  reviewEffortMin: number;
  rollbackEffortMin: number;
}

export interface Approval {
  id: string; ticketId: string; planHash: string; settingsVersion: number; actor: string;
  decision: 'APPROVE' | 'REJECT'; reason?: string; at: string; expiresAt: string; diagnosisRevision: number; requestedAt: string;
  deviceId: string; runbookId: string; runbookVersion: number;
  consumedBy?: string; invalidatedAt?: string; invalidReason?: string; expiredLoggedAt?: string;
}

export type ExecPhase = 'RUNNING' | 'VERIFYING' | 'PASSED' | 'FAILED' | 'ROLLING_BACK' | 'ROLLED_BACK' | 'ROLLBACK_FAILED' | 'CANCELLED';
export interface FieldChange { field: keyof Device; before: unknown; after: unknown }
export type CheckStatus = 'PASS' | 'FAIL' | 'PENDING' | 'NA';
export interface PreflightCheck { key: string; label: string; status: CheckStatus; detail: string }

export interface Execution {
  id: string; ticketId: string; planHash: string; runbookId: string; version: number;
  startedAt: string; endedAt?: string; phase: ExecPhase; stepIndex: number; nextAt?: string; snapshot: Device;
  results: string[]; outcome: Outcome; verificationPassed: boolean; rollbackDeadline?: string;
  deviceId: string; diagnosisRevision: number; simOutcome: Outcome; approvalId: string; approvedBy: string;
  changes: FieldChange[]; appliedAt?: string; reversible: boolean; risk: Risk;
  stepMs: number; verifyMs: number; closeMs: number; closurePending?: boolean;
  rollbackStep?: number; rollbackResults: string[]; rollbackBy?: string; rollbackStartedAt?: string; rollbackEndedAt?: string;
  verificationOutput: string[]; cancelReason?: string; preflight: PreflightCheck[];
}

export interface AuditEvent {
  id: string; seq: number; at: string; ticketId?: string; actor: string; role: ActorRole; action: string;
  from?: Status; to?: Status; reason: string; metadata: Record<string, unknown>;
  result: 'SUCCESS' | 'FAILURE' | 'BLOCKED' | 'INFO';
}

export interface AppNotification { id: string; ticketId?: string; recipient: Role; message: string; at: string; read: boolean }

export interface AppState {
  schemaVersion: 6;
  anchor: string;
  seq: { ticket: number; audit: number; knowledge: number; device: number };
  devices: Record<string, Device>;
  tickets: Record<string, Ticket>;
  diagnoses: Diagnosis[];
  runbooks: Runbook[];
  knowledge: Knowledge[];
  settings: Settings;
  settingsHistory: { settings: Settings; reason: string; actor: string; at: string }[];
  approvals: Approval[];
  executions: Execution[];
  audit: AuditEvent[];
  notifications: AppNotification[];
  ui: { role: Role };
}

export interface Actor { name: string; role: ActorRole }
