// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20481] A `date` string is written in its `YYYY-MM-DD` form or it is refused
 * — `VALIDATION_FAILED` with the field's `invalid_date` code, on insert,
 * update, a multi-row update and the dry-run `validate`, before any driver
 * write.
 *
 * "Its `YYYY-MM-DD` form" is the `date` storage rule's own reading of a
 * string (`@objectstack/core`'s `temporalStorageForm`): a leading `YYYY-MM-DD`
 * after trimming, collapsed to that day. The write door asks the SAME
 * predicate the temporal-comparand door asks (`isUninterpretableTemporalComparand`),
 * so the two doors cannot disagree about which `date` strings the rule reads —
 * the last block below holds them to that.
 *
 * Measured on the base (`0bbe4005e`) through REST, a create then a read-back,
 * the process in America/New_York and PostgreSQL 16 at Asia/Shanghai with
 * `DateStyle` `ISO, MDY`:
 *
 * | written to a `date` | memory | SQLite | PostgreSQL | now |
 * |:--|:--|:--|:--|:--|
 * | `"2026/07/15"`, `"07/15/2026"`, `"15 July 2026"`, `"2026-7-15"`, `"2026.07.15"`, `"July 15, 2026"` | 201, read back verbatim | 201, read back verbatim | 201, `"2026-07-15"` (its `DateStyle` reading) | 400 |
 * | `"07/08/2026"` | 201, verbatim | 201, verbatim | 201, `"2026-07-08"` (August 7 under DMY) | 400 |
 * | `"+002026-07-15"` | 201, verbatim | 201, verbatim | 500 | 400 |
 * | `"2026-07-15T10:00:00Z"`, `"2026-07-15 10:00"`, `" 2026-07-15"`, `"2026-07-15"` | 201, `"2026-07-15"` | 201, `"2026-07-15"` | 201, `"2026-07-15"` | unchanged |
 * | `"20260715"`, `"15/07/2026"` (no `Date.parse` reading) | 400 | 400 | 400 | unchanged |
 * | an epoch-millisecond number | 400 | 400 | 400 | unchanged |
 * | a `Date` | 201, its UTC day | 201, its UTC day | 201, its UTC day | unchanged |
 *
 * No other spelling is canonicalised, on purpose: `07/08/2026` names two days,
 * and a guess stores the wrong one silently. The REST door over real drivers is
 * `packages/rest/src/data-date-write-iso-only.test.ts`; this file's driver
 * records writes and stores nothing, because the refusal sits in front of
 * every driver.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const ledger = {
  name: 'ledger',
  label: 'Ledger',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    customer_id: { name: 'customer_id', type: 'text' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
  },
};

/** `Date.parse`-readable, no leading `YYYY-MM-DD` — each a 201 stored verbatim on memory and SQLite at the base. */
const REFUSED: readonly string[] = [
  '2026/07/15',
  '07/15/2026',
  '07/08/2026',
  '15 July 2026',
  'July 15, 2026',
  '2026-7-15',
  '2026.07.15',
  '+002026-07-15',
];

/** Refused at the base already — kept refused. */
const STILL_REFUSED: ReadonlyArray<readonly [string, unknown]> = [
  ['no Date.parse reading', '20260715'],
  ['a day-first spelling Date.parse cannot read', '15/07/2026'],
  ['a leading day shape with no reading', '2026-13-45'],
  ['a {placeholder}', '{today}'],
  ['an epoch-millisecond number', Date.UTC(2026, 6, 15)],
];

/** A leading `YYYY-MM-DD` — the rule collapses each to `2026-07-15`, and a `Date` keeps its UTC day. */
const ACCEPTED: ReadonlyArray<readonly [string, unknown]> = [
  ['a bare day', '2026-07-15'],
  ['an ISO instant', '2026-07-15T10:00:00Z'],
  ['a zone-naive wall clock', '2026-07-15 10:00'],
  ['a leading blank', ' 2026-07-15'],
  ['a Date', new Date(Date.UTC(2026, 6, 15, 10))],
];

/** A driver that records every read and write, and answers none. */
function makeRecordingDriver() {
  const reads: unknown[] = [];
  const writes: Record<string, unknown>[] = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: unknown) { reads.push(ast); return []; },
    async findOne(_o: string, ast: unknown) { reads.push(ast); return { id: 'r1' }; },
    async count(_o: string, ast: unknown) { reads.push(ast); return 0; },
    async aggregate(_o: string, ast: unknown) { reads.push(ast); return []; },
    async create(_o: string, data: Record<string, unknown>) { writes.push(data); return { ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { writes.push(data); return { ...data, id }; },
    async updateMany(_o: string, _ast: unknown, data: Record<string, unknown>) { writes.push(data); return 0; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async bulkCreate(_o: string, batch: Record<string, unknown>[]) { writes.push(...batch); return batch; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads, writes };
}

const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number; fields?: Array<{ field: string; code: string }> });

const labelOf = (value: unknown) => (value instanceof Date ? `Date ${value.toISOString()}` : JSON.stringify(value));

describe('[#20481] the write door — a date string is written in its YYYY-MM-DD form, or it is VALIDATION_FAILED before any write', () => {
  let engine: ObjectQL;
  let reads: unknown[];
  let writes: Record<string, unknown>[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    reads = rec.reads;
    writes = rec.writes;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(ledger, 'test');
  });

  const doors = (value: unknown) => [
    ['insert', () => engine.insert('ledger', { id: 'n1', customer_id: 'c1', placed_on: value })],
    ['update', () => engine.update('ledger', { id: 'r1', placed_on: value })],
    ['multi-row update', () => engine.update('ledger', { placed_on: value }, { where: { customer_id: 'c1' }, multi: true })],
  ] as const;

  it('refuses every other spelling on insert, update and a multi-row update, with the field and invalid_date — and writes nothing', async () => {
    for (const value of [...REFUSED, ...STILL_REFUSED.map(([, v]) => v)]) {
      for (const [door, call] of doors(value)) {
        const err = await refusalOf(call());
        expect(err, `${door}, ${labelOf(value)}`).not.toBeNull();
        expect(err!.code, `${door}, ${labelOf(value)}`).toBe('VALIDATION_FAILED');
        expect(err!.fields, `${door}, ${labelOf(value)}`).toEqual([expect.objectContaining({ field: 'placed_on', code: 'invalid_date' })]);
      }
    }
    expect(writes, 'no write — every refusal precedes the driver').toHaveLength(0);
  });

  it('the dry-run validate predicts each refusal — and each accepted value as valid', async () => {
    for (const value of [...REFUSED, ...STILL_REFUSED.map(([, v]) => v)]) {
      const verdict = await engine.validate('ledger', { placed_on: value });
      expect(verdict.valid, labelOf(value)).toBe(false);
      expect(verdict.results[0]!.errors, labelOf(value)).toEqual([expect.objectContaining({ field: 'placed_on', code: 'invalid_date' })]);
    }
    for (const [name, value] of ACCEPTED) {
      expect((await engine.validate('ledger', { placed_on: value })).valid, name).toBe(true);
    }
  });

  it('accepts a leading YYYY-MM-DD and a Date on every door — the POSITIVE CONTROL', async () => {
    for (const [name, value] of ACCEPTED) {
      for (const [door, call] of doors(value)) {
        const before = writes.length;
        await expect(call(), `${door}, ${name}`).resolves.toBeDefined();
        expect(writes.length, `${door}, ${name} reached the driver`).toBe(before + 1);
      }
    }
  });

  it('one reading at both doors: a date string is refused as a written value exactly when it is refused as a comparand', async () => {
    const strings = [...REFUSED, ...ACCEPTED.map(([, v]) => v).filter((v): v is string => typeof v === 'string')];
    for (const value of strings) {
      const written = (await engine.validate('ledger', { placed_on: value })).valid;
      const err = await refusalOf(engine.find('ledger', { where: { placed_on: { $gte: value } } }));
      if (err) expect(err, `where ${JSON.stringify(value)}`).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
      expect({ written, compared: err === null }, JSON.stringify(value)).toEqual({ written: !REFUSED.includes(value), compared: !REFUSED.includes(value) });
    }
    expect(reads, 'a read for each accepted comparand, none for a refused one').toHaveLength(strings.length - REFUSED.length);
  });
});
