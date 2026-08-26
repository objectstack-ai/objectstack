// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12393] `driver-mongodb` held to `VALUE_ROUNDTRIP_CASES` — the shared
 * `@objectstack/spec/data` table, answered **without a server**.
 *
 * ## Why the assertions run in-process rather than against mongod
 *
 * The same reason as `mongodb-filter-text-conformance.test.ts` (#6682) and
 * `mongodb-comparand-type-conformance.test.ts` (#7872): this package's
 * real-mongod suites are opt-in (#5517), so a standard that needed a server
 * would not run in CI. What this suite substitutes is not a weaker question —
 * it is the same question asked at the seam where this driver's stored values
 * are actually decided.
 *
 * ## Where that seam is, read from source rather than assumed
 *
 * A `create()` on this driver does exactly two things to a value before it is
 * stored, and this suite drives both:
 *
 * 1. **`toStorageForms`** — the write-side transform. Read at
 *    `mongodb-driver.ts`: it iterates the object's declared **temporal** fields
 *    and returns `data` unchanged when there are none. The fixture declares no
 *    temporal field at all, which the first test asserts mechanically rather
 *    than leaving as a claim — so for this table the transform is provably an
 *    identity and there is nothing of it to model.
 * 2. **BSON encoding**, which is where every remaining value decision is made.
 *    `find()` returns the driver documents straight off the cursor (no
 *    read-side coercion pass exists in this driver), so the round trip a caller
 *    sees IS `BSON.deserialize(BSON.serialize(doc))`.
 *
 * ⇒ The server-free judgement here is not "we modelled mongod". It is the
 * driver's own two value steps, executed, with the storage engine — which
 * stores what BSON hands it — left out. That is the accepted substitute this
 * package's sibling conformance suites already use, stated here rather than
 * implied.
 *
 * ⚠️ What it therefore does NOT cover, said plainly: anything mongod itself
 * would do to a value after decoding. The real-mongod half of this cell is
 * absent, as it is for this driver's aggregation and filter-text cells.
 */

import { describe, it, expect } from 'vitest';
import { BSON } from 'mongodb';
import {
  VALUE_ROUNDTRIP_CASES,
  VALUE_ROUNDTRIP_COLLISION_PAIRS,
  VALUE_ROUNDTRIP_FIELDS,
  VALUE_ROUNDTRIP_ROWS,
  valueRoundTripDivergence,
} from '@objectstack/spec/data';

/** The temporal types `toStorageForms` reaches — the set that must be empty here. */
const TEMPORAL_TYPES = new Set(['date', 'datetime', 'time']);

const caseOf = (name: string) => VALUE_ROUNDTRIP_CASES.find((c) => c.name === name)!;

/** One row through the driver's storage seam: BSON out, BSON back. */
function throughBson(row: Record<string, unknown>): Record<string, unknown> {
  return BSON.deserialize(BSON.serialize(row)) as Record<string, unknown>;
}

describe('[#12393] driver-mongodb — value storage round-trip conformance (server-free)', () => {
  /**
   * The premise the whole file rests on, asserted rather than asserted-in-prose:
   * if the fixture ever grows a temporal column, `toStorageForms` stops being an
   * identity and this suite would be modelling one of the driver's two value
   * steps instead of both. Then it must drive that transform too — and this
   * test is what says so, at the moment it becomes true.
   */
  it('the fixture declares no temporal field, so the write-side transform is an identity', () => {
    const temporal = Object.entries(VALUE_ROUNDTRIP_FIELDS)
      .filter(([, def]) => TEMPORAL_TYPES.has((def as { type: string }).type))
      .map(([name]) => name);
    expect(temporal).toEqual([]);
  });

  // The fixture read back rather than trusted: a table that lost a row would
  // turn every assertion below into a test of the wrong corpus.
  it('the fixture is one row per case', () => {
    expect(VALUE_ROUNDTRIP_ROWS.map((r) => r.label).sort()).toEqual(
      VALUE_ROUNDTRIP_CASES.map((c) => c.name).sort(),
    );
  });

  for (const c of VALUE_ROUNDTRIP_CASES) {
    it(`round-trips ${c.name} (${c.note})`, () => {
      const read = throughBson({ label: c.name, [c.column]: c.wrote })[c.column];
      // The type pin comes first: a wrong type carrying a right-looking value
      // is the before-state of every card this table was written from.
      expect(typeof read, `typeof for ${c.name}`).toBe(typeof c.wrote);
      expect(read, `value for ${c.name}`).toStrictEqual(c.wrote);
    });
  }

  it('every case in the table round-trips — the whole set at once', () => {
    const byLabel = new Map(
      VALUE_ROUNDTRIP_ROWS.map((r) => [r.label as string, throughBson({ ...r })]),
    );
    const divergences = VALUE_ROUNDTRIP_CASES.map((c) =>
      valueRoundTripDivergence(c, byLabel.get(c.name)?.[c.column]),
    ).filter((d): d is string => d !== null);
    expect(
      divergences,
      `${VALUE_ROUNDTRIP_CASES.length - divergences.length}/${VALUE_ROUNDTRIP_CASES.length} faithful`,
    ).toEqual([]);
  });

  it('a string and the native value it looks like stay distinguishable', () => {
    const byLabel = new Map(
      VALUE_ROUNDTRIP_ROWS.map((r) => [r.label as string, throughBson({ ...r })]),
    );
    for (const [strName, nativeName] of VALUE_ROUNDTRIP_COLLISION_PAIRS) {
      const s = byLabel.get(strName)?.[caseOf(strName).column];
      const n = byLabel.get(nativeName)?.[caseOf(nativeName).column];
      expect(typeof s, `${strName} must read back as a string`).toBe('string');
      expect(
        JSON.stringify(s) === JSON.stringify(n) && typeof s === typeof n,
        `${strName} and ${nativeName} read identically`,
      ).toBe(false);
    }
  });
});
