// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * [ADR-0131 D5] `SecurityPluginOptions.acceptedDefaultPermissionSets` — the
 * walled posture's host-declared deployment-level acceptance — is read only
 * under a wall, and refused loudly everywhere it would not be read: a
 * malformed value at construction, a declaration under `single` at `start()`,
 * the first moment the posture is known. The derivation and the doors that
 * read it are pinned in `suggested-audience-bindings.test.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { SecurityPlugin } from './security-plugin.js';

/** Publishes an in-memory SQLite driver and the identity objects the authz store reads. */
function basePlugins(): Plugin[] {
  return [
    {
      name: 'test.driver.sqlite',
      type: 'standard',
      version: '1.0.0',
      async init(ctx: PluginContext) {
        ctx.registerService(
          'driver.default',
          new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
        );
      },
    },
    new ObjectQLPlugin(),
    {
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
          objects: [SysUser, SysMember, SysOrganization],
        });
      },
    },
  ];
}

/** The `tenancy` service a walled deployment's auth plugin registers (ADR-0105 D1). */
function tenancyPlugin(posture: 'isolated'): Plugin {
  return {
    name: 'test.tenancy',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService('tenancy', { posture });
    },
  };
}

describe('[ADR-0131 D5] acceptedDefaultPermissionSets is read under a wall and refused where it is not', () => {
  let kernel: ObjectKernel | undefined;

  afterEach(async () => {
    try {
      await kernel?.shutdown();
    } catch {
      /* a refused boot leaves the kernel stopped */
    }
    kernel = undefined;
  });

  async function boot(security: SecurityPlugin, extra: Plugin[] = []): Promise<unknown> {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    for (const p of [...basePlugins(), ...extra]) await kernel.use(p);
    await kernel.use(security);
    try {
      await kernel.bootstrap();
      return undefined;
    } catch (err) {
      return err;
    }
  }

  it('refuses a malformed declaration at construction', () => {
    expect(() => new SecurityPlugin({ acceptedDefaultPermissionSets: 'crm_readonly' as never })).toThrow(
      /`acceptedDefaultPermissionSets` must be a list of permission-set names/,
    );
    expect(() => new SecurityPlugin({ acceptedDefaultPermissionSets: [] })).not.toThrow();
  });

  it('refuses the boot when the `single` posture would ignore the declaration', async () => {
    const err = await boot(new SecurityPlugin({ acceptedDefaultPermissionSets: [] }));

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(
      /failed to start - rollback complete: \[security\] the SecurityPlugin option `acceptedDefaultPermissionSets` is declared, and this deployment runs the 'single' tenancy posture/,
    );
  });

  it('CONTROL: `single` without the declaration, and a wall with it, both boot', async () => {
    expect(await boot(new SecurityPlugin())).toBeUndefined();
    expect(kernel!.getState()).toBe('running');
    await kernel!.shutdown();

    expect(await boot(new SecurityPlugin({ acceptedDefaultPermissionSets: [] }), [tenancyPlugin('isolated')])).toBeUndefined();
    expect(kernel!.getState()).toBe('running');
  });
});
