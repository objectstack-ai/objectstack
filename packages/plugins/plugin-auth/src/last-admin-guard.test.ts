// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5892 + #5941 + #5978 + #6084 / cloud ADR-0024 D5.2] The break-glass guard —
 * every half of ONE invariant: a `banned = true` write, a `sys_user` row DELETE,
 * a standing revocation on `sys_member` / `sys_user_permission_set`, and a
 * delete-or-rename of the `admin_full_access` `sys_permission_set` row may each
 * only proceed while an administrator who can sign in is left behind.
 *
 * #6084 adds one thing the earlier three did not need: the guard must still be
 * ON afterwards. Its write shape empties the administrator population, and the
 * zero-administrator BOOTSTRAP exemption then read that emptiness as "nothing to
 * protect" and waved every other path through — so the last two blocks in this
 * file pin the fourth write's refusal AND that a zero-administrator reading is
 * no longer, by itself, a licence to write.
 *
 * ## Why there is no fake engine here
 *
 * The guard's whole job is to read the identity tables and decide whether an
 * administrator survives the write. A fake engine would mean a hand-written
 * `where` matcher deciding which rows the guard sees — i.e. the fixture, not
 * the product, answering the question under test (the hazard #5785 names in as
 * many words). So every case below runs on a REAL {@link ObjectQL} engine over
 * a real better-sqlite3 `:memory:` database: the engine dispatches the hook,
 * the SQL builder compiles `$in` / `$ne`, and sqlite stores the booleans as
 * 0/1 — which is also how the guard's numeric-flag handling gets exercised for
 * free, since better-auth's adapter is configured `supportsBooleans: false` and
 * hands ObjectQL a `1` for `banned: true`.
 *
 * The object fixtures declare only the columns this guard reads (plus enough
 * identity to be a table). `sys_user.banned` keeps its production
 * `readonly: true` so the system-context exemption is the real one.
 *
 * ## The two faces
 *
 *  1. **The engine write** — `engine.update('sys_user', …)` /
 *     `engine.delete('sys_user', …)`, by-id and predicate/multi, which is every
 *     path that reaches the row.
 *  2. **The SCIM / admin path** — the same refusals driven through
 *     `createObjectQLAdapterFactory`, the adapter `@better-auth/scim`'s
 *     `active: false` → admin ban and its `DELETE /Users/{id}` → remove-user
 *     actually write through, asserting each surfaces as a 403 `APIError` and
 *     not an opaque 500.
 *
 * Reverse verification (recorded because the direction is not obvious): with
 * `registerLastAdminGuard` NOT called, the "last administrator" cases below are
 * GREEN-as-in-the-write-succeeds — `engine.update` resolves and the row comes
 * back `banned = 1`; `engine.delete` resolves and the row is GONE. That is the
 * pre-#5892 / pre-#5941 behaviour, and it is what every `rejects.toThrow` here
 * is measured against; the two `unguarded: true` cases at the bottom of the
 * file re-run it on the same fixtures rather than describing it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { isAPIError } from 'better-auth/api';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { SystemUserId } from '@objectstack/spec/system';
import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { registerIdentityWriteGuard, registerManagedUpdateWhitelist } from './identity-write-guard.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';
import { createObjectQLAdapterFactory } from './objectql-adapter.js';
import { buildAdminPluginSchema, buildOrganizationPluginSchema } from './auth-schema-config.js';
import { admin } from 'better-auth/plugins/admin';
import { organization } from 'better-auth/plugins/organization';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sysUser = {
  name: 'sys_user',
  label: 'User',
  // The ADR-0092 guard keys off this; the break-glass guard deliberately does not.
  managedBy: 'better-auth',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    email: { name: 'email', type: 'text' as const },
    // Production spelling: writable only by an `isSystem` caller (#2948).
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

const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    // [#6084] Not read by the guard — that is its job here. `label` is what
    // every projection pass and every Setup edit writes
    // (`permissionSetRowFields`), so it is the column the "costs no reads"
    // pin drives.
    label: { name: 'label', type: 'text' as const },
    // [#8613 / ADR-0049] The Deactivate switch. Declared `boolean`, so on this
    // real sqlite database it stores as 0/1 and the guard's flag handling is
    // exercised against the shape the primary driver actually returns — not
    // against a hand-written `false`. Seeded rows leave it NULL, which is the
    // deployed shape of a row that predates the column: absent means ACTIVE.
    active: { name: 'active', type: 'boolean' as const },
  },
};

/**
 * [#5941] Only the delete cases use this one, and the guard reads NOTHING from
 * it — that is the point. `auth-manager.ts`'s HTTP break-glass guard judges the
 * last holder of a local `credential` account, so an IdP-managed administrator
 * (no `credential` row) walks straight past it. Seeding the accounts makes the
 * fixture the environment the issue describes instead of a paraphrase of it.
 */
const sysAccount = {
  name: 'sys_account',
  label: 'Account',
  managedBy: 'better-auth',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    provider_id: { name: 'provider_id', type: 'text' as const },
  },
};

const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    valid_from: { name: 'valid_from', type: 'datetime' as const },
    valid_until: { name: 'valid_until', type: 'datetime' as const },
  },
};

const SYSTEM = { context: { isSystem: true } } as const;
const ORG = 'org_1';
const PS_ADMIN = 'ps_admin_full_access';

/** Every ban a real deprovision performs is a system-context write. */
async function ban(engine: ObjectQL, id: string): Promise<unknown> {
  return engine.update('sys_user', { id, banned: true }, SYSTEM);
}

/** …and so is every removal: better-auth's adapter deletes by resolved id. */
async function removeUser(engine: ObjectQL, id: string): Promise<unknown> {
  return engine.delete('sys_user', { where: { id }, ...SYSTEM });
}

async function bannedFlag(engine: ObjectQL, id: string): Promise<unknown> {
  const row = await engine.findOne('sys_user', { where: { id }, fields: ['id', 'banned'] }, SYSTEM);
  return row?.banned;
}

async function userExists(engine: ObjectQL, id: string): Promise<boolean> {
  const row = await engine.findOne('sys_user', { where: { id }, fields: ['id'] }, SYSTEM);
  return Boolean(row);
}

interface BootOptions {
  /** Overrides the engine the GUARD reads through (hook stays on the real one). */
  readThrough?: (engine: ObjectQL) => LastAdminGuardEngine;
  maxScan?: number;
  /** Register the ADR-0092 identity write guard alongside, at its own priority. */
  withIdentityWriteGuard?: boolean;
  /** Skip registration entirely — the pre-guard engine, for reverse verification. */
  unguarded?: boolean;
}

let engines: ObjectQL[] = [];

afterEach(async () => {
  // `:memory:` dies with its connection; closing keeps one live database per
  // test from piling up in a file this size.
  const open = engines;
  engines = [];
  for (const e of open) {
    try { await e.destroy(); } catch { /* noop */ }
  }
});

async function boot(opts: BootOptions = {}): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  for (const o of [sysUser, sysMember, sysPermissionSet, sysUserPermissionSet, sysAccount]) {
    engine.registry.registerObject(o as never);
  }
  await engine.syncSchemas();

  if (opts.withIdentityWriteGuard) {
    registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
    registerIdentityWriteGuard(engine, { packageId: 'test.identity-write-guard' });
  }
  if (!opts.unguarded) {
    registerLastAdminGuard(opts.readThrough?.(engine) ?? (engine as unknown as LastAdminGuardEngine), {
      packageId: 'test.last-admin-guard',
      ...(opts.maxScan !== undefined ? { maxScan: opts.maxScan } : {}),
    });
  }
  return engine;
}

/** A user row, plus whatever standing the case needs. */
async function seedUser(
  engine: ObjectQL,
  id: string,
  extra: {
    role?: string;
    platformAdmin?: boolean;
    banned?: boolean;
    grant?: Record<string, unknown>;
    /** `credential` = holds a local password; anything else = IdP-managed. */
    accountProvider?: string;
  } = {},
): Promise<void> {
  await engine.insert(
    'sys_user',
    { id, name: id, email: `${id}@example.com`, banned: extra.banned ?? false },
    SYSTEM,
  );
  if (extra.accountProvider) {
    await engine.insert(
      'sys_account',
      { id: `acc_${id}`, user_id: id, provider_id: extra.accountProvider },
      SYSTEM,
    );
  }
  if (extra.role) {
    await engine.insert(
      'sys_member',
      { id: `mem_${id}`, user_id: id, organization_id: ORG, role: extra.role },
      SYSTEM,
    );
  }
  if (extra.platformAdmin || extra.grant) {
    await engine.insert(
      'sys_user_permission_set',
      { id: `ups_${id}`, user_id: id, permission_set_id: PS_ADMIN, ...(extra.grant ?? {}) },
      SYSTEM,
    );
  }
}

async function seedAdminPermissionSet(engine: ObjectQL): Promise<void> {
  await engine.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS }, SYSTEM);
  await engine.insert('sys_permission_set', { id: 'ps_member', name: 'member_default' }, SYSTEM);
}

// ---------------------------------------------------------------------------
// Face 1 — the invariant, on the engine write
// ---------------------------------------------------------------------------

describe('[#5892] break-glass: the last unbanned administrator cannot be banned', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
  });

  it('two org admins: banning the first is allowed, banning the last is refused', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });
    await seedUser(engine, 'usr_member', { role: 'member' });

    // One of two — the environment keeps an administrator, so this proceeds.
    await expect(ban(engine, 'usr_admin')).resolves.toBeTruthy();
    expect(await bannedFlag(engine, 'usr_admin')).toBeTruthy();

    // The last one — refused, and nothing is written.
    await expect(ban(engine, 'usr_owner')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      object: 'sys_user',
    });
    expect(await bannedFlag(engine, 'usr_owner')).toBeFalsy();
  });

  it('the refusal explains itself: which user, why, and what to do about it', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    await expect(ban(engine, 'usr_owner')).rejects.toThrow(/usr_owner/);
    await expect(ban(engine, 'usr_owner')).rejects.toThrow(/last administrator/i);
    await expect(ban(engine, 'usr_owner')).rejects.toThrow(/ADR-0024 D5\.2/);
    // Information as operating instructions: how to make the ban legal, and
    // where to look when an IdP drove it.
    await expect(ban(engine, 'usr_owner')).rejects.toThrow(new RegExp(ADMIN_FULL_ACCESS));
    await expect(ban(engine, 'usr_owner')).rejects.toThrow(/SCIM deprovision is too broad/);
  });

  it('banning a non-administrator is untouched, even when exactly one admin exists', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_member', { role: 'member' });
    await seedUser(engine, 'usr_nobody');

    await expect(ban(engine, 'usr_member')).resolves.toBeTruthy();
    await expect(ban(engine, 'usr_nobody')).resolves.toBeTruthy();
    expect(await bannedFlag(engine, 'usr_member')).toBeTruthy();
  });

  it('a platform admin (unscoped admin_full_access) counts, a SCOPED grant does not', async () => {
    // `usr_platform` holds the org-less grant → platform admin.
    await seedUser(engine, 'usr_platform', { platformAdmin: true });
    // `usr_scoped` holds the SAME permission set scoped to an org → a tenant
    // admin, not the environment's break-glass account (ADR-0068 D2 reads the
    // unscoped grant only).
    await seedUser(engine, 'usr_scoped', { grant: { organization_id: ORG } });

    await expect(ban(engine, 'usr_scoped')).resolves.toBeTruthy();
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/last administrator/i);
  });

  it('an EXPIRED admin grant is not an administrator — neither as survivor nor as target', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_expired', { grant: { valid_until: past } });

    // The expired holder is bannable: they were never an administrator.
    await expect(ban(engine, 'usr_expired')).resolves.toBeTruthy();
    // …and cannot be counted as the survivor that lets the real one go.
    await expect(ban(engine, 'usr_owner')).rejects.toThrow(/last administrator/i);
  });

  it('`delegated_admin` does not count as an administrator (ADR-0105 D8: reach, not authority)', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_delegate', { role: 'delegated_admin' });

    await expect(ban(engine, 'usr_owner')).rejects.toThrow(/last administrator/i);
  });

  it('a comma-joined membership role is still an administrator', async () => {
    await seedUser(engine, 'usr_multi', { role: 'owner,member' });

    await expect(ban(engine, 'usr_multi')).rejects.toThrow(/last administrator/i);
  });

  it('the non-loginable `usr_system` account is never counted as the survivor', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, SystemUserId.SYSTEM, { platformAdmin: true });

    await expect(ban(engine, 'usr_owner')).rejects.toThrow(/last administrator/i);
  });

  it('an already-banned administrator can be re-banned (nothing is being taken away)', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner', banned: true });

    await expect(ban(engine, 'usr_owner')).resolves.toBeTruthy();
  });

  it('unbanning, and any write that does not turn `banned` on, is never guarded', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner', banned: true });

    await expect(
      engine.update('sys_user', { id: 'usr_owner', banned: false }, SYSTEM),
    ).resolves.toBeTruthy();
    await expect(
      engine.update('sys_user', { id: 'usr_owner', name: 'Renamed' }, SYSTEM),
    ).resolves.toBeTruthy();
    expect(await bannedFlag(engine, 'usr_owner')).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Predicate / bulk writes — the shape a by-id guard would miss
// ---------------------------------------------------------------------------

/**
 * ⚠️ [#5574] These predicate cases are load-bearing in a way they were not when
 * they were written, and the reason is worth stating where it will be read.
 *
 * They used to exercise a BATCH dispatch: one `beforeUpdate` / `beforeDelete`
 * call for the whole write, with `input.id` present-but-undefined, so the guard
 * fell through to the caller's predicate and saw the whole doomed set.
 * ADR-0058 Addendum II made the `before*` phase PER MATCHED ROW, so every
 * dispatch now names one administrator — and a guard reading "there is an id,
 * so this is a by-id write" approves each one on its own merits (banning one
 * admin out of three is legitimate) while the batch bans all three. Measured:
 * every case below went green-to-red on the engine change and was restored by
 * making `options.multi` outrank the bound id in `resolveTargetIds`.
 *
 * So: these are not "the bulk variant of the by-id cases". They are the pin
 * that a break-glass invariant over a POPULATION survives being asked one row
 * at a time. Do not fold them into the by-id cases, and do not rewrite this
 * guard to reason from `ctx.previous` — per-row `previous` is exactly the
 * information that cannot see a batch.
 */
describe('[#5892] the guard holds on predicate (multi) bans, not only by-id', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });
    await seedUser(engine, 'usr_member', { role: 'member' });
  });

  it('a predicate that would sweep every administrator is refused', async () => {
    await expect(
      engine.update('sys_user', { banned: true }, { multi: true, where: { banned: false }, ...SYSTEM }),
    ).rejects.toThrow(/last administrator/i);
    expect(await bannedFlag(engine, 'usr_owner')).toBeFalsy();
    expect(await bannedFlag(engine, 'usr_admin')).toBeFalsy();
  });

  it('an `$in` predicate naming both admins is refused — a scalar-id read would have missed it', async () => {
    await expect(
      engine.update(
        'sys_user',
        { banned: true },
        { multi: true, where: { id: { $in: ['usr_owner', 'usr_admin'] } }, ...SYSTEM },
      ),
    ).rejects.toThrow(/last administrator/i);
  });

  it('a predicate that spares one administrator proceeds', async () => {
    await expect(
      engine.update(
        'sys_user',
        { banned: true },
        { multi: true, where: { id: { $in: ['usr_admin', 'usr_member'] } }, ...SYSTEM },
      ),
    ).resolves.toBeDefined();
    expect(await bannedFlag(engine, 'usr_admin')).toBeTruthy();
    expect(await bannedFlag(engine, 'usr_owner')).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Fail-closed
// ---------------------------------------------------------------------------

describe('[#5892] the guard fails CLOSED — an unverifiable population refuses the ban', () => {
  it('a failing identity read refuses the ban and names the reason', async () => {
    const engine = await boot({
      readThrough: (real) => ({
        registerHook: (event, handler, options) => real.registerHook(event, handler, options),
        find: async () => {
          throw new Error('sys_member is unreadable');
        },
      }),
    });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });

    // Two admins exist — this ban WOULD be legal. It is refused anyway,
    // because the guard could not prove it.
    await expect(ban(engine, 'usr_admin')).rejects.toThrow(/could not be verified/i);
    await expect(ban(engine, 'usr_admin')).rejects.toThrow(/sys_member is unreadable/);
    await expect(ban(engine, 'usr_admin')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(await bannedFlag(engine, 'usr_admin')).toBeFalsy();
  });

  it('a population larger than the guard can enumerate refuses the ban', async () => {
    const engine = await boot({ maxScan: 1 });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });

    await expect(ban(engine, 'usr_admin')).rejects.toThrow(/more than 1 rows/);
  });

  it('an environment with no administrator at all is not blocked (nothing to protect)', async () => {
    // Pre-bootstrap shape: users exist, nobody administers anything yet.
    const engine = await boot();
    await seedUser(engine, 'usr_a');
    await seedUser(engine, 'usr_b');

    await expect(ban(engine, 'usr_a')).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Ordering against the ADR-0092 identity write guard
// ---------------------------------------------------------------------------

describe('[#5892] a USER-CONTEXT ban still gets the ADR-0092 answer, not this one', () => {
  it('the identity write guard (priority 10) answers first for a data-API caller', async () => {
    const engine = await boot({ withIdentityWriteGuard: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    // `banned` is not on the sys_user profile whitelist, so the ADR-0092 guard
    // rejects the payload before the break-glass guard is reached — the caller
    // is told the column is not editable through the data API, which is the
    // accurate answer for that surface.
    await expect(
      engine.update(
        'sys_user',
        { id: 'usr_owner', banned: true },
        { context: { isSystem: false, userId: 'usr_caller', positions: [], permissions: [] } },
      ),
    ).rejects.toThrow(/Editable fields/);
  });
});

// ---------------------------------------------------------------------------
// Face 2 — the SCIM / admin-ban path, through better-auth's adapter
// ---------------------------------------------------------------------------

describe('[#5892] the SCIM / admin-ban path: refused as a 403, not an opaque 500', () => {
  let engine: ObjectQL;
  let adapter: {
    update: (args: { model: string; where: unknown[]; update: Record<string, unknown> }) => Promise<unknown>;
  };

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });
    // The production factory, exactly as `AuthManager` builds it: writes run
    // through `withSystemContext`, which is why the ADR-0092 guard is not the
    // thing standing between an IdP and a locked-out environment.
    //
    // The admin plugin has to be in the options, not because this test drives
    // its endpoints, but because `banned` is ITS column: better-auth's adapter
    // transforms a payload against the declared table, so a `banned` no plugin
    // declared is dropped before the engine ever sees it — the write would
    // "succeed" and change nothing. That is also the production wiring: SCIM
    // forces the admin plugin on precisely because `active: false` lands as its
    // ban (ADR-0071), and `buildAdminPluginSchema()` is the same mapping
    // `AuthManager` passes.
    adapter = (createObjectQLAdapterFactory(engine) as unknown as (o: unknown) => typeof adapter)({
      plugins: [admin({ schema: buildAdminPluginSchema() })],
    });
  });

  /** What `@better-auth/scim`'s `active: false` → admin ban ultimately writes. */
  const deprovision = (userId: string) =>
    adapter.update({
      model: 'user',
      where: [{ field: 'id', value: userId, operator: 'eq', connector: 'AND' }],
      update: { banned: true },
    });

  it('deprovisioning the second-to-last administrator succeeds', async () => {
    await expect(deprovision('usr_admin')).resolves.toBeTruthy();
    expect(await bannedFlag(engine, 'usr_admin')).toBeTruthy();
  });

  it('deprovisioning the LAST administrator is refused with a 403 APIError', async () => {
    await deprovision('usr_admin');

    let caught: unknown;
    try {
      await deprovision('usr_owner');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    // A raw engine error would reach the IdP as a 500 with no explanation —
    // the one outcome a guard whose product is an explanation must not have.
    expect(isAPIError(caught)).toBe(true);
    const api = caught as { statusCode: number; body: { code?: string; message?: string } };
    expect(api.statusCode).toBe(403);
    expect(api.body.code).toBe('PERMISSION_DENIED');
    expect(api.body.message).toMatch(/last administrator/i);
    expect(await bannedFlag(engine, 'usr_owner')).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// [#5941] The delete half — same invariant, the other write
// ---------------------------------------------------------------------------

describe('[#5941] break-glass: the last unbanned administrator cannot be DELETED', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
  });

  it('two org admins: deleting the first is allowed, deleting the last is refused', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });
    await seedUser(engine, 'usr_member', { role: 'member' });

    // One of two — the environment keeps an administrator, so this proceeds.
    await expect(removeUser(engine, 'usr_admin')).resolves.toBeDefined();
    expect(await userExists(engine, 'usr_admin')).toBe(false);

    // The last one — refused, and the row is still there.
    await expect(removeUser(engine, 'usr_owner')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      object: 'sys_user',
    });
    expect(await userExists(engine, 'usr_owner')).toBe(true);
  });

  it('the refusal explains itself: the operation, which user, why, and the fix', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    // The verb is the caller's own: an operator who ran a SCIM
    // `DELETE /Users/{id}` must not be told a "ban" was refused.
    await expect(removeUser(engine, 'usr_owner')).rejects.toThrow(/Refusing to delete 'usr_owner'/);
    await expect(removeUser(engine, 'usr_owner')).rejects.toThrow(/last administrator/i);
    await expect(removeUser(engine, 'usr_owner')).rejects.toThrow(/deleting that account/);
    await expect(removeUser(engine, 'usr_owner')).rejects.toThrow(/ADR-0024 D5\.2/);
    await expect(removeUser(engine, 'usr_owner')).rejects.toThrow(new RegExp(ADMIN_FULL_ACCESS));
    await expect(removeUser(engine, 'usr_owner')).rejects.toThrow(/SCIM deprovision is too broad/);
  });

  it(
    'the reachable chain: an IdP-managed last admin (no local credential) removed by a SYSTEM ' +
      'caller is refused',
    async () => {
      // Exactly #5941's environment. `usr_idp_owner` is SCIM JIT-provisioned:
      // its only account is the IdP one, so `auth-manager.ts`'s HTTP guard —
      // which fires only when the TARGET holds a local `credential` account —
      // skips this delete entirely. `usr_escape` is the password-holding
      // non-admin the issue describes: able to sign in, unable to administer
      // anything, which is the state ADR-0024 D5.2 exists to prevent.
      await seedUser(engine, 'usr_idp_owner', { role: 'owner', accountProvider: 'oidc' });
      await seedUser(engine, 'usr_escape', { role: 'member', accountProvider: 'credential' });

      // A SCIM deprovision runs as system — the context that bypasses ADR-0092
      // by design, and the one this guard therefore also covers.
      await expect(removeUser(engine, 'usr_idp_owner')).rejects.toThrow(/last administrator/i);
      expect(await userExists(engine, 'usr_idp_owner')).toBe(true);

      // The credential-less-ness of the target changed nothing: the guard
      // counts administrators, never password holders.
      expect(
        await engine.findOne(
          'sys_account',
          { where: { user_id: 'usr_idp_owner', provider_id: 'credential' } },
          SYSTEM,
        ),
      ).toBeFalsy();
    },
  );

  it('deleting a non-administrator is untouched, even when exactly one admin exists', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_member', { role: 'member', accountProvider: 'credential' });
    await seedUser(engine, 'usr_nobody');

    await expect(removeUser(engine, 'usr_member')).resolves.toBeDefined();
    await expect(removeUser(engine, 'usr_nobody')).resolves.toBeDefined();
    expect(await userExists(engine, 'usr_member')).toBe(false);
    expect(await userExists(engine, 'usr_nobody')).toBe(false);
  });

  it('a platform admin (unscoped admin_full_access) counts, a SCOPED grant does not', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });
    await seedUser(engine, 'usr_scoped', { grant: { organization_id: ORG } });

    await expect(removeUser(engine, 'usr_scoped')).resolves.toBeDefined();
    await expect(removeUser(engine, 'usr_platform')).rejects.toThrow(/last administrator/i);
  });

  it('`delegated_admin` and `usr_system` are never counted as the survivor', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_delegate', { role: 'delegated_admin' });
    await seedUser(engine, SystemUserId.SYSTEM, { platformAdmin: true });

    await expect(removeUser(engine, 'usr_owner')).rejects.toThrow(/last administrator/i);
  });

  it('an ALREADY-banned administrator can be deleted (nothing is being taken away)', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner', banned: true });

    await expect(removeUser(engine, 'usr_owner')).resolves.toBeDefined();
    expect(await userExists(engine, 'usr_owner')).toBe(false);
  });

  it('deleting an unrelated row on another object is not this guard\'s business', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    // `usr_member`'s membership carries no administrative grade, so removing it
    // takes no standing away — the standing halves (#5978) below judge every
    // `sys_member` delete, and this is what "judged and allowed" looks like.
    // The account row is what the second half of this case deletes.
    await seedUser(engine, 'usr_member', { role: 'member', accountProvider: 'credential' });

    await expect(
      engine.delete('sys_member', { where: { id: 'mem_usr_member' }, ...SYSTEM }),
    ).resolves.toBeDefined();
    // …and a table this guard reads but does not write-guard is untouched: the
    // delete goes through.
    //
    // [#7867] This half used to delete the id `'nope'` — a row that was never
    // seeded — and assert it RESOLVED. That passed for a reason unrelated to
    // this guard: `ObjectQL.delete()` had no existence gate on its by-id path,
    // so a delete naming no row was a silent no-op that reported success. The
    // engine now answers `RECORD_NOT_FOUND` there, which is the change #7867
    // landed, so the old line would have been asserting the absence of a guard
    // by way of a defect.
    //
    // Deleting a REAL `sys_account` row states the same thing without borrowing
    // that defect, and states it more strongly: the guard does not merely fail
    // to fire on a write that touched nothing — it lets a write that really
    // removes a row on this object through.
    await expect(
      engine.delete('sys_account', { where: { id: 'acc_usr_member' }, ...SYSTEM }),
    ).resolves.toBeDefined();
    // The other half of "not this guard's business", kept explicit: a ghost id
    // on this object is refused by the ENGINE, not by the last-admin guard —
    // so the refusal above staying absent is about the guard, and this refusal
    // is about existence. Two different questions, two different answers.
    const ghost = await engine
      .delete('sys_account', { where: { id: 'nope' }, ...SYSTEM })
      .then(() => null, (e: any) => e);
    expect(ghost?.code).toBe('RECORD_NOT_FOUND');
    expect(String(ghost?.message ?? '')).not.toMatch(/last administrator/i);
  });

  // NOTE (#5978): the case that used to live here asserted the OPPOSITE — that
  // `engine.delete('sys_member', { where: { id: 'mem_usr_owner' } })` resolves,
  // pinning the third-path gap #5941 deliberately left open ("filed as #5978,
  // and deliberately not half-guarded from here. Pinned so the day it IS
  // guarded, this expectation is the one that has to be changed on purpose").
  // Today is that day: the same write is now refused, and that inversion is
  // the before-red anchor for this whole change — see
  // `[#5978] path 2` below, which is the same fixture with the verdict flipped.
});

describe('[#5941] the delete guard holds on predicate (multi) deletes, not only by-id', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });
    await seedUser(engine, 'usr_member', { role: 'member' });
  });

  it('a predicate that would sweep every administrator is refused', async () => {
    // `input.id` is unbound on this dispatch and `ctx.previous` is never
    // fetched for it — the guard reads the predicate off `input.options.where`
    // and resolves the doomed rows itself.
    await expect(
      engine.delete('sys_user', { multi: true, where: { banned: false }, ...SYSTEM }),
    ).rejects.toThrow(/last administrator/i);
    expect(await userExists(engine, 'usr_owner')).toBe(true);
    expect(await userExists(engine, 'usr_admin')).toBe(true);
    expect(await userExists(engine, 'usr_member')).toBe(true);
  });

  it('an `$in` predicate naming both admins is refused — a scalar-id read would have missed it', async () => {
    await expect(
      engine.delete('sys_user', {
        multi: true,
        where: { id: { $in: ['usr_owner', 'usr_admin'] } },
        ...SYSTEM,
      }),
    ).rejects.toThrow(/last administrators/i);
    expect(await userExists(engine, 'usr_owner')).toBe(true);
  });

  it('an unpredicated `multi` delete — the one that empties the table — is refused', async () => {
    await expect(engine.delete('sys_user', { multi: true, ...SYSTEM })).rejects.toThrow(
      /last administrators/i,
    );
    expect(await userExists(engine, 'usr_owner')).toBe(true);
  });

  it('a predicate that spares one administrator proceeds', async () => {
    await expect(
      engine.delete('sys_user', {
        multi: true,
        where: { id: { $in: ['usr_admin', 'usr_member'] } },
        ...SYSTEM,
      }),
    ).resolves.toBeDefined();
    expect(await userExists(engine, 'usr_admin')).toBe(false);
    expect(await userExists(engine, 'usr_owner')).toBe(true);
  });
});

describe('[#5941] the delete guard fails CLOSED too', () => {
  it('a failing identity read refuses the delete and names the reason', async () => {
    const engine = await boot({
      readThrough: (real) => ({
        registerHook: (event, handler, options) => real.registerHook(event, handler, options),
        find: async () => {
          throw new Error('sys_member is unreadable');
        },
      }),
    });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });

    // Two admins exist — this delete WOULD be legal. It is refused anyway,
    // because the guard could not prove it.
    await expect(removeUser(engine, 'usr_admin')).rejects.toThrow(/Refusing this delete/);
    await expect(removeUser(engine, 'usr_admin')).rejects.toThrow(/could not be verified/i);
    await expect(removeUser(engine, 'usr_admin')).rejects.toThrow(/sys_member is unreadable/);
    await expect(removeUser(engine, 'usr_admin')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(await userExists(engine, 'usr_admin')).toBe(true);
  });

  it('a population larger than the guard can enumerate refuses the delete', async () => {
    const engine = await boot({ maxScan: 1 });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });

    await expect(removeUser(engine, 'usr_admin')).rejects.toThrow(/more than 1 rows/);
    expect(await userExists(engine, 'usr_admin')).toBe(true);
  });

  it('an environment with no administrator at all is not blocked (nothing to protect)', async () => {
    const engine = await boot();
    await seedUser(engine, 'usr_a');
    await seedUser(engine, 'usr_b');

    await expect(removeUser(engine, 'usr_a')).resolves.toBeDefined();
  });
});

describe('[#5941] a USER-CONTEXT delete still gets the ADR-0092 answer, not this one', () => {
  it('the identity write guard (priority 10) answers first for a data-API caller', async () => {
    const engine = await boot({ withIdentityWriteGuard: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    // ADR-0092 refuses identity deletes through the data API outright, so a
    // user-context caller is told THAT — the accurate answer for that surface —
    // rather than the break-glass one.
    await expect(
      engine.delete('sys_user', {
        where: { id: 'usr_owner' },
        context: { isSystem: false, userId: 'usr_caller', positions: [], permissions: [] },
      }),
    ).rejects.toThrow(/managed by better-auth/);
    expect(await userExists(engine, 'usr_owner')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// [#5941] Face 2 — the SCIM `DELETE /Users/{id}` / admin remove-user path
// ---------------------------------------------------------------------------

describe('[#5941] the SCIM / admin remove-user path: refused as a 403, not an opaque 500', () => {
  let engine: ObjectQL;
  let adapter: {
    delete: (args: { model: string; where: unknown[] }) => Promise<void>;
  };

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
    // The IdP-managed pair again, this time driven through the production
    // adapter factory exactly as `AuthManager` builds it.
    await seedUser(engine, 'usr_owner', { role: 'owner', accountProvider: 'oidc' });
    await seedUser(engine, 'usr_admin', { role: 'admin', accountProvider: 'oidc' });
    adapter = (createObjectQLAdapterFactory(engine) as unknown as (o: unknown) => typeof adapter)({
      plugins: [admin({ schema: buildAdminPluginSchema() })],
    });
  });

  /** What `@better-auth/scim`'s `DELETE /Users/{id}` ultimately writes. */
  const removeThroughAdapter = (userId: string) =>
    adapter.delete({
      model: 'user',
      where: [{ field: 'id', value: userId, operator: 'eq', connector: 'AND' }],
    });

  it('removing the second-to-last administrator succeeds', async () => {
    await expect(removeThroughAdapter('usr_admin')).resolves.toBeUndefined();
    expect(await userExists(engine, 'usr_admin')).toBe(false);
  });

  it('removing the LAST administrator is refused with a 403 APIError', async () => {
    await removeThroughAdapter('usr_admin');

    let caught: unknown;
    try {
      await removeThroughAdapter('usr_owner');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    // Same requirement as the ban half: a raw engine error would reach the IdP
    // as a 500 with no explanation. `withValidationErrorMapping` wraps every
    // adapter method, so the 403 arm #5939 added covers `delete` unchanged.
    expect(isAPIError(caught)).toBe(true);
    const api = caught as { statusCode: number; body: { code?: string; message?: string } };
    expect(api.statusCode).toBe(403);
    expect(api.body.code).toBe('PERMISSION_DENIED');
    expect(api.body.message).toMatch(/last administrator/i);
    expect(await userExists(engine, 'usr_owner')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reverse verification — the same fixtures with the guard NOT registered
// ---------------------------------------------------------------------------

describe('[#5892 / #5941] reverse verification: without the guard, the lockout goes through', () => {
  it('the pre-#5892 engine bans the last administrator and reports success', async () => {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    await expect(ban(engine, 'usr_owner')).resolves.toBeTruthy();
    expect(await bannedFlag(engine, 'usr_owner')).toBeTruthy();
  });

  it('the pre-#5941 engine DELETES the last administrator and the row is gone', async () => {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner', accountProvider: 'oidc' });
    await seedUser(engine, 'usr_escape', { role: 'member', accountProvider: 'credential' });

    await expect(removeUser(engine, 'usr_owner')).resolves.toBeDefined();
    expect(await userExists(engine, 'usr_owner')).toBe(false);
    // …and what is left is the issue's end state: a password holder who can
    // sign in and administer nothing.
    expect(await userExists(engine, 'usr_escape')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// [#5978] The THIRD write shape — the `sys_user` row is never touched
//
// "Who is an administrator" is not stored on `sys_user`. It is derived from the
// two tables `resolveAdminUserIds` enumerates, so it can be taken away by
// writing THEM while every user row stays exactly as it was. The two halves
// #5892 / #5941 installed both filter on `object === 'sys_user'`, so they see
// none of it.
//
// Each path below pins the same five things the invariant needs:
//   (1) the last administrator's standing cannot be revoked,
//   (2) a non-last administrator's can,
//   (3) a predicate/bulk write is judged over its whole matched set,
//   (4) an unverifiable population refuses (fail CLOSED),
//   (5) the path IS the third path — `sys_user` is untouched by the refused
//       write, which is what makes it invisible to the first two halves.
// ---------------------------------------------------------------------------

/** The `sys_member.role` a membership row currently carries. */
async function memberRole(engine: ObjectQL, memberId: string): Promise<unknown> {
  const row = await engine.findOne('sys_member', { where: { id: memberId } }, SYSTEM);
  return row?.role;
}

async function rowExists(engine: ObjectQL, object: string, id: string): Promise<boolean> {
  const row = await engine.findOne(object, { where: { id }, fields: ['id'] }, SYSTEM);
  return Boolean(row);
}

/**
 * The assertion that makes these the THIRD path rather than a restatement of
 * the first two: the user row is present, unbanned, and was never a party to
 * the write that got refused.
 */
async function expectUserRowUntouched(engine: ObjectQL, id: string): Promise<void> {
  expect(await userExists(engine, id)).toBe(true);
  expect(await bannedFlag(engine, id)).toBeFalsy();
}

describe('[#5978] path 1 — downgrading the last administrator\'s sys_member role', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
  });

  /** What better-auth's `updateMemberRole` (and a SCIM group remap) writes. */
  const setRole = (memberId: string, role: string) =>
    engine.update('sys_member', { id: memberId, role }, SYSTEM);

  it('two org admins: downgrading the first is allowed, downgrading the last is refused', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });

    await expect(setRole('mem_usr_admin', 'member')).resolves.toBeTruthy();
    expect(await memberRole(engine, 'mem_usr_admin')).toBe('member');

    await expect(setRole('mem_usr_owner', 'member')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      object: 'sys_member',
    });
    // Nothing was written: the standing survives the refusal.
    expect(await memberRole(engine, 'mem_usr_owner')).toBe('owner');
  });

  it('THE PATH ITSELF: the sys_user row is never touched, which is why #5892/#5941 miss it', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner', accountProvider: 'oidc' });
    await seedUser(engine, 'usr_escape', { role: 'member', accountProvider: 'credential' });

    // No `banned` write, no `sys_user` delete — the two guarded chokepoints are
    // not on this path at all. The write lands on `sys_member`, and it is still
    // refused.
    await expect(setRole('mem_usr_owner', 'member')).rejects.toThrow(/ADR-0024 D5\.2/);
    await expectUserRowUntouched(engine, 'usr_owner');
    expect(await memberRole(engine, 'mem_usr_owner')).toBe('owner');
  });

  it('the refusal explains itself: whose standing, which table, why, and the fix', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    await expect(setRole('mem_usr_owner', 'member')).rejects.toThrow(
      /Refusing this membership change/,
    );
    // The user who LOSES standing is named, not the membership row id — the
    // operator needs to know which person is about to be locked out.
    await expect(setRole('mem_usr_owner', 'member')).rejects.toThrow(/'usr_owner'/);
    await expect(setRole('mem_usr_owner', 'member')).rejects.toThrow(/last administrator/i);
    await expect(setRole('mem_usr_owner', 'member')).rejects.toThrow(/sys_member/);
    await expect(setRole('mem_usr_owner', 'member')).rejects.toThrow(/ADR-0024 D5\.2/);
    await expect(setRole('mem_usr_owner', 'member')).rejects.toThrow(new RegExp(ADMIN_FULL_ACCESS));
    // An IdP drove most of these, so the message points at the group mapping.
    await expect(setRole('mem_usr_owner', 'member')).rejects.toThrow(/SCIM group mapping/);
  });

  it('a downgrade to ANOTHER administrative grade is allowed — the grade is not lost', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    // `owner` → `admin` is a demotion in the ladder, but both grades administer
    // the org, so the environment keeps an administrator and the guard has no
    // opinion. Nothing here is a role-governance policy.
    await expect(setRole('mem_usr_owner', 'admin')).resolves.toBeTruthy();
    expect(await memberRole(engine, 'mem_usr_owner')).toBe('admin');
    // …and the reverse, back up the ladder, likewise.
    await expect(setRole('mem_usr_owner', 'owner')).resolves.toBeTruthy();
  });

  it('a comma-joined downgrade that KEEPS an administrative role is allowed', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    // The one grade ruler (`isOrgAdminGrade`, #5939/#5942) reads the whole
    // comma-joined value, so `member,admin` still administers. A hand-copied
    // `role === 'owner' || role === 'admin'` in the simulation would have
    // refused this legal write.
    await expect(setRole('mem_usr_owner', 'member,admin')).resolves.toBeTruthy();
  });

  it('a downgrade to `delegated_admin` IS refused (ADR-0105 D8: reach, not authority)', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    await expect(setRole('mem_usr_owner', 'delegated_admin')).rejects.toThrow(
      /last administrator/i,
    );
  });

  it('a payload that touches neither `role` nor `user_id` is never guarded', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    // The invariant is scoped to the ENVIRONMENT, so moving the last admin's
    // membership to another organization cannot reduce the administrator
    // population — and the guard proves that statically (MEMBER_STANDING_KEYS)
    // rather than by running four reads on every membership write.
    await expect(
      engine.update('sys_member', { id: 'mem_usr_owner', organization_id: 'org_2' }, SYSTEM),
    ).resolves.toBeTruthy();
  });

  it('a platform admin elsewhere keeps the downgrade legal', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    // The survivor need not be an org admin: an unscoped `admin_full_access`
    // grant is the other half of the same enumeration.
    await expect(setRole('mem_usr_owner', 'member')).resolves.toBeTruthy();
  });

  it('re-homing the membership onto a BANNED user is refused', async () => {
    // The patch keeps the `owner` grade but moves it to someone who cannot sign
    // in — set arithmetic on the doomed row would call this harmless. Only a
    // real write-after simulation catches it: the after-set is `{usr_banned}`,
    // and `resolveUnbannedAdmins` empties it.
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_banned', { banned: true });

    await expect(
      engine.update('sys_member', { id: 'mem_usr_owner', user_id: 'usr_banned' }, SYSTEM),
    ).rejects.toThrow(/last administrator/i);
  });

  it('re-homing the membership onto an UNBANNED user is allowed', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_next');

    await expect(
      engine.update('sys_member', { id: 'mem_usr_owner', user_id: 'usr_next' }, SYSTEM),
    ).resolves.toBeTruthy();
  });
});

describe('[#5978] path 2 — deleting the last administrator\'s sys_member row', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
  });

  const removeMembership = (memberId: string) =>
    engine.delete('sys_member', { where: { id: memberId }, ...SYSTEM });

  it('two org admins: removing the first is allowed, removing the last is refused', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });

    await expect(removeMembership('mem_usr_admin')).resolves.toBeDefined();
    expect(await rowExists(engine, 'sys_member', 'mem_usr_admin')).toBe(false);

    await expect(removeMembership('mem_usr_owner')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      object: 'sys_member',
    });
    expect(await rowExists(engine, 'sys_member', 'mem_usr_owner')).toBe(true);
  });

  it(
    'THE INVERTED PIN: the exact write #5941 recorded as "not this guard\'s business" ' +
      'is now refused, and the sys_user row is still untouched',
    async () => {
      // Byte-for-byte the fixture that used to assert `.resolves.toBeDefined()`
      // a few describes up — same seed, same call, opposite verdict. This is
      // the before-red anchor for the whole change.
      await seedUser(engine, 'usr_owner', { role: 'owner' });

      await expect(
        engine.delete('sys_member', { where: { id: 'mem_usr_owner' }, ...SYSTEM }),
      ).rejects.toThrow(/last administrator/i);
      await expectUserRowUntouched(engine, 'usr_owner');
    },
  );

  it('the refusal names the removal, not a ban or a user delete', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    await expect(removeMembership('mem_usr_owner')).rejects.toThrow(
      /Refusing this membership removal/,
    );
    await expect(removeMembership('mem_usr_owner')).rejects.toThrow(/removing it/);
    await expect(removeMembership('mem_usr_owner')).rejects.toThrow(/ADR-0024 D5\.2/);
  });

  it('removing a non-administrative membership is allowed even with exactly one admin', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_member', { role: 'member' });
    await seedUser(engine, 'usr_delegate', { role: 'delegated_admin' });

    await expect(removeMembership('mem_usr_member')).resolves.toBeDefined();
    await expect(removeMembership('mem_usr_delegate')).resolves.toBeDefined();
  });

  it('removing the membership of an ALREADY-banned admin is allowed (nothing is taken away)', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner', banned: true });

    await expect(removeMembership('mem_usr_owner')).resolves.toBeDefined();
  });
});

describe('[#5978] path 3 — revoking the last administrator\'s admin_full_access grant', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
  });

  const revoke = (grantId: string) =>
    engine.delete('sys_user_permission_set', { where: { id: grantId }, ...SYSTEM });

  const editGrant = (grantId: string, patch: Record<string, unknown>) =>
    engine.update('sys_user_permission_set', { id: grantId, ...patch }, SYSTEM);

  it('two platform admins: revoking the first is allowed, revoking the last is refused', async () => {
    await seedUser(engine, 'usr_p1', { platformAdmin: true });
    await seedUser(engine, 'usr_p2', { platformAdmin: true });

    await expect(revoke('ups_usr_p1')).resolves.toBeDefined();
    expect(await rowExists(engine, 'sys_user_permission_set', 'ups_usr_p1')).toBe(false);

    await expect(revoke('ups_usr_p2')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      object: 'sys_user_permission_set',
    });
    expect(await rowExists(engine, 'sys_user_permission_set', 'ups_usr_p2')).toBe(true);
  });

  it('THE PATH ITSELF: the sys_user row is never touched', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true, accountProvider: 'oidc' });

    await expect(revoke('ups_usr_platform')).rejects.toThrow(/Refusing this grant removal/);
    await expectUserRowUntouched(engine, 'usr_platform');
  });

  it('ORG-SCOPING the last grant is refused — a tenant admin is not a break-glass admin', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    // The row survives and still points at `admin_full_access`; it just stops
    // being the UNSCOPED grant `resolveAuthzContext` derives `platform_admin`
    // from. Same end state, no delete anywhere.
    await expect(editGrant('ups_usr_platform', { organization_id: ORG })).rejects.toThrow(
      /Refusing this grant change/,
    );
    const row = await engine.findOne(
      'sys_user_permission_set',
      { where: { id: 'ups_usr_platform' } },
      SYSTEM,
    );
    expect(row?.organization_id).toBeFalsy();
  });

  it('EXPIRING the last grant is refused (ADR-0091 window, consumed as-is)', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });
    const past = new Date(Date.now() - 86_400_000).toISOString();

    await expect(editGrant('ups_usr_platform', { valid_until: past })).rejects.toThrow(
      /last administrator/i,
    );
  });

  it('back-DATING `valid_from` past now is refused too (the other half of the window)', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });
    const future = new Date(Date.now() + 86_400_000).toISOString();

    await expect(editGrant('ups_usr_platform', { valid_from: future })).rejects.toThrow(
      /last administrator/i,
    );
  });

  it('RE-POINTING the last grant at another permission set is refused', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    // The row is neither deleted nor scoped nor expired — it simply stops
    // granting `admin_full_access`. The simulation re-tests which set the grant
    // points at rather than trusting the enumeration's own `where`.
    await expect(editGrant('ups_usr_platform', { permission_set_id: 'ps_member' })).rejects.toThrow(
      /last administrator/i,
    );
  });

  it('EXTENDING the window, or editing a grant while another admin exists, is allowed', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });
    const future = new Date(Date.now() + 86_400_000).toISOString();

    // A standing key is touched, so the guard does run — and allows it.
    await expect(editGrant('ups_usr_platform', { valid_until: future })).resolves.toBeTruthy();

    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await expect(revoke('ups_usr_platform')).resolves.toBeDefined();
  });

  it('revoking an ALREADY-org-scoped grant is untouched — it never conferred standing', async () => {
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_scoped', { grant: { organization_id: ORG } });

    await expect(revoke('ups_usr_scoped')).resolves.toBeDefined();
  });

  it('revoking an ALREADY-expired grant is untouched', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await seedUser(engine, 'usr_expired', { grant: { valid_until: past } });
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    await expect(revoke('ups_usr_expired')).resolves.toBeDefined();
  });

  it('the non-loginable `usr_system` grant is never counted as the survivor', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });
    await seedUser(engine, SystemUserId.SYSTEM, { platformAdmin: true });

    await expect(revoke('ups_usr_platform')).rejects.toThrow(/last administrator/i);
  });
});

// ---------------------------------------------------------------------------
// [#5978] Predicate / bulk writes on the standing tables
// ---------------------------------------------------------------------------

describe('[#5978] the standing halves hold on predicate (multi) writes, not only by-id', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });
    await seedUser(engine, 'usr_member', { role: 'member' });
  });

  it('a predicate downgrade that would sweep every administrative membership is refused', async () => {
    // One `where`, every administrator: `input.id` is unbound on this dispatch,
    // so the guard resolves the matched set itself and simulates the payload
    // over all of it.
    await expect(
      engine.update(
        'sys_member',
        { role: 'member' },
        { multi: true, where: { role: { $ne: 'member' } }, ...SYSTEM },
      ),
    ).rejects.toThrow(/last administrators/i);
    expect(await memberRole(engine, 'mem_usr_owner')).toBe('owner');
    expect(await memberRole(engine, 'mem_usr_admin')).toBe('admin');
  });

  it('an unpredicated `multi` membership delete — the one that empties the table — is refused', async () => {
    await expect(engine.delete('sys_member', { multi: true, ...SYSTEM })).rejects.toThrow(
      /last administrators/i,
    );
    expect(await rowExists(engine, 'sys_member', 'mem_usr_owner')).toBe(true);
  });

  it('an `$in` predicate naming both administrative memberships is refused', async () => {
    await expect(
      engine.delete('sys_member', {
        multi: true,
        where: { id: { $in: ['mem_usr_owner', 'mem_usr_admin'] } },
        ...SYSTEM,
      }),
    ).rejects.toThrow(/last administrators/i);
  });

  it('a predicate that spares one administrator proceeds', async () => {
    await expect(
      engine.update(
        'sys_member',
        { role: 'member' },
        { multi: true, where: { id: { $in: ['mem_usr_admin', 'mem_usr_member'] } }, ...SYSTEM },
      ),
    ).resolves.toBeDefined();
    expect(await memberRole(engine, 'mem_usr_admin')).toBe('member');
    expect(await memberRole(engine, 'mem_usr_owner')).toBe('owner');
  });

  it('a predicate revoke that would sweep every admin_full_access grant is refused', async () => {
    const grantEngine = await boot();
    await seedAdminPermissionSet(grantEngine);
    await seedUser(grantEngine, 'usr_p1', { platformAdmin: true });
    await seedUser(grantEngine, 'usr_p2', { platformAdmin: true });

    await expect(
      grantEngine.delete('sys_user_permission_set', {
        multi: true,
        where: { permission_set_id: PS_ADMIN },
        ...SYSTEM,
      }),
    ).rejects.toThrow(/last administrators/i);
    expect(await rowExists(grantEngine, 'sys_user_permission_set', 'ups_usr_p1')).toBe(true);
    expect(await rowExists(grantEngine, 'sys_user_permission_set', 'ups_usr_p2')).toBe(true);
  });

  it('a predicate grant EDIT that would expire every admin grant at once is refused', async () => {
    const grantEngine = await boot();
    await seedAdminPermissionSet(grantEngine);
    await seedUser(grantEngine, 'usr_p1', { platformAdmin: true });
    await seedUser(grantEngine, 'usr_p2', { platformAdmin: true });
    const past = new Date(Date.now() - 86_400_000).toISOString();

    await expect(
      grantEngine.update(
        'sys_user_permission_set',
        { valid_until: past },
        { multi: true, where: { permission_set_id: PS_ADMIN }, ...SYSTEM },
      ),
    ).rejects.toThrow(/last administrators/i);
  });
});

// ---------------------------------------------------------------------------
// [#5978] Fail-closed, on the standing halves too
// ---------------------------------------------------------------------------

describe('[#5978] the standing halves fail CLOSED', () => {
  it('a failing identity read refuses the membership removal and names the reason', async () => {
    const engine = await boot({
      readThrough: (real) => ({
        registerHook: (event, handler, options) => real.registerHook(event, handler, options),
        find: async () => {
          throw new Error('sys_member is unreadable');
        },
      }),
    });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });

    // Two admins exist — this removal WOULD be legal. It is refused anyway.
    await expect(
      engine.delete('sys_member', { where: { id: 'mem_usr_admin' }, ...SYSTEM }),
    ).rejects.toThrow(/Refusing this membership removal/);
    await expect(
      engine.delete('sys_member', { where: { id: 'mem_usr_admin' }, ...SYSTEM }),
    ).rejects.toThrow(/could not be verified/i);
    await expect(
      engine.delete('sys_member', { where: { id: 'mem_usr_admin' }, ...SYSTEM }),
    ).rejects.toThrow(/sys_member is unreadable/);
    expect(await rowExists(engine, 'sys_member', 'mem_usr_admin')).toBe(true);
  });

  it('a failing identity read refuses the role downgrade too', async () => {
    const engine = await boot({
      readThrough: (real) => ({
        registerHook: (event, handler, options) => real.registerHook(event, handler, options),
        find: async () => {
          throw new Error('identity tables are unreadable');
        },
      }),
    });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });

    await expect(
      engine.update('sys_member', { id: 'mem_usr_admin', role: 'member' }, SYSTEM),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', object: 'sys_member' });
    expect(await memberRole(engine, 'mem_usr_admin')).toBe('admin');
  });

  it('a failing identity read refuses the grant revoke too', async () => {
    const engine = await boot({
      readThrough: (real) => ({
        registerHook: (event, handler, options) => real.registerHook(event, handler, options),
        find: async () => {
          throw new Error('identity tables are unreadable');
        },
      }),
    });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_p1', { platformAdmin: true });
    await seedUser(engine, 'usr_p2', { platformAdmin: true });

    await expect(
      engine.delete('sys_user_permission_set', { where: { id: 'ups_usr_p1' }, ...SYSTEM }),
    ).rejects.toThrow(/Refusing this grant removal/);
    expect(await rowExists(engine, 'sys_user_permission_set', 'ups_usr_p1')).toBe(true);
  });

  it('a population larger than the guard can enumerate refuses, in the op\'s own words', async () => {
    const engine = await boot({ maxScan: 1 });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });
    await seedUser(engine, 'usr_admin', { role: 'admin' });

    // The advice is about the table the caller wrote — "a narrower set of
    // memberships", not "of users".
    await expect(
      engine.delete('sys_member', { where: { id: 'mem_usr_admin' }, ...SYSTEM }),
    ).rejects.toThrow(/more than 1 rows/);
    await expect(
      engine.delete('sys_member', { where: { id: 'mem_usr_admin' }, ...SYSTEM }),
    ).rejects.toThrow(/Remove a narrower set of memberships/);
    expect(await rowExists(engine, 'sys_member', 'mem_usr_admin')).toBe(true);
  });

  it('an environment with no administrator at all is not blocked (nothing to protect)', async () => {
    const engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_a', { role: 'member' });

    await expect(
      engine.delete('sys_member', { where: { id: 'mem_usr_a' }, ...SYSTEM }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// [#5978] Face 2 — the better-auth `updateMemberRole` / organization path
// ---------------------------------------------------------------------------

describe('[#5978] the updateMemberRole path: refused as a 403, not an opaque 500', () => {
  let engine: ObjectQL;
  let adapter: {
    update: (args: { model: string; where: unknown[]; update: Record<string, unknown> }) => Promise<unknown>;
  };

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner', accountProvider: 'oidc' });
    await seedUser(engine, 'usr_admin', { role: 'admin', accountProvider: 'oidc' });
    // The organization plugin has to be in the options for the same reason the
    // admin plugin does in the #5892 block: `createAdapterFactory` resolves
    // `member` → `sys_member` off ITS schema (`buildOrganizationPluginSchema`,
    // the mapping `AuthManager` passes), so without it the write would not
    // reach the guarded table at all.
    adapter = (createObjectQLAdapterFactory(engine) as unknown as (o: unknown) => typeof adapter)({
      plugins: [organization({ schema: buildOrganizationPluginSchema() })],
    });
  });

  /** What better-auth's `updateMemberRole` ultimately writes. */
  const changeRole = (memberId: string, role: string) =>
    adapter.update({
      model: 'member',
      where: [{ field: 'id', value: memberId, operator: 'eq', connector: 'AND' }],
      update: { role },
    });

  it('downgrading the second-to-last administrator succeeds', async () => {
    await expect(changeRole('mem_usr_admin', 'member')).resolves.toBeTruthy();
    expect(await memberRole(engine, 'mem_usr_admin')).toBe('member');
  });

  it('downgrading the LAST administrator is refused with a 403 APIError', async () => {
    await changeRole('mem_usr_admin', 'member');

    let caught: unknown;
    try {
      await changeRole('mem_usr_owner', 'member');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(isAPIError(caught)).toBe(true);
    const api = caught as { statusCode: number; body: { code?: string; message?: string } };
    expect(api.statusCode).toBe(403);
    expect(api.body.code).toBe('PERMISSION_DENIED');
    expect(api.body.message).toMatch(/last administrator/i);
    expect(await memberRole(engine, 'mem_usr_owner')).toBe('owner');
  });
});

// ---------------------------------------------------------------------------
// [#5978] Reverse verification — the same fixtures with the guard NOT registered
//
// Direction, decided before running: RED, the usual one. With
// `registerLastAdminGuard` not called, every case in the three path blocks
// above is "the write succeeds and the standing is gone". These three re-run
// that on the same fixtures rather than describing it.
// ---------------------------------------------------------------------------

describe('[#5978] reverse verification: without the guard, the third path locks the env out', () => {
  it('the unguarded engine downgrades the last administrator and reports success', async () => {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner', accountProvider: 'oidc' });
    await seedUser(engine, 'usr_escape', { role: 'member', accountProvider: 'credential' });

    await expect(
      engine.update('sys_member', { id: 'mem_usr_owner', role: 'member' }, SYSTEM),
    ).resolves.toBeTruthy();
    expect(await memberRole(engine, 'mem_usr_owner')).toBe('member');
    // The issue's end state, spelled out: every user row is present and
    // unbanned — which is exactly why #5892 and #5941 see nothing wrong — and
    // no row in either standing table grades as an administrator any more.
    expect(await userExists(engine, 'usr_owner')).toBe(true);
    expect(await bannedFlag(engine, 'usr_owner')).toBeFalsy();
    const admins = await engine.find(
      'sys_member',
      { where: { role: { $ne: 'member' } } },
      SYSTEM,
    );
    expect(admins).toHaveLength(0);
  });

  it('the unguarded engine DELETES the last administrative membership', async () => {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    await expect(
      engine.delete('sys_member', { where: { id: 'mem_usr_owner' }, ...SYSTEM }),
    ).resolves.toBeDefined();
    expect(await rowExists(engine, 'sys_member', 'mem_usr_owner')).toBe(false);
    expect(await userExists(engine, 'usr_owner')).toBe(true);
  });

  it('the unguarded engine REVOKES the last admin_full_access grant', async () => {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(
      engine.delete('sys_user_permission_set', { where: { id: 'ups_usr_platform' }, ...SYSTEM }),
    ).resolves.toBeDefined();
    expect(await rowExists(engine, 'sys_user_permission_set', 'ups_usr_platform')).toBe(false);
    expect(await userExists(engine, 'usr_platform')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// [#6084] The FOURTH write shape — the one table that is not an identity table
//
// "Who is a platform admin" is resolved BY NAME: `resolveAdminUserIds` looks
// the permission set up as `where: { name: 'admin_full_access' }` and only then
// reads the grants pointing at its id. So the row named `admin_full_access` is
// itself part of the administrator evidence, and deleting it — or calling it
// something else — un-makes every platform admin in one write while `sys_user`,
// `sys_member` and `sys_user_permission_set` all stay exactly as they were.
//
// The block pins the same five things each earlier path did, plus the one this
// path adds: the guard must NOT go quiet on every other path afterwards.
// ---------------------------------------------------------------------------

describe('[#6084] path 4 — deleting or renaming the admin_full_access permission-set row', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
  });

  /** What a metadata delete (`retirePermissionSetRecord`) ultimately writes. */
  const deleteSet = (id: string) =>
    engine.delete('sys_permission_set', { where: { id }, ...SYSTEM });
  const renameSet = (id: string, name: string) =>
    engine.update('sys_permission_set', { id, name }, SYSTEM);

  const setName = async (id: string): Promise<unknown> => {
    const row = await engine.findOne('sys_permission_set', { where: { id } }, SYSTEM);
    return row?.name;
  };

  it('THE REPRODUCTION from the issue: deleting the row is refused and the row survives', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(deleteSet(PS_ADMIN)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      object: 'sys_permission_set',
    });
    expect(await rowExists(engine, 'sys_permission_set', PS_ADMIN)).toBe(true);
  });

  it('RENAMING it is refused too — the row would survive, the standing would not', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(renameSet(PS_ADMIN, 'admin_full_access_old')).rejects.toThrow(
      /last administrator/i,
    );
    // Nothing was written: the enumeration still finds the row by its name.
    expect(await setName(PS_ADMIN)).toBe(ADMIN_FULL_ACCESS);
  });

  it('THE PATH ITSELF: no identity table is touched, which is why the first three halves miss it', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true, accountProvider: 'oidc' });

    await expect(deleteSet(PS_ADMIN)).rejects.toThrow(/ADR-0024 D5\.2/);
    // The user row is present and unbanned (#5892 / #5941 see nothing), and the
    // grant row is untouched as well (#5978 sees nothing) — the write lands on
    // a fourth table entirely, and is still refused.
    await expectUserRowUntouched(engine, 'usr_platform');
    expect(await rowExists(engine, 'sys_user_permission_set', 'ups_usr_platform')).toBe(true);
  });

  it('the refusal explains itself: who loses standing, which table, why, and the fix', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(deleteSet(PS_ADMIN)).rejects.toThrow(/Refusing this permission-set removal/);
    // The USER about to be locked out is named, not the permission-set row id.
    await expect(deleteSet(PS_ADMIN)).rejects.toThrow(/'usr_platform'/);
    await expect(deleteSet(PS_ADMIN)).rejects.toThrow(/last administrator/i);
    await expect(deleteSet(PS_ADMIN)).rejects.toThrow(/sys_permission_set/);
    await expect(deleteSet(PS_ADMIN)).rejects.toThrow(/ADR-0024 D5\.2/);
    await expect(deleteSet(PS_ADMIN)).rejects.toThrow(new RegExp(ADMIN_FULL_ACCESS));
    // …and the closing advice names the doors that actually write this table.
    await expect(deleteSet(PS_ADMIN)).rejects.toThrow(/package uninstall/);

    // NOT the SCIM sentence the other standing halves end with: nothing in an
    // IdP writes `sys_permission_set`, so pointing this operator at a group
    // mapping would send them into a system they may not even run.
    let message = '';
    try {
      await deleteSet(PS_ADMIN);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(/SCIM group mapping/);
  });

  it('a rename to a DIFFERENT name is what is refused — the payload is simulated, not pattern-matched', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    // Re-writing the same name changes nothing the enumeration reads, so the
    // simulation finds the administrator still there and the write proceeds.
    await expect(renameSet(PS_ADMIN, ADMIN_FULL_ACCESS)).resolves.toBeTruthy();
    await expect(renameSet(PS_ADMIN, 'something_else')).rejects.toThrow(/last administrator/i);
  });

  // ── not over-tightened ────────────────────────────────────────────────────

  it('an org admin elsewhere keeps the removal legal — the invariant is the ENVIRONMENT\'s', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    // The platform-admin half of the enumeration goes empty and the guard has
    // no opinion, because the environment still has an administrator. A rule
    // that protected the platform-admin POPULATION rather than the environment
    // would have refused this.
    await expect(deleteSet(PS_ADMIN)).resolves.toBeDefined();
    expect(await rowExists(engine, 'sys_permission_set', PS_ADMIN)).toBe(false);
  });

  it('a payload that does not touch `name` costs no reads at all', async () => {
    const quiet = await boot({
      readThrough: (real) => ({
        registerHook: (event, handler, options) => real.registerHook(event, handler, options),
        find: async () => {
          throw new Error('the guard must not read anything for a non-name payload');
        },
      }),
    });
    await seedAdminPermissionSet(quiet);
    await seedUser(quiet, 'usr_platform', { platformAdmin: true });

    // Every read this guard makes runs inside the fail-CLOSED envelope, so a
    // payload that provoked ANY read here would come back as a refusal. It
    // resolving is the proof that PERMISSION_SET_STANDING_KEYS skipped it
    // statically — which is the shape of every projection pass, every
    // `os meta resync` and every Setup edit of a permission set.
    await expect(
      quiet.update('sys_permission_set', { id: PS_ADMIN, label: 'Full Access (edited)' }, SYSTEM),
    ).resolves.toBeTruthy();
  });

  it('deleting or renaming ANOTHER permission set is unaffected', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(renameSet('ps_member', 'member_default_v2')).resolves.toBeTruthy();
    await expect(deleteSet('ps_member')).resolves.toBeDefined();
    expect(await rowExists(engine, 'sys_permission_set', PS_ADMIN)).toBe(true);
  });

  it('an ALREADY-banned platform admin is not protected — nothing is being taken away', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true, banned: true });

    await expect(deleteSet(PS_ADMIN)).resolves.toBeDefined();
  });

  it('an ORG-SCOPED grant holder never was a break-glass admin, so the row stays removable', async () => {
    await seedUser(engine, 'usr_scoped', { grant: { organization_id: ORG } });

    await expect(deleteSet(PS_ADMIN)).resolves.toBeDefined();
  });

  // ── predicate / bulk, and fail-closed ─────────────────────────────────────

  it('an unpredicated `multi` delete — the one that empties the table — is refused', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(engine.delete('sys_permission_set', { multi: true, ...SYSTEM })).rejects.toThrow(
      /last administrator/i,
    );
    expect(await rowExists(engine, 'sys_permission_set', PS_ADMIN)).toBe(true);
  });

  it('a predicate rename that sweeps every permission set at once is refused', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(
      engine.update(
        'sys_permission_set',
        { name: 'retired' },
        { multi: true, where: { id: { $in: [PS_ADMIN, 'ps_member'] } }, ...SYSTEM },
      ),
    ).rejects.toThrow(/last administrator/i);
    expect(await setName(PS_ADMIN)).toBe(ADMIN_FULL_ACCESS);
  });

  it('fails CLOSED: an unreadable table refuses a removal that would have been legal', async () => {
    const broken = await boot({
      readThrough: (real) => ({
        registerHook: (event, handler, options) => real.registerHook(event, handler, options),
        find: async () => {
          throw new Error('sys_permission_set is unreadable');
        },
      }),
    });
    await seedAdminPermissionSet(broken);
    await seedUser(broken, 'usr_platform', { platformAdmin: true });
    await seedUser(broken, 'usr_owner', { role: 'owner' });

    // Two administrators exist — this removal WOULD be legal. Refused anyway.
    await expect(
      broken.delete('sys_permission_set', { where: { id: PS_ADMIN }, ...SYSTEM }),
    ).rejects.toThrow(/Refusing this permission-set removal/);
    await expect(
      broken.delete('sys_permission_set', { where: { id: PS_ADMIN }, ...SYSTEM }),
    ).rejects.toThrow(/sys_permission_set is unreadable/);
    expect(await rowExists(broken, 'sys_permission_set', PS_ADMIN)).toBe(true);
  });

  it('a population larger than the guard can enumerate refuses, in the op\'s own words', async () => {
    const tiny = await boot({ maxScan: 1 });
    await seedAdminPermissionSet(tiny);
    await seedUser(tiny, 'usr_p1', { platformAdmin: true });
    await seedUser(tiny, 'usr_p2', { platformAdmin: true });

    await expect(
      tiny.delete('sys_permission_set', { where: { id: PS_ADMIN }, ...SYSTEM }),
    ).rejects.toThrow(/Remove a narrower set of permission sets/);
    expect(await rowExists(tiny, 'sys_permission_set', PS_ADMIN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// [#6084] The AMPLIFICATION — the half that matters more than the fourth hook
//
// Both verdicts open with "no administrator here, nothing to protect, proceed".
// An environment whose `admin_full_access` row is gone reads exactly that way,
// so before this change ONE write did not merely lock the environment out — it
// switched the guard off for #5892, #5941 and #5978 as well.
//
// So "zero administrators" is now split into the two states it was conflating:
// a genuinely fresh environment (permitted, unchanged) and one that was emptied
// (refused). The evidence is a DANGLING unscoped in-window grant, which no
// producer can write — every one of them inserts the permission set first and
// reads its id back — so the bootstrap window's behaviour is unchanged by
// construction, and the tests below measure that in both directions.
// ---------------------------------------------------------------------------

describe('[#6084] a zero-administrator reading is no longer automatically the bootstrap window', () => {
  /**
   * The environment the fourth path leaves behind, built the only way it can
   * still be reached now that the write itself is guarded: the delete lands
   * while the guard is NOT registered — a pre-#6084 deployment, a migration, a
   * restore, a direct database edit — and the platform then boots with the
   * guard on, which is when `registerLastAdminGuard` runs for real.
   */
  async function wipedEnvironment(): Promise<ObjectQL> {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_platform', { platformAdmin: true, accountProvider: 'oidc' });
    await engine.delete('sys_permission_set', { where: { id: PS_ADMIN }, ...SYSTEM });
    registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, {
      packageId: 'test.last-admin-guard',
    });
    return engine;
  }

  it('THE REGRESSION PIN: the emptied environment refuses the ban the exemption used to wave through', async () => {
    const engine = await wipedEnvironment();

    await expect(ban(engine, 'usr_platform')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(await bannedFlag(engine, 'usr_platform')).toBeFalsy();
  });

  it('…and the user delete and the grant revoke with it — all three halves stay on', async () => {
    const engine = await wipedEnvironment();

    await expect(removeUser(engine, 'usr_platform')).rejects.toThrow(/#6084/);
    await expect(
      engine.delete('sys_user_permission_set', { where: { id: 'ups_usr_platform' }, ...SYSTEM }),
    ).rejects.toThrow(/#6084/);
    expect(await userExists(engine, 'usr_platform')).toBe(true);
    expect(await rowExists(engine, 'sys_user_permission_set', 'ups_usr_platform')).toBe(true);
  });

  it('the refusal names the evidence, the cause and the way back', async () => {
    const engine = await wipedEnvironment();

    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/recognises NO administrator/);
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/not the bootstrap window/i);
    // Holder and target are both quoted, so an operator can go find the row.
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/'usr_platform'/);
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(new RegExp(PS_ADMIN));
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(new RegExp(ADMIN_FULL_ACCESS));
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/ADR-0024 D5\.2/);
  });

  it('after the fourth path is REFUSED, the other three guards still answer in that environment', async () => {
    const engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    // The write that would have disabled everything is refused…
    await expect(
      engine.delete('sys_permission_set', { where: { id: PS_ADMIN }, ...SYSTEM }),
    ).rejects.toThrow(/last administrator/i);
    // …and in the SAME environment the three earlier paths still refuse with
    // the ordinary last-administrator verdict rather than the bootstrap
    // exemption — which is what "the fourth write does not disarm the other
    // three" means, measured instead of argued.
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/last administrator/i);
    await expect(removeUser(engine, 'usr_platform')).rejects.toThrow(/last administrator/i);
    await expect(
      engine.delete('sys_user_permission_set', { where: { id: 'ups_usr_platform' }, ...SYSTEM }),
    ).rejects.toThrow(/last administrator/i);
  });

  // ── the bootstrap window itself, unchanged ────────────────────────────────

  it('a genuinely fresh environment stays writable — every bootstrap write still lands', async () => {
    const engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_first', { role: 'member' });

    // No administrator, and no evidence there ever was one: this IS the
    // bootstrap window, and it behaves exactly as it did before #6084.
    await expect(
      engine.delete('sys_member', { where: { id: 'mem_usr_first' }, ...SYSTEM }),
    ).resolves.toBeDefined();
    await expect(ban(engine, 'usr_first')).resolves.toBeTruthy();
    await expect(removeUser(engine, 'usr_first')).resolves.toBeDefined();
    // …including writes to the fourth table: an environment with no
    // administrator to lose can still rename and retire the set row.
    await expect(
      engine.update('sys_permission_set', { id: PS_ADMIN, name: 'admin_full_access_v2' }, SYSTEM),
    ).resolves.toBeTruthy();
    await expect(
      engine.delete('sys_permission_set', { where: { id: PS_ADMIN }, ...SYSTEM }),
    ).resolves.toBeDefined();
  });

  it('an unscoped grant whose permission set still EXISTS is not evidence of a wipe', async () => {
    const engine = await boot();
    await seedAdminPermissionSet(engine);
    // An ordinary pre-first-admin state: somebody holds `member_default`
    // unscoped, and nobody is an administrator yet.
    await seedUser(engine, 'usr_a', { grant: { permission_set_id: 'ps_member' } });

    await expect(ban(engine, 'usr_a')).resolves.toBeTruthy();
  });

  it('an ORG-SCOPED dangling grant is not evidence — it never conferred platform standing', async () => {
    const engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_a', {
      grant: { permission_set_id: 'ps_gone', organization_id: ORG },
    });

    await expect(ban(engine, 'usr_a')).resolves.toBeTruthy();
  });

  it('an EXPIRED dangling grant is not evidence either (ADR-0091, the same predicate)', async () => {
    const engine = await boot();
    await seedAdminPermissionSet(engine);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await seedUser(engine, 'usr_a', {
      grant: { permission_set_id: 'ps_gone', valid_until: past },
    });

    await expect(ban(engine, 'usr_a')).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// [#6084] Reverse verification — the same fixtures with the guard NOT registered
//
// Direction, decided before running: RED, the usual one. Without
// `registerLastAdminGuard` the fourth write succeeds and takes the whole
// platform-admin population with it, and the ban that follows succeeds too —
// the amplification, on the engine as it behaved before this change.
//
// The second half of that pair is the `wipedEnvironment()` block above: same
// wipe, guard registered afterwards, and the ban is refused. Together the two
// isolate what the bootstrap predicate contributes, which neither can do alone.
// ---------------------------------------------------------------------------

describe('[#6084] reverse verification: one unguarded write takes the admins AND the guard', () => {
  it('the unguarded engine deletes the admin_full_access row and every platform admin evaporates', async () => {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_platform', { platformAdmin: true, accountProvider: 'oidc' });

    await expect(
      engine.delete('sys_permission_set', { where: { id: PS_ADMIN }, ...SYSTEM }),
    ).resolves.toBeDefined();
    // The issue's end state: the user row, its account and its grant are all
    // exactly as they were — which is precisely why the first three shapes see
    // nothing wrong — and no `admin_full_access` row is left to resolve.
    expect(await userExists(engine, 'usr_platform')).toBe(true);
    expect(await bannedFlag(engine, 'usr_platform')).toBeFalsy();
    expect(await rowExists(engine, 'sys_user_permission_set', 'ups_usr_platform')).toBe(true);
    expect(await rowExists(engine, 'sys_permission_set', PS_ADMIN)).toBe(false);
  });

  it('THE AMPLIFICATION: on that same engine the ban of the last administrator then succeeds', async () => {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await engine.delete('sys_permission_set', { where: { id: PS_ADMIN }, ...SYSTEM });
    await expect(ban(engine, 'usr_platform')).resolves.toBeTruthy();
    expect(await bannedFlag(engine, 'usr_platform')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// [#8613 / ADR-0049] Write shape (4), third spelling: DEACTIVATING the row
//
// `sys_permission_set.active` used to be inert — a badge in Setup and nothing
// else — so the #6084 standing-key list could exclude it in writing, and did.
// Enforcing the flag at the resolution seam makes `active: false` on
// `admin_full_access` un-make every platform admin at once, by a payload that
// touches neither `name` nor any identity table, through a row action that
// carries no visibility or condition guard. Unguarded, that is one click and an
// installation-wide lockout with no path back: the seeders deliberately never
// reconcile `active`, and re-activating needs the permission just lost.
//
// Deactivation also leaves NO dangling grant, so the #6084 bootstrap predicate
// cannot see it — the set row is still there, still correctly named. Hence the
// second half of this block: the same emptiness, its own evidence, its own
// remedy, and an exemption for the write that IS the remedy.
// ---------------------------------------------------------------------------

describe('[#8613] path 4, third spelling — deactivating the admin_full_access permission set', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await boot();
    await seedAdminPermissionSet(engine);
  });

  /** Exactly what the `deactivate_permission_set` row action PATCHes. */
  const deactivate = (id: string) =>
    engine.update('sys_permission_set', { id, active: false }, SYSTEM);

  /**
   * Whether the STORED row reads as deactivated, in whichever shape sqlite
   * hands back — `0`, `false`, or the NULL a never-written column keeps. The
   * predicate under test treats absent as ACTIVE, so this asserts the write did
   * not land rather than asserting one particular spelling of "off".
   */
  const isDeactivated = async (id: string): Promise<boolean> => {
    const row = await engine.findOne('sys_permission_set', { where: { id } }, SYSTEM);
    const flag = row?.active as unknown;
    return flag === 0 || flag === false || flag === '0';
  };

  it('THE ONE-CLICK LOCKOUT: deactivating it is refused and the row stays active', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(deactivate(PS_ADMIN)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      object: 'sys_permission_set',
    });
    // Nothing was written — the row is still there and still grants.
    expect(await isDeactivated(PS_ADMIN)).toBe(false);
    expect(await rowExists(engine, 'sys_permission_set', PS_ADMIN)).toBe(true);
  });

  it('no identity table is touched, exactly as in the delete and rename spellings', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true, accountProvider: 'oidc' });

    await expect(deactivate(PS_ADMIN)).rejects.toThrow(/ADR-0024 D5\.2/);
    await expectUserRowUntouched(engine, 'usr_platform');
    expect(await rowExists(engine, 'sys_user_permission_set', 'ups_usr_platform')).toBe(true);
  });

  it('the refusal names the user who would lose standing', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(deactivate(PS_ADMIN)).rejects.toThrow(/'usr_platform'/);
    await expect(deactivate(PS_ADMIN)).rejects.toThrow(/last administrator/i);
  });

  it('RE-activating is never refused — the payload is simulated, not pattern-matched', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    // Same column, same standing-key hit, opposite direction: the simulation
    // finds the administrator still there afterwards, so it proceeds.
    await expect(
      engine.update('sys_permission_set', { id: PS_ADMIN, active: true }, SYSTEM),
    ).resolves.toBeTruthy();
  });

  it('an org admin elsewhere keeps the deactivation legal — the invariant is the ENVIRONMENT\'s', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    await expect(deactivate(PS_ADMIN)).resolves.toBeTruthy();
  });

  it('deactivating ANOTHER permission set is unaffected', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(deactivate('ps_member')).resolves.toBeTruthy();
    expect(await isDeactivated('ps_member')).toBe(true);
    expect(await isDeactivated(PS_ADMIN)).toBe(false);
  });

  it('a predicate write that sweeps every set at once is refused', async () => {
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await expect(
      engine.update(
        'sys_permission_set',
        { active: false },
        { multi: true, where: { id: { $in: [PS_ADMIN, 'ps_member'] } }, ...SYSTEM },
      ),
    ).rejects.toThrow(/last administrator/i);
  });

  it('a payload that touches NEITHER `name` nor `active` still costs no reads at all', async () => {
    const quiet = await boot({
      readThrough: (real) => ({
        registerHook: (event, handler, options) => real.registerHook(event, handler, options),
        find: async () => {
          throw new Error('the guard must not read anything for a row-state-free payload');
        },
      }),
    });
    await seedAdminPermissionSet(quiet);
    await seedUser(quiet, 'usr_platform', { platformAdmin: true });

    // Adding `active` to the standing keys must not walk back the #6084
    // read-freeness: the projection is facets-only and never re-flips the
    // switch, so every projection pass and `os meta resync` still skips this
    // guard statically. Any read would surface as a refusal.
    await expect(
      quiet.update('sys_permission_set', { id: PS_ADMIN, label: 'Full Access (edited)' }, SYSTEM),
    ).resolves.toBeTruthy();
  });
});

describe('[#8613] a DEACTIVATED break-glass set is an emptied environment, not a fresh one', () => {
  /**
   * The state the third spelling leaves behind, reachable the same way #6084's
   * is: the deactivation lands while the guard is not registered (a pre-#8613
   * deployment that clicked Deactivate while the flag was inert, a migration, a
   * direct database edit), and the platform then boots with the guard on.
   *
   * This is the population the behaviour flip lands hardest on, which is why it
   * is pinned rather than reasoned about: on those installations `active:false`
   * was a no-op until this change, so the row can already be off on upgrade.
   */
  async function deactivatedEnvironment(): Promise<ObjectQL> {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_platform', { platformAdmin: true, accountProvider: 'oidc' });
    await engine.update('sys_permission_set', { id: PS_ADMIN, active: false }, SYSTEM);
    registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, {
      packageId: 'test.last-admin-guard',
    });
    return engine;
  }

  it('THE AMPLIFIER PIN: the ban the bootstrap exemption would have waved through is refused', async () => {
    const engine = await deactivatedEnvironment();

    await expect(ban(engine, 'usr_platform')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(await bannedFlag(engine, 'usr_platform')).toBeFalsy();
  });

  it('…and the user delete and the grant revoke with it — all three halves stay on', async () => {
    const engine = await deactivatedEnvironment();

    await expect(removeUser(engine, 'usr_platform')).rejects.toThrow(/DEACTIVATED/);
    await expect(
      engine.delete('sys_user_permission_set', { where: { id: 'ups_usr_platform' }, ...SYSTEM }),
    ).rejects.toThrow(/DEACTIVATED/);
    expect(await userExists(engine, 'usr_platform')).toBe(true);
  });

  it('the refusal names the evidence, the cause and the way back', async () => {
    const engine = await deactivatedEnvironment();

    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/recognises NO administrator/);
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/DEACTIVATED/);
    // The remedy is the one that actually works here — re-activate, NOT the
    // "restore the deleted row" sentence the #6084 wipe prescribes.
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/Re-activate/);
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(new RegExp(ADMIN_FULL_ACCESS));
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/ADR-0024 D5\.2/);
  });

  it('THE WAY BACK IS OPEN: re-activating the set is permitted from inside that environment', async () => {
    const engine = await deactivatedEnvironment();

    // Every other guarded write is refused above. If the remedy the refusal
    // prescribes were refused too, the guard itself would be the lockout.
    await expect(
      engine.update('sys_permission_set', { id: PS_ADMIN, active: true }, SYSTEM),
    ).resolves.toBeTruthy();
    // …and the environment is whole again: the ordinary verdict is back.
    await expect(ban(engine, 'usr_platform')).rejects.toThrow(/last administrator/i);
  });

  it('a deactivated set nobody holds an unscoped grant to is NOT evidence', async () => {
    const engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_a', { grant: { permission_set_id: 'ps_member' } });
    // No unscoped grant points at `admin_full_access`, so switching it off
    // strands nobody — this is an ordinary pre-first-admin environment.
    await engine.update('sys_permission_set', { id: PS_ADMIN, active: false }, SYSTEM);

    await expect(ban(engine, 'usr_a')).resolves.toBeTruthy();
  });

  it('a genuinely fresh environment is untouched — no set is deactivated at all', async () => {
    const engine = await boot();
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_first', { role: 'member' });

    await expect(ban(engine, 'usr_first')).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// [#8613] Reverse verification — the same fixtures with the guard NOT registered
//
// Direction, decided before running: RED, the usual one. Without
// `registerLastAdminGuard` the deactivation succeeds, every platform admin
// evaporates while every row survives untouched, and the ban that follows
// succeeds too. The guarded halves above are measured against exactly this.
// ---------------------------------------------------------------------------

describe('[#8613] reverse verification: unguarded, one click takes the admins AND the guard', () => {
  it('the unguarded engine deactivates the row and leaves every other row intact', async () => {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_platform', { platformAdmin: true, accountProvider: 'oidc' });

    await expect(
      engine.update('sys_permission_set', { id: PS_ADMIN, active: false }, SYSTEM),
    ).resolves.toBeTruthy();
    expect(await userExists(engine, 'usr_platform')).toBe(true);
    expect(await bannedFlag(engine, 'usr_platform')).toBeFalsy();
    expect(await rowExists(engine, 'sys_user_permission_set', 'ups_usr_platform')).toBe(true);
    // The row is STILL THERE and still correctly named — which is exactly why
    // the #6084 dangling-grant predicate cannot see this state.
    expect(await rowExists(engine, 'sys_permission_set', PS_ADMIN)).toBe(true);
  });

  it('THE AMPLIFICATION: on that same engine the ban of the last administrator then succeeds', async () => {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_platform', { platformAdmin: true });

    await engine.update('sys_permission_set', { id: PS_ADMIN, active: false }, SYSTEM);
    await expect(ban(engine, 'usr_platform')).resolves.toBeTruthy();
    expect(await bannedFlag(engine, 'usr_platform')).toBeTruthy();
  });
});
