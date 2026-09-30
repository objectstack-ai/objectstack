// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20933] An object a query reads through a RELATIONSHIP PATH belongs to the
 * one object set the analytics door admits and row-scopes, so it is admitted
 * and scoped exactly as the base object and a declared join are.
 *
 * The door asks two questions over one set, `AnalyticsService.queryObjects`:
 * the object-level read admission, and the read scope each strategy applies to
 * the objects it reads. A declared join (`cube.joins`, a dataset's `include`)
 * was always in that set. A path the cube does not declare — a dotted member
 * of an inferred cube, an authored member whose `sql` walks a relationship the
 * cube never lists, a dotted member the query names itself — was not, although
 * both strategies read the object at its end: `NativeSQLStrategy` joins it and
 * `ObjectQLStrategy` reads it to resolve the related value.
 *
 * Each hop's object is resolved as PR #20931's field gate resolves it — the
 * cube's join keyed by the path with its dots as `__`, falling back to the
 * alias itself — because that is the object both strategies read there. The
 * two-hop case below keys only its second hop, so one path exercises both
 * arms.
 *
 * What is pinned, for every position and on both strategies:
 * - a related object the caller may not read is refused, by name, before any
 *   statement runs;
 * - the set admission asks for and the set the read scope is resolved for are
 *   the same set, and it carries the path's object;
 * - the related object's read scope reaches what each strategy executes, and
 *   a scope `NativeSQLStrategy` cannot compile routes the query to the engine
 *   path as a declared join's does;
 * - the control: a readable related object is answered.
 *
 * The end-to-end form, over the real security layer, is the route pin
 * `packages/rest/src/analytics-relationship-path-admission.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';

const BASE = 'rp_ledger';
const RELATED = 'rp_related';
const HOP = 'rp_hop';
const LEAF = 'rp_leaf';

const CALLER = { userId: 'u_member', tenantId: 'org_a' } as ExecutionContext;

/** An authored cube whose members walk a relationship it does not declare. */
const AUTHORED = {
  name: 'rp_authored',
  title: 'Authored',
  sql: BASE,
  measures: {
    count: { type: 'count', sql: '*', label: 'Count' },
    related_total: { type: 'sum', sql: `${RELATED}.amount`, label: 'Total' },
  },
  dimensions: {
    title: { type: 'string', sql: 'title', label: 'Title' },
    related_label: { type: 'string', sql: `${RELATED}.label`, label: 'Label' },
  },
};

/** A two-hop path whose second hop is keyed and whose first falls back to its alias. */
const TWO_HOP = {
  name: 'rp_two_hop',
  title: 'Two hop',
  sql: BASE,
  measures: { count: { type: 'count', sql: '*', label: 'Count' } },
  dimensions: { leaf_label: { type: 'string', sql: `${HOP}.${LEAF}.label`, label: 'Leaf' } },
  joins: { [`${HOP}__${LEAF}`]: { name: LEAF } },
};

/** The same relationship, declared: the reference a path must answer like. */
const VIA_RELATED = {
  name: 'rp_via_related',
  title: 'Via related',
  sql: BASE,
  measures: { count: { type: 'count', sql: '*', label: 'Count' } },
  dimensions: { related_label: { type: 'string', sql: `${RELATED}.label`, label: 'Label' } },
  joins: { [RELATED]: { name: RELATED } },
};

/** Every position a relationship path reaches the query through, and the object it reads. */
const POSITIONS: ReadonlyArray<readonly [label: string, query: AnalyticsQuery, object: string]> = [
  ['an inferred cube\'s dimension', { cube: BASE, measures: ['count'], dimensions: [`${RELATED}.label`] }, RELATED],
  ['an inferred cube\'s filter member', { cube: BASE, measures: ['count'], where: { [`${RELATED}.label`]: 'l_one' } }, RELATED],
  [
    'an inferred cube\'s time-dimension window',
    { cube: BASE, measures: ['count'], timeDimensions: [{ dimension: `${RELATED}.seen_at`, dateRange: ['2026-01-01', '2026-01-31'] }] },
    RELATED,
  ],
  ['an authored dimension over an undeclared relationship', { cube: AUTHORED.name, measures: ['count'], dimensions: ['related_label'] }, RELATED],
  ['an authored measure over an undeclared relationship', { cube: AUTHORED.name, measures: ['related_total'] }, RELATED],
  ['a path the query names on an authored cube', { cube: AUTHORED.name, measures: ['count'], dimensions: [`${RELATED}.label`] }, RELATED],
  ['the first hop of a two-hop path', { cube: TWO_HOP.name, measures: ['count'], dimensions: ['leaf_label'] }, HOP],
] as never;

const STRATEGIES = [
  { label: 'NativeSQLStrategy', capabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }) },
  { label: 'ObjectQLStrategy', capabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) },
] as const;

/** A driver both strategies can serve, so the native strategy's decline has somewhere to route. */
const BOTH = () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false });

interface Seen {
  admitted: string[];
  scoped: string[];
  sql: Array<{ sql: string; params: unknown[] }>;
  aggregate: Array<{ object: string; filter: unknown }>;
}

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

function makeService(
  capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean },
  opts: { denied?: string; scopeOf?: (object: string) => Record<string, unknown> | undefined },
): { service: AnalyticsService; seen: Seen } {
  const seen: Seen = { admitted: [], scoped: [], sql: [], aggregate: [] };
  const service = new AnalyticsService({
    logger: quiet as never,
    cubes: [AUTHORED as never, TWO_HOP as never, VIA_RELATED as never],
    queryCapabilities: capabilities,
    isRegisteredObject: (name: string) => name === BASE,
    admitObjectRead: (object: string) => {
      seen.admitted.push(object);
      return object !== opts.denied;
    },
    getReadScope: (async (object: string) => {
      seen.scoped.push(object);
      return opts.scopeOf?.(object);
    }) as never,
    executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
      seen.sql.push({ sql, params });
      return [{ [`${RELATED}.label`]: 'l_one', related_label: 'l_one', leaf_label: 'f_one', count: 2, related_total: 5 }];
    },
    executeAggregate: async (object: string, options: { filter?: unknown }) => {
      seen.aggregate.push({ object, filter: options?.filter });
      if (object === BASE) return [{ [RELATED]: 'r1', count: 2 }];
      return [{ id: 'r1', label: 'l_one', _c: 1 }];
    },
  } as never);
  return { service, seen };
}

/** The refusal's envelope and the object it names, or the answer. */
const outcomeOf = (run: () => Promise<object>) =>
  run().then(
    (r) => ({ answered: (r as { rows?: unknown }).rows }),
    (e: { code?: string; status?: number; object?: string }) => ({ refused: { code: e?.code, status: e?.status, object: e?.object } }),
  );

describe('[#20933] an object read through a relationship path is admitted and scoped as a declared join is', () => {
  describe.each(STRATEGIES)('$label', ({ capabilities }) => {
    it.each(POSITIONS)('%s: a related object the caller may not read is refused by name before anything runs', async (_label, query, object) => {
      const { service, seen } = makeService(capabilities, { denied: object });
      expect(await outcomeOf(() => service.query(query, CALLER))).toEqual({
        refused: { code: 'PERMISSION_DENIED', status: 403, object },
      });
      expect(await outcomeOf(() => service.generateSql(query, CALLER))).toEqual({
        refused: { code: 'PERMISSION_DENIED', status: 403, object },
      });
      expect(seen.sql).toEqual([]);
      expect(seen.aggregate).toEqual([]);
    });

    it('the control: a readable related object is answered', async () => {
      const { service } = makeService(capabilities, {});
      const result = await service.query({ cube: BASE, measures: ['count'], dimensions: [`${RELATED}.label`] }, CALLER);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ [`${RELATED}.label`]: 'l_one', count: 2 });
    });
  });

  it.each(POSITIONS)('%s: admission and the read scope are asked for one set, and it carries the path\'s object', async (_label, query, object) => {
    const { service, seen } = makeService(STRATEGIES[0].capabilities, {});
    await service.generateSql(query, CALLER);
    expect(seen.admitted).toContain(BASE);
    expect(seen.admitted).toContain(object);
    expect([...seen.scoped].sort()).toEqual([...seen.admitted].sort());
  });

  it('a two-hop path resolves hop by hop: the alias it falls back to, then the join it is keyed by', async () => {
    const { service, seen } = makeService(STRATEGIES[0].capabilities, {});
    await service.generateSql({ cube: TWO_HOP.name, measures: ['count'], dimensions: ['leaf_label'] }, CALLER);
    expect([...seen.admitted].sort()).toEqual([BASE, HOP, LEAF].sort());
  });

  it('NativeSQLStrategy: the related object\'s read scope is applied to the join it reads', async () => {
    const { service, seen } = makeService(STRATEGIES[0].capabilities, {
      scopeOf: (object) => (object === RELATED ? { tenant_id: 'org_a' } : undefined),
    });
    await service.query({ cube: BASE, measures: ['count'], dimensions: [`${RELATED}.label`] }, CALLER);
    expect(seen.sql).toHaveLength(1);
    expect(seen.sql[0].sql).toContain(`LEFT JOIN "${RELATED}"`);
    expect(seen.sql[0].sql).toContain(`"${RELATED}"."tenant_id" = $`);
    expect(seen.sql[0].params).toContain('org_a');
  });

  it('ObjectQLStrategy: the related object\'s read scope is applied to the read that resolves the related value', async () => {
    const { service, seen } = makeService(STRATEGIES[1].capabilities, {
      scopeOf: (object) => (object === RELATED ? { tenant_id: 'org_a' } : undefined),
    });
    await service.query({ cube: BASE, measures: ['count'], dimensions: [`${RELATED}.label`] }, CALLER);
    const related = seen.aggregate.filter((a) => a.object === RELATED);
    expect(related).toHaveLength(1);
    expect(JSON.stringify(related[0].filter)).toContain('"tenant_id":"org_a"');
  });

  it('NativeSQLStrategy declines a query whose related object\'s read scope carries a field reference, as it does for a declared join', async () => {
    const referenceScope = (object: string) => (object === RELATED ? { label: { $eq: { $field: 'alt_label' } } } : undefined);
    const served = async (query: AnalyticsQuery) => {
      const { service, seen } = makeService(BOTH, { scopeOf: referenceScope });
      const outcome = await outcomeOf(() => service.query(query, CALLER));
      return { answered: 'answered' in outcome, native: seen.sql.length, engine: seen.aggregate.map((a) => a.object) };
    };
    const declared = await served({ cube: VIA_RELATED.name, measures: ['count'], dimensions: ['related_label'] });
    expect(declared).toEqual({ answered: true, native: 0, engine: [BASE, RELATED] });
    expect(await served({ cube: BASE, measures: ['count'], dimensions: [`${RELATED}.label`] })).toEqual(declared);
  });
});
