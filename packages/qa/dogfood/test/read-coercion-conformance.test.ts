// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Driver read-coercion conformance — exercises the reusable `checkReadCoercion`
// helper (from @objectstack/verify) against the framework's own SQL driver
// (better-sqlite3 `:memory:`). A stored value must read back as its DECLARED
// type: a boolean as a boolean (not the integer 0/1 SQLite stores), a json
// field as an object, an integer as a number.
//
// The `driver-memory` arm was removed in #5704 (batch 0): driver-memory is the
// project's legacy test-convenience backend and its in-project test surface is
// being retired in favour of sqlite `:memory:` — by #5704, which migrated the
// test backends, and #6664, which replaced the prose census with the ledger
// `check:driver-memory-census` enforces. NOT by #5499: that was an INVESTMENT
// freeze, a different proposition on the same anchor, and it was lifted on
// 2026-08-11 while the retirement carried on. Nothing is lost here — SQLite is
// the driver that actually stores booleans as integers, so it is the arm that
// carries the invariant; a mingo store that never had to coerce anything could
// only ever be green.
//
// This is the invariant behind the 2026-07-06 case_escalation incident: a
// boolean guard `field != true` read the field back as integer `1` on Turso, so
// `1 != true` was always true and the flow self-triggered forever — while the
// local repro (memory / better-sqlite3, both of which coerce) was green in 6s.
// Cloud's driver-turso runs the identical contract against itself in remote mode.

import { describe, it, expect } from 'vitest';
import { checkReadCoercion } from '@objectstack/verify';
import { SqlDriver } from '@objectstack/driver-sql';

const DRIVERS = [
  {
    name: 'driver-sql (better-sqlite3 :memory:)',
    make: () =>
      new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      }),
  },
];

describe.each(DRIVERS)('read-coercion conformance: $name', ({ make }) => {
  it('reads a stored row back as its declared types (boolean/json/number)', async () => {
    const problems = await checkReadCoercion(make());
    expect(problems).toEqual([]);
  });
});

describe('checkReadCoercion detects a non-coercing driver', () => {
  it('flags boolean/json/number that come back raw (the pre-fix remote-Turso shape)', async () => {
    const raw = {
      async connect() {},
      async disconnect() {},
      async syncSchema() {},
      async create() {},
      async find() {
        return [{ id: '1', name: 'Widget', active: 1, meta: '{"k":1,"arr":[1,2]}', count: '5' }];
      },
    };
    const problems = await checkReadCoercion(raw);
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toMatch(/boolean not coerced/);
    expect(problems.join('\n')).toMatch(/json not coerced/);
    expect(problems.join('\n')).toMatch(/number not coerced/);
  });
});
