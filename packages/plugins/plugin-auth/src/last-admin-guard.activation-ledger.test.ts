// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4, ADR-0126 §4] The last-administrator guard reads the two
 * facts the resolver derives a grant-anchored platform administrator from, in
 * the two places the resolver reads them: the `admin_full_access` DEFINITION
 * in the security catalog bound to the engine, and its SWITCH in the
 * activation ledger (`sys_metadata_activation`). A ledger write that would
 * switch the set off is judged like every other standing write — refused only
 * when it leaves nobody who can sign in (the both-ways pins live in
 * `last-admin-guard.re-pricing.test.ts`); these are the ledger half's own
 * edges, on a real ObjectQL engine over better-sqlite3 `:memory:`, so the
 * engine dispatches the hooks and the store decides how booleans come back.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';

import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const SYSTEM = { context: { isSystem: true } } as const;
const text = { type: 'text' as const };

const objects = [
  {
    name: 'sys_user',
    label: 'User',
    managedBy: 'better-auth',
    fields: {
      id: { ...text, name: 'id', primaryKey: true },
      name: { ...text, name: 'name' },
      email: { ...text, name: 'email' },
      banned: { name: 'banned', type: 'boolean' as const, readonly: true },
    },
  },
  {
    name: 'sys_member',
    label: 'Member',
    managedBy: 'better-auth',
    fields: {
      id: { ...text, name: 'id', primaryKey: true },
      user_id: { ...text, name: 'user_id' },
      organization_id: { ...text, name: 'organization_id' },
      role: { ...text, name: 'role' },
    },
  },
  {
    name: 'sys_user_permission_set',
    label: 'User Permission Set',
    fields: {
      id: { ...text, name: 'id', primaryKey: true },
      user_id: { ...text, name: 'user_id' },
      permission_set_id: { ...text, name: 'permission_set_id' },
      permission_set: { ...text, name: 'permission_set' },
      organization_id: { ...text, name: 'organization_id' },
      valid_from: { name: 'valid_from', type: 'datetime' as const },
      valid_until: { name: 'valid_until', type: 'datetime' as const },
    },
  },
  {
    name: 'sys_metadata_activation',
    label: 'Metadata Activation',
    fields: {
      id: { ...text, name: 'id', primaryKey: true },
      metadata_type: { ...text, name: 'metadata_type' },
      name: { ...text, name: 'name' },
      package_id: { ...text, name: 'package_id' },
      active: { name: 'active', type: 'boolean' as const },
    },
  },
];

let engines: ObjectQL[] = [];
let ambient: Record<string, string | undefined> = {};
const ENV = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_PLATFORM_OWNER_EMAIL'];

beforeEach(() => {
  ambient = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.OS_TENANCY_POSTURE = 'single';
  delete process.env.OS_MULTI_ORG_ENABLED;
  delete process.env.OS_PLATFORM_OWNER_EMAIL;
  resetPlatformAdminEmailMemo();
});

afterEach(async () => {
  for (const [k, v] of Object.entries(ambient)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPlatformAdminEmailMemo();
  const open = engines;
  engines = [];
  for (const e of open) {
    try { await e.destroy(); } catch { /* noop */ }
  }
});

interface Boot {
  /** The catalog's permission definitions; `undefined` binds no catalog at all. */
  permissions?: string[];
  /** Wrap the engine the GUARD reads through (hooks stay on the real one). */
  readThrough?: (engine: ObjectQL) => LastAdminGuardEngine;
}

async function boot(opts: Boot = { permissions: [ADMIN_FULL_ACCESS] }): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o as never);
  await engine.syncSchemas();
  const guardEngine = opts.readThrough?.(engine) ?? (engine as unknown as LastAdminGuardEngine);
  if (opts.permissions) {
    const catalog = { permissions: opts.permissions.map((name) => ({ name })) };
    bindTestSecurityCatalog(engine, catalog);
    bindTestSecurityCatalog(guardEngine, catalog);
  }
  registerLastAdminGuard(guardEngine, { packageId: 'test.last-admin-guard-ledger' });
  return engine;
}

async function seedGrantAdmin(engine: ObjectQL, id = 'usr_admin'): Promise<void> {
  await engine.insert('sys_user', { id, name: id, email: `${id}@corp.example`, banned: false }, SYSTEM);
  await engine.insert(
    'sys_user_permission_set',
    { id: `ups_${id}`, user_id: id, permission_set_id: 'ps_admin', permission_set: ADMIN_FULL_ACCESS },
    SYSTEM,
  );
}

const ledgerRow = (id: string, metadataType: string, name: string, active: unknown) =>
  ({ id, metadata_type: metadataType, name, package_id: 'pkg', active });

const readLedger = async (engine: ObjectQL, id: string) =>
  (await engine.findOne('sys_metadata_activation', { where: { id } }, SYSTEM)) as Record<string, unknown> | null;

describe('[ADR-0131 D3] the ledger half — what a ledger write can and cannot take away', () => {
  it('refuses switching the last administrator\'s set off — the driver 0 spelling included', async () => {
    for (const active of [false, 0]) {
      const engine = await boot();
      await seedGrantAdmin(engine);
      await expect(
        engine.insert('sys_metadata_activation', ledgerRow('act_admin', 'permission', ADMIN_FULL_ACCESS, active), SYSTEM),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: 'sys_metadata_activation' });
      expect(await readLedger(engine, 'act_admin')).toBeFalsy();
    }
  });

  it('CONTROL — another set, a position or a flow of the same name switched off, or the set switched ON, all land', async () => {
    const engine = await boot();
    await seedGrantAdmin(engine);
    const rows = [
      ledgerRow('act_other', 'permission', 'crm_full', false),
      ledgerRow('act_position', 'position', ADMIN_FULL_ACCESS, false),
      ledgerRow('act_flow', 'flow', ADMIN_FULL_ACCESS, false),
      ledgerRow('act_on', 'permission', ADMIN_FULL_ACCESS, true),
    ];
    for (const row of rows) {
      await expect(engine.insert('sys_metadata_activation', row, SYSTEM)).resolves.toBeDefined();
    }
    for (const row of rows) expect(await readLedger(engine, row.id)).toBeTruthy();
  });

  it('a second administrator left standing permits the switch-off — the flat refusal is gone', async () => {
    const engine = await boot();
    await seedGrantAdmin(engine);
    await engine.insert('sys_user', { id: 'usr_owner', name: 'usr_owner', email: 'o@corp.example', banned: false }, SYSTEM);
    await engine.insert('sys_member', { id: 'mem_owner', user_id: 'usr_owner', organization_id: 'org_1', role: 'owner' }, SYSTEM);

    await expect(
      engine.insert('sys_metadata_activation', ledgerRow('act_admin', 'permission', ADMIN_FULL_ACCESS, false), SYSTEM),
    ).resolves.toBeDefined();
    expect((await readLedger(engine, 'act_admin'))?.active).toBeFalsy();
  });

  it('a ledger read that fails refuses the write it was asked about — fail closed', async () => {
    const engine = await boot({
      permissions: [ADMIN_FULL_ACCESS],
      readThrough: (real) => ({
        registerHook: (event, handler, options) => real.registerHook(event, handler, options),
        find: async (object, query, options) => {
          if (object === 'sys_metadata_activation') throw new Error('the ledger is unreachable');
          return real.find(object, query as never, options as never) as never;
        },
      }),
    });
    await seedGrantAdmin(engine);
    await seedGrantAdmin(engine, 'usr_second');
    // Two administrators — this ban WOULD be legal. It is refused anyway.
    await expect(engine.update('sys_user', { id: 'usr_second', banned: true }, SYSTEM))
      .rejects.toThrow(/the ledger is unreachable/);
  });
});

describe('[ADR-0131 D3/D4] the emptied-not-fresh diagnosis reads the catalog and the ledger', () => {
  it('a switched-off set is an EMPTIED environment: a ban is refused, naming the switch', async () => {
    const engine = await boot();
    // Switched off before any grant names it: the guard reads a fresh environment then.
    await engine.insert('sys_metadata_activation', ledgerRow('act_admin', 'permission', ADMIN_FULL_ACCESS, false), SYSTEM);
    await seedGrantAdmin(engine);

    await expect(engine.update('sys_user', { id: 'usr_admin', banned: true }, SYSTEM))
      .rejects.toThrow(/switched OFF in 'sys_metadata_activation'/);
  });

  it('…and switching it back on is the way out: the restoring write lands', async () => {
    const engine = await boot();
    await engine.insert('sys_metadata_activation', ledgerRow('act_admin', 'permission', ADMIN_FULL_ACCESS, false), SYSTEM);
    await seedGrantAdmin(engine);

    await expect(engine.update('sys_metadata_activation', { id: 'act_admin', active: true }, SYSTEM)).resolves.toBeDefined();
    expect((await readLedger(engine, 'act_admin'))?.active).toBeTruthy();
  });

  it('a grant naming a set the catalog does not hold is DANGLING: the ban is refused, not waved through', async () => {
    const engine = await boot({ permissions: ['member_default'] });
    await seedGrantAdmin(engine);
    await expect(engine.update('sys_user', { id: 'usr_admin', banned: true }, SYSTEM))
      .rejects.toThrow(/security catalog does not hold/);
  });

  it('an engine with NO catalog bound counts no grant-anchored administrator — as the resolver grants none', async () => {
    const engine = await boot({});
    await seedGrantAdmin(engine);
    await expect(engine.update('sys_user', { id: 'usr_admin', banned: true }, SYSTEM))
      .rejects.toThrow(/security catalog does not hold/);
  });

  it('CONTROL — a genuinely fresh environment is still the bootstrap window', async () => {
    const engine = await boot();
    await engine.insert('sys_user', { id: 'usr_first', name: 'usr_first', email: 'f@corp.example', banned: false }, SYSTEM);
    await expect(engine.update('sys_user', { id: 'usr_first', banned: true }, SYSTEM)).resolves.toBeDefined();
  });
});
