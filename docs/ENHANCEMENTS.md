# Product Experience & Trust Enhancements — Implemented Specification

**Baseline:** [`docs/Spec.md`](./Spec.md) remains the source of truth. This document records the incremental enhancements layered on top of it, the rules as implemented, and where each lives in the code. When this document and the code disagree, the code and its tests are authoritative. Open an issue so this file can be corrected.

All behaviour is simulated. There are no external APIs and no real endpoint commands. Scores and estimates are deterministic and labelled as simulated or estimated.

## Data model changes (schema v2)

| Entity | Added fields |
|---|---|
| `Device` | `batteryPct`, `location`, `networkId`, `kind` (`ENDPOINT` \| `NETWORK_SEGMENT`) |
| `Ticket` | `slaDueAt`, `parentId`, `childIds`, `isParent`, `employeeResponse` |
| `Runbook` | `stepDefs` (structured steps), `maturity` (L0–L4), `maturityHistory`, `restartRequired`, `rootCause`, `applicability`, `risks`, `aiGenerated`, `submittedBy/At`, `reviewedBy`. Status adds `UNDER_REVIEW`. The old `preapproved` flag is replaced by maturity. |
| `Execution` | `preflight` (checks snapshot at start), `stepScheduledFor`, `pausedStepId`. The phase adds `AWAITING_STEP`. |
| `Status` | adds `STEP_APPROVAL` (Awaiting step approval) |
| New: `StepApproval` | scoped to execution, step, device, action key, runbook id + version and plan hash |
| `settings.assumptions` | hourly cost, currency, per-category manual baselines |

The storage key stays `remediation-center:v1`, and the schema version is now 3 (bumped again when the curated dataset replaced the large history). Data from v1 fails validation and is safely reset with a warning, as Spec §2 requires.

## P0

### 1. Action-oriented agent workspace — `components/Workspace.tsx`, `domain/insights.ts`

The Overview opens with **My workspace**. This is a current snapshot, independent of the date filter, with six tiles:

- Awaiting my approval: role-aware. Agents see LOW/MEDIUM plans and steps; Admins see everything; Managers see "—", because their view is read-only.
- AI remediation in progress.
- Human investigation required.
- SLA breached, plus a count of tickets approaching breach.
- Verified resolutions today.
- Estimated agent time saved today.

Every tile drills into a named predicate on the worklist. The spec's operational queue (pending, overdue, consent, step approvals, rollback, waiting device) is kept as a compact row of chips.

**Prioritized action queue.** The score is the sum of these parts:

| Factor | Points |
|---|---|
| Severity | P2 40, P3 25, P4 10 |
| SLA | at risk +30; breached within 24 h +30; breached longer ago +10 |
| Business impact | critical device group or shared incident +15; employee-reported +5 |
| Risk | HIGH +10, MEDIUM +5 |
| Human intervention required | +15 |
| Awaiting the viewer's approval | +10 |

Items created more than 7 days ago go into a separate *aged backlog* link, so 90 days of synthetic backlog do not bury current work. Each item links to `/incidents/:id?focus=action`, which opens the Remediation tab, scrolls to the action card and focuses its primary action.

**SLA.** The resolution target is P2 4 h, P3 8 h, P4 24 h, set at intake. "At risk" means at most min(1 h, 25 % of the SLA window) remains.

### 2. Explainable AI assessment — `components/Insights.tsx#AssessmentPanel`

The assessment shows three separate signals:

- **Diagnosis confidence:** the existing deterministic classification score.
- **Remediation confidence:** (verified + 1) / (completed + 2) over the runbook's historical executions, labelled as a simulated estimate.
- **Execution readiness:** derived from the preflight checks (Ready, Pending or Blocked).

The panel also covers:

- **Why this recommendation:** primary evidence, the runbook selection reason (the only approved executable runbook, and its maturity), historical similarity and success, and device compatibility.
- Diagnostic evidence and remaining uncertainty, behind progressive disclosure.
- An explicit statement that confidence never overrides risk, authorization, consent or prerequisites. Routing stays in `evaluateRoute` and `preflight`.

### 3. Preflight safety checks — `domain/preflight.ts`, `components/Insights.tsx#PreflightPanel`

One pure function, `preflight(state, ticketId, now, { execution? })`, drives the panel, the start gate and the re-validation before each action step. It checks:

- endpoint reachability
- device compatibility
- battery (≥ 30 % for disruptive or restart actions)
- storage (≥ 10 GB for the OS patch, ≥ 2 GB for the app update)
- approved runbook and version (and the version matching the execution)
- authorization and user permissions (plan, policy or step approval)
- employee consent
- employee availability
- maintenance window
- recovery capability (a HIGH-risk action with no rollback fails)
- automation policy compliance (pause, thresholds, shared-incident hold)

Each check is PASS, FAIL, PENDING or NA, and all are mandatory. Battery, storage and recovery also feed `evaluateRoute`: they route to WAITING_DEVICE or REVIEW_REQUIRED, so a blocked ticket never loops in READY. The audit log records results as `PREFLIGHT_PASSED` at start (also snapshotted on the execution), `PREFLIGHT_REVALIDATED` before each ACTION step, and `PREFLIGHT_BLOCKED` on failure. A failed re-validation cancels the run before any mutation.

### 4. Step-level human approval — `domain/engine.ts` (`stepExecution`, `approveStep`)

Each runbook step defines an ID, description, type (`DIAGNOSTIC`, `SNAPSHOT` or `ACTION`), risk, approval mode, dependencies, expected result, verification and recoverability.

- Approval mode `NONE` (read-only) steps run automatically.
- `PLAN` steps are covered by the plan approval or by policy authorization.
- `STEP` steps pause the execution (`AWAITING_STEP`, ticket `STEP_APPROVAL`) until a valid **StepApproval** exists.

A step approval:

- matches the execution, step, device, action key, runbook id and version, and plan hash, and is valid only while that runbook version is still approved;
- needs Admin for HIGH-risk steps, plus impact confirmation;
- can be scheduled (now + 1 minute to 24 h), with a demo "advance" action.

Changing the approved action invalidates the step approval and cancels the paused run before any mutation. Triggers include retiring the runbook, publishing a new version, a policy change, re-diagnosis, linking to a shared incident, or escalation. Rejection escalates. RB-007 (OS patch) is the multi-step example: S1 compatibility scan (auto), S2 restore point (plan), **S3 install (HIGH, step approval)**, S4 post-check (auto), then verification.

### 5. Employee consent experience — `components/Insights.tsx#EmployeeConsentCard`

A clearly labelled *simulated employee view* shows the proposed action, the reason, the duration, the expected disruption, whether a restart is required, and the IT approver. The employee can respond in four ways (`EMPLOYEE_RESPOND`):

- **Proceed now:** grants consent, then the gates are re-evaluated.
- **Choose a later time:** grants consent and creates a scheduled job. The bound approval's expiry is aligned to the window (same plan, policy and action), and this is audited.
- **Decline:** escalates.
- **Ask IT for help:** escalates and notifies the agent.

The response is saved on the ticket and shown in the Approvals consent tab and in the workspace counts. Audit events use role `EMPLOYEE`. Consent can only be given after IT approval, because it is only offered in AWAITING_CONSENT.

### 6. Similar incident intelligence — `domain/insights.ts#similarIncidents`

Similarity is a deterministic score:

| Signal | Points |
|---|---|
| Same category (required) | 50 |
| Same runbook | 15 |
| Same OS | 10 |
| Same group | 5 |
| Same source | 5 |
| Description token overlap | up to 15 |

The panel shows outcomes (verified AI resolution, manual, verification failed, rolled back, rollback failed, failed before action, open), modeled resolution minutes, and the runbook used. Failed attempts are always included. Failure patterns are aggregated from the actual verification output and rollback results, and success statistics are derived from records.

## P1

### 7. Incident correlation — `domain/insights.ts#detectClusters`, `LINK_SHARED`, `VERIFY_RECOVERY`

A cluster forms when there are **at least 3 open, unlinked reports** that meet all of these conditions:

- category WIFI, DNS or UNKNOWN;
- on the same non-home network (`networkId`);
- from **at least 2 different employees**;
- within **30 minutes** of the first report.

Clusters show evidence for agent review. **Create parent incident & link** creates an ESCALATED shared incident on a synthetic network-segment device. It moves the children to REVIEW_REQUIRED with a hold reason (`holdReasonFor` makes `evaluateRoute` return REVIEW_REQUIRED). It also cancels their approvals, schedules and paused runs; already-executing runs are not interrupted. Resolving the parent records `NETWORK_RECOVERY_OBSERVED` on the children but **never closes them**. Each child needs **Verify recovery**, a read-only probe that must show the symptom is gone. Demo scenario **J** seeds three reports on `NET-B2`.

### 8. Continuous learning and draft runbooks

A manually resolved ticket can generate a structured, template-based draft marked *AI-generated (simulated)*. The draft includes root cause, applicability, prerequisites, structured steps, verification criteria, risks and recovery instructions. It starts at HIGH risk and maturity L0, with no executable action.

Lifecycle: **Draft → Under review** (needs a validated definition, including a tested scenario) **→ Approved** (Admin only; the reviewer and timestamp are recorded) **→ Supervised execution** (L2, after the first executions) **→ Eligible for policy-based automation** (L3 criteria met).

Only Admins can attach a catalog simulator action or publish. A draft without an action publishes as L1 guidance and can never execute. Version history shows the reviewer, approval time and per-version execution outcomes.

### 9. Business impact and automation funnel — `domain/metrics.ts#businessImpact`, `components/BusinessImpact.tsx`

The impact metrics use the same intake cohort and date range as the KPIs:

- Agent handling hours saved
- Employee downtime avoided
- IT cost savings (agent hours × hourly cost)
- MTTR improvement
- Verified resolution rate
- SLA compliance (met ÷ (met + missed or breached))
- Reopening rate
- Automation-related disruption (disruptive runs × expected minutes, plus failures and rollbacks)

Each metric shows its formula and drills down. The **Assumptions & methodology** dialog (Admin or Manager) edits the hourly cost and per-category manual baselines. It is audited as `ASSUMPTIONS_UPDATED`, and estimates recalculate immediately.

The funnel has four nested stages: **Reported → Eligible → Remediation attempted → Verified AI resolutions**. Each stage drills down.

### 10. Automation maturity — `domain/maturity.ts`, `SET_MATURITY`

Maturity is set per runbook:

| Level | Meaning |
|---|---|
| L0 | Manual (draft / none) |
| L1 | Recommendation (guidance) only |
| L2 | Human-approved execution (the default after any publication) |
| L3 | Policy-based autonomous execution for employee-reported incidents |
| L4 | Also proactive detections |

Policy autonomy also requires the global preapproval switch, LOW risk, a non-disruptive runbook and a score ≥ the auto threshold. Every preflight check still applies.

Promotion goes one level at a time, needs an Admin and a documented reason, and must pass these criteria:

- **L3:** published and reviewed; executable; LOW risk and non-disruptive; ≥ 10 completed executions; ≥ 95 % verified; no rollback failures.
- **L4:** at L3, with ≥ 30 executions at ≥ 97 %.

Demotion is always allowed. Seed state: RB-001 is L4 (the historical pilot), RB-003 is L2 and *eligible* for L3, and all other runbooks are L2.

## Simplified demo dataset and "How it works" page

* **Seed.** The 90-day, 360-ticket history has been replaced with **17 curated past incidents over 6 days, one per path** (`src/domain/examples.ts`, `src/data/seed.ts`), plus the 12 live demo tickets. Every example is created by real actions, so its audit trail is genuine.
* **Dashboard.** The default range is now **7 days** so the numbers match the dataset.
* **Maturity criteria.** Scaled to the small dataset: L3 needs ≥ 3 runs at ≥ 95 %; L4 needs ≥ 5 runs at ≥ 97 %.
* **`/#/guide` (How it works).** The problem, the 7-step flow, the 3 safety rules, a "who decides" table computed from the current policy values, and the full scenario matrix. The matrix has 20 paths in 4 groups: fixed automatically or with one approval; stopped before any change; needs human judgement; something went wrong after a change. Every path links to its seeded example ticket and/or offers a live *Try it*.

## Demonstration scenarios

| # | Scenario | How to reproduce |
|---|---|---|
| 1 | Low-risk policy remediation | Admin → Policies: enable preapproval → Load scenario A (RB-001 is L4) |
| 2 | Wi-Fi explainable approval | Scenario B: assessment, preflight and similar-incident failure patterns, then approve |
| 3 | OS update blocked pending consent | Scenario C: Admin approves and schedules → AWAITING_CONSENT, employee card |
| 4 | Multi-step paused at high-risk step | Seeded scenario **I** (already paused at S3) or C after "advance" |
| 5 | Failed remediation, rollback, escalation | Scenario D (H for rollback failure) |
| 6 | Unknown incident → draft runbook | Scenario E: resolve manually → Propose draft → review → publish (L1) |
| 7 | Shared network incident | Seeded scenario **J** (workspace banner) or Load scenario J |

## Tests

- `src/tests/enhancements.test.ts` covers: the preflight states and gate; battery block; re-validation before the action; step pause; role, impact and scope rules; step rejection, scheduling and invalidation; consent window and assistance; correlation detection, linking, hold and verified recovery; maturity gating and promotion criteria; the draft lifecycle; nested funnel stages; assumption-driven cost; queue priority and deep links; SLA, similarity and the assessment.
- `e2e/flows.spec.ts` covers flows E1–E7, which exercise each scenario in the browser, alongside the original flows 1–10.
