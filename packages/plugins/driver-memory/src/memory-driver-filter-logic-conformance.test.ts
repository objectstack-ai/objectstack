// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5324/#5328] Filter logical-combinator conformance for the LIVE QUERY PATH —
 * `InMemoryDriver.find`, through `normalizeFilterCondition` and mingo — and
 * [#5345] for the ANALYTICS (cube) face beside it.
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
 *
 * # The third face (#5345)
 *
 * It was never two. `memory-analytics.ts` compiles `AnalyticsQuery.where` with a
 * third, unrelated lowering — into cube-style `{member, operator, values}` — and
 * that one was outside the table too, for exactly as long and with exactly the
 * consequence this file's opening paragraph predicts: it answered `$or` and
 * `$not` by DROPPING them, so `{$or: [{a:'x'}, {b:'y'}]}` aggregated all four
 * rows instead of three. Nothing failed, because nothing asked.
 *
 * A cube pipeline genuinely cannot express `$or` or `$not`, so this face cannot
 * pass the table row-for-row and never will. That is not a reason to leave it
 * unmeasured — it is the reason to measure the thing that actually matters:
 *
 *   > For every case, the analytics face must either return the SAME ids as the
 *   > live query path, or REFUSE with `INVALID_FILTER`. It may never quietly
 *   > return a different set.
 *
 * That predicate is what the two silent `continue`s violated, it is what #3948
 * and ADR-0078 / #4286 each ruled on, and it stays true if the cube pipeline
 * later learns `$or` — the case simply moves from the refused column to the
 * agreeing one without this file changing.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import type { Cube, FilterCondition } from '@objectstack/spec/data';

import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { match } from './memory-matcher.js';

const TABLE = 'conformance';

/** The conformance fixture as a cube: one row per id, so a query returns ids. */
const CONFORMANCE_CUBE: Cube = {
  name: TABLE,
  title: 'Filter logic conformance',
  sql: TABLE,
  measures: { count: { name: 'count', label: 'Rows', type: 'count', sql: 'id' } },
  dimensions: Object.fromEntries(
    (['id', 'a', 'b', 'c', 'owner', 'status', 'parent_object', 'parent_id'] as const).map((f) => [
      f,
      { name: f, label: f, type: 'string' as const, sql: f },
    ]),
  ),
  public: true,
};

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

describe('[#5345] MemoryAnalyticsService — the same table, through the THIRD filter face', () => {
  let driver: InMemoryDriver;
  let service: MemoryAnalyticsService;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(TABLE, {
      fields: Object.fromEntries(
        (['id', 'a', 'b', 'c', 'owner', 'status', 'parent_object', 'parent_id'] as const).map((f) => [
          f,
          { type: 'text', name: f },
        ]),
      ),
    });
    for (const row of FILTER_LOGIC_ROWS) await driver.create(TABLE, { ...row });
    service = new MemoryAnalyticsService({ driver, cubes: [CONFORMANCE_CUBE] });
  });

  /**
   * The ids a case matches on the analytics face, or `REFUSED`.
   *
   * Grouping by `id` makes an aggregation answer the same question `find`
   * answers — which is the only way to compare the two faces at all, since one
   * returns records and the other returns counts. A widget's real symptom is the
   * count; the ids behind it are how you see WHICH rows it counted.
   */
  const REFUSED = Symbol('refused');
  const analyticsIds = async (where: FilterCondition): Promise<string[] | typeof REFUSED> => {
    let result;
    try {
      result = await service.query({
        cube: TABLE,
        measures: [`${TABLE}.count`],
        dimensions: [`${TABLE}.id`],
        where,
      });
    } catch (error) {
      const err = error as Error & { code?: string; status?: number };
      // Only a CATALOGUED refusal counts as a legitimate non-answer. An
      // uncoded throw would be this face failing, not refusing, and must not
      // be able to pass for conformance.
      expect(err.code, `${JSON.stringify(where)} threw without the ADR-0112 envelope: ${err.message}`)
        .toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      return REFUSED;
    }
    return (result.rows as Array<Record<string, unknown>>)
      .map((r) => String(r[`${TABLE}.id`]))
      .sort((x, y) => x.localeCompare(y));
  };

  it('the fixture really is all four rows', async () => {
    expect(await analyticsIds({})).toEqual(['1', '2', '3', '4']);
  });

  /**
   * The invariant, case by case: agree with the live path, or refuse. Never a
   * third, quieter answer.
   *
   * Before #5345 the `$or` cases landed in neither column — they returned all
   * four rows, which is the widening direction #3948 outlawed, and the read-scope
   * cases at the bottom of the table are the ones where that widening is an
   * unauthorized read rather than a wrong number.
   */
  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, async () => {
      const analytics = await analyticsIds(c.filter);
      if (analytics === REFUSED) return;
      expect(analytics, `${c.note ?? ''} — the analytics face answered without refusing, so it must AGREE`)
        .toEqual([...c.expected]);
    });
  }

  /**
   * The table's cases are mostly combinator shapes, so most of them refuse here.
   * That is the honest state of the cube pipeline — but a suite where EVERY case
   * refuses would also pass if `query()` had simply stopped working, so pin both
   * ends: at least one case must be genuinely answered, and the shapes the cube
   * pipeline cannot express must be the ones refused.
   */
  it('at least one case is answered, and every combinator case is refused rather than dropped', async () => {
    const answered: string[] = [];
    const refused: string[] = [];
    for (const c of FILTER_LOGIC_CASES) {
      ((await analyticsIds(c.filter)) === REFUSED ? refused : answered).push(c.name);
    }
    expect(answered.length, 'no case was answered at all — the face is broken, not merely narrow').toBeGreaterThan(0);
    expect(refused.length, 'nothing was refused — the silent drop is back').toBeGreaterThan(0);
    // Every case whose filter mentions a combinator this face cannot lower must
    // be in the refused column, by name — not merely "some things were refused".
    const uncompilable = FILTER_LOGIC_CASES.filter((c) => /"\$(or|not)"/.test(JSON.stringify(c.filter)));
    expect(uncompilable.length).toBeGreaterThan(0);
    for (const c of uncompilable) {
      expect(refused, `${c.name}: a $or/$not case must refuse, never answer`).toContain(c.name);
    }
  });
});
