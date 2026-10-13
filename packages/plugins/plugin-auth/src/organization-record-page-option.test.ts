// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AuthPluginOptions.registerOrganizationRecordPage`: a host that ships its own
 * default record page for `sys_organization` composes without plugin-auth's.
 *
 * ## The rule this option serves
 *
 * One `isDefault: true` record page per object per deployment, a second refused
 * at registration with `DEFAULT_RECORD_PAGE_CONFLICT` (maintainer ruling A on
 * objectstack#23015, record 6134056653). Ruling A keeps one page "by
 * overlay-by-name or by composition"; this option is the composition route. It
 * is not a precedence ladder and not a registration-order rule: with it set,
 * plugin-auth registers no organization page at all, so the host's page is the
 * single default whichever plugin initialises first.
 *
 * ## The three pins, each with its control
 *
 *  1. With the option (`false`), the host's page is the single default record
 *     page of `sys_organization` and the boot succeeds, in either plugin order.
 *     Control: the same composition without the option is refused (pin 3).
 *  2. Without it, plugin-auth's `sys_organization_detail` registers as today.
 *     Control: with the option and no host page, `sys_organization` has no
 *     default record page, so the assertion can tell the two apart.
 *     `sys_user_detail` registers in both.
 *  3. With both pages and no option, `DEFAULT_RECORD_PAGE_CONFLICT` still
 *     refuses the boot, naming both pages, in either plugin order. Control: an
 *     explicit `true` is today's behaviour and is refused the same way.
 *
 * ## The composition
 *
 * The cheapest real one: a real `ObjectKernel`, a real ObjectQL engine on
 * in-memory SQLite, the real `AuthPlugin`, and a host plugin in the place of a
 * product package (the cloud control plane's tenant service is the first such
 * host) registering its own organization page through the `manifest` service,
 * as `AppPlugin.init()` does. The refusal is the registry's own, reached
 * through that door.
 *
 * ## Resolution
 *
 * `AuthPlugin` is imported from SOURCE (relative). `ObjectKernel`,
 * `ObjectQLPlugin` and `SqlDriver` are the fixed instruments, read from
 * `dist/` as this package's other kernel tests read them, and so is
 * `@objectstack/spec/ui`'s `defaultRecordPageObject`, the one reading of "the
 * default record page of object X" the registry's refusal asks too.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { defaultRecordPageObject } from '@objectstack/spec/ui';
import { AuthPlugin, type AuthPluginOptions } from './auth-plugin.js';
import { AUTH_PLUGIN_ID } from './manifest.js';

const HOST_PACKAGE_ID = 'com.example.host-tenant';
const HOST_PAGE = 'host_organization_detail';
const AUTH_PAGE = 'sys_organization_detail';

/** Env the auth plugin's boot branches on; cleared per case so the default `single` posture holds. */
const ENV_KEYS = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_PLATFORM_OWNER_EMAIL'] as const;

type Holder = { kind: 'package'; packageId: string; page: string } | { kind: 'environment'; page: string };
type Refusal = Error & { code?: string; status?: number; object?: string; incoming?: Holder; existing?: Holder };

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

/**
 * A host shipping its own default record page for `sys_organization`,
 * registered through the `manifest` service in `init()` as `AppPlugin.init()`
 * does. No edge to `AuthPlugin`, so the order the case uses it in is the order
 * the two initialise in.
 */
function hostPlugin(): Plugin {
  return {
    name: HOST_PACKAGE_ID,
    type: 'app',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: HOST_PACKAGE_ID,
        name: 'host-tenant',
        version: '1.0.0',
        type: 'app',
        pages: [
          {
            name: HOST_PAGE,
            label: 'Workspace',
            type: 'record',
            object: 'sys_organization',
            isDefault: true,
            regions: [],
          },
        ],
      });
    },
  };
}

const authPlugin = (options: Pick<AuthPluginOptions, 'registerOrganizationRecordPage'> = {}) =>
  new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', baseUrl: 'http://localhost:3000', ...options });

let kernel: ObjectKernel | undefined;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(async () => {
  try {
    await kernel?.shutdown();
  } catch {
    /* a refused boot leaves the kernel stopped */
  }
  kernel = undefined;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/** Boot the composition with `plugins` used in the given order; resolves to the engine or the refusal. */
async function boot(plugins: Plugin[]): Promise<{ ql?: ObjectQL; refusal?: Refusal }> {
  await kernel?.shutdown().catch(() => undefined);
  kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(sqliteDriverPlugin());
  await kernel.use(new ObjectQLPlugin());
  for (const p of plugins) await kernel.use(p);
  try {
    await kernel.bootstrap();
  } catch (e) {
    return { refusal: e as Refusal };
  }
  return { ql: kernel.getService<ObjectQL>('objectql') };
}

/** Every default record page of `object` in the booted registry: its name and the package that registered it. */
function defaultsOf(ql: ObjectQL, object: string): Array<{ name: string; packageId: string }> {
  return ql.registry
    .listItems<{ name: string; _packageId: string }>('page')
    .filter((p) => defaultRecordPageObject(p) === object)
    .map((p) => ({ name: p.name, packageId: p._packageId }));
}

const pkgPage = (packageId: string, page: string): Holder => ({ kind: 'package', packageId, page });

/** The ADR-0112 envelope of the refusal and the two pages it names. */
function expectConflict(refusal: Refusal | undefined, incoming: Holder, existing: Holder) {
  expect(refusal, 'the boot was refused').toBeDefined();
  expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'DEFAULT_RECORD_PAGE_CONFLICT', status: 422 });
  expect(refusal!.object).toBe('sys_organization');
  expect(refusal!.incoming).toEqual(incoming);
  expect(refusal!.existing).toEqual(existing);
}

describe('registerOrganizationRecordPage: a host with its own sys_organization default record page', () => {
  it('pin 1: with the option, the host\'s page is the single default and the boot succeeds, in either order', async () => {
    for (const order of ['auth first', 'host first'] as const) {
      const auth = authPlugin({ registerOrganizationRecordPage: false });
      const { ql, refusal } = await boot(order === 'auth first' ? [auth, hostPlugin()] : [hostPlugin(), auth]);

      expect(refusal, `${order}: the boot succeeds`).toBeUndefined();
      expect(defaultsOf(ql!, 'sys_organization'), order).toEqual([{ name: HOST_PAGE, packageId: HOST_PACKAGE_ID }]);
      expect(ql!.registry.listItems<{ name: string }>('page', AUTH_PLUGIN_ID).map((p) => p.name), order).not.toContain(
        AUTH_PAGE,
      );
      // `SysUserDetailPage` is unchanged by the option.
      expect(defaultsOf(ql!, 'sys_user'), order).toEqual([{ name: 'sys_user_detail', packageId: AUTH_PLUGIN_ID }]);
    }
  });

  it('pin 2: without the option, plugin-auth\'s sys_organization_detail registers as today', async () => {
    const today = await boot([authPlugin()]);
    expect(today.refusal).toBeUndefined();
    expect(defaultsOf(today.ql!, 'sys_organization')).toEqual([{ name: AUTH_PAGE, packageId: AUTH_PLUGIN_ID }]);
    expect(defaultsOf(today.ql!, 'sys_user')).toEqual([{ name: 'sys_user_detail', packageId: AUTH_PLUGIN_ID }]);

    // Control: the option, with no page of the host's own, leaves the object
    // with no default record page — the reading above is not vacuous.
    const omitted = await boot([authPlugin({ registerOrganizationRecordPage: false })]);
    expect(omitted.refusal).toBeUndefined();
    expect(defaultsOf(omitted.ql!, 'sys_organization')).toEqual([]);
    expect(defaultsOf(omitted.ql!, 'sys_user')).toEqual([{ name: 'sys_user_detail', packageId: AUTH_PLUGIN_ID }]);
  });

  it('pin 3: with both pages and no option, DEFAULT_RECORD_PAGE_CONFLICT still refuses the boot, in either order', async () => {
    const authFirst = await boot([authPlugin(), hostPlugin()]);
    expect(authFirst.ql).toBeUndefined();
    expectConflict(authFirst.refusal, pkgPage(HOST_PACKAGE_ID, HOST_PAGE), pkgPage(AUTH_PLUGIN_ID, AUTH_PAGE));

    const hostFirst = await boot([hostPlugin(), authPlugin()]);
    expect(hostFirst.ql).toBeUndefined();
    expectConflict(hostFirst.refusal, pkgPage(AUTH_PLUGIN_ID, AUTH_PAGE), pkgPage(HOST_PACKAGE_ID, HOST_PAGE));

    // Control: an explicit `true` is today's behaviour, refused the same way.
    const explicit = await boot([authPlugin({ registerOrganizationRecordPage: true }), hostPlugin()]);
    expect(explicit.ql).toBeUndefined();
    expectConflict(explicit.refusal, pkgPage(HOST_PACKAGE_ID, HOST_PAGE), pkgPage(AUTH_PLUGIN_ID, AUTH_PAGE));
  });
});
