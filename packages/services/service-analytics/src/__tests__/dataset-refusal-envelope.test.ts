// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5367] The five dataset refusals carry the ADR-0112 envelope
 * (`DATASET_INVALID` / 400) — and the refusal SET did not move.
 *
 * ## What was wrong
 *
 * #5352 / PR #5366 made `/analytics/dataset/query` classify a thrown error by
 * reading its `code` + 4xx `status`, and enveloped `filter-normalizer.ts`'s nine
 * refusals so the route could. Six OTHER refusal families in this package stayed
 * bare `throw new Error(…)`, and kept answering `400 DATASET_INVALID` only
 * because the route carried a transitional list of message SUBSTRINGS:
 *
 * ```
 * /not declared in the dataset|not backed by a declared relationship|
 *  not supported by the v1 dataset runtime|read-scope-sql|
 *  not a selected dimension or measure|is not a subset of the selected dimensions/
 * ```
 *
 * That made the HTTP status of six families a property of their **wording**.
 * Rephrasing "is not declared in the dataset's `include`" — no logic change —
 * moved the refusal from 400 to 500, which is exactly the defect #5352 fixed,
 * replayed on a different family, and no test or gate would have gone red.
 * Prime Directive #12 permits an accommodation like that while it is declared,
 * loud, tested **and removable on a schedule**; #5366 shipped the first three
 * and nothing carried the fourth. #5367 is the schedule.
 *
 * ## The two halves of this file, and why the second one exists
 *
 * `describe('the refusal SET is unchanged')` pins WHICH inputs are refused and
 * what each refusal says. Every assertion in it passes both BEFORE and AFTER
 * #5367 — that is its whole job. This change alters the SHAPE of an error and
 * nothing about the judgement that produced it, and "we only touched the
 * envelope" is a claim worth being able to re-run rather than assert.
 *
 * `describe('every enveloped refusal carries …')` is the change. Run it against
 * pre-#5367 code and all five cases fail with `code` / `status` `undefined`,
 * while the block above stays green.
 *
 * `describe('what deliberately stays a bare Error')` is the retirement schedule's
 * remaining item, pinned so it cannot be forgotten in either direction: the
 * `read-scope-sql` family is still unenveloped, so the route's list still needs
 * its one surviving entry. When those ten refusals gain an envelope, this block
 * goes red — and the fix is to delete that last entry in the same PR.
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
import { compileDataset, UNSUPPORTED_AGGREGATES } from '../dataset-compiler.js';
import { DatasetExecutor, resolveOrdering } from '../dataset-executor.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

/** The ADR-0112 fields the REST boundary classifies on. */
interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

/** Run `thunk` and return the error it threw, if any. */
async function refusalFrom(thunk: () => unknown | Promise<unknown>): Promise<Refusal | undefined> {
  try {
    await thunk();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A valid single-object dataset — nothing here needs a join. */
const validDataset = DatasetSchema.parse({
  name: 'pipeline',
  label: 'Pipeline',
  object: 'crm_opportunity',
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

function fakeService(rows: Record<string, unknown>[] = [{ stage: 'won', revenue: 100 }]): IAnalyticsService {
  return {
    query: vi.fn(async (_q: AnalyticsQuery): Promise<AnalyticsResult> => ({
      rows,
      fields: [{ name: 'revenue', type: 'number' }],
    })),
    getMeta: async () => [],
  };
}

/**
 * A cube whose ONLY dotted reference comes from the QUERY, not the cube — the
 * caller-shaped trigger for the join allowlist.
 *
 * `lookupMember` answers a dotted member no dimension declares with a synthetic
 * `{ sql: member }`, so `selection.dimensions: ['account.region']` registers a
 * join at alias `account`. A dataset's own dimensions cannot reach here:
 * `compileDataset`'s `assertDeclared` refuses an undeclared relationship path at
 * compile time (case ② below).
 */
const bareCube: Cube = {
  name: 'pipeline',
  title: 'Pipeline',
  sql: 'crm_opportunity',
  measures: { revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'amount' } },
  dimensions: { stage: { name: 'stage', label: 'Stage', type: 'string', sql: 'stage' } },
  public: false,
};

function nativeCtx(allowed: Set<string>): StrategyContext {
  return {
    getCube: (name: string) => (name === 'pipeline' ? bareCube : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [],
    getAllowedRelationships: () => allowed,
  } as StrategyContext;
}

/**
 * The five refusing sites the route's message list used to classify, one input
 * each, driven through the REAL producer.
 *
 * `listEntry` is the substring the route matched before #5367 — it is what makes
 * the deletion auditable: every entry removed from that regex has a row here.
 */
const REFUSALS: Array<{
  name: string;
  listEntry: string;
  message: RegExp;
  run: () => unknown | Promise<unknown>;
}> = [
  {
    name: '① dataset-compiler: aggregate outside the v1 runtime',
    listEntry: 'not supported by the v1 dataset runtime',
    message: /measure "names" uses aggregate "probe_agg" which is not supported by the v1 dataset runtime/,
    // This row used to be driven by `string_agg`, a real spec value this
    // runtime could not lower. #6188 retired it (and `array_agg`) from
    // `AggregationFunction`, so the refusal moved one layer earlier — no
    // spec-valid dataset reaches this branch any more, and the input can no
    // longer go through `DatasetSchema.parse`. The branch itself stays, as the
    // landing site for the next aggregate declared ahead of this runtime, and
    // so does this row: what it pins is the ENVELOPE, which is this file's
    // subject and is independent of which value happens to be unlowered today.
    run: () => {
      UNSUPPORTED_AGGREGATES.add('probe_agg');
      try {
        return compileDataset({
          name: 'pipeline',
          label: 'Pipeline',
          object: 'crm_opportunity',
          dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
          measures: [{ name: 'names', aggregate: 'probe_agg', field: 'name' }],
        } as never);
      } finally {
        UNSUPPORTED_AGGREGATES.delete('probe_agg');
      }
    },
  },
  {
    name: '② dataset-compiler: field traversing an undeclared relationship path',
    listEntry: 'not declared in the dataset',
    message: /dimension "region" references relationship path "account" via "account\.region", but "account" is not declared in the dataset's `include`/,
    run: () =>
      compileDataset(
        DatasetSchema.parse({
          name: 'pipeline',
          label: 'Pipeline',
          object: 'crm_opportunity',
          include: [],
          dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
          measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
        }),
      ),
  },
  {
    name: '③ dataset-executor: an order key that is not selected',
    listEntry: 'not a selected dimension or measure',
    message: /order key\(s\) "profit" — not a selected dimension or measure\. Selectable here: stage, revenue/,
    run: () =>
      resolveOrdering(
        { dimensions: ['stage'], measures: ['revenue'], order: { profit: 'desc' } } as DatasetSelection,
        ['stage'],
      ),
  },
  {
    name: '④ dataset-executor: a totals grouping outside the selection',
    listEntry: 'is not a subset of the selected dimensions',
    message: /totals grouping \[region\] is not a subset of the selected dimensions — unknown: region/,
    run: () =>
      new DatasetExecutor(fakeService()).execute(compileDataset(validDataset), {
        dimensions: ['stage'],
        measures: ['revenue'],
        totals: { groupings: [['region']] },
      }),
  },
  {
    name: '⑤ native-sql-strategy: a join outside the declared allowlist',
    listEntry: 'not backed by a declared relationship',
    message: /join "account" is not backed by a declared relationship on cube "pipeline"/,
    run: () =>
      new NativeSQLStrategy().generateSql(
        { cube: 'pipeline', measures: ['revenue'], dimensions: ['account.region'], timezone: 'UTC' },
        nativeCtx(new Set<string>()),
      ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5367] the refusal SET is unchanged — only the error shape moved', () => {
  for (const c of REFUSALS) {
    it(`still REFUSES: ${c.name}`, async () => {
      const err = await refusalFrom(c.run);
      expect(err, `${c.name} was accepted — the refusal set moved`).toBeInstanceOf(Error);
      expect(String(err?.message)).toMatch(c.message);
    });
  }

  it('the ACCEPTING neighbours still compile — the refusal did not widen', async () => {
    // ①/② compile clean; ③ returns the requested order; ④ runs the grouping;
    // ⑤ emits the join. One assertion per site, on the input one character away
    // from the refused one.
    expect(compileDataset(validDataset).cube.name).toBe('pipeline');
    expect(
      compileDataset(
        DatasetSchema.parse({
          name: 'joined',
          label: 'Joined',
          object: 'crm_opportunity',
          include: ['account'],
          dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
          measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
        }),
      ).allowedRelationships.has('account'),
    ).toBe(true);
    expect(
      resolveOrdering(
        { dimensions: ['stage'], measures: ['revenue'], order: { revenue: 'desc' } } as DatasetSelection,
        ['stage'],
      ),
    ).toEqual({ revenue: 'desc' });
    const totalled = await new DatasetExecutor(fakeService()).execute(compileDataset(validDataset), {
      dimensions: ['stage'],
      measures: ['revenue'],
      totals: { groupings: [['stage']] },
    });
    expect(totalled.totals?.[0].dimensions).toEqual(['stage']);
    const { sql } = await new NativeSQLStrategy().generateSql(
      { cube: 'pipeline', measures: ['revenue'], dimensions: ['account.region'], timezone: 'UTC' },
      nativeCtx(new Set(['account'])),
    );
    expect(sql).toContain('LEFT JOIN "account"');
  });
});

describe('[#5367] every enveloped refusal carries the ADR-0112 envelope (DATASET_INVALID / 400)', () => {
  for (const c of REFUSALS) {
    it(`${c.name} → code DATASET_INVALID, status 400`, async () => {
      const err = await refusalFrom(c.run);
      expect(err).toBeInstanceOf(Error);
      // Read exactly as `rest-server.ts`'s catch reads them.
      expect(err?.code, 'a refusal with no `code` lands as 500 ANALYTICS_QUERY_FAILED').toBe('DATASET_INVALID');
      expect(err?.status, 'a refusal with no `status` lands as 500 ANALYTICS_QUERY_FAILED').toBe(400);
    });
  }

  it('covers every entry #5367 removed from the route message list', () => {
    // The audit trail for the deletion: five entries left that regex, and each
    // one has a row above driven through its real producer. `read-scope-sql` is
    // the sixth and is deliberately absent — see the block below.
    expect(REFUSALS.map((c) => c.listEntry)).toEqual([
      'not supported by the v1 dataset runtime',
      'not declared in the dataset',
      'not a selected dimension or measure',
      'is not a subset of the selected dimensions',
      'not backed by a declared relationship',
    ]);
  });
});

describe('[#5367] the verdicts that are deliberately NOT DATASET_INVALID', () => {
  /**
   * Two of `read-scope-sql.ts`'s ten fail-closed refusals, as samples of the
   * family: an unsupported operator (the deepest site) and an unsafe identifier
   * (the shallowest).
   *
   * ⚠️ RE-JUDGED, and this block is the day the previous version predicted.
   * It used to assert these carried NO envelope, with a comment saying "when this
   * flips, `rest-server.ts` must lose its last message-list entry in the SAME PR".
   * The maintainer ruled on 2026-08-06 (option B on #5367's decision card) and
   * that is what this PR does: all ten now carry `READ_SCOPE_COMPILE_FAILED` /
   * **500**, and the route's list is gone entirely.
   *
   * Why 500 rather than any 4xx: their INPUTS are not the caller's — the filter is
   * the RLS `FilterCondition` the security service compiled from an admin-authored
   * policy, the alias is a join alias the dataset compiler generated. So the two
   * things that can arrive are a broken policy and drift between two of our own
   * components, and for THIS request's caller both are a server fault. The full
   * per-site table lives in `read-scope-refusal-envelope.test.ts`; these two rows
   * stay here so the three verdict classes are visible side by side.
   */
  const READ_SCOPE: Array<{ name: string; run: () => unknown }> = [
    {
      name: 'unsupported operator in a read scope',
      run: () => compileScopedFilterToSql({ owner: { $regex: 'admin' } } as never, 'crm_opportunity'),
    },
    {
      name: 'unsafe alias identifier',
      run: () => compileScopedFilterToSql({ owner_id: 'u1' } as never, 'not a valid alias'),
    },
  ];

  for (const c of READ_SCOPE) {
    it(`read-scope-sql: ${c.name} → READ_SCOPE_COMPILE_FAILED / 500, never DATASET_INVALID`, async () => {
      const err = await refusalFrom(c.run);
      expect(err).toBeInstanceOf(Error);
      expect(String(err?.message)).toContain('[read-scope-sql]');
      expect(String(err?.message)).toContain('(fail-closed)');
      expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(err?.status).toBe(500);
      // The load-bearing negative: a 4xx here would blame the caller for a policy
      // they cannot see, and would put its field names in their response body.
      expect(err?.code).not.toBe('DATASET_INVALID');
      expect(Number(err?.status)).toBeGreaterThanOrEqual(500);
    });
  }

  it('the dataset-compiler internal invariant stays a bare Error (an UNDECLARED 500)', async () => {
    // "non-derived measure has no aggregate" is guarded defensively behind a
    // spec refinement that already guarantees it. An arrival is OUR bug, so
    // enveloping it as the caller's 400 would be the mirror-image defect —
    // ops alerting stops seeing it and the author is told to fix something they
    // did not write. Reached by bypassing the schema, which is the only way in.
    //
    // [#5367] It stays UNDECLARED rather than being given the read-scope 500
    // envelope, and the difference is observable: `rest-server.ts` withholds the
    // message of a producer that DECLARES a server fault (the RLS policy content
    // must not reach the caller) while an undeclared 5xx keeps #5667's tiering
    // and stays readable. A programming invariant is the operator's own bug
    // report; there is nothing tenant-sensitive in it to withhold.
    const err = await refusalFrom(() =>
      compileDataset({
        name: 'pipeline',
        label: 'Pipeline',
        object: 'crm_opportunity',
        dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
        measures: [{ name: 'broken', field: 'amount' }],
      } as never),
    );
    expect(String(err?.message)).toMatch(/non-derived measure "broken" has no aggregate/);
    expect(err?.code).toBeUndefined();
    expect(err?.status).toBeUndefined();
  });
});
