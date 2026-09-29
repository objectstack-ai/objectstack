// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20671] A `time` field is a zone-less wall clock, and the record validator's
 * `time` arm asks `@objectstack/core`'s one rule (`isUninterpretableTemporalComparand`,
 * the one the `time` comparand door asks). A value that rule does not read is
 * refused with `VALIDATION_FAILED` and the field's `invalid_time` code on insert,
 * update, a multi-row update and the dry-run `validate`, before any driver
 * write. A zone suffix on a time of day is refused in its own sentence (drop
 * the suffix, or use a `datetime` field for an instant).
 *
 * Measured on the base (`fa0a4b661`) through `POST /api/v1/data/:object` and a
 * read-back through `POST /api/v1/data/:object/query`, the process in
 * America/New_York and PostgreSQL 16 at Asia/Shanghai:
 *
 * | written to a `time` | memory | SQLite | PostgreSQL | now |
 * |:--|:--|:--|:--|:--|
 * | `"+010000-01-01T10:00:00Z"` | 201, read back verbatim | 201, verbatim | 500 `DATABASE_ERROR` | 400 |
 * | `"9999-12-31T23:00:00-02:00"` (UTC year 10000) | 201, verbatim | 201, verbatim | 500 | 400 |
 * | `"10:00Z"`, `"10:00+08:00"`, `"10:00:00+0800"` | 201, verbatim | 201, verbatim | 201, `"10:00:00"` | 400, the zone sentence |
 * | `"10:00:00.250Z"` | 201, verbatim | 201, verbatim | 201, `"10:00:00.250"` | 400, the zone sentence |
 * | `"2026-07-15 10:00Z"` (a space and a zone) | 201, `"10:00:00"` | the same | the same | 400 |
 * | `"10:00"`, `"10:00:00"` | 201, `"10:00:00"` | the same | the same | unchanged |
 * | `"2026-07-15T10:00:00Z"`, `"2026-07-15T18:00:00+08:00"` | 201, `"10:00:00"` | the same | the same | unchanged |
 * | `"07/15/2026 10:00"`, `"{now}"`, the number `36000000` | 400 `invalid_time` | the same | the same | unchanged |
 *
 * The REST door over SQLite and PostgreSQL is
 * `packages/rest/src/data-temporal-write-real-day-iso.test.ts`; the memory
 * driver's half is `memory-20671-time-write-zone-less.test.ts`. This file's
 * driver records writes and stores nothing, because the refusal sits in front
 * of every driver.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isUninterpretableTemporalComparand } from '@objectstack/core';
import { renderValidationMessage } from '@objectstack/spec/system';
import { ObjectQL } from './engine.js';

const schedule = {
  name: 'schedule',
  label: 'Schedule',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    customer_id: { name: 'customer_id', type: 'text' as const },
    slot: { name: 'slot', label: 'Slot', type: 'time' as const },
  },
};

/** A time of day with a `Z` or an offset: the zone sentence. Each was a 201 at the base, stored two ways by backend. */
const ZONED: readonly string[] = [
  '10:00Z',
  '10:00+08:00',
  '10:00:00Z',
  '10:00:00+0800',
  '10:00:00.250Z',
  '10:00-05:30',
  '23:59:59-00:00',
  ' 10:00Z ',
  '10:00z',
];

/** An instant the `time` rule does not read: the plain sentence. Each was a 201 (or a 500 on PostgreSQL) at the base. */
const UNREAD_INSTANT: readonly unknown[] = [
  '+010000-01-01T10:00:00Z',
  '9999-12-31T23:00:00-02:00',
  '-000001-01-01T10:00:00Z',
  '2026-02-30T10:00:00Z',
  '2026-07-15 10:00Z',
  '2026-07-15t10:00:00z',
  new Date(Date.parse('+010000-01-01T10:00:00Z')),
];

/** Refused at the base already, kept refused, in the plain sentence. */
const STILL_REFUSED: readonly unknown[] = [
  '25:00',
  '25:00Z',
  '14:60',
  'not-a-time',
  '14',
  '07/15/2026 10:00',
  'x2026-07-15T10:00:00Z',
  '{now}',
  36000000,
];

/** A wall clock, or an ISO instant with a four-digit UTC year — each reaches the driver as written. */
const ACCEPTED: readonly unknown[] = [
  '10:00',
  '10:00:00',
  '10:00:00.250',
  ' 10:00 ',
  '00:00',
  '23:59:59.999',
  '2026-07-15T10:00:00Z',
  '2026-07-15T18:00:00+08:00',
  '2026-07-15T10:00:00-0530',
  '2026-07-15T10:00',
  '2026-07-15 10:00',
  new Date(Date.UTC(2026, 6, 15, 10)),
];

const REFUSED: readonly unknown[] = [...ZONED, ...UNREAD_INSTANT, ...STILL_REFUSED];

/** A driver that records every write, and answers none. */
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
  p.then(() => null, (e: any) => e as Error & { code?: string; fields?: Array<{ field: string; code: string; message: string }> });

const labelOf = (value: unknown) => (value instanceof Date ? `Date ${value.toISOString()}` : JSON.stringify(value));

/** The sentence a refusal of `value` carries: the zone sentence for a zone-suffixed time of day, else the plain one. */
const sentenceFor = (value: unknown) =>
  renderValidationMessage({
    messageKey: ZONED.includes(value as string) ? 'invalid_time_zoned' : 'invalid_time',
    label: 'Slot',
    field: 'slot',
  });

describe('[#20671] the time write door — a zone-less wall clock, or an ISO instant with a four-digit UTC year, or VALIDATION_FAILED before any write', () => {
  let engine: ObjectQL;
  let writes: Record<string, unknown>[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    writes = rec.writes;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(schedule, 'test');
  });

  const doors = (value: unknown) => [
    ['insert', () => engine.insert('schedule', { id: 'n1', customer_id: 'c1', slot: value })],
    ['update', () => engine.update('schedule', { id: 'r1', slot: value })],
    ['multi-row update', () => engine.update('schedule', { slot: value }, { where: { customer_id: 'c1' }, multi: true })],
  ] as const;

  it('refuses a zone suffix, an unread instant and the junk class on insert, update and a multi-row update, naming the field with invalid_time — and writes nothing', async () => {
    for (const value of REFUSED) {
      for (const [door, call] of doors(value)) {
        const err = await refusalOf(call());
        expect(err, `${door}, ${labelOf(value)}`).not.toBeNull();
        expect(err!.code, `${door}, ${labelOf(value)}`).toBe('VALIDATION_FAILED');
        expect(err!.fields?.map((f) => [f.field, f.code]), `${door}, ${labelOf(value)}`).toEqual([['slot', 'invalid_time']]);
      }
    }
    expect(writes, 'no write — every refusal precedes the driver').toHaveLength(0);
  });

  it('a zone suffix on a time of day is refused in the zone sentence, every other refusal in the plain one', async () => {
    expect(sentenceFor('10:00Z'), 'the two sentences differ').not.toBe(sentenceFor('25:00'));
    for (const value of REFUSED) {
      const err = await refusalOf(engine.insert('schedule', { id: 'n1', slot: value }));
      expect(err!.fields?.[0]?.message, labelOf(value)).toBe(sentenceFor(value));
    }
  });

  it('the dry-run validate predicts each refusal — and each accepted value as valid', async () => {
    for (const value of REFUSED) {
      const verdict = await engine.validate('schedule', { slot: value });
      expect(verdict.valid, labelOf(value)).toBe(false);
      expect(verdict.results[0]!.errors, labelOf(value)).toEqual([expect.objectContaining({ field: 'slot', code: 'invalid_time' })]);
    }
    for (const value of ACCEPTED) {
      expect((await engine.validate('schedule', { slot: value })).valid, labelOf(value)).toBe(true);
    }
  });

  it('accepts a wall clock, an ISO instant with a four-digit UTC year and a Date on every door — the POSITIVE CONTROL', async () => {
    for (const value of ACCEPTED) {
      for (const [door, call] of doors(value)) {
        const before = writes.length;
        await expect(call(), `${door}, ${labelOf(value)}`).resolves.toBeDefined();
        expect(writes.length, `${door}, ${labelOf(value)} reached the driver`).toBe(before + 1);
        expect(writes.at(-1)!.slot, `${door}, ${labelOf(value)} reached it as written`).toEqual(value);
      }
    }
  });

  it('one rule: a string is refused as a written time exactly when core refuses it as a time comparand, save the two write-only refusals', async () => {
    const corpus = [...REFUSED, ...ACCEPTED].filter((v): v is string => typeof v === 'string');
    // The comparand door exempts a `{placeholder}` (its resolver's vocabulary);
    // the write door refuses it, because a placeholder is not a value.
    const writeOnly = new Set(['{now}']);
    for (const value of corpus) {
      const refused = (await refusalOf(engine.insert('schedule', { id: 'n1', slot: value }))) !== null;
      const expected = writeOnly.has(value) || isUninterpretableTemporalComparand('time', value);
      expect(refused, value).toBe(expected);
    }
    // A number is the other write-only refusal: epoch milliseconds are a
    // comparand, never a written time.
    expect(isUninterpretableTemporalComparand('time', 36000000), 'core reads the number').toBe(false);
    expect(await refusalOf(engine.insert('schedule', { id: 'n1', slot: 36000000 })), 'the write door refuses it').not.toBeNull();
  });
});
