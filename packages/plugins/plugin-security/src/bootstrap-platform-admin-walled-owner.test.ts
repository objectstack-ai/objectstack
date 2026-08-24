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
 * [#11343] The walled match must additionally be VERIFIED: an email string is
 * not identity, so an account holding the owner's address with
 * `email_verified` unset/false is refused (`walled_owner_not_verified`).
 * BOTH directions of that invariant are pinned below — the unverified holder
 * is refused AND the verified owner is elevated (including across the
 * refuse-then-verify-then-re-run sequence the bootstrap-replay middleware
 * drives; its trigger set, `shouldReplayBootstrapFor`, is pinned here
 * beside it). A suite pinning only the refusal would score green on a
 * platform nobody can administer.
 *
 * The refusals here are bootstrap outcomes, not HTTP answers, so there is no
 * ADR-0112 envelope to assert; the machine-checkable surface is the exact
 * `reason` value plus the absence of any `sys_user_permission_set` write (the
 * "service was never called" half).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { bootstrapPlatformAdmin, shouldReplayBootstrapFor } from './bootstrap-platform-admin.js';

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
    // Opens with the PRODUCER's own dispatch predicate, never a hand-mirrored
    // guard (check:engine-double-contract) — a fixture drifting to a call
    // shape ObjectQL.update would refuse fails loudly here.
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = rowsOf(object);
      const targets =
        dispatch.kind === 'by-id' ? rows.filter((r) => r.id === dispatch.id) : [];
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    grants(): any[] {
      return rowsOf('sys_user_permission_set');
    },
  };
}

const adminFullAccess = () =>
  ({ name: 'admin_full_access', label: 'Admin', objects: {}, systemPermissions: ['setup.access'] }) as any;

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/**
 * [#11343] Rows carry `email_verified` explicitly where the case under test
 * depends on it. A row WITHOUT the field models an imported/legacy account —
 * which the elevation predicate deliberately reads as UNVERIFIED.
 */
const user = (id: string, email: string, createdAt: string, extra: Record<string, any> = {}) => ({
  id,
  email,
  created_at: createdAt,
  ...extra,
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
        // [#11343] The owner fixture is VERIFIED — this pin is about arrival
        // order, and it must keep holding under the verified-email invariant.
        user('u_owner', 'operator@corp.example', '2026-08-23T02:00:00Z', { email_verified: true }),
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
      // [#11343] Verified — this pin is about case-insensitive matching, and
      // it must keep holding under the verified-email invariant.
      users: [user('u_owner', 'operator@corp.example', '2026-08-23T02:00:00Z', { email_verified: true })],
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

  it('an UNVERIFIED first user is still promoted under `single` — the verified invariant is walled-only', async () => {
    // [#11343] Over-denial guard: the ruling restored the invariant on the
    // WALLED owner match. `single` posture (the dev/seed-admin flow, where
    // verification is typically not wired at all) keeps first-user promotion
    // exactly as ruled reasonable in #11184.
    const ql = makeQl({
      users: [user('u_first', 'first@corp.example', '2026-08-23T01:00:00Z', { email_verified: false })],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(true);
    expect(ql.grants()[0]?.user_id).toBe('u_first');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#11343] Walled elevation requires the owner-email match to be VERIFIED.
// Both directions on purpose: refusal alone would score green on a platform
// nobody can administer.
// ───────────────────────────────────────────────────────────────────────────
describe('walled posture — the owner-email match must be VERIFIED (#11343)', () => {
  beforeEach(() => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
  });

  it('refuses an account holding the owner email with email_verified:false — the exact sign-up shape — and writes NO grant', async () => {
    // The path this card closes: someone registers with the declared owner's
    // address before the owner does. better-auth stores `email_verified:false`
    // at email/password sign-up, so this row is exactly what that registration
    // produces.
    const log = logger();
    const ql = makeQl({
      users: [user('u_squatter', 'operator@corp.example', '2026-08-23T01:00:00Z', { email_verified: false })],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_owner_not_verified');
    expect(ql.grants()).toHaveLength(0);
    // Loud, at warn, and the message names the variable and the unblock (verify).
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0][0])).toContain('OS_PLATFORM_OWNER_EMAIL');
    expect(String(log.warn.mock.calls[0][0])).toContain('NOT VERIFIED');
  });

  it('a row WITHOUT the email_verified field (imported/legacy) reads as unverified — absent is never verified', async () => {
    const ql = makeQl({
      users: [user('u_legacy', 'operator@corp.example', '2026-08-23T01:00:00Z')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_owner_not_verified');
    expect(ql.grants()).toHaveLength(0);
  });

  it('elevates the verified owner — including on the re-run AFTER the verifying update (the exact sequence the replay middleware drives)', async () => {
    // First boot: the owner registered but has not clicked the link yet —
    // refused, no grant. Then the verification UPDATE lands on the row and the
    // bootstrap re-runs (in production: the replay middleware fires on that
    // update). Second run: elevated. Pinning the sequence, not just the end
    // state, proves the refusal is transient for the genuine owner.
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-08-23T02:00:00Z', { email_verified: false })],
    });
    const first = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(first.adminPromoted).toBe(false);
    expect(first.reason).toBe('walled_owner_not_verified');
    expect(ql.grants()).toHaveLength(0);

    // The verifying write better-auth issues when the link is clicked.
    await ql.update('sys_user', { id: 'u_owner', email_verified: true });

    const second = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(second.adminPromoted).toBe(true);
    const grants = ql.grants();
    expect(grants).toHaveLength(1);
    expect(grants[0].user_id).toBe('u_owner');
    expect(grants[0].organization_id).toBeNull();
  });

  it("accepts a driver's 1 as verified and 0 as unverified (SQLite boolean representation)", async () => {
    const refused = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-08-23T02:00:00Z', { email_verified: 0 })],
    });
    expect((await bootstrapPlatformAdmin(refused as any, [adminFullAccess()], { logger: logger() })).reason).toBe(
      'walled_owner_not_verified',
    );
    expect(refused.grants()).toHaveLength(0);

    const elevated = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-08-23T02:00:00Z', { email_verified: 1 })],
    });
    expect((await bootstrapPlatformAdmin(elevated as any, [adminFullAccess()], { logger: logger() })).adminPromoted).toBe(
      true,
    );
    expect(elevated.grants()[0]?.user_id).toBe('u_owner');
  });

  it('two rows hold the owner email: the VERIFIED one is elevated even when the unverified one is older', async () => {
    // Arrival order decided ties before #11343; verification outranks it now.
    // (Two rows with one email is an imported/legacy shape — sign-up enforces
    // uniqueness — but the elevation must still never land on the unverified
    // row.)
    const ql = makeQl({
      users: [
        user('u_unverified_older', 'operator@corp.example', '2026-08-23T01:00:00Z', { email_verified: false }),
        user('u_verified_newer', 'operator@corp.example', '2026-08-23T02:00:00Z', { email_verified: true }),
      ],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(true);
    const grants = ql.grants();
    expect(grants).toHaveLength(1);
    expect(grants[0].user_id).toBe('u_verified_newer');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#11343] The bootstrap-replay trigger set. Email verification is an UPDATE,
// so an insert-only replay would refuse the unverified owner at sign-up and
// never look again — these pins are the "verified owner IS elevated" half at
// the middleware seam. security-plugin.ts consumes this same predicate.
// ───────────────────────────────────────────────────────────────────────────
describe('shouldReplayBootstrapFor — bootstrap-replay trigger set (#11343)', () => {
  it('fires on sys_user insert/create (the original trigger, unchanged)', () => {
    expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'insert', data: { email: 'a@b.c' } })).toBe(true);
    expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'create', data: { email: 'a@b.c' } })).toBe(true);
  });

  it('fires on a sys_user update touching email_verified — the verifying write', () => {
    expect(
      shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update', data: { id: 'u1', email_verified: true } }),
    ).toBe(true);
  });

  it('fires on a sys_user update touching email — the change-email write can newly match the declared owner', () => {
    expect(
      shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update', data: { id: 'u1', email: 'x@y.z' } }),
    ).toBe(true);
  });

  it('does NOT fire on a sys_user update touching neither elevation column (profile edits must not re-run bootstrap)', () => {
    expect(
      shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update', data: { id: 'u1', name: 'New Name' } }),
    ).toBe(false);
  });

  it('does NOT fire for other objects, other operations, or a payload-less update', () => {
    expect(shouldReplayBootstrapFor({ object: 'task', operation: 'insert', data: {} })).toBe(false);
    expect(
      shouldReplayBootstrapFor({ object: 'task', operation: 'update', data: { email_verified: true } }),
    ).toBe(false);
    expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'delete', data: { id: 'u1' } })).toBe(false);
    expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'find' })).toBe(false);
    expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update' })).toBe(false);
  });
});
