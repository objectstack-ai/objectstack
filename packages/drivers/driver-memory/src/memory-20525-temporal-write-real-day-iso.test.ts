// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20525] What the temporal write door admits, this driver stores as written:
 * a leap day as that day, and each ISO `datetime` spelling as the instant it
 * names — the same instant whatever the server process's zone.
 *
 * The engine's record validator now refuses a string whose leading
 * `YYYY-MM-DD` names a day that does not exist, and a `datetime` string outside
 * the ISO spellings the storage rule reads the same on every host, with
 * `VALIDATION_FAILED` / `invalid_date` before any driver write
 * (`packages/objectql/src/engine-temporal-write-real-day-iso.test.ts`). The
 * refusal is therefore not this driver's; what it owes is the other half: every
 * spelling the door admits is STORED as the value it names and found by it,
 * with the process in a zone that is not UTC so a host-zone reading would show.
 *
 * Measured on the base through REST over this driver, the process in
 * America/New_York: `datetime` `"2026-02-30T10:00:00Z"` was stored as
 * `"2026-03-02T10:00:00.000Z"`, `"2026/07/15 10:00"` as
 * `"2026-07-15T14:00:00.000Z"`, and `date` `"2026-02-30"` verbatim. The engine
 * refuses those now; the REST door over SQL is
 * `packages/rest/src/data-temporal-write-real-day-iso.test.ts`.
 *
 * [#20549] The comparand door now refuses the same values as a filter
 * (`INVALID_FILTER` / 400, one rule in `@objectstack/core`). Measured on the
 * base through the engine over this driver, the process in America/New_York:
 * `opened_at $eq "2026-02-30T10:00:00Z"` matched the row stored on March 2,
 * `"07/15/2026 10:00"` the row at 14:00Z, and `placed_on $eq "2026-02-30"`
 * answered `[]`. The refusal is the engine's
 * (`packages/objectql/src/engine-temporal-comparand-door.test.ts`); this
 * driver's half is the controls: every spelling the door admits as a
 * comparand finds the instant it names, and the leap day finds itself.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';

const OBJECT = 'ledger_temporal_20525';
const FIELDS = { placed_on: { type: 'date' }, opened_at: { type: 'datetime' } };
const HOST_ZONE = 'America/New_York';

/** Each `datetime` spelling the write door admits → the instant it names, in UTC. */
const ADMITTED_DATETIME: ReadonlyArray<readonly [string, unknown, string]> = [
  ['leap', '2028-02-29T10:00:00Z', '2028-02-29T10:00:00.000Z'],
  ['utc', '2026-07-15T10:00:00Z', '2026-07-15T10:00:00.000Z'],
  ['offset', '2026-07-15T18:00:00+08:00', '2026-07-15T10:00:00.000Z'],
  ['naive-t', '2026-07-15T10:00', '2026-07-15T10:00:00.000Z'],
  ['naive-space', '2026-07-15 10:00:00', '2026-07-15T10:00:00.000Z'],
  ['a-date', new Date(Date.UTC(2026, 6, 15, 10)), '2026-07-15T10:00:00.000Z'],
];

const originalTz = process.env.TZ;

describe('[#20525] every temporal spelling the write door admits is stored as the value it names', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    process.env.TZ = HOST_ZONE;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone, 'the host zone really changed').toBe(HOST_ZONE);
    driver = new InMemoryDriver({});
    await driver.connect();
    await driver.syncSchema(OBJECT, { name: OBJECT, fields: FIELDS });
    for (const [id, opened_at] of ADMITTED_DATETIME) await driver.create(OBJECT, { id, opened_at });
    await driver.create(OBJECT, { id: 'leap-day', placed_on: '2028-02-29' });
    await driver.create(OBJECT, { id: 'before', placed_on: '2028-02-28', opened_at: '2026-07-15T09:59:59Z' });
  });

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('reads each datetime back as its UTC instant, and the leap day as itself', async () => {
    for (const [id, , instant] of ADMITTED_DATETIME) {
      expect((await driver.findOne(OBJECT, { where: { id } }))?.opened_at, id).toBe(instant);
    }
    expect((await driver.findOne(OBJECT, { where: { id: 'leap-day' } }))?.placed_on).toBe('2028-02-29');
  });

  it('finds each one by the instant it names, and orders it after the second before', async () => {
    const ids = async (where: Record<string, unknown>) =>
      (await driver.find(OBJECT, { where })).map((r) => r.id as string).sort();
    const july = ADMITTED_DATETIME.filter(([id]) => id !== 'leap').map(([id]) => id).sort();
    expect(await ids({ opened_at: { $eq: '2026-07-15T10:00:00Z' } })).toEqual(july);
    expect(await ids({ opened_at: { $gt: '2026-07-15T09:59:59Z', $lt: '2027-01-01' } })).toEqual(july);
    expect(await ids({ placed_on: { $gt: '2028-02-28' } })).toEqual(['leap-day']);
  });

  it('[#20549] finds each one by every comparand spelling the door admits, and the leap day by itself', async () => {
    const ids = async (where: Record<string, unknown>) =>
      (await driver.find(OBJECT, { where })).map((r) => r.id as string).sort();
    const july = ADMITTED_DATETIME.filter(([id]) => id !== 'leap').map(([id]) => id).sort();
    for (const [, spelling] of ADMITTED_DATETIME.filter(([id]) => id !== 'leap' && id !== 'a-date')) {
      expect(await ids({ opened_at: { $eq: spelling } }), String(spelling)).toEqual(july);
    }
    expect(await ids({ opened_at: { $eq: '2026-07-15T05:00:00-0500' } }), 'an offset without a colon').toEqual(july);
    expect(await ids({ opened_at: { $eq: Date.UTC(2026, 6, 15, 10) } }), 'epoch milliseconds as a number').toEqual(july);
    expect(await ids({ opened_at: { $eq: '2028-02-29T10:00:00Z' } }), 'the leap day on a datetime').toEqual(['leap']);
    expect(await ids({ placed_on: { $eq: '2028-02-29' } }), 'the leap day on a date').toEqual(['leap-day']);
  });
});
