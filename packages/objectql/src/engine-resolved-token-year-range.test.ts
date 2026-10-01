// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20844] A relative-date placeholder is judged by the year of the value it
 * resolved to: outside its column's years (a `date` 0001..9999, a `datetime`
 * 1000..9999 — `@objectstack/core`'s `isOutsideTemporalYearRange`) it is
 * refused `INVALID_FILTER` / 400, naming the placeholder and the year, on
 * every position the resolver serves, before any driver read.
 *
 * Measured on the base (`2f2fa11d7`) through `engine.find` on InMemoryDriver
 * and `POST /api/v1/data/:object/query` on SqlDriver over SQLite, two rows
 * (`opened_at` 2026-03-01T10:00Z and 1500-03-01T10:00Z):
 *
 * | `where` | resolved to | memory | SQLite | now |
 * |:--|:--|:--|:--|:--|
 * | `opened_at $gt {8000_years_from_now}` | `10026-10-01` | both rows | both rows | 400 |
 * | `opened_at $lt {2027_years_ago}` | `-1-10-01`, read as 2001-01-10 | the 1500 row | the 1500 row | 400 |
 * | `opened_at $lt {1977_years_ago}` | `0049-10-01` | no row | no row | 400 (the `datetime` floor) |
 * | `placed_on $gt {8000_years_from_now}` | `10026-10-01` | both rows | both rows | 400 |
 * | `having` `max(opened_at) $gt {8000_years_from_now}` | `10026-10-01` | both groups | — | 400 |
 * | `opens_at` (`time`, 09:00 / 12:00) `$gt {8000_years_from_now}` | `10026-10-01`, compared as text | both rows | both rows | 400 (the [#20480] class) |
 * | `judgeFilter` of the first two | | `{ ok: true }` | | refused |
 *
 * The right answer to each `$gt` / `$lt` above was no row; a literal of each
 * resolved value was already refused by the temporal-comparand door, which
 * steps around a placeholder. The refusal sits in front of every driver, so
 * this file's recording driver is enough to pin it (the memory row by
 * construction: the refusal answers before a driver is asked); the REST door
 * over SQLite, with the rows, is `packages/rest/src/data-resolved-token-year-range.test.ts`.
 * Every refusal sits beside its control: a placeholder that resolves inside
 * the range reaches the driver as the day it names.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from './engine.js';

// Wed 2026-09-30 12:00 UTC: every resolved day below is read off this instant.
const PINNED_NOW = new Date('2026-09-30T12:00:00.000Z');

const ledger = {
  name: 'ledger',
  label: 'Ledger',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    customer_id: { name: 'customer_id', type: 'text' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
    opens_at: { name: 'opens_at', type: 'time' as const },
    note: { name: 'note', type: 'text' as const },
  },
};

/** placeholder · what it resolves to off PINNED_NOW · the year a refusal names */
const PAST_BOTH: ReadonlyArray<readonly [string, string, string]> = [
  ['{8000_years_from_now}', '+010026-09-30', '10026'],
  ['{7974_years_from_now}', '+010000-09-30', '10000'],
  ['{2027_years_ago}', '-000001-09-30', '-1'],
  ['{2026_years_ago}', '0000-09-30', '0'],
  // A sub-day placeholder resolves to an instant.
  ['{80000000_hours_from_now}', new Date(PINNED_NOW.getTime() + 80_000_000 * 3_600_000).toISOString(), '11153'],
];

/** Outside a `datetime`'s years only: before its floor, inside a `date`'s. */
const BEFORE_DATETIME_FLOOR: ReadonlyArray<readonly [string, string, string]> = [
  ['{1977_years_ago}', '0049-09-30', '49'],
  ['{1027_years_ago}', '0999-09-30', '999'],
];

/** Inside both kinds' years — the edges and a control — each reaches the driver as the day it names. */
const INSIDE: ReadonlyArray<readonly [string, string]> = [
  ['{1026_years_ago}', '1000-09-30'],
  ['{7973_years_from_now}', '9999-09-30'],
  ['{100_years_ago}', '1926-09-30'],
];

/** A driver that records every read, and answers none. */
function makeRecordingDriver() {
  const reads: unknown[] = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: unknown) { reads.push(ast); return []; },
    async findOne(_o: string, ast: unknown) { reads.push(ast); return null; },
    async count(_o: string, ast: unknown) { reads.push(ast); return 0; },
    async aggregate(_o: string, ast: unknown) { reads.push(ast); return []; },
    async create(_o: string, data: Record<string, unknown>) { return { ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { ...data, id }; },
    async updateMany(_o: string, ast: unknown) { reads.push(ast); return 0; },
    async delete() { return true; },
    async deleteMany(_o: string, ast: unknown) { reads.push(ast); return 0; },
    async bulkCreate(_o: string, batch: Record<string, unknown>[]) { return batch; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads };
}

const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

describe('[#20844] a relative-date placeholder resolved outside its column\'s years is refused, on every position, before any read', () => {
  let engine: ObjectQL;
  let reads: unknown[];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_NOW);
    const rec = makeRecordingDriver();
    reads = rec.reads;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(ledger, 'test');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Every verb and position that resolves a placeholder in a caller's condition. */
  const positions = (field: string, op: string, token: string) => [
    ['find where', () => engine.find('ledger', { where: { [field]: { [op]: token } } })],
    ['findOne where', () => engine.findOne('ledger', { where: { [field]: { [op]: token } } })],
    ['count where', () => engine.count('ledger', { where: { [field]: { [op]: token } } })],
    ['update where', () => engine.update('ledger', { note: 'x' }, { where: { [field]: { [op]: token } }, multi: true } as never)],
    ['delete where', () => engine.delete('ledger', { where: { [field]: { [op]: token } }, multi: true } as never)],
    ['aggregate where', () => engine.aggregate('ledger', {
      where: { [field]: { [op]: token } },
      aggregations: [{ function: 'count', alias: 'n' }],
    } as never)],
    ['per-aggregation filter', () => engine.aggregate('ledger', {
      aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: { [field]: { [op]: token } } }],
    } as never)],
    ['having', () => engine.aggregate('ledger', {
      groupBy: ['customer_id'],
      aggregations: [{ function: 'max', field, alias: 'last' }],
      having: { last: { [op]: token } },
    } as never)],
  ] as const;

  for (const [field, kind] of [['opened_at', 'datetime'], ['placed_on', 'date']] as const) {
    it(`${kind}: a placeholder resolved outside 0001..9999 is INVALID_FILTER / 400 on every position, naming the placeholder and the year`, async () => {
      for (const [token, resolved, year] of PAST_BOTH) {
        for (const op of ['$gt', '$lt'] as const) {
          for (const [position, call] of positions(field, op, token)) {
            const err = await refusalOf(call());
            const at = `${position} ${field} ${op} ${token}`;
            expect(err, at).not.toBeNull();
            expect(err!.code, at).toBe('INVALID_FILTER');
            expect(err!.status, at).toBe(400);
            expect(err!.message, at).toContain(`"${token}"`);
            expect(err!.message, at).toContain(`resolved to "${resolved}"`);
            expect(err!.message, at).toContain(`(the year ${year})`);
            expect(err!.message, at).toContain(kind === 'date' ? 'the years 0001 to 9999' : 'the years 1000 to 9999');
          }
        }
      }
      expect(reads, 'no read — every refusal precedes the driver').toHaveLength(0);
    });
  }

  it('the refusal is rooted at the position the placeholder sits in, in the door\'s words for that position', async () => {
    const where = await refusalOf(engine.find('ledger', { where: { opened_at: { $gt: '{8000_years_from_now}' } } }));
    expect(where!.message).toContain("find('ledger'): filter on 'opened_at' compares a declared datetime field against \"{8000_years_from_now}\" at where.opened_at.$gt");
    expect(where!.message).toContain('does not sort as an instant');
    expect(where!.message).toContain('The filter was NOT applied.');
    const filter = await refusalOf(engine.aggregate('ledger', {
      aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: { opened_at: { $gt: '{8000_years_from_now}' } } }],
    } as never));
    expect(filter!.message).toContain('at aggregations[1].filter.opened_at.$gt');
    const having = await refusalOf(engine.aggregate('ledger', {
      groupBy: ['customer_id'],
      aggregations: [{ function: 'max', field: 'opened_at', alias: 'last' }],
      having: { last: { $lt: '{2027_years_ago}' } },
    } as never));
    expect(having!.message).toContain("`having` on 'last' (max(opened_at), a datetime column) compares against \"{2027_years_ago}\" at having.last.$lt");
    expect(having!.message).toContain('The `having` was NOT applied.');
    expect(reads).toHaveLength(0);
  });

  it('a list member, a range bound, the implicit-equality slot and a nested branch are judged too', async () => {
    for (const where of [
      { opened_at: '{8000_years_from_now}' },
      { opened_at: { $in: ['{100_years_ago}', '{2027_years_ago}'] } },
      { opened_at: { $between: ['{100_years_ago}', '{8000_years_from_now}'] } },
      { $or: [{ customer_id: 'x' }, { $not: { opened_at: { $gte: '{2027_years_ago}' } } }] },
      [['opened_at', '>', '{8000_years_from_now}']],
    ]) {
      const err = await refusalOf(engine.find('ledger', { where: where as never }));
      expect(err, JSON.stringify(where)).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(reads).toHaveLength(0);
  });

  it('the datetime floor of 1000 applies to a resolved placeholder as to a literal — a date keeps those years', async () => {
    for (const [token, resolved, year] of BEFORE_DATETIME_FLOOR) {
      const err = await refusalOf(engine.find('ledger', { where: { opened_at: { $lt: token } } }));
      expect(err, token).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
      expect(err!.message).toContain(`resolved to "${resolved}" (the year ${year})`);
      expect(err!.message).toContain('Before year 1000');
      expect(err!.message).not.toContain('does not sort');
      // The control: the same placeholder on a `date` reaches the driver as its day.
      const before = reads.length;
      await engine.find('ledger', { where: { placed_on: { $lt: token } } });
      expect(reads.length, `${token} on a date reached the driver`).toBe(before + 1);
      expect(JSON.stringify(reads[before]), token).toContain(`"${resolved}"`);
    }
  });

  it('the control: a placeholder that resolves inside the range reaches the driver as the day it names, on every position', async () => {
    for (const [token, resolved] of INSIDE) {
      for (const field of ['opened_at', 'placed_on'] as const) {
        for (const [position, call] of positions(field, '$gt', token)) {
          const before = reads.length;
          await expect(call(), `${position} ${field} ${token}`).resolves.toBeDefined();
          // A per-aggregation filter and `having` are evaluated by the engine
          // over the rows the driver reads; the resolved day reaches the driver
          // on the rest. (The REST suite reads their counts over SQLite.)
          if (position === 'having' || position === 'per-aggregation filter') continue;
          expect(reads.length, `${position} ${field} ${token} reached the driver`).toBeGreaterThan(before);
          expect(JSON.stringify(reads.slice(before)), `${position} ${field} ${token}`).toContain(resolved);
        }
      }
    }
  });

  it('the judge (`judgeFilter`) refuses what execution refuses, with the same code, status and message', async () => {
    for (const [token] of PAST_BOTH) {
      const where = { opened_at: { $gt: token } };
      const judged = engine.judgeFilter('ledger', where);
      const executed = await refusalOf(engine.find('ledger', { where }));
      expect(judged, token).toEqual({ ok: false, code: 'INVALID_FILTER', status: 400, message: executed!.message });
    }
    expect(engine.judgeFilter('ledger', { opened_at: { $gt: '{100_years_ago}' } })).toEqual({ ok: true });
    expect(engine.judgeFilter('ledger', { opened_at: { $lt: '{1977_years_ago}' } })).toMatchObject({ ok: false, code: 'INVALID_FILTER', status: 400 });
    expect(engine.judgeFilter('ledger', { placed_on: { $lt: '{1977_years_ago}' } })).toEqual({ ok: true });
  });

  // [#20480] A `time` column keeps the time of day of an instant whose UTC
  // year has four digits, and no other: a literal past them is refused by the
  // door in that class's words, and so is a placeholder resolved past them.
  it('a time column refuses a placeholder resolved to an instant outside the four-digit years, in the time class\'s words', async () => {
    for (const [token, resolved, year] of PAST_BOTH.filter(([t]) => t !== '{2026_years_ago}')) {
      for (const [position, call] of positions('opens_at', '$gt', token)) {
        const err = await refusalOf(call());
        const at = `${position} opens_at $gt ${token}`;
        expect(err, at).not.toBeNull();
        expect(err!.code, at).toBe('INVALID_FILTER');
        expect(err!.status, at).toBe(400);
        expect(err!.message, at).toContain(`"${token}"`);
        expect(err!.message, at).toContain(`resolved to "${resolved}" (the year ${year})`);
        expect(err!.message, at).toContain('so no time of day is read from it');
      }
    }
    expect(reads).toHaveLength(0);
    // Year 0 has a four-digit spelling (`0000-…`), so a time of day is read
    // from it, as from a literal; so is every year inside 0001..9999.
    for (const token of ['{2026_years_ago}', '{1977_years_ago}', '{100_years_ago}']) {
      await expect(engine.find('ledger', { where: { opens_at: { $gt: token } } }), token).resolves.toEqual([]);
    }
    expect(reads).toHaveLength(3);
  });

  it('a placeholder on a column with no year, or a context placeholder, is not this judgement\'s', async () => {
    // A text column compares the resolved day as text: no kind, no range.
    await expect(engine.find('ledger', { where: { note: { $gt: '{8000_years_from_now}' } } })).resolves.toEqual([]);
    expect(JSON.stringify(reads.at(-1))).toContain('+010026-09-30');
    // A context placeholder names no year.
    await expect(engine.find('ledger', { where: { customer_id: '{current_user_id}' }, context: { userId: 'u1' } } as never)).resolves.toEqual([]);
    expect(reads).toHaveLength(2);
  });
});
