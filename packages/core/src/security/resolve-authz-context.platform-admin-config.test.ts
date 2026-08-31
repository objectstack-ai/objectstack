// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11663 L2] The DERIVATION half of the platform-admin re-anchor: does a
 * request actually resolve `PLATFORM_ADMIN` from the deployment's declared
 * administrator list, and — the arms that matter more — does it refuse to in
 * every case where it must?
 *
 * The card's acceptance criterion, verbatim, is the first `describe` below:
 * "with `OS_PLATFORM_OWNER_EMAIL=a@b.c` and a VERIFIED account `a@b.c`,
 * derivation yields `PLATFORM_ADMIN` with the declared capability set;
 * unset/empty/malformed variable yields zero config-derived admins (loudly);
 * legacy grant path still honoured and logging its deprecation pointer."
 *
 * ⭐ The single most important test in this file is
 * "a session payload carrying a configured address over a sys_user row that
 * does not resolves NON-admin". `resolveUserAuthzGrants` seeds `grants.email`
 * from `opts.seedEmail` — a caller/session-supplied string that deliberately
 * WINS over the stored read for RLS purposes — so a derivation that reached for
 * `grants.email` would turn the change meant to CLOSE an escalation channel
 * into one that opens a new one. That test fails if anyone ever makes that
 * substitution, and it is the reason `matchesConfiguredPlatformAdmin` takes a
 * row rather than an address.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ADMIN_FULL_ACCESS, ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';

import {
  resetLegacyPlatformAdminGrantReport,
  resetPlatformAdminEmailMemo,
  setPlatformAdminConfigSink,
  type PlatformAdminConfigSink,
} from './platform-admin.js';
import {
  hasPlatformAdminStanding,
  resolveAuthzContext,
  resolveUserAuthzGrants,
} from './resolve-authz-context.js';

const ENV = 'OS_PLATFORM_OWNER_EMAIL';
/**
 * [#13667] The two variables `resolveTenancyPosture()` reads, in its order:
 * `OS_TENANCY_POSTURE` when set, else `OS_MULTI_ORG_ENABLED` (`true` ⇒
 * `isolated`), else `single`. BOTH are driven by this file's harness, never
 * just the canonical one — an arm that pinned only the first would inherit
 * whatever the ambient environment happened to carry for the second, and the
 * default-posture arm below exists precisely to assert what an environment
 * carrying NEITHER resolves to.
 */
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const MULTI_ORG_ENV = 'OS_MULTI_ORG_ENABLED';
const NOW = Date.parse('2026-08-29T00:00:00.000Z');

interface Recorded { object: string; where: unknown }

/**
 * A minimal ObjectQL double that records the reads it served.
 *
 * Its `matches` REFUSES every top-level `$` key rather than implementing one.
 * The resolver issues no combinator query on this path, so the alternative to
 * a throw is not a combinator implementation — it is a matcher that reads
 * `$or` as an ordinary FIELD NAME, compares `row.$or` (undefined) against the
 * array, matches nothing, and leaves the suite asserting on an empty result
 * with nothing erroring. `check:where-matcher` grades exactly that shape, and
 * refusing is what most of this repo's conforming doubles do — including the
 * sibling double in `resolve-authz-context.batch-equivalence.test.ts`, whose
 * spelling this copies verbatim.
 *
 * ⛔ Do not "fix" a future red here by teaching this double `$or`/`$and`: a
 * test fixture that grows query-engine semantics is a second, unreviewed
 * implementation of the driver's filter contract. If the resolver ever does
 * issue a combinator query on this path, that is a change worth seeing fail
 * loudly first.
 *
 * `$in` is untouched by the refusal and stays supported: it appears in VALUE
 * position (`{ email: { $in: [...] } }`), which is a per-field operator the
 * resolver really does issue, not a top-level combinator.
 */
function makeQl(tables: Record<string, Array<Record<string, unknown>>>) {
  const calls: Recorded[] = [];
  const matches = (row: Record<string, unknown>, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  return {
    calls,
    async find(object: string, opts: any) {
      calls.push({ object, where: opts?.where });
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  };
}

/** A `sys_user`-only fixture: no grant rows anywhere, so standing can only be config-derived. */
const configOnlyTables = (user: Record<string, unknown>) => ({
  sys_user: [user],
  sys_member: [],
  sys_user_position: [],
  sys_position: [],
  sys_position_permission_set: [],
  sys_user_permission_set: [],
  sys_permission_set: [],
});

function makeSink(): PlatformAdminConfigSink & { errors: string[]; warns: string[] } {
  const errors: string[] = [];
  const warns: string[] = [];
  return { errors, warns, error: (m) => errors.push(m), warn: (m) => warns.push(m) };
}

let ambient: string | undefined;
let ambientPosture: string | undefined;
let ambientMultiOrg: string | undefined;
let sink: ReturnType<typeof makeSink>;

beforeEach(() => {
  ambient = process.env[ENV];
  ambientPosture = process.env[POSTURE_ENV];
  ambientMultiOrg = process.env[MULTI_ORG_ENV];
  delete process.env[ENV];
  delete process.env[POSTURE_ENV];
  delete process.env[MULTI_ORG_ENV];
  resetPlatformAdminEmailMemo();
  resetLegacyPlatformAdminGrantReport();
  sink = makeSink();
  setPlatformAdminConfigSink(sink);
});

afterEach(() => {
  if (ambient === undefined) delete process.env[ENV];
  else process.env[ENV] = ambient;
  if (ambientPosture === undefined) delete process.env[POSTURE_ENV];
  else process.env[POSTURE_ENV] = ambientPosture;
  if (ambientMultiOrg === undefined) delete process.env[MULTI_ORG_ENV];
  else process.env[MULTI_ORG_ENV] = ambientMultiOrg;
  resetPlatformAdminEmailMemo();
  resetLegacyPlatformAdminGrantReport();
  setPlatformAdminConfigSink(undefined);
});

/** Set the variable and drop the memo, so each arm is read from its own value. */
function declare(value: string | undefined): void {
  if (value === undefined) delete process.env[ENV];
  else process.env[ENV] = value;
  resetPlatformAdminEmailMemo();
}

/**
 * [#13667] Declare the deployment's REQUESTED tenancy posture for one arm.
 * `undefined` clears BOTH inputs, which is how a rig that has configured no
 * tenancy at all is spelled — and that rig resolves `single`, the default.
 * There is no memo to drop: `resolveTenancyPosture()` re-reads the environment
 * on every call.
 */
function requestPosture(value: 'single' | 'group' | 'isolated' | undefined): void {
  delete process.env[MULTI_ORG_ENV];
  if (value === undefined) delete process.env[POSTURE_ENV];
  else process.env[POSTURE_ENV] = value;
}

describe('[#11663 L2] acceptance criterion — the configured, VERIFIED account', () => {
  it('yields PLATFORM_ADMIN with the DECLARED capability set', async () => {
    declare('a@b.c');
    const ql = makeQl(configOnlyTables({ id: 'usr_1', email: 'a@b.c', email_verified: true }));
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });

    expect(grants.posture).toBe('PLATFORM_ADMIN');
    // `platform_admin` LEADS the list — the ordering §6c establishes and that
    // downstream consumers read as "the strongest position first".
    expect(grants.positions[0]).toBe('platform_admin');
    expect(grants.permissions).toContain(ADMIN_FULL_ACCESS);
    // [Choice 6A] The capability CONTENT is the spec's one declaration, not a
    // second copy living in core. Equality both ways: a derived admin that
    // carried MORE than the declaration would be a silent privilege widening,
    // and one that carried less would be a silent narrowing.
    expect(grants.systemPermissions.sort()).toEqual(
      [...(ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions ?? [])].sort(),
    );
  });

  it('answers the id-shaped predicate too, with no grant row in sight', async () => {
    declare('a@b.c');
    const ql = makeQl(configOnlyTables({ id: 'usr_1', email: 'a@b.c', email_verified: true }));
    // `hasPlatformAdminStanding` is a PROJECTION of the same derivation, so the
    // second anchor reaches every id-shaped judge for free — that is the whole
    // reason #10348-C consolidated them onto it before this leg ran.
    await expect(hasPlatformAdminStanding(ql, 'usr_1')).resolves.toBe(true);
  });

  it('resolves the same standing through the full request path', async () => {
    declare('a@b.c');
    const ql = makeQl(configOnlyTables({ id: 'usr_1', email: 'a@b.c', email_verified: true }));
    const ctx = await resolveAuthzContext({
      ql,
      headers: new Headers(),
      getSession: async () => ({ user: { id: 'usr_1', email: 'a@b.c' }, session: {} }),
      nowMs: NOW,
    });
    expect(ctx.posture).toBe('PLATFORM_ADMIN');
    expect(ctx.positions).toContain('platform_admin');
  });

  it('matches case-insensitively, and honours every declared entry of a list', async () => {
    declare('First@Corp.Example, second@corp.example');
    for (const email of ['first@corp.example', 'SECOND@CORP.EXAMPLE']) {
      const ql = makeQl(configOnlyTables({ id: 'usr_1', email, email_verified: 1 }));
      const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
      expect(grants.posture, email).toBe('PLATFORM_ADMIN');
    }
  });
});

describe('[#11663 L2] the fail-closed arms — zero config-derived admins', () => {
  const verifiedOwner = { id: 'usr_1', email: 'a@b.c', email_verified: true };

  it('UNSET yields no config-derived standing, and says nothing about it', async () => {
    declare(undefined);
    const ql = makeQl(configOnlyTables(verifiedOwner));
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
    expect(grants.posture).toBe('MEMBER');
    expect(grants.positions).not.toContain('platform_admin');
    expect(grants.permissions).not.toContain(ADMIN_FULL_ACCESS);
    expect(sink.errors).toEqual([]);
  });

  it('EMPTY / whitespace-only yields no config-derived standing', async () => {
    for (const raw of ['', '   ', ',', ' , , ']) {
      declare(raw);
      const ql = makeQl(configOnlyTables(verifiedOwner));
      const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
      expect(grants.posture, JSON.stringify(raw)).toBe('MEMBER');
    }
  });

  it('MALFORMED yields no config-derived standing — for EVERY entry — and is LOUD', async () => {
    declare('a@b.c,nonsense');
    const ql = makeQl(configOnlyTables(verifiedOwner));
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
    // ⛔ The valid entry does not survive its neighbour. Skip-and-continue here
    // would hand this deployment a narrower administrator set than its operator
    // declared, silently — which is the failure Choice 2B rules out by name.
    expect(grants.posture).toBe('MEMBER');
    expect(sink.errors).toHaveLength(1);
    expect(sink.errors[0]).toContain('nonsense');
  });

  it('⛔ an UNVERIFIED account holding the configured address gets NOTHING', async () => {
    // The arm the whole leg exists for: an attacker who registers the
    // operator's address before the operator does must gain nothing by it.
    for (const email_verified of [false, 0, '0', undefined]) {
      declare('a@b.c');
      const ql = makeQl(configOnlyTables({ id: 'usr_1', email: 'a@b.c', email_verified }));
      const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
      expect(grants.posture, `email_verified=${JSON.stringify(email_verified)}`).toBe('MEMBER');
    }
  });

  it('an account whose address is not on the list gets nothing', async () => {
    declare('a@b.c');
    const ql = makeQl(configOnlyTables({ id: 'usr_1', email: 'other@corp.example', email_verified: true }));
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
    expect(grants.posture).toBe('MEMBER');
  });

  it('a principal with no sys_user row at all gets nothing', async () => {
    declare('a@b.c');
    const ql = makeQl({ ...configOnlyTables({ id: 'someone_else', email: 'a@b.c', email_verified: true }) });
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
    expect(grants.posture).toBe('MEMBER');
  });
});

describe('⭐ [#11663 L2 pin P1] the derivation reads the STORED row, never the seeded email', () => {
  it('a session payload carrying a configured address over a row that does NOT resolves non-admin', async () => {
    declare('a@b.c');
    // The stored row says `impostor@corp.example`; the caller/session says
    // `a@b.c` and wins for `grants.email` (RLS `current_user.email`), exactly as
    // it is supposed to. Superuser standing must NOT follow it.
    const ql = makeQl(configOnlyTables({ id: 'usr_1', email: 'impostor@corp.example', email_verified: true }));
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW, seedEmail: 'a@b.c' });

    expect(grants.email).toBe('a@b.c'); // the seed still wins where it should
    expect(grants.posture).toBe('MEMBER'); // …and nowhere else
    expect(grants.positions).not.toContain('platform_admin');
  });

  it('and the same through the request path, where the session supplies the seed', async () => {
    declare('a@b.c');
    const ql = makeQl(configOnlyTables({ id: 'usr_1', email: 'impostor@corp.example', email_verified: true }));
    const ctx = await resolveAuthzContext({
      ql,
      headers: new Headers(),
      getSession: async () => ({ user: { id: 'usr_1', email: 'a@b.c' }, session: {} }),
      nowMs: NOW,
    });
    expect(ctx.posture).toBe('MEMBER');
  });

  it('a VERIFIED stored match still resolves even when the seed disagrees', async () => {
    // The control for the test above: the refusal must come from reading the
    // stored row, not from the presence of a seed.
    declare('a@b.c');
    const ql = makeQl(configOnlyTables({ id: 'usr_1', email: 'a@b.c', email_verified: true }));
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', {
      nowMs: NOW,
      seedEmail: 'something.else@corp.example',
    });
    expect(grants.posture).toBe('PLATFORM_ADMIN');
  });
});

/**
 * A principal whose PLATFORM_ADMIN rests on the LEGACY unscoped
 * `admin_full_access` grant row and nothing else — the shape
 * `bootstrapPlatformAdmin` mints when it promotes the first human user.
 * Hoisted out of the `#11663 L2 / P5` suite so the `#13667` posture suite below
 * drives the identical fixture rather than a second copy of it.
 */
const legacyTables = () => ({
  sys_user: [{ id: 'usr_1', email: 'legacy@corp.example', email_verified: true }],
  sys_member: [],
  sys_user_position: [],
  sys_position: [],
  sys_position_permission_set: [],
  sys_user_permission_set: [
    { id: 'ups_1', user_id: 'usr_1', permission_set_id: 'pst_1', organization_id: null },
  ],
  sys_permission_set: [{ id: 'pst_1', name: ADMIN_FULL_ACCESS, active: true }],
});

describe('[#11663 L2 / P5] the legacy grant row is still honoured, loudly', () => {
  it('an unscoped admin_full_access grant still confers PLATFORM_ADMIN with no config at all', async () => {
    declare(undefined);
    const grants = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });
    // Nothing is revoked in this leg — that is what makes it safe to land ahead
    // of every deployment setting the variable.
    expect(grants.posture).toBe('PLATFORM_ADMIN');
  });

  it('logs the deprecation pointer once, naming the holder and the config line', async () => {
    declare(undefined);
    // [#13667] A WALLED posture — the rigs that really are inside the migration
    // window. On the default `single` posture the same fixture is silent; that
    // is the suite below.
    requestPosture('isolated');
    const ql = makeQl(legacyTables());
    await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
    await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
    expect(sink.warns).toHaveLength(1);
    expect(sink.warns[0]).toContain('usr_1');
    expect(sink.warns[0]).toContain(`${ENV}=legacy@corp.example`);
  });

  it('does NOT nag when the SAME user also resolves through the config anchor', async () => {
    // Their standing no longer rests on the row, so there is nothing to
    // re-anchor and nothing to say.
    declare('legacy@corp.example');
    await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });
    expect(sink.warns).toEqual([]);
  });
});

describe('[#11663 L2] the sys_user read stays CONDITIONAL on config', () => {
  const seeded = { nowMs: NOW, seedEmail: 'seeded@corp.example', seedPermissions: ['ai_seat'] };

  it('a fully-seeded principal reads NO sys_user row when nothing is declared', async () => {
    // This is the property that leaves the pinned batch-equivalence query
    // multiset untouched for every deployment that has not adopted the config
    // anchor: pin P2's short-circuit answers "not an admin" on an empty list
    // BEFORE any row is looked at.
    declare(undefined);
    const ql = makeQl(configOnlyTables({ id: 'usr_1', email: 'a@b.c', email_verified: true }));
    await resolveUserAuthzGrants(ql, 'usr_1', seeded);
    expect(ql.calls.filter((c) => c.object === 'sys_user')).toHaveLength(0);
  });

  it('…and reads it exactly ONCE when administrators ARE declared', async () => {
    declare('a@b.c');
    const ql = makeQl(configOnlyTables({ id: 'usr_1', email: 'a@b.c', email_verified: true }));
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', seeded);
    // Once, not twice: the config branch consumes the SAME memoized row the
    // email fallback and the ai_seat synthesis do.
    expect(ql.calls.filter((c) => c.object === 'sys_user')).toHaveLength(1);
    expect(grants.posture).toBe('PLATFORM_ADMIN');
  });
});

// ───────────────────────────────────────────────────────────────────────────
/**
 * [#13667] The deprecation pointer is POSTURE-KEYED — the request side matching
 * the boot side.
 *
 * `bootstrapPlatformAdmin` has always been posture-keyed: under `single` a
 * pre-existing unscoped `admin_full_access` holder is `already_have_admin` and
 * the boot exits silently, because under Choice 4A that row IS that rig's
 * anchor — first-user promotion mints it and is ruled correct and unchanged.
 * Only under a walled posture is the same row the LEGACY anchor. The
 * request-side pointer carried no such gate, so the default posture — `single`,
 * what an unconfigured deployment resolves to — was told once per process to
 * migrate off an anchor that is not scheduled to go away, toward a variable its
 * own promotion is pinned never to read.
 *
 * ⚠️ BOTH directions are pinned here, deliberately. Gating the notice is only
 * correct if the walled rigs keep hearing it: the migration window's loudness
 * is the thing #11663 P5 exists to provide, and a one-sided pin would let a
 * later edit switch it off for everyone and stay green.
 *
 * ⛔ And every arm below asserts STANDING as well as the log. This card changes
 * a log trigger, not access control; a `single` rig keeps exactly the
 * PLATFORM_ADMIN it had, it merely stops being nagged about it.
 */
describe('[#13667] the legacy-grant pointer fires only on the rigs in the migration window', () => {
  it('WALLED rigs still hear it — both walled postures, once per process, holder and config line named', async () => {
    for (const walled of ['group', 'isolated'] as const) {
      declare(undefined);
      requestPosture(walled);
      resetLegacyPlatformAdminGrantReport();
      sink.warns.length = 0;

      const ql = makeQl(legacyTables());
      const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
      await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });

      expect(grants.posture, walled).toBe('PLATFORM_ADMIN');
      expect(sink.warns, walled).toHaveLength(1);
      expect(sink.warns[0], walled).toContain('usr_1');
      expect(sink.warns[0], walled).toContain(`${ENV}=legacy@corp.example`);
    }
  });

  it('a `single` rig is SILENT — and keeps the identical PLATFORM_ADMIN standing', async () => {
    declare(undefined);
    requestPosture('single');
    const ql = makeQl(legacyTables());
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });

    // The half this card repairs: no notice…
    expect(sink.warns).toEqual([]);
    // …and the half it must not disturb: the row still confers, exactly as before.
    expect(grants.posture).toBe('PLATFORM_ADMIN');
    expect(grants.positions[0]).toBe('platform_admin');
    expect(grants.permissions).toContain(ADMIN_FULL_ACCESS);
  });

  it('the DEFAULT posture is silent too — an unconfigured deployment resolves `single`', async () => {
    // The reach of the defect: `OS_TENANCY_POSTURE` and `OS_MULTI_ORG_ENABLED`
    // both unset is what a deployment that has configured no tenancy at all
    // looks like, and `resolveTenancyPosture()` answers `single` for it. This
    // arm is the one that covers most rigs in the field.
    declare(undefined);
    requestPosture(undefined);
    const grants = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });

    expect(sink.warns).toEqual([]);
    expect(grants.posture).toBe('PLATFORM_ADMIN');
  });

  it('the legacy-anchor detection itself is untouched: `single` + a CONFIG anchor is silent for the other reason', async () => {
    // The control that keeps the arm above honest. Silence under `single` must
    // come from the posture gate, not from the fixture having quietly stopped
    // resolving through the legacy row. Here the SAME user also matches the
    // declared list, so standing no longer rests on the row and #11663 P5's own
    // `else if` never runs — silence with a different cause, under both postures.
    for (const p of ['single', 'isolated'] as const) {
      declare('legacy@corp.example');
      requestPosture(p);
      resetLegacyPlatformAdminGrantReport();
      sink.warns.length = 0;

      const grants = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });
      expect(sink.warns, p).toEqual([]);
      expect(grants.posture, p).toBe('PLATFORM_ADMIN');
    }
  });

  it('adds NO read: the recorded query multiset is identical under both answers of the gate', async () => {
    // The in-place claim at the call site — "the row is read only if it was
    // already loaded, so this notice never adds a query (and so never moves the
    // pinned query multiset)" — re-MEASURED rather than quoted, because this
    // card is what put a new call into that branch. `resolveTenancyPosture()`
    // asks the ENVIRONMENT, so the reads issued against the engine must be
    // identical whichever way it answers.
    const reads: Record<string, unknown[]> = {};
    for (const p of ['single', 'isolated'] as const) {
      declare(undefined);
      requestPosture(p);
      resetLegacyPlatformAdminGrantReport();
      const ql = makeQl(legacyTables());
      await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
      reads[p] = ql.calls.map((c) => ({ object: c.object, where: c.where }));
    }
    expect(reads.single).toEqual(reads.isolated);
    expect(reads.single.length).toBeGreaterThan(0); // the fixture really did resolve
  });

  it('…and the notice still costs no sys_user read of its own — it fires with the row never loaded', async () => {
    // The other half of the same claim, isolated. Above, `sys_user` IS read —
    // for `grants.email` and the `ai_seat` synthesis, neither of which is this
    // branch. Seed both of those and NOTHING in the resolution needs the row;
    // the notice must still fire under a walled posture, reading `userRow` as
    // the undefined it already was and falling back to the generic address
    // placeholder. That is what "read only if it was already loaded" means, and
    // it is unchanged by the gate.
    const seeded = { nowMs: NOW, seedEmail: 'seeded@corp.example', seedPermissions: ['ai_seat'] };
    for (const p of ['single', 'isolated'] as const) {
      declare(undefined);
      requestPosture(p);
      resetLegacyPlatformAdminGrantReport();
      sink.warns.length = 0;

      const ql = makeQl(legacyTables());
      const grants = await resolveUserAuthzGrants(ql, 'usr_1', seeded);

      expect(ql.calls.filter((c) => c.object === 'sys_user'), p).toHaveLength(0);
      expect(grants.posture, p).toBe('PLATFORM_ADMIN');
      expect(sink.warns, p).toHaveLength(p === 'single' ? 0 : 1);
    }
    // The walled arm named the holder, and quoted the placeholder rather than an
    // address it would have had to issue a read to learn.
    expect(sink.warns[0]).toContain('usr_1');
    expect(sink.warns[0]).toContain(`${ENV}=<the administrator's verified email address>`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
/**
 * [#13667] STANDING is invariant under the posture — all four arms of the
 * `if (configConfersPlatformAdmin) / else if (hasPlatformAdminGrant)`
 * derivation.
 *
 * The gate this card adds is nested INSIDE the `else if` body, so no arm of
 * that chain changes shape. This suite is the measurement of that claim rather
 * than an assertion about it: each of the four (config, grant) truth-table
 * corners is resolved once under `single` and once under `isolated`, and the
 * two envelopes must be deep-equal — same positions in the same order, same
 * permissions, same rung.
 *
 * ⛔ If a future edit moves the posture test up into the `else if` condition, or
 * anywhere else it could suppress a branch, one of these four corners changes
 * and this suite goes red.
 */
describe('[#13667] standing is byte-identical across postures in all four derivation arms', () => {
  const verified = { id: 'usr_1', email: 'a@b.c', email_verified: true };

  const ARMS: Array<{ arm: string; env: string | undefined; tables: () => Record<string, Array<Record<string, unknown>>> }> = [
    // config=T, grant=T — the config anchor wins and the `else if` is skipped.
    { arm: 'config + legacy grant', env: 'legacy@corp.example', tables: legacyTables },
    // config=T, grant=F — config-only standing.
    { arm: 'config only', env: 'a@b.c', tables: () => configOnlyTables(verified) },
    // config=F, grant=T — the arm this card gates the NOTICE inside.
    { arm: 'legacy grant only', env: undefined, tables: legacyTables },
    // config=F, grant=F — no standing at all.
    { arm: 'neither', env: undefined, tables: () => configOnlyTables(verified) },
  ];

  for (const { arm, env, tables } of ARMS) {
    it(`resolves the SAME envelope under \`single\` and under \`isolated\` — ${arm}`, async () => {
      const envelopes: Record<string, unknown> = {};
      for (const p of ['single', 'isolated'] as const) {
        declare(env);
        requestPosture(p);
        resetLegacyPlatformAdminGrantReport();
        envelopes[p] = await resolveUserAuthzGrants(makeQl(tables()), 'usr_1', { nowMs: NOW });
      }
      expect(envelopes.single).toEqual(envelopes.isolated);
    });
  }

  it('and the four arms are genuinely DISTINCT — the matrix above is not four copies of one answer', async () => {
    // Without this control the suite above would pass just as well on four
    // fixtures that all resolved to the same thing, proving nothing about the
    // arms it claims to cover.
    const seen: string[] = [];
    for (const { env, tables } of ARMS) {
      declare(env);
      requestPosture('single');
      resetLegacyPlatformAdminGrantReport();
      const g = await resolveUserAuthzGrants(makeQl(tables()), 'usr_1', { nowMs: NOW });
      seen.push(`${g.posture}|${[...g.permissions].sort().join(',')}`);
    }
    // Arms 1-3 all confer PLATFORM_ADMIN (by design — that is what makes the
    // notice, not the standing, the only thing this card moves); arm 4 does not.
    expect(seen[0]).toContain('PLATFORM_ADMIN');
    expect(seen[1]).toContain('PLATFORM_ADMIN');
    expect(seen[2]).toContain('PLATFORM_ADMIN');
    expect(seen[3]).toBe('MEMBER|');
  });
});
