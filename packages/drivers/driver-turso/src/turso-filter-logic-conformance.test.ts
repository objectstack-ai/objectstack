// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for TursoDriver in LOCAL mode (#3774,
 * #5590) — the shared `@objectstack/spec/data` cases, run through this
 * driver's own pipeline.
 *
 * `TursoDriver extends SqlDriver`, so in local (and replica — same local
 * engine) mode the `$and` / `$or` / `$not` compilation is inherited and
 * nothing here re-implements it. Two things this file pins are nonetheless
 * this package's own, and would fail in no other suite in the repo:
 *
 * 1. **The transport router.** Every read method on this driver is an
 *    `override` that branches on `this.isRemote` before it reaches
 *    `super.find`. A branch that sent a local read down the remote path — or
 *    a `toRemoteQuery` that ran on a query it was never meant to touch —
 *    changes which compiler answers a filter, and only a row-result assertion
 *    can see that.
 * 2. **The temporal seam the constructor installs.** `filterColumnSql`
 *    rewrites the SQL on the LEFT of a comparison for temporal columns
 *    (ADR-0053 D-A1, #937). Every column in {@link FILTER_LOGIC_ROWS} is a
 *    plain string, so the seam must leave all of them alone; a rewrite that
 *    over-reached would corrupt exactly the boring predicates this table is
 *    built from.
 *
 * "It inherits the compiler, therefore it is fine" is the assumption the
 * shared case-sets exist to disprove — `driver-sqlite-wasm` recorded this same
 * cell as DEBT for that reason and cleared it with a suite, not with the
 * sentence. The REMOTE half of this driver inherits nothing at all and gets
 * its own file (`turso-remote-filter-logic-conformance.test.ts`), the same
 * two-transport shape the temporal suites next door already use.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';

const CONFORMANCE_OBJECT = {
  name: 'conformance',
  fields: {
    a: { type: 'string' },
    b: { type: 'string' },
    c: { type: 'string' },
    // [#5298] The NULL-bearing column; rows 3-4 seed it as `null`.
    d: { type: 'string' },
    owner: { type: 'string' },
    status: { type: 'string' },
    parent_object: { type: 'string' },
    parent_id: { type: 'string' },
  },
};

const ids = (rows: Array<Record<string, unknown>>): string[] =>
  rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));

describe('TursoDriver — filter logic conformance (local mode)', () => {
  let driver: TursoDriver;

  beforeAll(async () => {
    driver = new TursoDriver({ url: ':memory:' });
    // The mode this suite is about — the SqlDriver-inherited engine. Replica
    // shares it; remote does not (see module doc).
    expect(driver.transportMode).toBe('local');
    await driver.initObjects([CONFORMANCE_OBJECT]);
    for (const row of FILTER_LOGIC_ROWS) {
      await driver.create('conformance', { ...row }, { bypassTenantAudit: true });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  /**
   * The fixture as a whole, first: a case that returns nothing because the
   * seed failed must not read as a case that correctly excluded everything.
   */
  it('the fixture really is all four rows', async () => {
    const rows = await driver.find('conformance', { object: 'conformance' });
    expect(ids(rows)).toEqual(['1', '2', '3', '4']);
  });

  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, async () => {
      const rows = await driver.find(
        'conformance',
        { object: 'conformance', where: c.filter },
        { bypassTenantAudit: true },
      );
      expect(ids(rows), c.note).toEqual([...c.expected]);
    });
  }
});
