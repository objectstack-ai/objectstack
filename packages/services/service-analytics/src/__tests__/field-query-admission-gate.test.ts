// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20935] READABLE IS NOT QUERYABLE — the query-side half of the field-level
 * gate at the analytics door.
 *
 * Every member an analytics query names is a query position: a group key, an
 * aggregate input, a filter or a sort key. A field the caller is served MASKED
 * is readable (its key stays in the row, its value replaced), so the read
 * projection alone admits it — and as a group key it would hand back the
 * unmasked value, as a filter it rebuilds the masked span. The gate therefore
 * asks a second reader beside the read projection
 * (`AnalyticsServiceConfig.getQueryableFields`; the plugin bridges it to the
 * `security` service's `getQueryableFields`) and admits a member only when both
 * carry its field. Every refusal below runs through both strategy paths from
 * one table, and asserts that nothing executed.
 *
 * The plugin half pins the bridge's fail direction: a security service that
 * cannot give this answer — it predates the method, or it answers `undefined` —
 * leaves every field that declares a `maskingRule` NOT queryable, never open.
 *
 * The route-level half, over the real `SecurityPlugin`, `ObjectQL` and
 * `SqlDriver`, compares each refusal with the engine's own answer:
 * `packages/rest/src/analytics-masked-field-gate.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const LEDGER = 'fq_ledger';
const OWNER = 'fq_owner';

/** Each object's declared fields; `masked_code` / `masked_region` declare a masking rule. */
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  [LEDGER]: ['title', 'masked_code', 'owner'],
  [OWNER]: ['region', 'masked_region'],
};
const MASKED: Readonly<Record<string, readonly string[]>> = {
  [LEDGER]: ['masked_code'],
  [OWNER]: ['masked_region'],
};

/** The read projection: the masked fields are SERVED (masked), so they are readable. */
const READABLE: Readonly<Record<string, readonly string[]>> = {
  [LEDGER]: ['id', 'title', 'masked_code', 'owner'],
  [OWNER]: ['id', 'region', 'masked_region'],
};
/** The query answer for a caller the rules apply to: the masked fields are not in it. */
const QUERYABLE: Readonly<Record<string, readonly string[]>> = {
  [LEDGER]: ['id', 'title', 'owner'],
  [OWNER]: ['id', 'region'],
};

/** An authored cube: aliases over the masked fields, and a declared join to the owner. */
const AUTHORED: Cube = {
  name: 'fq_authored',
  title: 'Authored ledger',
  sql: LEDGER,
  public: true,
  measures: { count: { type: 'count', sql: '*', label: 'Count' } },
  dimensions: {
    title: { type: 'string', sql: 'title', label: 'Title' },
    alias_code: { type: 'string', sql: 'masked_code', label: 'Code' },
    alias_owner_region: { type: 'string', sql: 'owner.masked_region', label: 'Owner region' },
  },
  joins: { owner: { name: OWNER } },
} as Cube;

const CALLER = { userId: 'u_member', tenantId: 'org_a' } as ExecutionContext;
const SYSTEM = { isSystem: true } as ExecutionContext;

const nativeSqlOnly = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

const STRATEGY_PATHS = [
  { label: 'NativeSQLStrategy', capabilities: nativeSqlOnly },
  { label: 'ObjectQLStrategy', capabilities: objectqlOnly },
] as const;

type FieldsReader = (object: string, context?: ExecutionContext) =>
  readonly string[] | undefined | Promise<readonly string[] | undefined>;

function makeService(opts: {
  capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean };
  getQueryableFields?: FieldsReader;
  logger?: Record<string, unknown>;
}) {
  const executed: string[] = [];
  const service = new AnalyticsService({
    cubes: [AUTHORED],
    queryCapabilities: opts.capabilities,
    getReadableFields: (object: string) => READABLE[object],
    getQueryableFields: opts.getQueryableFields,
    getObjectFieldNames: (object: string) => FIELDS[object],
    ...(opts.logger ? { logger: opts.logger as never } : {}),
    executeRawSql: async (object: string, sql: string) => {
      executed.push(`sql:${object}:${sql}`);
      return [];
    },
    executeAggregate: async (object: string) => {
      executed.push(`aggregate:${object}`);
      return [];
    },
  } as never);
  return { service, executed };
}

/** The first sentence of each of the engine's two refusals — the words it answers a masked field with. */
const aggregateSentence = (object: string, fields: string[]) =>
  `[Security] Field read denied: not permitted to aggregate [${fields.join(', ')}] on '${object}'`;
const predicateSentence = (object: string, fields: string[]) =>
  `[Security] Access denied: query on '${object}' references field(s) not readable by the caller: ${fields.join(', ')}.`;

interface RefusalCase {
  label: string;
  query: Record<string, unknown>;
  role: 'aggregate' | 'predicate';
  object: string;
  field: string;
}

const REFUSED: readonly RefusalCase[] = [
  { label: 'a masked field as a group member', query: { cube: LEDGER, measures: ['count'], dimensions: ['masked_code'] }, role: 'aggregate', object: LEDGER, field: 'masked_code' },
  { label: 'a masked field as a filter member', query: { cube: LEDGER, measures: ['count'], where: { masked_code: 'x' } }, role: 'predicate', object: LEDGER, field: 'masked_code' },
  { label: 'a masked field as an order key', query: { cube: LEDGER, measures: ['count'], dimensions: ['title'], order: { masked_code: 'asc' } }, role: 'predicate', object: LEDGER, field: 'masked_code' },
  { label: 'an authored alias over a masked field as a group member', query: { cube: 'fq_authored', measures: ['count'], dimensions: ['alias_code'] }, role: 'aggregate', object: LEDGER, field: 'masked_code' },
  { label: 'a joined masked field as a group member', query: { cube: 'fq_authored', measures: ['count'], dimensions: ['alias_owner_region'] }, role: 'aggregate', object: OWNER, field: 'masked_region' },
  { label: 'a joined masked field as a filter member', query: { cube: 'fq_authored', measures: ['count'], where: { 'owner.masked_region': 'r' } }, role: 'predicate', object: OWNER, field: 'masked_region' },
];

async function refusalOf(run: () => Promise<unknown>) {
  return run().then(() => null, (e: unknown) => e as Record<string, unknown>);
}

describe('[#20935] analytics — a field the caller is served masked is readable and NOT queryable', () => {
  describe.each(STRATEGY_PATHS)('$label', ({ capabilities }) => {
    it.each(REFUSED)('$label: refused PERMISSION_DENIED / 403 in the engine\'s words, before any strategy ran', async ({ query, role, object, field }) => {
      const { service, executed } = makeService({ capabilities, getQueryableFields: (o) => QUERYABLE[o] });
      const sentence = role === 'aggregate' ? aggregateSentence(object, [field]) : predicateSentence(object, [field]);
      for (const run of [() => service.query(query as never, CALLER), () => service.generateSql(query as never, CALLER)]) {
        const refusal = await refusalOf(run);
        expect(refusal).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object, fields: [field] });
        expect(String(refusal?.message).startsWith(sentence), String(refusal?.message)).toBe(true);
      }
      expect(executed).toEqual([]);
    });

    it('the control: a reader the rules do not apply to is served the same members, and the queryable reader is asked with the caller\'s context', async () => {
      const getQueryableFields = vi.fn((object: string, _context?: ExecutionContext) => READABLE[object]);
      const { service, executed } = makeService({ capabilities, getQueryableFields });
      await service.query({ cube: 'fq_authored', measures: ['count'], dimensions: ['alias_code', 'alias_owner_region'], where: { alias_code: 'x' } } as never, CALLER);
      expect(executed.length).toBeGreaterThan(0);
      expect(getQueryableFields.mock.calls.map((c) => c[0]).sort()).toEqual([LEDGER, OWNER]);
      for (const call of getQueryableFields.mock.calls) expect(call[1]).toBe(CALLER);
    });

    it('fails closed: a queryable reader that throws refuses the query, and says so in the error log', async () => {
      const error = vi.fn();
      const logger = { debug() {}, info() {}, warn() {}, error, child() { return logger; } };
      const { service, executed } = makeService({
        capabilities,
        getQueryableFields: () => { throw new Error('reader unavailable'); },
        logger,
      });
      await expect(
        service.query({ cube: LEDGER, measures: ['count'], dimensions: ['title'] } as never, CALLER),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: LEDGER });
      expect(executed).toEqual([]);
      expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/field-level read admission could not be resolved .*\(fail-closed\)/);
    });

    it('each reader is judged on its own: a queryable "no answer" leaves the read verdict intact', async () => {
      const { service, executed } = makeService({ capabilities, getQueryableFields: () => undefined });
      await service.query({ cube: LEDGER, measures: ['count'], dimensions: ['title'] } as never, CALLER);
      expect(executed.length).toBeGreaterThan(0);
    });
  });

  it('says so once, at construction, when the read reader is wired without the queryable one', () => {
    const warn = vi.fn();
    const logger = { debug() {}, info() {}, warn, error() {}, child() { return logger; } };
    makeService({ capabilities: nativeSqlOnly, logger });
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/getReadableFields is configured without getQueryableFields/);
    const quiet = vi.fn();
    const both = { debug() {}, info() {}, warn: quiet, error() {}, child() { return both; } };
    makeService({ capabilities: nativeSqlOnly, getQueryableFields: (o) => QUERYABLE[o], logger: both });
    expect(quiet.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/getQueryableFields/);
  });
});

// ── The plugin's bridge to the `security` service ─────────────────────────────

function fakeEngine() {
  const reads: string[] = [];
  return {
    reads,
    engine: {
      execute: async (_sql: unknown, options?: { object?: string }) => {
        reads.push(`execute:${options?.object ?? ''}`);
        return { rows: [] };
      },
      aggregate: async (object: string) => {
        reads.push(`aggregate:${object}`);
        return [];
      },
      // The registry's declarations: the masked fields carry a `maskingRule`.
      // [#21080] The engine this double models answers which objects carry a
      // middleware registered for them; none of this file's objects does.
      hasObjectMiddleware: () => false,
      getObject: (name: string) =>
        FIELDS[name]
          ? {
            fields: Object.fromEntries(FIELDS[name].map((f) => [
              f,
              f === 'owner'
                ? { type: 'lookup', reference: OWNER }
                : MASKED[name].includes(f) ? { type: 'text', maskingRule: 'name' } : { type: 'text' },
            ])),
          }
          : undefined,
      resolveEffectiveDatasource: () => undefined,
    },
  };
}

async function bootPlugin(security?: () => unknown) {
  const { engine, reads } = fakeEngine();
  const registered: Record<string, unknown> = {};
  const error = vi.fn();
  const ctx = {
    getService: (name: string) => {
      if (name === 'security') return security ? security() : undefined;
      if (name === 'data') return engine;
      return registered[name];
    },
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: { info() {}, warn() {}, error, debug() {} },
  };
  await new AnalyticsServicePlugin({ cubes: [AUTHORED], queryCapabilities: nativeSqlOnly }).init(ctx as never);
  return { service: registered.analytics as AnalyticsService, reads, error };
}

/** The object-level and row-level halves of a working security service, and its read projection. */
const readHalves = {
  getReadFilter: async () => undefined,
  canReadObject: async () => true,
  getReadableFields: async (object: string, context?: ExecutionContext) =>
    (context?.isSystem ? ['id', ...FIELDS[object]] : READABLE[object]),
};
const groupedMasked = { cube: LEDGER, measures: ['count'], dimensions: ['masked_code'] };
const filteredMasked = { cube: LEDGER, measures: ['count'], where: { masked_code: 'x' } };
const groupedPlain = { cube: LEDGER, measures: ['count'], dimensions: ['title'] };

describe('[#20935] analytics plugin — the query-side half of the "security" bridge', () => {
  it('asks the security service\'s getQueryableFields with the caller\'s context: a masked member is refused, a plain one served', async () => {
    const getQueryableFields = vi.fn(async (object: string) => QUERYABLE[object]);
    const { service, reads } = await bootPlugin(() => ({ ...readHalves, getQueryableFields }));
    for (const query of [groupedMasked, filteredMasked]) {
      await expect(service.query(query as never, CALLER)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: LEDGER, fields: ['masked_code'] });
    }
    expect(reads).toEqual([]);
    expect(getQueryableFields).toHaveBeenCalledWith(LEDGER, CALLER);
    await service.query(groupedPlain as never, CALLER);
    expect(reads).toHaveLength(1);
  });

  it('serves a caller the security service reports the rule lifted for — the bridge adds no rule of its own', async () => {
    const { service, reads } = await bootPlugin(() => ({ ...readHalves, getQueryableFields: async (object: string) => READABLE[object] }));
    await service.query(groupedMasked as never, CALLER);
    await service.query(filteredMasked as never, CALLER);
    expect(reads).toHaveLength(2);
  });

  it('fails CLOSED for a security service that predates getQueryableFields: every field declaring a masking rule is not queryable', async () => {
    const { service, reads } = await bootPlugin(() => ({ ...readHalves }));
    for (const query of [groupedMasked, filteredMasked, { cube: 'fq_authored', measures: ['count'], dimensions: ['alias_owner_region'] }]) {
      await expect(service.query(query as never, CALLER)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    }
    expect(reads).toEqual([]);
    // A field that declares no rule is judged by the read projection alone, as before.
    await service.query(groupedPlain as never, CALLER);
    expect(reads).toHaveLength(1);
    // The fallback reads no caller property — it cannot say for whom a rule is
    // lifted — so it refuses every caller, a system one included.
    await expect(service.query(groupedMasked as never, SYSTEM)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, fields: ['masked_code'] });
    expect(reads).toHaveLength(1);
  });

  it('fails CLOSED the same way when getQueryableFields answers "no answer" (undefined)', async () => {
    const { service, reads } = await bootPlugin(() => ({ ...readHalves, getQueryableFields: async () => undefined }));
    await expect(service.query(groupedMasked as never, CALLER)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, fields: ['masked_code'] });
    expect(reads).toEqual([]);
  });

  it('applies no field-level gate when no security service is registered at all', async () => {
    const { service, reads } = await bootPlugin(undefined);
    await service.query(groupedMasked as never, CALLER);
    expect(reads).toHaveLength(1);
  });
});
