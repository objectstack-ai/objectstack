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
let sink: ReturnType<typeof makeSink>;

beforeEach(() => {
  ambient = process.env[ENV];
  delete process.env[ENV];
  resetPlatformAdminEmailMemo();
  resetLegacyPlatformAdminGrantReport();
  sink = makeSink();
  setPlatformAdminConfigSink(sink);
});

afterEach(() => {
  if (ambient === undefined) delete process.env[ENV];
  else process.env[ENV] = ambient;
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

describe('[#11663 L2 / P5] the legacy grant row is still honoured, loudly', () => {
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

  it('an unscoped admin_full_access grant still confers PLATFORM_ADMIN with no config at all', async () => {
    declare(undefined);
    const grants = await resolveUserAuthzGrants(makeQl(legacyTables()), 'usr_1', { nowMs: NOW });
    // Nothing is revoked in this leg — that is what makes it safe to land ahead
    // of every deployment setting the variable.
    expect(grants.posture).toBe('PLATFORM_ADMIN');
  });

  it('logs the deprecation pointer once, naming the holder and the config line', async () => {
    declare(undefined);
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
