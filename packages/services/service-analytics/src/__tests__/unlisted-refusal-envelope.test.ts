// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5716] The refusals that were never on anybody's list.
 *
 * ## What was wrong
 *
 * #5352 gave `/analytics/dataset/query` a message-substring list so six refusal
 * families could answer 400, and #5367 retired five of those entries by giving
 * the producers an ADR-0112 envelope. Both rounds worked from the same list —
 * and the list was assembled from the refusals someone had already hit.
 *
 * Reading every `throw` in this package afterwards turned up TWELVE more throw
 * sites — thirteen refusal conditions, since the cross-object measure and filter
 * share one — of exactly the same kind: caller- or author-shaped refusals that
 * never entered the regex at all, so no round ever touched them and they were
 * answering `500 ANALYTICS_QUERY_FAILED` — "the platform is broken" — for a
 * mistake in the request or in the dataset the caller wrote:
 *
 * ```
 * dataset-compiler.ts      JOIN crosses datasources (#5115) · `include`
 *                          relationship absent · `include` path over the hop limit
 * dataset-executor.ts      unparseable `dateRange` bound · compareTo names an
 *                          undated dimension · compareTo with no dated window ·
 *                          compareTo ambiguous between two dated windows
 * native-sql-strategy.ts   cube declares no such measure (#4157)
 * objectql-strategy.ts     cross-object time bucket · cross-object measure ·
 *                          cross-object filter · multi-hop cross-object
 *                          dimension · non-recombinable measure (planCrossObject)
 * ```
 *
 * ## The three blocks
 *
 * `the refusal SET is unchanged` pins WHICH inputs are refused and what each one
 * says. Every assertion in it passes before AND after this change — that is its
 * whole job, because "we only touched the envelope" is a claim worth being able
 * to re-run. It matters more here than it did for #5367: five of these messages
 * are asserted by #5923's tests, so a rewording would break another PR's pins.
 *
 * `every newly enveloped refusal carries…` is the change. Run it against
 * pre-#5716 code and all thirteen fail with `code`/`status` `undefined`, while
 * the block above stays green.
 *
 * `the verdicts that deliberately stay 500` is the fork, pinned rather than
 * argued: `native-sql-strategy`'s "unrecognised type" was on #5716's list of
 * nine as author-shaped, and it is not — see the case for the measurement.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Ordinary direction, no inversion: revert any one producer to `throw new
 * Error(…)` and that row of block 2 goes RED on `code`/`status` `undefined`,
 * while its row in block 1 stays green (the message did not move) — which is
 * exactly the asymmetry that made these thirteen invisible for two rounds. There
 * is no "more diagnostics" or "inverted" shape available here: nothing counts
 * verdicts, and no rule was narrowed.
 *
 * MEASURED with the four producer files reverted to `origin/main` (tests all
 * kept): **22 red / 1053 green** across `@objectstack/service-analytics`, and the
 * set is exactly the predicted one plus one correction worth recording:
 *
 *   - 13 red — block 2's envelope rows;
 *   - 6 red — block 2's `member`/`param` rows (the member-level family only);
 *   - 3 red — the pins this PR RE-JUDGED in `where-source-field-gate.test.ts`
 *     (×2) and `measure-source-field-gate.test.ts` (×1), which now assert the
 *     strategy's envelope instead of `code !== 'INVALID_FIELD'`;
 *   - GREEN — all 13 rows of block 1, both cases of block 3, and — correcting
 *     this header's first draft — the `covers every site` ledger case, which
 *     reads the CASES table rather than running anything, so reverting a
 *     producer cannot move it. It fails on a site being ADDED or REMOVED from
 *     this file, which is the different thing it is for.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { Cube } from '@objectstack/spec/data';
import type {
  AnalyticsQuery,
  AnalyticsResult,
  DatasetSelection,
  IAnalyticsService,
  StrategyContext,
} from '@objectstack/spec/contracts';
import { compileDataset } from '../dataset-compiler.js';
import { DatasetExecutor } from '../dataset-executor.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';

/** The ADR-0112 fields the REST boundary classifies on, plus the diagnostics. */
interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
  member?: unknown;
  param?: unknown;
  cube?: unknown;
  field?: unknown;
}

async function refusalFrom(thunk: () => unknown | Promise<unknown>): Promise<Refusal | undefined> {
  try {
    await thunk();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

/** The base dataset every compiler case bends one property of. */
const baseDataset = {
  name: 'pipeline',
  label: 'Pipeline',
  object: 'crm_opportunity',
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};

/** A dataset with the three date dimensions the compareTo cases select from. */
const datedDataset = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  dimensions: [
    { name: 'region', field: 'region', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date' },
    { name: 'created_at', field: 'created_at', type: 'date' },
  ],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

const WINDOW = ['2026-01-01', '2026-01-31'] as [string, string];

function fakeService(): IAnalyticsService {
  return {
    query: vi.fn(async (_q: AnalyticsQuery): Promise<AnalyticsResult> => ({
      rows: [{ region: 'NA', revenue: 100 }],
      fields: [],
    })),
    getMeta: async () => [],
  };
}

/** Run a selection over the dated dataset through the real executor. */
function runSelection(selection: Record<string, unknown>) {
  return new DatasetExecutor(fakeService()).execute(
    compileDataset(datedDataset),
    selection as unknown as DatasetSelection,
  );
}

/**
 * A cube that JOINS — the shape every `planCrossObject` refusal needs, and the
 * one an inferred single-table cube can never produce. `region` / `opened` /
 * `remote_sum` resolve THROUGH the join; `stage` / `revenue` / `avg_deal` do
 * not, which is what lets the same cube carry the accepting neighbours.
 */
const joinedCube: Cube = {
  name: 'sales_by_account',
  title: 'Sales by account',
  sql: 'opportunity',
  measures: {
    revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'amount' },
    avg_deal: { name: 'avg_deal', label: 'Avg deal', type: 'avg', sql: 'amount' },
    remote_sum: { name: 'remote_sum', label: 'Remote', type: 'sum', sql: 'account.balance' },
  },
  dimensions: {
    stage: { name: 'stage', label: 'Stage', type: 'string', sql: 'stage' },
    region: { name: 'region', label: 'Region', type: 'string', sql: 'account.region' },
    opened: { name: 'opened', label: 'Opened', type: 'time', sql: 'account.created_at' },
  },
  joins: {
    account: { name: 'account', relationship: 'many_to_one', sql: 'opportunity.account = account.id' },
  },
  public: false,
};

/** A cube declaring exactly ONE measure — so `revenue` is undeclared on it. */
const countOnlyCube: Cube = {
  name: 'pipeline',
  title: 'Pipeline',
  sql: 'crm_opportunity',
  measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
  dimensions: { stage: { name: 'stage', label: 'Stage', type: 'string', sql: 'stage' } },
  public: false,
};

function ctxFor(cube: Cube): StrategyContext {
  return {
    getCube: (name: string) => (name === cube.name ? cube : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    executeRawSql: async () => [],
    executeAggregate: async () => [],
    getAllowedRelationships: () => new Set(['account']),
  } as unknown as StrategyContext;
}

const objectqlSql = (query: Record<string, unknown>) =>
  new ObjectQLStrategy().generateSql(query as unknown as AnalyticsQuery, ctxFor(joinedCube));

// ── the twelve sites, one input each, through the real producer ──────────────

interface Case {
  name: string;
  /** What the caller changed to trigger it — the audit trail for the set. */
  site: string;
  message: RegExp;
  code: 'DATASET_INVALID' | 'INVALID_FIELD';
  /** Only for the member-level family. */
  member?: string;
  param?: string;
  run: () => unknown | Promise<unknown>;
}

const CASES: Case[] = [
  {
    name: '① dataset-compiler: an `include` JOIN that crosses datasources',
    site: 'dataset-compiler.ts assertSameDatasource (#5115)',
    message: /declares a JOIN that crosses datasources/,
    code: 'DATASET_INVALID',
    run: () =>
      compileDataset(
        DatasetSchema.parse({
          ...baseDataset,
          include: ['account'],
          dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
        }),
        undefined,
        { getObjectDatasource: (o: string) => (o === 'crm_opportunity' ? 'primary' : 'warehouse') },
      ),
  },
  {
    name: '② dataset-compiler: an `include` relationship the object does not have',
    site: 'dataset-compiler.ts resolveHop',
    message: /includes relationship "bogus" which does not exist on object "crm_opportunity"/,
    code: 'DATASET_INVALID',
    run: () =>
      compileDataset(
        DatasetSchema.parse({ ...baseDataset, include: ['bogus'] }),
        () => undefined,
      ),
  },
  {
    name: '③ dataset-compiler: an `include` path past the hop limit',
    site: 'dataset-compiler.ts MAX_JOIN_HOPS (ADR-0071)',
    message: /include path "a\.b\.c\.d" exceeds the 3-hop limit \(4 hops\)/,
    code: 'DATASET_INVALID',
    // ⚠️ Measured while writing this file, and worth knowing before reading the
    // verdict: `DatasetSchema` ALSO refines the hop limit, so on
    // `/analytics/dataset/query` — which parses the document first — this shape
    // never reaches the compiler; it answers `400 VALIDATION_FAILED` with
    // "include path exceeds the 3-hop limit (ADR-0071)". What reaches the
    // compiler is an UNPARSED dataset: a host calling `queryDataset` directly.
    // Enveloping it is still right, and is the reason the schema bypass here is
    // deliberate rather than lazy: the SAME authoring mistake must not answer 400
    // on the parsed path and 500 on the unparsed one. It is also not our own
    // drift — nothing in the runtime synthesizes `include` — which is what keeps
    // it out of the "internal invariant" tier its neighbour at
    // `aggregateToMetricType` sits in.
    run: () => compileDataset({ ...baseDataset, include: ['a.b.c.d'] } as never),
  },
  {
    name: '④ dataset-executor: a dateRange bound that is not a date',
    site: 'dataset-executor.ts parseUTC',
    message: /invalid date in dateRange: "the-first-of-never"/,
    code: 'DATASET_INVALID',
    run: () =>
      runSelection({
        dimensions: ['region'],
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', 'the-first-of-never'] }],
        compareTo: { kind: 'previousPeriod' },
      }),
  },
  {
    name: '⑤ dataset-executor: compareTo names a dimension with no dateRange',
    site: 'dataset-executor.ts resolveCompareDimension (named)',
    message: /compareTo requires a timeDimension "created_at" with a dateRange/,
    code: 'DATASET_INVALID',
    run: () =>
      runSelection({
        dimensions: ['region'],
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
        compareTo: { kind: 'previousPeriod', dimension: 'created_at' },
      }),
  },
  {
    name: '⑥ dataset-executor: compareTo with no dated window at all',
    site: 'dataset-executor.ts resolveCompareDimension (none)',
    message: /compareTo needs a dated window to shift/,
    code: 'DATASET_INVALID',
    run: () =>
      runSelection({
        dimensions: ['region'],
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'close_date', granularity: 'month' }],
        compareTo: { kind: 'previousPeriod' },
      }),
  },
  {
    name: '⑦ dataset-executor: compareTo ambiguous between two dated windows',
    site: 'dataset-executor.ts resolveCompareDimension (ambiguous)',
    message: /compareTo\.dimension is ambiguous: 2 time dimensions carry a dateRange/,
    code: 'DATASET_INVALID',
    run: () =>
      runSelection({
        dimensions: ['region'],
        measures: ['revenue'],
        timeDimensions: [
          { dimension: 'close_date', dateRange: WINDOW },
          { dimension: 'created_at', dateRange: WINDOW },
        ],
        compareTo: { kind: 'previousPeriod' },
      }),
  },
  {
    name: '⑧ native-sql-strategy: a measure the cube does not declare',
    site: 'native-sql-strategy.ts resolveMeasureSql (#4157)',
    message: /cube "pipeline" declares no measure "revenue" \(declared: count\)/,
    code: 'INVALID_FIELD',
    member: 'revenue',
    param: 'measures',
    // Driven at the STRATEGY, like `measure-expression-sql.test.ts`, and
    // deliberately: measured, `AnalyticsService.ensureCube` augments a
    // registered cube with a suffix-inferred `Metric` for every measure the
    // query names, so no request reaching the service arrives here with an
    // undeclared one — what answers on that path is the #4437 gate, with the
    // SAME `INVALID_FIELD` / 400 (asserted end-to-end in `packages/rest`'s
    // `analytics-dataset-unlisted-refusal-envelope.test.ts`). That agreement is
    // why this site is `invalidMemberError` and not `datasetInvalidError`.
    run: () =>
      new NativeSQLStrategy().generateSql(
        { cube: 'pipeline', measures: ['revenue'], timezone: 'UTC' },
        ctxFor(countOnlyCube),
      ),
  },
  {
    name: '⑨ objectql-strategy: bucketing a cross-object time dimension',
    site: 'objectql-strategy.ts planCrossObject (time bucket)',
    message: /cannot bucket a cross-object time dimension \("account\.created_at"\)/,
    code: 'INVALID_FIELD',
    member: 'opened',
    param: 'timeDimensions',
    run: () =>
      objectqlSql({
        cube: 'sales_by_account',
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'opened', granularity: 'month' }],
      }),
  },
  {
    name: '⑩ objectql-strategy: a cross-object MEASURE',
    site: 'objectql-strategy.ts planCrossObject (measure)',
    message: /cannot evaluate a cross-object measure \("account\.balance"\)/,
    code: 'INVALID_FIELD',
    member: 'remote_sum',
    param: 'measures',
    run: () => objectqlSql({ cube: 'sales_by_account', measures: ['remote_sum'] }),
  },
  {
    name: '⑪ objectql-strategy: a cross-object FILTER',
    site: 'objectql-strategy.ts planCrossObject (filter)',
    message: /cannot evaluate a cross-object filter \("account\.region"\)/,
    code: 'INVALID_FIELD',
    member: 'account.region',
    param: 'where',
    run: () =>
      objectqlSql({
        cube: 'sales_by_account',
        measures: ['revenue'],
        where: { 'account.region': 'NA' },
      }),
  },
  {
    name: '⑫ objectql-strategy: a MULTI-HOP cross-object dimension',
    site: 'objectql-strategy.ts planCrossObject (multi-hop)',
    message: /supports only single-hop cross-object dimensions; "account\.owner\.region"/,
    code: 'INVALID_FIELD',
    member: 'account.owner.region',
    param: 'dimensions',
    run: () =>
      objectqlSql({
        cube: 'sales_by_account',
        measures: ['revenue'],
        dimensions: ['account.owner.region'],
      }),
  },
  {
    name: '⑬ objectql-strategy: a non-recombinable measure over a cross-object dimension',
    site: 'objectql-strategy.ts planCrossObject (recombination)',
    message: /cannot group by a cross-object dimension with a "avg" measure \("avg_deal"\)/,
    code: 'INVALID_FIELD',
    member: 'avg_deal',
    param: 'measures',
    run: () =>
      objectqlSql({
        cube: 'sales_by_account',
        measures: ['avg_deal'],
        dimensions: ['region'],
      }),
  },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5716] the refusal SET is unchanged — only the error shape moved', () => {
  for (const c of CASES) {
    it(`still REFUSES, with the same words: ${c.name}`, async () => {
      const err = await refusalFrom(c.run);
      expect(err, `${c.name} was accepted — the refusal set moved`).toBeInstanceOf(Error);
      // The wording is load-bearing beyond readability: #5923's tests assert the
      // planCrossObject messages, and #5717 tracks one of them (case ②) for
      // colliding with `isMissingSourceError`'s sniffer. Enveloping must not
      // reword anything.
      expect(String(err?.message)).toMatch(c.message);
    });
  }

  it('the ACCEPTING neighbours still compile — no refusal widened', async () => {
    // One input a character away from each refused one, per producer.
    // ①/② — the same joins, placed on one datasource and resolvable.
    expect(
      compileDataset(
        DatasetSchema.parse({
          ...baseDataset,
          include: ['account'],
          dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
        }),
        undefined,
        { getObjectDatasource: () => 'primary' },
      ).allowedRelationships.has('account'),
    ).toBe(true);
    // ③ — three hops is the limit, not one past it (and the schema agrees: this
    // one parses, the four-hop one above does not).
    expect(
      compileDataset(DatasetSchema.parse({ ...baseDataset, include: ['a.b.c'] })).cube.name,
    ).toBe('pipeline');
    // ④–⑦ — one dated window, parseable, unambiguous: the compare pass runs.
    const compared = await runSelection({
      dimensions: ['region'],
      measures: ['revenue'],
      timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
      compareTo: { kind: 'previousPeriod' },
    });
    expect(compared.rows[0]).toMatchObject({ region: 'NA', revenue: 100 });
    // ⑧ — the measure the cube DOES declare.
    const counted = await new NativeSQLStrategy().generateSql(
      { cube: 'pipeline', measures: ['count'], timezone: 'UTC' },
      ctxFor(countOnlyCube),
    );
    expect(counted.sql).toContain('COUNT(*) AS "count"');
    // ⑨–⑬ — the in-envelope cross-object shape: a single-hop dimension with a
    // recombinable measure, plus a purely base-object query.
    const expanded = await objectqlSql({
      cube: 'sales_by_account',
      measures: ['revenue'],
      dimensions: ['region'],
    });
    expect(expanded.sql).toContain('account');
    const base = await objectqlSql({
      cube: 'sales_by_account',
      measures: ['avg_deal'],
      dimensions: ['stage'],
    });
    expect(base.sql).toContain('AVG');
  });
});

describe('[#5716] every newly enveloped refusal carries the ADR-0112 envelope', () => {
  for (const c of CASES) {
    it(`${c.name} → ${c.code} / 400`, async () => {
      const err = await refusalFrom(c.run);
      expect(err).toBeInstanceOf(Error);
      // Read exactly as `rest-server.ts`'s catch reads them: a 4xx status AND a
      // code, or the route falls through to 500 ANALYTICS_QUERY_FAILED.
      expect(err?.code, 'no `code` ⇒ 500 ANALYTICS_QUERY_FAILED').toBe(c.code);
      expect(err?.status, 'no `status` ⇒ 500 ANALYTICS_QUERY_FAILED').toBe(400);
    });
  }

  for (const c of CASES.filter((x) => x.member)) {
    it(`${c.name} → names the member the REQUEST spelled`, async () => {
      const err = await refusalFrom(c.run);
      expect(err?.member).toBe(c.member);
      expect(err?.param).toBe(c.param);
      expect(err?.cube).toBeTruthy();
      // Never `field`: these sites either have no such column (an undeclared
      // measure) or the column is real and works on another driver (a
      // cross-object member). The three shipped gates set `field` because they
      // DO resolve one; inventing it here would be a fact we do not have.
      expect(err?.field).toBeUndefined();
    });
  }

  it('covers every site #5716 enumerated, and splits them by verdict', () => {
    // The audit trail: nine sites from the issue's own table, minus the one
    // re-judged below, plus the five-refusal `planCrossObject` family the PM
    // merged in on 2026-08-06 (four throws — measure and filter share one).
    expect(CASES.filter((c) => c.code === 'DATASET_INVALID').map((c) => c.site)).toEqual([
      'dataset-compiler.ts assertSameDatasource (#5115)',
      'dataset-compiler.ts resolveHop',
      'dataset-compiler.ts MAX_JOIN_HOPS (ADR-0071)',
      'dataset-executor.ts parseUTC',
      'dataset-executor.ts resolveCompareDimension (named)',
      'dataset-executor.ts resolveCompareDimension (none)',
      'dataset-executor.ts resolveCompareDimension (ambiguous)',
    ]);
    expect(CASES.filter((c) => c.code === 'INVALID_FIELD').map((c) => c.site)).toEqual([
      'native-sql-strategy.ts resolveMeasureSql (#4157)',
      'objectql-strategy.ts planCrossObject (time bucket)',
      'objectql-strategy.ts planCrossObject (measure)',
      'objectql-strategy.ts planCrossObject (filter)',
      'objectql-strategy.ts planCrossObject (multi-hop)',
      'objectql-strategy.ts planCrossObject (recombination)',
    ]);
  });
});

describe('[#5716] the verdicts that deliberately stay an undeclared 500', () => {
  it('native-sql-strategy: an unrecognised metric type — a FORK against the issue list', async () => {
    // #5716's table has this down as "cube / dataset author". It is not, and the
    // measurement is three-sided:
    //
    //   - `Metric.type` is the CLOSED `AggregationMetricType` enum, and
    //     `metric-type-coverage.test.ts` pins that the strategy's aggregate and
    //     expression sets PARTITION it — its second case is literally "leaves no
    //     metric type to the unrecognised-type throw";
    //   - `dataset-compiler` writes only a `SUPPORTED_AGGREGATES` member into a
    //     cube (and refuses the other two aggregates with `DATASET_INVALID`
    //     first), so no DATASET can produce one;
    //   - `inferMeasure` mints six known types, so no ad-hoc cube can either.
    //
    // So reaching it needs a cube that never met `CubeSchema` — our own drift, or
    // a host registering an off-spec object programmatically. Blaming the caller
    // with a 400 would hide a platform bug from ops alerting and tell a dashboard
    // user to fix metadata they cannot see. It stays UNDECLARED (no `code`) so
    // #5667's tiering keeps it readable in the response, like the compiler
    // invariant it sits beside.
    const offSpec = {
      ...countOnlyCube,
      measures: { median_deal: { name: 'median_deal', label: 'Median', type: 'median', sql: 'amount' } },
    } as unknown as Cube;

    const err = await refusalFrom(() =>
      new NativeSQLStrategy().generateSql(
        { cube: 'pipeline', measures: ['median_deal'], timezone: 'UTC' },
        ctxFor(offSpec),
      ),
    );

    expect(String(err?.message)).toMatch(/has unrecognised type "median"/);
    expect(err?.code).toBeUndefined();
    expect(err?.status).toBeUndefined();
  });

  it('the two "Cube not found" guards stay bare too — the strategies cannot be reached without one', async () => {
    // Named here so the fork above is not read as "everything else moved":
    // `ctx.getCube` returning nothing means the registration the service does
    // before dispatching a strategy did not happen. That is ours, not the
    // caller's — a caller naming an unknown cube is stopped much earlier by
    // #3867's `CUBE_NOT_FOUND` / 404 gate.
    for (const run of [
      () => new NativeSQLStrategy().generateSql({ cube: 'ghost', measures: ['count'], timezone: 'UTC' }, ctxFor(countOnlyCube)),
      () => new ObjectQLStrategy().generateSql({ cube: 'ghost', measures: ['count'] } as AnalyticsQuery, ctxFor(joinedCube)),
    ]) {
      const err = await refusalFrom(run);
      expect(String(err?.message)).toMatch(/Cube not found: ghost/);
      expect(err?.code).toBeUndefined();
      expect(err?.status).toBeUndefined();
    }
  });
});
