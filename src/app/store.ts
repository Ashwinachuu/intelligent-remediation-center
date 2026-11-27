import { create } from 'zustand';
import { applyAction, processDue, type Action, type ActionResult } from '../domain/engine';
import type { AppState } from '../domain/types';
import { loadState, saveState, STORAGE_KEY } from '../data/persistence';
import { buildSeed } from '../data/seed';

export interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }
interface Store {
  state: AppState;
  warning?: string;
  multiTab: boolean;
  storageError?: string;
  toasts: Toast[];
  now: number;
  dispatch: (a: Action) => ActionResult;
  tick: () => void;
  reset: () => void;
  replaceState: (s: AppState, message?: string) => void;
  reloadFromStorage: () => void;
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
  multiTab: false,
  toasts: [],
  now: Date.now(),
  dispatch: (a) => {
    const now = Date.now();
    const r = applyAction(get().state, a, now);
    if (r.state !== get().state) {
      const err = saveState(storage, r.state);
      set({ state: r.state, storageError: err, now });
      broadcast();
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
      broadcast();
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
    broadcast();
  },
  replaceState: (next, message) => {
    const err = saveState(storage, next);
    set({ state: next, storageError: err, now: Date.now() });
    if (message) get().toast('success', message);
    broadcast();
  },
  reloadFromStorage: () => { const r = loadState(storage, Date.now()); set({ state: r.state, warning: r.warning, multiTab: false }); },
  toast: (kind, text) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  dismissWarning: () => set({ warning: undefined }),
}));

// ---- Multi-tab detection: warn (no production concurrency claims). ----
const TAB_ID = Math.random().toString(36).slice(2);
let channel: BroadcastChannel | null = null;
function broadcast() { try { channel?.postMessage({ type: 'changed', from: TAB_ID }); } catch { /* ignore */ } }
if (typeof window !== 'undefined') {
  try {
    channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('remediation-center') : null;
    channel?.addEventListener('message', (ev: MessageEvent) => {
      const m = ev.data as { type: string; from: string };
      if (m.from === TAB_ID) return;
      if (m.type === 'hello') channel?.postMessage({ type: 'here', from: TAB_ID });
      useStore.setState({ multiTab: true });
    });
    channel?.postMessage({ type: 'hello', from: TAB_ID });
  } catch { /* ignore */ }
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) useStore.setState({ multiTab: true }); });
}

export const useAppState = () => useStore((s) => s.state);
