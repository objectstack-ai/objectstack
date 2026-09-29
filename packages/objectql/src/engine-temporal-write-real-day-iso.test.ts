// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20525] A temporal string is written on a calendar day that exists, and a
 * `datetime` string in an ISO 8601 spelling — or it is refused with
 * `VALIDATION_FAILED` and the field's `invalid_date` code, on insert, update, a
 * multi-row update and the dry-run `validate`, before any driver write. Never
 * rolled over, never re-read in the server's zone.
 *
 * Measured on the base (`b2b6a0643`) through `POST /api/v1/data/:object` and a
 * read-back, the process in America/New_York, PostgreSQL 16 at Asia/Shanghai:
 *
 * | written | memory | SQLite | PostgreSQL | now |
 * |:--|:--|:--|:--|:--|
 * | `date` `"2026-02-30"` | 201, `"2026-02-30"` | 201, `"2026-02-30"` | 500 `DATABASE_ERROR` | 400 |
 * | `datetime` `"2026-02-30T10:00:00Z"` | 201, `"2026-03-02T10:00:00.000Z"` | the same | the same | 400 |
 * | `datetime` `"2026/07/15 10:00"`, `"07/15/2026 10:00"`, `"15 July 2026 10:00"` | 201, `"2026-07-15T14:00:00.000Z"` (the process zone) | the same | the same | 400 |
 * | `datetime` `"07/08/2026"` | 201, `"2026-07-08T04:00:00.000Z"` (month-first, the process zone) | the same | the same | 400 |
 * | `datetime` `"2026"` | 201, `"1970-01-01T00:00:02.026Z"` | the same | the same | 400 |
 * | `date` `"2028-02-29"`, `datetime` `"2028-02-29T10:00:00Z"` (a leap day) | 201, as written | the same | the same | unchanged |
 * | `datetime` `"2026-07-15 10:00"` (zone-naive ISO) | 201, `"2026-07-15T10:00:00.000Z"` (UTC, ADR-0074) | the same | the same | unchanged |
 *
 * The REST door over real drivers is
 * `packages/rest/src/data-temporal-write-real-day-iso.test.ts`; the memory
 * driver's half is `memory-20525-temporal-write-real-day-iso.test.ts`. This
 * file's driver records writes and stores nothing, because the refusal sits in
 * front of every driver — so these verdicts hold whatever the process zone.
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
    opened_at: { name: 'opened_at', type: 'datetime' as const },
  },
};

type Field = 'placed_on' | 'opened_at';

/** Arm 1 — a leading day that does not exist. Each was `Date.parse`-readable, and stored as written or rolled over at the base. */
const IMPOSSIBLE_DAY: ReadonlyArray<readonly [Field, string]> = [
  ['placed_on', '2026-02-30'],
  ['placed_on', '2026-02-29'],
  ['placed_on', '2026-04-31'],
  ['placed_on', '2026-02-30T10:00:00Z'],
  ['opened_at', '2026-02-30T10:00:00Z'],
  ['opened_at', '2026-02-30'],
  ['opened_at', '2026-02-30 10:00'],
  ['opened_at', '2026-02-29T10:00:00Z'],
  ['opened_at', '2026-04-31T10:00:00+08:00'],
];

/** Arm 2 — a `datetime` string in no ISO spelling the storage rule reads the same on every host. Each was a 201 at the base. */
const NON_ISO_DATETIME: readonly string[] = [
  '2026/07/15 10:00',
  '07/15/2026 10:00',
  '15 July 2026 10:00',
  '07/08/2026',
  '2026-07-15 10:00 PM',
  'Wed, 15 Jul 2026 10:00:00 GMT',
  '2026',
  '2026-07',
  '2026-07-15t10:00:00z',
  '+002026-07-15T10:00:00Z',
  '2026-07-15 10:00Z',
  '2026-07-15 10:00:00+08:00',
];

/** Refused at the base already — kept refused. */
const STILL_REFUSED: ReadonlyArray<readonly [Field, unknown]> = [
  ['opened_at', 'not-a-date'],
  ['opened_at', '2026-07-15T25:00:00Z'],
  ['opened_at', Date.UTC(2026, 6, 15, 10)],
  ['placed_on', '2026/07/15'],
];

/** The leap-day control and the ISO controls — each reaches the driver. */
const ACCEPTED: ReadonlyArray<readonly [Field, unknown]> = [
  ['placed_on', '2028-02-29'],
  ['placed_on', '2026-02-28'],
  ['placed_on', '2026-07-15'],
  ['placed_on', '2026-07-15T10:00:00Z'],
  ['placed_on', '2026-07-15 10:00'],
  ['placed_on', ' 2026-07-15'],
  ['placed_on', '0050-01-01'],
  ['placed_on', new Date(Date.UTC(2026, 6, 15, 10))],
  ['opened_at', '2028-02-29T10:00:00Z'],
  ['opened_at', '2026-07-15'],
  ['opened_at', '2026-07-15T10:00'],
  ['opened_at', '2026-07-15T10:00:00'],
  ['opened_at', '2026-07-15T10:00:00Z'],
  ['opened_at', '2026-07-15T10:00:00.123Z'],
  ['opened_at', '2026-07-15T10:00:00+08:00'],
  ['opened_at', '2026-07-15T10:00:00-0530'],
  ['opened_at', '2026-07-15 10:00'],
  ['opened_at', '2026-07-15 10:00:00.5'],
  ['opened_at', ' 2026-07-15 10:00'],
  ['opened_at', '0050-01-01T10:00:00Z'],
  ['opened_at', new Date(Date.UTC(2026, 6, 15, 10))],
];

const REFUSED: ReadonlyArray<readonly [Field, unknown]> = [
  ...IMPOSSIBLE_DAY,
  ...NON_ISO_DATETIME.map((v) => ['opened_at', v] as const),
  ...STILL_REFUSED,
];

/** A driver that records every read and write, and answers none. */
function makeRecordingDriver() {
  const writes: Record<string, unknown>[] = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    async findOne() { return { id: 'r1' }; },
    async count() { return 0; },
    async aggregate() { return []; },
    async create(_o: string, data: Record<string, unknown>) { writes.push(data); return { ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { writes.push(data); return { ...data, id }; },
    async updateMany(_o: string, _ast: unknown, data: Record<string, unknown>) { writes.push(data); return 0; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async bulkCreate(_o: string, batch: Record<string, unknown>[]) { writes.push(...batch); return batch; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, writes };
}

const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number; fields?: Array<{ field: string; code: string }> });

const labelOf = (field: Field, value: unknown) =>
  `${field} ${value instanceof Date ? `Date ${value.toISOString()}` : JSON.stringify(value)}`;

describe('[#20525] the write door — a real calendar day, and an ISO spelling for a datetime, or VALIDATION_FAILED before any write', () => {
  let engine: ObjectQL;
  let writes: Record<string, unknown>[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    writes = rec.writes;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(ledger, 'test');
  });

  const doors = (field: Field, value: unknown) => [
    ['insert', () => engine.insert('ledger', { id: 'n1', customer_id: 'c1', [field]: value })],
    ['update', () => engine.update('ledger', { id: 'r1', [field]: value })],
    ['multi-row update', () => engine.update('ledger', { [field]: value }, { where: { customer_id: 'c1' }, multi: true })],
  ] as const;

  it('refuses an impossible day and a non-ISO datetime on insert, update and a multi-row update, naming the field with invalid_date — and writes nothing', async () => {
    for (const [field, value] of REFUSED) {
      for (const [door, call] of doors(field, value)) {
        const err = await refusalOf(call());
        expect(err, `${door}, ${labelOf(field, value)}`).not.toBeNull();
        expect(err!.code, `${door}, ${labelOf(field, value)}`).toBe('VALIDATION_FAILED');
        expect(err!.fields, `${door}, ${labelOf(field, value)}`).toEqual([expect.objectContaining({ field, code: 'invalid_date' })]);
      }
    }
    expect(writes, 'no write — every refusal precedes the driver').toHaveLength(0);
  });

  it('the dry-run validate predicts each refusal — and each accepted value as valid', async () => {
    for (const [field, value] of REFUSED) {
      const verdict = await engine.validate('ledger', { [field]: value });
      expect(verdict.valid, labelOf(field, value)).toBe(false);
      expect(verdict.results[0]!.errors, labelOf(field, value)).toEqual([expect.objectContaining({ field, code: 'invalid_date' })]);
    }
    for (const [field, value] of ACCEPTED) {
      expect((await engine.validate('ledger', { [field]: value })).valid, labelOf(field, value)).toBe(true);
    }
  });

  it('accepts a leap day, the ISO spellings and a Date on every door — the POSITIVE CONTROL', async () => {
    for (const [field, value] of ACCEPTED) {
      for (const [door, call] of doors(field, value)) {
        const before = writes.length;
        await expect(call(), `${door}, ${labelOf(field, value)}`).resolves.toBeDefined();
        expect(writes.length, `${door}, ${labelOf(field, value)} reached the driver`).toBe(before + 1);
        expect(writes.at(-1)![field], `${door}, ${labelOf(field, value)} reached it as written`).toEqual(value);
      }
    }
  });
});
