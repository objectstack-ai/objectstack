// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapPlatformAdmin — posture-keyed platform-admin answer.
 *
 * History of this surface, because the pins below flip an older family:
 *  - #11184 (framework leg of cloud#1509): walled postures stopped promoting
 *    the first registrant; only the env-declared owner elevated.
 *  - #11343: the walled match additionally required a VERIFIED email.
 *  - #13147: `OS_PLATFORM_OWNER_EMAIL` became a comma-separated list through
 *    the ONE parser in `@objectstack/core`.
 *  - **#11974 (#11663 L4, maintainer acceptance 2026-08-25, Choice 4A/5A):
 *    the walled ELEVATION is retired.** Under walled postures the bootstrap
 *    writes NO `sys_user_permission_set` row at all — standing is
 *    config-derived at the one derivation site (`resolve-authz-context.ts`
 *    §6b-config, pinned in core's
 *    `resolve-authz-context.platform-admin-config.test.ts`). What this
 *    function still owns under walled postures is REPORTING: the per-entry
 *    standing log (same implementation as the read-only `platformAdmin`
 *    service) and the once-per-process legacy-grant deprecation pointer
 *    (pin #5 — loud migration, never a silent dual-track).
 *
 * Both directions stay pinned: walled writes NOTHING whatever the account
 * state, and `single` still PROMOTES (Choice 4A — the over-denial guard:
 * retiring the walled write must not retire the `single` one).
 *
 *  - **#16682: the `single` SELECTION is repaired.** That guard used to be
 *    written as "byte-for-byte", and one case snapshotted the incumbent's
 *    refusal to read `OS_PLATFORM_OWNER_EMAIL` on this branch. The incumbent
 *    was the defect: an unordered, cap-50 `sys_user` read sorted client-side,
 *    so who got the unscoped `admin_full_access` grant changed with the
 *    storage driver, and a deployment that had DECLARED its owner could still
 *    have somebody else promoted. The guard's subject survives — `single`
 *    still writes a grant — but "byte-for-byte" does not, and the case that
 *    claimed it is re-authored below with the ruling that replaced it —
 *    a MAINTAINER ruling of 2026-09-08 (decision batch #100), not a triage
 *    seat's, which also makes verification a REQUIREMENT of the declared-owner
 *    leg and retires the trigger-set narrowing for the one write that can now
 *    change the answer.
 *
 * The outcomes here are bootstrap returns, not HTTP answers, so there is no
 * ADR-0112 envelope to assert; the machine-checkable surface is the exact
 * `reason` value plus the absence of any `sys_user_permission_set` write.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  resetLegacyPlatformAdminGrantReport,
  setPlatformAdminConfigSink,
  type PlatformAdminConfigSink,
} from '@objectstack/core';
import { SystemUserId } from '@objectstack/spec/system';
import { bootstrapPlatformAdmin, shouldReplayBootstrapFor } from './bootstrap-platform-admin.js';

/**
 * In-memory ql over the objects the bootstrap touches.
 *
 * [#14348] `sys_account` is one of them now: under `single` the promotion
 * target is the oldest human that CAN AUTHENTICATE, so the selector reads this
 * table. Modelling it explicitly (rather than letting an unknown table answer
 * `[]`) is what keeps "this user is registered" and "this user is a
 * credential-less directory row" two different fixture states here — the very
 * distinction the card turned on.
 */
function makeQl(seed: { users?: any[]; grants?: any[]; sets?: any[]; accounts?: any[] } = {}) {
  const tables = new Map<string, any[]>([
    ['sys_permission_set', (seed.sets ?? []).map((r) => ({ ...r }))],
    ['sys_user', (seed.users ?? []).map((r) => ({ ...r }))],
    ['sys_user_permission_set', (seed.grants ?? []).map((r) => ({ ...r }))],
    ['sys_account', (seed.accounts ?? []).map((r) => ({ ...r }))],
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

/** Rows carry `email_verified` explicitly where the case under test depends on
 *  it. A row WITHOUT the field models an imported/legacy account — which the
 *  shared predicate deliberately reads as UNVERIFIED. */
const user = (id: string, email: string, createdAt: string, extra: Record<string, any> = {}) => ({
  id,
  email,
  created_at: createdAt,
  ...extra,
});

/**
 * [#14348] The login half of a REGISTERED user. Every `single`-posture case
 * below is about a user who signed up, and a user who signed up holds a
 * `sys_account` — the field was simply never modelled while the promotion
 * ranked rows by age alone. Declaring it keeps those cases testing what their
 * names say (owner-email is not consulted; an unverified address still gets
 * promoted) instead of accidentally testing the new authenticable filter.
 */
const account = (userId: string, providerId = 'credential') => ({
  id: `acc_${userId}`,
  user_id: userId,
  account_id: `${userId}@accounts.test`,
  provider_id: providerId,
});

const infoText = (log: ReturnType<typeof logger>) =>
  log.info.mock.calls.map((c) => String(c[0])).join('\n');

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
// [#11974] The walled grant write is RETIRED — no account state mints a row.
// ───────────────────────────────────────────────────────────────────────────
describe('walled posture — no grant row is EVER written (#11974 / #11663 L4)', () => {
  it('a declared, registered, VERIFIED owner gets NO row — standing is config-derived, and the log says so', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const log = logger();
    const ql = makeQl({
      users: [
        user('u_stranger', 'stranger@evil.example', '2026-08-23T01:00:00Z'),
        user('u_owner', 'operator@corp.example', '2026-08-23T02:00:00Z', { email_verified: true }),
      ],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_config_derived');
    // The acceptance pin: the walled bootstrap mints NO org-less grant.
    expect(ql.grants()).toHaveLength(0);
    // The operator's first sight of the answer — per-entry standing.
    const info = infoText(log);
    expect(info).toContain('CONFIG-DERIVED');
    expect(info).toContain('operator@corp.example: registered + verified (u_owner)');
  });

  it('[#13147] a comma-separated list mints no row for ANY declared member; standing reports each entry', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'first@corp.example, second@corp.example';
    const log = logger();
    const ql = makeQl({
      users: [user('u_two', 'second@corp.example', '2026-08-29T02:00:00Z', { email_verified: true })],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_config_derived');
    expect(ql.grants()).toHaveLength(0);
    const info = infoText(log);
    expect(info).toContain('first@corp.example: not registered yet');
    expect(info).toContain('second@corp.example: registered + verified (u_two)');
  });

  it('owner not registered: no row, and the standing log reports it (formerly walled_owner_not_registered)', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const log = logger();
    const ql = makeQl({
      users: [user('u_stranger', 'stranger@evil.example', '2026-08-23T01:00:00Z')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_config_derived');
    expect(ql.grants()).toHaveLength(0);
    expect(infoText(log)).toContain('operator@corp.example: not registered yet');
  });

  it('owner registered but NOT verified: no row, and the standing log names the missing verification', async () => {
    // The unverified holder confers nothing at the derivation site either —
    // that half is pinned in core. Here: the bootstrap neither writes a row
    // for it (old bug direction) nor claims it holds standing (new surface).
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const log = logger();
    const ql = makeQl({
      users: [user('u_squatter', 'operator@corp.example', '2026-08-23T01:00:00Z', { email_verified: false })],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_config_derived');
    expect(ql.grants()).toHaveLength(0);
    expect(infoText(log)).toContain('operator@corp.example: registered, NOT verified');
  });

  it('a row WITHOUT the email_verified field (imported/legacy) still reads unverified — absent is never verified', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const log = logger();
    const ql = makeQl({
      users: [user('u_legacy', 'operator@corp.example', '2026-08-23T01:00:00Z')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.reason).toBe('walled_config_derived');
    expect(ql.grants()).toHaveLength(0);
    expect(infoText(log)).toContain('NOT verified');
  });

  it('the verifying update changes NOTHING here any more: re-running bootstrap after it still writes no row', async () => {
    // Pre-#11974 this exact sequence (refuse → verify → re-run) was how the
    // owner got elevated, driven by the replay middleware's update arm. The
    // sequence is pinned in its NEW meaning: the re-run is a no-write both
    // times — the verification's effect happens at request time, in the
    // derivation, not here.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-08-23T02:00:00Z', { email_verified: false })],
    });
    const first = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(first.reason).toBe('walled_config_derived');
    expect(ql.grants()).toHaveLength(0);

    await ql.update('sys_user', { id: 'u_owner', email_verified: true });

    const second = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(second.adminPromoted).toBe(false);
    expect(second.reason).toBe('walled_config_derived');
    expect(ql.grants()).toHaveLength(0);
  });

  it("the `group` posture is walled too — same no-write answer", async () => {
    process.env.OS_TENANCY_POSTURE = 'group';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-08-23T02:00:00Z', { email_verified: true })],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_config_derived');
    expect(ql.grants()).toHaveLength(0);
  });

  it('[#13147] ⛔ a REFUSED list declares nobody — walled_owner_email_undeclared, no row, loud', async () => {
    // Choice 2B: one unparseable entry fails the WHOLE variable closed. The
    // valid entry must confer nothing — a silently narrower administrator set
    // is the outcome the refusal exists to prevent.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'first@corp.example,not-an-email';
    const ql = makeQl({
      users: [user('u_one', 'first@corp.example', '2026-08-29T01:00:00Z', { email_verified: true })],
    });
    const log = logger();
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('walled_owner_email_undeclared');
    expect(ql.grants()).toHaveLength(0);
    expect(String(log.error.mock.calls[0]?.[0] ?? '')).toContain('OS_PLATFORM_OWNER_EMAIL');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('walled posture + UNDECLARED owner — fail-closed backstop (unchanged reason)', () => {
  it('answers walled_owner_email_undeclared, logs at error naming the variable, writes NO grant', async () => {
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
// [#11663 P5] The deprecation pointer for a LEGACY grant — loud migration,
// exactly ONCE per process, through the SAME latch the derivation-site
// reporter uses (boot-time + request-time detection can never total two).
// ───────────────────────────────────────────────────────────────────────────
describe('walled posture — legacy grant deprecation pointer (#11663 P5)', () => {
  let sinkWarns: string[];
  let prevSink: PlatformAdminConfigSink;

  beforeEach(() => {
    sinkWarns = [];
    resetLegacyPlatformAdminGrantReport();
    prevSink = setPlatformAdminConfigSink({
      error: () => {},
      warn: (m) => sinkWarns.push(m),
    });
  });
  afterEach(() => {
    setPlatformAdminConfigSink(prevSink);
    resetLegacyPlatformAdminGrantReport();
  });

  /** A legacy DB: the admin set row already exists, and a human holds the
   *  unscoped grant pointing at it. */
  const legacyDb = () =>
    makeQl({
      sets: [{ id: 'ps_admin', name: 'admin_full_access', active: true }],
      users: [user('u_legacy', 'legacy-admin@corp.example', '2026-01-01T00:00:00Z', { email_verified: true })],
      grants: [{ id: 'ups_1', user_id: 'u_legacy', permission_set_id: 'ps_admin', organization_id: null }],
    });

  it('a seeded legacy grant produces EXACTLY ONE line naming OS_PLATFORM_OWNER_EMAIL — even across repeated bootstraps', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const ql = legacyDb();
    const r1 = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    const r2 = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    // The acceptance pin: exactly one deprecation line, naming the variable,
    // the holder and their address (the exact config line to add).
    expect(sinkWarns).toHaveLength(1);
    expect(sinkWarns[0]).toContain('OS_PLATFORM_OWNER_EMAIL');
    expect(sinkWarns[0]).toContain('u_legacy');
    expect(sinkWarns[0]).toContain('legacy-admin@corp.example');
    // Nothing is revoked and nothing new is minted: the one legacy row stays.
    expect(ql.grants()).toHaveLength(1);
    expect(r1.reason).toBe('walled_config_derived');
    expect(r2.reason).toBe('walled_config_derived');
  });

  it('legacy grant + UNDECLARED config: the pointer is the remedy — the undeclared error line is skipped', async () => {
    // The deployment HAS an administrator (on the old anchor); yelling "no
    // usable administrator" beside the pointer would be false. The reason
    // still answers undeclared, truthfully.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const log = logger();
    const ql = legacyDb();
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.reason).toBe('walled_owner_email_undeclared');
    expect(sinkWarns).toHaveLength(1);
    expect(sinkWarns[0]).toContain('OS_PLATFORM_OWNER_EMAIL');
    expect(log.error).not.toHaveBeenCalled();
    expect(ql.grants()).toHaveLength(1);
  });

  it('a usr_system-held grant is NOT a legacy holder — no pointer', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    const ql = makeQl({
      sets: [{ id: 'ps_admin', name: 'admin_full_access', active: true }],
      grants: [{ id: 'ups_1', user_id: SystemUserId.SYSTEM, permission_set_id: 'ps_admin', organization_id: null }],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(sinkWarns).toHaveLength(0);
    expect(r.reason).toBe('walled_config_derived');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('single posture — "first user is owner" is ruled reasonable and UNCHANGED (Choice 4A)', () => {
  it('promotes the first human user with no owner email declared (the pre-#11184 shape)', async () => {
    // Posture unset ⇒ `single`.
    const ql = makeQl({
      users: [
        user('u_first', 'first@corp.example', '2026-08-23T01:00:00Z'),
        user('u_second', 'second@corp.example', '2026-08-23T02:00:00Z'),
      ],
      accounts: [account('u_first'), account('u_second')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(true);
    expect(ql.grants()[0]?.user_id).toBe('u_first');
  });

  /**
   * ⚠️ RE-AUTHORED by #16682. This case used to assert the opposite —
   * "never consults the owner-email variable: a declared owner does NOT
   * redirect the single-org promotion" — and it is worth being explicit about
   * what changed and what did NOT, because the two are easy to confuse.
   *
   * What this case is FOR is unchanged: it is #11974's over-denial guard, and
   * the invariant it guards is that retiring the WALLED write did not retire
   * the `single` one. That invariant is `adminPromoted === true` with a grant
   * row actually minted, and it is asserted below exactly as before.
   *
   * What changed is the incumbent it happened to snapshot alongside that
   * invariant. `single` read `sys_user` with no `orderBy` and a cap of 50 and
   * then sorted the returned array, so the promotion was decided by whichever
   * rows the driver produced first — measured on 113 rows, memory promoted the
   * intended owner and sqlite promoted a job-seeker persona — while
   * `PLATFORM_OWNER_EMAIL_ENV`, imported into that same file, was consulted
   * only on the walled branch.
   *
   * The authority for the reversal is a MAINTAINER ruling — 2026-09-08,
   * decision batch #100, recorded on #16682 (comment 5587754690), which
   * supersedes the Choice 4A sentence for this one point and states what
   * survives it, verbatim:
   *
   *   > F3 — the Choice 4A sentence is superseded for this one point. Under
   *   > `single` posture the first-boot promotion consults
   *   > `OS_PLATFORM_OWNER_EMAIL` first. The rest of Choice 4A (#11974,
   *   > 2026-08-25) stands: retiring the walled write must not retire the
   *   > `single` one, and the over-denial invariant (`adminPromoted === true`
   *   > with a grant row minted) stays pinned.
   *
   * ⛔ An earlier revision of this comment quoted the #16682 TRIAGE seat's
   * ruling instead. That quotation was the reviewer's F3 finding: a pin
   * recorded under a maintainer ruling cannot be rewritten under a seat's.
   * The quotation above is the record that resolved it.
   *
   * So a declared owner now DOES decide this promotion. `single` keeping
   * first-user promotion (Choice 4A) is untouched: with no declaration, the
   * age rule still answers — the case above this one pins that, and
   * `bootstrap-platform-admin-promotion-selection.test.ts` pins the whole
   * selection including every negative control.
   */
  it('a declared owner DOES redirect the single-org promotion (#16682), and `single` still promotes', async () => {
    process.env.OS_TENANCY_POSTURE = 'single';
    process.env.OS_PLATFORM_OWNER_EMAIL = 'second@corp.example';
    const ql = makeQl({
      users: [
        user('u_first', 'first@corp.example', '2026-08-23T01:00:00Z'),
        // VERIFIED: the same ruling makes that a REQUIREMENT of this leg, not
        // a tie-break — an unverified holder is refused
        // (`declared_owner_not_verified`, pinned in the selection suite).
        user('u_second', 'second@corp.example', '2026-08-23T02:00:00Z', { email_verified: true }),
      ],
      accounts: [account('u_first'), account('u_second')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    // #11974's over-denial guard, unchanged: the `single` write still happens.
    expect(r.adminPromoted).toBe(true);
    expect(ql.grants()).toHaveLength(1);
    // #16682: and it goes to the address the operator declared, not to
    // whichever row the driver handed back first.
    expect(ql.grants()[0]?.user_id).toBe('u_second');
    expect(r.basis).toBe('declared-owner');
  });

  it('an UNVERIFIED first user is still promoted under `single` — the verified invariant was walled-only', async () => {
    const ql = makeQl({
      users: [user('u_first', 'first@corp.example', '2026-08-23T01:00:00Z', { email_verified: false })],
      // Unverified is about the ADDRESS, not about having a login: an
      // unverified registrant still holds an account (#14348).
      accounts: [account('u_first')],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(true);
    expect(ql.grants()[0]?.user_id).toBe('u_first');
  });

  it('an existing human admin short-circuits as already_have_admin — the single-posture no-op-forever shape', async () => {
    const ql = makeQl({
      sets: [{ id: 'ps_admin', name: 'admin_full_access', active: true }],
      users: [user('u_admin', 'admin@corp.example', '2026-08-23T01:00:00Z')],
      grants: [{ id: 'ups_1', user_id: 'u_admin', permission_set_id: 'ps_admin', organization_id: null }],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: logger() });
    expect(r.adminPromoted).toBe(false);
    expect(r.reason).toBe('already_have_admin');
    expect(ql.grants()).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#11974, amended by #16682] The bootstrap-replay trigger set. #11974
// narrowed it to `single` + create/insert: the #11343 update arm (email /
// email_verified) fired for the walled verify-then-elevate sequence, which no
// longer exists, and its own rationale was that "`single` promotes the oldest
// authenticable human and never reads `email`/`email_verified`".
//
// The maintainer ruling of 2026-09-08 (batch #100) made that last clause
// false FOR ONE CONFIGURATION: with an owner declared, `single` promotes only
// a VERIFIED holder of the declared address, and the ruling says the
// consequence out loud — "the replay predicate promotes as soon as
// verification lands". So the update arm returns exactly there and nowhere
// else: `single`, `sys_user`, a payload touching `email`/`email_verified`,
// and an owner actually declared. With none declared the narrowing is intact,
// which is every deployment #11974 measured.
// security-plugin.ts consumes this same predicate.
// ───────────────────────────────────────────────────────────────────────────
describe('shouldReplayBootstrapFor — the trigger set equals the selection inputs (#11974, #16682)', () => {
  it('fires on sys_user insert/create under `single` (first-user promotion, unchanged)', () => {
    expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'insert', data: { email: 'a@b.c' } })).toBe(true);
    expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'create', data: { email: 'a@b.c' } })).toBe(true);
  });

  it('⛔ with NO owner declared, an update touching email_verified / email still does not fire (#11974 narrowing intact)', () => {
    // `single`'s no-declaration leg ranks by age over authenticable humans and
    // reads neither column, so replaying here would be the pure re-run tax
    // #11974 removed.
    expect(
      shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update', data: { id: 'u1', email_verified: true } }),
    ).toBe(false);
    expect(
      shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update', data: { id: 'u1', email: 'x@y.z' } }),
    ).toBe(false);
  });

  it('fires on the VERIFYING update once an owner IS declared (#16682 — "promotes as soon as verification lands")', () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    expect(
      shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update', data: { id: 'u1', email_verified: true } }),
    ).toBe(true);
    // The address itself is an input too: a row moving ONTO the declared
    // address is the other write that can change leg 1's answer.
    expect(
      shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update', data: { id: 'u1', email: 'x@y.z' } }),
    ).toBe(true);
    // ⛔ Still narrow: an update that touches neither column, and any
    // `sys_account` update, decide nothing.
    expect(
      shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update', data: { id: 'u1', name: 'New Name' } }),
    ).toBe(false);
    expect(
      shouldReplayBootstrapFor({ object: 'sys_account', operation: 'update', data: { id: 'a1', email_verified: true } }),
    ).toBe(false);
  });

  it('⛔ NEVER fires under a walled posture — no write can change a config-derived answer', () => {
    for (const posture of ['isolated', 'group']) {
      process.env.OS_TENANCY_POSTURE = posture;
      expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'insert', data: { email: 'a@b.c' } })).toBe(false);
      expect(shouldReplayBootstrapFor({ object: 'sys_user', operation: 'create', data: { email: 'a@b.c' } })).toBe(false);
      expect(
        shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update', data: { id: 'u1', email_verified: true } }),
      ).toBe(false);
      // ...including with an owner declared: a walled posture derives standing
      // from config at request time and writes nothing to re-attempt.
      process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
      expect(
        shouldReplayBootstrapFor({ object: 'sys_user', operation: 'update', data: { id: 'u1', email_verified: true } }),
      ).toBe(false);
      delete process.env.OS_PLATFORM_OWNER_EMAIL;
    }
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
