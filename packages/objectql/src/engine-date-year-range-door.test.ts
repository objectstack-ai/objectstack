// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20240] The temporal-comparand door refuses a NUMBER or a `Date` on a
 * declared `date` field when its UTC calendar day falls in a year below 0 or
 * above 9999 — the one non-string class the door judges.
 *
 * Such a day has no `YYYY-MM-DD` spelling. Measured on the base over REST, on
 * a `date` field of six 2026 days plus 0999-06-15:
 *
 * | comparand | `$gt` / `$lt` / `$eq` | memory | SQLite | PostgreSQL | the day's answer |
 * |:--|:--|:--|:--|:--|:--|
 * | number for 10000-01-01 | | 6 / 1 / 0 | 6 / 1 / 0 | 0 / 7 / 0 | 0 / 7 / 0 |
 * | number for -1-01-01 | | 7 / 0 / 0 | 7 / 0 / 0 | 500 / 500 / 500 | 7 / 0 / 0 |
 * | ISO string of either instant | | 400 | 400 | 400 | — |
 *
 * The storage rule spells those days `10000-01-01` / `-1-01-01`, which sort as
 * no day does, and PostgreSQL refuses `-1-01-01` as a date. The ISO string of
 * the same instant was already refused `INVALID_FILTER` / 400 here; the number
 * and the `Date` now take the same refusal, before any driver read, at every
 * position the door covers: `where` on every verb and both spellings, and a
 * per-aggregation `filter`.
 *
 * Every refusal pin sits in one `it()` with its POSITIVE CONTROL: the same
 * operators with a supported year (0001, 0999, 2026, 9999) reach the driver.
 *
 * [#20264] The range is 0001..9999: year 0 is refused too, and on a
 * `datetime` field a number or `Date` outside the range is refused as it is
 * on a `date` field (`engine-temporal-year-range.test.ts` pins that card's
 * cells; this file keeps the `date` ones).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const ledger = {
  name: 'ledger',
  label: 'Ledger',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    memo: { name: 'memo', type: 'text' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
    opens_at: { name: 'opens_at', type: 'time' as const },
  },
};

const at = (iso: string) => Date.parse(iso);

/** Numbers whose UTC calendar day falls outside the four-digit years. */
const OUT_OF_RANGE: ReadonlyArray<readonly [string, number]> = [
  ['10000-01-01', 253402300800000],
  ['-1-01-01', -62198755200000],
  ['the last millisecond of year -1', at('-000001-12-31T23:59:59.999Z')],
  // [#20264] Year 0 joins the refused years: PostgreSQL's `DATE` has no year 0.
  ['0000-01-01', at('0000-01-01T00:00:00.000Z')],
];

/** The supported years 0001..9999, the edges included — every one reaches the driver. */
const IN_RANGE: ReadonlyArray<readonly [string, number]> = [
  ['0001-01-01', at('0001-01-01T00:00:00.000Z')],
  ['0999-06-15', -30627504000000],
  ['2026-02-01T10:00Z', 1769940000000],
  ['the last millisecond of year 9999', at('9999-12-31T23:59:59.999Z')],
];

/** A driver that records every read and answers none. Its answers are not this suite's subject. */
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

describe('[#20240] a date field\'s number or Date outside the four-digit years is refused at the door', () => {
  let engine: ObjectQL;
  let reads: unknown[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    reads = rec.reads;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(ledger, 'test');
  });

  const refusalOf = async (p: Promise<unknown>) =>
    p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

  it('refuses the number and its Date on where, with code AND status and no driver read — while four-digit years reach the driver', async () => {
    for (const [name, ms] of OUT_OF_RANGE) {
      for (const [form, comparand] of [['number', ms], ['Date', new Date(ms)]] as const) {
        for (const op of ['$gt', '$lt', '$eq'] as const) {
          const err = await refusalOf(engine.find('ledger', { where: { placed_on: { [op]: comparand } } }));
          expect(err, `${form} ${name} ${op}`).not.toBeNull();
          expect(err!.code).toBe('INVALID_FILTER');
          expect(err!.status).toBe(400);
          expect(err!.message).toContain("'placed_on'");
          expect(err!.message).toContain(`where.placed_on.${op}`);
        }
      }
    }
    expect(reads).toHaveLength(0);

    // ── the POSITIVE CONTROL: the same operators, a four-digit year ──────────
    for (const [name, ms] of IN_RANGE) {
      for (const comparand of [ms, new Date(ms), new Date(ms).toISOString()]) {
        for (const op of ['$gt', '$lt', '$eq'] as const) {
          const before = reads.length;
          await expect(
            engine.find('ledger', { where: { placed_on: { [op]: comparand } } }),
            `${name} ${op} ${String(comparand)}`,
          ).resolves.toEqual([]);
          expect(reads.length, `${name} reached the driver`).toBe(before + 1);
        }
      }
    }
  });

  it('refuses at every comparand position a date field can carry, and on both spellings', async () => {
    const out = 253402300800000;
    const inside = 1769940000000;
    for (const where of [
      { placed_on: out },                                                  // implicit equality
      { placed_on: new Date(out) },
      { placed_on: { $in: [inside, out] } },                               // a list MEMBER
      { placed_on: { $between: [inside, out] } },                          // a range bound
      { placed_on: { $ne: -62198755200000 } },
      { $and: [{ memo: 'x' }, { placed_on: { $lte: out } }] },
      { $or: [{ memo: 'x' }, { $not: { placed_on: { $gte: new Date(out) } } }] },
      [['placed_on', '>', out]],                                           // the authored array sugar
    ]) {
      const err = await refusalOf(engine.find('ledger', { where: where as never }));
      expect(err, JSON.stringify(where)).not.toBeNull();
      expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(reads).toHaveLength(0);

    // Control: the same positions with a four-digit year reach the driver.
    for (const where of [
      { placed_on: inside },
      { placed_on: { $in: [inside, -30627504000000] } },
      { placed_on: { $between: [-30627504000000, inside] } },
      [['placed_on', '>', inside]],
    ]) {
      await expect(engine.find('ledger', { where: where as never }), JSON.stringify(where)).resolves.toEqual([]);
    }
    expect(reads).toHaveLength(4);
  });

  it('covers every verb that collects a filter, read and write sides', async () => {
    const where = { placed_on: { $gt: 253402300800000 } };
    for (const call of [
      () => engine.find('ledger', { where }),
      () => engine.findOne('ledger', { where }),
      () => engine.count('ledger', { where }),
      () => engine.aggregate('ledger', { where, groupBy: ['memo'] } as never),
      () => engine.update('ledger', { memo: 'x' }, { where, multi: true }),
      () => engine.delete('ledger', { where, multi: true }),
    ]) {
      const err = await refusalOf(call());
      expect(err).not.toBeNull();
      expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(reads).toHaveLength(0);
  });

  it('refuses in a per-aggregation filter too, before any driver read — while a four-digit year is counted', async () => {
    const perAggregation = (filter: unknown) => ({
      aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
    });
    for (const [name, ms] of OUT_OF_RANGE) {
      for (const comparand of [ms, new Date(ms)]) {
        const err = await refusalOf(engine.aggregate('ledger', perAggregation({ placed_on: { $gt: comparand } }) as never));
        expect(err, name).not.toBeNull();
        expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
      }
    }
    expect(reads).toHaveLength(0);

    await expect(
      engine.aggregate('ledger', perAggregation({ placed_on: { $gt: -30627504000000 } }) as never),
    ).resolves.toBeDefined();
    expect(reads.length).toBeGreaterThan(0);
  });

  it('[#20264] refuses the same numbers on a datetime field, and leaves the time field alone — a wall clock has no year', async () => {
    for (const [name, ms] of OUT_OF_RANGE) {
      for (const comparand of [ms, new Date(ms)]) {
        const err = await refusalOf(engine.find('ledger', { where: { opened_at: { $gt: comparand } } }));
        expect(err, `datetime ${name}`).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
        await expect(engine.find('ledger', { where: { opens_at: { $gt: comparand } } })).resolves.toEqual([]);
      }
    }
    expect(reads).toHaveLength(OUT_OF_RANGE.length * 2);
  });

  it('does not judge NaN, ±Infinity or an Invalid Date — no instant, no year', async () => {
    for (const comparand of [Number.NaN, Number.POSITIVE_INFINITY, new Date(Number.NaN)]) {
      await expect(engine.find('ledger', { where: { placed_on: { $gt: comparand } } }), String(comparand)).resolves.toEqual([]);
    }
  });
});
