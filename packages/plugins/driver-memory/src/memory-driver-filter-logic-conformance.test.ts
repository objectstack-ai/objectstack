// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5324/#5328] Filter logical-combinator conformance for the LIVE QUERY PATH —
 * `InMemoryDriver.find`, through `normalizeFilterCondition` and mingo.
 *
 * # Why this file exists at all
 *
 * `FILTER_LOGIC_CASES` is the one standard five filter backends are held to
 * (`@objectstack/spec/data`, #3774). Four of them ran it through the code a real
 * query executes: `driver-sql` compiles it to SQL, `driver-sqlite-wasm` runs
 * that SQL on sql.js, `driver-mongodb` translates and executes it, and
 * `service-analytics` lowers it into its read-scope SQL.
 *
 * `driver-memory` ran it through `memory-matcher` ONLY
 * (`memory-matcher-or-semantics.test.ts`). That file is not a driver test: the
 * driver does not call `match()` — it imports exactly one symbol from that
 * module, `getValueByPath`, and filters with mingo instead. So this backend's
 * half of the conformance table was measured against a REFERENCE implementation
 * while the half users actually run was never executed against the standard once.
 *
 * The cost was not hypothetical. The table's `$not ANDs with its sibling keys
 * inside a branch` case was green here for as long as it has existed, while the
 * same filter through `InMemoryDriver.find` threw `unknown top level operator:
 * $not` — MongoDB has no document-level `$not`, so mingo has none either (#5324).
 * A conformance suite that green-lights an operator the driver cannot run is
 * worse than no suite: it is a gate reporting coverage it does not have, which
 * is the "declared ≠ enforced" shape Prime Directive #10 names.
 *
 * So the gap is closed the way the other three backends close it — by running
 * the table through the thing that serves queries. `memory-matcher-or-semantics`
 * stays: the matcher is still the reference evaluator, and holding BOTH faces to
 * the same table is what makes "this package has two filter surfaces" a
 * statement someone can check.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import type { FilterCondition } from '@objectstack/spec/data';

import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';

const TABLE = 'conformance';

describe('[#5324] InMemoryDriver.find — filter logic conformance (the LIVE query path)', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    // Every fixture column is a plain string — the shared table keeps its
    // predicates boring on purpose, so nothing here is about coercion. The
    // declaration is still made, because that is how a real object reaches the
    // driver and how its field kinds are resolved (#4047).
    await driver.syncSchema(TABLE, {
      fields: {
        id: { type: 'text', name: 'id' },
        a: { type: 'text', name: 'a' },
        b: { type: 'text', name: 'b' },
        c: { type: 'text', name: 'c' },
        owner: { type: 'text', name: 'owner' },
        status: { type: 'text', name: 'status' },
        parent_object: { type: 'text', name: 'parent_object' },
        parent_id: { type: 'text', name: 'parent_id' },
      },
    });
    for (const row of FILTER_LOGIC_ROWS) await driver.create(TABLE, { ...row });
  });

  const ids = async (where: FilterCondition): Promise<string[]> => {
    const rows = await driver.find(TABLE, { object: TABLE, fields: ['id'], where });
    return (rows as Array<Record<string, unknown>>).map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));
  };

  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, async () => {
      expect(await ids(c.filter), c.note).toEqual([...c.expected]);
    });
  }

  /**
   * The fixture as a whole, so a case that returns nothing because the seed
   * failed cannot read as a case that correctly excluded everything.
   */
  it('the fixture really is all four rows', async () => {
    expect(await ids({})).toEqual(['1', '2', '3', '4']);
  });

  /**
   * The two faces, on the same table, in one assertion.
   *
   * `memory-matcher-or-semantics.test.ts` already holds the matcher to these
   * cases and this file holds the driver to them, so both being green already
   * implies agreement. Asserting it directly is still worth one test: it is the
   * invariant #5240 established for this package ("a backend whose two halves
   * disagree about what a filter MEANS is exactly the divergence the ruling
   * closes"), and stated here it survives either suite being edited.
   */
  it('both filter faces answer the whole table identically', async () => {
    for (const c of FILTER_LOGIC_CASES) {
      const live = await ids(c.filter);
      const reference = FILTER_LOGIC_ROWS.filter((r) => match(r, c.filter)).map((r) => r.id);
      expect(live, `${c.name}: the live query path and the reference matcher disagree`).toEqual(reference);
    }
  });
});
