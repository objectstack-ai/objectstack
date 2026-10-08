// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SecurityPlugin declares the identity objects its authorization store reads,
 * and refuses at boot a kernel that does not register them.
 *
 * Its permission resolution (`@objectstack/core`'s `resolveUserAuthzGrants`)
 * reads `sys_user` and `sys_member`, which plugin-auth registers. Without them
 * the engine refuses those reads (`OBJECT_NOT_FOUND`) and the resolver reports
 * `AuthzStoreUnavailableError` (503) on every authenticated request. The
 * refusal moves that failure to `bootstrap()`, where it names the objects and
 * the plugin that registers them.
 *
 * Real kernel, real ObjectQL, real SQLite driver. The identity objects come from
 * `@objectstack/platform-objects/identity` under a package id of this test's
 * own: the gate asks whether the engine's registry holds the names, not who
 * registered them. plugin-auth's own suite pins the preset that registers them
 * (`identity-objects-plugin.test.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { AuthzIdentityObjectsMissingError, SecurityPlugin } from './security-plugin.js';

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

/** Registers the given objects through the `manifest` service under a test package id. */
function objectsPlugin(objects: unknown[]): Plugin {
  return {
    name: 'test.identity-stand-in',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.identity-stand-in',
        namespace: 'sys',
        version: '1.0.0',
        type: 'plugin',
        name: 'Identity stand-in',
        objects,
      });
    },
  };
}

describe('SecurityPlugin refuses at boot a kernel without the identity objects its authz store reads', () => {
  let kernel: ObjectKernel | undefined;

  afterEach(async () => {
    try {
      await kernel?.shutdown();
    } catch {
      /* a refused boot leaves the kernel stopped */
    }
    kernel = undefined;
  });

  async function boot(extra: Plugin[]): Promise<unknown> {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    for (const p of extra) await kernel.use(p);
    await kernel.use(new SecurityPlugin());
    try {
      await kernel.bootstrap();
      return undefined;
    } catch (err) {
      return err;
    }
  }

  it('refuses when neither object is registered, naming both and the plugin that registers them', async () => {
    const err = await boot([]);

    expect(err).toBeInstanceOf(AuthzIdentityObjectsMissingError);
    expect((err as AuthzIdentityObjectsMissingError).missingObjects).toEqual(['sys_user', 'sys_member']);
    const message = (err as Error).message;
    expect(message).toContain('sys_user');
    expect(message).toContain('sys_member');
    expect(message).toContain('@objectstack/plugin-auth');
    expect(message).toContain('createIdentityObjectsPlugin()');
    expect(kernel!.getState()).toBe('stopped');
  });

  it('names only the object that is missing', async () => {
    const err = await boot([objectsPlugin([SysUser])]);

    expect(err).toBeInstanceOf(AuthzIdentityObjectsMissingError);
    expect((err as AuthzIdentityObjectsMissingError).missingObjects).toEqual(['sys_member']);
  });

  it('boots when the registry holds both, whoever registered them', async () => {
    const err = await boot([objectsPlugin([SysUser, SysMember, SysOrganization])]);

    expect(err).toBeUndefined();
    expect(kernel!.getState()).toBe('running');
  });
});
