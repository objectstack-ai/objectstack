// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The analytics door honours the two declarations every other generic exit
 * honours: an object's `enable` block (`apiEnabled: false`, and a whitelist
 * that does not grant the aggregate verb) and a field's `internal: true`.
 *
 * ## The two facets
 *
 * - **Object.** The door asks the spec's one exposure decision,
 *   `apiExposureDenialReason(enable, 'aggregate')`, for every object a query
 *   reads — the base object, a declared join, a relationship hop — and refuses
 *   with the code and status the data door answers for the same declaration:
 *   `404 OBJECT_API_DISABLED`, `405 OBJECT_API_METHOD_NOT_ALLOWED`.
 * - **Field.** A member that reads a field declared `internal: true` — as a
 *   dimension (the group key), a measure's input, a filter operand, a dataset
 *   filter or a relationship hop's column — is refused `400 INVALID_FIELD`,
 *   naming the object and the field. Every analytics member is EVALUATED, never
 *   projected, so the data door's row-path answer (omit the column) has no
 *   analytics equivalent; the data door's own aggregate face refuses the same
 *   field as a group key for the same reason.
 *
 * ## The shape these cases are written to catch
 *
 * Both facets bind every caller, so each refusal runs for a member and an
 * administrator, each granted read on every object and field (the security
 * double below admits everything), and on BOTH strategies: the native-SQL path
 * that reads the database with no engine in front of it, and the ObjectQL path.
 * Each refusal also proves nothing reached the database for the object, and
 * that an ad-hoc refusal leaves the cube registry as it was.
 *
 * The controls are the ones a lazy fix loses: an ordinary object and an
 * ordinary column are served exactly as before, and an object that merely HAS
 * an internal field is still served for every other member.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsServicePlugin } from '../plugin.js';
import { AnalyticsService } from '../analytics-service.js';

const HIDDEN = 'exposure_hidden';
const NO_LIST = 'exposure_nolist';
const VAULT = 'exposure_vault';
const LEDGER = 'exposure_ledger';
const OPEN = 'exposure_open';

const text = (name: string, extra: Record<string, unknown> = {}) => ({ name, type: 'text' as const, ...extra });

/** Declared off: the data door answers 404 OBJECT_API_DISABLED for every verb. */
const HIDDEN_OBJECT = {
  name: HIDDEN,
  label: 'Hidden',
  enable: { apiEnabled: false, apiMethods: [] },
  fields: { title: text('title'), region: text('region') },
};
/** Exposed, but its whitelist grants `get` only: the aggregate verb is not served. */
const NO_LIST_OBJECT = {
  name: NO_LIST,
  label: 'No list',
  enable: { apiMethods: ['get'] },
  fields: { title: text('title'), region: text('region') },
};
/** Exposed, with one column declared `internal: true`. */
const VAULT_OBJECT = {
  name: VAULT,
  label: 'Vault',
  fields: { title: text('title'), region: text('region'), digest: text('digest', { internal: true }) },
};
/** Exposed, with lookups into the vault and into the hidden object (the relationship-hop cases). */
const LEDGER_OBJECT = {
  name: LEDGER,
  label: 'Ledger',
  fields: {
    title: text('title'),
    vault_ref: { name: 'vault_ref', type: 'lookup' as const, reference: VAULT },
    hidden_ref: { name: 'hidden_ref', type: 'lookup' as const, reference: HIDDEN },
  },
};
/** The ordinary control. */
const OPEN_OBJECT = {
  name: OPEN,
  label: 'Open',
  fields: { title: text('title'), region: text('region') },
};

const ROWS: Record<string, Array<Record<string, unknown>>> = {
  [HIDDEN]: [
    { id: 'h1', title: 'a', region: 'west' },
    { id: 'h2', title: 'b', region: 'east' },
  ],
  [NO_LIST]: [{ id: 'n1', title: 'a', region: 'west' }],
  [VAULT]: [
    { id: 'v1', title: 'a', region: 'west', digest: 'stored-one' },
    { id: 'v2', title: 'b', region: 'west', digest: 'stored-two' },
    { id: 'v3', title: 'c', region: 'east', digest: 'stored-three' },
  ],
  [LEDGER]: [
    { id: 'l1', title: 'a', vault_ref: 'v1', hidden_ref: 'h1' },
    { id: 'l2', title: 'b', vault_ref: 'v3', hidden_ref: 'h2' },
  ],
  [OPEN]: [
    { id: 'o1', title: 'a', region: 'west' },
    { id: 'o2', title: 'b', region: 'west' },
    { id: 'o3', title: 'c', region: 'east' },
  ],
};

/** Configured cubes — the authored cube door over each subject. */
const CUBES = [
  {
    name: 'hidden_cube',
    title: 'Hidden cube',
    sql: HIDDEN,
    public: true,
    measures: { rows: { label: 'Rows', type: 'count' as const, sql: '*' } },
    dimensions: { region: { label: 'Region', type: 'string' as const, sql: 'region' } },
  },
  {
    name: 'nolist_cube',
    title: 'No-list cube',
    sql: NO_LIST,
    public: true,
    measures: { rows: { label: 'Rows', type: 'count' as const, sql: '*' } },
    dimensions: {},
  },
  {
    name: 'vault_cube',
    title: 'Vault cube',
    sql: VAULT,
    public: true,
    measures: { rows: { label: 'Rows', type: 'count' as const, sql: '*' } },
    dimensions: {
      region: { label: 'Region', type: 'string' as const, sql: 'region' },
      sealed: { label: 'Sealed', type: 'string' as const, sql: 'digest' },
    },
  },
];

const dataset = (name: string, object: string, extra: Record<string, unknown> = {}) =>
  DatasetSchema.parse({
    name,
    label: name,
    object,
    dimensions: [],
    measures: [{ name: 'row_count', label: 'Rows', aggregate: 'count' }],
    ...extra,
  });

const quiet: any = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

/** Grants every caller read on every object and every field, the internal one included. */
const grantEverything = (engine: ObjectQL) => {
  const fieldsOf = async (object: string) => Object.keys(engine.registry.getObject(object)?.fields ?? {});
  return {
    canReadObject: async () => true,
    getReadableFields: fieldsOf,
    getQueryableFields: fieldsOf,
    getReadFilter: async () => undefined,
  };
};

const PERSONAS: ReadonlyArray<{ label: string; context: ExecutionContext }> = [
  { label: 'a member granted read', context: { userId: 'u_member', permissions: ['member_default'] } as ExecutionContext },
  {
    label: 'an administrator',
    context: {
      userId: 'u_admin',
      permissions: ['admin_full_access'],
      systemPermissions: ['view_all_data', 'modify_all_data', 'manage_platform_settings'],
    } as ExecutionContext,
  },
];

const STRATEGIES = [
  { label: 'native SQL', capabilities: undefined },
  {
    label: 'ObjectQL',
    capabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
  },
] as const;

interface Refusal extends Error {
  code?: string;
  status?: number;
  object?: string;
  field?: string;
}

/** The error a call rejected with — and a loud failure if it resolved. */
async function rejection(call: () => unknown): Promise<Refusal> {
  let resolved: unknown;
  try {
    resolved = await call();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, got ${JSON.stringify(resolved)}`);
}

const pick = (e: Refusal) => ({ code: e.code, status: e.status, object: e.object, ...(e.field ? { field: e.field } : {}) });

describe.each(STRATEGIES)('the analytics door honours the generic-exit declarations — $label strategy', ({ capabilities }) => {
  let engine: ObjectQL;
  let service: AnalyticsService;
  /** Every database read, by object, whichever strategy issued it. */
  const reads = new Map<string, number>();
  const readsOf = (object: string) => reads.get(object) ?? 0;
  const snapshot = () => new Map(reads);
  const readSince = (before: Map<string, number>, object: string) => readsOf(object) - (before.get(object) ?? 0);

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL({ logger: quiet } as any);
    engine.registerDriver(driver, true);
    await engine.init();
    for (const obj of [HIDDEN_OBJECT, NO_LIST_OBJECT, VAULT_OBJECT, LEDGER_OBJECT, OPEN_OBJECT]) {
      engine.registry.registerObject(obj as any);
    }
    await engine.syncSchemas();
    for (const [object, rows] of Object.entries(ROWS)) {
      for (const row of rows) await engine.insert(object, { ...row } as any);
    }

    const realExecute = (engine as any).execute.bind(engine);
    (engine as any).execute = (sql: unknown, opts?: { object?: string }) => {
      const object = opts?.object;
      if (object) reads.set(object, readsOf(object) + 1);
      return realExecute(sql, opts);
    };
    const realAggregate = engine.aggregate.bind(engine);
    (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
      reads.set(object, readsOf(object) + 1);
      return (realAggregate as any)(object, ...rest);
    };

    const security = grantEverything(engine);
    const registered: Record<string, unknown> = {};
    await new AnalyticsServicePlugin({
      cubes: CUBES as any,
      ...(capabilities ? { queryCapabilities: capabilities } : {}),
    }).init({
      getService: (name: string) => (name === 'data' ? engine : name === 'security' ? security : registered[name]),
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      hook: () => {},
      logger: quiet,
    } as never);
    service = registered.analytics as AnalyticsService;
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  describe.each(PERSONAS)('as $label', ({ context }) => {
    // ── The object facet ────────────────────────────────────────────────
    it('an `apiEnabled: false` object is refused 404 OBJECT_API_DISABLED on every door, and nothing reads it', async () => {
      const before = snapshot();
      const calls: Array<[string, () => unknown]> = [
        ['ad-hoc query', () => service.query({ cube: HIDDEN, measures: ['count'] }, context)],
        ['ad-hoc query, grouped', () => service.query({ cube: HIDDEN, measures: ['count'], dimensions: ['region'] }, context)],
        ['SQL face', () => service.generateSql({ cube: HIDDEN, measures: ['count'] }, context)],
        ['configured cube', () => service.query({ cube: 'hidden_cube', measures: ['rows'], dimensions: ['region'] }, context)],
        ['dataset door', () => service.queryDataset(dataset('hidden_rows', HIDDEN), { measures: ['row_count'] }, context)],
        ['relationship hop', () => service.query({ cube: LEDGER, measures: ['count'], dimensions: ['hidden_ref.region'] }, context)],
      ];
      for (const [door, call] of calls) {
        expect(pick(await rejection(call)), door).toEqual({ code: 'OBJECT_API_DISABLED', status: 404, object: HIDDEN });
      }
      expect(readSince(before, HIDDEN), 'no read of the hidden object').toBe(0);
      expect(readSince(before, LEDGER), 'no read of the hop\'s base object either').toBe(0);
    });

    it('an object whose whitelist does not grant the aggregate verb is refused 405 OBJECT_API_METHOD_NOT_ALLOWED', async () => {
      const before = snapshot();
      const calls: Array<[string, () => unknown]> = [
        ['ad-hoc query', () => service.query({ cube: NO_LIST, measures: ['count'] }, context)],
        ['SQL face', () => service.generateSql({ cube: NO_LIST, measures: ['count'] }, context)],
        ['configured cube', () => service.query({ cube: 'nolist_cube', measures: ['rows'] }, context)],
        ['dataset door', () => service.queryDataset(dataset('nolist_rows', NO_LIST), { measures: ['row_count'] }, context)],
      ];
      for (const [door, call] of calls) {
        const err = await rejection(call);
        expect(pick(err), door).toEqual({ code: 'OBJECT_API_METHOD_NOT_ALLOWED', status: 405, object: NO_LIST });
      }
      expect(readSince(before, NO_LIST), 'no read of the object').toBe(0);
    });

    it('an ad-hoc refusal mints nothing: no cube is inferred, and the registry is as it was', async () => {
      const metaBefore = await service.getMeta();
      const infer = vi.spyOn(service as any, 'inferCubeFromQuery');
      try {
        await rejection(() => service.query({ cube: HIDDEN, measures: ['count'] }, context));
        await rejection(() => service.generateSql({ cube: HIDDEN, measures: ['count'] }, context));
        expect(infer).not.toHaveBeenCalled();
      } finally {
        infer.mockRestore();
      }
      expect(await service.getMeta()).toEqual(metaBefore);
    });

    // ── The field facet ─────────────────────────────────────────────────
    it('an `internal: true` field is refused 400 INVALID_FIELD in every member position, and nothing reads the object', async () => {
      const before = snapshot();
      const calls: Array<[string, () => unknown]> = [
        ['dimension', () => service.query({ cube: VAULT, measures: ['count'], dimensions: ['digest'] }, context)],
        ['measure input', () => service.query({ cube: VAULT, measures: ['digest_count_distinct'] }, context)],
        ['filter operand', () => service.query({ cube: VAULT, measures: ['count'], where: { digest: 'stored-one' } }, context)],
        ['SQL face', () => service.generateSql({ cube: VAULT, measures: ['count'], dimensions: ['digest'] }, context)],
        ['configured cube dimension', () => service.query({ cube: 'vault_cube', measures: ['rows'], dimensions: ['sealed'] }, context)],
        ['configured cube filter', () => service.query({ cube: 'vault_cube', measures: ['rows'], where: { sealed: 'stored-one' } }, context)],
        [
          'dataset dimension',
          () => service.queryDataset(
            dataset('vault_sealed', VAULT, { dimensions: [{ name: 'sealed', label: 'Sealed', field: 'digest', type: 'string' }] }),
            { measures: ['row_count'], dimensions: ['sealed'] },
            context,
          ),
        ],
        [
          'dataset filter',
          () => service.queryDataset(dataset('vault_filtered', VAULT, { filter: { digest: 'stored-one' } }), { measures: ['row_count'] }, context),
        ],
      ];
      for (const [position, call] of calls) {
        expect(pick(await rejection(call)), position).toEqual({ code: 'INVALID_FIELD', status: 400, object: VAULT, field: 'digest' });
      }
      expect(readSince(before, VAULT), 'no read of the object').toBe(0);
    });

    it('an `internal: true` field reached through a relationship hop is refused, and nothing reads either object', async () => {
      const before = snapshot();
      for (const query of [
        { cube: LEDGER, measures: ['count'], dimensions: ['vault_ref.digest'] },
        { cube: LEDGER, measures: ['count'], where: { 'vault_ref.digest': 'stored-one' } },
      ]) {
        expect(pick(await rejection(() => service.query(query, context))), JSON.stringify(query)).toEqual({
          code: 'INVALID_FIELD', status: 400, object: VAULT, field: 'digest',
        });
      }
      expect(readSince(before, LEDGER)).toBe(0);
      expect(readSince(before, VAULT)).toBe(0);
    });

    // ── Controls ────────────────────────────────────────────────────────
    it('CONTROL: an ordinary object and an ordinary column are served as before', async () => {
      const groups = async (cube: string, measure: string, member: string, object = OPEN) => {
        const result = await service.query({ cube, measures: [measure], dimensions: [member] }, context);
        return (result.rows as Array<Record<string, unknown>>)
          .map((r) => [String(r[member]), Number(r[measure])] as const)
          .sort(([a], [b]) => a.localeCompare(b));
      };
      expect(await groups(OPEN, 'count', 'region')).toEqual([['east', 1], ['west', 2]]);
      const answered = await service.queryDataset(dataset('open_rows', OPEN), { measures: ['row_count'] }, context);
      expect(Number((answered.rows as Array<Record<string, unknown>>)[0].row_count)).toBe(3);
      const sql = await service.generateSql({ cube: OPEN, measures: ['count'] }, context);
      expect(sql.sql).toContain(OPEN);
    });

    it('CONTROL: an object that HAS an internal field is still served for every other member', async () => {
      const groups = async (cube: string, measure: string, member: string) => {
        const result = await service.query({ cube, measures: [measure], dimensions: [member] }, context);
        return (result.rows as Array<Record<string, unknown>>)
          .map((r) => [String(r[member]), Number(r[measure])] as const)
          .sort(([a], [b]) => a.localeCompare(b));
      };
      expect(await groups(VAULT, 'count', 'region')).toEqual([['east', 1], ['west', 2]]);
      expect(await groups('vault_cube', 'rows', 'region')).toEqual([['east', 1], ['west', 2]]);
      const counted = await service.query({ cube: VAULT, measures: ['count'], where: { region: 'west' } }, context);
      expect(Number((counted.rows as Array<Record<string, unknown>>)[0].count)).toBe(2);
      const hop = await service.query({ cube: LEDGER, measures: ['count'], dimensions: ['vault_ref.region'] }, context);
      expect(
        (hop.rows as Array<Record<string, unknown>>)
          .map((r) => [String(r['vault_ref.region']), Number(r.count)])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      ).toEqual([['east', 1], ['west', 1]]);
    });
  });
});

describe('the exposure gate fails closed', () => {
  it('a declaration lookup that throws refuses the query PERMISSION_DENIED / 403, and nothing runs', async () => {
    const executed: string[] = [];
    const service = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (object) => {
        executed.push(object);
        return [{ count: 1 }];
      },
      getObjectDeclaration: () => {
        throw new Error('registry unavailable');
      },
    });
    for (const call of [
      () => service.query({ cube: OPEN, measures: ['count'] }),
      () => service.generateSql({ cube: OPEN, measures: ['count'] }),
    ]) {
      expect(pick(await rejection(call))).toEqual({ code: 'PERMISSION_DENIED', status: 403, object: OPEN });
    }
    expect(executed).toEqual([]);
  });

  it('the plugin refuses when no data engine can answer for the declaration', async () => {
    const executed: string[] = [];
    const registered: Record<string, unknown> = {};
    await new AnalyticsServicePlugin({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (object) => {
        executed.push(object);
        return [{ count: 1 }];
      },
      admitObjectRead: () => true,
    }).init({
      getService: (name: string) => registered[name],
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      hook: () => {},
      logger: quiet,
    } as never);
    const service = registered.analytics as AnalyticsService;
    expect(pick(await rejection(() => service.query({ cube: OPEN, measures: ['count'] })))).toEqual({
      code: 'PERMISSION_DENIED', status: 403, object: OPEN,
    });
    expect(executed).toEqual([]);
  });
});
