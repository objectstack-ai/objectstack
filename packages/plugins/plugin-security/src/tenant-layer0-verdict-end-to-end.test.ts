// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15813] The seam, welded end to end: a REAL `ObjectQL` engine, a REAL
 * `SecurityPlugin` registered on it the way a kernel composition does, a real
 * SQL driver, and a captured realtime service — then a predicate write, and
 * the `BulkDataEvent` that comes out.
 *
 * Why this pin exists beside the two unit suites: the plugin WRITES
 * `opCtx.tenantLayer0Verdict` on an untyped context and the engine READS
 * `OperationContext.tenantLayer0Verdict` off its own interface. Each side's
 * unit pins spell the member in their own package; a drift between the two
 * spellings would leave both suites green and the seam dead. Only a run
 * through both packages catches it — this one.
 *
 * Two populations, one deployment, one caller:
 *   - a walled tenant object ⇒ the event names the caller's organization —
 *     the wall's equality term, recorded and read;
 *   - a deployment-exempted object (#12699 `platformGlobalObjects`) ⇒ the
 *     event names NOTHING — the #15706 population: the wall composed no
 *     predicate, recorded `none`, and the producer (which reads nothing but
 *     the recorded verdict) omits the key. The former producer stamped the
 *     caller's organization here from the context — the wrong key.
 *
 * Harness lineage: `walled-platform-bucket-diagnostic.test.ts` (the real
 * engine over SQLite) and `deployment-platform-global-exemption.test.ts` (the
 * plugin's boot with an `org-scoping` declaration).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { BulkDataEventSchema } from '@objectstack/spec/api';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

const PLAIN_MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

const OBJECTS = [
  {
    name: 'qa_invoice',
    label: 'Invoice',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      status: { name: 'status', type: 'text' },
      amount: { name: 'amount', type: 'text' },
    },
  },
  {
    name: 'qa_widget_registry',
    label: 'Widget registry',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      status: { name: 'status', type: 'text' },
      amount: { name: 'amount', type: 'text' },
    },
  },
];

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: 'org_acme' };
/** An ordinary member of `org_acme`, rung carried as the authz resolver would. */
const MEMBER_CTX = { userId: 'usr_member', tenantId: 'org_acme', positions: [], permissions: [], posture: 'MEMBER' };

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(opts: { platformGlobalObjects?: string[] } = {}) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.layer0-verdict-15813',
    name: 'Layer 0 verdict weld',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as any);
  await engine.syncSchemas();
  engines.push(engine);

  const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
  engine.setRealtimeService({
    publish: vi.fn(async (event: any) => { published.push(event); }),
    subscribe: vi.fn(async () => 'sub-1'),
    unsubscribe: vi.fn(async () => undefined),
  } as any);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [PLAIN_MEMBER],
    },
    'org-scoping': {
      name: 'com.objectstack.org-scoping',
      ...(opts.platformGlobalObjects ? { platformGlobalObjects: opts.platformGlobalObjects } : {}),
    },
    tenancy: { posture: 'isolated' },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  return { engine, published };
}

const seed = async (engine: ObjectQL, object: string, rows: Array<Record<string, unknown>>) => {
  await engine.insert(object, rows, { context: SYS_CTX } as any);
};
const hasOrgKey = (p: Record<string, unknown>) => Object.prototype.hasOwnProperty.call(p, 'organizationId');

describe('[#15813] end to end — the plugin records the verdict, the engine publishes what it recorded', () => {
  it('a walled object: the bulk event names the organization the wall named', async () => {
    const { engine, published } = await boot({ platformGlobalObjects: ['qa_widget_registry'] });
    await seed(engine, 'qa_invoice', [
      { status: 'open', amount: '1', organization_id: 'org_acme' },
      { status: 'open', amount: '2', organization_id: 'org_acme' },
    ]);
    published.length = 0;

    await engine.update('qa_invoice', { amount: '0' }, { multi: true, where: { status: 'open' }, context: MEMBER_CTX } as any);

    const bulk = published.filter((e) => e.type === 'data.records.updated');
    expect(bulk).toHaveLength(1);
    const event = BulkDataEventSchema.parse(bulk[0].payload);
    expect(event.matched).toBe(2);
    expect(hasOrgKey(bulk[0].payload)).toBe(true);
    expect(event.organizationId).toBe('org_acme');
  });

  it('a deployment-exempted object under the SAME wall and caller: the key is ABSENT — the #15706 population, closed', async () => {
    const { engine, published } = await boot({ platformGlobalObjects: ['qa_widget_registry'] });
    // Rows across two organizations: the wall composes nothing on this object,
    // so the sweep reaches both — exactly the batch a wrong key would mislabel.
    await seed(engine, 'qa_widget_registry', [
      { status: 'open', amount: '1', organization_id: 'org_acme' },
      { status: 'open', amount: '2', organization_id: 'org_globex' },
    ]);
    published.length = 0;

    await engine.update('qa_widget_registry', { amount: '0' }, { multi: true, where: { status: 'open' }, context: MEMBER_CTX } as any);

    const bulk = published.filter((e) => e.type === 'data.records.updated');
    expect(bulk).toHaveLength(1);
    const event = BulkDataEventSchema.parse(bulk[0].payload);
    // Ground truth, past every scope: both rows are in the table, one per
    // organization — the population a wrong key would have mislabelled.
    const driver: any = (engine as any).getDriver('qa_widget_registry');
    const raw = await driver.knex('qa_widget_registry').select('organization_id');
    expect(raw.map((r: any) => r.organization_id).sort()).toEqual(['org_acme', 'org_globex']);
    // Measured, not assumed: the sweep matched ONE row. Layer 0 composed no
    // wall here (the carve-out), but the engine still threads the caller's
    // `tenantId` to the driver as `DriverOptions.tenantId` and the SQL driver
    // scopes on it — the D8 driver leg, which no #12699 declaration reaches
    // (filed as its own finding; not this seam's to change). So the batch
    // was narrower than Layer 0 alone implies, and the ABSENT key below is
    // an under-delivery in the safe direction — never the wrong key the
    // former producer stamped from the context on exactly this object.
    expect(event.matched).toBe(1);
    expect(hasOrgKey(bulk[0].payload)).toBe(false);
    expect(event.organizationId).toBeUndefined();
  });

  it('the same exempted object with NO deployment declaration walls again — the exemption is the declaration, not the object', async () => {
    const { engine, published } = await boot();
    await seed(engine, 'qa_widget_registry', [
      { status: 'open', amount: '1', organization_id: 'org_acme' },
      { status: 'open', amount: '2', organization_id: 'org_globex' },
    ]);
    published.length = 0;

    await engine.update('qa_widget_registry', { amount: '0' }, { multi: true, where: { status: 'open' }, context: MEMBER_CTX } as any);

    const bulk = published.filter((e) => e.type === 'data.records.updated');
    expect(bulk).toHaveLength(1);
    const event = BulkDataEventSchema.parse(bulk[0].payload);
    // The wall held the sweep to one organization, and the event says which.
    expect(event.matched).toBe(1);
    expect(event.organizationId).toBe('org_acme');
  });
});
