// Canonical domain model (Spec §4). Enum values are authoritative; UI shows friendly labels.
export type Role = 'AGENT' | 'ADMIN' | 'MANAGER';
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH';
export type Status =
  | 'OPEN' | 'DIAGNOSING' | 'REVIEW_REQUIRED' | 'AWAITING_APPROVAL' | 'AWAITING_CONSENT'
  | 'WAITING_DEVICE' | 'SCHEDULED' | 'READY' | 'EXECUTING' | 'VERIFYING' | 'ROLLBACK_AVAILABLE'
  | 'ROLLING_BACK' | 'ESCALATED' | 'RESOLVED' | 'CLOSED' | 'REOPENED'
  /** Enhancement: execution paused at a step that needs its own authorization. */
  | 'STEP_APPROVAL';
export type Category = 'STORAGE' | 'DNS' | 'SERVICE' | 'WIFI' | 'RESTART' | 'APP_UPDATE' | 'OS_UPDATE' | 'CRASH' | 'UNKNOWN';
export type Outcome = 'SUCCESS' | 'VERIFY_FAIL' | 'EXEC_FAIL' | 'ROLLBACK_FAIL';
export type Path = 'AUTO_POLICY' | 'HUMAN_APPROVED' | 'MANUAL';
export type ActorRole = Role | 'SYSTEM' | 'EMPLOYEE';
export type ScenarioKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';
/** Automation maturity (enhancement §10). L0 manual · L1 recommendation only · L2 human-approved · L3 policy-based · L4 proactive policy-based. */
export type Maturity = 0 | 1 | 2 | 3 | 4;

export interface Device {
  id: string; name: string; os: 'Windows 11' | 'macOS'; group: 'Standard' | 'Critical';
  online: boolean; busy: boolean; managed: boolean; freeGB: number; appVersion: string; osVersion: string;
  wifiHealthy: boolean; serviceHealthy: boolean; restartPending: boolean; dnsHealthy: boolean;
  // ---- enhancement fields ----
  batteryPct: number; location: string; networkId: string; kind?: 'ENDPOINT' | 'NETWORK_SEGMENT';
}

export type EvidenceKind = 'DISK_USAGE' | 'DNS_PROBE' | 'SERVICE_STATUS' | 'WIFI_ADAPTER' | 'RESTART_FLAG' | 'APP_VERSION' | 'OS_BUILD' | 'CRASH_DUMP' | 'FREE_TEXT';
export interface AddedEvidence { kind: EvidenceKind; note: string; at: string; actor: string }

export interface Consent { granted: boolean; at: string; expiresAt: string; planHash: string }

export interface Ticket {
  id: string; displayId: string; title: string; description: string; requester: string; deviceId: string;
  source: 'EMPLOYEE' | 'DETECTION'; category: Category; priority: 'P2' | 'P3' | 'P4'; status: Status;
  createdAt: string; updatedAt: string; firstResolvedAt?: string; resolvedAt?: string; closedAt?: string;
  owner: string; eligibleAtIntake: boolean; intakePolicyVersion: number; baselineAgentMin: number;
  baselineResolutionMin: number; agentMin: number; path?: Path; verified: boolean; reopenedCount: number;
  /** Simulated outcome chosen in the ticket creator (what the simulator will do). */
  outcome: Outcome; diagnosisId?: string; executionIds: string[]; resolutionNote?: string; consent?: Consent;
  // ---- documented extensions ----
  modeledResolutionMin?: number;
  eligibilityReason: string;
  scenario?: ScenarioKey | 'CUSTOM' | 'HISTORICAL';
  addedEvidence: AddedEvidence[];
  manualEvidence?: string;
  /** Counters feeding the modeled active-agent-minute model (Spec §7). */
  reviewDecisions: number; recoveries: number; reworks: number;
  scheduledDelayMin: number;
  demo?: boolean;
  // ---- enhancement fields ----
  /** Resolution SLA target derived from priority at intake (P2 4h, P3 8h, P4 24h). */
  slaDueAt: string;
  /** Shared-incident correlation: child -> parent link; parent lists children. */
  parentId?: string; childIds?: string[]; isParent?: boolean;
  employeeResponse?: EmployeeResponse;
}

export type EmployeeChoice = 'PROCEED' | 'SCHEDULE' | 'DECLINE' | 'ASSIST';
export interface EmployeeResponse { choice: EmployeeChoice; at: string; windowAt?: string; note?: string; planHash: string }

export interface Diagnosis {
  id: string; ticketId: string; revision: number; category: Category; confidence: number; risk: Risk;
  evidence: string[]; uncertainty: string[]; runbookId?: string; runbookVersion?: number; planHash: string;
  policyVersion: number; createdAt: string; recommendedRoute: Status; reasons: string[];
  osSupported: boolean; telemetryConsistent: boolean;
}

export type StepType = 'DIAGNOSTIC' | 'SNAPSHOT' | 'ACTION';
export type StepApprovalMode = 'NONE' | 'PLAN' | 'STEP';
/** Structured runbook step (enhancement §4). */
export interface RunbookStep {
  id: string; description: string; type: StepType; risk: Risk; approval: StepApprovalMode; dependsOn: string[];
  expectedResult: string; verification: string; recoverable: boolean;
}
export type RunbookStatus = 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'RETIRED';
export interface MaturityChange { from: Maturity; to: Maturity; at: string; actor: string; reason: string }

export interface Runbook {
  id: string; version: number; title: string; category: Category; status: RunbookStatus;
  risk: Risk; supportedOS: Device['os'][]; steps: string[]; checks: string[]; rollbackSteps: string[];
  reversible: boolean; disruptive: boolean; expectedMin: number; owner: string; publishedAt?: string;
  // ---- enhancement fields ----
  stepDefs: RunbookStep[]; maturity: Maturity; maturityHistory: MaturityChange[]; restartRequired: boolean;
  rootCause?: string; applicability?: string; risks?: string[]; aiGenerated?: boolean;
  submittedBy?: string; submittedAt?: string; reviewedBy?: string;
  // ---- documented extensions ----
  /** Simulator action from the fixed catalog. Undefined => diagnostic-only guidance, never executable. */
  actionKey?: Category;
  diagnosticOnly: boolean;
  prerequisites: string[];
  recoveryNote: string;
  testedScenario?: string;
  sourceTicketIds: string[];
  createdAt: string;
  changeNote?: string;
  retiredAt?: string;
}

export interface Policy {
  version: number; enabled: boolean; autoEnabled: boolean; reviewThreshold: number; approvalThreshold: number;
  autoThreshold: number; allowedGroups: Device['group'][]; approvalTTLMin: number; maxAttempts: number;
  closureMode: 'AUTO' | 'EMPLOYEE_CONFIRM';
}
export interface PolicyRecord { policy: Policy; reason: string; actor: string; role: ActorRole; at: string }

export interface Approval {
  id: string; ticketId: string; planHash: string; policyVersion: number; actor: string; role: Role;
  decision: 'APPROVE' | 'REJECT' | 'REVIEW'; reason?: string; at: string; expiresAt: string;
  // extensions
  diagnosisRevision: number; requestedAt: string; scheduledFor?: string;
  consumedBy?: string; invalidatedAt?: string; invalidReason?: string; expiredLoggedAt?: string;
}

export type ExecPhase = 'AWAITING_STEP' | 'RUNNING' | 'VERIFYING' | 'PASSED' | 'FAILED' | 'ROLLING_BACK' | 'ROLLED_BACK' | 'ROLLBACK_FAILED' | 'CANCELLED';
export interface FieldChange { field: keyof Device; before: unknown; after: unknown }
export type Authorization =
  | { kind: 'APPROVAL'; approvalId: string; actor: string; role: Role; approvedAt: string; policyVersion: number; valid: boolean }
  | { kind: 'POLICY'; policyVersion: number; decision: string; valid: boolean };

export interface Execution {
  id: string; ticketId: string; planHash: string; runbookId: string; version: number; path: Path;
  startedAt: string; endedAt?: string; phase: ExecPhase; stepIndex: number; nextAt?: string; snapshot: Device;
  results: string[]; outcome: Outcome; verificationPassed: boolean; rollbackDeadline?: string;
  // extensions
  deviceId: string; diagnosisRevision: number; simOutcome: Outcome; authorization: Authorization;
  changes: FieldChange[]; appliedAt?: string; reversible: boolean; risk: Risk;
  stepMs: number; verifyMs: number; closeMs: number;
  closurePending?: boolean; rollbackStep?: number; rollbackResults: string[]; rollbackBy?: string;
  rollbackStartedAt?: string; rollbackEndedAt?: string; verificationOutput: string[]; cancelReason?: string;
  // ---- enhancement fields ----
  preflight: PreflightCheck[]; stepScheduledFor?: string; pausedStepId?: string;
}

export type CheckStatus = 'PASS' | 'FAIL' | 'PENDING' | 'NA';
export interface PreflightCheck { key: string; label: string; status: CheckStatus; detail: string; mandatory: boolean }

/** Step-level approval scoped to incident, endpoint, action, runbook version and plan (enhancement §4). */
export interface StepApproval {
  id: string; ticketId: string; executionId: string; stepId: string; deviceId: string; actionKey: string; runbookId: string; runbookVersion: number;
  planHash: string; actor: string; role: Role; decision: 'APPROVE' | 'REJECT'; reason?: string; at: string; expiresAt: string;
  scheduledFor?: string; invalidatedAt?: string; invalidReason?: string; usedAt?: string;
}

export interface Assumptions {
  hourlyCost: number; currency: string;
  baselines: Record<Category, { agentMin: number; resolutionMin: number }>;
  updatedAt?: string; updatedBy?: string;
}

export interface AuditEvent {
  id: string; seq: number; at: string; ticketId?: string; actor: string; role: ActorRole; action: string;
  from?: Status; to?: Status; reason: string; metadata: Record<string, unknown>;
  result: 'SUCCESS' | 'FAILURE' | 'BLOCKED' | 'INFO';
}

export interface AppNotification { id: string; ticketId?: string; recipient: 'EMPLOYEE' | 'AGENT' | 'ADMIN'; message: string; at: string; read: boolean }
export interface ScheduledJob { id: string; ticketId: string; dueAt: string; planHash: string; status: 'PENDING' | 'DONE' | 'CANCELLED'; createdAt: string; originalDueAt: string }

export interface AppState {
  schemaVersion: 2;
  anchor: string;
  seq: { ticket: number; audit: number; runbook: number; device: number };
  devices: Record<string, Device>;
  tickets: Record<string, Ticket>;
  diagnoses: Diagnosis[];
  runbooks: Runbook[];
  policy: Policy;
  policyHistory: PolicyRecord[];
  approvals: Approval[];
  executions: Execution[];
  jobs: ScheduledJob[];
  audit: AuditEvent[];
  notifications: AppNotification[];
  stepApprovals: StepApproval[];
  settings: { role: Role; assumptions: Assumptions };
}

export interface Actor { name: string; role: ActorRole }
