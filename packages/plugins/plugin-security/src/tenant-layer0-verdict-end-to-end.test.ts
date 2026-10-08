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
 *   - a deployment-declared platform-global object (#12699
 *     `platformGlobalObjects`, made total by ADR-0131 D7: no organization
 *     column on the declaring deployment) ⇒ the event names NOTHING — the
 *     #15706 population: the wall composed no predicate, recorded `none`, and
 *     the producer (which reads nothing but the recorded verdict) omits the
 *     key. The former producer stamped the caller's organization here from
 *     the context — the wrong key.
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
  // [ADR-0131 D7] The deployment's declaration is the injected-columns plan's
  // input, installed on the registry before the objects register — what
  // `ObjectQLPlugin.start()` does on a booted kernel (this harness has none).
  if (opts.platformGlobalObjects) engine.registry.setDeploymentPlatformGlobalObjects(opts.platformGlobalObjects);
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

  it('a deployment-declared object under the SAME wall and caller: the key is ABSENT — the #15706 population, closed', async () => {
    const { engine, published } = await boot({ platformGlobalObjects: ['qa_widget_registry'] });
    // Rows written by two organizations' callers. On the declaring deployment
    // the object has no organization column, so the rows carry none — nothing
    // for the wall OR the driver to scope on.
    await seed(engine, 'qa_widget_registry', [
      { status: 'open', amount: '1' },
      { status: 'open', amount: '2' },
    ]);
    published.length = 0;

    await engine.update('qa_widget_registry', { amount: '0' }, { multi: true, where: { status: 'open' }, context: MEMBER_CTX } as any);

    const bulk = published.filter((e) => e.type === 'data.records.updated');
    expect(bulk).toHaveLength(1);
    const event = BulkDataEventSchema.parse(bulk[0].payload);
    // Ground truth, past every scope: the table has no organization column.
    const driver: any = (engine as any).getDriver('qa_widget_registry');
    expect(Object.keys(await driver.knex('qa_widget_registry').columnInfo())).not.toContain('organization_id');
    // [ADR-0131 D7] Layer 0 and the driver AGREE: the sweep matched BOTH rows.
    // Before D7 the wall stood down here while the SQL driver went on scoping
    // the caller's `tenantId` (the D8 driver leg the #12699 stand-down never
    // reached), so this sweep matched one row — measured on this harness.
    expect(event.matched).toBe(2);
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
