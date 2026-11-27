# Intelligent Remediation Center

**Resolve faster. Intervene when necessary. Stay in control.**

This is a working prototype for the Freshworks Senior PM assignment (Question 2, Option B: IT Ops & Trust Controls). It shows how an AI system can find common laptop problems (Endpoint Health / Laptop Hygiene), suggest fixes from a governed runbook library, and run them only with human approval or an explicit policy. It also covers confidence thresholds, explanations, one-click approval and rollback, verification and a full audit trail.

**Specifications.** [`docs/Spec.md`](docs/Spec.md) is the baseline. [`docs/ENHANCEMENTS.md`](docs/ENHANCEMENTS.md) adds the Product Experience & Trust enhancements and records exactly how each one is implemented:

* agent workspace and prioritized queue
* explainable assessment
* preflight gate
* step-level approval
* employee consent experience
* similar incidents
* incident correlation
* draft runbook lifecycle
* business impact
* automation maturity

> **Demo mode: the AI and endpoint actions are simulated.** All people, devices, tickets and numbers are fictional and generated on your machine. The app makes no real device commands, AI calls, integrations or credential use. Confidence scores are deterministic simulated values, not calibrated probabilities. This is an independent concept inspired by ITSM workflows and is not an official Freshworks product.

---

## 1. Setup

You need Node 22.12+ (or 24 LTS) and npm.

```bash
npm install          # or: npm ci
npm run dev          # http://localhost:5173
npm run build        # typecheck (tsc -b) + Vite production build -> dist/
npm run preview      # serve dist/ (http://localhost:4173)
npm run lint         # ESLint (typescript-eslint + react-hooks), zero warnings allowed
npm run test         # Vitest + React Testing Library (non-watch)
npm run test:e2e     # Playwright core flows (builds + previews automatically)
```

If Playwright browsers are not installed on your machine, run `npx playwright install chromium` once first.

### Deploying (static)

The output is a static site, and hash routes (`/#/...`) survive a refresh with no server rewrites. To deploy on Vercel or any static host, use these settings: framework **Vite**, install `npm ci`, build `npm run build`, output `dist`. See <https://vite.dev/guide/static-deploy.html>. `base: './'` is set so `dist/` also works from a sub-path.

With the Vercel CLI you can deploy directly from the project folder:

```bash
npx vercel deploy --prod
```

A reviewer deployment exists at <https://intelligent-remediation-center.vercel.app>. It is redeployed manually from a local build and does not deploy automatically from git.

**State lives only in the browser.** Everything is stored in `localStorage` under the key `remediation-center:v1`. A shared URL does **not** share the changes a reviewer has made. Each browser starts from its own freshly generated synthetic data.

---

## 2. Architecture

```text
src/
  app/        App (HashRouter + routes), Shell (sidebar, top bar, demo controls, toasts, job runner), Zustand store, scenario loader
  domain/     types, catalog (runbooks, simulator actions, baselines, scenarios), policy, diagnosis, transitions,
              engine (guarded actions + persistent execution runner), metrics (pure selectors), util (hash, dates)
              + preflight (reusable safety checklist), insights (similar incidents, assessment, SLA, correlation, workspace queue),
              maturity (L0–L4 criteria, runbook lifecycle)
  data/       seed (90-day synthetic history + enhancement scenarios I/J), persistence (schema v2 validation, safe reset)
  components/ shared UI (badges, modal, ticket creator)
  pages/      overview, incidents, incident-detail, approvals, library, policies, audit, opportunities, not-found
  tests/      Vitest unit / RTL tests
e2e/          Playwright flows
```

* **Pure domain, guarded mutations.** Every state change goes through `applyAction(state, action, now)` in `domain/engine.ts`. It applies the change to a copy of the state, so the input is never mutated, and returns either a new state or a typed error (`ILLEGAL_TRANSITION`, `UNAUTHORIZED`, `BLOCKED`, `VALIDATION`, `DUPLICATE`, `RETRY_LIMIT`, `CONFLICT`, `EXPIRED`). An error leaves business state untouched. Authorization blocks are appended to the audit log as `AUTHORIZATION_BLOCKED`.
* **Central transitions.** `domain/transitions.ts` holds the allowed status graph. Every status change goes through `Tx.move`, which checks the move against that graph and writes an audit event with the from/to states.
* **Deterministic policy gate.** `evaluateRoute()` in `domain/policy.ts` is the only routing function. The engine, the approval UI, the live route matrix and the sample evaluator all call it.
* **Plan binding.** A plan hash is a stable serialization of device id, diagnosis revision, runbook id/version, risk, policy version and category (FNV-based). It is a consistency check, **not** cryptographic security. Approvals and consent are bound to the plan hash, and approvals also to the policy version. A new diagnosis revision invalidates outstanding approvals, consent and schedules.
* **Persistent job runner.** `processDue(state, now)` advances executions using the persisted `nextAt` timestamps. It runs on mount and every 250 ms. Steps take 700 ms, verification 900 ms and closure 700 ms. After a refresh, jobs resume from those timestamps, and the runner only moves forward, so a duplicate tick adds no audit events. Approval expiry, consent expiry and due schedules are handled in the same loop.
* **Persistence.** The app writes to `localStorage` after every mutation. On load the saved state is validated (schema version and shape). If it is corrupt or from an incompatible version, the app regenerates the seed and shows a warning banner. If a second tab is detected (BroadcastChannel / storage events), a warning recommends using one tab. This is not a production concurrency claim.
* **Metrics are derived, never stored.** `domain/metrics.ts` computes every KPI, chart and guardrail from tickets, executions, approvals and audit events. Zero denominators show `—`, never NaN or Infinity. Every count links to the incident list with an explicit predicate and date basis carried in URL query parameters.

---

## 3. What is implemented

| Area | Status |
|---|---|
| Ticket intake (creator modal on every route, 8 "Load scenario" shortcuts, custom keyword inference, telemetry preview, outcome selector) | ✅ P0 |
| Deterministic diagnosis (scenario + telemetry, mismatch → 65, evidence/uncertainty, revisions, additional-diagnostics re-run) | ✅ P0 |
| Policy gating (thresholds, risk independent of confidence, hard blockers, pause, offline, busy, consent, schedule, role) | ✅ P0 |
| Explicit approval (one click when gates pass, consent / schedule variants, HIGH = admin + window + impact confirmation, TTL, duplicate-click guard) | ✅ P0 |
| Execution → separate verification phase → closure; failure → rollback available or escalated | ✅ P0 |
| Rollback (30-min deadline, restores only the fields that execution changed, refuses on conflict, role by original risk, allowed while paused, failure → manual recovery) | ✅ P0 |
| Escalation, manual verified resolution, reopen (agent or simulated employee), employee-confirm closure mode | ✅ P0 |
| Approvals queue (risk then age, evidence must be expanded before approve, consent tab, expired/invalidated tab, no bulk approval) | ✅ P0 |
| Policies (admin-only, versioned with reason, preapproval confirmation, live matrix, impact preview, re-evaluation, restore defaults as a new version) | ✅ P0 |
| Audit (append-only table, filters, event detail, CSV export with spreadsheet-injection protection) | ✅ P0 |
| Overview dashboard (presets / custom range, filters, 8 KPI cards with previous-period comparison, queue snapshot, 6 chart/panels, exclusive status buckets, drill-downs) | ✅ P0 |
| Runbook library (versioned, derived success rate, draft from manual ticket, admin edit/publish/retire/new version, validation, plan invalidation) | ✅ P0/P1 |
| Opportunities (gap grouping, modeled potential hours, separate policy/endpoint blockers, create draft, no auto-publish) | ✅ P1 |
| CSV export | ✅ P1 |
| **Enhancements** (see docs/ENHANCEMENTS.md): workspace + prioritized queue, three-signal AI assessment, preflight gate, step-level approval, employee consent experience, similar incidents, correlation + parent incidents, AI draft lifecycle, business impact + assumptions, maturity L0–L4 | ✅ P0 + P1 |
| Responsive 1440 → 375 px (drawer nav, scrolling tables, stacked panels), keyboard focus, accessible dialogs, live regions, reduced motion | ✅ |

---

## 4. Simulator and limitations

* **Every action** is an in-memory change to a fictional `Device`: the seven catalog actions RB-001…RB-007. No free-form commands are possible. A runbook is executable only if it is published, validated and maps to a catalog simulator action that matches its category. RB-008 (crash triage) is a diagnostic-only draft.
* **Outcomes are chosen at ticket creation:** Success, Verification failure after action, Execution failure before action, or Rollback failure after verification failure.
* **Durations.** Live executions finish in a few seconds. The UI labels these as *accelerated demo* and shows the actual elapsed time. Analytics use **modeled** minutes (Spec §7: AUTO = expectedMin; HUMAN = expectedMin + 8 + scheduled delay; MANUAL = baseline) and category baselines (Spec §9). These are not measured savings.
* **Synthetic history.** The seed has 90 completed days × 4 tickets = 360, plus 8 demo scenarios dated today. It is generated by driving the real domain actions on a simulated clock, so diagnoses, approvals, consent, executions, verification and audit stay coherent. No timestamp is in the future. History before today used synthetic **policy v0**: preapproval on, auto threshold 97. That is why the SERVICE runbook (score 96) appears as human-approved in history. Current policy **v1** (the spec default, preapproval off) is created at reset, and the historical pending plans are re-evaluated under it.
* **Roles are simulated:** Agent "Alex", Admin "Morgan", Manager "Riley". They are not a security boundary. The audit log lives in `localStorage`. You can inspect it, but it is **not tamper-proof**.
* **Storage.** The seeded state is about 2.5 MB of `localStorage`. If the browser quota is exceeded, a banner asks you to reset the demo.

### Documented decisions (where the spec left room)

1. **Authorization comes before consent.** The spec lists "busy + disruptive → AWAITING_CONSENT" ahead of the approval step. The gate checks approval (or policy) first, then consent, so an employee is never asked to consent to a plan nobody has authorized. Busy + disruptive without consent → AWAITING_CONSENT. Busy with consent, or a non-disruptive plan while busy → WAITING_DEVICE. Nothing executes while the device is busy.
2. **Approval validity for scheduled plans.** An approval expires at `max(approval time, scheduled window) + TTL`. Without this, a window more than 60 minutes out would always expire before its start.
3. **`Ticket.outcome`** holds the simulated outcome chosen in the creator. The final result of each run is stored on `Execution.outcome`.
4. **Diagnosis runs synchronously.** It is deterministic and logged as DIAGNOSIS_STARTED → DIAGNOSIS_COMPLETED. Starting a READY plan, which includes policy-preapproved plans, is asynchronous via the runner. "Approve & execute" starts immediately after the gates are re-checked.
5. **Pre-start cancellation.** If the policy is paused, or the device goes offline or busy, before the action step, the execution is cancelled with no mutation. The consumed approval then counts as rework, and the ticket is routed again (e.g. REVIEW_REQUIRED when paused). Cancelled runs do not count as attempts.
6. **Manual resolution** closes immediately when `closureMode = AUTO`. Under EMPLOYEE_CONFIRM it stays RESOLVED until the simulated employee confirms.
7. **Re-evaluation after a policy save** covers every non-running gate-state ticket. REVIEW_REQUIRED tickets are re-diagnosed only if the engine would now route them differently, so a human "request review" decision is never undone.
8. **"Overdue approval"** means a plan has been waiting longer than the policy approval TTL since its diagnosis.
9. **Opportunity "gaps"** are manual, escalated or review tickets whose current diagnosis has no runbook. Tickets that have a known runbook but are blocked by safety controls are listed separately.

### Known gaps

* No real multi-tab merge: the app only warns (by design for this prototype).
* Charts show text summaries, a legend, tooltips and drill-down links. They do not include a separate full data table.
* Estimated cost savings depend on the configurable hourly cost in **Assumptions & methodology**. They are estimates, not measured savings.
* Similarity, correlation and "AI-generated" drafts are deterministic, rule-based simulations, not machine learning.
* Synthetic history is 90 days old in places. Items older than 7 days appear as an *aged backlog* link instead of crowding the action queue.

---

## 5. Demo walkthrough (enhanced, about 7 minutes)

The **Demo** menu, and **Load scenario** on the Incidents page, create any scenario A–J as a fresh ticket with its own fictional device. The menu also resets all demo data, which needs explicit confirmation. Scenarios I and J are also pre-seeded.

1. **Workspace** (`/#/overview`). Walk through the six tiles: awaiting my approval, in progress, investigation, SLA, verified today and time saved. Then the queue chips, the **shared-incident banner**, and the **prioritized action queue**, where each factor is shown and each row opens the incident at its action. Below the workspace are the analytics: cohort KPIs, the guardrails, the **automation funnel** (reported → eligible → attempted → verified) and **Business impact (estimated)**. Open *Assumptions & methodology* to show that the baselines and hourly cost are editable and drive every estimate.
2. **Low-risk policy-based remediation.** As Admin, go to Policies and enable preapproval with a reason. Load scenario A. It runs with policy authorization because RB-001 is at maturity L4; the preflight snapshot is in the execution record. Load scenario B, which still needs approval.
3. **Explainable Wi-Fi approval (B).** Show the three signals:
   * diagnosis confidence 94;
   * remediation confidence from 90 historical runs;
   * execution readiness: pending authorization and consent.

   Then show "why this recommendation", the preflight checklist, and **similar incidents**, including the failure pattern ("connectivity probe 0/3 … rolled back"). Approve.
4. **Consent.** The *simulated employee view* offers Proceed now, Choose a later time, Ask IT for help, or Decline. Choose a later time: the ticket becomes SCHEDULED and the response appears in Approvals → Awaiting consent. Then advance the schedule. Scenario C shows the HIGH-risk OS patch blocked pending consent after admin approval.
5. **Multi-step pause (I).** Read-only S1 and S2 ran automatically, and the ticket is paused at **S3 Apply patch (HIGH)**. The agent's step approval is disabled with a reason. As Admin, choose *Approve step*, confirm the impact (optionally schedule it), and the action runs after preflight re-validation.
6. **Failure → rollback → escalation (D / H).** Unchanged from the baseline, including snapshot restore and manual recovery instructions.
7. **Unknown incident → draft (E).** Resolve manually, then **Propose runbook draft**, which creates a structured, AI-generated (simulated) draft with root cause, applicability, risks and recovery. Add a tested scenario, then submit for review. As Admin, approve and publish it; it lands as L1 guidance only, never executable. In the Library, **RB-003** shows the eligibility criteria and can be promoted L2 → L3 with a documented reason.
8. **Shared network incident (J).** Click the workspace banner to review the correlation evidence: 3 employees on NET-B2 within 8 minutes. **Create parent incident & link 3** pauses the endpoint fixes. Resolve the parent manually; the children stay open until **Verify recovery** passes its read-only probe.
9. **Close.** Describe the progressive rollout (shadow → human-approved pilot → admin-preapproved low-risk → expand on evidence, now formalized as maturity L0–L4) and the production requirements in Spec §12. Restate that all results, scores and device actions are simulated.

---

## 6. Test results

Results from the last verified run in this repository, on Node 22, Chromium 1.63 (Playwright):

* `npm run lint` is clean (0 errors, 0 warnings).
* `npm run build` passes: `tsc -b` (strict) plus the Vite production build.
* `npm run test` passes **105 tests** across 4 files:
  * **`domain.test.ts` (36).** All baseline Spec §11 rules: policy boundaries at 59/60/79/80/94/95/100; HIGH never auto; pause, unsupported OS, unmanaged, offline and busy routing; stale approval; wrong role; duplicate execution; consent denial and expiry; policy-version invalidation; runbook retirement; schedule re-check; verification failure; irreversible rollback denial; rollback failure; reopening; retry limit; persisted jobs resuming without duplicate audit. HIGH OS plans now also pass through the step approval.
  * **`metrics.test.ts` (10).** Date-range boundaries, empty denominators, cohort versus activity basis, no double counting, filtered counts, previous period, seed coherence (12 demo tickets including I/J), safe reset and CSV injection protection.
  * **`enhancements.test.ts` (53).**
    * Preflight PASS/PENDING/NA states; low battery blocking execution; audit records; re-validation before the action.
    * Step-level approval: pause with no mutation, admin and impact rules, scope, rejection, scheduling and advance, invalidation when the runbook changes.
    * Consent: window choice synced to the workspace, IT assistance; consent never replaces approval.
    * Correlation: detection thresholds, linking with hold, verified recovery only.
    * Maturity: L3 versus L4 gating, admin-only promotion criteria.
    * AI draft lifecycle and reviewer.
    * Nested funnel, assumption-driven cost, empty-denominator estimates, queue priority and deep links, SLA, similarity failure patterns and the assessment signals.
  * **`ui.test.tsx` (6).** Overview, approve, HIGH block, manager read-only, not-found and read-only policies.
* `npm run test:e2e` passes **17 / 17** Playwright flows: Spec §11 flows 1–10, plus enhancement flows E1–E7.
  * **E1:** a workspace queue item deep-links to the action.
  * **E2:** a preflight battery block, then recovery.
  * **E3:** the multi-step pause, the agent blocked, the admin approving the step.
  * **E4:** the employee-selected window.
  * **E5:** correlation, then parent, then verified child recovery.
  * **E6:** draft → review → publish (L1) and RB-003 promotion to L3.
  * **E7:** assumptions changing the cost estimate.

  Every flow asserts that no console errors occurred, and flow 10 checks for horizontal overflow at 375 px.
