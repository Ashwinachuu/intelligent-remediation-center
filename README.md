# Intelligent Remediation Center

**Employees fix what they safely can. IT approves everything else. Nothing runs without a human.**

This is a working prototype for the Freshworks Senior PM assignment (Question 2, Option B: IT Ops & Trust Controls). An employee raises a laptop ticket and AI walks them through safe, adaptive troubleshooting. When that doesn't work, the **same ticket** goes to IT with the full history and an AI-recommended fix. An IT admin must explicitly approve every AI execution. Fixes are verified before a ticket closes, can be rolled back, and are fully audited. Issues the AI can't handle are resolved manually and can become validated, reusable knowledge.

**Current version: V1.2, "Product Simplification & Employee-Admin Experience".** See [`docs/V1.2.md`](docs/V1.2.md). [`docs/Spec.md`](docs/Spec.md) is the original baseline. [`docs/ENHANCEMENTS.md`](docs/ENHANCEMENTS.md) describes V1.1. Where those documents conflict with V1.2, V1.2 wins.

> **Demo mode: the AI and laptop actions are simulated.** All people, devices, tickets and numbers are fictional and generated in your browser. The app sends no real device commands, makes no AI calls and uses no integrations. Confidence scores are deterministic simulated values, not calibrated probabilities.

## The approach in one minute (interview framing)

The goal is not maximum automation. It is to **take the boring work off IT without taking control away from IT**.

* **Two roles only: Employee and IT Admin.** AI is a capability, not an actor.
* **Self-service first.** AI asks one question or gives one step at a time, and only suggests safe steps an employee can do. If the employee confirms the issue is fixed, the ticket closes as *Employee Self-Service*, with no admin effort.
* **Escalate without starting over.** A failed step, low confidence, the attempt limit, or "Get help from IT" all send the same incident to IT, with every answer attached.
* **AI recommends; a human authorizes.** Every AI execution needs explicit admin approval. The approval is bound to the incident, device and exact fix, and a changed plan invalidates it. Disruptive fixes also need the employee's consent.
* **Nothing closes unverified.** If verification fails, the incident stays open and rollback is offered. A rollback is never counted as a resolution.
* **Learn from humans.** A manual fix can be saved as a reusable resolution. An admin validates it, and only then does AI use it for similar tickets.

## 1. Setup

Requires Node 20+.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Use the role switcher (top right) to move between **Employee** and **IT Admin**. Use **Demo scenarios** (top right) to start any of the five scripted scenarios. **Reset demo data** restores the seed.

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript strict |
| `npm run lint` | ESLint, zero warnings |
| `npm run test` | Vitest domain and UI tests |
| `npm run test:e2e` | Playwright end-to-end tests (builds first, uses `vite preview`) |
| `npm run build` | Production build into `dist/` |

### Deploying

This is a static single-page app with hash routing, so no server configuration is needed. On Vercel, the framework is Vite and the output directory is `dist`.

```bash
vercel deploy
```

```bash
vercel deploy --prod
```

The first command creates a preview deployment. The second promotes to production.

## 2. Architecture

* **React 18 + TypeScript + Vite**, a **Zustand** store, **Recharts** and plain CSS. State persists in `localStorage` (`remediation-center:v1`, schema v5). Invalid or older data resets safely with a warning.
* **Pure domain engine** (`src/domain/`). Every change goes through `applyAction(state, action, now)`. It checks role authorization and the transition table, and writes an audit entry for each state change. The UI holds no business logic.

| File | Responsibility |
|---|---|
| `troubleshooting.ts` | Adaptive question and step trees per issue type; validated knowledge adds its own questions and steps |
| `diagnosis.ts` | Simulated AI: category, confidence, root cause, plan hash |
| `policy.ts` | Routing: unsupported/review versus approval → consent → device readiness. There is no autonomous path |
| `preflight.ts` | Prerequisite checks, which are never overridable |
| `engine.ts` | Actions, timed execution runner, verification, rollback, reopen, manual resolution and knowledge |
| `lifecycle.ts` | Maps internal states to the 8 product statuses, the approval status, the resolution method and the employee-facing status |
| `metrics.ts` | Every KPI and chart value, derived from state, plus drill-down definitions |
| `insights.ts` | Workspace queue ("why it's here"), SLA, similar incidents, opportunities |
| `knowledge.ts` | Matching validated resolutions to new tickets |

* **Lifecycle (product statuses):** Open · Self-Service in Progress · Review Needed · Remediation in Progress · New/Unsupported · Manual Investigation · Closed · Reopened. **Overdue** is an SLA indicator, not a status. The resolution method (Self-Service, Human-Approved AI Remediation, Manual) and the approval status (Not Required, Pending, Approved, Rejected, Expired/Invalidated) are tracked separately.

## 3. What each portal does

**Employee:**

* **Raise a Ticket:** pick an issue type and describe it. Guided troubleshooting starts immediately.
* **My Tickets:** a status tracker; guided questions and steps with the answers Yes, No, Not sure, Completed, Unable to complete, Issue resolved and Issue still persists; consent requests; reopen; and the full history.

**IT Admin:**

* **Overview:** date presets (Today, 7, 30 or 90 days, or custom) and an issue filter. A KPI row reconciles to the total. Four success questions: AI-assisted rate, self-service rate, unsupported rate (still open versus since resolved) and estimated admin time saved (with a formula tooltip). Charts: resolved per day, status distribution, AI versus manual, unsupported trend, turnaround, reopen rate and SLA compliance. Every number drills down to the matching incident list.
* **My Workspace:** 5 clickable KPI tiles. The queue defaults to *All action required*, and the chips filter by Pending approval, Human investigation and Overdue. Each row says why it is there.
* **Incidents:** filter by status, approval, method, issue, overdue, date and metric.
* **Incident detail:** the employee's troubleshooting history; the AI recommendation (root cause, confidence, steps, impact and risks); **Approve & Execute / Reject Recommendation / Investigate Manually**; live execution and verification; rollback; manual resolution with *save as reusable resolution*; similar incidents; and activity.
* **Approvals:** pending recommendations, with no duplicates; the queue updates immediately.
* **Opportunities:** recurring and unsupported issue groups with the next action, plus the reusable resolutions awaiting validation (validate or reject).
* **Audit Logs:** filterable, append-only, and exportable as CSV (with injection-safe cells).
* **AI Settings:** confidence threshold (default 80%, labeled a prototype assumption), troubleshooting attempts, employee consent, and time-saving baselines. Approval and verification are **Always on**. Every change is versioned with a reason.

## 4. Demo walkthrough (about 7 minutes)

| # | Scenario (Demo scenarios menu) | What to show |
|---|---|---|
| 1 | **Self-service fix (slow laptop)** | Answer: Today → Whole laptop → No → Yes → Completed ×3 → Issue resolved. The ticket closes as *Employee self-service* with approval *Not required*. Switch to IT Admin: on Overview → Today, the self-service count went up. |
| 2 | **Escalation + approved AI fix (Wi-Fi)** | Answer Yes ×4 and the ticket is *Sent to IT support*. As IT Admin, open the same incident: it shows the employee's answers and the AI recommendation. Click Approve & Execute; the action needs an acknowledgement. As Employee, give consent. Watch it run and verify. As IT Admin: Closed · Human-approved · Verification passed. |
| 3 | **Unfamiliar issue → learning** | The answers lead to *New/Unsupported*. As IT Admin, click Resolve manually and save it as a reusable resolution. In Opportunities, validate it. Run **3b**: the employee now gets the validated steps, and when escalated, the admin sees *From validated resolution K-002*. |
| 4 | **Failed fix → rollback** | Approve, and the employee consents. Verification fails, so the incident stays open (Manual investigation). Roll back: settings are restored, and it is still not counted as resolved. Audit shows the full sequence. |
| 5 | **Reopen** | The employee reopens a resolved ticket. It appears in the admin's *Human investigation* queue as reopened. Run AI diagnosis again to get a recommendation. |

Also worth showing: **Reject** from Approvals (nothing executes); raising the threshold to 90% in AI Settings (pending recommendations are reassessed and audited); and the role switcher hiding admin pages from employees.

## 5. Tests

| Suite | Count | Covers |
|---|---|---|
| `src/tests/v12.test.ts` (Vitest) | 23 | Adaptive branching, self-service closure, escalation with history, attempt limit, network-wide → unsupported, no execution without approval, approval permissions/ack/duplicates, plan binding and invalidation, threshold, consent, failed verification and rollback, irreversible fixes, the knowledge lifecycle and retrieval, reopen, metric reconciliation and formulas, time saved, date filters, workspace filters, no autonomous history, corrupt storage, CSV injection |
| `src/tests/ui.test.tsx` (Vitest + RTL) | 5 | Two roles only, first guided question, role guarding, workspace default, locked settings |
| `e2e/flows.spec.ts` (Playwright) | 8 | Scenarios 1–5 end to end across both roles, reject flow, KPI drill-down reconciliation plus settings and audit filters, every route for both roles, and no horizontal overflow at 375px. Each test also fails on any console error |

Typecheck and lint are clean, all 36 tests pass, and the build succeeds.

## 6. Limitations

* The AI is a deterministic simulator (keyword and telemetry rules, plus knowledge matching by issue type and shared words). It is not an LLM, and its confidence is not calibrated.
* Laptop actions, telemetry, notifications and SLA clocks are simulated in the browser. There are no real endpoint agents, ITSM integration, identity or SSO. The role switcher stands in for authentication.
* Data lives in one browser's `localStorage`. Nothing is shared between users or devices.
* Time-saved figures use configurable baseline minutes (prototype assumptions), not measured effort.
* The 80% threshold, 2 attempts and 60-minute approval expiry are illustrative defaults.
