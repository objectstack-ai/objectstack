// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35525] An object of a DISABLED package is off the analytics door, as it is
 * off the data door.
 *
 * A disable takes a package's records off the data plane: `GET /data/:object`
 * answers `404 OBJECT_PACKAGE_DISABLED`, and the protocol refuses a relation
 * condition into such an object the same way (#35427). The analytics door asked
 * only an object's existence (`isRegisteredObject`) and its declared exposure
 * (`getObjectDeclaration`), never the registry's disabled-package predicate, so
 * `POST /analytics/query` kept counting, summing and grouping the disabled
 * object's rows (its field values came back as group keys), and an enabled
 * object's hop into it joined it.
 *
 * What these pins hold, on a REAL `ObjectQL` engine over a real `SqlDriver`
 * (SQLite) with a real `SchemaRegistry` package disable, both strategies, for a
 * member and a system caller (the data route refuses both):
 *
 *   - an authored cube over the disabled object (count / sum), a dimension on
 *     one of its fields, its inferred cube, the SQL echo and the dataset door
 *     are refused `404 OBJECT_PACKAGE_DISABLED`, naming the object, with the
 *     data route's own sentence;
 *   - a HOP from an enabled object into it (an authored member's path, an
 *     inferred dotted member, a dataset dimension through `include`) is refused
 *     the same way, naming the disabled object;
 *   - `getMeta` (`GET /analytics/meta`) leaves a cube over it out, as the
 *     metadata listing leaves the object out; the by-name form answers as for
 *     a hidden cube (nothing);
 *   - a lookup dimension's LABEL read of it is withheld (the stored id
 *     renders), as the data route's `$expand` withholds it;
 *   - CONTROLS: the same package re-enabled serves every row again with the
 *     right values, and the enabled object alone (no hop) is served while the
 *     other package is disabled.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { AnalyticsService } from '../analytics-service.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const PKG_A = 'app.pkg35525_alpha';
const PKG_B = 'app.pkg35525_beta';
const ALPHA = 'pkg35525_alpha';
const BETA = 'pkg35525_beta';

const text = (name: string) => ({ name, type: 'text' as const });

/** Package B's object, the one the disable takes offline. */
const BETA_OBJECT = {
  name: BETA,
  label: 'Beta',
  fields: { name: text('name'), secret_note: text('secret_note'), amount: { name: 'amount', type: 'number' as const } },
};
/** Package A's object, enabled throughout, with a lookup into B's. */
const ALPHA_OBJECT = {
  name: ALPHA,
  label: 'Alpha',
  fields: { title: text('title'), b_ref: { name: 'b_ref', type: 'lookup' as const, reference: BETA } },
};

const SECRET = 'BETA_SECRET';
const ROWS: Record<string, Array<Record<string, unknown>>> = {
  [BETA]: [{ id: 'b1', name: 'Beta One', secret_note: SECRET, amount: 42 }],
  [ALPHA]: [{ id: 'a1', title: 'alpha-1', b_ref: 'b1' }],
};

const CUBES = [
  {
    name: 'pkg35525_beta_cube',
    title: 'Beta cube',
    sql: BETA,
    public: true,
    measures: {
      cnt: { label: 'Count', type: 'count' as const, sql: '*' },
      total: { label: 'Total', type: 'sum' as const, sql: 'amount' },
    },
    dimensions: { note: { label: 'Note', type: 'string' as const, sql: 'secret_note' } },
  },
  {
    // No declared join: `title` reads alpha alone, `b_note` hops into beta
    // through the lookup's declared reference.
    name: 'pkg35525_alpha_cube',
    title: 'Alpha cube',
    sql: ALPHA,
    public: true,
    measures: { cnt: { label: 'Count', type: 'count' as const, sql: '*' } },
    dimensions: {
      title: { label: 'Title', type: 'string' as const, sql: 'title' },
      b_note: { label: 'Beta note', type: 'string' as const, sql: 'b_ref.secret_note' },
    },
  },
  {
    // A DECLARED join to beta: the cube's read set includes it whether or not
    // a query uses it (`cubeObjects`, the set the exposure gate already reads).
    name: 'pkg35525_alpha_joined_cube',
    title: 'Alpha joined cube',
    sql: ALPHA,
    public: true,
    measures: { cnt: { label: 'Count', type: 'count' as const, sql: '*' } },
    dimensions: { title: { label: 'Title', type: 'string' as const, sql: 'title' } },
    joins: { b_ref: { name: BETA, relationship: 'many_to_one' as const, sql: `{CUBE}.b_ref = {b_ref}.id` } },
  },
];

const dataset = (name: string, object: string, extra: Record<string, unknown> = {}) =>
  DatasetSchema.parse({ name, label: name, object, dimensions: [], measures: [{ name: 'row_count', label: 'Rows', aggregate: 'count' }], ...extra });

const quiet: any = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

/** Grants every caller read on every object and field: the refusal below is the package's, not a permission's. */
const grantEverything = (engine: ObjectQL) => {
  const fieldsOf = async (object: string) => Object.keys(engine.registry.getObject(object)?.fields ?? {});
  return {
    canReadObject: async () => true,
    getReadableFields: fieldsOf,
    getQueryableFields: fieldsOf,
    getReadFilter: async () => undefined,
  };
};

const CALLERS: ReadonlyArray<{ label: string; context: ExecutionContext }> = [
  { label: 'member', context: { userId: 'u_member', permissions: ['member_default'] } as ExecutionContext },
  { label: 'system', context: { isSystem: true, userId: 'usr_system' } as ExecutionContext },
];

const STRATEGIES = [
  { label: 'native SQL', capabilities: undefined },
  { label: 'ObjectQL', capabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) },
] as const;

interface Refusal extends Error { code?: string; status?: number; object?: string }

async function rejection(call: () => unknown): Promise<Refusal> {
  let resolved: unknown;
  try {
    resolved = await call();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, got ${JSON.stringify(resolved)}`);
}

/** The data route's refusal for the same object (`objectPackageDisabledError`, metadata-protocol). */
const DATA_ROUTE_REFUSAL = {
  code: 'OBJECT_PACKAGE_DISABLED',
  status: 404,
  object: BETA,
  message: `Object '${BETA}' belongs to a disabled package and is not being served. Re-enable the package to restore access.`,
};
const pick = (e: Refusal) => ({ code: e.code, status: e.status, object: e.object, message: e.message });

describe.each(STRATEGIES)('[#35525] the analytics door refuses a disabled package\'s object — $label strategy', ({ capabilities }) => {
  let engine: ObjectQL;
  let service: AnalyticsService;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL({ logger: quiet } as any);
    engine.registerDriver(driver, true);
    await engine.init();
    for (const pkg of [PKG_A, PKG_B]) engine.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
    engine.registry.registerObject(BETA_OBJECT as any, PKG_B);
    engine.registry.registerObject(ALPHA_OBJECT as any, PKG_A);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    for (const [object, rows] of Object.entries(ROWS)) {
      for (const row of rows) await engine.insert(object, { ...row } as any);
    }

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

  const disable = () => { engine.registry.disablePackage(PKG_B); };
  const enable = () => { engine.registry.enablePackage(PKG_B); };

  /** Every door that reads beta, directly or through alpha's lookup. */
  const betaReads = (context: ExecutionContext): Array<[string, () => unknown]> => [
    ['authored cube count + sum', () => service.query({ cube: 'pkg35525_beta_cube', measures: ['cnt', 'total'] }, context)],
    ['authored cube dimension on a field', () => service.query({ cube: 'pkg35525_beta_cube', measures: ['cnt'], dimensions: ['note'] }, context)],
    ['inferred cube', () => service.query({ cube: BETA, measures: [`${BETA}.count`], dimensions: [`${BETA}.secret_note`] }, context)],
    ['SQL echo', () => service.generateSql({ cube: 'pkg35525_beta_cube', measures: ['cnt'], dimensions: ['note'] }, context)],
    ['dataset door', () => service.queryDataset(
      dataset('pkg35525_beta_rows', BETA, { dimensions: [{ name: 'note', label: 'Note', field: 'secret_note', type: 'string' }] }),
      { measures: ['row_count'], dimensions: ['note'] },
      context,
    )],
    ['hop: authored member path', () => service.query({ cube: 'pkg35525_alpha_cube', measures: ['cnt'], dimensions: ['b_note'] }, context)],
    ['hop: inferred dotted member', () => service.query({ cube: ALPHA, measures: [`${ALPHA}.count`], dimensions: [`${ALPHA}.b_ref.secret_note`] }, context)],
    ['hop: declared join', () => service.query({ cube: 'pkg35525_alpha_joined_cube', measures: ['cnt'], dimensions: ['title'] }, context)],
    ['hop: dataset include', () => service.queryDataset(
      dataset('pkg35525_alpha_hop', ALPHA, { include: ['b_ref'], dimensions: [{ name: 'b_note', label: 'Beta note', field: 'b_ref.secret_note', type: 'string' }] }),
      { measures: ['row_count'], dimensions: ['b_note'] },
      context,
    )],
  ];

  for (const { label, context } of CALLERS) {
    it(`THE PIN (${label}): every read of the disabled object answers the data route's 404 OBJECT_PACKAGE_DISABLED`, async () => {
      disable();
      try {
        for (const [door, call] of betaReads(context)) {
          expect(pick(await rejection(call)), door).toEqual(DATA_ROUTE_REFUSAL);
        }
      } finally {
        enable();
      }
    });

    it(`CONTROL (${label}): the same package re-enabled serves every read with its values`, async () => {
      enable();
      const counted: any = await service.query({ cube: 'pkg35525_beta_cube', measures: ['cnt', 'total'] }, context);
      expect(counted.rows).toEqual([{ 'pkg35525_beta_cube.cnt': 1, 'pkg35525_beta_cube.total': 42 }]);
      const grouped: any = await service.query({ cube: 'pkg35525_beta_cube', measures: ['cnt'], dimensions: ['note'] }, context);
      expect(grouped.rows).toEqual([{ 'pkg35525_beta_cube.note': SECRET, 'pkg35525_beta_cube.cnt': 1 }]);
      const hop: any = await service.query({ cube: 'pkg35525_alpha_cube', measures: ['cnt'], dimensions: ['b_note'] }, context);
      expect(hop.rows).toEqual([{ 'pkg35525_alpha_cube.b_note': SECRET, 'pkg35525_alpha_cube.cnt': 1 }]);
      for (const [door, call] of betaReads(context)) {
        await expect(Promise.resolve().then(call), door).resolves.toBeDefined();
      }
    });

    it(`CONTROL (${label}): the enabled object alone, no hop, is served while the other package is disabled`, async () => {
      disable();
      try {
        const authored: any = await service.query({ cube: 'pkg35525_alpha_cube', measures: ['cnt'], dimensions: ['title'] }, context);
        expect(authored.rows).toEqual([{ 'pkg35525_alpha_cube.title': 'alpha-1', 'pkg35525_alpha_cube.cnt': 1 }]);
        const inferred: any = await service.query({ cube: ALPHA, measures: [`${ALPHA}.count`], dimensions: [`${ALPHA}.title`] }, context);
        expect(inferred.rows).toEqual([{ [`${ALPHA}.title`]: 'alpha-1', [`${ALPHA}.count`]: 1 }]);
      } finally {
        enable();
      }
    });
  }

  it('getMeta leaves a cube over the disabled object out, and lists it again on re-enable', async () => {
    const names = async (cube?: string) => (await service.getMeta(cube)).map((c) => c.name).sort();
    disable();
    try {
      expect(await names()).toEqual(['pkg35525_alpha_cube']);
      expect(await names('pkg35525_beta_cube')).toEqual([]);
      expect(await names('pkg35525_alpha_joined_cube')).toEqual([]);
    } finally {
      enable();
    }
    expect(await names()).toEqual(['pkg35525_alpha_cube', 'pkg35525_alpha_joined_cube', 'pkg35525_beta_cube']);
  });

  it('a lookup dimension\'s label read of the disabled object is withheld: the stored id renders', async () => {
    const lookupLabel = async () => {
      const result: any = await service.queryDataset(
        dataset('pkg35525_alpha_by_ref', ALPHA, { dimensions: [{ name: 'b_ref', label: 'Beta', field: 'b_ref', type: 'lookup' }] }),
        { measures: ['row_count'], dimensions: ['b_ref'] },
        CALLERS[0]!.context,
      );
      return result.rows.map((r: Record<string, unknown>) => r.b_ref);
    };
    expect(await lookupLabel()).toEqual(['Beta One']);
    disable();
    try {
      expect(await lookupLabel()).toEqual(['b1']);
    } finally {
      enable();
    }
  });
});
