// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5892 / cloud ADR-0024 D5.2] The break-glass ban guard.
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
 *  1. **The engine write** — `engine.update('sys_user', …)`, by-id and
 *     predicate/multi, which is every path that reaches the column.
 *  2. **The SCIM / admin-ban path** — the same refusal driven through
 *     `createObjectQLAdapterFactory`, the adapter `@better-auth/scim`'s
 *     `active: false` → admin ban actually writes through, asserting it
 *     surfaces as a 403 `APIError` and not an opaque 500.
 *
 * Reverse verification (recorded because the direction is not obvious): with
 * `registerLastAdminBanGuard` NOT called, the "last administrator" cases below
 * are GREEN-as-in-the-ban-succeeds — `engine.update` resolves and the row comes
 * back `banned = 1`. That is the pre-#5892 behaviour, and it is what every
 * `rejects.toThrow` here is measured against.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { isAPIError } from 'better-auth/api';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { SystemUserId } from '@objectstack/spec/system';
import { registerLastAdminBanGuard, type LastAdminBanGuardEngine } from './last-admin-ban-guard.js';
import { registerIdentityWriteGuard, registerManagedUpdateWhitelist } from './identity-write-guard.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';
import { createObjectQLAdapterFactory } from './objectql-adapter.js';
import { buildAdminPluginSchema } from './auth-schema-config.js';
import { admin } from 'better-auth/plugins/admin';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sysUser = {
  name: 'sys_user',
  label: 'User',
  // The ADR-0092 guard keys off this; the ban guard deliberately does not.
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

async function bannedFlag(engine: ObjectQL, id: string): Promise<unknown> {
  const row = await engine.findOne('sys_user', { where: { id }, fields: ['id', 'banned'] }, SYSTEM);
  return row?.banned;
}

interface BootOptions {
  /** Overrides the engine the GUARD reads through (hook stays on the real one). */
  readThrough?: (engine: ObjectQL) => LastAdminBanGuardEngine;
  maxScan?: number;
  /** Register the ADR-0092 identity write guard alongside, at its own priority. */
  withIdentityWriteGuard?: boolean;
  /** Skip registration entirely — the pre-#5892 engine, for reverse verification. */
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
  for (const o of [sysUser, sysMember, sysPermissionSet, sysUserPermissionSet]) {
    engine.registry.registerObject(o as never);
  }
  await engine.syncSchemas();

  if (opts.withIdentityWriteGuard) {
    registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
    registerIdentityWriteGuard(engine, { packageId: 'test.identity-write-guard' });
  }
  if (!opts.unguarded) {
    registerLastAdminBanGuard(opts.readThrough?.(engine) ?? (engine as unknown as LastAdminBanGuardEngine), {
      packageId: 'test.last-admin-ban-guard',
      ...(opts.maxScan !== undefined ? { maxScan: opts.maxScan } : {}),
    });
  }
  return engine;
}

/** A user row, plus whatever standing the case needs. */
async function seedUser(
  engine: ObjectQL,
  id: string,
  extra: { role?: string; platformAdmin?: boolean; banned?: boolean; grant?: Record<string, unknown> } = {},
): Promise<void> {
  await engine.insert(
    'sys_user',
    { id, name: id, email: `${id}@example.com`, banned: extra.banned ?? false },
    SYSTEM,
  );
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
// Reverse verification — the same fixtures with the guard NOT registered
// ---------------------------------------------------------------------------

describe('[#5892] reverse verification: without the guard, the lockout goes through', () => {
  it('the pre-#5892 engine bans the last administrator and reports success', async () => {
    const engine = await boot({ unguarded: true });
    await seedAdminPermissionSet(engine);
    await seedUser(engine, 'usr_owner', { role: 'owner' });

    await expect(ban(engine, 'usr_owner')).resolves.toBeTruthy();
    expect(await bannedFlag(engine, 'usr_owner')).toBeTruthy();
  });
});
