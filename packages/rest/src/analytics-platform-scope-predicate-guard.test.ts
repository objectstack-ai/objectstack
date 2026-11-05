// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The field-level predicate guard judges the caller's own predicate, never the
 * read scope the platform composes — on the analytics face.
 *
 * The analytics strategy that aggregates through the engine merges the
 * caller's read scope (here the tenancy wall on `organization_id`) into the
 * filter it hands to `engine.aggregate` under the caller's context, marked as
 * the platform's own. A caller whose field rules hide that column aggregates
 * over the records of its organization; its own filter on the column is still
 * refused.
 *
 * Real stack: `ObjectQL` over SQLite, the real `SecurityPlugin` under the
 * `group` and `isolated` tenancy postures, the real `AnalyticsServicePlugin`
 * with the engine-aggregate strategy.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';

const OBJECT = 'rest_an_scope_ledger';
const ORG_A = 'org_a';
const ORG_B = 'org_b';
const SYS = { context: { isSystem: true, userId: 'usr_system' } };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'rest_an_scope_member',
  label: 'Member',
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
});
/** Field rules alone: the organization column hidden from the holder's reads. */
const ORG_HIDDEN_SET = PermissionSetSchema.parse({
  name: 'rest_an_scope_org_hidden',
  label: 'Organization hidden',
  objects: {},
  fields: { [`${OBJECT}.organization_id`]: { readable: false, editable: false } },
});

const caller = (...extra: string[]) => ({
  userId: 'usr_member',
  positions: [] as string[],
  permissions: [MEMBER_SET.name, ...extra],
  posture: 'MEMBER',
  tenantId: ORG_A,
  accessible_org_ids: [ORG_A],
});
const READS_COLUMN = caller();
const COLUMN_HIDDEN = caller(ORG_HIDDEN_SET.name);

const quiet: any = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: 'group' | 'isolated'): Promise<{ engine: ObjectQL; service: AnalyticsService }> {
  const engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.analytics-platform-scope-predicate-guard',
    name: 'Analytics platform scope and the predicate guard',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [{ name: OBJECT, label: 'Ledger', fields: { title: { name: 'title', type: 'text' } } }],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    data: engine,
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'permission' ? [MEMBER_SET, ORG_HIDDEN_SET].find((p) => p.name === name)
          : type === 'position' || type === 'capability' ? undefined
          : engine.getSchema(name)) ?? null,
      list: async (type: string) => (type === 'permission' ? [MEMBER_SET, ORG_HIDDEN_SET] : []),
    },
    'org-scoping': { name: 'com.objectstack.org-scoping' },
    tenancy: { posture },
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
  const security = new SecurityPlugin({ fallbackPermissionSet: MEMBER_SET.name });
  await security.init(ctx);
  await security.start(ctx);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  await engine.insert(OBJECT, [
    { id: 'a1', title: 't', organization_id: ORG_A },
    { id: 'a2', title: 't', organization_id: ORG_A },
  ], { context: { ...SYS.context, tenantId: ORG_A } } as never);
  await engine.insert(OBJECT, [{ id: 'b1', title: 't', organization_id: ORG_B }], { context: { ...SYS.context, tenantId: ORG_B } } as never);

  await new AnalyticsServicePlugin({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
  }).init(ctx);
  return { engine, service: services.analytics as AnalyticsService };
}

type Thrown = { code?: string; status?: number; statusCode?: number; message?: string } | null;
const answerOf = (run: () => Promise<unknown>) =>
  run().then(
    (r) => ({ answered: r as { rows?: Array<Record<string, unknown>> } }),
    (e: Thrown) => ({ refused: { code: e?.code, status: e?.status ?? e?.statusCode, message: String(e?.message) } }),
  );
const countOf = (r: { answered?: { rows?: Array<Record<string, unknown>> } }) =>
  Number(Object.values(r.answered?.rows?.[0] ?? {})[0]);

describe("the predicate guard judges the caller's own predicate, never the read scope the analytics merge composes", () => {
  for (const posture of ['group', 'isolated'] as const) {
    it(`posture '${posture}': a caller whose field rules hide the scoped column aggregates over the platform scope; its own filter on the column is refused`, async () => {
      const { service } = await boot(posture);
      const query = { cube: OBJECT, measures: ['count'] };

      const reads = await answerOf(() => service.query(query as never, structuredClone(READS_COLUMN) as never));
      expect(reads, JSON.stringify(reads)).toHaveProperty('answered');
      expect(countOf(reads as never), 'the caller who reads the column counts its organization').toBe(2);

      const hidden = await answerOf(() => service.query(query as never, structuredClone(COLUMN_HIDDEN) as never));
      expect(hidden, JSON.stringify(hidden)).toHaveProperty('answered');
      expect(countOf(hidden as never), 'the caller who cannot read the column counts the same records').toBe(2);

      const own = await answerOf(() => service.query(
        { ...query, where: { organization_id: ORG_A } } as never, structuredClone(COLUMN_HIDDEN) as never));
      expect(own, JSON.stringify(own)).toHaveProperty('refused');
      expect([(own as any).refused.code, (own as any).refused.status]).toEqual(['PERMISSION_DENIED', 403]);
    });
  }
});
