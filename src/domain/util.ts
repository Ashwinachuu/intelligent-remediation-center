/** Stable serialization (sorted keys) used for plan hashes. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}

/** FNV-1a 32-bit x2 — consistency control only, NOT cryptographic security. */
export function hashString(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

let deterministicSeed: (() => number) | null = null;
export function setDeterministicIds(seed: number | null) {
  if (seed === null) { deterministicSeed = null; return; }
  deterministicSeed = mulberry32(seed);
}
export function uuid(): string {
  if (!deterministicSeed && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const r = deterministicSeed ?? Math.random;
  const hex = Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const iso = (ms: number) => new Date(ms).toISOString();
export const ms = (isoStr: string) => Date.parse(isoStr);
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Local YYYY-MM-DD for a timestamp. */
export function localDateKey(t: number | string): string {
  const d = new Date(typeof t === 'string' ? Date.parse(t) : t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Local midnight (ms) for a YYYY-MM-DD key. */
export function localDayStart(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + n, 12).getTime());
}
export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((localDayStart(to) - localDayStart(from)) / DAY) + 1;
}
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function ratio(n: number, d: number): number | null {
  if (!d || !Number.isFinite(n) || !Number.isFinite(d)) return null;
  return n / d;
}
