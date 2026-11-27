import { BUCKETS, closedInRange, cohort, fmtPct, guardrails, kpis, previousPeriod, statusBreakdown, type Filters } from '../domain/metrics';
import { buildSeed } from '../data/seed';
import { loadState, validateState, STORAGE_KEY } from '../data/persistence';
import { csvCell } from '../pages/Audit';
import type { AppState, Ticket } from '../domain/types';
import { localDateKey } from '../domain/util';

const NOW = new Date(2026, 10, 27, 15, 0, 0).getTime();
const seed = buildSeed(NOW);

function withTicketAt(s: AppState, createdAt: Date, patch: Partial<Ticket> = {}): AppState {
  const base = Object.values(s.tickets)[0];
  const t: Ticket = { ...base, id: `x-${createdAt.getTime()}`, displayId: 'INC-X', createdAt: createdAt.toISOString(), ...patch };
  return { ...s, tickets: { ...s.tickets, [t.id]: t } };
}

describe('metrics', () => {
  it('date range is inclusive of the full local end day and excludes the next day', () => {
    const empty: AppState = { ...seed, tickets: {} };
    const f: Filters = { from: '2026-11-20', to: '2026-11-21' };
    let s = withTicketAt(empty, new Date(2026, 10, 21, 23, 59, 59));
    s = withTicketAt(s, new Date(2026, 10, 22, 0, 0, 0));
    s = withTicketAt(s, new Date(2026, 10, 20, 0, 0, 0));
    expect(cohort(s, f)).toHaveLength(2);
  });
  it('empty denominators produce em dash, never NaN/Infinity', () => {
    const k = kpis({ ...seed, tickets: {} }, { from: '2020-01-01', to: '2020-01-02' });
    expect(k.northStar).toBeNull();
    expect(fmtPct(k.northStar)).toBe('—');
    expect(fmtPct(k.coverage)).toBe('—');
    const g = guardrails({ ...seed, tickets: {}, executions: [] }, { from: '2020-01-01', to: '2020-01-02' });
    expect(g.verifiedSuccess).toBeNull();
  });
  it('cohort (created) vs closure activity (closedAt) are distinct bases', () => {
    const today = localDateKey(NOW);
    const yesterday = new Date(NOW - 86400000);
    const s = withTicketAt({ ...seed, tickets: {} }, yesterday, { status: 'CLOSED', closedAt: new Date(NOW - 3600000).toISOString(), path: 'MANUAL' });
    const f: Filters = { from: today, to: today };
    expect(cohort(s, f)).toHaveLength(0);
    expect(closedInRange(s, f)).toHaveLength(1);
  });
  it('status buckets are mutually exclusive and sum to the cohort (no double counting)', () => {
    const f: Filters = { from: '2026-08-01', to: localDateKey(NOW) };
    const total = cohort(seed, f).length;
    const sum = statusBreakdown(seed, f).reduce((a, b) => a + b.count, 0);
    expect(sum).toBe(total);
    expect(BUCKETS).toHaveLength(9);
  });
  it('filtered counts respect dimensions', () => {
    const f: Filters = { from: '2026-08-01', to: localDateKey(NOW) };
    const all = kpis(seed, f).total;
    const emp = kpis(seed, { ...f, source: 'EMPLOYEE' }).total;
    const det = kpis(seed, { ...f, source: 'DETECTION' }).total;
    expect(emp + det).toBe(all);
    const storage = kpis(seed, { ...f, category: 'STORAGE' });
    expect(storage.total).toBeGreaterThan(0);
    expect(storage.autoClosed).toBeLessThanOrEqual(storage.total);
  });
  it('seed metrics are computed from records: zero unauthorized, full audit completeness', () => {
    const f: Filters = { from: '2026-08-01', to: localDateKey(NOW) };
    const g = guardrails(seed, f);
    expect(g.unauthorized).toBe(0);
    expect(g.auditCompleteness).toBe(1);
    expect(g.rollbackRate).toBeGreaterThan(0);
    expect(kpis(seed, f).reopenRate).toBeGreaterThan(0);
  });
  it('previous period has equal length immediately before', () => {
    expect(previousPeriod({ from: '2026-11-21', to: '2026-11-27' })).toMatchObject({ from: '2026-11-14', to: '2026-11-20' });
  });
});

describe('persistence and export', () => {
  it('corrupt storage resets safely with a warning', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } as unknown as Storage;
    store.set(STORAGE_KEY, '{"schemaVersion":1,"tickets":');
    const r = loadState(storage, NOW);
    expect(r.warning).toMatch(/reset/);
    expect(validateState(r.state)).toBe(true);
    const again = loadState(storage, NOW);
    expect(again.warning).toBeUndefined();
    expect(Object.keys(again.state.tickets)).toHaveLength(368);
  });
  it('CSV cells are protected against spreadsheet injection', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
  it('seed has no future timestamps and 8 demo scenarios with expected states', () => {
    expect(seed.audit.every((a) => Date.parse(a.at) <= NOW)).toBe(true);
    const demo = Object.values(seed.tickets).filter((t) => t.demo).sort((a, b) => a.displayId.localeCompare(b.displayId));
    expect(demo.map((t) => t.status)).toEqual(['AWAITING_APPROVAL', 'AWAITING_APPROVAL', 'AWAITING_APPROVAL', 'AWAITING_APPROVAL', 'REVIEW_REQUIRED', 'WAITING_DEVICE', 'ESCALATED', 'AWAITING_APPROVAL']);
    expect(seed.executions.every((e) => !e.nextAt)).toBe(true);
  });
});
