import type { AppState } from '../domain/types';
import { buildSeed } from './seed';

export const STORAGE_KEY = 'remediation-center:v1';
export const SCHEMA_VERSION = 1;

/** Shallow structural validation — rejects corrupt or incompatible payloads. */
export function validateState(x: unknown): x is AppState {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  if (s.schemaVersion !== SCHEMA_VERSION) return false;
  const arrays = ['diagnoses', 'runbooks', 'policyHistory', 'approvals', 'executions', 'jobs', 'audit', 'notifications'];
  if (!arrays.every((k) => Array.isArray(s[k]))) return false;
  if (!s.tickets || typeof s.tickets !== 'object' || !s.devices || typeof s.devices !== 'object') return false;
  const p = s.policy as Record<string, unknown> | undefined;
  if (!p || typeof p.version !== 'number' || typeof p.reviewThreshold !== 'number') return false;
  if (!s.seq || typeof (s.seq as Record<string, unknown>).ticket !== 'number') return false;
  if (typeof s.anchor !== 'string' || !s.settings) return false;
  for (const t of Object.values(s.tickets as Record<string, Record<string, unknown>>)) {
    if (typeof t.id !== 'string' || typeof t.status !== 'string' || typeof t.deviceId !== 'string' || !(t.deviceId in (s.devices as object))) return false;
  }
  return true;
}

export interface LoadResult { state: AppState; warning?: string; fresh: boolean }
export function loadState(storage: Storage | undefined, now: number): LoadResult {
  let raw: string | null = null;
  try { raw = storage?.getItem(STORAGE_KEY) ?? null; } catch { /* storage unavailable */ }
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (validateState(parsed)) return { state: parsed, fresh: false };
    } catch { /* fallthrough */ }
    const state = buildSeed(now);
    saveState(storage, state);
    return { state, fresh: true, warning: 'Saved demo data was corrupt or from an incompatible version and has been safely reset.' };
  }
  const state = buildSeed(now);
  saveState(storage, state);
  return { state, fresh: true };
}

export function saveState(storage: Storage | undefined, state: AppState): string | undefined {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); return undefined; }
  catch (e) { return e instanceof Error ? e.message : 'Storage write failed'; }
}
