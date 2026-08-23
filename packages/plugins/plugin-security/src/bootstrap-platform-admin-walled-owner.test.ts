// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapPlatformAdmin — posture-keyed elevation (#11184, the framework leg
 * of cloud#1509; maintainer ruling 2026-08-23, verbatim:
 * 「1509 选择 env 指定 owner 邮箱」).
 *
 * Measured defect: on a walled deployment (`OS_TENANCY_POSTURE=isolated` +
 * invite-only) the FIRST self-registrant received the cross-tenant
 * `admin_full_access` grant — and, because `ensureDefaultOrganization` binds
 * "the platform admin", the operator's Default Organization too.
 *
 * Both directions are pinned here:
 *  (a) walled: ONLY the account matching the env-declared owner email
 *      (`OS_PLATFORM_OWNER_EMAIL`) elevates — a self-registrant never does,
 *      whatever the arrival order; undeclared owner ⇒ the elevation REFUSES
 *      (it never falls back to first-registrant), loudly, naming the variable;
 *  (b) single: "first user is owner" is ruled reasonable and UNCHANGED — the
 *      owner-email variable is never consulted there.
 *
 * The refusals here are bootstrap outcomes, not HTTP answers, so there is no
 * ADR-0112 envelope to assert; the machine-checkable surface is the exact
 * `reason` value plus the absence of any `sys_user_permission_set` write (the
 * "service was never called" half).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';

/** In-memory ql over the three objects the promotion path touches. */
function makeQl(seed: { users?: any[]; grants?: any[] } = {}) {
  const tables = new Map<string, any[]>([
    ['sys_permission_set', []],
    ['sys_user', (seed.users ?? []).map((r) => ({ ...r }))],
    ['sys_user_permission_set', (seed.grants ?? []).map((r) => ({ ...r }))],
  ]);
  const rowsOf = (object: string) => tables.get(object) ?? [];
  return {
    tables,
    async find(object: string, q: any) {
      const where = q?.where ?? {};
      return rowsOf(object).filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          return r[k] === v;
        }),
      );
    },
    async insert(object: string, data: any) {
      if (!tables.has(object)) tables.set(object, []);
      tables.get(object)!.push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any) {
      const r = rowsOf(object).find((x) => x.id === data.id);
      if (r) Object.assign(r, data);
    },
    grants(): any[] {
      return rowsOf('sys_user_permission_set');
    },
  };
}

const adminFullAccess = () =>
  ({ name: 'admin_full_access', label: 'Admin', objects: {}, systemPermissions: ['setup.access'] }) as any;

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const user = (id: string, email: string, createdAt: string) => ({
  id,
  email,
  created_at: createdAt,
});

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;
const OLD_OWNER = process.env.OS_PLATFORM_OWNER_EMAIL;

beforeEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
  delete process.env.OS_MULTI_ORG_ENABLED;
  delete process.env.OS_PLATFORM_OWNER_EMAIL;
});
afterEach(() => {
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  if (OLD_LEGACY === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = OLD_LEGACY;
  if (OLD_OWNER === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
  else process.env.OS_PLATFORM_OWNER_EMAIL = OLD_OWNER;
});

// ───────────────────────────────────────────────────────────────────────────
describe('walled posture + declared owner — only the owner elevates', () => {
  it('promotes the declared owner even when a self-registrant arrived FIRST', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const ql = makeQl({
      users: [
        user('u_stranger', 'stranger@evil.example', '2026-08-23T01:00:00Z'),
        user('u_owner', 'operator@corp.example', '2026-08-23T02:00:00Z'),
      ],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(true);
    const grants = ql.grants();
    expect(grants).toHaveLength(1);
    // The cross-tenant grant lands on the OWNER — never the first registrant.
    expect(grants[0].user_id).toBe('u_owner');
    expect(grants[0].organization_id).toBeNull();
  });

  it('matches the owner email case-insensitively (declared spelling ≠ stored spelling)', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'Operator@Corp.EXAMPLE';
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-08-23T02:00:00Z')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(true);
    expect(ql.grants()[0]?.user_id).toBe('u_owner');
  });

  it('owner not registered yet: refuses with the exact reason and writes NO grant', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const log = logger();
    const ql = makeQl({
      users: [user('u_stranger', 'stranger@evil.example', '2026-08-23T01:00:00Z')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_owner_not_registered');
    // The preservation half of the pin: the grant write never happened.
    expect(ql.grants()).toHaveLength(0);
  });

  it("the `group` posture is walled too — a first registrant that isn't the owner never elevates", async () => {
    process.env.OS_TENANCY_POSTURE = 'group';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const ql = makeQl({
      users: [user('u_stranger', 'stranger@evil.example', '2026-08-23T01:00:00Z')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_owner_not_registered');
    expect(ql.grants()).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('walled posture + UNDECLARED owner — fail-closed, never first-registrant', () => {
  it('refuses the elevation with the exact reason, logs at error naming the variable, writes NO grant', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const log = logger();
    const ql = makeQl({
      users: [user('u_stranger', 'stranger@evil.example', '2026-08-23T01:00:00Z')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_owner_email_undeclared');
    expect(ql.grants()).toHaveLength(0);
    // Loud, at error, and the message NAMES the variable so the operator's
    // remedy is in the line itself (the boot-refusal half lives in
    // plugin-auth init and is pinned in that package).
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(String(log.error.mock.calls[0][0])).toContain('OS_PLATFORM_OWNER_EMAIL');
  });

  it('a blank OS_PLATFORM_OWNER_EMAIL is undeclared, not a declared empty owner', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = '   ';
    const ql = makeQl({
      users: [user('u_stranger', 'stranger@evil.example', '2026-08-23T01:00:00Z')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.reason).toBe('walled_owner_email_undeclared');
    expect(ql.grants()).toHaveLength(0);
  });

  it('degrades to warn when the caller handed a logger without error (narrower legacy shape)', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const warn = vi.fn();
    const ql = makeQl({
      users: [user('u_stranger', 'stranger@evil.example', '2026-08-23T01:00:00Z')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], {
      logger: { info: vi.fn(), warn } as any,
    });
    expect(r.reason).toBe('walled_owner_email_undeclared');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('OS_PLATFORM_OWNER_EMAIL');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('single posture — "first user is owner" is ruled reasonable and UNCHANGED', () => {
  it('promotes the first human user with no owner email declared (the pre-#11184 shape)', async () => {
    // Posture unset ⇒ `single`.
    const ql = makeQl({
      users: [
        user('u_first', 'first@corp.example', '2026-08-23T01:00:00Z'),
        user('u_second', 'second@corp.example', '2026-08-23T02:00:00Z'),
      ],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(true);
    expect(ql.grants()[0]?.user_id).toBe('u_first');
  });

  it('never consults the owner-email variable: a declared owner does NOT redirect the single-org promotion', async () => {
    // Over-denial guard for direction (b): setting the variable under `single`
    // must not change who is promoted — the ruling scoped the owner-email
    // bootstrap to walled postures only.
    process.env.OS_TENANCY_POSTURE = 'single';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'second@corp.example';
    const ql = makeQl({
      users: [
        user('u_first', 'first@corp.example', '2026-08-23T01:00:00Z'),
        user('u_second', 'second@corp.example', '2026-08-23T02:00:00Z'),
      ],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(true);
    expect(ql.grants()[0]?.user_id).toBe('u_first');
  });
});
