// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20986] On an inferred cube, a dotted path through a lookup whose NAME
 * differs from its target object reads the TARGET object — the object the
 * lookup field declares as its `reference` — on both strategies and on both
 * faces, the cube read (`AnalyticsService.query`, what
 * `POST /api/v1/analytics/query` relays) and the SQL echo
 * (`AnalyticsService.generateSql`, what `POST /api/v1/analytics/sql` relays).
 *
 * An inferred cube declares no join, so each hop's object used to fall back to
 * the ALIAS, the lookup's own name. For a lookup named after its target that
 * is the target; for `owner` → a person object it is no object at all. The
 * door admitted the name as an object, so a member who may read both objects
 * was refused `403` "reading "owner" is not permitted", and a caller the
 * object check passes reached a statement over a table named `owner`.
 *
 * The reference for every answer is the same question asked through a
 * DECLARED join — an authored cube whose `joins` keys the lookup and names the
 * target — by the same caller, on the same strategy, in the same test: a
 * declared join was always resolved to its target. Each reference is also
 * checked absolutely, so an equality between two wrong answers cannot pass.
 * On the native strategy the dotted filter also answers what the engine's
 * nested form `{ owner: { region: … } }` answers, the form the dotted
 * spelling maps onto. A lookup named after its target is the control.
 *
 * The composition is the shipped one, with the REAL security layer:
 * `SecurityPlugin` over a real `ObjectQL` on a real `SqlDriver` (SQLite), and
 * `AnalyticsServicePlugin` over the same engine as its `'data'` service, whose
 * `relationshipResolver` reads each lookup's declared `reference` off the
 * engine's object schema. Two compositions, one per strategy: `native` (the
 * plugin's own capabilities) and `objectql` (narrowed to the engine-aggregate
 * path).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';

const LEDGER = 'rest_an_hop_ledger';
/** The target of lookup `owner`: readable by the member. */
const PERSON = 'rest_an_hop_person';
/** The target of lookup `keeper`: the member holds no read grant on it. */
const VAULT = 'rest_an_hop_vault';
/** A lookup named after its target, readable — the control. */
const OPEN = 'rest_an_hop_open';
/** A lookup named after its target, without a read grant — the control's refusal. */
const SHUT = 'rest_an_hop_shut';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    [VAULT]: { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false },
    [SHUT]: { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false },
  },
});

const MEMBER_CTX = { userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER' };

const count = { type: 'count', sql: '*', label: 'Count' };

/** The declared-join references: the lookups keyed in `joins`, each naming its target. */
const VIA_PERSON = {
  name: 'rest_an_hop_via_person',
  title: 'Via person',
  sql: LEDGER,
  measures: { count },
  dimensions: { owner_region: { type: 'string', sql: 'owner.region', label: 'Region' } },
  joins: { owner: { name: PERSON } },
};
const VIA_VAULT = {
  name: 'rest_an_hop_via_vault',
  title: 'Via vault',
  sql: LEDGER,
  measures: { count },
  dimensions: { keeper_code: { type: 'string', sql: 'keeper.code', label: 'Code' } },
  joins: { keeper: { name: VAULT } },
};

const PERSONS = [{ id: 'p1', region: 'NA' }, { id: 'p2', region: 'EU' }];
const VAULTS = [{ id: 'v1', code: 'c1' }];
const OPENS = [{ id: 'o1', region: 'NA' }, { id: 'o2', region: 'EU' }];
const SHUTS = [{ id: 's1', code: 'c1' }];
const LEDGER_ROWS = [
  { id: 'd1', title: 't1', owner: 'p1', keeper: 'v1', [OPEN]: 'o1', [SHUT]: 's1' },
  { id: 'd2', title: 't2', owner: 'p2', keeper: 'v1', [OPEN]: 'o2', [SHUT]: 's1' },
  { id: 'd3', title: 't3', owner: 'p1', [OPEN]: 'o1' },
];

const quiet: any = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

interface Harness {
  engine: ObjectQL;
  service: AnalyticsService;
  /** Every object the security service was asked to admit, since the last `clear()`. */
  admitted: { objects: () => string[]; clear: () => void };
}

async function boot(strategy: 'native' | 'objectql'): Promise<Harness> {
  const engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.analytics-hop-object-reference-20986',
    name: 'Analytics hop object reference',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      { name: PERSON, label: 'Person', sharingModel: 'public_read_write', fields: { region: { name: 'region', type: 'text' } } },
      { name: VAULT, label: 'Vault', sharingModel: 'public_read_write', fields: { code: { name: 'code', type: 'text' } } },
      { name: OPEN, label: 'Open', sharingModel: 'public_read_write', fields: { region: { name: 'region', type: 'text' } } },
      { name: SHUT, label: 'Shut', sharingModel: 'public_read_write', fields: { code: { name: 'code', type: 'text' } } },
      {
        name: LEDGER,
        label: 'Ledger',
        sharingModel: 'public_read_write',
        fields: {
          title: { name: 'title', type: 'text' },
          // Named differently from their targets.
          owner: { name: 'owner', type: 'lookup', reference: PERSON },
          keeper: { name: 'keeper', type: 'lookup', reference: VAULT },
          // Named after their targets: the control.
          [OPEN]: { name: OPEN, type: 'lookup', reference: OPEN },
          [SHUT]: { name: SHUT, type: 'lookup', reference: SHUT },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    data: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_SET],
    },
  };
  const ctx: any = {
    logger: quiet,
    hook: () => {},
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    replaceService: (name: string, svc: unknown) => { services[name] = svc; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const security = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await security.init(ctx);
  await security.start(ctx);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  await engine.insert(PERSON, PERSONS.map((r) => ({ ...r })), { context: SYS_CTX } as never);
  await engine.insert(VAULT, VAULTS.map((r) => ({ ...r })), { context: SYS_CTX } as never);
  await engine.insert(OPEN, OPENS.map((r) => ({ ...r })), { context: SYS_CTX } as never);
  await engine.insert(SHUT, SHUTS.map((r) => ({ ...r })), { context: SYS_CTX } as never);
  await engine.insert(LEDGER, LEDGER_ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);

  await new AnalyticsServicePlugin({
    cubes: [VIA_PERSON, VIA_VAULT] as never,
    ...(strategy === 'objectql'
      ? { queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) }
      : {}),
  }).init(ctx);

  const spy = vi.spyOn(services.security as { canReadObject: (object: string, context?: unknown) => Promise<boolean> }, 'canReadObject');
  return {
    engine,
    service: services.analytics as AnalyticsService,
    admitted: { objects: () => spy.mock.calls.map((call) => call[0] as string), clear: () => spy.mockClear() },
  };
}

type Thrown = { code?: string; status?: number; statusCode?: number; object?: string } | null;

/**
 * What a face answered — its rows with the column names dropped (a path member
 * and the declared member that reads the same column are named differently),
 * or its refusal's envelope and the object it names.
 */
const answerOf = (run: () => Promise<{ rows?: ReadonlyArray<Record<string, unknown>>; sql?: unknown }>) =>
  run().then(
    (r) => ({ answered: r.rows ? [...r.rows].map((row) => JSON.stringify(Object.values(row))).sort() : typeof r.sql }),
    (e: Thrown) => ({ refused: { code: e?.code, status: e?.status ?? e?.statusCode, object: e?.object } }),
  );

for (const strategy of ['native', 'objectql'] as const) {
  describe(`[#20986] a dotted path through a lookup named differently from its target reads the target — ${strategy} composition`, () => {
    let h: Harness;

    beforeAll(async () => {
      h = await boot(strategy);
    }, 60_000);

    afterAll(async () => {
      try { await h?.engine.destroy(); } catch { /* noop */ }
    });

    it('readable target, a dimension: the rows a declared join answers, and only the target is admitted', async () => {
      const reference = await answerOf(() => h.service.query({ cube: VIA_PERSON.name, measures: ['count'], dimensions: ['owner_region'] } as never, MEMBER_CTX as never));
      expect(reference).toEqual({ answered: [JSON.stringify(['EU', 1]), JSON.stringify(['NA', 2])] });
      h.admitted.clear();
      const answer = await answerOf(() => h.service.query({ cube: LEDGER, measures: ['count'], dimensions: ['owner.region'] } as never, MEMBER_CTX as never));
      expect(answer).toEqual(reference);
      expect([...new Set(h.admitted.objects())].sort()).toEqual([LEDGER, PERSON].sort());
      expect(await answerOf(() => h.service.generateSql({ cube: LEDGER, measures: ['count'], dimensions: ['owner.region'] } as never, MEMBER_CTX as never))).toEqual({ answered: 'string' });
    });

    it('readable target, a filter member: what a declared join answers in the same position', async () => {
      const reference = await answerOf(() => h.service.query({ cube: VIA_PERSON.name, measures: ['count'], where: { owner_region: 'NA' } } as never, MEMBER_CTX as never));
      const answer = await answerOf(() => h.service.query({ cube: LEDGER, measures: ['count'], where: { 'owner.region': 'NA' } } as never, MEMBER_CTX as never));
      expect(answer).toEqual(reference);
      if (strategy === 'native') {
        // Served: the two rows whose owner is in region NA — what the engine's
        // nested form answers for the same condition.
        expect(answer).toEqual({ answered: [JSON.stringify([2])] });
        const nested = await answerOf(() => h.service.query({ cube: LEDGER, measures: ['count'], where: { owner: { region: 'NA' } } } as never, MEMBER_CTX as never));
        expect(answer).toEqual(nested);
      } else {
        // The engine-aggregate strategy filters on no related value, through a
        // declared join or not: its own capability refusal, never the door's.
        expect(answer).toEqual({ refused: { code: 'INVALID_FIELD', status: 400, object: undefined } });
      }
    });

    it.each([
      ['a dimension', { cube: LEDGER, measures: ['count'], dimensions: ['keeper.code'] }, { cube: VIA_VAULT.name, measures: ['count'], dimensions: ['keeper_code'] }],
      ['a filter member', { cube: LEDGER, measures: ['count'], where: { 'keeper.code': 'c1' } }, { cube: VIA_VAULT.name, measures: ['count'], where: { keeper_code: 'c1' } }],
    ])('unreadable target, %s: refused 403 naming the target, as through a declared join, on both faces', async (_label, path, declared) => {
      const reference = await answerOf(() => h.service.query(declared as never, MEMBER_CTX as never));
      expect(reference).toEqual({ refused: { code: 'PERMISSION_DENIED', status: 403, object: VAULT } });
      expect(await answerOf(() => h.service.query(path as never, MEMBER_CTX as never)), 'the cube read').toEqual(reference);
      expect(await answerOf(() => h.service.generateSql(path as never, MEMBER_CTX as never)), 'the SQL echo').toEqual(reference);
    });

    it('the control: a lookup named after its target is answered when readable and refused naming it when not', async () => {
      expect(await answerOf(() => h.service.query({ cube: LEDGER, measures: ['count'], dimensions: [`${OPEN}.region`] } as never, MEMBER_CTX as never))).toEqual({
        answered: [JSON.stringify(['EU', 1]), JSON.stringify(['NA', 2])],
      });
      expect(await answerOf(() => h.service.query({ cube: LEDGER, measures: ['count'], dimensions: [`${SHUT}.code`] } as never, MEMBER_CTX as never))).toEqual({
        refused: { code: 'PERMISSION_DENIED', status: 403, object: SHUT },
      });
    });
  });
}
