// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10759] `ObjectQLStrategy`'s two doors judge one query by ONE member view.
 *
 * ## What was wrong, measured on `origin/main` before the change
 *
 * `planCrossObject` reads `Object.keys(filter)` and nothing else, and the two
 * call sites handed it different things. `generateSql()` handed it every member
 * the `where` touches, flattened out of the tree. `execute()` handed it the
 * built ENGINE FILTER — where an AND-ed leaf sits at the top level and is seen,
 * but anything structural (`$or`, `$not`, a nested `$and` that cannot merge) has
 * been folded into `filter.$and`, so the only key readable for it was the
 * literal `$and`, which is never a field name.
 *
 * So one query got two answers. Measured, both doors fired in one run over one
 * fixture (`where: { $or: [{ 'account.region': 'West' }, { stage: 'won' }] }`):
 *
 * ```
 * BEFORE   execute()    ACCEPTED  -> engine.aggregate got
 *                                    {"$and":[{"$or":[{"account.region":"West"},…]}]}
 *          generateSql() REFUSED   cannot evaluate a cross-object filter ("account.region")
 * AFTER    execute()     REFUSED   (same message, same INVALID_FIELD / 400)
 *          generateSql() REFUSED   unchanged
 * ```
 *
 * `engine.aggregate` cannot join. The accepted half did not answer a
 * cross-object query — it answered a NARROWER one, silently, because the branch
 * naming a column the base object does not have can never match. That is the
 * silent mis-bucket #3654's loud refusal exists to prevent, and the file already
 * stated the invariant it was breaking: *"`generateSql()` calls this too, so the
 * preview accepts/rejects the same set."*
 *
 * ## [#10861] The second producer, and why this file now covers both
 *
 * The caller's `where` is not the only thing that puts a predicate in front of
 * `engine.aggregate` here. PR #10758 gave the compiled dataset's OWN
 * definition-level `filter` a route onto this door, and that route was outside
 * both member views too — so a dataset declaring
 * `filter: { 'account.region': 'West' }` was accepted by BOTH doors and the
 * engine received a predicate it cannot join. #10759 was not that card: the two
 * doors AGREED there, so there was no divergence to restore, and refusing it
 * was a new decision about the refusal set. It was taken (maintainer,
 * 2026-08-22: Option A, refuse at query time) and #10861 folds the scope's
 * leaves into the same one member view. Both producers are now judged by one
 * check, which is why they are pinned in one file.
 *
 * ## [#11461] The third producer, and the door it left open on BOTH doors
 *
 * #10413 phase 2 added a THIRD route to `engine.aggregate`'s predicate: a
 * compiled MEASURE's own `filter`, lowered onto that measure's
 * `aggregations[].filter` entry (#10576). `filterMemberView` enumerated exactly
 * two origins, and `planCrossObject`'s `query.measures` arm reads only each
 * measure's resolved FIELD — so this producer was outside every check.
 *
 * The card was CODE-READ, not executed, so it was reproduced before it was
 * fixed, over one fixture with an honest in-memory engine (one that applies
 * `aggregations[].filter` as a property match on the base row, which is all
 * `engine.aggregate` can do — it cannot join):
 *
 * ```
 * BEFORE   execute()     ACCEPTED  -> engine.aggregate reached once with
 *                                     {field:"*",method:"count",alias:"west_count",
 *                                      filter:{"account.region":"West"}}
 *                                  -> rows [{stage:"won",total_count:3,west_count:0},
 *                                           {stage:"lost",total_count:1,west_count:0}]
 *                                     THE SILENT 0 — the truthful west_count for
 *                                     stage "won" is 2, and total_count 3 is
 *                                     RIGHT, so the wrong number came back inside
 *                                     the same response shape as the right one
 *          generateSql() ACCEPTED  -> SELECT stage AS "stage", COUNT(*) AS
 *                                     "total_count", COUNT(CASE WHEN
 *                                     account.region = $1 THEN 1 END) AS
 *                                     "west_count" FROM "opportunity" GROUP BY
 *                                     stage        — a conditional aggregate over
 *                                     a column no FROM in that statement joins
 * AFTER    both doors    REFUSED   INVALID_FIELD / 400, member "account.region",
 *                                  cube "…", engine never reached (0 calls)
 * ```
 *
 * There is a published promise behind this beyond the internal inconsistency.
 * `content/docs/api/data-api.mdx` documents a Request|Result table in which
 * `aggregations: [{function:"sum", field:"no_such_field", …}]` answers
 * `400 INVALID_FIELD`. The same `aggregations` object kept that promise in the
 * `field` position and broke it in the `filter` position — `200` with a silent
 * 0 — which is precisely the failure class that page's preamble names as its
 * reason for existing ("answer `200` with something that looked exactly like a
 * served query"). This block is what makes the page true again.
 *
 * ## Why this file pins EIGHT directions, not one
 *
 * Pinning only the new refusals would go green on an implementation that
 * refuses every combinator, or every dataset scope — which would break every
 * legitimate `$or` query and every scoped dataset shipping today. So the
 * accepting neighbours are pinned in the same file, one character away from the
 * refused ones:
 *
 *   ① a cross-object member nested in `$or` / `$not` is REFUSED on both doors
 *   ② a combinator with NO cross-object member still passes both doors, and
 *      still reaches `engine.aggregate` carrying its disjunction
 *   ③ the `generateSql()` door is UNCHANGED — it was already right, and the
 *      top-level case it always refused is refused with the same words
 *   ④ the #10413-phase-1 dataset-level `filter` conjunct (PR #10758) is not
 *      misread as a cross-object reference — an ordinary definition-level scope
 *      travels in `$and` exactly like a combinator does, and reads as a member
 *      of nothing
 *   ⑤ a CROSS-OBJECT dataset-level `filter` is REFUSED on both doors, in the
 *      ADR-0112 envelope, before `engine.aggregate` is reached (#10861)
 *   ⑥ an ORDINARY dataset-level `filter` still reaches the engine CARRYING its
 *      predicate — the load-bearing half of ⑤, and the pin a
 *      "refuse every dataset scope" implementation fails
 *   ⑦ a CROSS-OBJECT per-measure `filter` is REFUSED on both doors, naming the
 *      measure whose declaration holds the leaf (#11461)
 *   ⑧ an ORDINARY per-measure `filter` still reaches the engine CARRYING its
 *      own `aggregations[].filter`, and a cross-object one on a measure the
 *      query does NOT ask for changes nothing — the two load-bearing halves of
 *      ⑦, and the pins a "refuse every measure filter" and a "refuse on the
 *      dataset's whole `measureFilters` map" implementation each fail
 *
 * ①–④ are #10759's, re-run unchanged; ⑤–⑥ are #10861's; ⑦–⑧ are #11461's.
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

const ctxA = { tenantId: 'org_A', userId: 'u_a' } as ExecutionContext;

interface Refusal extends Error { code?: string; status?: number; member?: string; param?: string; cube?: string }
interface AggSpec { field: string; method: string; alias: string; filter?: Record<string, unknown> }
/**
 * [#11461] `aggregations` is captured too, not just the whole-call `filter`.
 * The third producer never lands in the whole-call filter — it lands on ONE
 * aggregation's own `filter` — so a harness that only watched `options.filter`
 * could not have seen this card's defect at all, and ⑧'s "still carries its
 * predicate" half would have had nothing to read.
 */
interface AggCall { object: string; filter?: unknown; aggregations?: AggSpec[] }

/** A cube with one base dimension, one cross-object dimension, one base measure. */
const SALES_BY_ACCOUNT: Dataset = DatasetSchema.parse({
  name: 'sales_by_account',
  label: 'Sales by account',
  object: 'opportunity',
  include: ['account'],
  dimensions: [
    { name: 'stage', field: 'stage', type: 'string' },
    { name: 'region', field: 'account.region', type: 'string' },
  ],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
}) as Dataset;

/**
 * The #10413 phase-1 shape: the SAME cube plus a definition-level `filter`.
 * PR #10758 pushes that filter onto `execute()`'s `conjuncts` list, so it lands
 * inside `filter.$and` — the very place a combinator lands. Its presence must
 * not by itself make a query look cross-object.
 */
const SCOPED_SALES: Dataset = DatasetSchema.parse({
  name: 'scoped_sales',
  label: 'Scoped sales',
  object: 'opportunity',
  include: ['account'],
  filter: { is_deleted: false },
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
}) as Dataset;

/** A dataset whose definition-level filter is ITSELF cross-object. */
const XOBJ_SCOPED_SALES: Dataset = DatasetSchema.parse({
  name: 'xobj_scoped_sales',
  label: 'Cross-object scoped sales',
  object: 'opportunity',
  include: ['account'],
  filter: { 'account.region': 'West' },
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
}) as Dataset;

/**
 * [#10861] A dataset scope with a base leaf AND a cross-object leaf. Serving is
 * not a property of a scope containing a base leaf — the cross-object one
 * decides, wherever it sits.
 */
const MIXED_SCOPED_SALES: Dataset = DatasetSchema.parse({
  name: 'mixed_scoped_sales',
  label: 'Mixed scoped sales',
  object: 'opportunity',
  include: ['account'],
  filter: { is_deleted: false, 'account.region': 'West' },
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
}) as Dataset;

/**
 * [#11461] ONE dataset carrying all three of ⑦/⑧'s directions, so the
 * distinctions are structural rather than three fixtures that happen to differ.
 *
 *   `revenue`       no filter at all — the neighbour every other measure is
 *                   read against
 *   `won_revenue`   an ORDINARY per-measure filter — must still be SERVED, and
 *                   must still reach the engine carrying its own predicate
 *   `west_revenue`  a CROSS-OBJECT per-measure filter — must be REFUSED
 *
 * `won_revenue` and `west_revenue` are one character apart in shape and travel
 * the identical `measureFilters` → `aggregations[].filter` route, which is what
 * makes ⑧ a pin on this refusal rather than a restatement of it. And because
 * `west_revenue` is declared on the SAME dataset as `won_revenue`, a query that
 * asks only for `won_revenue` is the pin that the check reads
 * `query.measures`, not the dataset's whole `measureFilters` map.
 */
const MEASURE_FILTER_SALES: Dataset = DatasetSchema.parse({
  name: 'measure_filter_sales',
  label: 'Measure-filtered sales',
  object: 'opportunity',
  include: ['account'],
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [
    { name: 'revenue', aggregate: 'sum', field: 'amount' },
    { name: 'won_revenue', aggregate: 'sum', field: 'amount', filter: { stage: 'won' } },
    { name: 'west_revenue', aggregate: 'sum', field: 'amount', filter: { 'account.region': 'West' } },
  ],
}) as Dataset;

/**
 * `nativeSql: false` makes `NativeSQLStrategy` decline, so every query below
 * routes to `ObjectQLStrategy` — the door this card is about.
 *
 * The stub RETURNS ROWS rather than throwing, so a refusal that failed to fire
 * produces a passing-looking success with garbage in it: a green rejection test
 * here proves the guard, not luck.
 */
function serviceFor(defs: Dataset[]) {
  const calls: AggCall[] = [];
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (object: string, options: { filter?: unknown; aggregations?: AggSpec[] }) => {
      calls.push({ object, filter: options.filter, aggregations: options.aggregations });
      return [{ stage: 'won', revenue: 42 }];
    },
  });
  for (const d of defs) svc.registerDataset(d);
  return { svc, calls };
}

async function refusalFrom(thunk: () => Promise<unknown>): Promise<Refusal | undefined> {
  try {
    await thunk();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

/** Both doors, one query, one tree — the disagreement is a measurement. */
async function bothDoors(cube: string, query: Omit<AnalyticsQuery, 'cube'>, defs: Dataset[]) {
  const { svc, calls } = serviceFor(defs);
  const q = { ...query, cube } as AnalyticsQuery;
  return {
    execute: await refusalFrom(() => svc.query(q, ctxA)),
    generateSql: await refusalFrom(() => svc.generateSql(q, ctxA)),
    calls,
  };
}

const CROSS_OBJECT_MESSAGE = /cannot evaluate a cross-object filter \("account\.region"\)/;
/**
 * [#10861] A DISTINCT message, deliberately: the four refusals that predate
 * this card keep their wording (#5923's tests read it), and this one has to say
 * a different thing — the member is in a saved document, not in the request.
 * Matching on the substring that carries that distinction, so a rewording that
 * dropped the provenance would go red.
 */
const DATASET_SCOPE_MESSAGE =
  /cannot evaluate the cross-object filter \("account\.region"\) that dataset "[^"]+" declares at its definition level/;

/**
 * [#11461] A THIRD distinct message. The two above name where the member came
 * from; this one has to name something neither can — WHICH MEASURE's own
 * declaration holds the leaf. A dataset can declare two measures filtering the
 * same field and mean two different edits, so a rewording that dropped the
 * measure name would leave the refusal pointing at a document without saying
 * where in it to look. Matched on exactly that substring.
 */
const MEASURE_FILTER_MESSAGE =
  /cannot evaluate the cross-object filter \("account\.region"\) that dataset "[^"]+" declares on its measure "west_revenue"/;

// ─────────────────────────────────────────────────────────────────────────────
// ① the refusal that was missing on the execution door
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each entry nests the SAME cross-object member one level down, in a different
 * combinator, so the pin is on "structure hides the member" rather than on the
 * `$or` spelling alone.
 */
const NESTED: Array<{ name: string; where: Record<string, unknown> }> = [
  { name: '$or', where: { $or: [{ 'account.region': 'West' }, { stage: 'won' }] } },
  { name: '$not', where: { $not: { 'account.region': 'West' } } },
  { name: '$or nested two deep', where: { $or: [{ $and: [{ 'account.region': 'West' }, { stage: 'won' }] }, { stage: 'lost' }] } },
];

describe('[#10759] a cross-object member nested in a combinator is refused on BOTH doors', () => {
  for (const c of NESTED) {
    it(`${c.name}: execute() refuses with the ADR-0112 envelope`, async () => {
      const { execute, calls } = await bothDoors('sales_by_account', {
        dimensions: ['stage'], measures: ['revenue'], where: c.where,
      }, [SALES_BY_ACCOUNT]);

      expect(execute, 'accepted — the member was invisible to the envelope check').toBeInstanceOf(Error);
      expect(String(execute?.message)).toMatch(CROSS_OBJECT_MESSAGE);
      // Read exactly as `rest-server.ts`'s catch reads them: a 4xx status AND a
      // code, or the route falls through to 500 ANALYTICS_QUERY_FAILED. Asserting
      // only that it throws would pass on a bare `Error` and report the platform
      // broken for a caller mistake.
      expect(execute?.code, 'no `code` ⇒ 500 ANALYTICS_QUERY_FAILED').toBe('INVALID_FIELD');
      expect(execute?.status, 'no `status` ⇒ 500 ANALYTICS_QUERY_FAILED').toBe(400);
      // The member is named as the REQUEST spelled it, and `where` is the key to
      // go fix — the refusal is actionable without reading this file.
      expect(execute?.member).toBe('account.region');
      expect(execute?.param).toBe('where');
      // Refused BEFORE the engine was asked, not after it mis-bucketed.
      expect(calls, 'engine.aggregate was reached — it cannot join').toEqual([]);
    });

    it(`${c.name}: both doors agree`, async () => {
      const { execute, generateSql } = await bothDoors('sales_by_account', {
        dimensions: ['stage'], measures: ['revenue'], where: c.where,
      }, [SALES_BY_ACCOUNT]);
      // The invariant `planCrossObject` states for itself, asserted as one fact
      // about one query rather than as two independent expectations.
      expect(
        [execute === undefined, generateSql === undefined],
        'the preview and the execution door accept/reject the same set',
      ).toEqual([false, false]);
      expect(String(generateSql?.message)).toMatch(CROSS_OBJECT_MESSAGE);
    });
  }

  it('the KNOWN-PRESENT control: the same member at the top level was always refused', async () => {
    // The counter-check for every "refused" above. This shape predates #10759 and
    // is refused on both doors before AND after it — so it proves the fixture,
    // the cube and the detection path work, and cannot be read as evidence for
    // the change. The nested rows above are what moved.
    const { execute, generateSql } = await bothDoors('sales_by_account', {
      dimensions: ['stage'], measures: ['revenue'], where: { 'account.region': 'West' },
    }, [SALES_BY_ACCOUNT]);
    expect(String(execute?.message)).toMatch(CROSS_OBJECT_MESSAGE);
    expect(String(generateSql?.message)).toMatch(CROSS_OBJECT_MESSAGE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② the accepting neighbours — no combinator was refused wholesale
// ─────────────────────────────────────────────────────────────────────────────

describe('[#10759] a combinator with NO cross-object member still passes', () => {
  const CLEAN: Array<{ name: string; where: Record<string, unknown> }> = [
    { name: '$or over base fields', where: { $or: [{ stage: 'won' }, { stage: 'lost' }] } },
    { name: '$not over a base field', where: { $not: { stage: 'won' } } },
    { name: 'a mixed tree over base fields', where: { $or: [{ $and: [{ stage: 'won' }, { amount: 5 }] }, { stage: 'lost' }] } },
  ];

  for (const c of CLEAN) {
    it(`${c.name}: accepted on both doors`, async () => {
      const { execute, generateSql, calls } = await bothDoors('sales_by_account', {
        dimensions: ['stage'], measures: ['revenue'], where: c.where,
      }, [SALES_BY_ACCOUNT]);
      expect(execute, `execute() refused a clean combinator: ${execute?.message}`).toBeUndefined();
      expect(generateSql, `generateSql() refused a clean combinator: ${generateSql?.message}`).toBeUndefined();
      // Reached the engine, and reached it carrying the disjunction — a refusal
      // is not the only way to break these queries; dropping the predicate would
      // widen the answer just as silently.
      expect(calls).toHaveLength(1);
      expect(JSON.stringify(calls[0].filter)).toContain('$');
    });
  }

  it('an in-envelope cross-object DIMENSION still compiles — only FILTERS were widened', async () => {
    // `region` resolves to `account.region` and is served by FK-expand. If the
    // new view had been read as "any cross-object member anywhere", this would
    // have started failing too.
    const { generateSql } = await bothDoors('sales_by_account', {
      dimensions: ['region'], measures: ['revenue'],
    }, [SALES_BY_ACCOUNT]);
    expect(generateSql).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ + ④ the #10758 dataset-scope conjunct
// ─────────────────────────────────────────────────────────────────────────────

describe('[#10759] the #10413-phase-1 dataset filter conjunct is not misread', () => {
  it('an ordinary definition-level filter is accepted and still reaches the engine', async () => {
    const { execute, generateSql, calls } = await bothDoors('scoped_sales', {
      dimensions: ['stage'], measures: ['revenue'],
    }, [SCOPED_SALES]);
    expect(execute, `execute() refused a scoped dataset: ${execute?.message}`).toBeUndefined();
    expect(generateSql).toBeUndefined();
    // PR #10758's own guarantee, re-pinned from this side: the scope travels as
    // an `$and` conjunct, which is exactly the position a combinator occupies —
    // so this is the pin that a "refuse anything under `$and`" implementation
    // would fail.
    expect(JSON.stringify(calls[0]?.filter)).toContain('is_deleted');
  });

  it('a dataset scope does not shield a cross-object member in the caller’s own $or', async () => {
    const { execute, generateSql, calls } = await bothDoors('scoped_sales', {
      dimensions: ['stage'], measures: ['revenue'],
      where: { $or: [{ 'account.region': 'West' }, { stage: 'won' }] },
    }, [SCOPED_SALES]);
    expect(String(execute?.message)).toMatch(CROSS_OBJECT_MESSAGE);
    expect(String(generateSql?.message)).toMatch(CROSS_OBJECT_MESSAGE);
    expect(calls).toEqual([]);
  });

});

// ────────────────────────────────────────────────────────────────────────────
// ⑤ [#10861] the CROSS-OBJECT dataset scope — the second producer
// ────────────────────────────────────────────────────────────────────────────

/**
 * THE REFUSAL IS INTENDED. This block replaces the as-is pin #10759 left here.
 *
 * What that pin recorded, and what it was for: a dataset whose DEFINITION-LEVEL
 * `filter` is itself cross-object was accepted by BOTH doors, and
 * `engine.aggregate` received `{"$and":[{"account.region":"West"}]}` — a
 * predicate it cannot join, so it matches nothing on any driver that evaluates
 * it honestly and the widget answers neither the scoped number nor the unscoped
 * one. #10759 was not that card: the two doors AGREED in accepting it, so there
 * was no preview/execution divergence to restore. It was written to the
 * behaviour as it WAS, so that the day the decision landed it would go red and
 * point at its own explanation. It did exactly that; this is the rewrite it
 * asked for.
 *
 * The decision (maintainer, 2026-08-22 decision-inbox digest, accepted verbatim
 * 「接受所有」): **Option A — refuse at query time.** The dataset scope's
 * leaves are folded into the one member view `planCrossObject` judges, so both
 * doors refuse at the moment the engine would otherwise be misled. Compile-time
 * rejection in `dataset-compiler.ts` (Option B) was NOT taken — the compiler
 * cannot see which driver will serve the dataset, and this same definition is
 * legal on a native-SQL deployment — and serving the shape (Option C) is
 * deferred until a real customer dataset is found to depend on it.
 *
 * Measured on the merged tree, one fixture, both doors in one run:
 *
 * ```
 * BEFORE   execute()     ACCEPTED  -> engine.aggregate got
 *                                     {"$and":[{"account.region":"West"}]}
 *          generateSql() ACCEPTED
 * AFTER    execute()     REFUSED   INVALID_FIELD / 400, member "account.region"
 *          generateSql() REFUSED   same
 *          engine.aggregate        never reached (0 calls)
 * ```
 *
 * ## Why the still-served neighbour below is load-bearing
 *
 * "Refuse the dataset scope" has a trivially green wrong implementation:
 * refuse EVERY dataset scope. It would pass a refusal-only suite and break
 * every scoped dataset shipping today. The ordinary-scope case is therefore
 * pinned one character away from the refused one, reaching the engine and
 * CARRYING its predicate — dropping the scope silently widens the answer just
 * as badly as refusing it wrongly narrows the product.
 */
describe('[#10861] a CROSS-OBJECT definition-level filter is refused on BOTH doors', () => {
  it('execute() refuses with the ADR-0112 envelope, before the engine is asked', async () => {
    const { execute, calls } = await bothDoors('xobj_scoped_sales', {
      dimensions: ['stage'], measures: ['revenue'],
    }, [XOBJ_SCOPED_SALES]);

    expect(execute, 'accepted — the dataset scope was invisible to the envelope check')
      .toBeInstanceOf(Error);
    // Read exactly as `rest-server.ts`'s catch reads them: a 4xx status AND a
    // code, or the route falls through to 500 ANALYTICS_QUERY_FAILED. Asserting
    // only that it throws would pass on a bare `Error` and report the platform
    // broken for what is a dataset-authoring mistake on this deployment.
    expect(execute?.code, 'no `code` ⇒ 500 ANALYTICS_QUERY_FAILED').toBe('INVALID_FIELD');
    expect(execute?.status, 'no `status` ⇒ 500 ANALYTICS_QUERY_FAILED').toBe(400);
    // The member as the DATASET spelled it, and the dataset named as the
    // document to go and edit.
    expect(execute?.member).toBe('account.region');
    expect(execute?.cube).toBe('xobj_scoped_sales');
    expect(String(execute?.message)).toMatch(DATASET_SCOPE_MESSAGE);
    // `param` is ABSENT on purpose, and this assertion is the pin on that
    // choice rather than an omission nobody noticed. `AnalyticsRequestKey` is
    // the analytics REQUEST vocabulary; `AnalyticsQuerySchema` is strict and has
    // no `filter` key, and this request carries no `where` at all. Both
    // `param: 'where'` and a widened `param: 'filter'` would send the caller to
    // a key that does not exist on what they sent. `cube` is the locator that
    // does.
    expect(execute?.param, '`param` must not name a key the request has no room for')
      .toBeUndefined();
    // Refused BEFORE the engine was asked, not after it mis-bucketed. This is
    // the assertion the whole card is about: the BEFORE run reached it once,
    // carrying `{"$and":[{"account.region":"West"}]}`.
    expect(calls, 'engine.aggregate was reached — it cannot join').toEqual([]);
  });

  it('both doors agree', async () => {
    const { execute, generateSql } = await bothDoors('xobj_scoped_sales', {
      dimensions: ['stage'], measures: ['revenue'],
    }, [XOBJ_SCOPED_SALES]);
    // One fact about one query, not two independent expectations — the same
    // shape ① uses. Two expectations that happen to coincide do not pin an
    // invariant BETWEEN two call sites; this does.
    expect(
      [execute === undefined, generateSql === undefined],
      'the preview and the execution door accept/reject the same set',
    ).toEqual([false, false]);
    expect(generateSql?.code).toBe('INVALID_FIELD');
    expect(generateSql?.status).toBe(400);
    expect(String(generateSql?.message)).toMatch(DATASET_SCOPE_MESSAGE);
  });

  it('the still-served neighbour: an ORDINARY dataset scope still reaches the engine carrying its predicate', async () => {
    // LOAD-BEARING. An implementation that refused every dataset scope would go
    // green on the two tests above and break every scoped dataset shipping
    // today. `is_deleted: false` is one character away from `account.region`
    // in the fixture and travels the identical `$and` conjunct route.
    const { execute, generateSql, calls } = await bothDoors('scoped_sales', {
      dimensions: ['stage'], measures: ['revenue'],
    }, [SCOPED_SALES]);
    expect(
      [execute === undefined, generateSql === undefined],
      'both doors must still SERVE an ordinary dataset scope',
    ).toEqual([true, true]);
    expect(calls, 'the engine was not reached at all — the scope was refused, not served')
      .toHaveLength(1);
    expect(
      JSON.stringify(calls[0]?.filter),
      'reached the engine with the scope DROPPED — silently wider, not refused',
    ).toContain('is_deleted');
  });

  it('a base-object leaf beside a cross-object one in the SAME dataset scope is still refused', async () => {
    // The counter-shape for the test above: refusing is not a property of the
    // scope having more than one leaf, and serving is not a property of it
    // having a base leaf anywhere in it. The cross-object leaf decides.
    const { execute, generateSql, calls } = await bothDoors('mixed_scoped_sales', {
      dimensions: ['stage'], measures: ['revenue'],
    }, [MIXED_SCOPED_SALES]);
    expect([execute === undefined, generateSql === undefined]).toEqual([false, false]);
    expect(execute?.member).toBe('account.region');
    expect(calls).toEqual([]);
  });

  it('the KNOWN-PRESENT control: a cross-object member in the CALLER\u2019s where keeps its own diagnostic', async () => {
    // The counter-check for every "refused" above, and the pin that #10861 did
    // not repaint the refusal #10759 restored. This shape was refused before
    // this card and is refused after it, with the OTHER message and with
    // `param: 'where'` — which is exactly what makes the absent `param` above a
    // deliberate distinction rather than a field this file forgot to set.
    const { execute, generateSql } = await bothDoors('sales_by_account', {
      dimensions: ['stage'], measures: ['revenue'], where: { 'account.region': 'West' },
    }, [SALES_BY_ACCOUNT]);
    expect(String(execute?.message)).toMatch(CROSS_OBJECT_MESSAGE);
    expect(String(generateSql?.message)).toMatch(CROSS_OBJECT_MESSAGE);
    expect(execute?.param).toBe('where');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ⑦ + ⑧ [#11461] the CROSS-OBJECT per-measure filter — the third producer
// ────────────────────────────────────────────────────────────────────────────

/**
 * THE REFUSAL IS INTENDED, on the same ruling ⑤ cites (maintainer, 2026-08-22,
 * Option A — refuse at query time, folding the leaves into the one member
 * view). Same hazard class, same physical verdict, one more producer.
 *
 * The BEFORE numbers are in this file's header block: `west_count` came back
 * `0` where the truth was `2`, beside a `total_count` of `3` that was correct —
 * so nothing about the response said anything had gone wrong. The echo door
 * rendered `COUNT(CASE WHEN account.region = $1 THEN 1 END)` over a `FROM` with
 * no join in it. Neither door refused.
 *
 * ⑧ below is load-bearing twice over. "Refuse a cross-object measure filter"
 * has two trivially green wrong implementations — refuse EVERY measure filter,
 * which breaks every conditional aggregate shipping today, and judge the
 * dataset's whole `measureFilters` map rather than the measures the query
 * actually asks for, which refuses a query on the strength of a declaration it
 * was never going to evaluate. Both are pinned against, on the same fixture,
 * one measure name away from the refused case.
 */
describe('[#11461] a CROSS-OBJECT per-measure filter is refused on BOTH doors', () => {
  it('execute() refuses with the ADR-0112 envelope, before the engine is asked', async () => {
    const { execute, calls } = await bothDoors('measure_filter_sales', {
      dimensions: ['stage'], measures: ['revenue', 'west_revenue'],
    }, [MEASURE_FILTER_SALES]);

    expect(execute, 'accepted — the measure’s own filter was invisible to the envelope check')
      .toBeInstanceOf(Error);
    // Read exactly as `rest-server.ts`'s catch reads them: a 4xx status AND a
    // code, or the route falls through to 500 ANALYTICS_QUERY_FAILED. Asserting
    // only that it throws would pass on a bare `Error` and report the platform
    // broken for what is a dataset-authoring mistake on this deployment.
    expect(execute?.code, 'no `code` ⇒ 500 ANALYTICS_QUERY_FAILED').toBe('INVALID_FIELD');
    expect(execute?.status, 'no `status` ⇒ 500 ANALYTICS_QUERY_FAILED').toBe(400);
    // The member as the MEASURE'S FILTER spelled it, and the dataset named as
    // the document to open — plus the measure inside it, in the message, which
    // is the locator neither of the other two refusals has an equivalent of.
    expect(execute?.member).toBe('account.region');
    expect(execute?.cube).toBe('measure_filter_sales');
    expect(String(execute?.message)).toMatch(MEASURE_FILTER_MESSAGE);
    // `param` ABSENT, and this assertion is the pin on that choice. `measures`
    // IS a request key and the caller did name `west_revenue` — but `member`
    // here is `account.region`, and the pair `member: 'account.region'` +
    // `param: 'measures'` would send a reader to look for that field inside
    // `measures`, where it is not and cannot be. What is wrong is the dataset's
    // DECLARATION of the measure; `cube` plus the message carry that.
    expect(execute?.param, '`param` must not name a key the member cannot be found under')
      .toBeUndefined();
    // The assertion this whole card is about: the BEFORE run reached the engine
    // once and got a wrong number back that looked exactly like a right one.
    expect(calls, 'engine.aggregate was reached — it cannot join').toEqual([]);
  });

  it('both doors agree', async () => {
    const { execute, generateSql } = await bothDoors('measure_filter_sales', {
      dimensions: ['stage'], measures: ['revenue', 'west_revenue'],
    }, [MEASURE_FILTER_SALES]);
    // One fact about one query, not two independent expectations — the same
    // shape ① and ⑤ use. The echo door had its OWN lowering of this producer
    // (`conditionalAggregateSql`), so "the preview accepts/rejects the same
    // set" is exactly the sentence that was false here.
    expect(
      [execute === undefined, generateSql === undefined],
      'the preview and the execution door accept/reject the same set',
    ).toEqual([false, false]);
    expect(generateSql?.code).toBe('INVALID_FIELD');
    expect(generateSql?.status).toBe(400);
    expect(String(generateSql?.message)).toMatch(MEASURE_FILTER_MESSAGE);
  });

  it('the still-served neighbour: an ORDINARY per-measure filter still reaches the engine CARRYING its own predicate', async () => {
    // LOAD-BEARING. An implementation that refused every per-measure filter
    // would go green on the two tests above and break every conditional
    // aggregate shipping today (#10413 phase 2 / #10576). `stage` is one
    // measure away from `account.region` in the same fixture and travels the
    // identical `measureFilters` → `aggregations[].filter` route.
    const { execute, generateSql, calls } = await bothDoors('measure_filter_sales', {
      dimensions: ['stage'], measures: ['revenue', 'won_revenue'],
    }, [MEASURE_FILTER_SALES]);
    expect(
      [execute === undefined, generateSql === undefined],
      'both doors must still SERVE an ordinary per-measure filter',
    ).toEqual([true, true]);
    expect(calls, 'the engine was not reached at all — the measure filter was refused, not served')
      .toHaveLength(1);
    // Dropping the predicate is as wrong as refusing it, and silently wider:
    // `won_revenue` would come back equal to `revenue` and read as a real
    // number. The pin is on the AGGREGATION's own filter, which is where this
    // producer lands — it never touches the whole-call filter.
    const won = calls[0].aggregations?.find((a) => a.alias === 'won_revenue');
    expect(won?.filter, 'reached the engine with the measure filter DROPPED — silently wider').toEqual({ stage: 'won' });
    // …and its unfiltered neighbour in the same call must NOT have acquired one.
    expect(calls[0].aggregations?.find((a) => a.alias === 'revenue')?.filter).toBeUndefined();
  });

  it('a cross-object filter on a measure the query does NOT ask for changes nothing', async () => {
    // LOAD-BEARING, and the counter-shape for the test above: `west_revenue` is
    // declared on THIS dataset, with the same cross-object leaf that is refused
    // at the top of this block — but this query never asks for it, so neither
    // door's aggregation loop ever reads its filter and no predicate the engine
    // cannot join is ever built. Judging the dataset's whole `measureFilters`
    // map instead of `query.measures` would refuse this query for a member that
    // was never going to be evaluated, and would take every other measure on a
    // dataset down with one unserveable one.
    const { execute, generateSql, calls } = await bothDoors('measure_filter_sales', {
      dimensions: ['stage'], measures: ['revenue'],
    }, [MEASURE_FILTER_SALES]);
    expect([execute === undefined, generateSql === undefined]).toEqual([true, true]);
    expect(calls).toHaveLength(1);
    expect(
      JSON.stringify(calls[0].aggregations),
      'a filter for an unrequested measure was lowered anyway',
    ).not.toContain('account.region');
  });

  it('the KNOWN-PRESENT control: a cross-object member in the CALLER’s where keeps its own diagnostic on this fixture too', async () => {
    // The counter-check for every "refused" above, on the SAME cube — so the
    // refusal ⑦ adds cannot be mistaken for the fixture simply being unable to
    // serve anything, and #11461 is shown not to have repainted the refusal
    // #10759 restored. Refused before this card and after it, with the OTHER
    // message and with `param: 'where'`.
    const { execute, generateSql, calls } = await bothDoors('measure_filter_sales', {
      dimensions: ['stage'], measures: ['revenue'], where: { 'account.region': 'West' },
    }, [MEASURE_FILTER_SALES]);
    expect(String(execute?.message)).toMatch(CROSS_OBJECT_MESSAGE);
    expect(String(generateSql?.message)).toMatch(CROSS_OBJECT_MESSAGE);
    expect(execute?.param).toBe('where');
    expect(calls).toEqual([]);
  });

  it('the caller’s own where wins the diagnostic when BOTH name the same member', async () => {
    // The ordering pin. `filterMemberView` inserts measure-filter leaves FIRST
    // and `where` last, last write wins — so a member named by the request too
    // keeps the provenance the caller can act on directly, and every shape
    // refused before #11461 keeps the exact message it had.
    const { execute } = await bothDoors('measure_filter_sales', {
      dimensions: ['stage'], measures: ['revenue', 'west_revenue'],
      where: { 'account.region': 'West' },
    }, [MEASURE_FILTER_SALES]);
    expect(String(execute?.message)).toMatch(CROSS_OBJECT_MESSAGE);
    expect(execute?.param).toBe('where');
  });
});
