// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20481] What the `date` write door admits, this driver stores as its day.
 *
 * The engine's record validator now admits a `date` string only when it carries
 * a leading `YYYY-MM-DD` — the `date` storage rule's own reading
 * (`@objectstack/core`'s `temporalStorageForm`) — and refuses every other
 * spelling with `VALIDATION_FAILED` / `invalid_date` before any driver write
 * (`packages/objectql/src/engine-date-write-iso-only.test.ts`). The refusal is
 * therefore not this driver's; what it owes is the other half: every spelling
 * the door admits is STORED as the day it names and found by it, beside a
 * `Date`.
 *
 * Measured on the base through REST over this driver: `"2026/07/15"`,
 * `"07/15/2026"`, `"15 July 2026"` and `"2026-7-15"` were each a 201 read back
 * verbatim — a non-day that compares as text beside real days. The engine
 * refuses them now; the REST door over SQL is
 * `packages/rest/src/data-date-write-iso-only.test.ts`.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';

const OBJECT = 'ledger_date_20481';
const FIELDS = { placed_on: { type: 'date' } };

/** Each spelling the write door admits, and a `Date` — every one names 2026-07-15. */
const ADMITTED: ReadonlyArray<readonly [string, unknown]> = [
  ['bare', '2026-07-15'],
  ['iso', '2026-07-15T10:00:00Z'],
  ['naive', '2026-07-15 10:00'],
  ['blank', ' 2026-07-15'],
  ['date', new Date(Date.UTC(2026, 6, 15, 10))],
];

describe('[#20481] every date spelling the write door admits is stored as its day', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    await driver.syncSchema(OBJECT, { name: OBJECT, fields: FIELDS });
    for (const [id, placed_on] of ADMITTED) await driver.create(OBJECT, { id, placed_on });
    await driver.create(OBJECT, { id: 'before', placed_on: '2026-07-14' });
  });

  it('reads each one back as 2026-07-15', async () => {
    for (const [id] of ADMITTED) {
      expect((await driver.findOne(OBJECT, { where: { id } }))?.placed_on, id).toBe('2026-07-15');
    }
  });

  it('finds each one by the day, and orders it after 2026-07-14', async () => {
    const ids = async (where: Record<string, unknown>) =>
      (await driver.find(OBJECT, { where })).map((r) => r.id as string).sort();
    const all = ADMITTED.map(([id]) => id).sort();
    expect(await ids({ placed_on: { $eq: '2026-07-15' } })).toEqual(all);
    expect(await ids({ placed_on: { $gt: '2026-07-14' } })).toEqual(all);
    expect(await ids({ placed_on: { $lt: '2026-07-15' } })).toEqual(['before']);
  });
});
