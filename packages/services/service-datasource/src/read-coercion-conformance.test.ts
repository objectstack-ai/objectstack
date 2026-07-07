// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Driver read-coercion conformance.
//
// A stored value must read back as its DECLARED type on every driver: a
// `boolean` as a JS boolean (not the integer 0/1 that SQLite stores), a `json`
// field as an object/array (not its serialized text), an `integer` as a number.
// When two drivers disagree, code that is green on one silently breaks on the
// other.
//
// This is the invariant behind the 2026-07-06 `case_escalation` incident: a
// boolean guard `field != true` on Turso read the field back as integer `1`, so
// `1 != true` was always true and the flow self-triggered forever — while the
// local repro (memory / better-sqlite3, both of which coerce) was green. The
// storage-representation-specific fix lives in each driver (cloud's driver-turso
// remote path, driver-sql's `formatOutput`); this suite pins the shared contract
// so no framework driver — present or future — can reintroduce the gap.

import { describe, it, expect } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { InMemoryDriver } from '@objectstack/driver-memory';

const OBJECT = 'coercion_widgets';

const SCHEMA = {
  name: OBJECT,
  fields: {
    name: { type: 'string' },
    active: { type: 'boolean' },
    meta: { type: 'json' },
    count: { type: 'integer' },
  },
};

const INPUT = { id: '1', name: 'Widget', active: true, meta: { k: 1, arr: [1, 2] }, count: 5 };

type DriverFactory = () => { name: string; driver: any };

const DRIVERS: DriverFactory[] = [
  () => ({
    name: 'driver-sql (better-sqlite3 :memory:)',
    driver: new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
  }),
  () => ({
    name: 'driver-memory',
    driver: new InMemoryDriver(),
  }),
];

describe.each(DRIVERS.map((f) => f()))('read-coercion conformance: $name', ({ driver }) => {
  it('reads a stored row back as its declared types (boolean/json/number)', async () => {
    await driver.connect();
    await driver.syncSchema(OBJECT, SCHEMA);
    await driver.create(OBJECT, { ...INPUT });

    const rows = await driver.find(OBJECT, { object: OBJECT });
    expect(rows).toHaveLength(1);
    const row = rows[0];

    // boolean stays a real boolean — NOT the integer 1 SQLite stores on disk.
    expect(typeof row.active).toBe('boolean');
    expect(row.active).toBe(true);
    // The exact guard the case_escalation flow used: must be `false`, not `true`.
    expect(row.active !== true).toBe(false);

    // json reads back as a structured value, not its serialized text.
    expect(typeof row.meta).toBe('object');
    expect(row.meta).toEqual({ k: 1, arr: [1, 2] });

    // integer stays a number.
    expect(typeof row.count).toBe('number');
    expect(row.count).toBe(5);

    await driver.disconnect?.();
  });
});
