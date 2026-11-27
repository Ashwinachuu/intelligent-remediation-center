# Intelligent Remediation Center — Product & Engineering Specification

> **Enhancements:** incremental Product Experience & Trust enhancements (workspace, explainable assessment, preflight, step-level approval, consent experience, similar incidents, correlation, draft lifecycle, business impact, maturity) are specified in [ENHANCEMENTS.md](./ENHANCEMENTS.md). This document remains the baseline.

**Version:** 1.0 | **Status:** Ready for prototype implementation | **Audience:** Coding agents, engineers, designers and interview reviewers

## 0. Build instruction

Build a complete, functional, responsive web application from this document. Treat MUST requirements as acceptance criteria, not suggestions. Do not stop at wireframes, a landing page, or a plan. Implement all P0 functionality, then P1. Use fictional data and deterministic simulation only. No real device commands, external AI calls, credentials, enterprise integrations or personal information. Do not ask for additional product decisions; use defaults specified here. Where details are unspecified, choose the simplest accessible behavior and document it in README.md. Deliver source, lockfile, tests, README, and a successful production build. Do not claim deployment or test success unless actually verified.

## 1. Assignment and product framing

Freshworks Senior Product Manager assignment, Question 2, Option B — IT Ops & Trust Controls: Design a prototype that can close and resolve tickets automatically with human approval. An AI system detects common IT incidents and suggests auto-remediation steps. Design the product experience and control model, including confidence thresholds, explanation, one-click approval/rollback and auditability.

Product name: **Intelligent Remediation Center**. Tagline: Resolve faster. Intervene when necessary. Stay in control. An independent concept inspired by ITSM workflows, not an official Freshworks product. Domain: managed employee laptops (Endpoint Health / Laptop Hygiene).

### Problem and opportunity

Recurring incidents consume service desk time even when a repeatable solution exists. Historical ticket knowledge is fragmented; manual diagnosis, approval and execution prolong employee downtime. Administrators cannot safely delegate actions without understandable evidence, permissions, impact controls, verification and recoverability. Build a system that converts validated knowledge into governed execution, and escalates uncertainty rather than hiding it.

### Discovery (hypotheses, not research findings)

| Hypothesis | Validation method | Decision informed |
|---|---|---|
| Recurring incidents account for meaningful agent effort | Analyze 90 days of anonymized tickets by category, recurrence and handling time | Initial runbook coverage |
| Repeatable fixes have stable prerequisites and outcomes | Review 50 resolved examples per candidate category with IT SMEs | Runbook eligibility |
| Approval friction is a major bottleneck | Interview 5 agents, 3 admins, 3 employees; observe 10 workflows | Approval UX and scheduling |
| Evidence and rollback improve trust | Test approval screens with agents, compare decision accuracy and time | Explanation design |
| Automation reduces downtime without increasing repeat incidents | Matched pilot cohort by incident type and severity | Go/no-go and expansion |

Unknowns: customer incident distribution, real integration feasibility, model calibration, security approval, baseline cost, acceptable risk. Do not present synthetic numbers as customer data.

### Personas and jobs

Employee: restore productivity without disruptive actions. Agent: diagnose and resolve safely with minimal work. Admin: define authorization, consent, scope and safeguards. Operations manager: measure outcomes and prioritize gaps. Primary user is the agent; admin is the trust owner. Employee experience is represented via simulated consent and notifications.

### Goals and non-goals

P0: ticket intake, diagnosis, policy gating, explicit approval, execution, verification, rollback, escalation, audit, dashboard and basic governed library. P1: opportunity clustering, versioned publication, CSV export, detailed trend comparisons (implement after P0). Out of scope: real device management, actual model training, real SSO/RBAC enforcement, multi-tenancy, production deployment security, real-time remote orchestration, ticketing system integrations, billing. All P0/P1 screens must be functional; never use dead navigation or fabricated live integrations.

### Success hypothesis for eventual pilot

Target 30% reduction in median resolution time for comparable eligible incidents, 25% reduction in active agent handling time, >=95% verified first-attempt remediation success and zero unauthorized executions. Track reopening and employee-disruption rates against baseline; stop expansion on material deterioration. Targets are proposals, not guarantees. North star: verified AI-assisted resolution rate among all eligible incident-cohort tickets, paired with coverage and safety guardrails to prevent cherry-picking.

## 2. Implementation contract

Use Node 22.12+ or 24 LTS, npm, React, TypeScript strict, Vite, React Router (HashRouter), Zustand or React reducer/context, Recharts, Lucide React, plain CSS or Tailwind. Use Vitest and React Testing Library; Playwright for core flows. Pin compatible versions via lockfile. No backend required. Use localStorage key `remediation-center:v1` with schema version, state validation and safe reset on corrupt data (show warning). Persist tickets, devices, runbooks, policies, execution jobs, audit, notifications and settings after every mutation. Derive metrics, never persist independent counters. No secrets or environment variables. Single-browser state; explicitly disclose that shared URL does not share reviewer changes. Hash routes must survive refresh on static hosts. Use UTC ISO timestamps; display local timezone consistently. Use current local day for demo date ranges, store synthetic data relative to first launch time. Use pure domain functions outside UI; all mutations go through guarded actions. Simulated roles are not a security boundary.

Suggested layout:

```text
src/
  app/ (router, shell, providers)
  domain/ (types, policy, diagnosis, transitions, metrics, simulation)
  data/ (fixtures, seed, persistence)
  components/ (shared UI, charts, forms)
  pages/ (overview, incidents, incident-detail, approvals, library, policies, audit, opportunities)
  tests/
```

Commands: `npm install`, `npm run dev` (localhost:5173), `npm run build` (typecheck + Vite build to dist), `npm run preview`, `npm run test` (non-watch), `npm run test:e2e`. README must include setup, architecture, simulator limitations, demo walkthrough and test results. Deploy static dist to Vercel or equivalent; framework Vite, install npm ci, build npm run build, output dist. No server rewrites needed with hash routes. Do not deploy unless asked/authorized. Reference: https://vite.dev/guide/static-deploy.html.

## 3. Experience and navigation

Desktop-first application shell: 232px sidebar, top bar with breadcrumb, global create ticket, simulated role selector, notifications and Demo controls. Desktop 1440px target, responsive down to 375px; collapse nav into drawer, horizontally scroll dense tables, stack detail panels. Default landing Overview. Routes: `/#/overview`, `/incidents`, `/incidents/:id`, `/approvals`, `/library`, `/library/:id`, `/opportunities`, `/policies`, `/audit` (all after hash). Unknown route -> friendly not-found. Ticket creation modal from every route. Clicking metric or chart category opens filtered incidents; audit and runbook references deep-link; back preserves filters via URL query params. All buttons functional, explicit disabled reason where disallowed.

Visual system: light enterprise interface, white surfaces, background #F6F8FA, text #172B4D, muted #52677C, accent #087E83, border #DDE5EC, success #16794B, warning #9A5A00, danger #B42318. 8px spacing grid, 6–10px corners, system sans, 14px body, 24px page heading, 32px metric values. Avoid decorative gradients, excessive cards, or marketing hero. Use status text + icon, not color alone. Keyboard access, visible focus, labeled inputs, accessible dialogs, live regions for execution status, reduced motion. Charts have text summaries and tooltips. Persistent small banner “Demo mode · simulated AI and endpoint actions”. No Freshworks logos or official affiliation claims.

## 4. Domain model (canonical)

Use UUIDs internally and sequential display IDs INC-1001 onward. All timestamps ISO strings. Enum values below are authoritative; display friendly labels.

```ts
type Role = 'AGENT'|'ADMIN'|'MANAGER';
type Risk = 'LOW'|'MEDIUM'|'HIGH';
type Status = 'OPEN'|'DIAGNOSING'|'REVIEW_REQUIRED'|'AWAITING_APPROVAL'|'AWAITING_CONSENT'|'WAITING_DEVICE'|'SCHEDULED'|'READY'|'EXECUTING'|'VERIFYING'|'ROLLBACK_AVAILABLE'|'ROLLING_BACK'|'ESCALATED'|'RESOLVED'|'CLOSED'|'REOPENED';
type Category = 'STORAGE'|'DNS'|'SERVICE'|'WIFI'|'RESTART'|'APP_UPDATE'|'OS_UPDATE'|'CRASH'|'UNKNOWN';
type Outcome = 'SUCCESS'|'VERIFY_FAIL'|'EXEC_FAIL'|'ROLLBACK_FAIL';
type Path = 'AUTO_POLICY'|'HUMAN_APPROVED'|'MANUAL';
interface Device { id:string; name:string; os:'Windows 11'|'macOS'; group:'Standard'|'Critical'; online:boolean; busy:boolean; managed:boolean; freeGB:number; appVersion:string; osVersion:string; wifiHealthy:boolean; serviceHealthy:boolean; restartPending:boolean; dnsHealthy:boolean; }
interface Ticket { id:string; displayId:string; title:string; description:string; requester:string; deviceId:string; source:'EMPLOYEE'|'DETECTION'; category:Category; priority:'P2'|'P3'|'P4'; status:Status; createdAt:string; updatedAt:string; firstResolvedAt?:string; resolvedAt?:string; closedAt?:string; owner:string; eligibleAtIntake:boolean; intakePolicyVersion:number; baselineAgentMin:number; baselineResolutionMin:number; agentMin:number; path?:Path; verified:boolean; reopenedCount:number; outcome:Outcome; diagnosisId?:string; executionIds:string[]; resolutionNote?:string; consent?:{granted:boolean; at:string; expiresAt:string; planHash:string}; }
interface Diagnosis { id:string; ticketId:string; revision:number; category:Category; confidence:number; risk:Risk; evidence:string[]; uncertainty:string[]; runbookId?:string; runbookVersion?:number; planHash:string; policyVersion:number; createdAt:string; recommendedRoute:Status; reasons:string[]; }
interface Runbook { id:string; version:number; title:string; category:Category; status:'DRAFT'|'APPROVED'|'RETIRED'; risk:Risk; supportedOS:Device['os'][]; steps:string[]; checks:string[]; rollbackSteps:string[]; reversible:boolean; disruptive:boolean; expectedMin:number; owner:string; preapproved:boolean; publishedAt?:string; }
interface Policy { version:number; enabled:boolean; autoEnabled:boolean; reviewThreshold:number; approvalThreshold:number; autoThreshold:number; allowedGroups:Device['group'][]; approvalTTLMin:number; maxAttempts:number; closureMode:'AUTO'|'EMPLOYEE_CONFIRM'; }
interface Approval { id:string; ticketId:string; planHash:string; policyVersion:number; actor:string; role:Role; decision:'APPROVE'|'REJECT'|'REVIEW'; reason?:string; at:string; expiresAt:string; }
interface Execution { id:string; ticketId:string; planHash:string; runbookId:string; version:number; path:Path; startedAt:string; endedAt?:string; phase:'RUNNING'|'VERIFYING'|'PASSED'|'FAILED'|'ROLLING_BACK'|'ROLLED_BACK'|'ROLLBACK_FAILED'|'CANCELLED'; stepIndex:number; nextAt?:string; snapshot:Device; results:string[]; outcome:Outcome; verificationPassed:boolean; rollbackDeadline?:string; }
interface AuditEvent { id:string; seq:number; at:string; ticketId?:string; actor:string; role:Role|'SYSTEM'|'EMPLOYEE'; action:string; from?:Status; to?:Status; reason:string; metadata:Record<string,unknown>; }
```

Additional persisted entities: approval list, diagnosis list, notifications (ticketId, recipient, message, timestamp, read), scheduled jobs (ticketId, dueAt, planHash), policy history, fixture anchor and sequence counters. Retain old diagnosis/runbook versions and approvals. Plans bind device id, diagnosis revision, runbook id/version, risk and policy version via stable serialization/hash. Client hash is consistency control, not cryptographic security. For device changes re-check current prerequisites before execution. No freeform generated shell commands.

## 5. Runbook catalog and simulator

Every action is an in-memory change to fictional device state. Use deterministic diagnosis based on selected scenario and device telemetry; label scores simulated, not calibrated probabilities. Do not randomly generate a score per render. For custom text, map normalized keywords (storage/disk, DNS, service, Wi-Fi/wifi/network, restart/reboot, app update, OS update, crash); multiple conflicting matches or no match -> UNKNOWN. Scenario dropdown takes precedence and shows inferred category. Scores shown below are defaults. Evidence must match current telemetry; if inconsistent set score 65 and request validation. Historical examples are synthetic and labeled.

| ID / category | Score / risk / expected min | Action / verification | Recovery / rule |
|---|---|---|---|
| RB-001 STORAGE | 98 / LOW / 3 | Clear approved cache only; freeGB +8; verify freeGB >=10 | Cache removal not reversible; approved disposable cache only, no user files; preapproval allowed |
| RB-002 DNS | 97 / LOW / 2 | Refresh DNS cache; dnsHealthy=true; verify DNS probe | No exact cache restoration; safe refresh; preapproval allowed |
| RB-003 SERVICE | 96 / LOW / 4 | Restart noncritical background service; serviceHealthy=true; check service running | Restore previous service state; preapproval allowed |
| RB-004 WIFI | 94 / MEDIUM / 5 | Snapshot config, reset adapter, renew config; wifiHealthy=true; verify connectivity | Restore snapshot network fields; explicit agent approval; requires employee consent |
| RB-005 RESTART | 99 / MEDIUM / 8 | Check availability, simulate reboot; restartPending=false; verify reconnect and uptime | Irreversible; consent and agent approval |
| RB-006 APP_UPDATE | 92 / MEDIUM / 12 | Install allowlisted app version 2.1; verify version and health | Restore appVersion; agent approval + consent |
| RB-007 OS_UPDATE | 93 / HIGH / 25 | Validate compatibility and window, simulate approved patch 24H2; verify version and health | Simulated restore to prior OS version if supported; admin approval + consent + schedule |
| CRASH | 68 / HIGH / n/a | Collect simulated crash evidence, no execution | Human review; no approved runbook |
| UNKNOWN | 42 / HIGH / n/a | Insufficient evidence | Escalate; no execution |

Seed RB-001..007 approved v1, supported OS Windows 11; seed macOS device to show unsupported gate. Include draft RB-008 CRASH, safe diagnostic-only runbook, never executable until published and definition validated. Storage initial freeGB=3, DNS unhealthy, service unhealthy, Wi-Fi unhealthy but management channel online, restartPending=true, App version 2.0, OS version 23H2. Ticket creator initializes relevant fictional device condition or selects an existing device with explicit preview; avoid changing shared devices silently. Each runbook has 3 steps: preflight/snapshot, action, verify. Actual verification is its own phase. Risk for critical-device disruptive actions HIGH; critical group excluded by default. Device online means management channel reachable, not necessarily Wi-Fi healthy. If offline, no execution; use reconnect simulation or manual escalation.

## 6. Policy engine and approval (P0)

Default Policy v1: enabled=true, autoEnabled=false (explicit ticket approval by default to satisfy assignment), reviewThreshold=60, approvalThreshold=80, autoThreshold=95, allowedGroups=['Standard'], approvalTTLMin=60, maxAttempts=1, closureMode=AUTO. Admin may enable preapproval with confirmation; only LOW-risk catalog runbooks marked preapproved and published are eligible. Human authorization is either per-ticket or explicitly configured policy. Never allow medium/high auto-execution. Validate 0 <= reviewThreshold < approvalThreshold < autoThreshold <=100; integers only. Risk is independent of confidence. Critical or unmanaged device requires manual handling unless critical group allowed; unmanaged always manual. No approval override of hard blockers.

Decision priority (first applicable):

1. No managed endpoint, disallowed group, unsupported OS for plan, no approved executable runbook and confidence below review threshold -> ESCALATED (for missing runbook with score >= review threshold -> REVIEW_REQUIRED). Unmanaged/disallowed/unsupported always escalated.
2. Confidence below review threshold -> ESCALATED; below approval threshold -> REVIEW_REQUIRED. Review resolution is manual or fresh diagnosis with explicit new evidence, not manually editing score. Missing runbook -> REVIEW_REQUIRED.
3. Global pause -> REVIEW_REQUIRED with policy-paused reason (manual handling allowed). Offline -> WAITING_DEVICE. Busy and disruptive -> AWAITING_CONSENT, if no valid consent; do not execute while busy even with consent.
4. If autoEnabled && LOW && confidence >= autoThreshold && runbook.preapproved && not disruptive -> READY with path AUTO_POLICY; automatically start asynchronously. Otherwise require AWAITING_APPROVAL.
5. Agent or admin may approve LOW/MEDIUM; only admin HIGH. Approval binds plan/current policy and expires in 60 min. After approval require valid employee consent for disruptive action; then HIGH requires a scheduled window, others may execute now or schedule. No execution while busy, offline or paused. Check all gates again immediately before action. Approval expires before start -> AWAITING_APPROVAL. Policy or plan changes invalidate outstanding approvals and consent; re-diagnose. Consent expires after 24h; denied -> ESCALATED or reschedule with fresh consent. Never infer consent from agent approval.

Approval UI: one primary “Approve & execute” for ready cases; “Approve & request consent” or “Approve & schedule” when relevant. Show device, diagnosis, score and uncertainty, actual evidence, runbook version, risk/impact, estimated time, prerequisites, expected checks, rollback availability, required role and policy reason. Reject/review requires reason. Approve now is one click when all gates satisfied; no unnecessary modal, but high-impact/scheduled approval has explicit window and impact confirmation. Disable duplicate clicks. No approval from manager role. Simulate employee consent/denial with separately labeled buttons; audit actor EMPLOYEE; no prechecked consent. Demo controls can toggle busy/online; re-evaluate blockers, never bypass controls.

## 7. State and execution lifecycle (P0)

| Current | Event | Next |
|---|---|---|
| OPEN / REOPENED | Diagnose | DIAGNOSING -> engine route |
| REVIEW_REQUIRED | Add evidence / re-evaluate | DIAGNOSING |
| AWAITING_APPROVAL | Approve | AWAITING_CONSENT / SCHEDULED / READY according to gates |
| AWAITING_APPROVAL | Reject | ESCALATED |
| AWAITING_APPROVAL | Request review | REVIEW_REQUIRED |
| WAITING_DEVICE | Reconnect | re-evaluate all gates |
| AWAITING_CONSENT | Grant | re-evaluate approval and busy gates; schedule/ready if valid |
| AWAITING_CONSENT | Deny | ESCALATED |
| SCHEDULED | Due | re-check gates -> READY or blocked state |
| READY | Start | EXECUTING |
| EXECUTING | Action complete | VERIFYING |
| EXECUTING / VERIFYING | Failure | ROLLBACK_AVAILABLE if reversible and action applied; else ESCALATED |
| VERIFYING | Checks pass | RESOLVED |
| RESOLVED | Auto closure / simulated employee confirmation | CLOSED |
| ROLLBACK_AVAILABLE / RESOLVED / CLOSED | Authorized rollback within deadline | ROLLING_BACK |
| ROLLING_BACK | Restored or failed | ESCALATED, record outcome |
| RESOLVED / CLOSED | Reopen | REOPENED, clear current verified flag and closure timestamps |
| Any nonrunning unresolved state | Manual escalation | ESCALATED |
| ESCALATED / REVIEW_REQUIRED | Human resolution with note and verification | RESOLVED path MANUAL |

Implement transitions centrally; illegal transition returns typed error, shows reason and does not mutate business state; log authorization blocks. Policy pause stops new starts and upcoming action steps; already applied actions proceed to safety verification / rollback only. No unsafe cancellation mid-action. Max one execution in flight per device and ticket; device lock releases when job ends, including failure. Attempts counted per diagnosis revision, max policy limit; after failure require new human-reviewed plan before retry; do not loop. Rollback must not overwrite unrelated device changes: restore only fields changed by that execution; refuse if subsequent changes conflict. Rollback deadline 30 simulated real minutes after action; display deadline and prerequisites. Admin/agent can rollback according to original risk permission (high admin), even when automation paused. For irreversible actions show unavailable reason. Rollback success does not imply incident resolution; escalate, clear resolved/closed flags and log previous result. Rollback failure escalates with manual recovery instructions. Never auto-close on action execution alone.

Execution runner: persistent job with nextAt, each step 700ms, verification 900ms, closure 700ms; use elapsed timestamps to resume after refresh, not component-local timers. Process due jobs on mount and periodic tick; idempotent phase transitions; no duplicate events. If two tabs open, show warning that one tab is recommended (no production concurrency claims). Use real elapsed timestamps for audit, separate simulated service duration for analytics. For live-created tickets, resolution elapsed wall time may be seconds; label accelerated demo and show actual elapsed, do not misrepresent simulated time as measured savings. Baseline and simulated duration model: at resolution set modeled resolution minutes to expectedMin for AUTO_POLICY, expectedMin+8 for HUMAN_APPROVED plus scheduled delay minutes if any, baselineResolutionMin for MANUAL; track active agent minutes 1 auto, 4 approved, baselineAgentMin manual; add 2 for each rejected/review decision, 5 for recovery, 1 per approval rework. Store modeledResolutionMin as additional Ticket field. Analytics explicitly labeled modeled. Actual human approval wait from event timestamps can be shown separately.

Outcome selector in ticket creator: Success, Verification failure after action, Execution failure before action, Rollback failure after verification failure. Apply state mutation only after preflight passes. For VERIFY_FAIL / ROLLBACK_FAIL apply intended change then fail health check; for EXEC_FAIL no mutation and no rollback; for ROLLBACK_FAIL do not restore snapshot. Store results for every step. For successfully resolved reversible actions offer rollback until deadline, also support reopening via simulated employee notification. When policy closureMode=EMPLOYEE_CONFIRM keep RESOLVED until confirmation; employee reports unresolved -> REOPENED. Auto policy closure records notification and system closure event.

## 8. Screen requirements

### 8.1 Overview (P0)

Header: Endpoint remediation overview; date presets Today, 7/30/90 days, custom inclusive local dates; default last 30 days. Filters source, category, device group, path (All default); clear filters. Cards: total incidents, auto-closed, human-approved closed, review needed, unsupported/new, verified AI-assisted resolution rate, modeled time saved, modeled MTTR improvement. Show previous equal-length period comparison when data exists; otherwise dash / insufficient data. Charts: daily resolved by path, modeled resolution duration by path, incident funnel (intake -> eligible -> executed -> verified -> closed), category breakdown, trust guardrails, top automation gaps. Status breakdown mutually exclusive: closed auto, closed assisted, closed manual, resolved awaiting closure, review/approval/consent, waiting/scheduled, in progress, escalated, other open/reopened. Link each card to matching incident cohort and filters. Explicitly show cohort basis vs closure-date activity basis. Operational queue strip: pending approvals, overdue approvals, rollback attention, waiting device; current snapshot independent of date filter and labeled.

### 8.2 Incident worklist and ticket creator (P0)

Table columns ticket ID/title, requester/device, category, source, priority, status, confidence, risk, current path, age, owner. Search title/ID/requester; filters status/confidence band/risk/category/source/path/date; sort created date, priority, score, age; pagination 20. Empty state with clear filters. Row opens detail. Creator fields title (required, 3–120 chars), description (required, 3–1000), requester (fictional select), device (select or new demo device), source, priority, scenario/custom, outcome. Scenario fills sensible defaults but editable; preview telemetry. Submit creates audit event and begins diagnosis; route to detail. Add “Load scenario” shortcuts for 8 cases. No use of sensitive data.

### 8.3 Incident detail (P0)

Header status/ID, requester, device, ownership, timestamps, source, priority. Tabs Summary, Remediation, Activity (default Remediation). Summary description and device context; Remediation left evidence panel, right action card with score, risk, plan, prerequisites, expected duration, change preview, validation, rollback limits, policy reason. Show confidence not probability claim. Timeline status labels and timestamps, progress steps, before/after values and actual verification output. Primary action depends on current state; secondary reject/review/escalate, schedule, simulate consent, reconnect, rollback, reopen as permitted. Manual resolution modal requires note, evidence and checkbox confirming verification; capture human actor and path. Additional diagnostics form accepts scenario-supported evidence (e.g. disk usage) and reruns; unknown free text stays uncertain. Activity displays audit and employee notifications. Each action triggers toast and updates all linked views. Ticket actions unavailable for manager; manager can view all.

### 8.4 Approvals (P0)

Filtered queue for AWAITING_APPROVAL and separate consent/expiry tabs; sort highest risk then oldest. Cards with ID, subject, score, risk, expected duration, reason and required approver. Open detail or expand complete evidence inline. One-click approve only after expanded evidence and gates; reject/review modal. No bulk approval in MVP. Track time waiting and expired approval reason. Manager read-only.

### 8.5 Library (P0/P1)

Searchable versioned catalog with category, risk, owner, status, preapproval, attempts, verified success rate derived from execution records. Detail shows steps, checks, prerequisites, recovery, version history. Agent can propose a draft from manually resolved ticket; copy category, note and evidence; default high risk, non-preapproved. Admin can edit draft metadata and select supported simulator action from catalog; require nonempty steps/checks, recovery declaration, supported OS and tested scenario before publication. Unknown/new action cannot be executed; may publish diagnostic-only guidance, not executable. Admin approves new version and can retire; never overwrite previous version. Changing or retiring active runbook invalidates pending plans. Audit all changes. P1 opportunity links create draft. No self-learning or automatic approval.

### 8.6 Policies (P0)

Admin-only editing; others read-only. Master pause, preapproval switch with explicit confirmation, three thresholds, allowed group, approval expiry, attempt limit, closure mode. Show live risk/confidence route matrix computed from same policy function, not hardcoded. Save new version with mandatory reason; preview affected pending count; re-evaluate nonrunning tickets after save. Changing policy during execution stops before further mutation if paused; existing verification/recovery allowed. Provide sample scenario evaluator read-only. Restore defaults creates new version rather than erasing history.

### 8.7 Audit (P0)

Append-only UI event table, newest first, search by ticket, filter actor/action/date/result. Event detail shows before/after, decision reason, policy/runbook versions, evidence/plan hash, execution results, approval actor/time, consent, recovery. No delete/edit actions. Export filtered CSV with spreadsheet-injection protection (prefix cells starting =,+,-,@ with apostrophe). Audit is inspectable but localStorage is mutable; never call it tamper-proof. Reset demo is explicit destructive action, not routine audit deletion.

### 8.8 Opportunities (P1)

Group unsupported or manually escalated tickets by category, show volume, modeled potential agent hours = count * max(0, baselineAgentMin-4)/60, sample tickets, existing draft status. Sort by opportunity hours; create draft from group, link source tickets. Label estimates as potential not realized savings. Exclude safety-blocked known runbooks from new-runbook gaps; show separate policy/endpoint blockers. No auto-publish.

## 9. Metrics contract

Use shared pure selectors, zero denominator -> em dash, no Infinity/NaN. Intake cohort = tickets created within date range and filters; closure activity chart = tickets with current closedAt within range (reopened excluded), labeled separately. Resolved throughput chart may use current resolvedAt instead, label clearly. All summary KPIs use intake cohort as of now, not historical as-of snapshots. Every displayed count has drill-down to exact predicate and date basis. Previous period equal days before start. Baselines are category-matched modeled values, not measured organizational outcomes.

| Metric | Calculation |
|---|---|
| Reported | cohort count incl proactive; label source split |
| Auto-closed / assisted / manual | status CLOSED and path matching |
| Review needed | REVIEW_REQUIRED or AWAITING_APPROVAL or AWAITING_CONSENT |
| New/unsupported | no approved executable runbook or unsupported OS; explain overlap with review |
| Coverage | eligibleAtIntake / all cohort tickets |
| North star | currently verified RESOLVED or CLOSED, path AUTO_POLICY or HUMAN_APPROVED, eligibleAtIntake / all eligibleAtIntake |
| Verified remediation success | execution verificationPassed / completed execution attempts (PASSED, FAILED, ROLLED_BACK, ROLLBACK_FAILED); historical success distinct from current ticket status |
| First-attempt success | tickets whose first completed execution verified / tickets with completed execution |
| Modeled MTTR | mean modeledResolutionMin for currently resolved/closed tickets |
| MTTR improvement | (sum baselineResolutionMin - sum modeledResolutionMin)/sum baselineResolutionMin across verified current AI resolutions |
| Agent time saved | sum baselineAgentMin - agentMin across verified current AI resolutions; allow negative |
| Efficiency improvement | agent time saved / sum baselineAgentMin for same set |
| Reopen rate | cohort ever resolved tickets with reopenedCount>0 / cohort ever resolved tickets |
| Rollback rate | executions ever rolled back or rollback failed / completed executions |
| Unauthorized executions | executions lacking valid approval/policy at start, expected zero; blocked attempts shown separately |
| Audit completeness | started executions with recorded decision, start, and terminal event if terminal / started executions |
| Approval turnaround | median actual minutes from approval request to decision, paired by revision |

`eligibleAtIntake` immutable: managed supported device, allowed group, approved executable runbook and confidence >= default approval threshold 80 at intake, regardless of temporary online/busy/pause conditions; store version and reason. Policy changes do not retroactively alter denominator. Include eligibility coverage alongside north star. Execution metrics use execution timestamps in selected range and matching linked ticket filters; clearly label. Capture execution authorization proof (approval ID or policy version and decision snapshot) in execution metadata. Baselines: STORAGE 20/30, DNS 15/25, SERVICE 20/35, WIFI 30/45, RESTART 15/35, APP_UPDATE 25/60, OS_UPDATE 40/120, CRASH 60/180, UNKNOWN 45/120 (agent min / resolution min). Show modeled cost savings only if explicit configurable hourly cost is implemented; omit by default. No vague efficiency scores.

## 10. Seed data and demo

All names fictional (Employee 001 etc). Seed 90 days of reproducible synthetic tickets: 4 per day = 360 historical tickets, patterned categories cycling catalog; created local noon minus day index, resolved later same day according to modeled duration. For each day use slots: auto-storage, approved Wi-Fi, manual crash, and rotating pending/closed case. Historical AUTO_POLICY records use historical policy v0 with preapproval enabled, not current default. Generate matching diagnosis, approvals/consent, executions, actual verification and audit records for histories, with no future timestamps (use previous 90 completed days). Pending fourth slot cycles REVIEW_REQUIRED crash, ESCALATED unknown, AWAITING_APPROVAL app update, CLOSED assisted service. Each ticket has independent device to avoid telemetry collision. Add today's eight featured scenarios below and label “Demo scenarios”. No pre-running jobs at initial load. Seed current date relative at reset. Seed metrics must be computed from these records, never copied from a mockup. Historical events should be internally coherent.

| Scenario | Initial state | Reviewer action / expected outcome |
|---|---|---|
| A Storage cleanup | AWAITING_APPROVAL, 98 LOW | Approve then verified closed; alternatively enable preapproval, new storage case auto-runs |
| B Wi-Fi failure | AWAITING_APPROVAL, 94 MEDIUM | Approve, grant employee consent, run, verified closed |
| C OS patch | AWAITING_APPROVAL, 93 HIGH | Agent blocked; admin approves, consent, schedule, run after due time |
| D Wi-Fi verification failure | AWAITING_APPROVAL, VERIFY_FAIL | Approve, consent, verification fails; one-click rollback -> escalated |
| E Unknown crash | REVIEW_REQUIRED, 68 HIGH | Review, manual verified resolution, propose draft |
| F Offline Wi-Fi | WAITING_DEVICE | Reconnect -> approval/consent required |
| G Unknown hardware issue | ESCALATED, 42 HIGH | No execution; investigate manually |
| H App rollback failure | AWAITING_APPROVAL, ROLLBACK_FAIL | Approve, consent, failure, rollback fails -> escalated |

Demo controls: role switch AGENT default, ADMIN, MANAGER; scenario loader creates fresh ticket; simulate reconnect/busy state only from ticket context; “Advance scheduled job to now” sets dueAt to now, audits change, rechecks approvals/consent (never bypasses); reset demo confirmation; no controls directly force resolved/verified. Schedule UI accepts now+1 minute through 24 hours, HIGH requires schedule, demo advance available after saved. Actor labels agent Alex, admin Morgan, manager Riley; fictional. Historical closure timestamp <= now. Notifications are simulated in-app only.

## 11. Acceptance tests and definition of done

Automated tests MUST cover pure policy boundary scores 59/60/79/80/94/95/100, high risk never auto, policy pause, unsupported OS, unmanaged, offline, busy, stale approval, wrong role, duplicate execution, consent denial/expiry, policy version invalidation, runbook retirement, schedule recheck, verification failure, irreversible rollback denial, rollback failure, reopening and retry limit. Test date range boundary, empty denominator, cohort vs activity, filtered counts and no double counting. Test persisted jobs resume after refresh and duplicate ticks do not duplicate audit.

End-to-end browser tests:

1. Create storage ticket -> explain recommendation -> approve -> steps -> verified closure -> dashboard counts update -> audit includes approval, execution, verification, closure.
2. Admin enables preapproval -> new storage ticket auto-closes -> medium-risk ticket still requires approval.
3. Wi-Fi case -> approve -> consent required -> employee grants -> verified closure.
4. High-risk OS -> agent cannot approve -> admin approve -> consent + scheduled -> advance -> verified closure.
5. Wi-Fi failure -> verification fails -> no closure -> rollback -> escalated; inspect snapshot restored.
6. Unknown crash -> no execution -> manual resolution -> draft created -> no auto activation.
7. Offline -> reconnect -> approval required; pause before action -> no mutation.
8. Reopen closed incident -> dashboard updates -> old execution audit retained.
9. Switch manager -> read-only; policy change invalidates pending approval; refresh preserves state.
10. Every route navigates, filters/reset work, mobile pages usable, no console errors, production build passes.

Implementation order: domain/types and seed; pure policy + reducer + simulation; worklist/creator/detail; approvals/policies/audit; dashboard metrics; library/opportunities; responsive styling; tests and README. Do not ship placeholder data disconnected from domain state. All UI and test data synthetic. Include explicit limitations in README and UI. If implementation cannot meet a requirement, record exact gap rather than quietly omitting it.

## 12. Production evolution (not implement in prototype)

Integrate existing ITSM ticket APIs, endpoint management agent/MDM and approved orchestration adapter. Separate AI diagnosis from deterministic policy enforcement and signed/versioned executable runbooks. Enforce server-side authorization, least-privilege credentials, tenant isolation, idempotent job queue, per-device locks, consent identity verification, immutable external audit store, telemetry freshness and rollback prerequisites. Never run arbitrary model-generated commands. Use calibrated confidence based on labeled outcomes and out-of-distribution detection; monitor model drift. Protect telemetry and redact secrets. Rollout: shadow recommendations -> human-approved pilot -> admin preapproved low-risk actions -> expand by evidence. Predefined stop criteria: any unauthorized execution, material increase in reopening/employee disruption, or repeated rollback failures triggers pause and investigation. Deliver capability as an extension to existing service workflows, not replacement ticketing platform.

## 13. Interview demo script (5–7 minutes)

1. Frame problem: repeated incidents waste time, trust blocks safe delegation; discovery hypotheses not validated.
2. Show overview, cohorts, outcome and guardrail metrics; explain north star and baseline assumptions.
3. Create storage ticket, show evidence, explicit approval and verified closure. Enable policy preapproval as admin and demonstrate controlled autonomy with fresh case.
4. Show Wi-Fi or OS case to explain confidence vs risk, consent and scheduling.
5. Trigger failed verification and rollback, demonstrate ticket remains unresolved and audit records accountability.
6. Show unknown incident, human validation and draft creation; show opportunity prioritization.
7. Close with progressive rollout and production requirements. State clearly that all results, device actions and confidence values are simulated.

**End of specification. Start implementation now; do not return only a plan.**
