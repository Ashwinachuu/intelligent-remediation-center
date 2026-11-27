# Intelligent Remediation Center

**Resolve faster. Intervene when necessary. Stay in control.**

This is a working prototype for the Freshworks Senior PM assignment (Question 2, Option B: IT Ops & Trust Controls). It shows how an AI system can find common laptop problems (Endpoint Health / Laptop Hygiene), suggest fixes from a governed runbook library, and run them only with human approval or an explicit policy. It also covers confidence thresholds, explanations, one-click approval and rollback, verification and a full audit trail.

> **Demo mode: the AI and endpoint actions are simulated.** All people, devices, tickets and numbers are fictional and generated on your machine. The app makes no real device commands, AI calls, integrations or credential use. Confidence scores are deterministic simulated values, not calibrated probabilities. This is an independent concept inspired by ITSM workflows and is not an official Freshworks product.

---

## 1. Setup

You need Node 22.12+ (or 24 LTS) and npm.

```bash
npm install          # or: npm ci
npm run dev          # http://localhost:5173
npm run build        # typecheck (tsc -b) + Vite production build -> dist/
npm run preview      # serve dist/ (http://localhost:4173)
npm run test         # Vitest + React Testing Library (non-watch)
npm run test:e2e     # Playwright core flows (builds + previews automatically)
```

If Playwright browsers are not installed on your machine, run `npx playwright install chromium` once first.

### Deploying (static)

The output is a static site, and hash routes (`/#/...`) survive a refresh with no server rewrites. To deploy on Vercel or any static host, use these settings: framework **Vite**, install `npm ci`, build `npm run build`, output `dist`. See <https://vite.dev/guide/static-deploy.html>. `base: './'` is set so `dist/` also works from a sub-path. **The prototype has not been deployed as part of this delivery.**

**State lives only in the browser.** Everything is stored in `localStorage` under the key `remediation-center:v1`. A shared URL does **not** share the changes a reviewer has made. Each browser starts from its own freshly generated synthetic data.

---

## 2. Architecture

```text
src/
  app/        App (HashRouter + routes), Shell (sidebar, top bar, demo controls, toasts, job runner), Zustand store, scenario loader
  domain/     types, catalog (runbooks, simulator actions, baselines, scenarios), policy, diagnosis, transitions,
              engine (guarded actions + persistent execution runner), metrics (pure selectors), util (hash, dates)
  data/       seed (90-day synthetic history), persistence (schema validation, safe reset)
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
* Modeled cost savings are omitted because no hourly-cost setting is implemented (per Spec §9).

---

## 5. Demo walkthrough (5–7 minutes)

1. **Overview** (`/#/overview`). Show the intake cohort versus the closure/resolution activity basis, the north star (*verified AI-assisted resolution rate among eligible tickets*) next to coverage, the guardrails (zero unauthorized executions, rollback rate, audit completeness) and the current queue strip. Click any card to open its exact cohort.
2. **Scenario A (storage).** Open it from the Incidents list. Show the evidence, the simulated-score meter against the thresholds, the change preview (3 → 11 GB), irreversibility and the policy reason. Click **Approve & execute** and watch the steps, verification and auto-close. The dashboard updates.
3. **Controlled autonomy.** Switch the role to **Admin**, go to Policies, enable preapproval (confirm it, give a reason, save v2), then click **Load scenario → A**. The ticket auto-runs with *policy v2* recorded as its authorization. **Load scenario → B** (Wi-Fi, MEDIUM) still needs approval.
4. **Confidence vs risk.** In scenario C (OS patch, score 93, HIGH), the agent's approve button is disabled with a reason. As Admin, use **Approve & schedule**: pick a window, confirm the impact, simulate employee consent, then click **Advance scheduled job to now**.
5. **Failure handling.** Run scenario D: approve, grant consent, and verification fails, so the ticket is **not** resolved. Click **Roll back now** and the snapshot is restored (Wi-Fi healthy goes back to false), then the ticket is escalated. Show the Activity tab and the Audit event details. Scenario H shows a rollback failure with manual recovery instructions.
6. **Unknown incident.** Scenario E (crash, 68): add evidence (unconfirmed evidence stays uncertain), **Resolve manually** with a verification checkbox, then **Propose runbook draft**. The draft is HIGH risk, not preapproved and not executable until an Admin validates and publishes it. **Opportunities** ranks the gaps by modeled potential hours.
7. **Close.** Describe the progressive rollout (shadow → human-approved pilot → admin-preapproved low-risk → expand on evidence) and the production requirements in Spec §12. Restate that all results, device actions and scores are simulated.

The **Demo** menu in the top bar loads any scenario A–H as a fresh ticket with its own fictional device, and can reset all demo data (explicit confirmation required).

---

## 6. Test results

Results from the last verified run in this repository, on Node 22, Chromium 1.63 (Playwright):

* `npm run build` passes: `tsc -b` (strict) plus the Vite production build.
* `npm run test` passes **52 tests** across 3 files:
  * **`domain.test.ts` (36).** Policy boundaries at 59/60/79/80/94/95/100; HIGH/MEDIUM never auto-execute; pause, unsupported OS, unmanaged device, disallowed group, offline and busy routing; missing runbook; threshold validation; illegal transitions. Telemetry-mismatch diagnosis and keyword inference. The full approve → execute → verify → close flow with audit. Wrong role, including an audited block with no mutation. HIGH schedule + impact rules and the schedule re-check when the device goes offline. Advancing the schedule. Duplicate approve/start. Consent denial and consent expiry. Stale approval. Policy version invalidation. Runbook retirement. Pause before the action step with no mutation. Verification failure → rollback → snapshot restored. Rollback failure. Irreversible rollback denied. Execution failure with the retry limit. Reopen. Preapproval for LOW but not MEDIUM. Manual resolution and draft creation with no auto-activation. Persisted jobs resuming after refresh with duplicate ticks adding no audit events.
  * **`metrics.test.ts` (10).** Inclusive local date-range boundary; empty denominators show `—`; cohort versus closure-activity basis; mutually exclusive buckets with no double counting; filtered counts; seed guardrails (0 unauthorized, 100% audit completeness); previous period; safe reset on corrupt storage; CSV injection protection; seed coherence (no future timestamps, 8 demo states, no pre-running jobs).
  * **`ui.test.tsx` (6).** The overview renders; an agent approves scenario A; the agent is blocked on HIGH; the manager view is read-only; the not-found page; the policies page is read-only.
* `npm run test:e2e` passes **10 / 10** Playwright flows, matching Spec §11 items 1–10. Every test also asserts that no console errors occurred. Flow 10 checks every route, the filters and reset, and that there is no horizontal overflow at 375 px.
