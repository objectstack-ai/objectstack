// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Layer 0 tenant write wall refuses a non-system UPDATE that leaves a
 * row with NO organization — on both SQL driver families, in the `isolated`
 * posture unless a cell says otherwise.
 *
 * ## The guarantee
 *
 * Step 3.7 of the security middleware (ADR-0095 D1) states that, outside a
 * system context and a platform administrator's posture exemption,
 * `organization_id` is effectively immutable on update: the stored row must
 * keep satisfying the same Layer 0 filter the read side uses. It judged only
 * an organization a row NAMES, so an update that EMPTIED the column was never
 * judged at all — neither as the payload was sent nor on the stored row. On an
 * ordinary tenant object such a row drops out of every reader's scope; on the
 * organization-scoped grant tables (`sys_user_position`,
 * `sys_user_permission_set`) an organization-less row is read as a grant that
 * applies in every organization (`@objectstack/core`, `grantAppliesInTenant`).
 *
 * The wall now judges the stored organization on every non-system update
 * path: an empty organization, sent or written by a hook, is refused with the
 * wall's own `PERMISSION_DENIED` / 403, and nothing is stored.
 *
 * ## What this file pins
 *
 * - the refusals: a by-id update that empties the organization of an
 *   organization-scoped grant row, on both grant tables, with `null` and with
 *   an empty string; the same from a platform administrator, whom the grant
 *   tables' posture does not exempt; the same on a predicate update and on an
 *   ordinary tenant object; and an empty organization written by a
 *   `beforeUpdate` hook (the stored-row half);
 * - the controls: the same caller's update that does not touch the column is
 *   admitted and keeps the row's organization, on both grant tables and on an
 *   ordinary tenant object; the same update as a system write lands; a
 *   platform administrator on a posture-permitting object is exempt as before,
 *   the stored-row half included; an explicit foreign organization is refused
 *   as before; the `single` posture is unchanged; and an INSERT that sends an
 *   empty organization keeps today's rule (it is the stamp's to fill) and
 *   lands in the caller's organization.
 *
 * The controls read each store as the engine writes it: on an ordinary tenant
 * object `organization_id` is the registry's injected `readonly` column, whose
 * caller-sent value the engine's static-readonly strip drops for a non-system
 * writer (a hook's value it keeps); the grant tables declare the column
 * writable, so a sent value is stored as sent.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { SysUserPosition, SysUserPermissionSet } from './objects/index.js';

/** The organization the caller holds (its active organization). */
const OWN_ORG = 'org_a';
/** An organization the caller does NOT hold. */
const OTHER_ORG = 'org_b';

const TEXT_FIELDS = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
};

const OBJECTS = [
  SysUserPosition,
  SysUserPermissionSet,
  // An ordinary public tenant object: Layer 0 walls every non-system caller on it.
  { name: 'qa_ledger', label: 'Ledger', fields: TEXT_FIELDS },
  // A PRIVATE object: its posture permits a platform administrator to cross
  // the wall (ADR-0095 D1 exemption).
  { name: 'qa_vault', label: 'Vault', access: { default: 'private' }, fields: TEXT_FIELDS },
];

/**
 * A non-platform tenant administrator: the ADR-0066 superuser wildcard, which
 * the ADR-0090 D12 gate admits to the grant tables, and no platform capability.
 */
const TENANT_ADMIN: PermissionSet = {
  name: 'qa_tenant_admin',
  label: 'Tenant administrator',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
  },
} as unknown as PermissionSet;

/** A platform operator: the superuser bit AND a platform-exclusive capability (ADR-0095 D3). */
const PLATFORM_ADMIN: PermissionSet = {
  name: 'admin_full_access',
  label: 'Platform Administrator',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
  },
  systemPermissions: ['manage_platform_settings', 'manage_metadata'],
} as unknown as PermissionSet;

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: OWN_ORG };
const ADMIN_CTX = {
  userId: 'usr_tenant_admin',
  tenantId: OWN_ORG,
  positions: [],
  permissions: ['qa_tenant_admin'],
  posture: 'TENANT_ADMIN',
};
const PLATFORM_CTX = {
  userId: 'usr_platform',
  tenantId: OWN_ORG,
  positions: [],
  permissions: ['admin_full_access'],
  posture: 'PLATFORM_ADMIN',
};

type Posture = 'isolated' | 'single';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Booted {
  engine: ObjectQL;
  /** A table's `id` / `organization_id` pairs read straight off the driver, past every scope. */
  table: (name: string) => Promise<Array<Record<string, unknown>>>;
}

const SEEDED = [
  { id: 'r1', organization_id: OWN_ORG },
  { id: 'r2', organization_id: OWN_ORG },
];

async function boot(makeDriver: () => unknown, posture: Posture = 'isolated'): Promise<Booted> {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.tenant-wall-organization-removal',
    name: 'Layer 0 tenant wall on an emptied organization',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  // The stored-row half: a hook that clears the column when asked to by name.
  for (const object of ['qa_ledger', 'qa_vault']) {
    engine.on('beforeUpdate', object, (async (ctx: { input: { data: Record<string, unknown> } }) => {
      if (ctx.input.data.name === 'detached') ctx.input.data.organization_id = null;
    }) as never);
  }

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [TENANT_ADMIN, PLATFORM_ADMIN],
    },
  };
  if (posture !== 'single') {
    services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
    services.tenancy = { posture };
  }
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'qa_tenant_admin' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  // The expected refusals log at WARN through the engine's own logger.
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const seed = (object: string, rows: Array<Record<string, unknown>>) =>
    engine.insert(object, rows as never, { context: SYS_CTX } as never);
  await seed('sys_user_position', [
    { id: 'r1', user_id: 'usr_holder', position: 'qa_position', organization_id: OWN_ORG },
    { id: 'r2', user_id: 'usr_holder', position: 'qa_other_position', organization_id: OWN_ORG },
  ]);
  await seed('sys_user_permission_set', [
    { id: 'r1', user_id: 'usr_holder', permission_set_id: 'ps_qa', organization_id: OWN_ORG },
    { id: 'r2', user_id: 'usr_holder', permission_set_id: 'ps_qa_other', organization_id: OWN_ORG },
  ]);
  for (const object of ['qa_ledger', 'qa_vault']) {
    await seed(object, [
      { id: 'r1', name: 'one', organization_id: OWN_ORG },
      { id: 'r2', name: 'two', organization_id: OWN_ORG },
    ]);
  }

  const table = async (name: string) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(name);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(name).select('id', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };

  return { engine, table };
}

const DRIVERS: Array<[string, () => unknown]> = [
  ['driver-sql (better-sqlite3 :memory:)', () =>
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never)],
  ['driver-sqlite-wasm (:memory:)', () => new SqliteWasmDriver({ filename: ':memory:' } as never)],
];

interface Outcome { ok: boolean; code?: string; status?: number; message?: string; developerMessage?: string }

const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; message?: string; developerMessage?: string };
    return {
      ok: false,
      code: err.code,
      status: err.statusCode ?? err.status,
      message: String(err.message ?? e),
      developerMessage: err.developerMessage,
    };
  }
};

/** The wall's refusal, on the ADR-0112 envelope, never a bare throw — and it names the object. */
const expectRefused = (outcome: Outcome, object: string) => {
  expect(outcome.ok, 'expected a refusal, got a completed write').toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message, 'the refusal names the object').toContain(`'${object}'`);
};

const expectAdmitted = (outcome: Outcome) =>
  expect(outcome.ok, `expected the write to be admitted: ${outcome.developerMessage ?? outcome.message}`).toBe(true);

const byId = (b: Booted, object: string, data: Record<string, unknown>, context: object = ADMIN_CTX) =>
  b.engine.update(object, data as never, { context } as never);
const predicate = (b: Booted, object: string, data: Record<string, unknown>, context: object = ADMIN_CTX) =>
  b.engine.update(object, data as never, { where: { id: 'r1' }, multi: true, context } as never);

const GRANT_TABLES = ['sys_user_position', 'sys_user_permission_set'] as const;

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`an update that empties a row's organization is refused by the Layer 0 wall — ${driverName}`, () => {
    for (const object of GRANT_TABLES) {
      it(`${object}: a by-id update that sends an empty organization is refused, and the stored row is unchanged`, async () => {
        const b = await boot(makeDriver);

        expectRefused(await attempt(() => byId(b, object, { id: 'r1', organization_id: null })), object);
        expectRefused(await attempt(() => byId(b, object, { id: 'r1', organization_id: '' })), object);

        expect(await b.table(object)).toEqual(SEEDED);
      });

      it(`${object}: a predicate update that sends an empty organization is refused, and the stored rows are unchanged`, async () => {
        const b = await boot(makeDriver);

        expectRefused(await attempt(() => predicate(b, object, { organization_id: null })), object);

        expect(await b.table(object)).toEqual(SEEDED);
      });
    }

    it('a platform administrator is walled on the grant tables (no posture exemption there): the same update is refused', async () => {
      const b = await boot(makeDriver);

      for (const object of GRANT_TABLES) {
        expectRefused(await attempt(() => byId(b, object, { id: 'r1', organization_id: null }, PLATFORM_CTX)), object);
        expect(await b.table(object)).toEqual(SEEDED);
      }
    });

    it('an ordinary tenant object: an update that sends an empty organization is refused on both update paths', async () => {
      const b = await boot(makeDriver);

      expectRefused(await attempt(() => byId(b, 'qa_ledger', { id: 'r1', organization_id: null })), 'qa_ledger');
      expectRefused(await attempt(() => predicate(b, 'qa_ledger', { organization_id: null })), 'qa_ledger');

      expect(await b.table('qa_ledger')).toEqual(SEEDED);
    });

    it('the stored row: an empty organization written by a `beforeUpdate` hook is refused on both update paths', async () => {
      const b = await boot(makeDriver);

      expectRefused(await attempt(() => byId(b, 'qa_ledger', { id: 'r1', name: 'detached' })), 'qa_ledger');
      expectRefused(await attempt(() => predicate(b, 'qa_ledger', { name: 'detached' })), 'qa_ledger');

      expect(await b.table('qa_ledger')).toEqual(SEEDED);
    });
  });

  describe(`controls — ${driverName}`, () => {
    for (const object of GRANT_TABLES) {
      it(`⭐ ${object}: the same caller's update that does not touch the organization is admitted and keeps it`, async () => {
        const b = await boot(makeDriver);

        expectAdmitted(await attempt(() => byId(b, object, { id: 'r1', reason: 'renewed' })));
        expectAdmitted(await attempt(() => predicate(b, object, { reason: 'renewed again' })));

        expect(await b.table(object)).toEqual(SEEDED);
      });

      it(`⭐ ${object}: the same update as a system write lands, as today`, async () => {
        const b = await boot(makeDriver);

        expectAdmitted(await attempt(() => byId(b, object, { id: 'r1', organization_id: null }, SYS_CTX)));

        expect((await b.table(object))[0]).toEqual({ id: 'r1', organization_id: null });
      });

      it(`${object}: an explicit foreign organization is refused, as today`, async () => {
        const b = await boot(makeDriver);

        expectRefused(await attempt(() => byId(b, object, { id: 'r1', organization_id: OTHER_ORG })), object);

        expect(await b.table(object)).toEqual(SEEDED);
      });
    }

    it('⭐ an ordinary tenant object: the same caller\'s update that does not touch the organization is admitted and keeps it', async () => {
      const b = await boot(makeDriver);

      expectAdmitted(await attempt(() => byId(b, 'qa_ledger', { id: 'r1', name: 'renamed' })));
      expectAdmitted(await attempt(() => predicate(b, 'qa_ledger', { name: 'renamed again' })));

      expect(await b.table('qa_ledger')).toEqual(SEEDED);
    });

    // On an ordinary tenant object `organization_id` is the registry's
    // injected `readonly` column, and the engine's static-readonly strip drops
    // a non-system caller's value for it before the statement — wall or no
    // wall. So a caller-SENT empty organization never reaches that row's store
    // on an admitted write; a HOOK-written one does (the strip keeps a hook's
    // write). The grant tables declare the column themselves, not `readonly`,
    // so a sent value is stored as sent. The controls below read each
    // object's store accordingly.
    it('⭐ a platform administrator on a posture-permitting object is exempt, as today, the stored-row half included', async () => {
      const b = await boot(makeDriver);

      expectAdmitted(await attempt(() => byId(b, 'qa_vault', { id: 'r1', name: 'detached' }, PLATFORM_CTX)));
      expectAdmitted(await attempt(() => byId(b, 'qa_vault', { id: 'r2', organization_id: null }, PLATFORM_CTX)));

      expect(await b.table('qa_vault')).toEqual([
        { id: 'r1', organization_id: null },
        { id: 'r2', organization_id: OWN_ORG },
      ]);
    });

    it('⭐ the `single` posture is unchanged: no wall, so an emptied organization is admitted and stored as the engine stores it', async () => {
      const b = await boot(makeDriver, 'single');
      const organizationField = (object: string) =>
        (b.engine.getSchema(object) as { fields: Record<string, { readonly?: boolean }> }).fields.organization_id;
      expect(organizationField('qa_ledger').readonly, 'the injected column is readonly').toBe(true);
      expect(organizationField('sys_user_position').readonly ?? false, 'the grant table declares it writable').toBe(false);

      expectAdmitted(await attempt(() => byId(b, 'sys_user_position', { id: 'r1', organization_id: null })));
      expectAdmitted(await attempt(() => byId(b, 'qa_ledger', { id: 'r1', name: 'detached' })));
      expectAdmitted(await attempt(() => byId(b, 'qa_ledger', { id: 'r2', organization_id: null })));

      expect((await b.table('sys_user_position'))[0]).toEqual({ id: 'r1', organization_id: null });
      expect(await b.table('qa_ledger')).toEqual([
        { id: 'r1', organization_id: null },
        { id: 'r2', organization_id: OWN_ORG },
      ]);
    });

    it('⭐ an INSERT that sends an empty organization keeps today’s rule: the platform fills it with the caller’s organization', async () => {
      const b = await boot(makeDriver);

      expectAdmitted(await attempt(() =>
        b.engine.insert('qa_ledger', { id: 'r3', name: 'new', organization_id: null } as never, { context: ADMIN_CTX } as never)));
      expectAdmitted(await attempt(() =>
        b.engine.insert('qa_ledger', [{ id: 'r4', name: 'newer', organization_id: '' }] as never, { context: ADMIN_CTX } as never)));

      const stored = await b.table('qa_ledger');
      expect(stored.find((r) => r.id === 'r3')).toEqual({ id: 'r3', organization_id: OWN_ORG });
      expect(stored.find((r) => r.id === 'r4')).toEqual({ id: 'r4', organization_id: OWN_ORG });
    });
  });
}
