import { REQUESTERS, SCENARIOS } from '../domain/catalog';
import type { ScenarioKey } from '../domain/types';
import { useStore } from './store';

/** Scenario loader: creates a FRESH ticket + fresh fictional device (never mutates shared devices). */
export function loadScenario(key: ScenarioKey): string | undefined {
  const sc = SCENARIOS.find((s) => s.key === key)!;
  const n = Object.keys(useStore.getState().state.tickets).length;
  if (key === 'J') {
    // Three employees on the same office network report within the correlation window.
    let first: string | undefined;
    for (let k = 0; k < 3; k++) {
      const r = useStore.getState().dispatch({ type: 'CREATE_TICKET', input: { title: sc.title, description: sc.description, requester: REQUESTERS[(n + k) % REQUESTERS.length], source: sc.source, priority: sc.priority, category: sc.category, outcome: sc.outcome, newDevice: sc.device, scenario: 'J', demo: true } });
      if (!r.ok) return first;
      first ??= r.ticketId;
    }
    return first;
  }
  const r = useStore.getState().dispatch({ type: 'CREATE_TICKET', input: {
    title: sc.title, description: sc.description, requester: REQUESTERS[n % REQUESTERS.length], source: sc.source, priority: sc.priority,
    category: sc.category, outcome: sc.outcome, newDevice: sc.device, scenario: sc.key, demo: true,
  } });
  return r.ok ? r.ticketId : undefined;
}
