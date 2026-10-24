// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25495] A new organization gets its default currency from its creator's
 * language or region; with nothing to derive from it stays unset, and a value
 * an administrator has set is never overwritten. The dev seed follows the same
 * rule from the host's locale.
 *
 * ## What is read
 *
 * Setup → Localization reads `GET /api/settings/localization`, which answers
 * `SettingsService.getNamespace('localization', { tenantId })` for the
 * session's active organization. Every case reads exactly that for the new
 * organization: `values.currency` with its `source`.
 *
 * ## The composition
 *
 * A real `ObjectKernel`, a real ObjectQL engine on in-memory SQLite, the real
 * `AuthPlugin` (which wraps `onOrganizationCreated`), the real `SecurityPlugin`
 * and the real `SettingsServicePlugin`. Organizations are created through the
 * real better-auth `POST /organization/create`, through
 * `AuthManager.handleRequest`, under the `group` posture (which permits
 * creating organizations without the enterprise runtime), so the creating
 * request's `Accept-Language` reaches the callback the way it does in a
 * deployment: through better-auth's endpoint context, not a test argument.
 *
 * ## Resolution
 *
 * `AuthPlugin` is imported from SOURCE; `@objectstack/service-settings` and
 * `@objectstack/plugin-security` are aliased to their `src/` in this package's
 * `vitest.config.ts`. `ObjectKernel`, `ObjectQLPlugin` and `SqlDriver` are the
 * fixed instruments, read from `dist/` as the dev-seed time-zone test reads them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import {
  InMemoryCryptoProvider,
  SettingsService,
  SettingsServicePlugin,
} from '@objectstack/service-settings';
import { AuthPlugin } from './auth-plugin.js';
import type { AuthManager } from './auth-manager.js';

const SYS = { isSystem: true } as const;
const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long';
const SEED_EMAIL = 'admin@objectos.ai';

/** Env the seed, the posture or the localization cascade reads; cleared per case. */
const ENV_KEYS = [
  'NODE_ENV',
  'OS_SEED_ADMIN',
  'OS_SEED_ADMIN_EMAIL',
  'OS_SEED_ADMIN_PASSWORD',
  'OS_SEED_ADMIN_NAME',
  'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED',
  'OS_PLATFORM_OWNER_EMAIL',
  'OS_LOCALIZATION_CURRENCY',
  'LC_ALL',
  'LC_MONETARY',
  'LANG',
] as const;

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
 * A fixture `org-scoping` provider, so the `group` posture is in force rather
 * than degraded to `single` (which refuses `organization/create`). The open
 * engine enforces `group`; the service's presence is what the tenancy
 * service probes. Same fixture shape as plugin-security's
 * `platform-global-no-organization-column.test.ts`.
 */
function orgScopingFixture(): Plugin {
  return {
    name: 'test.org-scoping-fixture',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    providesServices: ['org-scoping'],
    async init(ctx: PluginContext) {
      ctx.registerService('org-scoping', { name: 'test.org-scoping', supportedPostures: ['group', 'isolated'] });
    },
  } as Plugin;
}

/** An app plugin that leaves the Default Organization a currency an administrator stored earlier. */
function storedCurrencyAppPlugin(currency: string): Plugin {
  return {
    name: 'com.example.stored-currency',
    type: 'app',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init() {},
    async start(ctx: PluginContext) {
      const ql = ctx.getService<ObjectQL>('objectql');
      const org = await ql.findOne('sys_organization', { where: { slug: 'default' }, context: SYS });
      expect(org?.id, 'the Default Organization must exist before the seed for this case to mean anything').toBeTruthy();
      await ql.insert(
        'sys_setting',
        {
          namespace: 'localization',
          key: 'currency',
          scope: 'tenant',
          organization_id: org!.id,
          user_id: null,
          value: currency,
          encrypted: false,
          locked: false,
        },
        { context: SYS },
      );
    },
  };
}

const cookiesFrom = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0]!.trim())
    .filter(Boolean)
    .join('; ');

describe('a new organization takes its creator\'s default currency (#25495)', () => {
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
    vi.restoreAllMocks();
  });

  async function boot(options: { authOptions?: Record<string, unknown>; extra?: Plugin[] } = {}) {
    const walled = process.env.OS_TENANCY_POSTURE === 'group';
    const settingsWrites = vi.spyOn(SettingsService.prototype, 'set');
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    if (walled) await kernel.use(orgScopingFixture());
    await kernel.use(new AuthPlugin({ secret: SECRET, baseUrl: BASE, ...(options.authOptions ?? {}) } as never));
    await kernel.use(new SecurityPlugin());
    await kernel.use(new SettingsServicePlugin({ registerRoutes: false, cryptoProvider: new InMemoryCryptoProvider() }));
    for (const p of options.extra ?? []) await kernel.use(p);
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    const settings = kernel.getService<SettingsService>('settings');
    const auth = kernel.getService<AuthManager>('auth');

    /** What Setup → Localization reads for one organization. */
    const currencyOf = async (organizationId: string) =>
      (await settings.getNamespace('localization', { tenantId: organizationId })).values.currency;

    const currencyWrites = () =>
      settingsWrites.mock.calls.filter(([namespace, key]) => namespace === 'localization' && key === 'currency');

    /** Sign the first user up (the bootstrap user, so no invitation is needed) and return the session cookie. */
    const signUp = async (email: string) => {
      const res = await auth.handleRequest(
        new Request(`${AUTH}/sign-up/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: BASE },
          body: JSON.stringify({ email, password: 'S3cure!Passw0rd-25495', name: 'Founder' }),
        }),
      );
      expect(res.status, `sign-up failed: ${await res.clone().text()}`).toBeLessThan(400);
      const user = await ql.findOne('sys_user', { where: { email }, context: SYS });
      return { cookie: cookiesFrom(res), userId: String(user!.id) };
    };

    /** The console's "Create workspace" call, with the browser's Accept-Language when given. */
    const createOrganization = async (cookie: string, slug: string, acceptLanguage?: string) => {
      const res = await auth.handleRequest(
        new Request(`${AUTH}/organization/create`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: BASE,
            cookie,
            ...(acceptLanguage ? { 'accept-language': acceptLanguage } : {}),
          },
          body: JSON.stringify({ name: `Org ${slug}`, slug }),
        }),
      );
      expect(res.status, `organization/create failed: ${await res.clone().text()}`).toBeLessThan(400);
      const body = (await res.json()) as { id?: string };
      expect(body.id, 'organization/create must return the new organization').toBeTruthy();
      return String(body.id);
    };

    const defaultOrganization = async (): Promise<string> => {
      const org = await ql.findOne('sys_organization', { where: { slug: 'default' }, context: SYS });
      expect(org?.id, 'the single posture boots with a Default Organization').toBeTruthy();
      return String(org!.id);
    };

    return { ql, currencyOf, currencyWrites, signUp, createOrganization, defaultOrganization };
  }

  describe('through POST /organization/create', () => {
    beforeEach(() => {
      process.env.OS_TENANCY_POSTURE = 'group';
      // A walled posture refuses to boot without a declared platform owner.
      process.env.OS_PLATFORM_OWNER_EMAIL = 'owner@example.com';
    });

    it("1. a zh-CN creator's new organization stores localization.currency = 'CNY', as a value Setup → Localization shows", async () => {
      const { currencyOf, currencyWrites, signUp, createOrganization } = await boot();
      const { cookie } = await signUp('founder-cn@example.com');
      const orgId = await createOrganization(cookie, 'acme-cn', 'zh-CN,zh;q=0.9,en;q=0.8');

      expect(await currencyOf(orgId)).toMatchObject({ value: 'CNY', source: 'tenant' });
      expect(currencyWrites()).toEqual([['localization', 'currency', 'CNY', { tenantId: orgId }]]);
    }, 30_000);

    it('2. nothing to derive from (no stored language, no Accept-Language): nothing is stored', async () => {
      const { currencyOf, currencyWrites, signUp, createOrganization } = await boot();
      const { cookie } = await signUp('founder-none@example.com');
      const orgId = await createOrganization(cookie, 'acme-none');

      const resolved = await currencyOf(orgId);
      expect(resolved).toMatchObject({ source: 'default' });
      expect(resolved?.value ?? null).toBeNull();
      expect(currencyWrites()).toEqual([]);
    }, 30_000);

    it('3. a language with no country (es-419) is nothing to derive from: nothing is stored', async () => {
      const { currencyOf, currencyWrites, signUp, createOrganization } = await boot();
      const { cookie } = await signUp('founder-latam@example.com');
      const orgId = await createOrganization(cookie, 'acme-latam', 'es-419,es;q=0.9');

      expect(await currencyOf(orgId)).toMatchObject({ source: 'default' });
      expect(currencyWrites()).toEqual([]);
    }, 30_000);

    it("4. the creator's stored sys_user.locale outranks the request: ja-JP stored, zh-CN browser ⇒ JPY", async () => {
      const { ql, currencyOf, signUp, createOrganization } = await boot();
      const { cookie, userId } = await signUp('founder-jp@example.com');
      await ql.update('sys_user', { id: userId, locale: 'ja-JP' }, { context: SYS });
      const orgId = await createOrganization(cookie, 'acme-jp', 'zh-CN');

      expect(await currencyOf(orgId)).toMatchObject({ value: 'JPY', source: 'tenant' });
    }, 30_000);

    it('5. never over an administrator\'s value: a deployment-wide OS_LOCALIZATION_CURRENCY is kept, nothing is written', async () => {
      process.env.OS_LOCALIZATION_CURRENCY = 'EUR';
      const { currencyOf, currencyWrites, signUp, createOrganization } = await boot();
      const { cookie } = await signUp('founder-env@example.com');
      const orgId = await createOrganization(cookie, 'acme-env', 'zh-CN');

      expect(await currencyOf(orgId)).toMatchObject({ value: 'EUR', source: 'env' });
      expect(currencyWrites()).toEqual([]);
    }, 30_000);

    it("6. a host's own onOrganizationCreated still runs first, and a currency it sets is kept", async () => {
      let settingsRef: SettingsService | undefined;
      const host = vi.fn(async ({ organizationId }: { organizationId: string }) => {
        await settingsRef!.set('localization', 'currency', 'GBP', { tenantId: organizationId });
      });
      const { currencyOf, currencyWrites, signUp, createOrganization } = await boot({
        authOptions: { onOrganizationCreated: host },
      });
      settingsRef = kernel!.getService<SettingsService>('settings');
      const { cookie, userId } = await signUp('founder-host@example.com');
      const orgId = await createOrganization(cookie, 'acme-host', 'zh-CN');

      expect(host).toHaveBeenCalledWith(expect.objectContaining({ organizationId: orgId, userId }));
      expect(await currencyOf(orgId)).toMatchObject({ value: 'GBP', source: 'tenant' });
      expect(currencyWrites().map(([, , value]) => value)).toEqual(['GBP']);
    }, 30_000);
  });

  describe('the dev seed, from the host locale', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it("7. a zh_CN host: the seeded admin's workspace stores CNY", async () => {
      process.env.LANG = 'zh_CN.UTF-8';
      const { currencyOf, defaultOrganization, currencyWrites } = await boot();
      const orgId = await defaultOrganization();

      expect(await currencyOf(orgId)).toMatchObject({ value: 'CNY', source: 'tenant' });
      expect(currencyWrites()).toEqual([['localization', 'currency', 'CNY', { tenantId: orgId }]]);
    }, 30_000);

    it('8. a host that sets no locale (or C): nothing is stored — never the en-US Intl reports for it', async () => {
      process.env.LANG = 'C.UTF-8';
      const { currencyOf, defaultOrganization, currencyWrites, ql } = await boot();
      const admin = await ql.findOne('sys_user', { where: { email: SEED_EMAIL }, context: SYS });
      expect(admin?.id, 'the dev seed must have run for this case to mean anything').toBeTruthy();

      expect(await currencyOf(await defaultOrganization())).toMatchObject({ source: 'default' });
      expect(currencyWrites()).toEqual([]);
    }, 30_000);

    it('9. never over a set currency: a workspace that already has one keeps it', async () => {
      process.env.LANG = 'zh_CN.UTF-8';
      const { currencyOf, defaultOrganization, currencyWrites } = await boot({ extra: [storedCurrencyAppPlugin('USD')] });

      expect(await currencyOf(await defaultOrganization())).toMatchObject({ value: 'USD', source: 'tenant' });
      expect(currencyWrites()).toEqual([]);
    }, 30_000);
  });
});
