// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20264] The supported years of a `date` are 0001..9999, and [#20280] of a
 * `datetime` 1000..9999. The refusal outside them sits one layer up, at the engine's two doors (the
 * temporal-comparand door and the record validator, both asking
 * `@objectstack/core`'s `isOutsideTemporalYearRange`), so this driver's own
 * `where` and write paths are not a door and are not pinned as one. What this
 * driver owes the range is the other half: every year inside it is stored and
 * compared as the day or the instant it names, the edges included, beside a
 * 2026 control — and it reads the one rule, with no copy of its own.
 *
 * Measured on the base through this driver and the engine over it: a
 * `datetime` bound in year 10000 or −1 counted `$gt` / `$lt` / `$eq` 7 / 0 / 0
 * (its `+010000-…` / `-000001-…` text sorts below every four-digit year), and a
 * REST create stored a `date` of `"+010000-01-01T00:00:00.000Z"` verbatim.
 * Both are refused at the engine now; the engine's own suite and REST's pin
 * those cells.
 *
 * [#20280] The `datetime` rows in 0001..0999 stay, on purpose: they are what a
 * row stored before the `datetime` floor holds, written here straight through
 * the driver, which no door fronts. The engine refuses such a value as a
 * written value and as a comparand now; the driver still stores it and compares
 * it as the instant it names, so an operator's `$lt` on year 1000 finds it.
 * Year 1000 is the floor's edge row.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { temporalStorageForm } from '@objectstack/core';
import { InMemoryDriver } from './memory-driver.js';

const OBJECT = 'ledger_year_20264';
const FIELDS = { placed_on: { type: 'date' }, opened_at: { type: 'datetime' } };

const ROWS = [
  { id: 'first', placed_on: '0001-01-01', opened_at: '0001-01-01T00:00:00.000Z' },
  { id: 'y0099', placed_on: '0099-03-04', opened_at: '0099-03-04T10:00:00.000Z' },
  { id: 'y0999', placed_on: '0999-06-15', opened_at: '0999-06-15T10:00:00.000Z' },
  // [#20280] The `datetime` floor's edge.
  { id: 'y1000', placed_on: '1000-01-01', opened_at: '1000-01-01T00:00:00.000Z' },
  { id: 'c2026', placed_on: '2026-02-01', opened_at: '2026-02-01T10:00:00.000Z' },
  { id: 'last', placed_on: '9999-12-31', opened_at: '9999-12-31T23:59:59.999Z' },
];

const ORDER = ['first', 'y0099', 'y0999', 'y1000', 'c2026', 'last'];

describe('[#20264] every year in 0001..9999 is stored and compared by this driver as the day or instant it names', () => {
  let driver: InMemoryDriver;
  const ids = async (where: FilterCondition) =>
    (await driver.find(OBJECT, { where })).map((r) => r.id as string).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  beforeAll(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    await driver.syncSchema(OBJECT, { name: OBJECT, fields: FIELDS });
    // Written as a number, a Date and a string — one stored form each.
    for (const [i, row] of ROWS.entries()) {
      const ms = Date.parse(row.opened_at);
      const opened_at = i % 3 === 0 ? ms : i % 3 === 1 ? new Date(ms) : row.opened_at;
      await driver.create(OBJECT, { ...row, opened_at });
    }
  });

  it('reads each row back as written — the edges, a datetime stored before the floor, and the 2026 control', async () => {
    for (const row of ROWS) {
      expect(await driver.findOne(OBJECT, { where: { id: row.id } }), row.id).toMatchObject(row);
    }
  });

  for (const [field, kind] of [['placed_on', 'date'], ['opened_at', 'datetime']] as const) {
    it(`${kind}: each value is found by $eq, and the range orders chronologically, in every spelling`, async () => {
      for (const [i, row] of ROWS.entries()) {
        const value = row[field];
        const ms = Date.parse(kind === 'date' ? `${value}T00:00:00.000Z` : value);
        for (const comparand of [value, ms, new Date(ms)]) {
          expect(await ids({ [field]: { $eq: comparand } }), `${row.id} $eq ${String(comparand)}`).toEqual([row.id]);
          expect(await ids({ [field]: { $gt: comparand } }), `${row.id} $gt ${String(comparand)}`).toEqual(ORDER.slice(i + 1));
          expect(await ids({ [field]: { $lt: comparand } }), `${row.id} $lt ${String(comparand)}`).toEqual(ORDER.slice(0, i));
        }
      }
    });
  }

  it('the driver reads core\'s one rule: a year outside the range keeps the rule\'s spelling here, and the engine refuses it', async () => {
    // A direct write bypasses the engine's doors; what it stores is exactly
    // what `temporalStorageForm` spells — no copy of the rule in this driver.
    const y0 = new Date(Date.parse('0000-06-15T00:00:00.000Z'));
    const y10000 = Date.parse('+010000-01-01T00:00:00.000Z');
    await driver.create(OBJECT, { id: 'direct', placed_on: y0, opened_at: y10000 });
    const stored = await driver.findOne(OBJECT, { where: { id: 'direct' } });
    expect(stored?.placed_on).toBe(temporalStorageForm(y0, 'date'));
    expect(stored?.placed_on).toBe('0-06-15');
    expect(stored?.opened_at).toBe(temporalStorageForm(y10000, 'datetime'));
    await driver.delete(OBJECT, 'direct');
    expect(await ids({})).toEqual(ORDER);
  });
});
