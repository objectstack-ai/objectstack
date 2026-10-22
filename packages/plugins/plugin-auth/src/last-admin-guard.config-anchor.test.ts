// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11663 L2 / cloud ADR-0024 D5.2] The break-glass guard's FIFTH write shape:
 * an ordinary `sys_user` profile write that moves the row off the deployment's
 * declared administrator list.
 *
 * The platform-admin re-anchor gave `resolveAuthzContext` a second anchor
 * beside the Default Organization's `admin_full_access` grant — a `sys_user` row whose own
 * `email` is on `OS_PLATFORM_OWNER_EMAIL` AND whose `email_verified` reads
 * verified. Two consequences this file pins, because they are the two halves of
 * one invariant and each is silently wrong without the other:
 *
 *  1. **The enumeration must SEE those administrators.** `resolveAdminUserIds`
 *     counts them through the resolver's own `matchesConfiguredPlatformAdmin`,
 *     so an environment whose only administrator is config-derived is not read
 *     as an environment with none.
 *  2. **The guard must JUDGE the writes that revoke them.** A change of address
 *     and an `email_verified` reset each take the standing away with no ban, no
 *     delete and no grant table touched — invisible to all four earlier halves.
 *
 * Same method as `last-admin-guard.test.ts` next door and for the same reason:
 * a REAL {@link ObjectQL} engine over better-sqlite3 `:memory:`, so the engine
 * dispatches the hook, the SQL builder compiles the `$in`, and sqlite decides
 * how the booleans come back (`email_verified` stores 0/1 here, which is
 * exactly the representation `isEmailVerifiedUserRow`'s allow-list exists for).
 * A fake engine would put the fixture, not the product, in charge of which rows
 * the guard sees.
 *
 * Reverse verification, recorded because the direction is not obvious: with
 * `registerLastAdminGuard` NOT called, every refusal below is a write that
 * SUCCEEDS — the row comes back with the new address, or with
 * `email_verified = 0`. The `unguarded` cases at the bottom re-run it on the
 * same fixtures rather than describing it.
 *
 * ⚠️ [#11663 L5] A THIRD consequence joined those two, and the suite at the end
 * of this file is it: the grant anchor is now POSTURE-KEYED. Under a walled
 * posture no `admin_full_access` grant confers anything, so the
 * enumeration must not count it — an enumeration that does would permit exactly
 * the write that ends the last CONFIG-anchored administrator's standing. Every
 * arm in this file therefore declares its posture rather than inheriting the
 * ambient one: before L5 the answer was posture-independent and reading the
 * environment was harmless, and after it a suite that leaves the posture unset
 * is measuring whatever the box happens to export.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';

import { registerLastAdminGuard, USER_STANDING_KEYS, type LastAdminGuardEngine } from './last-admin-guard.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { relaxEveryRegisteredTenantColumn } from './pre-18-tenant-column.testkit.js';

const ENV = 'OS_PLATFORM_OWNER_EMAIL';
/**
 * [#11663 L5] The two inputs `resolveTenancyPosture()` reads, in its order:
 * `OS_TENANCY_POSTURE` when set, else `OS_MULTI_ORG_ENABLED` (truthy ⇒
 * `isolated`), else `single`. BOTH are driven here, never just the canonical
 * one — an arm that pinned only the first would inherit whatever the ambient
 * environment carries for the second.
 */
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const MULTI_ORG_ENV = 'OS_MULTI_ORG_ENABLED';
const SYSTEM = { context: { isSystem: true } } as const;
const OWNER = 'owner@corp.example';
const SECOND = 'second@corp.example';
/** [ADR-0131 D5] The Default Organization (`slug = 'default'`), the owner of a grant that anchors under `single`. */
const DEFAULT_ORG = 'org_default';

const sysUser = {
  name: 'sys_user',
  label: 'User',
  managedBy: 'better-auth',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    email: { name: 'email', type: 'text' as const },
    // The column the config anchor gates on. Declared `boolean`, so on this
    // real sqlite database it stores as 0/1.
    email_verified: { name: 'email_verified', type: 'boolean' as const },
    ai_access: { name: 'ai_access', type: 'boolean' as const },
    banned: { name: 'banned', type: 'boolean' as const, readonly: true },
  },
};

const sysMember = {
  name: 'sys_member',
  label: 'Member',
  managedBy: 'better-auth',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    role: { name: 'role', type: 'text' as const },
  },
};

/** [ADR-0131 D5] The organization object, so the Default Organization the anchor reads exists. */
const sysOrganization = {
  name: 'sys_organization',
  label: 'Organization',
  managedBy: 'better-auth',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    slug: { name: 'slug', type: 'text' as const },
  },
};

const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    label: { name: 'label', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
  },
};

/** [ADR-0131 D3, ADR-0126 §4] The activation ledger a permission set is switched off in. */
const sysMetadataActivation = {
  name: 'sys_metadata_activation',
  label: 'Metadata Activation',
  // Deployment-level, as the platform object declares it: no organization column.
  systemFields: { tenant: false },
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    metadata_type: { name: 'metadata_type', type: 'text' as const },
    name: { name: 'name', type: 'text' as const },
    package_id: { name: 'package_id', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
  },
};

/** Switch `admin_full_access` off in the ledger — before any grant names it, so the guard reads a fresh environment. */
async function switchAdminSetOff(engine: ObjectQL): Promise<void> {
  await engine.insert(
    'sys_metadata_activation',
    { id: 'act_admin', metadata_type: 'permission', name: ADMIN_FULL_ACCESS, package_id: 'pkg', active: false },
    SYSTEM,
  );
}

const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    // [ADR-0131 D4] The grant's set BY NAME — the column the guard reads.
    permission_set: { name: 'permission_set', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    valid_from: { name: 'valid_from', type: 'datetime' as const },
    valid_until: { name: 'valid_until', type: 'datetime' as const },
  },
};

let engines: ObjectQL[] = [];
let ambient: string | undefined;
let ambientPosture: string | undefined;
let ambientMultiOrg: string | undefined;

beforeEach(() => {
  ambient = process.env[ENV];
  ambientPosture = process.env[POSTURE_ENV];
  ambientMultiOrg = process.env[MULTI_ORG_ENV];
  delete process.env[ENV];
  delete process.env[POSTURE_ENV];
  delete process.env[MULTI_ORG_ENV];
  resetPlatformAdminEmailMemo();
});

afterEach(async () => {
  if (ambient === undefined) delete process.env[ENV];
  else process.env[ENV] = ambient;
  if (ambientPosture === undefined) delete process.env[POSTURE_ENV];
  else process.env[POSTURE_ENV] = ambientPosture;
  if (ambientMultiOrg === undefined) delete process.env[MULTI_ORG_ENV];
  else process.env[MULTI_ORG_ENV] = ambientMultiOrg;
  resetPlatformAdminEmailMemo();
  const open = engines;
  engines = [];
  for (const e of open) {
    try { await e.destroy(); } catch { /* noop */ }
  }
});

/** Declare the deployment's administrators and drop the memo keyed on the raw value. */
function declare(value: string | undefined): void {
  if (value === undefined) delete process.env[ENV];
  else process.env[ENV] = value;
  resetPlatformAdminEmailMemo();
}

/**
 * [#11663 L5] Declare the REQUESTED tenancy posture for one arm. `undefined`
 * clears BOTH inputs, which is how a rig that configured no tenancy at all is
 * spelled — and that rig resolves `single`, the default. There is no memo to
 * drop: `resolveTenancyPosture()` re-reads the environment on every call.
 */
function requestPosture(value: 'single' | 'group' | 'isolated' | undefined): void {
  delete process.env[MULTI_ORG_ENV];
  if (value === undefined) delete process.env[POSTURE_ENV];
  else process.env[POSTURE_ENV] = value;
}

async function boot(opts: { unguarded?: boolean; legacyStore?: boolean } = {}): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  driverOf.set(engine, driver);
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [sysUser, sysMember, sysOrganization, sysPermissionSet, sysUserPermissionSet, sysMetadataActivation]) {
    engine.registry.registerObject(o as never);
  }
  await engine.syncSchemas();
  await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default Organization', slug: 'default' }, SYSTEM);
  // An organization-less row ({@link seedLegacyRow}) exists only on a store
  // built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT NULL): the
  // cases that seed one ask for that store.
  if (opts.legacyStore) await relaxEveryRegisteredTenantColumn(engine);
  // [ADR-0131 D3/D4] The set a grant names is the catalog's definition.
  bindTestSecurityCatalog(engine, { permissions: [{ name: ADMIN_FULL_ACCESS }] });
  if (!opts.unguarded) {
    registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.last-admin-guard' });
  }
  return engine;
}

/** The driver behind each booted engine, for {@link seedLegacyRow}. */
const driverOf = new WeakMap<ObjectQL, SqlDriver>();

/**
 * [#11663 L5] Seed an organization-less legacy row — an `admin_full_access`
 * grant owned by no organization, and its catalog row — as a database written
 * before 18.x holds it (boot with `legacyStore`). No system write can create
 * such a row any more: the engine derives the Default Organization under
 * `single` and refuses the insert under a wall (ADR-0131 D9), so it goes
 * straight through the driver.
 */
async function seedLegacyRow(engine: ObjectQL, object: string, row: Record<string, unknown>): Promise<void> {
  await driverOf.get(engine)!.create(object, row as never);
}

async function seedUser(
  engine: ObjectQL,
  id: string,
  email: string,
  verified: boolean,
): Promise<void> {
  await engine.insert(
    'sys_user',
    { id, name: id, email, email_verified: verified, banned: false },
    SYSTEM,
  );
}

async function readUser(engine: ObjectQL, id: string): Promise<Record<string, unknown> | undefined> {
  return (await engine.findOne(
    'sys_user',
    { where: { id }, fields: ['id', 'email', 'email_verified'] },
    SYSTEM,
  )) as Record<string, unknown> | undefined;
}

describe('[#11663 L2] the enumeration counts CONFIG-derived administrators', () => {
  it('an environment whose only administrator is config-derived is not "empty"', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await seedUser(engine, 'usr_other', 'other@corp.example', true);

    // With the owner counted, deleting an ORDINARY user leaves an
    // administrator behind and is allowed. If the enumeration could not see
    // the config anchor it would read zero administrators here, and the
    // bootstrap exemption would wave every write through — the failure mode
    // #6084 already paid for once.
    await expect(engine.delete('sys_user', { where: { id: 'usr_other' }, ...SYSTEM })).resolves.toBeDefined();
    expect(await readUser(engine, 'usr_other')).toBeFalsy();

    // …and deleting the administrator themselves is refused.
    await expect(
      engine.delete('sys_user', { where: { id: 'usr_owner' }, ...SYSTEM }),
    ).rejects.toThrow(/last administrator/i);
    expect(await readUser(engine, 'usr_owner')).toBeTruthy();
  });

  it('an UNVERIFIED account holding the configured address is NOT counted', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, false);
    await seedUser(engine, 'usr_grant', 'granted@corp.example', true);
    await engine.insert('sys_permission_set', { id: 'ps_a', name: ADMIN_FULL_ACCESS, active: true }, SYSTEM);
    await engine.insert(
      'sys_user_permission_set',
      {
        id: 'ups_1',
        user_id: 'usr_grant',
        permission_set_id: 'ps_a',
        permission_set: ADMIN_FULL_ACCESS,
        organization_id: DEFAULT_ORG,
      },
      SYSTEM,
    );

    // The grant holder is the ONLY administrator: the unverified owner confers
    // nothing, exactly as the resolver reads it. Deleting the grant holder must
    // therefore be refused — if the unverified row were miscounted, this write
    // would sail through and the environment would be left with nobody.
    await expect(
      engine.delete('sys_user', { where: { id: 'usr_grant' }, ...SYSTEM }),
    ).rejects.toThrow(/last administrator/i);
  });
});

describe('[#11663 L2] the FIFTH write shape is judged', () => {
  it('refuses a change of address that moves the last administrator off the list', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);

    await expect(
      engine.update('sys_user', { id: 'usr_owner', email: 'personal@example.com' }, SYSTEM),
    ).rejects.toThrow(/last administrator/i);
    expect((await readUser(engine, 'usr_owner'))?.email).toBe(OWNER);
  });

  it('refuses an email_verified reset on the last administrator', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);

    await expect(
      engine.update('sys_user', { id: 'usr_owner', email_verified: false }, SYSTEM),
    ).rejects.toThrow(/last administrator/i);
    // Still verified — the refusal has to leave the row as it was.
    expect((await readUser(engine, 'usr_owner'))?.email_verified).toBeTruthy();
  });

  it('names the CONFIGURATION as the remedy, not this guard', async () => {
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await expect(
      engine.update('sys_user', { id: 'usr_owner', email: 'personal@example.com' }, SYSTEM),
    ).rejects.toThrow(/OS_PLATFORM_OWNER_EMAIL/);
  });

  it('ALLOWS the same write while a second administrator survives it', async () => {
    declare(`${OWNER}, ${SECOND}`);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await seedUser(engine, 'usr_second', SECOND, true);

    await expect(
      engine.update('sys_user', { id: 'usr_owner', email: 'personal@example.com' }, SYSTEM),
    ).resolves.toBeDefined();
    expect((await readUser(engine, 'usr_owner'))?.email).toBe('personal@example.com');
  });

  it('ALLOWS it when the same user also holds the Default Organization\'s grant — under `single`', async () => {
    // Standing that survives the write through the OTHER anchor is standing
    // that survives — the enumeration is one function over both.
    //
    // ⚠️ [#11663 L5] The posture is now DECLARED rather than inherited, and the
    // title says which. This arm is true because the grant anchor still confers
    // under `single`; under a wall the same fixture answers the OPPOSITE, and
    // that is pinned in the L5 suite at the end of this file. Leaving the
    // posture unset here would have left the pin measuring the ambient box.
    requestPosture('single');
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await engine.insert('sys_permission_set', { id: 'ps_a', name: ADMIN_FULL_ACCESS, active: true }, SYSTEM);
    await engine.insert(
      'sys_user_permission_set',
      {
        id: 'ups_1',
        user_id: 'usr_owner',
        permission_set_id: 'ps_a',
        permission_set: ADMIN_FULL_ACCESS,
        organization_id: DEFAULT_ORG,
      },
      SYSTEM,
    );

    await expect(
      engine.update('sys_user', { id: 'usr_owner', email_verified: false }, SYSTEM),
    ).resolves.toBeDefined();
  });

  it('costs NO reads for an ordinary profile write', async () => {
    // The cheap-path pin. A payload touching neither standing key provably
    // cannot move the enumeration, so `name` / `ai_access` edits — every
    // profile save in the product — never pay for one.
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    expect(USER_STANDING_KEYS).toEqual(['email', 'email_verified']);
    await expect(
      engine.update('sys_user', { id: 'usr_owner', name: 'Renamed', ai_access: true }, SYSTEM),
    ).resolves.toBeDefined();
  });

  it('is inert when the deployment declares no administrators', async () => {
    // Every deployment that has not adopted the config anchor sees this guard
    // behave exactly as it did: `emails` is empty, the enumeration reads no
    // `sys_user` rows for it, and there is no config-derived standing to lose.
    declare(undefined);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await expect(
      engine.update('sys_user', { id: 'usr_owner', email: 'personal@example.com' }, SYSTEM),
    ).resolves.toBeDefined();
  });
});

describe('[#11663 L2] reverse verification — the same writes on an UNGUARDED engine', () => {
  it('a change of address succeeds and takes the standing with it', async () => {
    declare(OWNER);
    const engine = await boot({ unguarded: true });
    await seedUser(engine, 'usr_owner', OWNER, true);
    await expect(
      engine.update('sys_user', { id: 'usr_owner', email: 'personal@example.com' }, SYSTEM),
    ).resolves.toBeDefined();
    expect((await readUser(engine, 'usr_owner'))?.email).toBe('personal@example.com');
  });

  it('an email_verified reset succeeds', async () => {
    declare(OWNER);
    const engine = await boot({ unguarded: true });
    await seedUser(engine, 'usr_owner', OWNER, true);
    await expect(
      engine.update('sys_user', { id: 'usr_owner', email_verified: false }, SYSTEM),
    ).resolves.toBeDefined();
    expect((await readUser(engine, 'usr_owner'))?.email_verified).toBeFalsy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
/**
 * [#11663 L5, ADR-0131 D1/D5] The grant anchor is POSTURE-KEYED and
 * OWNER-KEYED, and this enumeration is keyed with it — one anchor, two
 * readers, ONE answer.
 *
 * `resolveAuthzContext` §6b derives `PLATFORM_ADMIN` from an `admin_full_access`
 * grant only under `single`, and only from the grant the Default Organization
 * owns (`grantAnchorsPlatformStanding`): under a walled posture no grant
 * anchors, and an organization-less grant — the legacy row a store built
 * before 18.x may still hold — anchors nothing in any posture. This guard reads
 * the SAME anchor to answer "who administers this environment", and its header
 * binds it to that derivation: 「the enumeration answers the SAME question the
 * derivation does」. Keyed on one side only, the two disagree on a rig that
 * holds such a row — and the guard then believes an administrator remains when
 * none does.
 *
 * ⛔ BOTH keys are pinned in BOTH directions, and the controls are not
 * decoration: the Default Organization's grant must keep counting under
 * `single` (it is that rig's anchor, the row its zero-config first-user
 * promotion writes — Choice 4A), and it must stop counting under a wall. A
 * one-sided pin would let a later edit stop counting the Default Organization's
 * grant everywhere and stay green, which is the zero-config lockout Choice 4A
 * forbids; or count the organization-less row again, which is the fail-open
 * this file now refuses.
 *
 * ⚠️ Direction of the change, stated because it is easy to read backwards: the
 * guard now refuses MORE (it protects the config-anchored administrator it used
 * to let a write take away while counting a holder nobody else recognises) and
 * refuses WRONGLY less (it stops claiming that revoking an inert row removes the
 * last administrator). Both are narrowings toward the declared model.
 */
describe('[#11663 L5, ADR-0131 D5] a grant anchors only when the Default Organization owns it, and only under `single`', () => {
  type Owner = 'default-organization' | 'none';

  /**
   * One CONFIG-anchored admin and one GRANT holder. `none` is the legacy
   * organization-less row, seeded beneath the engine on a pre-18 store; the
   * Default Organization's grant goes through the engine as the promotion
   * writes it.
   */
  async function bootGrantHolder(owner: Owner, withConfigOwner: boolean): Promise<ObjectQL> {
    const engine = await boot({ legacyStore: owner === 'none' });
    if (withConfigOwner) await seedUser(engine, 'usr_owner', OWNER, true);
    await seedUser(engine, 'usr_legacy', 'legacy@corp.example', true);
    await seedGrant(engine, owner);
    return engine;
  }

  async function seedGrant(engine: ObjectQL, owner: Owner): Promise<void> {
    const grant = { id: 'ups_1', user_id: 'usr_legacy', permission_set_id: 'ps_a', permission_set: ADMIN_FULL_ACCESS };
    if (owner === 'none') {
      await seedLegacyRow(engine, 'sys_permission_set', { id: 'ps_a', name: ADMIN_FULL_ACCESS, active: true });
      await seedLegacyRow(engine, 'sys_user_permission_set', grant);
    } else {
      await engine.insert(
        'sys_permission_set',
        { id: 'ps_a', name: ADMIN_FULL_ACCESS, active: true, organization_id: DEFAULT_ORG },
        SYSTEM,
      );
      await engine.insert('sys_user_permission_set', { ...grant, organization_id: DEFAULT_ORG }, SYSTEM);
    }
  }

  it('⭐ REFUSES the write that ends the last config-anchored standing under a wall — neither grant holder is a survivor', async () => {
    // The blocking half. Counting `usr_legacy` would wave this write through,
    // leaving a walled deployment with NO platform administrator at all: §6b
    // recognises no grant holder there, so nobody would be left.
    for (const walled of ['group', 'isolated'] as const) {
      for (const owner of ['default-organization', 'none'] as const) {
        requestPosture(walled);
        declare(OWNER);
        const engine = await bootGrantHolder(owner, true);

        await expect(
          engine.update('sys_user', { id: 'usr_owner', email_verified: false }, SYSTEM),
          `${walled} / ${owner}`,
        ).rejects.toThrow(/OS_PLATFORM_OWNER_EMAIL/);
        expect((await readUser(engine, 'usr_owner'))?.email_verified, `${walled} / ${owner}`).toBeTruthy();
      }
    }
  });

  it('⭐ REFUSES it under `single` too when the surviving grant is organization-less — that row anchors nothing (ADR-0131 D1)', async () => {
    // The fail-open this card closed. Since the resolver stopped reading the
    // organization-less row (18.x step 7a-2), its holder is no administrator
    // anywhere; a guard that still counted it let this write take the
    // deployment's only platform administrator.
    requestPosture('single');
    declare(OWNER);
    const engine = await bootGrantHolder('none', true);

    await expect(
      engine.update('sys_user', { id: 'usr_owner', email_verified: false }, SYSTEM),
    ).rejects.toThrow(/OS_PLATFORM_OWNER_EMAIL/);
    expect((await readUser(engine, 'usr_owner'))?.email_verified).toBeTruthy();
  });

  it('…and `single` ALLOWS the identical write when the Default Organization owns the grant — the control that keeps both arms above honest', async () => {
    // Same write, opposite answer; the only differences are the posture and
    // the owner. Without this the arms above would pass just as well on a
    // guard that had stopped counting the grant anchor everywhere — the
    // zero-config lockout Choice 4A forbids.
    requestPosture('single');
    declare(OWNER);
    const engine = await bootGrantHolder('default-organization', true);

    await expect(
      engine.update('sys_user', { id: 'usr_owner', email_verified: false }, SYSTEM),
    ).resolves.toBeDefined();
    expect((await readUser(engine, 'usr_owner'))?.email_verified).toBeFalsy();
  });

  it('⛔ stops refusing WRONGLY: revoking an inert grant is not "removing the last administrator"', async () => {
    // The inverse. Where the grant confers nothing — any grant under a wall,
    // the organization-less row under `single` — revoking it takes no standing
    // away and must not be refused as though it did.
    const inert: Array<['single' | 'isolated', Owner]> = [
      ['isolated', 'default-organization'],
      ['isolated', 'none'],
      ['single', 'none'],
    ];
    for (const [posture, owner] of inert) {
      requestPosture(posture);
      declare(undefined);
      const engine = await bootGrantHolder(owner, false);

      await expect(
        engine.delete('sys_user_permission_set', { where: { id: 'ups_1' }, ...SYSTEM }),
        `${posture} / ${owner}`,
      ).resolves.toBeDefined();
    }
  });

  it('…and `single` still REFUSES that revocation when the Default Organization owns the grant — the row is that rig\'s anchor', async () => {
    // The other side of the same control. Under `single` the Default
    // Organization's grant holder IS the administrator, so revoking the grant
    // empties the environment and the guard refuses. ⛔ If this ever goes
    // green-by-allowing, the key has leaked onto the anchor itself.
    requestPosture('single');
    declare(undefined);
    const engine = await bootGrantHolder('default-organization', false);

    await expect(
      engine.delete('sys_user_permission_set', { where: { id: 'ups_1' }, ...SYSTEM }),
    ).rejects.toThrow(/last administrator/i);
  });

  it('a CONFIG-anchored administrator is still protected under a wall — the key touches grade 1 only', async () => {
    // The key must not be read as "the guard stops working under a wall". The
    // config anchor is the channel that DOES confer there, and every refusal
    // built on it stands unchanged.
    requestPosture('isolated');
    declare(OWNER);
    const engine = await boot();
    await seedUser(engine, 'usr_owner', OWNER, true);
    await seedUser(engine, 'usr_other', 'other@corp.example', true);

    await expect(
      engine.delete('sys_user', { where: { id: 'usr_owner' }, ...SYSTEM }),
    ).rejects.toThrow(/last administrator/i);
    // …and an ordinary user is still deletable, so the refusal above is about
    // the administrator and not about the posture.
    await expect(
      engine.delete('sys_user', { where: { id: 'usr_other' }, ...SYSTEM }),
    ).resolves.toBeDefined();
  });

  it('a switched-off set is emptied-not-fresh evidence only through a grant that anchors', async () => {
    // [#6084, ADR-0131 D5] The evidence is a stranded grant the anchor reads.
    // Under a wall no grant anchors (standing is configuration only, and
    // restoring a row could not end the emptiness), and an organization-less
    // grant anchors nothing anywhere — so neither is evidence, and the write is
    // read as the bootstrap window it is: nobody holds standing to lose.
    const notEvidence: Array<['single' | 'isolated', Owner]> = [
      ['isolated', 'default-organization'],
      ['isolated', 'none'],
      ['single', 'none'],
    ];
    for (const [posture, owner] of notEvidence) {
      requestPosture(posture);
      declare(undefined);
      const engine = await boot({ legacyStore: owner === 'none' });
      await seedUser(engine, 'usr_legacy', 'legacy@corp.example', true);
      await switchAdminSetOff(engine);
      await seedGrant(engine, owner);

      await expect(
        engine.delete('sys_user', { where: { id: 'usr_legacy' }, ...SYSTEM }),
        `${posture} / ${owner}`,
      ).resolves.toBeDefined();
    }
  });

  it('…and under `single` the Default Organization\'s stranded grant IS the evidence — refused, naming the switch', async () => {
    // The control for the arm above: the refusal still fires where the grant
    // anchors, so the permits above come from the key and not from a guard
    // that stopped reading the ledger.
    requestPosture('single');
    declare(undefined);
    const engine = await boot();
    await seedUser(engine, 'usr_legacy', 'legacy@corp.example', true);
    await switchAdminSetOff(engine);
    await seedGrant(engine, 'default-organization');

    await expect(
      engine.delete('sys_user', { where: { id: 'usr_legacy' }, ...SYSTEM }),
    ).rejects.toThrow(/switched OFF/);
  });
});
