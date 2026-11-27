import { applyAction, type Action } from '../domain/engine';
import { DEMO_EMPLOYEE } from '../domain/catalog';
import type { Actor, AppState, Role } from '../domain/types';
import { PATHS } from '../data/seed';
import { useStore } from './store';

/**
 * Predefined demonstration scenarios (V1.2 §20). They replace the old visible simulation controls:
 * each creates a fresh ticket for the demo employee (Jordan Lee) and, where useful, plays the earlier steps
 * through the real actions so the presenter starts at the interesting moment. Outcomes (e.g. a failing fix)
 * are part of the scenario definition, not toggles.
 */
export interface DemoScenario { key: string; title: string; description: string; role: Role; run: (go: Runner) => string }
type Runner = { act: (a: Action, actor: 'EMPLOYEE' | 'ADMIN') => string | undefined };

const ME: Actor = { name: DEMO_EMPLOYEE.name, role: 'EMPLOYEE' };
const ADMIN: Actor = { name: 'Morgan (IT Admin)', role: 'ADMIN' };

export const DEMO_SCENARIOS: DemoScenario[] = [
  { key: '1', title: 'Self-service fix (slow laptop)', role: 'EMPLOYEE', description: 'Employee answers the AI questions, follows safe steps and confirms — closes with no admin approval.',
    run: (r) => r.act({ type: 'CREATE_TICKET', input: { title: 'Laptop running slowly', description: 'Everything is slow since this morning.', issueType: 'SLOW', scenario: 'S1', demo: true } }, 'EMPLOYEE')! },
  { key: '2', title: 'Escalation + approved AI fix (Wi-Fi)', role: 'EMPLOYEE', description: 'Guided steps don’t fix the Wi-Fi; the same ticket goes to IT; admin approves; AI fixes and verifies.',
    run: (r) => r.act({ type: 'CREATE_TICKET', input: { title: 'Cannot stay connected to Wi-Fi', description: 'Wi-Fi drops every few minutes at my desk.', issueType: 'WIFI', scenario: 'S2', demo: true } }, 'EMPLOYEE')! },
  { key: '3', title: 'Unfamiliar issue → learning', role: 'EMPLOYEE', description: 'AI has no fix; admin resolves manually and saves a reusable resolution; validate it, then run 3b.',
    run: (r) => r.act({ type: 'CREATE_TICKET', input: { title: 'External monitor flickers when docked', description: 'My second monitor flickers whenever the laptop is on the dock.', issueType: 'OTHER', scenario: 'S3', demo: true } }, 'EMPLOYEE')! },
  { key: '3b', title: 'Similar issue after learning', role: 'EMPLOYEE', description: 'A new, similar report — AI now suggests the validated fix (validate the resolution from scenario 3 first).',
    run: (r) => r.act({ type: 'CREATE_TICKET', input: { title: 'Monitor flickering on the dock', description: 'Screen flickers when docked at my desk.', issueType: 'OTHER', scenario: 'S3b', demo: true } }, 'EMPLOYEE')! },
  { key: '4', title: 'Failed fix → rollback', role: 'ADMIN', description: 'Starts at Review needed. Approve: the fix runs but verification fails; roll back — the incident stays open.',
    run: (r) => {
      const id = r.act({ type: 'CREATE_TICKET', input: { title: 'Wi-Fi unstable after dock change', description: 'Wireless drops since I started using a new dock.', issueType: 'WIFI', outcome: 'VERIFY_FAIL', scenario: 'S4', demo: true } }, 'EMPLOYEE')!;
      for (const a of PATHS.wifiEscalate) r.act({ type: 'TS_ANSWER', ticketId: id, answer: a }, 'EMPLOYEE');
      return id;
    } },
  { key: '5', title: 'Reopen a resolved ticket', role: 'EMPLOYEE', description: 'Starts with a ticket the employee already fixed; reopen it because the problem came back.',
    run: (r) => {
      const id = r.act({ type: 'CREATE_TICKET', input: { title: 'Low disk space warning', description: 'Says my disk is almost full.', issueType: 'STORAGE', scenario: 'S5', demo: true } }, 'EMPLOYEE')!;
      for (const a of PATHS.storageResolved) r.act({ type: 'TS_ANSWER', ticketId: id, answer: a }, 'EMPLOYEE');
      return id;
    } },
];

/** Runs a scenario through the store (one persisted update) and returns the route to open. */
export function runScenario(key: string): string | undefined {
  const sc = DEMO_SCENARIOS.find((x) => x.key === key)!;
  const store = useStore.getState();
  let s: AppState = store.state;
  const now = Date.now();
  let i = 0;
  let err: string | undefined;
  const runner: Runner = { act: (a, who) => {
    const r = applyAction(s, a, now - 60_000 + (i++) * 1000, { actor: who === 'ADMIN' ? ADMIN : ME });
    if (!r.ok) { err = r.error?.message; return undefined; }
    s = r.state;
    return r.ticketId;
  } };
  const id = sc.run(runner);
  if (err || !id) { store.toast('error', err ?? 'Scenario could not be created'); return undefined; }
  s = { ...s, ui: { role: sc.role } };
  store.replaceState(s, `Scenario ${sc.key} ready: ${sc.title}`);
  return sc.role === 'ADMIN' ? `/incidents/${id}` : `/my-tickets/${id}`;
}
