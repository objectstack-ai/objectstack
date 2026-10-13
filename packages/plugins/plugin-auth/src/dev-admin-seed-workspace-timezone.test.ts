// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23175] A fresh `os dev` database opens with its workspace time zone set to
 * the host's, so the console's "Set the workspace timezone" dialog does not
 * open over the shell — and a workspace with no zone still gets the dialog.
 *
 * ## The condition the dialog reads
 *
 * The console (`WorkspaceTimezonePrompt`, objectui at this repo's
 * `.objectui-sha`) asks an administrator while `GET /api/settings/localization`
 * answers `values.timezone.source === 'default'`. That route returns
 * `SettingsService.getNamespace('localization', { tenantId })` for the
 * session's active organization, so every case below reads exactly that, for
 * the organization the seeded admin is a member of.
 *
 * ## The composition
 *
 * The cheapest real one in which the dev seed's admin lands in a workspace: a
 * real `ObjectKernel`, a real ObjectQL engine on in-memory SQLite, the real
 * `AuthPlugin` (the seed and the `single` posture's Default Organization), the
 * real `SecurityPlugin` (first-user promotion, which is what the
 * default-organization bootstrap binds its owner from) and the real
 * `SettingsServicePlugin` (the door, and the reader). `NODE_ENV=development`
 * arms the seed the way `os dev` and the verify harness do.
 *
 * The host's zone is set the way a developer sets it, `TZ`, which Node re-reads
 * on assignment; each case first asserts the zone really moved, so no case can
 * pass on the container's own zone.
 *
 * ## Resolution
 *
 * `AuthPlugin` is imported from SOURCE; `@objectstack/service-settings` and
 * `@objectstack/plugin-security` are aliased to their `src/` in this package's
 * `vitest.config.ts`. `ObjectKernel`, `ObjectQLPlugin` and `SqlDriver` are the
 * fixed instruments, read from `dist/` as this package's other kernel tests
 * read them.
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

const SYS = { context: { isSystem: true } } as never;
const SEED_EMAIL = 'admin@objectos.ai';

/** A zone no CI container runs in, so a write of it cannot be the container's own. */
const HOST_ZONE = 'Asia/Shanghai';
/** The zone an earlier boot stored, for the never-overwrite case. */
const STORED_ZONE = 'Europe/Paris';

/** Env the seed, the posture or the localization cascade reads; cleared per case. */
const ENV_KEYS = [
  'NODE_ENV',
  'TZ',
  'OS_SEED_ADMIN',
  'OS_SEED_ADMIN_EMAIL',
  'OS_SEED_ADMIN_PASSWORD',
  'OS_SEED_ADMIN_NAME',
  'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED',
  'OS_PLATFORM_OWNER_EMAIL',
  'OS_LOCALIZATION_TIMEZONE',
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
 * An app plugin that leaves the Default Organization the zone an earlier boot
 * stored: the `tenant` row the dialog's own confirm writes. It starts after
 * `AuthPlugin` (registered later, no edge), so the organization exists, and
 * before `kernel:ready`, so the row is there when the seed runs.
 */
function storedZoneAppPlugin(): Plugin {
  return {
    name: 'com.example.stored-zone',
    type: 'app',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init() {},
    async start(ctx: PluginContext) {
      const ql = ctx.getService<ObjectQL>('objectql');
      const org = await ql.findOne('sys_organization', { where: { slug: 'default' }, ...SYS });
      expect(org?.id, 'the Default Organization must exist before the seed for this case to mean anything').toBeTruthy();
      await ql.insert(
        'sys_setting',
        {
          namespace: 'localization',
          key: 'timezone',
          scope: 'tenant',
          organization_id: org!.id,
          user_id: null,
          value: STORED_ZONE,
          encrypted: false,
          locked: false,
        },
        SYS,
      );
    },
  };
}

describe('the dev seed gives the workspace it lands its admin in the host time zone (#23175)', () => {
  let kernel: ObjectKernel | undefined;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.NODE_ENV = 'development';
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

  /** Set the host's zone, and prove the process now resolves it. */
  function hostZone(tz: string, expected: string | undefined): void {
    process.env.TZ = tz;
    expect(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      'TZ did not move the zone this process resolves, so this case would measure the container',
    ).toBe(expected);
  }

  async function boot(extra: Plugin[] = []) {
    const settingsWrites = vi.spyOn(SettingsService.prototype, 'set');
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', baseUrl: 'http://localhost:3000' }));
    await kernel.use(new SecurityPlugin());
    await kernel.use(new SettingsServicePlugin({ registerRoutes: false, cryptoProvider: new InMemoryCryptoProvider() }));
    for (const p of extra) await kernel.use(p);
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    const settings = kernel.getService<SettingsService>('settings');

    /** What the dialog reads for one organization: the resolved `localization.timezone`. */
    const zoneOf = async (organizationId: string) =>
      (await settings.getNamespace('localization', { tenantId: organizationId })).values.timezone;

    /** The organizations the seeded admin is a member of — the workspace its session opens in. */
    const seededAdminOrganizations = async (): Promise<string[]> => {
      const user = await ql.findOne('sys_user', { where: { email: SEED_EMAIL }, ...SYS });
      if (!user?.id) return [];
      const rows = (await ql.find('sys_member', { where: { user_id: user.id }, ...SYS })) as Array<{
        organization_id?: string;
      }>;
      return rows.map((r) => String(r.organization_id));
    };

    const defaultOrganization = async (): Promise<string> => {
      const org = await ql.findOne('sys_organization', { where: { slug: 'default' }, ...SYS });
      expect(org?.id, 'the single posture boots with a Default Organization').toBeTruthy();
      return String(org!.id);
    };

    return { ql, zoneOf, seededAdminOrganizations, defaultOrganization, settingsWrites };
  }

  it("1. a fresh dev database: the seeded admin's workspace resolves the host's zone, not the default — no dialog", async () => {
    hostZone(HOST_ZONE, HOST_ZONE);
    const { zoneOf, seededAdminOrganizations, defaultOrganization, settingsWrites } = await boot();

    // The workspace is the one the admin's session opens in, and under the
    // default `single` posture that is the Default Organization.
    const orgs = await seededAdminOrganizations();
    expect(orgs, 'the seed must land its admin in a workspace, or this case measures nothing').toEqual([
      await defaultOrganization(),
    ]);

    expect(await zoneOf(orgs[0]!)).toMatchObject({ value: HOST_ZONE, source: 'tenant' });

    // Through the settings door, for that organization — not a raw row.
    expect(settingsWrites).toHaveBeenCalledWith('localization', 'timezone', HOST_ZONE, { tenantId: orgs[0] });
  }, 30_000);

  it('2. a workspace with no zone still gets the dialog: the same boot with the seed disarmed resolves the default', async () => {
    hostZone(HOST_ZONE, HOST_ZONE);
    process.env.OS_SEED_ADMIN = '0';
    const { zoneOf, seededAdminOrganizations, defaultOrganization } = await boot();

    expect(await seededAdminOrganizations()).toEqual([]);
    expect(await zoneOf(await defaultOrganization())).toMatchObject({ value: 'UTC', source: 'default' });
  }, 30_000);

  it('3. a host that reports no zone writes nothing: the workspace keeps the default and the dialog asks', async () => {
    // An unknown TZ name: Node then resolves no zone at all (`undefined`).
    hostZone('Not/AZone', undefined);
    const { zoneOf, seededAdminOrganizations, settingsWrites } = await boot();

    const orgs = await seededAdminOrganizations();
    expect(orgs).toHaveLength(1);
    expect(await zoneOf(orgs[0]!)).toMatchObject({ value: 'UTC', source: 'default' });
    expect(settingsWrites.mock.calls.filter(([namespace]) => namespace === 'localization')).toEqual([]);
  }, 30_000);

  it('4. a zone the door refuses is not stored: ICU\'s Etc/Unknown leaves the default, and the dialog asks', async () => {
    hostZone('Etc/Unknown', 'Etc/Unknown');
    const { zoneOf, seededAdminOrganizations } = await boot();

    const orgs = await seededAdminOrganizations();
    expect(orgs).toHaveLength(1);
    expect(await zoneOf(orgs[0]!)).toMatchObject({ value: 'UTC', source: 'default' });
  }, 30_000);

  it('5. never over a set zone: a workspace that already has one keeps it', async () => {
    hostZone(HOST_ZONE, HOST_ZONE);
    const { zoneOf, seededAdminOrganizations, settingsWrites } = await boot([storedZoneAppPlugin()]);

    const orgs = await seededAdminOrganizations();
    expect(orgs).toHaveLength(1);
    expect(await zoneOf(orgs[0]!)).toMatchObject({ value: STORED_ZONE, source: 'tenant' });
    expect(settingsWrites.mock.calls.filter(([namespace]) => namespace === 'localization')).toEqual([]);
  }, 30_000);
});
