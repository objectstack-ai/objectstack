// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5353 — one filter, two spellings, ONE ad-hoc cube.
 *
 * `inferCubeFromQuery` mints a Cube for a free-form query naming no registered
 * cube, seeding `dimensions` from the fields the query mentions — `measures`,
 * `dimensions`, `timeDimensions`, and the `where`. Its `where` arm was guarded by
 * `!Array.isArray(query.where)`, written when an array `where` was not a filter.
 * #5334 made it one, so from then on:
 *
 * ```
 * where: {stage: 'won'}            → dimensions: {stage}   ← seeded
 * where: [['stage','=','won']]     → dimensions: {}        ← skipped
 * ```
 *
 * Same filter, byte-identical compiled predicate since #5334, two different
 * cubes. This file pins the parity, and — the half that keeps the fix from
 * over-reaching — the three things it must NOT change.
 *
 * ## Why this had no user-visible symptom (the issue's own observation class)
 *
 * `NativeSQLStrategy.resolveFieldSql` falls back to the column the member names
 * for a member the cube does not declare, and `qualifyAndRegisterJoin` leaves
 * that column bare in a statement that joins nothing ([#21249]: what the
 * statement joins, not the cube's `joins`, which an ad-hoc cube never has). So
 * both spellings compiled the same SQL before the fix and still do; block 2
 * measures that rather than asserting it. The divergence was confined to the
 * dimension VOCABULARY, which is why this was filed as an observation and fixed
 * in the window before the ad-hoc path grows a join.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Restoring the `!Array.isArray(query.where)` guard turns the parity table RED
 * for every case whose filter lowers to a CONJUNCTION naming at least one field
 * — 11 of the 13 — because the array spelling seeds nothing while the object
 * spelling seeds its keys. Ordinary direction, no inversion: the assertion is on
 * a bag that GAINS entries, and both the parity comparison and the exact
 * expected set are asserted, so a case cannot pass by both sides being empty.
 *
 * The two exceptions are named here rather than left for the next reader:
 * `$or`-rooted filters (`prefix OR group`, `nested group — OR of an AND`) stay
 * GREEN in both directions. Neither spelling contributes a key through a
 * disjunction, before or after — there was no asymmetry there to fix, and
 * `conjunctFieldKeys` deliberately does not descend `$or`. Those two cases pin a
 * deliberate NON-change; reading the table as "13 red" would be wrong.
 *
 * Block 3 was #5353's fence around the one shape it could not decide: a DOTTED
 * `where` key, which answered per spelling — the object spelling minting the
 * stripped tail as a base column (a `400 INVALID_FIELD` naming `region`, or a
 * silent wrong-column filter where the base had one), the array spelling minting
 * nothing and compiling the traversal.
 *
 * [#5739] The maintainer ruled on 2026-08-06: mint the traversal VERBATIM. Block
 * 3 is therefore no longer a fence but the parity's dotted half — both spellings
 * mint `owner.region` and compile the same `LEFT JOIN`. It is still green under
 * the `!Array.isArray` reverse verification above (that guard is not what decided
 * the dotted answer); what turns it red is restoring the blanket `stripPrefix` in
 * `inferCubeFromQuery`, which is #5739's own reverse direction and is measured in
 * `infer-cube-relation-traversal.test.ts`.
 *
 * The case that still holds the line against a `collectFilterLeaves` refactor is
 * `a nested relation object seeds its RELATION key, not the tail`: flattening
 * `{owner: {region: 'NA'}}` to the leaf `owner.region` would change which key
 * this bag mints, and that must fail loudly rather than drift.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsStrategy } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

/** The columns `deal` really has — the source-field gates (#4437/#5520/#5669) read these. */
const DEAL_FIELDS = ['id', 'stage', 'owner', 'amount', 'closed_at'];

/**
 * [#20381] The cube a request's strategies read for its name. An inferred cube
 * lives only in the request that minted it — it is never registered, so
 * `getMeta` never lists it — and this is the window onto it that remains: a
 * probe ahead of every built-in strategy records `ctx.getCube(query.cube)` and
 * declines, so the chain runs exactly as it would without it.
 */
function requestCubeProbe() {
  const seen: Cube[] = [];
  const strategy: AnalyticsStrategy = {
    name: 'RequestCubeProbe',
    priority: 0,
    canHandle: (query, ctx) => {
      const cube = ctx.getCube(query.cube!);
      if (cube) seen.push(cube);
      return false;
    },
    execute: async () => { throw new Error('RequestCubeProbe never handles a query'); },
    generateSql: async () => { throw new Error('RequestCubeProbe never handles a query'); },
  };
  return { strategy, seen };
}

/**
 * A service with NO registered cube for `deal`, so every query takes the
 * auto-inference path — every query, since nothing a request infers is
 * registered (#20381). `cubes` holds what each request's strategies read.
 */
function makeService(opts: { native?: boolean; fields?: string[] } = {}) {
  const sqls: string[] = [];
  const filters: unknown[] = [];
  const probe = requestCubeProbe();
  const service = new AnalyticsService({
    logger: silentLogger,
    strategies: [probe.strategy],
    queryCapabilities: () => ({
      nativeSql: !!opts.native,
      objectqlAggregate: !opts.native,
      inMemory: false,
    }),
    executeAggregate: async (_object: string, options: unknown) => {
      filters.push((options as { filter?: unknown } | undefined)?.filter);
      return [{ count: 1 }];
    },
    executeRawSql: async (_object: string, sql: string) => {
      sqls.push(sql);
      return [{ count: 1 }];
    },
    isRegisteredObject: (n: string) => n === 'deal',
    getObjectFieldNames: (n: string) => (n === 'deal' ? (opts.fields ?? DEAL_FIELDS) : undefined),
  });
  return { service, sqls, filters, cubes: probe.seen };
}

/** The ad-hoc cube's dimension keys, read from the cube the request's strategies were handed. */
async function inferredDimensions(where: unknown, opts?: { native?: boolean; fields?: string[] }) {
  const { service, sqls, filters, cubes } = makeService(opts);
  await service.query({ cube: 'deal', measures: ['count'], where } as never);
  expect(cubes).toHaveLength(1);
  return {
    // The KEY is what seeding produced.
    dimensions: Object.keys(cubes[0].dimensions).sort(),
    sqls,
    filters,
  };
}

/** The error a call rejected with — or a loud failure if it RESOLVED. */
async function rejection<T extends Error = Error & { code?: string }>(
  call: Promise<unknown>,
): Promise<T> {
  try {
    await call;
  } catch (e) {
    return e as T;
  }
  throw new Error('expected the query to be refused, but it resolved');
}

/**
 * The equivalence table, taken from #5334's own `EQUIVALENT_SPELLINGS` so the
 * two files cannot disagree about what "the same filter, two spellings" means.
 * #5334 asserts the two select the same ROWS; this asserts they mint the same
 * CUBE.
 *
 * `seeded` is the exact dimension vocabulary the filter must contribute — an
 * explicit value, not just "both sides equal", because a table that only
 * compared the spellings would pass just as happily with both empty, which is
 * the defect itself.
 */
const EQUIVALENT_SPELLINGS: Array<{
  name: string;
  object: FilterCondition;
  array: unknown[];
  seeded: string[];
}> = [
  {
    name: "equality — the issue's own filter, in its lowerable spelling",
    object: { stage: 'won' },
    array: [['stage', '=', 'won']],
    seeded: ['stage'],
  },
  {
    name: 'a bare comparison node, not wrapped in a list',
    object: { stage: 'won' },
    array: ['stage', '=', 'won'],
    seeded: ['stage'],
  },
  {
    name: 'inequality',
    object: { stage: { $ne: 'won' } },
    array: ['stage', '!=', 'won'],
    seeded: ['stage'],
  },
  {
    name: 'ordered comparison',
    object: { amount: { $gt: 15 } },
    array: ['amount', '>', 15],
    seeded: ['amount'],
  },
  {
    // The lowering's own `$and`: `conjunctFieldKeys` descends it, so an explicit
    // AND group seeds what its conjuncts name. Before #5353 BOTH spellings
    // seeded nothing here — parity held at the wrong value, which is why the
    // expected set is asserted and not merely the equality.
    name: 'prefix AND group',
    object: { $and: [{ stage: 'won' }, { owner: 'u1' }] },
    array: ['and', ['stage', '=', 'won'], ['owner', '=', 'u1']],
    seeded: ['owner', 'stage'],
  },
  {
    // GREEN before and after — see the reverse-verification note. A disjunction
    // contributes no dimension on either spelling.
    name: 'prefix OR group — the disjunction a flat array could never carry',
    object: { $or: [{ stage: 'won' }, { stage: 'lost' }] },
    array: ['or', ['stage', '=', 'won'], ['stage', '=', 'lost']],
    seeded: [],
  },
  {
    // The shape that makes descending `$and` NECESSARY rather than tidy: the
    // flat array is the array spelling of `{stage: …, owner: …}`, and
    // `parseFilterAST` lowers it to `{$and: […]}`. Read only the lowered
    // object's own top-level keys and the answer would be `$and` alone — i.e.
    // nothing — and the two spellings would still mint two cubes.
    name: 'legacy flat list — implicit AND',
    object: { $and: [{ stage: 'won' }, { owner: 'u2' }] },
    array: [['stage', '=', 'won'], ['owner', '=', 'u2']],
    seeded: ['owner', 'stage'],
  },
  {
    name: 'set membership',
    object: { stage: { $in: ['won', 'lost'] } },
    array: ['stage', 'in', ['won', 'lost']],
    seeded: ['stage'],
  },
  {
    name: 'null predicate — two-element node, direction from the operator name',
    object: { closed_at: { $null: true } },
    array: ['closed_at', 'is_null'],
    seeded: ['closed_at'],
  },
  {
    name: 'not-null predicate',
    object: { closed_at: { $null: false } },
    array: ['closed_at', 'is_not_null'],
    seeded: ['closed_at'],
  },
  {
    // The lowered predicate is the boolean constant FALSE and names no member in
    // the TREE (`collectFilterLeaves` returns nothing for a `const` node) — but
    // the filter still names the field `stage`, and the cube's vocabulary is
    // about what the author wrote, not what the predicate binds. A second reason
    // the two readers want different views of one filter.
    name: 'empty set membership — the boolean constant FALSE, not "no filter"',
    object: { stage: { $in: [] } },
    array: ['stage', 'in', []],
    seeded: ['stage'],
  },
  {
    name: 'range — `between` lowers to its two bounds on both spellings',
    object: { amount: { $between: [15, 35] } },
    array: ['amount', 'between', [15, 35]],
    seeded: ['amount'],
  },
  {
    // GREEN before and after, for the `prefix OR group` reason.
    name: 'nested group — OR of an AND',
    object: { $or: [{ $and: [{ stage: 'won' }, { owner: 'u1' }] }, { stage: 'lost' }] },
    array: ['or', ['and', ['stage', '=', 'won'], ['owner', '=', 'u1']], ['stage', '=', 'lost']],
    seeded: [],
  },
];

// ── 1. The parity the issue asked for ────────────────────────────────────────

describe('[#5353] inferCubeFromQuery — the `where` spelling does not change the cube', () => {
  for (const c of EQUIVALENT_SPELLINGS) {
    it(`mints one dimension vocabulary for both spellings: ${c.name}`, async () => {
      const objectSpelling = await inferredDimensions(c.object);
      const arraySpelling = await inferredDimensions(c.array);

      // `count` is the measure every inferred cube carries; dimensions are the
      // filter's contribution alone (the query names no `dimensions`).
      expect(objectSpelling.dimensions).toEqual(c.seeded);
      expect(arraySpelling.dimensions).toEqual(c.seeded);
      // Stated as its own assertion so a failure reads as the DEFECT ("the two
      // spellings disagree") and not merely as a wrong expected value.
      expect(arraySpelling.dimensions).toEqual(objectSpelling.dimensions);
    });
  }

  it('seeds the `where` keys ALONGSIDE the ones `dimensions` and `measures` contribute', async () => {
    const { service, cubes } = makeService();
    await service.query({
      cube: 'deal',
      measures: ['amount_sum'],
      dimensions: ['stage'],
      where: [['owner', '=', 'u1']],
    } as never);
    const [cube] = cubes;

    expect(Object.keys(cube.dimensions).sort()).toEqual(['owner', 'stage']);
    // The measure arm is untouched by #5353 — `amount_sum` still infers a SUM
    // over `amount` rather than becoming a dimension.
    expect(Object.keys(cube.measures).sort()).toEqual(['amount_sum', 'count']);
  });
});

// ── 2. What the fix must NOT change ──────────────────────────────────────────

describe('[#5353] the seeded dimensions change no verdict and no statement', () => {
  it('compiles the identical SQL for both spellings — measured, not assumed', async () => {
    const objectSpelling = await inferredDimensions({ stage: 'won' }, { native: true });
    const arraySpelling = await inferredDimensions([['stage', '=', 'won']], { native: true });

    expect(arraySpelling.sqls).toEqual(objectSpelling.sqls);
    // A bare column stays bare: `qualifyAndRegisterJoin` only qualifies when the
    // statement joins something ([#21249]), and this one joins nothing. This is
    // the whole reason #5353 was an observation rather than a defect — and the
    // assertion that keeps a newly-DECLARED dimension from starting to qualify.
    expect(objectSpelling.sqls[0]).toContain('WHERE stage = ');
    expect(objectSpelling.sqls[0]).not.toContain('"deal"."stage"');
  });

  it('hands the engine the identical filter for both spellings', async () => {
    const objectSpelling = await inferredDimensions({ stage: 'won' });
    const arraySpelling = await inferredDimensions([['stage', '=', 'won']]);

    expect(arraySpelling.filters).toEqual(objectSpelling.filters);
    expect(objectSpelling.filters).toEqual([{ stage: 'won' }]);
  });

  it('still rejects a bogus filter field on BOTH spellings, with the same envelope', async () => {
    const objectErr = await rejection(
      makeService().service.query({ cube: 'deal', measures: ['count'], where: { bogus_col: 'x' } } as never),
    );
    const arrayErr = await rejection(
      makeService().service.query({
        cube: 'deal',
        measures: ['count'],
        where: [['bogus_col', '=', 'x']],
      } as never),
    );

    for (const err of [objectErr, arrayErr]) {
      expect((err as { code?: string }).code).toBe('INVALID_FIELD');
      expect((err as { status?: number }).status).toBe(400);
      expect((err as { field?: string }).field).toBe('bogus_col');
      expect((err as { param?: string }).param).toBe('where');
    }
    // #5669's gate reads filter LEAVES, not `cube.dimensions`, so seeding the
    // array spelling's keys could not change its verdict — and did not. What it
    // DID change is the suggestion list, in the direction that closes the split:
    // one filter now gets one message whichever way it is spelled.
    expect(arrayErr.message).toBe(objectErr.message);
  });

  it('stands down when the `where` array cannot be lowered — the refusal stays in the strategy', async () => {
    // `[{stage:'won'}]` is #5334's own unlowerable repro: a list of CONDITION
    // OBJECTS. `inferCubeFromQuery` must not raise from `ensureCube`, or the
    // answer's geography moves and the draft-preview path (whose `matchesWhere`
    // never consults the normalizer) would newly refuse.
    const err = await rejection(
      makeService({ native: true }).service.query({
        cube: 'deal',
        measures: ['count'],
        where: [{ stage: 'won' }],
      } as never),
    );

    expect((err as { code?: string }).code).toBe('INVALID_FILTER');
    expect(err.message).toMatch(/is not a filter/);
  });

  it('treats `[]` as no filter, seeding nothing and refusing nothing', async () => {
    const { dimensions, sqls } = await inferredDimensions([], { native: true });
    expect(dimensions).toEqual([]);
    expect(sqls[0]).not.toContain('WHERE');
  });
});

// ── 3. Dotted keys, unified by #5739 ─────────────────────────────────────────

/**
 * #5353 left a dotted `where` key answering per SPELLING, because unifying it
 * meant choosing a direction that belonged to #5739. The maintainer ruled on
 * 2026-08-06: mint the traversal VERBATIM, so the object spelling converges on
 * the JOIN the array spelling already compiled. These cases were the residue's
 * fence; they are now the parity's dotted half, and they carry the ruling's
 * weight — both spellings must produce the SAME statement, and it must be the
 * traversal.
 *
 * The traversal's own coverage (all four strategy × request-key combinations,
 * the base-column-shadowing case that made the defect silent, and the
 * `<cube>.`-qualifier cases that must NOT move) lives in
 * `infer-cube-relation-traversal.test.ts`. What stays here is what this file is
 * about: one filter, two spellings, one answer.
 */
describe('[#5353/#5739] a dotted `where` key is unified too — as a traversal', () => {
  /** No base `region` column — the shape a relation filter is normally written against. */
  const NO_REGION = { fields: ['id', 'stage', 'owner', 'amount', 'closed_at'], native: true };

  it('mints the traversal verbatim and compiles the JOIN — both spellings, one statement', async () => {
    // The flip. Before the ruling the OBJECT spelling minted the stripped tail as
    // a base-table dimension, `declaredMemberEntry`'s dotted tail lookup found it,
    // and #5669's gate refused `owner.region` by naming a base column `deal` does
    // not have (`constrains field 'region'`) — while the ARRAY spelling of the
    // same filter minted nothing and compiled the traversal. One filter, two
    // spellings, a 400 and a JOIN.
    const object = await inferredDimensions({ 'owner.region': 'NA' }, NO_REGION);
    const array = await inferredDimensions([['owner.region', '=', 'NA']], NO_REGION);

    // Load-bearing in both halves: the same cube AND the same statement, pinned
    // to the JOIN so the pair cannot agree by both producing nothing.
    expect(object.dimensions).toEqual(['owner.region']);
    expect(array.dimensions).toEqual(object.dimensions);
    expect(array.sqls).toEqual(object.sqls);
    expect(object.sqls[0]).toContain('LEFT JOIN "owner" ON "deal"."owner" = "owner"."id"');
    expect(object.sqls[0]).toContain('WHERE "owner"."region" = ');
    // The mis-cast's own spellings, named so a regression cannot hide behind the
    // parity: neither the stripped dimension nor the base-column predicate.
    expect(object.dimensions).not.toContain('region');
    expect(object.sqls[0]).not.toContain('WHERE region = ');
  });

  it('runs the query the object spelling used to be refused for', async () => {
    // The other half of the flip, stated as a verdict rather than a statement:
    // `deal` has no `region` column, so before the ruling this exact query was a
    // `400 INVALID_FIELD` naming a field the caller never wrote. The traversal
    // does not need one.
    const { service, sqls } = makeService(NO_REGION);

    await expect(
      service.query({ cube: 'deal', measures: ['count'], where: { 'owner.region': 'NA' } } as never),
    ).resolves.toBeTruthy();
    expect(sqls[0]).toContain('WHERE "owner"."region" = ');
  });

  it('a nested relation object seeds its RELATION key, not the tail', async () => {
    // `{owner: {region: 'NA'}}`'s top-level key is the bare `owner`, so it seeds
    // `owner` — unchanged. The LEAF member is `owner.region`, which is why a
    // `collectFilterLeaves`-based seeder would have produced `region` here and
    // walked into the mis-cast above from a third direction.
    // [#20887] The seeding is unchanged; what the query then runs is not. The
    // nested form is the ENGINE's now (the related object read as the caller,
    // capped), so it is asked of the engine path — handed over as written —
    // where this case used to read the JOIN the native strategy compiled for
    // the flattened `owner.region`.
    const { dimensions, filters } = await inferredDimensions(
      { owner: { region: 'NA' } },
      { fields: NO_REGION.fields },
    );
    expect(dimensions).toEqual(['owner']);
    expect(JSON.stringify(filters[0])).toContain('{"owner":{"region":"NA"}}');
  });

  it('bare and dotted keys reach parity together when both ride along', async () => {
    // Before the ruling only `stage` was unified and the whole query was refused
    // for `region`; now both keys are minted, on both spellings, and the query
    // runs. [#21249] The traversal makes the statement join `owner`, so the base
    // column is qualified against the base table on both spellings alike —
    // `qualifyAndRegisterJoin` reads what the statement joins, not whether the
    // cube declares `joins` (block 2's bare column is the statement that joins
    // nothing).
    const both = [['stage', '=', 'won'], ['owner.region', '=', 'NA']];
    const array = await inferredDimensions(both, NO_REGION);
    const object = await inferredDimensions(
      { $and: [{ stage: 'won' }, { 'owner.region': 'NA' }] },
      NO_REGION,
    );

    expect(array.dimensions).toEqual(['owner.region', 'stage']);
    expect(object.dimensions).toEqual(array.dimensions);
    expect(object.sqls).toEqual(array.sqls);
    expect(array.sqls[0]).toContain('WHERE ("deal"."stage" = $1 AND "owner"."region" = $2)');
  });
});
