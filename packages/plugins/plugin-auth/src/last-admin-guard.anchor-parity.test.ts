// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D1/D5] The guard and the resolver read ONE anchor, in every
 * composition — the parity the guard's header declares ("the enumeration
 * answers the SAME question the derivation does"), measured against the
 * resolver itself rather than restated.
 *
 * `resolveAuthzContext` gives an `admin_full_access` grant platform standing
 * only under `single`, and only when the Default Organization owns it
 * (`grantAnchorsPlatformStanding`). An organization-less grant anchors nothing,
 * and a composition that registers no organization object has no Default
 * Organization, so no grant anchors there. A guard that still counted the
 * organization-less row believed an administrator remained where none did, and
 * let a write take the deployment's last platform administrator — the
 * fail-open this file pins shut.
 *
 * Every case runs a REAL {@link ObjectQL} engine over better-sqlite3
 * `:memory:`, registers the real guard, and asks the real resolver. Three
 * things are pinned:
 *
 *  1. **Where the row can exist.** Through the engine, an organization-less
 *     grant is derived or refused wherever the organization object is
 *     registered (ADR-0131 D9), and refused by the NOT NULL column a fresh SQL
 *     table carries (D1) where it is not. What can still hold one is a column
 *     that is NOT NULL nowhere: a store built before 18.x, or a driver that
 *     enforces no NOT NULL (driver-memory, measured on #24883), in a lean
 *     embedding that registers no organization object or beneath the engine.
 *     The nullable column stands in for both here.
 *  2. **The negative pin** — in both shapes, with a verified `OS_PLATFORM_OWNER_EMAIL`
 *     account as the resolver's only platform administrator and an
 *     organization-less grant holder beside it, banning that administrator is
 *     REFUSED.
 *  3. **The positive control** — the Default Organization's grant still
 *     anchors: its holder is the resolver's administrator, and the guard
 *     protects them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo, resolveAuthzContext } from '@objectstack/core';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';

import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { relaxEveryRegisteredTenantColumn } from './pre-18-tenant-column.testkit.js';

const SYSTEM = { context: { isSystem: true } } as const;
const OWNER = 'owner@corp.example';
const DEFAULT_ORG = 'org_default';
const ENV = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_PLATFORM_OWNER_EMAIL'] as const;

const text = (name: string) => ({ name, type: 'text' as const });
const sysUser = {
  name: 'sys_user',
  label: 'User',
  managedBy: 'better-auth',
  fields: {
    id: { ...text('id'), primaryKey: true },
    name: text('name'),
    email: text('email'),
    email_verified: { name: 'email_verified', type: 'boolean' as const },
    banned: { name: 'banned', type: 'boolean' as const, readonly: true },
  },
};
const sysMember = {
  name: 'sys_member',
  label: 'Member',
  managedBy: 'better-auth',
  fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), organization_id: text('organization_id'), role: text('role') },
};
const sysOrganization = {
  name: 'sys_organization',
  label: 'Organization',
  managedBy: 'better-auth',
  fields: { id: { ...text('id'), primaryKey: true }, name: text('name'), slug: text('slug') },
};
const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { ...text('id'), primaryKey: true },
    user_id: text('user_id'),
    permission_set: text('permission_set'),
    organization_id: text('organization_id'),
    valid_from: { name: 'valid_from', type: 'datetime' as const },
    valid_until: { name: 'valid_until', type: 'datetime' as const },
  },
};
/** Read by the resolver alongside the grants; no case seeds it. */
const sysUserPosition = {
  name: 'sys_user_position',
  label: 'User Position',
  fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), position: text('position'), organization_id: text('organization_id') },
};

interface Rig {
  engine: ObjectQL;
  /** The driver itself, for the rows only a store built before 18.x holds. */
  driver: { create(object: string, row: Record<string, unknown>): Promise<unknown> };
}

let engines: ObjectQL[] = [];
let ambient: Record<string, string | undefined> = {};

beforeEach(() => {
  ambient = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
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

async function boot(opts: { organizationObject: boolean; nullableTenantColumn?: boolean }): Promise<Rig> {
  const engine = new ObjectQL();
  engines.push(engine);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  const objects = [sysUser, sysMember, sysUserPermissionSet, sysUserPosition, ...(opts.organizationObject ? [sysOrganization] : [])];
  for (const o of objects) engine.registry.registerObject(o as never);
  await engine.syncSchemas();
  // A tenant column that is NOT NULL nowhere: a store built before 18.x has one
  // (ADR-0131 D1 makes a fresh one NOT NULL), and so does a driver that
  // enforces no NOT NULL.
  if (opts.nullableTenantColumn) await relaxEveryRegisteredTenantColumn(engine);
  bindTestSecurityCatalog(engine, { permissions: [{ name: ADMIN_FULL_ACCESS }] });
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.last-admin-guard-parity' });
  return { engine, driver: driver as unknown as Rig['driver'] };
}

async function seedUser(engine: ObjectQL, id: string, email: string): Promise<void> {
  await engine.insert('sys_user', { id, name: id, email, email_verified: true, banned: false }, SYSTEM);
}

/** An organization-less `admin_full_access` grant, through the engine. */
const insertOrganizationLessGrant = (engine: ObjectQL, userId: string) =>
  engine.insert('sys_user_permission_set', { id: `ups_${userId}`, user_id: userId, permission_set: ADMIN_FULL_ACCESS }, SYSTEM);

/** Does the resolver grade `userId` a platform administrator? */
async function resolverStanding(engine: ObjectQL, userId: string, email?: string): Promise<boolean> {
  const ctx = await resolveAuthzContext({
    ql: engine,
    headers: {},
    getSession: () => ({ user: { id: userId, email }, session: { userId } }),
  } as never);
  return ctx.positions.includes('platform_admin');
}

const ban = (engine: ObjectQL, id: string) => engine.update('sys_user', { id, banned: true }, SYSTEM);

/** The refusal envelope, or `undefined` when the write landed. */
async function refusalOf(write: Promise<unknown>): Promise<{ code?: unknown; status?: unknown } | undefined> {
  try {
    await write;
    return undefined;
  } catch (err) {
    const e = err as { code?: unknown; status?: unknown };
    return { code: e.code, status: e.status };
  }
}

describe('[ADR-0131 D1/D9] where an organization-less admin_full_access grant can still be written', () => {
  type Expect = 'derived' | 'refused-d9' | 'refused-not-null' | 'stored-null';
  type Column = 'fresh' | 'nullable';
  const cases: Array<{ column: Column; organizations: number | 'no-object'; posture: 'single' | 'isolated'; expected: Expect }> = [
    { column: 'fresh', organizations: 'no-object', posture: 'single', expected: 'refused-not-null' },
    { column: 'fresh', organizations: 0, posture: 'single', expected: 'refused-d9' },
    { column: 'fresh', organizations: 1, posture: 'single', expected: 'derived' },
    { column: 'fresh', organizations: 2, posture: 'single', expected: 'refused-d9' },
    { column: 'fresh', organizations: 0, posture: 'isolated', expected: 'refused-d9' },
    { column: 'fresh', organizations: 1, posture: 'isolated', expected: 'refused-d9' },
    { column: 'fresh', organizations: 2, posture: 'isolated', expected: 'refused-d9' },
    // The engine's no-organization-object exit (ADR-0131 D9) leaves the row
    // organization-less; only the column could refuse it.
    { column: 'nullable', organizations: 'no-object', posture: 'single', expected: 'stored-null' },
    { column: 'nullable', organizations: 1, posture: 'single', expected: 'derived' },
    { column: 'nullable', organizations: 1, posture: 'isolated', expected: 'refused-d9' },
  ];

  for (const c of cases) {
    it(`${c.column} tenant column, ${c.organizations === 'no-object' ? 'no organization object' : `${c.organizations} organization(s)`}, ${c.posture}: ${c.expected} — and the guard agrees with the resolver about its holder`, async () => {
      process.env.OS_TENANCY_POSTURE = c.posture;
      const { engine, driver } = await boot({
        organizationObject: c.organizations !== 'no-object',
        nullableTenantColumn: c.column === 'nullable',
      });
      const organizations = typeof c.organizations === 'number' ? c.organizations : 0;
      // Written beneath the engine, before anything has asked it about
      // organizations: its probe reads the table at the grant insert below.
      if (organizations >= 1) await driver.create('sys_organization', { id: DEFAULT_ORG, name: 'Default', slug: 'default' });
      if (organizations >= 2) await driver.create('sys_organization', { id: 'org_b', name: 'B', slug: 'b' });
      await seedUser(engine, 'usr_holder', 'holder@corp.example');

      const refusal = await refusalOf(insertOrganizationLessGrant(engine, 'usr_holder'));
      const rows = (await engine.find('sys_user_permission_set', { where: {} }, SYSTEM)) as Array<Record<string, unknown>>;
      if (c.expected === 'refused-d9') {
        expect(refusal?.code).toBe('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
        expect(rows).toEqual([]);
      } else if (c.expected === 'refused-not-null') {
        expect(refusal?.code).toBe('SQLITE_CONSTRAINT_NOTNULL');
        expect(rows).toEqual([]);
      } else if (c.expected === 'derived') {
        expect(refusal).toBeUndefined();
        expect(rows.map((r) => r.organization_id)).toEqual([DEFAULT_ORG]);
      } else {
        expect(refusal).toBeUndefined();
        expect(rows.map((r) => r.organization_id ?? null)).toEqual([null]);
      }

      // Parity: the holder is the only candidate, so the guard refuses to ban
      // them exactly when it counts them — and it must count them exactly when
      // the resolver grades them a platform administrator.
      const isAdmin = await resolverStanding(engine, 'usr_holder');
      expect(isAdmin).toBe(c.expected === 'derived' && c.posture === 'single');
      const banRefusal = await refusalOf(ban(engine, 'usr_holder'));
      expect(banRefusal?.code).toBe(isAdmin ? 'PERMISSION_DENIED' : undefined);
    });
  }
});

describe('[ADR-0131 D5] the negative pin: an organization-less holder is no survivor', () => {
  /** The resolver's only platform administrator (config) beside an organization-less grant holder. */
  async function seedTwoCandidates(rig: Rig, viaDriver: boolean): Promise<void> {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER;
    resetPlatformAdminEmailMemo();
    await seedUser(rig.engine, 'usr_owner', OWNER);
    await seedUser(rig.engine, 'usr_legacy', 'legacy@corp.example');
    if (viaDriver) {
      await rig.driver.create('sys_user_permission_set', { id: 'ups_legacy', user_id: 'usr_legacy', permission_set: ADMIN_FULL_ACCESS });
    } else {
      await insertOrganizationLessGrant(rig.engine, 'usr_legacy');
    }
    expect(await resolverStanding(rig.engine, 'usr_owner', OWNER), 'the owner is the resolver\'s administrator').toBe(true);
    expect(await resolverStanding(rig.engine, 'usr_legacy'), 'the holder is no administrator to the resolver').toBe(false);
  }

  it('⭐ a lean embedding (no sys_organization) whose tenant column is NOT NULL nowhere: banning the only platform administrator is REFUSED', async () => {
    process.env.OS_TENANCY_POSTURE = 'single';
    const rig = await boot({ organizationObject: false, nullableTenantColumn: true });
    await seedTwoCandidates(rig, false);

    await expect(ban(rig.engine, 'usr_owner')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    const row = await rig.engine.findOne('sys_user', { where: { id: 'usr_owner' }, fields: ['id', 'banned'] }, SYSTEM);
    expect(row?.banned).toBeFalsy();
  });

  it('⭐ a store built before 18.x (sys_organization registered, the row beneath the engine): the same ban is REFUSED', async () => {
    process.env.OS_TENANCY_POSTURE = 'single';
    const rig = await boot({ organizationObject: true, nullableTenantColumn: true });
    await rig.driver.create('sys_organization', { id: DEFAULT_ORG, name: 'Default', slug: 'default' });
    await seedTwoCandidates(rig, true);

    await expect(ban(rig.engine, 'usr_owner')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    const row = await rig.engine.findOne('sys_user', { where: { id: 'usr_owner' }, fields: ['id', 'banned'] }, SYSTEM);
    expect(row?.banned).toBeFalsy();
  });
});

describe('[ADR-0131 D5] the positive control: the Default Organization\'s grant still anchors', () => {
  it('its holder is the resolver\'s administrator and the guard protects them; a second administrator makes the write legal', async () => {
    process.env.OS_TENANCY_POSTURE = 'single';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER;
    resetPlatformAdminEmailMemo();
    const { engine } = await boot({ organizationObject: true });
    await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default Organization', slug: 'default' }, SYSTEM);
    await seedUser(engine, 'usr_promoted', 'promoted@corp.example');
    await engine.insert(
      'sys_user_permission_set',
      { id: 'ups_promoted', user_id: 'usr_promoted', permission_set: ADMIN_FULL_ACCESS, organization_id: DEFAULT_ORG },
      SYSTEM,
    );
    expect(await resolverStanding(engine, 'usr_promoted')).toBe(true);

    // The only administrator: refused.
    await expect(ban(engine, 'usr_promoted')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });

    // With the config owner beside them, each is a survivor for the other.
    await seedUser(engine, 'usr_owner', OWNER);
    expect(await resolverStanding(engine, 'usr_owner', OWNER)).toBe(true);
    await expect(ban(engine, 'usr_owner')).resolves.toBeDefined();
    await expect(ban(engine, 'usr_promoted')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });
});
