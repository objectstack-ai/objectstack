// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20887, the analytics half of #20802's ruling] The nested-relation form
 * `{ relation: { field: value } }` is answered by the ENGINE on every analytics
 * face — the one place that reads the related object as the caller, bounded —
 * so this package carries no second copy of that rule. What that takes here,
 * pinned at the seams this package owns:
 *
 * 1. `NativeSQLStrategy` DECLINES a query in which a filter the caller or the
 *    dataset writes carries the form — the caller's `where` (either spelling),
 *    the dataset's own `filter`, a requested measure's `filter` — so the query
 *    routes to the ObjectQL/engine path. The same mechanism, for the same
 *    reason, as the #7598 cross-field decline (maintainer ruling 2026-08-12,
 *    Q1 = B): the rule lives in one place and the strategy that cannot enforce
 *    it routes to the one that does. The DOTTED member (`'owner.region'`) is a
 *    cube member, not this form, and stays on the native path. A READ SCOPE
 *    carrying the form is not routed: it is a policy compiled to SQL (item 4).
 * 2. `ObjectQLStrategy` hands the engine the form AS WRITTEN — never flattened
 *    to the dotted member, which the engine cannot join — so the engine's seam
 *    lowers it.
 * 3. The native compiler refuses the form if it ever reaches it (the routing's
 *    fail-closed backstop, unreachable by construction).
 * 4. The read-scope compiler, which compiles a policy to SQL and reads no other
 *    object — a synchronous string builder with the caller's context for
 *    placeholders and no data engine — keeps its fail-closed refusal of the
 *    form, in words that name the route that serves it.
 *
 * The rows each face then answers — the engine's, with the real security layer —
 * are `@objectstack/rest`'s `analytics-nested-relation-filter.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { AnalyticsService } from '../analytics-service.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import type { DatasetScope } from '../strategies/types.js';

const OBJECT = 'nested_ledger';
const OWNER = 'nested_owner';

const CUBE: Cube = {
  name: 'ledger',
  sql: OBJECT,
  measures: {
    row_count: { label: 'Rows', type: 'count', sql: '*' },
    na_count: { label: 'NA rows', type: 'count', sql: '*' },
  },
  dimensions: {
    title: { label: 'Title', type: 'string', sql: 'title' },
    owner: { label: 'Owner', type: 'string', sql: 'owner' },
  },
  joins: { owner: { name: OWNER, relationship: 'many_to_one', sql: 'owner' } },
  public: true,
} as unknown as Cube;

const NESTED: FilterCondition = { owner: { region: 'NA' } };

/** A native-capable context whose every optional producer is a knob. */
function nativeCtx(knobs: {
  datasetScope?: DatasetScope;
  readScopes?: Record<string, FilterCondition>;
} = {}): StrategyContext {
  return {
    getCube: (name: string) => (name === CUBE.name ? CUBE : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    executeRawSql: async () => [],
    ...(knobs.readScopes ? { getReadScope: (object: string) => knobs.readScopes![object] ?? null } : {}),
    ...(knobs.datasetScope ? { getDatasetScope: () => knobs.datasetScope } : {}),
  } as StrategyContext;
}

const q = (extra: Partial<AnalyticsQuery> = {}): AnalyticsQuery =>
  ({ cube: CUBE.name, measures: ['row_count'], dimensions: ['title'], ...extra }) as AnalyticsQuery;

describe('[#20887] NativeSQLStrategy declines the nested-relation form, from every producer it compiles', () => {
  const native = new NativeSQLStrategy();

  it('CONTROL a query with no nested-relation condition stays on the native path, the dotted cube member included', () => {
    expect(native.canHandle(q(), nativeCtx())).toBe(true);
    expect(native.canHandle(q({ where: { title: 'a' } as FilterCondition }), nativeCtx())).toBe(true);
    expect(native.canHandle(q({ where: { 'owner.region': 'NA' } as FilterCondition }), nativeCtx())).toBe(true);
    // A measure filter the query does not ask for is never compiled, so it routes nothing.
    expect(native.canHandle(q(), nativeCtx({ datasetScope: { measureFilters: { na_count: NESTED } } }))).toBe(true);
  });

  it('declines the form in the caller\'s where — top level, inside $and / $or / $not, and in the FilterArray spelling', () => {
    for (const where of [
      NESTED,
      { $and: [{ title: 'a' }, NESTED] },
      { $or: [{ title: 'a' }, NESTED] },
      { $not: NESTED },
      [['owner', '=', { region: 'NA' }]],
    ]) {
      expect(native.canHandle(q({ where: where as FilterCondition }), nativeCtx()), JSON.stringify(where)).toBe(false);
    }
  });

  it('declines the form in the dataset\'s own filter and in a requested measure\'s filter', () => {
    expect(native.canHandle(q(), nativeCtx({ datasetScope: { filter: NESTED } }))).toBe(false);
    expect(
      native.canHandle(q({ measures: ['row_count', 'na_count'] }), nativeCtx({ datasetScope: { measureFilters: { na_count: NESTED } } })),
    ).toBe(false);
  });

  it('does NOT decline for a read scope carrying the form: its compile to SQL keeps the fail-closed refusal', async () => {
    // The base object's scope, and a joined object's (compiled once the statement joins it).
    const cases: ReadonlyArray<readonly [Record<string, FilterCondition>, AnalyticsQuery]> = [
      [{ [OBJECT]: NESTED }, q()],
      [{ [OWNER]: { account: { tier: 'gold' } } }, q({ dimensions: ['owner.region'] })],
    ];
    for (const [readScopes, query] of cases) {
      const ctx = nativeCtx({ readScopes });
      expect(native.canHandle(query, ctx), JSON.stringify(readScopes)).toBe(true);
      const err = await native.generateSql(query, ctx).then(() => null, (e: Error & { code?: string; status?: number }) => e);
      expect({ code: err?.code, status: err?.status }, JSON.stringify(readScopes)).toEqual({ code: 'READ_SCOPE_COMPILE_FAILED', status: 500 });
      expect(String(err?.message)).toContain('carries a nested-relation condition');
    }
  });

  it('the native compiler refuses the form if the routing ever lets it through — a bare fault, never a statement', async () => {
    const err = await native.generateSql(q({ where: NESTED }), nativeCtx()).then(() => null, (e: Error & { code?: string }) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err?.code, 'our own routing drift, not the caller\'s 400').toBeUndefined();
    expect(String(err?.message)).toContain('"owner"');
  });
});

describe('[#20887] ObjectQLStrategy hands the engine the nested-relation form as written', () => {
  /** A service with BOTH paths available, so the routing decides; the engine call is recorded. */
  function service() {
    const aggregates: Array<{ object: string; filter: unknown }> = [];
    const rawSql: string[] = [];
    const svc = new AnalyticsService({
      cubes: [CUBE],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async (_object, sql) => {
        rawSql.push(sql);
        return [];
      },
      executeAggregate: async (object, options) => {
        aggregates.push({ object, filter: options.filter });
        return [];
      },
    });
    return { svc, aggregates, rawSql };
  }

  it('the engine receives the form beneath the relation field — not the dotted member, and not a raw statement', async () => {
    const cases: ReadonlyArray<readonly [unknown, unknown]> = [
      [NESTED, NESTED],
      [{ owners: { region: 'NA' } }, { owners: { region: 'NA' } }],
      [[['owner', '=', { region: 'NA' }]], NESTED],
    ];
    for (const [where, expected] of cases) {
      const { svc, aggregates, rawSql } = service();
      await svc.query(q({ where: where as FilterCondition }));
      expect(rawSql, JSON.stringify(where)).toEqual([]);
      expect(aggregates, JSON.stringify(where)).toHaveLength(1);
      expect(JSON.stringify(aggregates[0].filter), JSON.stringify(where)).toContain(JSON.stringify(expected));
      expect(JSON.stringify(aggregates[0].filter), JSON.stringify(where)).not.toContain('owner.region');
    }
  });

  it('inside $or and $not the form keeps its place in the structure the engine reads', async () => {
    const { svc, aggregates } = service();
    await svc.query(q({ where: { $or: [{ title: 'a' }, NESTED] } as FilterCondition }));
    await svc.query(q({ where: { $not: NESTED } as FilterCondition }));
    expect(aggregates).toHaveLength(2);
    expect(aggregates[0].filter).toMatchObject({ $and: [{ $or: [{ title: 'a' }, NESTED] }] });
    expect(JSON.stringify(aggregates[1].filter)).toMatch(/^\{"\$and":\[\{"\$not":/);
    expect(JSON.stringify(aggregates[1].filter)).toContain(JSON.stringify(NESTED));
  });
});

describe('[#20887] the read-scope compiler keeps its refusal of the form, naming the route that serves it', () => {
  const refusalOf = (filter: FilterCondition) => {
    try {
      compileScopedFilterToSql(filter, 't');
      return null;
    } catch (e) {
      return e as Error & { code?: string; status?: number };
    }
  };

  it('refuses the form fail-closed, and says where it is served and how to write it here', () => {
    const err = refusalOf(NESTED);
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'READ_SCOPE_COMPILE_FAILED', status: 500 });
    const message = String(err?.message);
    expect(message).toContain('"owner"');
    expect(message).toContain("The engine serves the form in a query's where");
    expect(message).toContain('reads the related object as the caller');
    expect(message).toContain('{ "owner": { "$in": [ID, …] } }');
  });

  it('CONTROL an empty or mixed value object keeps its own refusal — it is not the nested-relation form', () => {
    for (const filter of [{ owner: {} }, { owner: { $eq: 'u1', region: 'NA' } }] as FilterCondition[]) {
      const err = refusalOf(filter);
      expect(err?.code, JSON.stringify(filter)).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(String(err?.message), JSON.stringify(filter)).toContain('has a nested/relation value');
    }
  });
});
