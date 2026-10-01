// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20986] A relationship-path hop the cube declares no join for reads the
 * object its relationship field DECLARES as its target — the field's
 * `reference` — and every reader names that one object: the door's object
 * admission and read scope, its field gate, the native strategy's join and
 * the scope it applies to the joined alias, and the engine-aggregate
 * strategy's cross-object read.
 *
 * Before, such a hop fell back to its ALIAS, the relationship field's own
 * name. For a lookup named after its target that is the same object; for one
 * named differently (`owner` → a person object) it is not an object at all,
 * so the door admitted, and refused, the field's name as if it were one, and
 * the strategies joined and read a table of that name.
 *
 * The fixture's lookups, on the base object:
 *
 * | field | declared `reference` | role |
 * |:--|:--|:--|
 * | `owner` | the person object | named differently from its target |
 * | `parent` | the base object itself | a self-reference, also named differently |
 * | the same-named one | the object it is named after | the control |
 *
 * and `badge` on the person object, a second hop. The host's
 * `relationshipResolver` answers the declared reference, as
 * `AnalyticsServicePlugin`'s does from the data engine's object schema. An
 * authored cube that DECLARES a join for `owner` keeps it: only the no-join
 * fallback changed.
 *
 * The end-to-end form, over the real security layer and both strategies, is
 * the route pin `packages/rest/src/analytics-hop-object-reference.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';

const BASE = 'hr_ledger';
const PERSON = 'hr_person';
const BADGE = 'hr_badge';
const OTHER = 'hr_other';
const SAME = 'hr_same';

const CALLER = { userId: 'u_member', tenantId: 'org_a' } as ExecutionContext;

/** Each object's relationship fields and the object each one declares as its target. */
const REFERENCES: Record<string, Record<string, string>> = {
  [BASE]: { owner: PERSON, parent: BASE, [SAME]: SAME },
  [PERSON]: { badge: BADGE },
};

const count = { type: 'count', sql: '*', label: 'Count' };

/** An authored cube whose member walks `owner` without declaring a join for it. */
const AUTHORED = {
  name: 'hr_authored',
  title: 'Authored',
  sql: BASE,
  measures: { count },
  dimensions: { owner_region: { type: 'string', sql: 'owner.region', label: 'Region' } },
};

/** An authored cube that DECLARES its join for `owner`, to another object: tier 1 wins. */
const DECLARED = {
  name: 'hr_declared',
  title: 'Declared',
  sql: BASE,
  measures: { count },
  dimensions: { owner_region: { type: 'string', sql: 'owner.region', label: 'Region' } },
  joins: { owner: { name: OTHER } },
};

/** Every position a differently named lookup is reached through, and the object it reads. */
const POSITIONS: ReadonlyArray<readonly [label: string, query: AnalyticsQuery, object: string]> = [
  ['an inferred cube\'s dimension', { cube: BASE, measures: ['count'], dimensions: ['owner.region'] }, PERSON],
  ['an inferred cube\'s filter member', { cube: BASE, measures: ['count'], where: { 'owner.region': 'NA' } }, PERSON],
  [
    'an inferred cube\'s time-dimension window',
    { cube: BASE, measures: ['count'], timeDimensions: [{ dimension: 'owner.seen_at', dateRange: ['2026-01-01', '2026-01-31'] }] },
    PERSON,
  ],
  ['an authored dimension over an undeclared relationship', { cube: AUTHORED.name, measures: ['count'], dimensions: ['owner_region'] }, PERSON],
  ['the second hop of a two-hop path', { cube: BASE, measures: ['count'], dimensions: ['owner.badge.label'] }, BADGE],
] as never;

const STRATEGIES = [
  { label: 'NativeSQLStrategy', capabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }) },
  { label: 'ObjectQLStrategy', capabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) },
] as const;

interface Seen {
  admitted: string[];
  scoped: string[];
  fieldsAskedOf: string[];
  fieldMetaAskedOf: Array<readonly [string, string]>;
  sql: Array<{ sql: string; params: unknown[] }>;
  aggregate: Array<{ object: string; groupBy?: unknown; filter: unknown }>;
}

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

function makeService(
  capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean },
  opts: {
    denied?: string;
    scopeOf?: (object: string) => Record<string, unknown> | undefined;
    readableFieldsOf?: (object: string) => readonly string[] | undefined;
  } = {},
): { service: AnalyticsService; seen: Seen } {
  const seen: Seen = { admitted: [], scoped: [], fieldsAskedOf: [], fieldMetaAskedOf: [], sql: [], aggregate: [] };
  const service = new AnalyticsService({
    logger: quiet as never,
    cubes: [AUTHORED as never, DECLARED as never],
    queryCapabilities: capabilities,
    isRegisteredObject: (name: string) => name === BASE,
    relationshipResolver: (object: string, field: string) => REFERENCES[object]?.[field],
    admitObjectRead: (object: string) => {
      seen.admitted.push(object);
      return object !== opts.denied;
    },
    getReadScope: (async (object: string) => {
      seen.scoped.push(object);
      return opts.scopeOf?.(object);
    }) as never,
    getReadableFields: (object: string) => {
      seen.fieldsAskedOf.push(object);
      return opts.readableFieldsOf?.(object);
    },
    sourceFieldMeta: (object: string, field: string) => {
      seen.fieldMetaAskedOf.push([object, field]);
      return field === 'seen_at' ? { type: 'datetime' } : undefined;
    },
    executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
      seen.sql.push({ sql, params });
      return [{ 'owner.region': 'NA', 'parent.title': 't1', count: 2 }];
    },
    executeAggregate: async (object: string, options: { groupBy?: unknown; filter?: unknown }) => {
      seen.aggregate.push({ object, groupBy: options?.groupBy, filter: options?.filter });
      if (seen.aggregate.length === 1) return [{ owner: 'p1', parent: 'd1', count: 2 }];
      return [{ id: 'p1', region: 'NA', _c: 1 }, { id: 'd1', title: 't1', _c: 1 }];
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

describe('[#20986] a hop with no declared join reads the object its relationship field declares', () => {
  describe.each(STRATEGIES)('$label', ({ capabilities }) => {
    it.each(POSITIONS)('%s: a target object the caller may not read is refused, naming the target, before anything runs', async (_label, query, object) => {
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

    it('the field gate judges a hop\'s column on the target object', async () => {
      const { service, seen } = makeService(capabilities, {
        readableFieldsOf: (object) => (object === PERSON ? ['id', 'badge'] : undefined),
      });
      expect(await outcomeOf(() => service.query({ cube: BASE, measures: ['count'], dimensions: ['owner.region'] }, CALLER))).toEqual({
        refused: { code: 'PERMISSION_DENIED', status: 403, object: PERSON },
      });
      expect(seen.fieldsAskedOf).toContain(PERSON);
      expect(seen.fieldsAskedOf).not.toContain('owner');
      expect(seen.sql).toEqual([]);
      expect(seen.aggregate).toEqual([]);
    });

    it('the control: a lookup named after its target admits, and is refused as, that object', async () => {
      const query = { cube: BASE, measures: ['count'], dimensions: [`${SAME}.region`] } as AnalyticsQuery;
      expect(await outcomeOf(() => makeService(capabilities, { denied: SAME }).service.query(query, CALLER))).toEqual({
        refused: { code: 'PERMISSION_DENIED', status: 403, object: SAME },
      });
      const { service, seen } = makeService(capabilities);
      await service.generateSql(query, CALLER);
      expect([...new Set(seen.admitted)].sort()).toEqual([BASE, SAME].sort());
    });

    it('a join the cube declares is kept: its object is admitted, never the field\'s reference', async () => {
      const { service, seen } = makeService(capabilities);
      await service.generateSql({ cube: DECLARED.name, measures: ['count'], dimensions: ['owner_region'] }, CALLER);
      expect([...new Set(seen.admitted)].sort()).toEqual([BASE, OTHER].sort());
    });
  });

  it.each(POSITIONS)('%s: admission and the read scope are asked for one set, carrying the target and never the field\'s name', async (_label, query, object) => {
    const { service, seen } = makeService(STRATEGIES[0].capabilities);
    await service.generateSql(query, CALLER);
    expect(seen.admitted).toContain(object);
    expect(seen.admitted.filter((o) => o === 'owner' || o.startsWith('owner__'))).toEqual([]);
    expect([...seen.scoped].sort()).toEqual([...seen.admitted].sort());
  });

  it('a two-hop path resolves hop by hop through each field\'s declared reference', async () => {
    const { service, seen } = makeService(STRATEGIES[0].capabilities);
    await service.generateSql({ cube: BASE, measures: ['count'], dimensions: ['owner.badge.label'] }, CALLER);
    expect([...new Set(seen.admitted)].sort()).toEqual([BASE, PERSON, BADGE].sort());
  });

  it('NativeSQLStrategy joins the target object under the field\'s alias, and applies the target\'s read scope to it', async () => {
    const { service, seen } = makeService(STRATEGIES[0].capabilities, {
      scopeOf: (object) => (object === PERSON ? { tenant_id: 'org_a' } : undefined),
    });
    await service.query({ cube: BASE, measures: ['count'], dimensions: ['owner.region'] }, CALLER);
    expect(seen.sql).toHaveLength(1);
    expect(seen.sql[0].sql).toContain(`LEFT JOIN "${PERSON}" "owner" ON "${BASE}"."owner" = "owner"."id"`);
    expect(seen.sql[0].sql).toContain('"owner"."tenant_id" = $');
    expect(seen.sql[0].params).toContain('org_a');
  });

  it('NativeSQLStrategy asks the declared column type of the target object', async () => {
    const { service, seen } = makeService(STRATEGIES[0].capabilities);
    await service.query({ cube: BASE, measures: ['count'], where: { 'owner.seen_at': { $lte: '2026-01-31' } } } as AnalyticsQuery, CALLER);
    expect(seen.fieldMetaAskedOf).toContainEqual([PERSON, 'seen_at']);
    expect(seen.fieldMetaAskedOf.filter(([object]) => object === 'owner')).toEqual([]);
  });

  it('ObjectQLStrategy reads the related value from the target object, under the target\'s read scope', async () => {
    const { service, seen } = makeService(STRATEGIES[1].capabilities, {
      scopeOf: (object) => (object === PERSON ? { tenant_id: 'org_a' } : undefined),
    });
    const result = await service.query({ cube: BASE, measures: ['count'], dimensions: ['owner.region'] }, CALLER);
    expect(seen.aggregate.map((a) => a.object)).toEqual([BASE, PERSON]);
    expect(JSON.stringify(seen.aggregate[1].filter)).toContain('"tenant_id":"org_a"');
    expect(result.rows).toEqual([{ 'owner.region': 'NA', count: 2 }]);
  });

  describe('a self-reference — a lookup to the base object itself, named differently from it', () => {
    const query = { cube: BASE, measures: ['count'], dimensions: ['parent.title'] } as AnalyticsQuery;

    it('admits the base object alone', async () => {
      const { service, seen } = makeService(STRATEGIES[0].capabilities);
      await service.generateSql(query, CALLER);
      expect([...new Set(seen.admitted)]).toEqual([BASE]);
    });

    it('NativeSQLStrategy joins the base object under the field\'s alias', async () => {
      const { service, seen } = makeService(STRATEGIES[0].capabilities);
      await service.query(query, CALLER);
      expect(seen.sql[0].sql).toContain(`LEFT JOIN "${BASE}" "parent" ON "${BASE}"."parent" = "parent"."id"`);
    });

    it('ObjectQLStrategy still reads it as a cross-object hop, from the base object', async () => {
      const { service, seen } = makeService(STRATEGIES[1].capabilities);
      const result = await service.query(query, CALLER);
      expect(seen.aggregate.map((a) => a.object)).toEqual([BASE, BASE]);
      expect(seen.aggregate[0].groupBy).toEqual(['parent']);
      expect(result.rows).toEqual([{ 'parent.title': 't1', count: 2 }]);
    });
  });
});
