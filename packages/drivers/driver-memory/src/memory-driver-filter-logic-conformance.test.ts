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
 *
 * # The COMPARAND axis (#5373)
 *
 * `FILTER_LOGIC_CASES` is a table of operator and combinator SHAPES, and every
 * column in its fixture is a string — deliberately, so that nothing in it is
 * about coercion. That is a real hole on a face whose defect was coercion: all
 * three cases above passed while `{is_active: true}` returned zero rows and
 * `{closed_at: null}` returned the whole table, because the cube lowering
 * round-tripped every comparand through `string[]` and that round trip is lossy
 * for anything that is not already a string.
 *
 * So the second half of this file runs the same invariant over a fixture built
 * to vary the comparand's TYPE instead of the filter's shape. It belongs beside
 * the shape table rather than in a file of its own for the reason the shape
 * table exists at all: the thing being defended is "this package's filter faces
 * agree", and a divergence introduced on either axis has to fail in the place
 * someone looks when they change a lowering.
 *
 * # The OPERATOR axis (#5374)
 *
 * A third axis, and the third time this face was measured on one it had never
 * been measured on. Shape was covered, comparand TYPE was covered, and what an
 * operator MEANS once it has been mapped was not — so `$notContains`, which the
 * face declares and the gate admits, compiled to a bare mingo `{$not: 'et'}`
 * that constrains nothing and answered with the whole table, for as long as it
 * had existed. Same amplifying direction as the other two, arrived at from a
 * third place: #5345 was an operator with NO mapping, #5373 was the comparand
 * ENCODING, this is an operator whose mapping pointed at the wrong target.
 *
 * The last section holds the same invariant over that axis, and closes it for
 * the whole vocabulary rather than for the one operator: EVERY operator the face
 * declares is driven through both paths and must agree, so an operator added to
 * `ANALYTICS_FILTER_CAPABILITIES` without a working lowering fails here instead
 * of shipping a quietly wrong number.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import type { Cube, FilterCondition } from '@objectstack/spec/data';

import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService, ANALYTICS_FILTER_CAPABILITIES } from './memory-analytics.js';
import { match } from './memory-matcher.js';

const TABLE = 'conformance';

/** The conformance fixture as a cube: one row per id, so a query returns ids. */
const CONFORMANCE_CUBE: Cube = {
  name: TABLE,
  title: 'Filter logic conformance',
  sql: TABLE,
  measures: { count: { name: 'count', label: 'Rows', type: 'count', sql: 'id' } },
  dimensions: Object.fromEntries(
    (['id', 'a', 'b', 'c', 'd', 'owner', 'status', 'parent_object', 'parent_id'] as const).map((f) => [
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
        // [#5298] Nullable by construction — rows 3-4 seed `d: null`. This driver
        // stores what it is given, so no `nullable` flag exists to set; what
        // matters is that the seed keeps the null instead of substituting ''.
        d: { type: 'text', name: 'd' },
        owner: { type: 'text', name: 'owner' },
        status: { type: 'text', name: 'status' },
        parent_object: { type: 'text', name: 'parent_object' },
        parent_id: { type: 'text', name: 'parent_id' },
      },
    });
    for (const row of FILTER_LOGIC_ROWS) await driver.create(TABLE, { ...row });
  });

  const ids = async (where: FilterCondition): Promise<string[]> => {
    const rows = await driver.find(TABLE, { fields: ['id'], where });
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
        (['id', 'a', 'b', 'c', 'd', 'owner', 'status', 'parent_object', 'parent_id'] as const).map((f) => [
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

/**
 * [#5373] The same invariant, over comparand TYPES rather than filter shapes.
 *
 * The fixture is the one measured in the issue, plus the columns that separate
 * the third symptom: `code` is TEXT holding `'100'`, `qty` is NUMBER holding
 * `100`, so a comparand that silently became a number is visible as a wrong row
 * set on one and invisible on the other. `made_at` is a declared `datetime`,
 * which is the one comparand that legitimately still converts (#4047) and so is
 * the one a "stop converting" fix is most likely to break.
 */
const COMPARAND_TABLE = 'comparand_deal';

const COMPARAND_FIELDS = {
  id: { type: 'text', name: 'id' },
  is_active: { type: 'boolean', name: 'is_active' },
  name: { type: 'text', name: 'name' },
  closed_at: { type: 'text', name: 'closed_at' },
  code: { type: 'text', name: 'code' },
  qty: { type: 'number', name: 'qty' },
  made_at: { type: 'datetime', name: 'made_at' },
} as const;

const COMPARAND_ROWS: Array<Record<string, unknown>> = [
  { id: '1', is_active: true, name: 'alpha', closed_at: null, code: '100', qty: 100, made_at: new Date('2026-01-01T00:00:00Z') },
  { id: '2', is_active: false, name: 'beta', closed_at: '2026-01-01', code: '200', qty: 200, made_at: new Date('2026-06-01T00:00:00Z') },
  { id: '3', is_active: true, name: 'gamma', closed_at: null, code: '100', qty: 100, made_at: new Date('2026-01-01T00:00:00Z') },
];

const COMPARAND_CUBE: Cube = {
  name: COMPARAND_TABLE,
  title: 'Comparand round-trip',
  sql: COMPARAND_TABLE,
  measures: { count: { name: 'count', label: 'Rows', type: 'count', sql: 'id' } },
  dimensions: Object.fromEntries(
    Object.keys(COMPARAND_FIELDS).map((f) => [f, { name: f, label: f, type: 'string' as const, sql: f }]),
  ),
  public: true,
};

/**
 * Each case is `[name, where, expected ids]`. `expected` is asserted against the
 * live path too, so a case whose expectation is simply wrong fails loudly rather
 * than certifying whatever the two faces happen to agree on.
 */
const COMPARAND_CASES: Array<[name: string, where: FilterCondition, expected: string[]]> = [
  // The issue's measured table. Booleans round-tripped `true` → `'1'` → the
  // NUMBER 1, and mingo never equates 1 with true, so both of these were 0 rows.
  ['boolean true selects the true rows', { is_active: true } as FilterCondition, ['1', '3']],
  ['boolean false selects the false row', { is_active: false } as FilterCondition, ['2']],
  // The widening one: `{closed_at: null}` produced no cube entry at all, so the
  // predicate vanished and the query answered with the whole table (#3948).
  ['a null comparand is a predicate, not an absent one', { closed_at: null } as FilterCondition, ['1', '3']],
  ['negated null selects the complement', { closed_at: { $ne: null } } as FilterCondition, ['2']],
  // The issue's UNVERIFIED third symptom, measured and real: `'100'` from a TEXT
  // column round-tripped to the number 100 and matched nothing.
  ['a numeric-looking STRING stays a string', { code: '100' } as FilterCondition, ['1', '3']],
  ['a numeric-looking string inside $in stays a string', { code: { $in: ['100', '200'] } } as FilterCondition, ['1', '2', '3']],
  ['a real number comparand still matches a numeric column', { qty: 100 } as FilterCondition, ['1', '3']],
  ['a real number inside $in still matches', { qty: { $in: [100, 200] } } as FilterCondition, ['1', '2', '3']],
  // Same root cause, opposite direction: `$ne` against the number 1 excluded
  // nothing, so a negated boolean answered with every row.
  ['negated boolean excludes only the matching rows', { is_active: { $ne: true } } as FilterCondition, ['2']],
  // The comparand that must STILL convert: a `Date` against a declared
  // `datetime` column, which stores canonical UTC ISO text (#4047).
  ['a Date comparand still meets a datetime column', { made_at: new Date('2026-01-01T00:00:00Z') } as FilterCondition, ['1', '3']],
  ['a Date bound still orders against a datetime column', { made_at: { $lte: new Date('2026-03-01T00:00:00Z') } } as FilterCondition, ['1', '3']],
  // Ordinary strings were never broken; pinned so a fix aimed at the others
  // cannot quietly cost the common case.
  ['a plain string comparand is unchanged', { name: 'alpha' } as FilterCondition, ['1']],
  ['$and folds comparands of mixed type', { $and: [{ is_active: true }, { code: '100' }] } as FilterCondition, ['1', '3']],
];

describe('[#5373] comparand types — the analytics face against the live query path', () => {
  let driver: InMemoryDriver;
  let service: MemoryAnalyticsService;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(COMPARAND_TABLE, { fields: { ...COMPARAND_FIELDS } } as never);
    for (const row of COMPARAND_ROWS) await driver.create(COMPARAND_TABLE, { ...row });
    service = new MemoryAnalyticsService({ driver, cubes: [COMPARAND_CUBE] });
  });

  const sorted = (ids: string[]): string[] => [...ids].sort((x, y) => x.localeCompare(y));

  const findIds = async (where: FilterCondition): Promise<string[]> => {
    const rows = await driver.find(COMPARAND_TABLE, { fields: ['id'], where });
    return sorted((rows as Array<Record<string, unknown>>).map((r) => String(r.id)));
  };

  const analyticsIds = async (where: FilterCondition): Promise<string[]> => {
    const result = await service.query({
      cube: COMPARAND_TABLE,
      measures: [`${COMPARAND_TABLE}.count`],
      dimensions: [`${COMPARAND_TABLE}.id`],
      where,
    });
    return sorted((result.rows as Array<Record<string, unknown>>).map((r) => String(r[`${COMPARAND_TABLE}.id`])));
  };

  it('the fixture really is all three rows', async () => {
    expect(await findIds({})).toEqual(['1', '2', '3']);
    expect(await analyticsIds({})).toEqual(['1', '2', '3']);
  });

  for (const [name, where, expected] of COMPARAND_CASES) {
    it(name, async () => {
      // The live path first: it is the reference, so a wrong `expected` is
      // reported as such instead of being blamed on the analytics face.
      expect(await findIds(where), `${name}: the LIVE path disagrees with the expectation`).toEqual(sorted(expected));
      expect(
        await analyticsIds(where),
        `${name}: the analytics face answered a different row set than find() — the #5240 divergence`,
      ).toEqual(sorted(expected));
    });
  }

  /**
   * The whole point, stated once as a predicate over the whole table: no case
   * may be answered differently by the two faces. Case-by-case assertions above
   * already imply it, but stated here it survives the expectations being edited.
   */
  it('no comparand case is answered differently by the two faces', async () => {
    for (const [name, where] of COMPARAND_CASES) {
      expect(await analyticsIds(where), `${name}: the two faces disagree`).toEqual(await findIds(where));
    }
  });

  /**
   * The counter-test for the fixture itself. If `is_active` were stored as
   * `1`/`0` rather than `true`/`false`, the boolean cases above would pass
   * without the bug ever having been fixed.
   */
  it('the fixture stores real booleans and real nulls, not their stringified forms', async () => {
    const rows = (await driver.find(COMPARAND_TABLE, {
      fields: ['id', 'is_active', 'closed_at', 'code'],
    })) as Array<Record<string, unknown>>;
    const one = rows.find((r) => r.id === '1')!;
    expect(one.is_active).toBe(true);
    expect(one.closed_at).toBeNull();
    expect(one.code).toBe('100');
    expect(rows.find((r) => r.id === '2')!.is_active).toBe(false);
  });
});

/**
 * [#5373] The OTHER exit.
 *
 * `query()` and `generateSql()` compile the same lowered entries into different
 * targets, and the defect existed precisely because one encoding served both. A
 * fix that satisfies mingo while emitting SQL that means something else has
 * moved the bug rather than closed it, so the SQL exit is pinned on the same
 * cases — including the two where the correct SQL is not a comparison at all.
 */
describe('[#5373] the generateSql exit emits literals that mean the same thing', () => {
  let service: MemoryAnalyticsService;

  beforeAll(async () => {
    const driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(COMPARAND_TABLE, { fields: { ...COMPARAND_FIELDS } } as never);
    service = new MemoryAnalyticsService({ driver, cubes: [COMPARAND_CUBE] });
  });

  const whereClause = async (where: FilterCondition): Promise<string> => {
    const { sql } = await service.generateSql({
      cube: COMPARAND_TABLE,
      measures: [`${COMPARAND_TABLE}.count`],
      where,
    });
    const m = /WHERE (.*?)(?: GROUP BY | ORDER BY | LIMIT | OFFSET |$)/.exec(sql);
    return m ? m[1].trim() : '';
  };

  it('a boolean keeps the SQLite-style numeric spelling', async () => {
    expect(await whereClause({ is_active: true } as FilterCondition)).toBe('is_active = 1');
    expect(await whereClause({ is_active: false } as FilterCondition)).toBe('is_active = 0');
  });

  /**
   * `= NULL` is never true in SQL, so emitting it would make this exit select
   * nothing while `query()` selects the null rows — the same divergence one
   * layer over. Before #5373 the clause was absent entirely, which is the
   * widening direction instead.
   */
  it('a null comparand becomes a nullness test, not a comparison', async () => {
    expect(await whereClause({ closed_at: null } as FilterCondition)).toBe('closed_at IS NULL');
    expect(await whereClause({ closed_at: { $ne: null } } as FilterCondition)).toBe('closed_at IS NOT NULL');
  });

  /**
   * The third symptom at this exit: with only the stringified form to read,
   * a TEXT `'100'` and a numeric `100` were indistinguishable and both were
   * emitted unquoted.
   */
  it('a numeric-looking string is quoted and a real number is not', async () => {
    expect(await whereClause({ code: '100' } as FilterCondition)).toBe("code = '100'");
    expect(await whereClause({ qty: 100 } as FilterCondition)).toBe('qty = 100');
  });

  it('a string comparand escapes its embedded quotes', async () => {
    expect(await whereClause({ name: "O'Brien" } as FilterCondition)).toBe("name = 'O''Brien'");
  });

  it('a Date comparand is emitted as quoted canonical UTC text', async () => {
    expect(await whereClause({ made_at: new Date('2026-01-01T00:00:00Z') } as FilterCondition))
      .toBe("made_at = '2026-01-01T00:00:00.000Z'");
  });
});

/**
 * [#5374] The same invariant again, over what an operator MEANS.
 *
 * The fixture is the one the issue measured on — three rows whose `name` is
 * `alpha` / `beta` / `gamma`, of which only `beta` contains `et` — so the first
 * case below IS the issue's acceptance criterion, on its own numbers.
 *
 * Every case is asserted against `find()` first and the analytics face second,
 * for the reason the #5373 block gives: the live path is the reference, so an
 * expectation that is simply wrong is reported as a wrong expectation instead of
 * being blamed on the face under test.
 */
const OPERATOR_CASES: Array<[name: string, where: FilterCondition, expected: string[]]> = [
  // ── The issue, on its own measurement ──────────────────────────────────────
  // `notContains` mapped to `'$not'` and the call site filled it in as
  // `{name: {$not: 'et'}}`. mingo's `$not` takes a regex or an operator
  // expression; a bare scalar constrains nothing, so this answered 3 where
  // `find()` answers 2 — a predicate emitted, visible in the pipeline, and inert.
  ['$notContains excludes the rows that contain the comparand', { name: { $notContains: 'et' } } as FilterCondition, ['1', '3']],
  // The tell that separates "inert" from "merely wrong": a comparand every row
  // contains must exclude every row. Under the bare `$not` this was the whole
  // table, which is also what a correct `$notContains` returns for case 3 below
  // — so without this case the defect hides behind an accidentally-right answer.
  ['a $notContains that matches every row selects none of them', { name: { $notContains: 'a' } } as FilterCondition, []],
  ['a $notContains that matches no row selects all of them', { name: { $notContains: 'zzz' } } as FilterCondition, ['1', '2', '3']],
  // `contains` and `notContains` have to partition the table between them. They
  // could not while one was a real `$regex` and the other was inert.
  ['$contains selects exactly what $notContains excludes', { name: { $contains: 'et' } } as FilterCondition, ['2']],

  // ── The comparand is a LITERAL, not a pattern ──────────────────────────────
  // `contains` was mapped correctly to `$regex` but handed the comparand raw, so
  // regex metacharacters were live: `a.p` matched `alpha` through `.`, where the
  // live path escapes and matched nothing. Fixing `notContains` without fixing
  // this would have made the two non-complementary in a new way — `alpha` would
  // be in BOTH answers.
  ['$contains treats a metacharacter as a literal', { name: { $contains: 'a.p' } } as FilterCondition, []],
  ['$notContains treats a metacharacter as a literal', { name: { $notContains: 'a.p' } } as FilterCondition, ['1', '2', '3']],

  // ── Case folding, borrowed rather than re-derived ──────────────────────────
  // These rows have always asserted that the two faces answer ONE rule, and they
  // still do — what changed is WHICH rule. #5374 pinned the shared rule as the
  // live path's `/…/i`, because this face was the one that had drifted then.
  // #6682 ruled the whole `$contains` family case-SENSITIVE (#4706 Q2 = A), the
  // flag came off `filterSubstringPattern`, and this face moved with the live
  // path — which is the property #5374 bought, working in the direction it was
  // built for. Flipped to the ruled substance rather than deleted: "the faces
  // agree on case" is exactly the assertion that must survive the ruling.
  ['$contains is case-SENSITIVE, as the live path is', { name: { $contains: 'ALPHA' } } as FilterCondition, []],
  ['$notContains is case-SENSITIVE, as the live path is', { name: { $notContains: 'ALPHA' } } as FilterCondition, ['1', '2', '3']],
  ['$contains misses a mixed-case comparand', { name: { $contains: 'Bet' } } as FilterCondition, []],
  // The positive control beside them, so the three rows above cannot be passed
  // by a predicate that stopped matching anything at all: the exactly-cased
  // comparand still selects its row.
  ['$contains still matches an exactly-cased comparand', { name: { $contains: 'bet' } } as FilterCondition, ['2']],

  // ── A pattern is not a comparand (#4047) ───────────────────────────────────
  // Every operand used to go through the storage-form conversion, so on a
  // declared `datetime` column the PATTERN itself was rewritten into canonical
  // form and then matched — `find()`, which never rewrites a pattern, matched
  // nothing. The two-list `MongoPredicateInput` split is what stops this.
  ['$contains does not rewrite its pattern into a datetime storage form', { made_at: { $contains: '2026-01-01T00:00:00Z' } } as FilterCondition, []],
  ['$notContains does not rewrite its pattern either', { made_at: { $notContains: '2026-01-01T00:00:00Z' } } as FilterCondition, ['1', '2', '3']],

  // A column holding nulls: the negation must not resurrect the rows it cannot
  // test, which is the other way a `$not` goes wrong.
  ['$notContains over a column holding nulls', { closed_at: { $notContains: '2026' } } as FilterCondition, ['1', '3']],
  ['$contains over a column holding nulls', { closed_at: { $contains: '2026' } } as FilterCondition, ['2']],

  // ── An empty list is a predicate ───────────────────────────────────────────
  // The call site guarded the whole lowering with `values.length > 0`, so an
  // empty `$in` emitted NO predicate and the query widened to the whole table
  // while `find()` returned nothing — the #3948 direction again, reached through
  // the operator table's inability to say "this operator takes the whole list".
  ['an empty $in selects nothing', { code: { $in: [] } } as FilterCondition, []],
  ['an empty $nin selects everything', { code: { $nin: [] } } as FilterCondition, ['1', '2', '3']],
  ['an empty implicit-equality list selects nothing', { code: [] } as unknown as FilterCondition, []],
  ['a non-empty $in still selects its members', { code: { $in: ['100'] } } as FilterCondition, ['1', '3']],
];

/**
 * One probe per operator the face DECLARES — the "declared = enforced" half.
 *
 * The case table above is chosen by a human who knew where the bug was, which is
 * exactly why it cannot be the whole test: #5374 existed because nobody thought
 * to look at `$notContains`. This map is keyed by the face's own declared
 * vocabulary and the test below fails if a key is missing, so widening
 * `ANALYTICS_FILTER_CAPABILITIES` without proving the new operator agrees with
 * `find()` is no longer possible to do quietly.
 *
 * Every probe must EXCLUDE at least one row. A probe that selects the whole
 * table agrees with `find()` for free and would certify an inert predicate —
 * which is the precise shape of the bug this section exists for.
 */
const DECLARED_OPERATOR_PROBES: Record<string, FilterCondition> = {
  $eq: { code: { $eq: '100' } } as FilterCondition,
  $ne: { code: { $ne: '100' } } as FilterCondition,
  $gt: { qty: { $gt: 100 } } as FilterCondition,
  $gte: { qty: { $gte: 200 } } as FilterCondition,
  $lt: { qty: { $lt: 200 } } as FilterCondition,
  $lte: { qty: { $lte: 100 } } as FilterCondition,
  $in: { code: { $in: ['100'] } } as FilterCondition,
  $nin: { code: { $nin: ['100'] } } as FilterCondition,
  $contains: { name: { $contains: 'et' } } as FilterCondition,
  $notContains: { name: { $notContains: 'et' } } as FilterCondition,
  // [#6520] The comparand is deliberately UPPER-case against a lower-case
  // fixture (`beta`), so the probe only selects row 2 once the ASCII fold
  // actually runs. `'et'` would have been discriminating too, and would have
  // agreed for free on a face that never folded — which is the certification
  // this block's own header warns against.
  $icontains: { name: { $icontains: 'BET' } } as FilterCondition,
  $exists: { closed_at: { $exists: false } } as FilterCondition,
};

describe('[#5374] operator semantics — the analytics face against the live query path', () => {
  let driver: InMemoryDriver;
  let service: MemoryAnalyticsService;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(COMPARAND_TABLE, { fields: { ...COMPARAND_FIELDS } } as never);
    for (const row of COMPARAND_ROWS) await driver.create(COMPARAND_TABLE, { ...row });
    service = new MemoryAnalyticsService({ driver, cubes: [COMPARAND_CUBE] });
  });

  const sorted = (ids: string[]): string[] => [...ids].sort((x, y) => x.localeCompare(y));

  const findIds = async (where: FilterCondition): Promise<string[]> => {
    const rows = await driver.find(COMPARAND_TABLE, { fields: ['id'], where });
    return sorted((rows as Array<Record<string, unknown>>).map((r) => String(r.id)));
  };

  const analyticsIds = async (where: FilterCondition): Promise<string[]> => {
    const result = await service.query({
      cube: COMPARAND_TABLE,
      measures: [`${COMPARAND_TABLE}.count`],
      dimensions: [`${COMPARAND_TABLE}.id`],
      where,
    });
    return sorted((result.rows as Array<Record<string, unknown>>).map((r) => String(r[`${COMPARAND_TABLE}.id`])));
  };

  it('the fixture really is the three rows the issue measured', async () => {
    expect(await findIds({})).toEqual(['1', '2', '3']);
    expect(await analyticsIds({})).toEqual(['1', '2', '3']);
    // Only `beta` contains `et` — the property the issue's numbers rest on.
    expect(COMPARAND_ROWS.filter((r) => String(r.name).includes('et')).map((r) => r.id)).toEqual(['2']);
  });

  for (const [name, where, expected] of OPERATOR_CASES) {
    it(name, async () => {
      expect(await findIds(where), `${name}: the LIVE path disagrees with the expectation`).toEqual(sorted(expected));
      expect(
        await analyticsIds(where),
        `${name}: the analytics face answered a different row set than find() — the #5240 divergence`,
      ).toEqual(sorted(expected));
    });
  }

  /**
   * `contains` and `notContains` partition the table, stated as a predicate over
   * every comparand rather than case by case. An inert `$notContains` fails this
   * for every comparand at once; a `notContains` fixed WITHOUT fixing
   * `contains`'s escaping and case folding fails it on the last two.
   */
  it('$contains and $notContains partition the table for every comparand', async () => {
    for (const needle of ['et', 'a', 'zzz', 'ALPHA', 'a.p', 'Bet']) {
      const inside = await analyticsIds({ name: { $contains: needle } } as FilterCondition);
      const outside = await analyticsIds({ name: { $notContains: needle } } as FilterCondition);
      expect(sorted([...inside, ...outside]), `'${needle}': the two halves are not a partition`).toEqual(['1', '2', '3']);
      expect(inside.filter((id) => outside.includes(id)), `'${needle}': a row is in both halves`).toEqual([]);
    }
  });

  /**
   * The vocabulary, end to end. This is the assertion that would have caught
   * #5374 on the day `notContains` was mapped to `$not`.
   */
  it('every operator this face DECLARES compiles to a predicate that agrees with find()', async () => {
    const declared = [...ANALYTICS_FILTER_CAPABILITIES.fieldOperators].sort();
    expect(
      Object.keys(DECLARED_OPERATOR_PROBES).sort(),
      'the face declares an operator with no probe here (or a probe survives an operator that was removed) — ' +
        'widening the vocabulary means proving the new operator agrees with find()',
    ).toEqual(declared);

    for (const op of declared) {
      const where = DECLARED_OPERATOR_PROBES[op];
      const live = await findIds(where);
      expect(
        live.length,
        `${op}: the probe selects the whole table, so "the faces agree" would prove nothing — pick a discriminating one`,
      ).toBeLessThan(COMPARAND_ROWS.length);
      expect(await analyticsIds(where), `${op}: the analytics face does not agree with find()`).toEqual(live);
    }
  });

  /**
   * The pipeline itself, once. The row-set assertions above are what matters,
   * but they cannot distinguish "the predicate is right" from "the predicate is
   * absent and the rows happen to line up", and the emitted `$match` is the
   * artifact the issue actually diagnosed.
   */
  it('the emitted $match wraps the negation around a pattern instead of a bare scalar', async () => {
    const { sql } = await service.query({
      cube: COMPARAND_TABLE,
      measures: [`${COMPARAND_TABLE}.count`],
      where: { name: { $notContains: 'et' } } as FilterCondition,
    });
    const matchStage = /\/\* Stage 1: \$match \*\/ (.*)/.exec(sql ?? '')?.[1] ?? '';
    // `JSON.stringify` renders a RegExp as `{}`, so assert on the STRUCTURE the
    // pipeline carries rather than on that rendering.
    expect(matchStage).not.toBe('{"name":{"$not":"et"}}');
    expect(matchStage).toContain('"$not"');
    expect(matchStage).toContain('"$regex"');
  });
});
