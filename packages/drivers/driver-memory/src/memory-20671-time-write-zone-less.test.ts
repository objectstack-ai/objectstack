// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20671] What the `time` write door admits, this driver stores as the wall
 * clock it names, and reads back identically.
 *
 * The engine's record validator now refuses a time of day with a `Z` or an
 * offset (`"10:00Z"`, `"10:00+08:00"`) and an instant the `time` rule does not
 * read (`"+010000-01-01T10:00:00Z"`), with `VALIDATION_FAILED` / `invalid_time`
 * before any driver write (`packages/objectql/src/engine-time-write-zone-less.test.ts`).
 * Measured on the base through REST over this driver, the process in
 * America/New_York, both were stored verbatim here: `"10:00Z"` read back
 * `"10:00Z"`, while PostgreSQL read the same write back as `"10:00:00"`. The
 * refusal is therefore not this driver's. What it owes is the other half: a
 * plain `"10:00"` / `"10:00:00"`, and an ISO instant with a four-digit UTC
 * year, are stored as `HH:MM:SS` and found by it, with the process in a zone
 * that is not UTC so a host-zone reading would show. SQLite and PostgreSQL
 * read the same values back the same way in
 * `packages/rest/src/data-temporal-write-real-day-iso.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';

const OBJECT = 'schedule_time_20671';
const FIELDS = { slot: { type: 'time' } };
const HOST_ZONE = 'America/New_York';

/** Each spelling the `time` write door admits → the wall clock it is stored and read back as. */
const ADMITTED: ReadonlyArray<readonly [string, unknown, string]> = [
  ['hh-mm', '10:00', '10:00:00'],
  ['hh-mm-ss', '10:00:00', '10:00:00'],
  ['fraction', '10:00:00.250', '10:00:00.250'],
  ['utc-instant', '2026-07-15T10:00:00Z', '10:00:00'],
  ['offset-instant', '2026-07-15T18:00:00+08:00', '10:00:00'],
  ['naive-instant', '2026-07-15 10:00', '10:00:00'],
  ['a-date', new Date(Date.UTC(2026, 6, 15, 10)), '10:00:00'],
];

const originalTz = process.env.TZ;

describe('[#20671] every spelling the time write door admits is stored as its wall clock and read back identically', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    process.env.TZ = HOST_ZONE;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone, 'the host zone really changed').toBe(HOST_ZONE);
    driver = new InMemoryDriver({});
    await driver.connect();
    await driver.syncSchema(OBJECT, { name: OBJECT, fields: FIELDS });
    for (const [id, slot] of ADMITTED) await driver.create(OBJECT, { id, slot });
    await driver.create(OBJECT, { id: 'before', slot: '09:59:59' });
  });

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('reads each one back as its wall clock', async () => {
    for (const [id, , stored] of ADMITTED) {
      expect((await driver.findOne(OBJECT, { where: { id } }))?.slot, id).toBe(stored);
    }
  });

  it('finds each one by the wall clock it names, and orders it after the second before', async () => {
    const ids = async (where: Record<string, unknown>) =>
      (await driver.find(OBJECT, { where })).map((r) => r.id as string).sort();
    const ten = ADMITTED.filter(([, , stored]) => stored === '10:00:00').map(([id]) => id).sort();
    expect(await ids({ slot: { $eq: '10:00:00' } })).toEqual(ten);
    expect(await ids({ slot: { $eq: '10:00' } }), 'the HH:MM spelling').toEqual(ten);
    expect(await ids({ slot: { $gt: '09:59:59', $lt: '10:00:00.100' } })).toEqual(ten);
  });
});
