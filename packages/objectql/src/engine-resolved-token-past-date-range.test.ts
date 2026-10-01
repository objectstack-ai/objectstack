// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21068] A date macro whose offset lands past every instant a JavaScript
 * `Date` can hold names no day and no time. `@objectstack/core`'s resolver
 * refuses it `INVALID_FILTER` / 400, naming the placeholder, so the engine
 * answers that refusal on every position the resolver serves, before any
 * driver read, and `judgeFilter` answers it too.
 *
 * Measured on the base (`fed0db8f6`) through `engine.find` on InMemoryDriver
 * and `POST /api/v1/data/:object/query` on SqlDriver over SQLite, the card's
 * two rows (`opened_at` 2026-03-01T10:00Z and 1500-03-01T10:00Z), off
 * 2026-09-30T12:00Z:
 *
 * | `where` | resolved to | memory | SQLite | `judgeFilter` | now |
 * |:--|:--|:--|:--|:--|:--|
 * | `opened_at $lt {300000_years_ago}` | the text `Invalid Date` | both rows | 200, both rows | `{ ok: true }` | 400 |
 * | `opened_at $lt {99999999999999999999_minutes_ago}` | throws `RangeError` | uncoded `RangeError` | 500 `INTERNAL_ERROR` | throws `RangeError` | 400 |
 * | control: `opened_at $lt {100_years_ago}` | `1926-09-30` | the 1500 row | the 1500 row | `{ ok: true }` | unchanged |
 *
 * The right answer to the first two was a refusal. The refusal sits in core's
 * resolver, in front of every driver, so this file's recording driver is the
 * memory cell by construction (the refusal answers before a driver is asked;
 * neither `objectql` nor `rest` depends on `driver-memory`); the REST door over
 * SQLite, with the rows, is `packages/rest/src/data-resolved-token-past-date-range.test.ts`.
 * The engine's year-range judge (`engine-resolved-token-year-range.test.ts`)
 * is unchanged: a macro that names an instant keeps its year for that judge.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from './engine.js';

// Wed 2026-09-30 12:00 UTC: every resolved value below is read off this instant.
const PINNED_NOW = new Date('2026-09-30T12:00:00.000Z');

const ledger = {
  name: 'ledger',
  label: 'Ledger',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    customer_id: { name: 'customer_id', type: 'text' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
    note: { name: 'note', type: 'text' as const },
  },
};

/** The card's two rows: a day-or-coarser macro and a sub-day one, each past the instants a `Date` holds. */
const PAST_THE_DATE_RANGE = ['{300000_years_ago}', '{99999999999999999999_minutes_ago}'] as const;

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

describe('[#21068] a date macro past the instants a Date holds is refused, on every position, before any read', () => {
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

  it('both rows of the card: INVALID_FILTER / 400 on every position and every column kind, naming the placeholder — no read', async () => {
    for (const token of PAST_THE_DATE_RANGE) {
      for (const field of ['opened_at', 'placed_on', 'note'] as const) {
        for (const op of ['$lt', '$gt'] as const) {
          // `max` of a text column is refused by the aggregate field-type door,
          // which runs before resolution: the text column's `having` is that door's.
          for (const [position, call] of positions(field, op, token).filter(([p]) => field !== 'note' || p !== 'having')) {
            const err = await refusalOf(call());
            const at = `${position} ${field} ${op} ${token}`;
            expect(err, at).not.toBeNull();
            expect(err!.code, at).toBe('INVALID_FILTER');
            expect(err!.status, at).toBe(400);
            expect(err!.message, at).toContain(`"${token}"`);
            expect(err!.message, at).toContain('past every instant a JavaScript Date can hold');
            expect(err!.message, at).not.toContain('Invalid Date');
            expect(err, at).not.toBeInstanceOf(RangeError);
          }
        }
      }
    }
    expect(reads, 'no read — every refusal precedes the driver').toHaveLength(0);
  });

  it('the judge (`judgeFilter`) refuses what execution refuses, with the same code, status and message', async () => {
    for (const token of PAST_THE_DATE_RANGE) {
      const where = { opened_at: { $lt: token } };
      const judged = engine.judgeFilter('ledger', where);
      const executed = await refusalOf(engine.find('ledger', { where }));
      expect(judged, token).toEqual({ ok: false, code: 'INVALID_FILTER', status: 400, message: executed!.message });
    }
    expect(engine.judgeFilter('ledger', { opened_at: { $lt: '{100_years_ago}' } })).toEqual({ ok: true });
    expect(reads).toHaveLength(0);
  });

  it('the control: a placeholder that names an instant inside the range reaches the driver as the value it names', async () => {
    for (const [token, resolved] of [
      ['{100_years_ago}', '1926-09-30'],
      ['{1_hour_ago}', '2026-09-30T11:00:00.000Z'],
    ] as const) {
      const before = reads.length;
      await expect(engine.find('ledger', { where: { opened_at: { $lt: token } } }), token).resolves.toEqual([]);
      expect(reads.length, `${token} reached the driver`).toBe(before + 1);
      expect(JSON.stringify(reads[before]), token).toContain(`"${resolved}"`);
    }
  });
});
