// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7373 — a CEL `defaultValue` stores the DECLARED TYPE's contract shape, not
 * the raw `Date` the temporal stdlib returns.
 *
 * `applyFieldDefaults` produces a default three ways, and only two of them
 * honoured the stored-value contract: the `NOW()` token routes through
 * `resolveNowDefault`, a literal is checked against `valueSchemaFor(def,
 * 'stored')` at author time (#7127) — and the expression envelope's result was
 * assigned verbatim. ADR-0053 D1 makes `today()` / `daysFromNow(n)` /
 * `daysAgo(n)` return a **JS `Date`** (UTC-midnight of the reference-tz
 * calendar day) and `now()` the raw instant, so
 * `{ dialect: 'cel', source: 'daysFromNow(7)' }` on a `datetime` put a `Date`
 * OBJECT in the column while `valueSchemaFor` names an ISO-8601 string. The
 * platform's own `os migrate value-shapes` scan reports such a row as a
 * violation.
 *
 * The assertions below check the stored value against `valueSchemaFor` itself
 * rather than against a hand-copied string shape: the contract is what was
 * violated, so the contract — not a restatement of it — is what pins the fix.
 * `JSON.stringify` renders a `Date` as its ISO string, which is exactly why
 * the original defect read as correct; every pin here therefore asserts the
 * TYPE as well as the text.
 *
 * The driver is a store-as-handed stub, which is the memory driver's observable
 * behaviour (it applies its temporal canon to filter comparands only) and the
 * one backend where the defect is visible: `SqlDriver.formatInput` coerces a
 * `Date` through `canonicalUtcDatetime`/`toDateOnly` at the wire and mongodb's
 * `storageDatetimeValue`/`storageDateValue` do the same, so those two already
 * stored the shape this change now produces engine-side for everyone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { valueSchemaFor } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

const cel = (source: string) => ({ dialect: 'cel' as const, source });

/**
 * One object carrying every branch that matters side by side, so a control and
 * its subject are defaulted by the SAME insert and cannot drift apart through
 * two differently-configured rigs.
 */
const DEFAULTED = {
  name: 'cel_default_probe',
  label: 'CEL Default Probe',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },

    // ── subjects: CEL defaults whose result is a `Date` ──────────────
    dt_now: { name: 'dt_now', label: 'dt now', type: 'datetime' as const, defaultValue: cel('now()') },
    dt_days: { name: 'dt_days', label: 'dt days', type: 'datetime' as const, defaultValue: cel('daysFromNow(7)') },
    dt_today: { name: 'dt_today', label: 'dt today', type: 'datetime' as const, defaultValue: cel('today()') },
    d_today: { name: 'd_today', label: 'd today', type: 'date' as const, defaultValue: cel('today()') },
    d_days: { name: 'd_days', label: 'd days', type: 'date' as const, defaultValue: cel('daysAgo(3)') },
    t_now: { name: 't_now', label: 't now', type: 'time' as const, defaultValue: cel('now()') },

    // ── controls: the `NOW()` token, byte-identical before and after ──
    tok_dt: { name: 'tok_dt', label: 'tok dt', type: 'datetime' as const, defaultValue: 'NOW()' },
    tok_d: { name: 'tok_d', label: 'tok d', type: 'date' as const, defaultValue: 'NOW()' },
    tok_t: { name: 'tok_t', label: 'tok t', type: 'time' as const, defaultValue: 'NOW()' },

    // ── controls: literals, untouched by this path ────────────────────
    lit_txt: { name: 'lit_txt', label: 'lit txt', type: 'text' as const, defaultValue: 'plain' },
    lit_dt: {
      name: 'lit_dt', label: 'lit dt', type: 'datetime' as const,
      defaultValue: '2020-01-02T03:04:05.678Z',
    },

    // ── controls: CEL results that are NOT dates, passed through ──────
    cel_str: { name: 'cel_str', label: 'cel str', type: 'text' as const, defaultValue: cel("'hello'") },
    cel_num: { name: 'cel_num', label: 'cel num', type: 'number' as const, defaultValue: cel('1 + 2') },
    cel_bool: { name: 'cel_bool', label: 'cel bool', type: 'boolean' as const, defaultValue: cel('true') },
  },
};

/**
 * A driver that stores exactly what the engine hands it. Deliberately WITHOUT
 * the temporal coercion the SQL/mongodb drivers apply on write: those repair a
 * `Date` at the wire, which is precisely what hid this defect on SQL-backed
 * stores. Storing as-handed is what makes the engine's own output observable.
 */
function makeStoreAsHandedDriver() {
  const rows = new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find() { return Array.from(rows.values()).map((r) => ({ ...r })); },
    async findOne() { for (const r of rows.values()) return { ...r }; return null; },
    async create(_object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      rows.set(id, row);
      return { ...row };
    },
    async update(_object: string, id: string, data: Record<string, unknown>) {
      const cur = rows.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      rows.set(id, next);
      return { ...next };
    },
    async updateMany() { return 0; },
    async upsert(object: string, data: Record<string, unknown>) { return this.create(object, data); },
    async delete(_object: string, id: string) { return rows.delete(id); },
    async count() { return rows.size; },
    async bulkCreate(object: string, batch: Record<string, unknown>[]) {
      const out: Record<string, unknown>[] = [];
      for (const r of batch) out.push(await this.create(object, r));
      return out;
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rows };
}

async function makeEngine() {
  const engine = new ObjectQL();
  const rig = makeStoreAsHandedDriver();
  engine.registerDriver(rig.driver as never, true);
  await engine.init();
  engine.registry.registerObject(DEFAULTED as never);
  return { engine, ...rig };
}

/** The stored row after one defaults-only insert. */
async function insertDefaulted(
  context?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { engine, rows } = await makeEngine();
  await (engine as unknown as {
    insert(o: string, d: unknown, opts?: unknown): Promise<unknown>;
  }).insert('cel_default_probe', {}, context ? { context } : undefined);
  return Array.from(rows.values())[0];
}

/** Assert a stored value satisfies its field's own ADR-0104 stored contract. */
function expectStoredShape(value: unknown, type: string): void {
  const parsed = valueSchemaFor({ type }, 'stored').safeParse(value);
  expect(
    parsed.success ? null : `${type}: ${parsed.error.issues[0]?.message} (got ${Object.prototype.toString.call(value)})`,
  ).toBeNull();
}

// A fixed instant whose UTC calendar day and its Los_Angeles calendar day are
// DIFFERENT days: 2026-08-10T05:00Z is 2026-08-09 22:00 in America/Los_Angeles.
// Every reference-tz assertion below turns on that gap.
const PINNED_NOW = new Date('2026-08-10T05:00:00.000Z');

describe('#7373 — a CEL `defaultValue` stores the declared type\'s contract shape', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_NOW);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('stores an ISO-8601 STRING on `datetime`, never a `Date` object', async () => {
    const row = await insertDefaulted();

    for (const field of ['dt_now', 'dt_days', 'dt_today'] as const) {
      // The defect precisely: the value was a `Date`, which JSON.stringify
      // renders as the right text — so assert the type, not just the text.
      expect(row[field]).not.toBeInstanceOf(Date);
      expect(typeof row[field]).toBe('string');
      expectStoredShape(row[field], 'datetime');
    }

    // …and the instants themselves are the ones CEL computed.
    expect(row.dt_now).toBe('2026-08-10T05:00:00.000Z');
    expect(row.dt_days).toBe('2026-08-17T00:00:00.000Z'); // UTC-midnight calendar day + 7
  });

  it('stores `YYYY-MM-DD` on `date`, never a `Date` object', async () => {
    const row = await insertDefaulted();

    for (const field of ['d_today', 'd_days'] as const) {
      expect(row[field]).not.toBeInstanceOf(Date);
      expect(typeof row[field]).toBe('string');
      expectStoredShape(row[field], 'date');
    }

    expect(row.d_today).toBe('2026-08-10');
    expect(row.d_days).toBe('2026-08-07');
  });

  it('stores a wall clock on `time`, never a `Date` object', async () => {
    const row = await insertDefaulted();
    expect(row.t_now).not.toBeInstanceOf(Date);
    expectStoredShape(row.t_now, 'time');
    expect(row.t_now).toBe('05:00:00');
  });

  /**
   * The day-shift guard. ADR-0053 D1 fixes `today()` as UTC-midnight OF the
   * reference-tz calendar day, so the serialization must read the parts back
   * with UTC getters — the same `getUTC*` the ADR names for the driver filter
   * path. Reading them in LOCAL time is the move that shifts a day, and this
   * is the case that would catch it: at the pinned instant the UTC day is the
   * 10th while the Los_Angeles day is the 9th.
   */
  it('keeps the REFERENCE-TZ calendar day on `date` — no off-by-one', async () => {
    const row = await insertDefaulted({ isSystem: true, timezone: 'America/Los_Angeles' });

    expect(row.d_today).toBe('2026-08-09'); // the LA day, not the UTC 10th
    expectStoredShape(row.d_today, 'date');

    // The same reference day, one week out, on a `datetime`: still the LA day
    // at UTC-midnight, so the calendar arithmetic and the serialization agree.
    expect(row.dt_days).toBe('2026-08-16T00:00:00.000Z');
  });

  it('leaves the `NOW()` token byte-identical (control)', async () => {
    const row = await insertDefaulted();

    // Exactly `resolveNowDefault`'s table — unchanged by this fix, which is the
    // point: the CEL branch now shares that table rather than owning a copy.
    expect(row.tok_dt).toBe('2026-08-10T05:00:00.000Z');
    expect(row.tok_d).toBe('2026-08-10');
    expect(row.tok_t).toBe('05:00:00');
    for (const [f, t] of [['tok_dt', 'datetime'], ['tok_d', 'date'], ['tok_t', 'time']] as const) {
      expect(row[f]).not.toBeInstanceOf(Date);
      expectStoredShape(row[f], t);
    }
  });

  it('leaves LITERAL defaults untouched (control)', async () => {
    const row = await insertDefaulted();
    expect(row.lit_txt).toBe('plain');
    expect(row.lit_dt).toBe('2020-01-02T03:04:05.678Z');
  });

  it('passes NON-date CEL results through unchanged (control)', async () => {
    const row = await insertDefaulted();

    // Normalization is scoped to temporal FORM; a CEL default's result type is
    // otherwise a runtime concern and must not be rewritten.
    expect(row.cel_str).toBe('hello');
    expect(row.cel_num).toBe(3);
    expect(row.cel_bool).toBe(true);
  });

  it('does not touch a value the caller supplied explicitly', async () => {
    const { engine, rows } = await makeEngine();
    const explicit = new Date('2001-02-03T04:05:06.007Z');
    await (engine as unknown as {
      insert(o: string, d: unknown): Promise<unknown>;
    }).insert('cel_default_probe', { dt_now: explicit });
    const row = Array.from(rows.values())[0];

    // Defaults apply only to an omitted/null slot. A caller-supplied `Date` is
    // the drivers' business (SQL/mongodb coerce it at the wire), not this
    // path's — narrowing the change to what the issue measured.
    expect(row.dt_now).toBe(explicit);
  });
});
