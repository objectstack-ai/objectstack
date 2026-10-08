// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7] The #12699 deployment declaration made total, through a booted
 * kernel: "an object a deployment declares platform-global gets no organization
 * column on that deployment (the injected-columns plan reads the declaration),
 * so Layer 0 and the driver agree by having nothing to scope".
 *
 * Real `ObjectKernel`, real `ObjectQLPlugin` over a real SQLite driver, the
 * real `SecurityPlugin`, and a FIXTURE `org-scoping` provider: the only
 * declarer of `platformGlobalObjects` is cloud's control plane (ADR-0131 C10),
 * so nothing in this repository declares it. The fixture is composed AFTER
 * the plugin that registers the objects — the order `serve` composes the
 * organizations runtime in — and registers `org-scoping` in its own `init()`,
 * declaring it in `providesServices` (ADR-0116 D2), as the open
 * `OrganizationsPlugin` does.
 *
 * What was measured before the change, on this same harness: the declared
 * object was registered WITH `organization_id`, its table was created with the
 * column, `getReadFilter` answered no wall for it (the #12699 stand-down in
 * `getObjectSecurityMeta`), and a system read carrying an organization was
 * still scoped to that organization by the SQL driver — Layer 0 and the driver
 * disagreeing about one object.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

const DECLARED = 'qa_widget_registry';
const SIBLING = 'qa_invoice';
const OBJECTS = [
  { name: SIBLING, label: 'Invoice', ownership: 'org', fields: { title: { type: 'text', label: 'Title' } } },
  { name: DECLARED, label: 'Widget registry', ownership: 'org', fields: { title: { type: 'text', label: 'Title' } } },
];

/** An ordinary member of `org_acme`: no superuser bit, no positions. */
const MEMBER = { userId: 'usr_member', tenantId: 'org_acme', positions: [], permissions: [], posture: 'MEMBER' };
const SYSTEM = { isSystem: true, userId: 'usr_system' };

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      );
    },
  };
}

function objectsPlugin(): Plugin {
  return {
    name: 'test.objects',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.objects',
        namespace: 'qa',
        version: '1.0.0',
        type: 'plugin',
        name: 'Objects',
        objects: [SysUser, SysMember, SysOrganization, ...OBJECTS],
      });
    },
  };
}

/** What the fixture provider saw of the declared object when it registered. */
const seenAtProviderInit: { declaredHadColumn?: boolean } = {};

/**
 * The fixture `org-scoping` provider. `phase: 'start'` registers it outside
 * `init()` — the order ADR-0116 gives no guarantee for.
 */
function orgScopingFixture(declaration: Record<string, unknown>, phase: 'init' | 'start' = 'init'): Plugin {
  const service = { name: 'test.org-scoping', supportedPostures: ['group', 'isolated'], ...declaration };
  const register = (ctx: PluginContext) => {
    const ql = ctx.getService<ObjectQL>('objectql');
    seenAtProviderInit.declaredHadColumn = !!(ql.getSchema(DECLARED) as any)?.fields?.organization_id;
    ctx.registerService('org-scoping', service);
  };
  return {
    name: 'test.org-scoping-fixture',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    ...(phase === 'init' ? { providesServices: ['org-scoping'] } : {}),
    async init(ctx: PluginContext) {
      if (phase === 'init') register(ctx);
    },
    async start(ctx: PluginContext) {
      if (phase === 'start') register(ctx);
    },
  } as Plugin;
}

let kernel: ObjectKernel | undefined;
afterEach(async () => {
  try {
    await kernel?.shutdown();
  } catch {
    /* a refused boot leaves the kernel stopped */
  }
  kernel = undefined;
  delete seenAtProviderInit.declaredHadColumn;
});

async function boot(provider?: Plugin) {
  kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(sqliteDriverPlugin());
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(objectsPlugin());
  if (provider) await kernel.use(provider);
  await kernel.use(new SecurityPlugin({ fallbackPermissionSet: 'member_default' }));
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  // The one member of the `security` service these pins read.
  const security = kernel.getService<{ getReadFilter(object: string, context: unknown): Promise<unknown> }>('security');
  return { ql, security };
}

async function columnsOf(ql: ObjectQL, object: string): Promise<string[]> {
  const driver: any = (ql as any).getDriver(object);
  return Object.keys(await driver.knex(object).columnInfo()).sort();
}

const refusalOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (error: unknown) => error as { code?: unknown; status?: unknown },
  );

describe('[ADR-0131 D7] the plan: a declared object has no organization column on the declaring deployment', () => {
  it('registered and provisioned with no organization_id; CONTROL: the sibling on the same deployment keeps it', async () => {
    const { ql } = await boot(orgScopingFixture({ platformGlobalObjects: [DECLARED] }));

    // Premise of the ordering: the provider registered AFTER the object did.
    expect(seenAtProviderInit.declaredHadColumn).toBe(true);

    const declared: any = ql.getSchema(DECLARED);
    expect(declared.fields.organization_id).toBeUndefined();
    expect(declared.systemFields).toEqual({ tenant: false });
    expect(await columnsOf(ql, DECLARED)).not.toContain('organization_id');

    const sibling: any = ql.getSchema(SIBLING);
    expect(sibling.fields.organization_id).toBeDefined();
    expect(await columnsOf(ql, SIBLING)).toContain('organization_id');
  });

  it('absent key: every object keeps its column (byte-identical plan)', async () => {
    const { ql } = await boot(orgScopingFixture({}));
    for (const name of [DECLARED, SIBLING]) {
      expect((ql.getSchema(name) as any).fields.organization_id).toBeDefined();
      expect((ql.getSchema(name) as any).systemFields).toBeUndefined();
      expect(await columnsOf(ql, name)).toContain('organization_id');
    }
  });

  it('junk key: refused loudly, and NO object loses its column', async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    // The kernel hands its own logger to every plugin context.
    const warn = vi.spyOn((kernel as any).logger, 'warn');
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(objectsPlugin());
    await kernel.use(orgScopingFixture({ platformGlobalObjects: DECLARED }));
    await kernel.use(new SecurityPlugin({ fallbackPermissionSet: 'member_default' }));
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');

    const warned = warn.mock.calls.map((c) => String(c[0]));
    expect(warned.filter((m) => m.includes("'platformGlobalObjects' REFUSED"))).toHaveLength(1);
    for (const name of [DECLARED, SIBLING]) {
      expect((ql.getSchema(name) as any).fields.organization_id).toBeDefined();
      expect(await columnsOf(ql, name)).toContain('organization_id');
    }
  });
});

describe('[ADR-0131 D7] Layer 0 and the driver agree: nothing to scope on the declared object', () => {
  it('Layer 0 composes no wall on the declared object and the driver has no column to scope; CONTROL: the sibling is walled at both', async () => {
    const { ql, security } = await boot(orgScopingFixture({ platformGlobalObjects: [DECLARED] }));
    await ql.insert(DECLARED, [{ title: 'a' }, { title: 'b' }], { context: SYSTEM } as never);
    await ql.insert(SIBLING, [
      { title: 'mine', organization_id: 'org_acme' },
      { title: 'theirs', organization_id: 'org_globex' },
    ], { context: SYSTEM } as never);

    // Layer 0: no wall on the declared object, the organization wall on the sibling.
    expect(await security.getReadFilter(DECLARED, MEMBER)).toBeUndefined();
    expect(await security.getReadFilter(SIBLING, MEMBER)).toEqual({ organization_id: 'org_acme' });

    // The driver: a read carrying the member's organization reaches every row
    // of the declared table (no column to scope on), and only the member's
    // organization on the sibling.
    const declaredRows = (await ql.find(DECLARED, { context: { ...SYSTEM, tenantId: 'org_acme' } } as never)) as any[];
    expect(declaredRows.map((r) => r.title).sort()).toEqual(['a', 'b']);
    const siblingRows = (await ql.find(SIBLING, { context: { ...SYSTEM, tenantId: 'org_acme' } } as never)) as any[];
    expect(siblingRows.map((r) => r.title)).toEqual(['mine']);
    // A member's predicate write through BOTH layers at once is pinned in
    // `tenant-layer0-verdict-end-to-end.test.ts` (the sweep now matches every
    // row of the declared table, where the driver used to narrow it).
  });

  it('a write naming organization_id on the declared object is refused (INVALID_FIELD 400); CONTROL: the sibling accepts it', async () => {
    const { ql } = await boot(orgScopingFixture({ platformGlobalObjects: [DECLARED] }));
    const refusal = await refusalOf(
      ql.insert(DECLARED, { title: 'x', organization_id: 'org_acme' }, { context: SYSTEM } as never),
    );
    expect(refusal?.code).toBe('INVALID_FIELD');
    expect(refusal?.status).toBe(400);
    expect(
      await refusalOf(ql.insert(SIBLING, { title: 'x', organization_id: 'org_acme' }, { context: SYSTEM } as never)),
    ).toBeUndefined();
  });
});

describe('[ADR-0131 D7] no stand-down path remains in plugin-security', () => {
  /**
   * The plugin over an engine whose registry never received the declaration
   * (no `ObjectQLPlugin` installed it): the object still carries its column.
   * The plugin reads `org-scoping` — and walls the object anyway, because the
   * #12699 fold that stood Layer 0 down from the declaration is gone. The
   * declaration takes effect through the plan or not at all.
   */
  it('a declaration the plan never received does not unwall the object', async () => {
    const engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      true,
    );
    await engine.init();
    engine.registerApp({ id: 'qa.objects', name: 'Objects', version: '1.0.0', type: 'plugin', objects: OBJECTS } as never);
    const member: PermissionSet = {
      name: 'member_default',
      label: 'Member',
      objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    } as unknown as PermissionSet;
    const services: Record<string, unknown> = {
      manifest: { register: () => undefined },
      objectql: engine,
      metadata: {
        get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
        list: async () => [member],
      },
      'org-scoping': { name: 'test.org-scoping', platformGlobalObjects: [DECLARED] },
      tenancy: { posture: 'isolated' },
    };
    const ctx: any = {
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
      registerService: () => undefined,
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx);
    await plugin.start(ctx);
    try {
      expect((engine.getSchema(DECLARED) as any).fields.organization_id).toBeDefined();
      expect(await (plugin as any).getReadFilter(DECLARED, MEMBER)).toEqual({ organization_id: 'org_acme' });
    } finally {
      await engine.destroy();
    }
  });
});

describe('[ADR-0131 D7] the ordering is declared (ADR-0116), not assumed', () => {
  it('a provider registered after the objects still reaches the plan — its init() precedes the engine\'s start()', async () => {
    const { ql } = await boot(orgScopingFixture({ platformGlobalObjects: [DECLARED] }));
    expect(seenAtProviderInit.declaredHadColumn).toBe(true);
    expect((ql.getSchema(DECLARED) as any).fields.organization_id).toBeUndefined();
    expect(await columnsOf(ql, DECLARED)).not.toContain('organization_id');
  });

  it('a provider that registers org-scoping outside init() — after the columns were planned — refuses the boot by name', async () => {
    const failure = await boot(orgScopingFixture({ platformGlobalObjects: [DECLARED] }, 'start')).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toContain("platformGlobalObjects declaration changed after the engine planned the columns");
    expect(failure?.message).toContain(DECLARED);
    expect(failure?.message).toContain('providesServices');
  });
});
