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
 * ⚠️ [#11663 L5] That last clause is L2's, and its WALLED half has since EXPIRED.
 * L2/L4 opened a time-boxed migration window; L5 closed it. Under a walled
 * posture the legacy unscoped `admin_full_access` row is no longer an anchor and
 * there is no deprecation pointer left to log — both symbols that carried it are
 * gone from `@objectstack/core`. Under `single` the row still confers, exactly as
 * it always did (Choice 4A, the zero-config path); its disposition is #11979's.
 * The suites at the end of this file are the measurement of that boundary.
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
 *
 * ⭐ [#11663 L5] The recorded `where` is DEEP-COPIED at record time, and that is
 * load-bearing rather than tidy. The resolver builds one of its filters as
 * `{ name: { $in: grants.positions } }` — a live reference to an array it goes on
 * to MUTATE (§6c unshifts the derived `platform_admin` into it). Recording the
 * reference makes every later assertion read the array's FINAL contents instead
 * of the query as issued, so a multiset comparison silently reports a difference
 * that no driver ever saw — measured here: the two postures issue byte-identical
 * `sys_position` reads, and a by-reference recording reported them as differing
 * because one of them derives `platform_admin` afterwards. ⛔ Do not go back to
 * storing `opts.where` directly.
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
      calls.push({ object, where: structuredClone(opts?.where ?? null) });
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

describe('[#11663 L5] the legacy grant row is an anchor under `single`, and NOWHERE else', () => {
  it('an unscoped admin_full_access grant still confers PLATFORM_ADMIN with no config at all', async () => {
    // ⭐ The zero-config path, and the reason this card is walled-only. The
    // harness clears both tenancy inputs, so this rig resolves `single` — what a
    // deployment that configured no tenancy at all looks like. Choice 4A rules
    // its first-user promotion and its row correct and UNCHANGED, and the
    // maintainer's constraint on the ruling that authorized L5 is verbatim:
    // 「比如临时启动的开发环境，我不可能去配置啊」. ⛔ If this arm ever goes red
    // because the retirement widened past the wall, that is the defect, not this
    // pin. The `single` half is #11979's to dispose of.
    declare(undefined);
    const grants = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });
    expect(grants.posture).toBe('PLATFORM_ADMIN');
  });

  it('⛔ a WALLED rig derives NOTHING from the same row — the anchor is retired', async () => {
    // The card. L4 stopped the walled BOOT from minting this row; L5 stops the
    // walled DERIVATION from reading it. With nothing declared, a walled rig
    // holding only this row has no platform administrator at all — which is the
    // fail-closed answer, announced at boot by plugin-security's backstop.
    declare(undefined);
    requestPosture('isolated');
    const grants = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });
    expect(grants.posture).toBe('MEMBER');
    expect(grants.positions).not.toContain('platform_admin');
  });

  it('⛔ and it says NOTHING while doing it — the deprecation pointer is gone, not relocated', async () => {
    // L4's pointer fired here, once per process, on exactly this fixture. The
    // window it announced has closed, so the request path has nothing left to
    // say; the operator-facing line moved to BOOT, where an operator can act on
    // it. ⛔ A warn appearing here again means someone reintroduced a per-request
    // notice inside the authorization path.
    declare(undefined);
    requestPosture('isolated');
    const ql = makeQl(legacyTables());
    await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
    await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
    expect(sink.warns).toEqual([]);
    expect(sink.errors).toEqual([]);
  });

  it('the CONFIG anchor still confers on that same walled rig — the row route went, not the config one', async () => {
    // The control that keeps the arm above honest: MEMBER under a wall must come
    // from the retired row route, not from the fixture having quietly stopped
    // resolving anything at all.
    declare('legacy@corp.example');
    requestPosture('isolated');
    const grants = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });
    expect(grants.posture).toBe('PLATFORM_ADMIN');
    expect(sink.warns).toEqual([]);
  });

  it('⭐ the retirement takes the ANCHOR, not the GRANT — the held set still grants what it grants', async () => {
    // The declared boundary of this card, measured rather than asserted in
    // prose. A walled holder keeps the `admin_full_access` permission set they
    // hold — its name, and therefore everything downstream resolves from that
    // name — and loses only PLATFORM_ADMIN STANDING: the rung and the built-in
    // `platform_admin` position. ⛔ Revoking the set itself would be revoking the
    // ROW, which is ADR-0131 C3's on the v18 line and #11979's under `single` —
    // ⛔ not this card's. If a later leg widens to the row, this pin is the one
    // that should be re-authored deliberately rather than deleted in passing.
    declare(undefined);
    requestPosture('isolated');
    const grants = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });
    expect(grants.permissions).toContain(ADMIN_FULL_ACCESS);
    expect(grants.posture).toBe('MEMBER');
    expect(grants.positions).not.toContain('platform_admin');
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
 * [#11663 L5] The legacy unscoped anchor is POSTURE-KEYED — the request side
 * matching the boot side, on the standing itself rather than on a log line.
 *
 * `bootstrapPlatformAdmin` has always been posture-keyed: under `single` a
 * pre-existing unscoped `admin_full_access` holder is `already_have_admin` and
 * the boot exits silently, because under Choice 4A that row IS that rig's
 * anchor — first-user promotion mints it and is ruled correct and unchanged.
 * Only under a walled posture is the same row the LEGACY anchor, and L4 stopped
 * the walled boot from ever writing it. This is the EXIT: the walled request
 * path stops READING it too, so on a walled rig platform standing is derived
 * from `OS_PLATFORM_OWNER_EMAIL` and from nothing else.
 *
 * ⚠️ BOTH directions are pinned here, deliberately. Retiring the walled anchor is
 * only correct if the `single` rigs keep theirs: the zero-config first-user
 * promotion is what a development environment started for a moment depends on,
 * and a one-sided pin would let a later edit switch it off for everyone and stay
 * green. That is the failure this card's own dispatch measured in advance —
 * taken to every posture the retirement turns eleven pins red with the signature
 * `expected 'MEMBER' to be 'PLATFORM_ADMIN'`.
 *
 * ⛔ Every arm below asserts STANDING, not a log line. There is no log line left
 * on this path to assert.
 */
describe('[#11663 L5] the legacy anchor confers only on the rigs Choice 4A keeps it for', () => {
  it('⛔ WALLED rigs derive nothing from it — both walled postures, repeatedly, silently', async () => {
    for (const walled of ['group', 'isolated'] as const) {
      declare(undefined);
      requestPosture(walled);
      sink.warns.length = 0;

      const ql = makeQl(legacyTables());
      const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
      await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });

      expect(grants.posture, walled).toBe('MEMBER');
      expect(grants.positions, walled).not.toContain('platform_admin');
      expect(sink.warns, walled).toEqual([]);
    }
  });

  it('a `single` rig keeps the identical PLATFORM_ADMIN standing it always had', async () => {
    declare(undefined);
    requestPosture('single');
    const ql = makeQl(legacyTables());
    const grants = await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });

    // The half this card must not disturb: the row still confers, whole.
    expect(grants.posture).toBe('PLATFORM_ADMIN');
    expect(grants.positions[0]).toBe('platform_admin');
    expect(grants.permissions).toContain(ADMIN_FULL_ACCESS);
    // …and silently, as it has been since #13667.
    expect(sink.warns).toEqual([]);
  });

  it('the DEFAULT posture keeps it too — an unconfigured deployment resolves `single`', async () => {
    // The reach of the constraint: `OS_TENANCY_POSTURE` and `OS_MULTI_ORG_ENABLED`
    // both unset is what a deployment that has configured no tenancy at all
    // looks like, and `resolveTenancyPosture()` answers `single` for it. This
    // arm is the one that covers most rigs in the field, and it is the arm the
    // maintainer's zero-config constraint is about.
    declare(undefined);
    requestPosture(undefined);
    const grants = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });

    expect(grants.posture).toBe('PLATFORM_ADMIN');
    expect(sink.warns).toEqual([]);
  });

  it('a CONFIG anchor resolves under BOTH postures — the retirement is of the row route alone', async () => {
    // The control that keeps the walled arm honest. MEMBER under a wall must
    // come from the retired row route, not from the fixture having quietly
    // stopped resolving. Here the SAME user also matches the declared list, so
    // standing rests on the config anchor and both postures answer alike.
    for (const p of ['single', 'isolated'] as const) {
      declare('legacy@corp.example');
      requestPosture(p);
      sink.warns.length = 0;

      const grants = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });
      expect(grants.posture, p).toBe('PLATFORM_ADMIN');
      expect(sink.warns, p).toEqual([]);
    }
  });

  it('adds NO read: the recorded query multiset is identical under both answers of the gate', async () => {
    // The in-place claim at the call site — the posture gate "asks the
    // ENVIRONMENT, so it issues no query and the pinned batch-equivalence query
    // multiset cannot move whichever way it answers" — re-MEASURED rather than
    // quoted. #13667 owed this measurement for a gate on a LOG line; L5 owes it
    // again because the gate moved onto the derivation itself, where a stray
    // engine read would be a per-request cost on every walled rig.
    const reads: Record<string, unknown[]> = {};
    for (const p of ['single', 'isolated'] as const) {
      declare(undefined);
      requestPosture(p);
      const ql = makeQl(legacyTables());
      await resolveUserAuthzGrants(ql, 'usr_1', { nowMs: NOW });
      reads[p] = ql.calls.map((c) => ({ object: c.object, where: c.where }));
    }
    expect(reads.single).toEqual(reads.isolated);
    expect(reads.single.length).toBeGreaterThan(0); // the fixture really did resolve
  });

  it('…and costs no sys_user read of its own — the gate never reaches for the row', async () => {
    // Seed `grants.email` and the `ai_seat` capability and NOTHING in the
    // resolution needs the `sys_user` row. The posture gate must still answer,
    // on both sides, without issuing one: it reads the environment. #13667 owed
    // this for the notice's `userRow?.email` lookup; L5 owes it because the gate
    // now decides STANDING, and a read added here would be added to every
    // request on every walled rig.
    const seeded = { nowMs: NOW, seedEmail: 'seeded@corp.example', seedPermissions: ['ai_seat'] };
    for (const p of ['single', 'isolated'] as const) {
      declare(undefined);
      requestPosture(p);
      sink.warns.length = 0;

      const ql = makeQl(legacyTables());
      const grants = await resolveUserAuthzGrants(ql, 'usr_1', seeded);

      expect(ql.calls.filter((c) => c.object === 'sys_user'), p).toHaveLength(0);
      expect(grants.posture, p).toBe(p === 'single' ? 'PLATFORM_ADMIN' : 'MEMBER');
      expect(sink.warns, p).toEqual([]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
/**
 * [#11663 L5] STANDING across the posture, all four corners of the
 * `if (configConfersPlatformAdmin)` derivation — three invariant, ONE moved.
 *
 * #13667 measured all four as byte-identical, because the gate it added sat
 * inside a branch body and could not change any arm's answer. L5's gate sits on
 * the derivation itself, so exactly ONE corner is expected to differ:
 * `config=F, grant=T`, the legacy-grant-only arm. This suite is the measurement
 * of that claim rather than an assertion about it — each corner is resolved once
 * under `single` and once under `isolated`, and the three that must not move are
 * deep-equal while the one that must move is named and asserted in both
 * directions.
 *
 * ⛔ If a future edit moves the posture test anywhere it can suppress another
 * corner, one of the three invariant arms goes red.
 */
describe('[#11663 L5] standing across postures — three arms invariant, the legacy arm moved', () => {
  const verified = { id: 'usr_1', email: 'a@b.c', email_verified: true };

  const INVARIANT_ARMS: Array<{ arm: string; env: string | undefined; tables: () => Record<string, Array<Record<string, unknown>>> }> = [
    // config=T, grant=T — the config anchor confers on every posture.
    { arm: 'config + legacy grant', env: 'legacy@corp.example', tables: legacyTables },
    // config=T, grant=F — config-only standing.
    { arm: 'config only', env: 'a@b.c', tables: () => configOnlyTables(verified) },
    // config=F, grant=F — no standing at all, on any posture.
    { arm: 'neither', env: undefined, tables: () => configOnlyTables(verified) },
  ];

  for (const { arm, env, tables } of INVARIANT_ARMS) {
    it(`resolves the SAME envelope under \`single\` and under \`isolated\` — ${arm}`, async () => {
      const envelopes: Record<string, unknown> = {};
      for (const p of ['single', 'isolated'] as const) {
        declare(env);
        requestPosture(p);
        envelopes[p] = await resolveUserAuthzGrants(makeQl(tables()), 'usr_1', { nowMs: NOW });
      }
      expect(envelopes.single).toEqual(envelopes.isolated);
    });
  }

  it('⭐ and the fourth corner — legacy grant ONLY — deliberately does NOT: that is the card', async () => {
    // The one arm L5 moves, pinned in BOTH directions so neither half can be
    // lost. ⛔ Making this deep-equal again would mean either the walled anchor
    // came back or the `single` one went away; both are defects, and they are
    // different defects.
    const envelopes: Record<string, any> = {};
    for (const p of ['single', 'isolated'] as const) {
      declare(undefined);
      requestPosture(p);
      envelopes[p] = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });
    }
    expect(envelopes.single).not.toEqual(envelopes.isolated);
    expect(envelopes.single.posture).toBe('PLATFORM_ADMIN');
    expect(envelopes.isolated.posture).toBe('MEMBER');
  });

  it('and the arms are genuinely DISTINCT — the matrix above is not copies of one answer', async () => {
    // Without this control the suite above would pass just as well on fixtures
    // that all resolved to the same thing, proving nothing about the arms it
    // claims to cover. Read under `single`, where every arm that ever conferred
    // still does.
    const seen: string[] = [];
    for (const { env, tables } of [...INVARIANT_ARMS.slice(0, 2), { env: undefined, tables: legacyTables }, INVARIANT_ARMS[2]]) {
      declare(env);
      requestPosture('single');
      const g = await resolveUserAuthzGrants(makeQl(tables()), 'usr_1', { nowMs: NOW });
      seen.push(`${g.posture}|${[...g.permissions].sort().join(',')}`);
    }
    // Arms 1-3 all confer PLATFORM_ADMIN under `single`; arm 4 does not.
    expect(seen[0]).toContain('PLATFORM_ADMIN');
    expect(seen[1]).toContain('PLATFORM_ADMIN');
    expect(seen[2]).toContain('PLATFORM_ADMIN');
    expect(seen[3]).toBe('MEMBER|');
  });
});
