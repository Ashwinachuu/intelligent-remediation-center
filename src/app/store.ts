import { create } from 'zustand';
import { applyAction, processDue, type Action, type ActionResult } from '../domain/engine';
import type { AppState } from '../domain/types';
import { loadState, saveState, STORAGE_KEY, validateState } from '../data/persistence';
import { buildSeed } from '../data/seed';

export interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }
interface Store {
  state: AppState;
  warning?: string;
  storageError?: string;
  toasts: Toast[];
  now: number;
  dispatch: (a: Action) => ActionResult;
  tick: () => void;
  reset: () => void;
  replaceState: (s: AppState, message?: string) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  dismissWarning: () => void;
}
const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
let toastId = 0;
const initial = loadState(storage, Date.now());

export const useStore = create<Store>((set, get) => ({
  state: initial.state,
  warning: initial.warning,
  toasts: [],
  now: Date.now(),
  dispatch: (a) => {
    const now = Date.now();
    const r = applyAction(get().state, a, now);
    if (r.state !== get().state) {
      const err = saveState(storage, r.state);
      set({ state: r.state, storageError: err, now });
    }
    if (r.ok && r.message) get().toast('success', r.message);
    if (!r.ok && r.error) get().toast('error', r.error.message);
    return r;
  },
  tick: () => {
    const now = Date.now();
    const s = get().state;
    const next = processDue(s, now);
    if (next !== s) {
      const err = saveState(storage, next);
      set({ state: next, now, storageError: err });
    } else set({ now });
  },
  reset: () => {
    const fresh = buildSeed(Date.now());
    const withEvent: AppState = {
      ...fresh,
      seq: { ...fresh.seq, audit: fresh.seq.audit + 1 },
      audit: [...fresh.audit, { id: `reset-${Date.now()}`, seq: fresh.seq.audit + 1, at: new Date().toISOString(), actor: 'Reviewer', role: get().state.ui.role, action: 'DEMO_RESET', reason: 'Demo data reset by reviewer (explicit destructive action)', metadata: {}, result: 'INFO' }],
    };
    saveState(storage, withEvent);
    set({ state: withEvent, warning: undefined });
    get().toast('info', 'Demo data reset');
  },
  replaceState: (next, message) => {
    const err = saveState(storage, next);
    set({ state: next, storageError: err, now: Date.now() });
    if (message) get().toast('success', message);
  },
  toast: (kind, text) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  dismissWarning: () => set({ warning: undefined }),
}));

// ---- Keep tabs in sync: when another tab saves, adopt its state (all tabs share one saved demo). ----
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try { const next: unknown = JSON.parse(e.newValue); if (validateState(next)) useStore.setState({ state: next, now: Date.now() }); } catch { /* ignore unreadable updates */ }
  });
}

export const useAppState = () => useStore((s) => s.state);
