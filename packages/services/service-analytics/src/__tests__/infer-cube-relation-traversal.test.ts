// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5739 — a relation traversal on the AD-HOC cube path is a traversal, not a
 * base-table column.
 *
 * `inferCubeFromQuery` mints a Cube for a query naming no registered cube. Every
 * mint site ran the member through a blanket `stripPrefix`, which dropped the
 * first segment of ANY dotted name. That is right for the `<cube>.` QUALIFIER
 * (`crm_account.industry` → `industry`) and wrong for a relation TRAVERSAL:
 * `owner.region` was minted as `dimensions.region = {sql: 'region'}`, a BASE
 * column. `lookupMember`'s "plain second-segment" tier then found that key
 * BEFORE its synthetic-traversal tier could hand the dotted path to the JOIN
 * machinery, so the traversal was shadowed by a base column.
 *
 * Measured on `origin/main` (`dc6abfd`), with `crm_account` carrying a base
 * column ALSO called `region` — the shape that makes the defect silent:
 *
 * ```
 * ① ObjectQL,  where: {'owner.region':'NA'} → executeAggregate ← {"region":"NA"}
 * ② NativeSQL, where: {'owner.region':'NA'} → … FROM "crm_account" WHERE region = $1
 * ③ ObjectQL,  dimensions: ['owner.region'] → groupBy: ["region"]
 * ④ NativeSQL, dimensions: ['owner.region'] → SELECT region AS "owner.region" … GROUP BY region
 * ```
 *
 * Four silent wrong-column answers: right-looking rows, wrong rows. ④ is the
 * worst of them — the response column is LABELLED `owner.region` while the value
 * comes from the base table, so the result cannot be read as wrong.
 *
 * Maintainer ruling, 2026-08-06 (issue #5739, the 08:28Z and 10:37Z comments):
 * mint the traversal VERBATIM and let the ad-hoc path serve it, converging with
 * the array `where` spelling, which compiled the correct JOIN all along. The
 * public floor is that the silent wrong column must disappear; this file's
 * block 1 is that floor, one case per combination.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Restoring the blanket `stripPrefix` (and the dotted residue loop it fed) turns
 * RED every case that names a traversal — the four in block 1, the three in
 * block 2, both in block 4 — because each asserts on a JOIN, an FK-expand or a
 * dotted cube key that only exists once the mint stops stripping. Ordinary
 * direction, no inversion: the assertions are on statements and rows that GAIN
 * a join, and every one of them also asserts the base-column answer is ABSENT,
 * so a case cannot pass by producing nothing.
 *
 * Blocks 3 and 5 stay GREEN in both directions, and that is their point: they
 * fence what the ruling does NOT move — the real `<cube>.` qualifier still
 * strips, and every rejection the source-field gates (#4437 / #5520 / #5669)
 * already produced is still produced, with the same envelope.
 *
 * **Predicted: blocks 1, 2 and 4 red (10 of this file's 17), blocks 3 and 5
 * green; measured exactly that set** — plus, in the same run, the three flipped
 * cases in `infer-cube-where-spelling-parity.test.ts` and the one in
 * `where-source-field-gate.test.ts`, for 14 red across the package.
 *
 * ## [#5918] One case in block 5 changed hands
 *
 * The dotted MEASURE this file pinned as "#4437 refuses it, naming the strip"
 * is now refused at the MINT, naming the caller's own spelling — the fourth
 * mint site #5739 measured and deliberately left alone, ruled on 2026-08-07 in
 * its own right (measures have no traversal tier to converge on, so a refusal,
 * not a verbatim mint). Block 5's floor is untouched: the query is refused,
 * with `INVALID_FIELD` / 400, and never becomes SQL. Both directions of the
 * reverse verification above are unaffected — restoring the blanket
 * DIMENSION strip leaves that case green, as this block promises.
 */

import { describe, it, expect, vi } from 'vitest';
import { AnalyticsService } from '../analytics-service.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

/**
 * `crm_account`'s real columns. `region` is deliberately one of them: it is the
 * base column `owner.region` used to be mis-cast onto, and the reason the defect
 * was silent rather than a `no such column`.
 */
const ACCOUNT_FIELDS = ['id', 'name', 'industry', 'region', 'owner', 'created_at'];

/** What the BASE table's own `region` column answers — never the right answer here. */
const BASE_REGION = 'BASE-REGION';

/**
 * A service with NO registered cube for `crm_account`, so every query takes the
 * auto-inference path. One service per query: `ensureCube` registers what it
 * infers, so a second query on the same service would find the cube.
 *
 * `executeAggregate` is a two-object double. It serves the base aggregate AND
 * the FK→attribute read the ObjectQL cross-object plan issues against `owner`,
 * and it answers the related `region` with values that differ from the base
 * column's — so a mis-cast is caught by the VALUES in the result, not only by
 * the shape of the call.
 */
function makeService(opts: { native?: boolean; fields?: string[] } = {}) {
  const sqls: string[] = [];
  const calls: Array<{ object: string; groupBy?: unknown; filter?: unknown }> = [];
  const service = new AnalyticsService({
    logger: silentLogger,
    queryCapabilities: () => ({
      nativeSql: !!opts.native,
      objectqlAggregate: !opts.native,
      inMemory: false,
    }),
    executeAggregate: async (object: string, options: any) => {
      calls.push({ object, groupBy: options?.groupBy, filter: options?.filter });
      // The related object, read by the FK-expand: two owners in two regions.
      if (object === 'owner') {
        return [
          { id: 'u1', region: 'NA' },
          { id: 'u2', region: 'EMEA' },
        ];
      }
      const groupBy = (options?.groupBy ?? []) as unknown[];
      if (groupBy.includes('owner')) {
        return [
          { owner: 'u1', count: 2 },
          { owner: 'u2', count: 3 },
        ];
      }
      // The mis-cast's own answer: grouping on the BASE `region` column.
      if (groupBy.includes('region')) return [{ region: BASE_REGION, count: 5 }];
      return [{ count: 5 }];
    },
    executeRawSql: async (_object: string, sql: string) => {
      sqls.push(sql);
      return [{ count: 1 }];
    },
    isRegisteredObject: (n: string) => n === 'crm_account',
    getObjectFieldNames: (n: string) =>
      n === 'crm_account' ? (opts.fields ?? ACCOUNT_FIELDS) : undefined,
  } as any);
  return { service, sqls, calls };
}

/** Run one query and report everything it produced, however it settled. */
async function run(query: unknown, opts: { native?: boolean; fields?: string[] } = {}) {
  const { service, sqls, calls } = makeService(opts);
  let rows: unknown[] | undefined;
  let error: (Error & { code?: string; status?: number; field?: string }) | undefined;
  try {
    rows = (await service.query(query as never)).rows as unknown[];
  } catch (e) {
    error = e as Error & { code?: string };
  }
  const [meta] = await service.getMeta((query as { cube: string }).cube);
  const cubePrefix = `${(query as { cube: string }).cube}.`;
  return {
    rows,
    error,
    sqls,
    calls,
    // `getMeta` hands members out cube-prefixed; the KEY is what the mint produced.
    dimensions: (meta?.dimensions ?? []).map((d) => d.name.replace(cubePrefix, '')).sort(),
    measures: (meta?.measures ?? []).map((m) => m.name.replace(cubePrefix, '')).sort(),
  };
}

// ── 1. The four combinations the issue measured ──────────────────────────────

describe('[#5739] a dotted member traverses on the ad-hoc path — the silent wrong column is gone', () => {
  it('① ObjectQL / `where` — declines LOUDLY instead of filtering the base column', async () => {
    // The ad-hoc cube is single-table and `engine.aggregate()` cannot join, so a
    // cross-object FILTER is out of the envelope. That is the answer a REGISTERED
    // cube already gives for this member (issue #5739's own control measurement),
    // and the ruling requires this path to give the same loud one — never a third,
    // quieter answer. The engine must not run at all.
    const { error, calls } = await run({
      cube: 'crm_account',
      measures: ['count'],
      where: { 'owner.region': 'NA' },
    });

    expect(error?.message).toMatch(/cannot evaluate a cross-object filter \("owner\.region"\)/);
    // The floor: no aggregate ran, so nothing was filtered on the base `region`.
    expect(calls).toEqual([]);
  });

  it('② NativeSQL / `where` — joins the relation instead of filtering the base column', async () => {
    const { sqls } = await run(
      { cube: 'crm_account', measures: ['count'], where: { 'owner.region': 'NA' } },
      { native: true },
    );

    expect(sqls[0]).toBe(
      'SELECT COUNT(*) AS "count" FROM "crm_account" ' +
        'LEFT JOIN "owner" ON "crm_account"."owner" = "owner"."id" ' +
        'WHERE "owner"."region" = $1',
    );
    // The mis-cast's statement, named so the case cannot pass by producing nothing.
    expect(sqls[0]).not.toContain('WHERE region = ');
  });

  it('③ ObjectQL / `dimensions` — FK-expands to the RELATED value, not the base column', async () => {
    // In envelope: a single-hop cross-object DIMENSION with a recombinable
    // measure is served by grouping on the FK, resolving the FK to the related
    // attribute with a SCOPED read, and re-bucketing. This is the strongest
    // assertion in the file — it is about VALUES, and the double answers the base
    // `region` column with a value the related object never carries.
    const { rows, calls } = await run({
      cube: 'crm_account',
      measures: ['count'],
      dimensions: ['owner.region'],
    });

    expect(rows).toEqual([
      { 'owner.region': 'NA', count: 2 },
      { 'owner.region': 'EMEA', count: 3 },
    ]);
    // Grouped by the FK on the base object, then the related object read by id.
    expect(calls.map((c) => c.object)).toEqual(['crm_account', 'owner']);
    expect(calls[0].groupBy).toEqual(['owner']);
    expect(calls[1].groupBy).toEqual(['id', 'region']);
    expect(calls[1].filter).toEqual({ id: { $in: ['u1', 'u2'] } });
    // The mis-cast's answer, absent: the BASE object was never grouped by its own
    // `region` column, and no row carries that column's value. (`region` DOES
    // appear in the second call's groupBy — that is the related object's column,
    // read on `owner`, which is the whole point.)
    expect(
      calls
        .filter((c) => c.object === 'crm_account')
        .some((c) => (c.groupBy as unknown[])?.includes('region')),
    ).toBe(false);
    expect(JSON.stringify(rows)).not.toContain(BASE_REGION);
  });

  it('④ NativeSQL / `dimensions` — the labelled column and the value finally agree', async () => {
    // The issue's worst case: the response column was already LABELLED
    // `owner.region` while `GROUP BY region` fed it from the base table, so the
    // result could not be read as wrong.
    const { sqls } = await run(
      { cube: 'crm_account', measures: ['count'], dimensions: ['owner.region'] },
      { native: true },
    );

    expect(sqls[0]).toBe(
      'SELECT "owner"."region" AS "owner.region", COUNT(*) AS "count" FROM "crm_account" ' +
        'LEFT JOIN "owner" ON "crm_account"."owner" = "owner"."id" ' +
        'GROUP BY "owner"."region"',
    );
    expect(sqls[0]).not.toContain('GROUP BY region');
    expect(sqls[0]).not.toContain('SELECT region AS');
  });
});

// ── 2. One traversal, two `where` spellings, one answer ──────────────────────

/**
 * The ruling's mechanism: mint verbatim so the OBJECT spelling resolves through
 * `lookupMember`'s direct hit, landing on the same `qualifyAndRegisterJoin`
 * input the ARRAY spelling has always reached through the synthetic tier. #5353
 * (PR #5764) could unify only BARE keys and left this per-spelling; these are the
 * cases that then flip.
 */
describe('[#5739] the object and array `where` spellings converge on one traversal', () => {
  it('compiles the byte-identical statement for both spellings', async () => {
    const object = await run(
      { cube: 'crm_account', measures: ['count'], where: { 'owner.region': 'NA' } },
      { native: true },
    );
    const array = await run(
      { cube: 'crm_account', measures: ['count'], where: [['owner.region', '=', 'NA']] },
      { native: true },
    );

    expect(array.sqls).toEqual(object.sqls);
    // Stated separately so a failure reads as "they diverged" and not merely as a
    // wrong expected string — and pinned to the JOIN so both cannot be empty.
    expect(object.sqls[0]).toContain('LEFT JOIN "owner" ON "crm_account"."owner" = "owner"."id"');
    expect(object.sqls[0]).toContain('WHERE "owner"."region" = ');
  });

  it('mints the identical cube for both spellings — the traversal, spelled as written', async () => {
    const object = await run({
      cube: 'crm_account',
      measures: ['count'],
      where: { 'owner.region': 'NA' },
    });
    const array = await run({
      cube: 'crm_account',
      measures: ['count'],
      where: [['owner.region', '=', 'NA']],
    });

    expect(object.dimensions).toEqual(['owner.region']);
    expect(array.dimensions).toEqual(object.dimensions);
    // The stripped tail is what the mis-cast produced; it must not be in the bag.
    expect(object.dimensions).not.toContain('region');
  });

  it('declines identically on ObjectQL for both spellings', async () => {
    const object = await run({
      cube: 'crm_account',
      measures: ['count'],
      where: { 'owner.region': 'NA' },
    });
    const array = await run({
      cube: 'crm_account',
      measures: ['count'],
      where: [['owner.region', '=', 'NA']],
    });

    expect(array.error?.message).toBe(object.error?.message);
    expect(object.error?.message).toMatch(/cannot evaluate a cross-object filter/);
  });

  it('unifies a dotted key riding alongside a bare one, on both spellings', async () => {
    const { sqls, dimensions } = await run(
      {
        cube: 'crm_account',
        measures: ['count'],
        where: [
          ['industry', '=', 'tech'],
          ['owner.region', '=', 'NA'],
        ],
      },
      { native: true },
    );

    expect(dimensions).toEqual(['industry', 'owner.region']);
    // The bare column stays BARE: `qualifyAndRegisterJoin` qualifies plain
    // identifiers only when the cube declares `joins`, and an inferred cube never
    // does — minting a dotted dimension does not change that (#5353's block 2).
    expect(sqls[0]).toContain('WHERE (industry = $1 AND "owner"."region" = $2)');
  });
});

// ── 3. What the ruling does NOT move: the real `<cube>.` qualifier ───────────

describe('[#5739] a real `<cube>.` qualifier is still stripped', () => {
  it('strips it from `dimensions` and `measures` — base columns, no join', async () => {
    const { sqls, dimensions, measures } = await run(
      {
        cube: 'crm_account',
        measures: ['crm_account.count'],
        dimensions: ['crm_account.industry'],
      },
      { native: true },
    );

    expect(dimensions).toEqual(['industry']);
    expect(measures).toEqual(['count']);
    expect(sqls[0]).toBe(
      'SELECT industry AS "crm_account.industry", COUNT(*) AS "crm_account.count" ' +
        'FROM "crm_account" GROUP BY industry',
    );
    expect(sqls[0]).not.toContain('LEFT JOIN');
  });

  it('strips it from a `where` key — no phantom join to a table named after the cube', async () => {
    const { sqls, dimensions } = await run(
      { cube: 'crm_account', measures: ['count'], where: { 'crm_account.industry': 'tech' } },
      { native: true },
    );

    expect(dimensions).toEqual(['industry']);
    expect(sqls[0]).toBe('SELECT COUNT(*) AS "count" FROM "crm_account" WHERE industry = $1');
    expect(sqls[0]).not.toContain('LEFT JOIN');
  });

  it('leaves the base table\'s OWN same-named column reachable as itself', async () => {
    // The control for block 1: `region` is a real column of `crm_account`, and
    // naming it bare must still group by it. The ruling narrows what a DOTTED
    // member means, not what a bare one does.
    const { sqls } = await run(
      { cube: 'crm_account', measures: ['count'], dimensions: ['region'] },
      { native: true },
    );

    expect(sqls[0]).toBe(
      'SELECT region AS "region", COUNT(*) AS "count" FROM "crm_account" GROUP BY region',
    );
    expect(sqls[0]).not.toContain('LEFT JOIN');
  });
});

// ── 4. The third mint site: `timeDimensions` ─────────────────────────────────

describe('[#5739] `timeDimensions` mint the traversal too', () => {
  it('windows on the RELATED timestamp instead of the base one (NativeSQL)', async () => {
    // The quietest face of the defect: every object has `created_at`, so the
    // stripped tail ALWAYS resolved to a real base column and no gate ever fired —
    // the window silently moved to the wrong table's timestamps.
    const { sqls, dimensions } = await run(
      {
        cube: 'crm_account',
        measures: ['count'],
        timeDimensions: [{ dimension: 'owner.created_at', dateRange: ['2026-01-01', '2026-02-01'] }],
      },
      { native: true },
    );

    expect(dimensions).toEqual(['owner.created_at']);
    expect(sqls[0]).toContain('LEFT JOIN "owner" ON "crm_account"."owner" = "owner"."id"');
    expect(sqls[0]).toContain('"owner"."created_at" >= $1');
    expect(sqls[0]).not.toMatch(/WHERE \(created_at >=/);
  });

  it('declines a cross-object BUCKET loudly on ObjectQL', async () => {
    const { error, calls } = await run({
      cube: 'crm_account',
      measures: ['count'],
      timeDimensions: [{ dimension: 'owner.created_at', granularity: 'month' }],
    });

    expect(error?.message).toMatch(/cannot bucket a cross-object time dimension \("owner\.created_at"\)/);
    expect(calls).toEqual([]);
  });
});

// ── 5. The protected surface: every rejection that already existed ───────────

describe('[#5739] the source-field gates keep every rejection they already made', () => {
  it('still refuses a bogus BARE dimension with the #5520 envelope', async () => {
    const { error } = await run(
      { cube: 'crm_account', measures: ['count'], dimensions: ['bogus_dim'] },
      { native: true },
    );

    expect(error?.code).toBe('INVALID_FIELD');
    expect(error?.status).toBe(400);
    expect(error?.field).toBe('bogus_dim');
    expect(error?.message).toMatch(/groups by field 'bogus_dim'/);
  });

  it('still refuses a bogus BARE filter member with the #5669 envelope', async () => {
    const { error } = await run(
      { cube: 'crm_account', measures: ['count'], where: { bogus_col: 'x' } },
      { native: true },
    );

    expect(error?.code).toBe('INVALID_FIELD');
    expect(error?.status).toBe(400);
    expect(error?.field).toBe('bogus_col');
    expect(error?.message).toMatch(/constrains field 'bogus_col'/);
  });

  it('[#5918] still refuses a dotted MEASURE — now naming the caller\'s spelling, not the strip', async () => {
    // Rewritten by #5918, which is the one case in this file whose ANSWERING
    // LAYER moved. When #5739 landed, measures kept the blanket strip (their
    // traversal tier is dimension-only, so there was no correct answer to
    // converge on) and this case pinned #4437's verdict on the stripped tail:
    // `field: 'score'`. The residue #5739 filed as #5918 was the sibling
    // spelling whose tail DOES exist — `owner.region_count_distinct` silently
    // aggregating the base `region`. The 2026-08-07 ruling refuses the dotted
    // measure at the mint instead, so both spellings now answer identically and
    // name what the caller wrote.
    //
    // The floor this block is about is unchanged and is what stays asserted: a
    // dotted measure is REFUSED, with `INVALID_FIELD` / 400, and never becomes
    // SQL. Only the diagnostic moved — from `field` (this gate's) to `member`.
    const { error, sqls } = await run(
      { cube: 'crm_account', measures: ['owner.score_sum'] },
      { native: true },
    );

    expect(error?.code).toBe('INVALID_FIELD');
    expect(error?.status).toBe(400);
    expect((error as { member?: string } | undefined)?.member).toBe('owner.score_sum');
    expect(error?.message).toMatch(/Measure 'owner\.score_sum'/);
    // Not the source-field gate's verdict any more — it names a base column in
    // `field`, and `score` is not a column the caller asked about.
    expect(error?.field).toBeUndefined();
    expect(sqls).toEqual([]);
  });

  it('leaves a NESTED relation object reading exactly as it did', async () => {
    // `{owner: {region: 'NA'}}`'s top-level key is the bare `owner`, so the mint
    // is unchanged by the ruling — and the LEAF `owner.region` reaches the
    // strategies through `lookupMember`'s synthetic tier, as it always has.
    const { sqls, dimensions } = await run(
      { cube: 'crm_account', measures: ['count'], where: { owner: { region: 'NA' } } },
      { native: true },
    );

    expect(dimensions).toEqual(['owner']);
    expect(sqls[0]).toContain('WHERE "owner"."region" = ');
  });
});
