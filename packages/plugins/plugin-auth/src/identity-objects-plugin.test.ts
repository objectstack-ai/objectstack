// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `createIdentityObjectsPlugin()`: plugin-auth's identity objects for a kernel
 * that mounts ObjectQL without `AuthPlugin`, the reduced kernel an app's or a
 * plugin's own test suite boots.
 *
 * Pins:
 *  1. ObjectQL + an app + this plugin: a `sys_user` fixture inserts, and the
 *     registered set is plugin-auth's list under plugin-auth's package id.
 *     Without the plugin the same insert is refused `OBJECT_NOT_FOUND` (control).
 *  2. Adding `SecurityPlugin`: the kernel boots and permissions resolve from
 *     `sys_member` through `@objectstack/core`'s `resolveUserAuthzGrants`.
 *  3. `SecurityPlugin` without the identity objects is refused at boot by name
 *     (`plugin-security`'s own suite pins the refusal; here, the remedy it names
 *     is this export).
 *  4. The full kernel is unchanged: `AuthPlugin` registers the same identity
 *     manifest, from the same builder, in its one registration.
 *
 * "An app" is a plugin that registers its manifest through the `manifest`
 * service in `init()`, which is what `AppPlugin.init()` does. `AppPlugin` itself
 * lives in `@objectstack/runtime`, which depends on this package, so this suite
 * cannot import it without a workspace cycle.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ObjectKernel,
  resolvePluginOrder,
  resolveUserAuthzGrants,
  type OrderablePlugin,
  type Plugin,
  type PluginContext,
} from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { Field } from '@objectstack/spec/data';
import {
  IDENTITY_OBJECTS_PLUGIN_NAME,
  IdentityObjectsPlugin,
  createIdentityObjectsPlugin,
} from './identity-objects-plugin.js';
import { AUTH_PLUGIN_ID, authIdentityManifest, authIdentityObjects, authObjectExtensions } from './manifest.js';
import { AuthPlugin } from './auth-plugin.js';

const SYS = { isSystem: true } as const;

/** Publishes an in-memory SQLite driver the way a datasource plugin does. */
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

/** An app registering its manifest through the `manifest` service, as `AppPlugin.init()` does. */
function appPlugin(): Plugin {
  return {
    name: 'com.example.kit-app',
    type: 'app',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'com.example.kit-app',
        version: '1.0.0',
        type: 'app',
        name: 'Kit App',
        objects: [{ name: 'kit_account', label: 'Account', fields: { name: Field.text({ label: 'Name' }) } }],
      });
    },
  };
}

describe('createIdentityObjectsPlugin() — identity objects for a kernel without AuthPlugin', () => {
  let kernel: ObjectKernel | undefined;

  afterEach(async () => {
    try {
      await kernel?.shutdown();
    } catch {
      /* a refused boot leaves the kernel stopped */
    }
    kernel = undefined;
  });

  async function boot(plugins: Plugin[]): Promise<ObjectQL> {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(appPlugin());
    for (const p of plugins) await kernel.use(p);
    await kernel.bootstrap();
    return kernel.getService<ObjectQL>('objectql');
  }

  it('1. registers plugin-auth\'s list under plugin-auth\'s package id, and a sys_user fixture inserts', async () => {
    const ql = await boot([createIdentityObjectsPlugin()]);

    const registered = ql.registry.getAllObjects(AUTH_PLUGIN_ID).map((o) => o.name).sort();
    expect(registered).toEqual(authIdentityObjects.map((o) => o.name).sort());

    await ql.insert('sys_user', { id: 'usr_kit', name: 'Kit User', email: 'kit@example.com' }, { context: SYS });
    const row = await ql.findOne('sys_user', { where: { id: 'usr_kit' }, context: SYS });
    expect(row?.email).toBe('kit@example.com');
  });

  it('1 (control). without it, the same sys_user insert is refused OBJECT_NOT_FOUND', async () => {
    const ql = await boot([]);

    const refusal = await ql
      .insert('sys_user', { id: 'usr_kit', name: 'Kit User', email: 'kit@example.com' }, { context: SYS })
      .then(() => undefined, (err: unknown) => err as { code?: string; status?: number });
    expect(refusal).toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404 });
  });

  it('2. with SecurityPlugin added, the kernel boots and permissions resolve from sys_member', async () => {
    const ql = await boot([createIdentityObjectsPlugin(), new SecurityPlugin()]);

    await ql.insert('sys_user', { id: 'usr_kit', name: 'Kit User', email: 'kit@example.com' }, { context: SYS });
    await ql.insert('sys_organization', { id: 'org_kit', name: 'Kit Org' }, { context: SYS });
    await ql.insert(
      'sys_member',
      { id: 'mem_kit', user_id: 'usr_kit', organization_id: 'org_kit', role: 'admin' },
      { context: SYS },
    );

    const grants = await resolveUserAuthzGrants(ql, 'usr_kit', { tenantId: 'org_kit' });
    expect(grants.positions).toContain('org_admin');
    expect(grants.accessible_org_ids).toEqual(['org_kit']);
    expect(grants.email).toBe('kit@example.com');
  });

  it('3. SecurityPlugin without them is refused at boot, and the refusal names this export', async () => {
    const refusal = await boot([new SecurityPlugin()]).then(() => undefined, (err: unknown) => err as Error);

    expect(refusal?.name).toBe('AuthzIdentityObjectsMissingError');
    expect(refusal?.message).toContain('createIdentityObjectsPlugin()');
    expect(refusal?.message).toContain('@objectstack/plugin-auth');
  });

  it('4. the full kernel (AuthPlugin, no preset) boots SecurityPlugin unchanged', async () => {
    const ql = await boot([
      new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', baseUrl: 'http://localhost:3000' }),
      new SecurityPlugin(),
    ]);

    const registered = ql.registry.getAllObjects(AUTH_PLUGIN_ID).map((o) => o.name).sort();
    expect(registered).toEqual(authIdentityObjects.map((o) => o.name).sort());
  });
});

describe('one list: AuthPlugin and IdentityObjectsPlugin register the same identity manifest', () => {
  /** A context whose `manifest.register` records what was registered. */
  function capturingContext(services: Record<string, unknown> = {}) {
    const registered: Array<Record<string, unknown>> = [];
    const ctx = {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        if (name === 'manifest') return { register: (m: Record<string, unknown>) => registered.push(m) };
        if (name in services) return services[name];
        throw new Error(`service not registered: ${name}`);
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn(),
      trigger: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
    return { ctx, registered };
  }

  it('4. AuthPlugin\'s one registration carries the identity manifest unchanged (the full kernel)', async () => {
    const { ctx, registered } = capturingContext({ data: undefined });
    await new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', baseUrl: 'http://localhost:3000' }).init(ctx);

    expect(registered).toHaveLength(1);
    const [manifest] = registered;
    expect(manifest).toMatchObject(authIdentityManifest());
    expect(manifest.objects).toBe(authIdentityObjects);
    expect(manifest.objectExtensions).toBe(authObjectExtensions);
    expect(manifest.id).toBe(AUTH_PLUGIN_ID);
    // The rest of AuthPlugin's manifest is still there.
    expect(Array.isArray(manifest.pages) && manifest.pages.length).toBeGreaterThan(0);
    expect(Array.isArray(manifest.dashboards) && manifest.dashboards.length).toBeGreaterThan(0);
  });

  it('4. IdentityObjectsPlugin registers exactly that manifest, and honours the datasource override as AuthPlugin does', async () => {
    const plain = capturingContext();
    await createIdentityObjectsPlugin().init(plain.ctx);
    expect(plain.registered).toEqual([authIdentityManifest()]);
    expect(plain.registered[0].objects).toBe(authIdentityObjects);

    const kit = capturingContext();
    await createIdentityObjectsPlugin({ manifestDatasource: 'default' }).init(kit.ctx);
    const full = capturingContext({ data: undefined });
    await new AuthPlugin({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: 'http://localhost:3000',
      manifestDatasource: 'default',
    }).init(full.ctx);
    expect(kit.registered[0].defaultDatasource).toBe('default');
    expect(full.registered[0].defaultDatasource).toBe('default');
  });
});

describe('not beside AuthPlugin', () => {
  it('orders AuthPlugin ahead when both are composed, whatever the insertion order', () => {
    const engine: OrderablePlugin = { name: 'com.objectstack.engine.objectql' };
    const identity = createIdentityObjectsPlugin() as unknown as OrderablePlugin;
    const auth = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long' }) as unknown as OrderablePlugin;
    const order = resolvePluginOrder(
      new Map([engine, identity, auth].map((p) => [p.name, p])),
    ).map((p) => p.name);

    expect(order.indexOf('com.objectstack.auth')).toBeLessThan(order.indexOf(IDENTITY_OBJECTS_PLUGIN_NAME));
  });

  it('refuses to register when AuthPlugin has registered the auth service', async () => {
    const register = vi.fn();
    const ctx = {
      getService: vi.fn((name: string) => {
        if (name === 'auth') return {};
        if (name === 'manifest') return { register };
        throw new Error(`service not registered: ${name}`);
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as unknown as PluginContext;

    const refusal = await new IdentityObjectsPlugin().init(ctx).then(() => undefined, (err: unknown) => err as Error);
    expect(refusal?.message).toContain(IDENTITY_OBJECTS_PLUGIN_NAME);
    expect(refusal?.message).toContain('AuthPlugin');
    expect(register).not.toHaveBeenCalled();
  });
});
