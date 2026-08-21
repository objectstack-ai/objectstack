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
 * ## Why this file pins FOUR directions, not one
 *
 * Pinning only the new refusal would go green on an implementation that refuses
 * every combinator — which would break every legitimate `$or` query shipping
 * today. So the accepting neighbours are pinned in the same file, one character
 * away from the refused ones:
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
 *
 * ## The scope line this file also draws
 *
 * A dataset whose DEFINITION-LEVEL filter is itself cross-object is accepted by
 * BOTH doors, before and after this change — neither call site's view contains
 * the dataset scope. The doors AGREE there, so it is not the invariant this card
 * restores; it is a separate defect and is pinned here as measured-and-known
 * rather than left to be rediscovered. See the last block.
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

const ctxA = { tenantId: 'org_A', userId: 'u_a' } as ExecutionContext;

interface Refusal extends Error { code?: string; status?: number; member?: string; param?: string }
interface AggCall { object: string; filter?: unknown }

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
    executeAggregate: async (object: string, options: { filter?: unknown }) => {
      calls.push({ object, filter: options.filter });
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

  /**
   * MEASURED AND DELIBERATELY LEFT OPEN — not a latent pass.
   *
   * A cross-object DEFINITION-LEVEL filter is accepted by both doors, and
   * `engine.aggregate` receives `{"$and":[{"account.region":"West"}]}`, which it
   * cannot join. PR #10758 created this instance by giving the dataset scope a
   * route onto the ObjectQL door at all; #10759 is not it, because the two doors
   * AGREE here — neither call site's member view contains the dataset scope, so
   * there is no preview/execution divergence to restore.
   *
   * Filed separately rather than widened into this PR: refusing it is a real
   * decision (query-time refusal versus a compile-time rejection in
   * `dataset-compiler.ts`, which is the contract-first placement), and it is not
   * the invariant this file restores. The expectation below is written to the
   * behaviour as it IS, so the day that decision lands this pin goes red and
   * points at the paragraph explaining why.
   */
  it('a CROSS-OBJECT definition-level filter is still accepted by both doors (filed separately)', async () => {
    const { execute, generateSql, calls } = await bothDoors('xobj_scoped_sales', {
      dimensions: ['stage'], measures: ['revenue'],
    }, [XOBJ_SCOPED_SALES]);
    expect(execute).toBeUndefined();
    expect(generateSql).toBeUndefined();
    expect(JSON.stringify(calls[0]?.filter)).toContain('account.region');
  });
});
