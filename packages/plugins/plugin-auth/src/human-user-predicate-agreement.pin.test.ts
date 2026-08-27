// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AGREEMENT PIN — plugin-security's `isHumanUser` vs plugin-auth's
 * `isHumanUserRow`, on the shared `sys_user` row corpus.
 *
 * ## What this pins and why it exists
 *
 * "Is this `sys_user` row a HUMAN?" is answered by two owners that decide two
 * halves of ONE boot sequence, on ONE population:
 *
 *  - `isHumanUserRow` (this package, `audience-posture.ts`) — the consolidated
 *    owner. The audience gate's bootstrap bypass and the dev-admin seed both
 *    read it, and it decides whether a sign-up is ADMITTED at all.
 *  - `isHumanUser` (`plugin-security/src/bootstrap-platform-admin.ts`) — a
 *    third, hand-spelled copy. It is the one that prints `[security] no human
 *    users yet — first sign-up will be promoted to platform admin` and then
 *    PERFORMS that promotion.
 *
 * The consolidation that unified the first two deliberately left the third
 * where it is: `plugin-security` does not depend on `plugin-auth`, so sharing
 * the predicate across them would mean moving it into a package both depend on
 * (`@objectstack/spec` / `@objectstack/platform-objects`) — a published-surface
 * change that consolidation rightly refused to carry, and that stays declined.
 *
 * So the copies stay, and this pin gates the property that actually matters:
 * **they answer alike**. Divergence is not a tidiness complaint — the two
 * disagreeing means a seed that decides to run and a gate that then refuses
 * it, i.e. a fresh-looking install locked out of itself. The population where
 * that is observable is named in the corpus below: a database still carrying
 * the legacy `usr_system` service row (`SystemUserId.SYSTEM` — no longer
 * provisioned, but present in every DB an older runtime created).
 *
 * ## Two populations, held apart on purpose
 *
 * {@link CORPUS} is the REACHABLE one: every entry is a shape a `sys_user`
 * read can really return, so a failure there is a live defect.
 * {@link NON_OBJECT_CORPUS} is the unreachable one — truthy non-objects, which
 * no real read yields. It was originally left out of this file because the two
 * owners genuinely disagreed on it and it would have failed; [#12515] closed
 * that disagreement by giving plugin-security the same `typeof` guard
 * `isHumanUserRow` already had, which is what made the class pinnable. The two
 * stay in separate arrays so the arrays keep saying different things: a red in
 * `CORPUS` means a reachable answer moved, a red in `NON_OBJECT_CORPUS` means
 * the fail-closed guard was dropped.
 *
 * ## Why the pin lives in plugin-auth and not in plugin-security
 *
 * Reaching both predicates from one test is a package-boundary problem, and
 * only one direction solves it WITHOUT widening a published surface:
 *
 *  - `isHumanUserRow` is module-scope-exported but is NOT re-exported from
 *    this package's `index.ts` and is not in its `exports` map, so nothing
 *    outside `plugin-auth` can import it. Pinning from `plugin-security` would
 *    require ADDING that export.
 *  - `isHumanUser` is a local closure inside `bootstrapPlatformAdmin` and is
 *    not exported at all — but `bootstrapPlatformAdmin` itself IS part of
 *    `@objectstack/plugin-security`'s published surface, and it is the real
 *    call site of the predicate.
 *
 * Hence: import `isHumanUserRow` relative (in-package, no surface change), and
 * observe `isHumanUser` THROUGH the already-published entry point. The only
 * new edge is a **devDependency** `plugin-auth -> plugin-security`; no
 * production dependency, and no new export in either package.
 *
 * That edge is also what makes this a pin rather than decoration: CI's
 * affected-package computation walks the dependency graph, so without it a
 * `plugin-security`-only change would never mark this package affected and the
 * pin would sit green through the very edit that breaks it.
 *
 * ## How the security-side verdict is read
 *
 * `bootstrapPlatformAdmin` is driven with exactly ONE row in `sys_user` under
 * the default (`single`, non-walled) posture. Its own return then reports the
 * predicate's verdict on that row directly:
 *
 *   `isHumanUser(row)` truthy  => the row is the oldest human => promoted
 *                                 => `adminPromoted: true`
 *   `isHumanUser(row)` falsy   => zero humans => the "no human users yet" log
 *                                 => `adminPromoted: false, reason: 'no_users'`
 *
 * The `reason` is asserted on the negative side on purpose. Every other way
 * this function can return `adminPromoted: false` carries a DIFFERENT reason
 * (`objectql_unavailable`, `admin_permission_set_missing`, `already_have_admin`,
 * `walled_*`, `insert_failed`), so a harness that broke and short-circuited
 * early would otherwise read as a unanimous "not human" and let this file pass
 * vacuously. `'no_users'` is reachable only through the human filter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bootstrapPlatformAdmin } from '@objectstack/plugin-security';
import { SystemUserId } from '@objectstack/spec/system';
import { isHumanUserRow } from './audience-posture.js';

/**
 * Minimal in-memory ql: three tables, `where` matched by equality. Enough for
 * `bootstrapPlatformAdmin`'s seed step, its existing-admin probe and the
 * first-user promotion.
 *
 * Two deliberate omissions, both load-bearing:
 *
 *  - **No `update`.** The only caller is the `resync` branch, which this pin
 *    never asks for. Declaring one anyway would be a fake write verb looser
 *    than `ObjectQL.update` sitting on a path no assertion covers — so it is
 *    absent rather than pinned. Its absence also short-circuits
 *    `claimSeedOwnership` (best-effort on the promotion path) at that
 *    function's own `typeof ql.update !== 'function'` guard.
 *  - **`find` honours the caller's `limit`** — applied AFTER the filter, by
 *    presence, so a bound the caller really passes is not silently ignored by
 *    a double that answers with more rows than the real engine would.
 */
function makeQl(userRows: unknown[]) {
  const tables: Record<string, any[]> = {
    sys_permission_set: [],
    sys_user: userRows.map((r) => (r && typeof r === 'object' ? { ...(r as object) } : r)) as any[],
    sys_user_permission_set: [],
  };
  return {
    tables,
    async find(object: string, q: any) {
      const rows = tables[object] ?? [];
      const where = q?.where ?? {};
      const matched = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          return (r as any)?.[k] === v;
        }),
      );
      return typeof q?.limit === 'number' ? matched.slice(0, q.limit) : matched;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return { id: data.id };
    },
  };
}

/** The one set the promotion path needs to exist before it can grant anything. */
const ADMIN_SET = { name: 'admin_full_access', label: 'Administrator' } as any;

/**
 * plugin-security's verdict on a single row, read through the published
 * `bootstrapPlatformAdmin` entry point.
 */
async function securityVerdict(row: unknown): Promise<{ human: boolean; reason?: string }> {
  const ql = makeQl([row]);
  const report = await bootstrapPlatformAdmin(ql as any, [ADMIN_SET]);
  return { human: report.adminPromoted, reason: report.reason };
}

/**
 * The shared corpus. Every entry is a shape a `sys_user` read can really
 * return, and each names the property it is here to hold.
 */
const CORPUS: { name: string; row: unknown }[] = [
  {
    name: 'an ordinary human account',
    row: { id: 'usr_alice', role: 'member', email: 'alice@example.test' },
  },
  {
    name: 'the legacy usr_system service row — the population the divergence is observable on',
    row: { id: SystemUserId.SYSTEM, role: 'system', email: 'system@internal.test' },
  },
  {
    name: 'the legacy usr_system id carrying a NON-system role',
    row: { id: SystemUserId.SYSTEM, role: 'admin', email: 'system@internal.test' },
  },
  {
    name: 'an ordinary id carrying role=system',
    row: { id: 'usr_robot', role: 'system', email: 'robot@example.test' },
  },
  {
    name: 'a human whose role is NULL — the three-valued-logic case the JS filter exists for',
    row: { id: 'usr_bob', role: null, email: 'bob@example.test' },
  },
  {
    name: 'a human with no role column at all',
    row: { id: 'usr_carol', email: 'carol@example.test' },
  },
  {
    name: 'a human with an empty-string role',
    row: { id: 'usr_dana', role: '', email: 'dana@example.test' },
  },
  {
    name: 'role "System" — case differs, so neither owner may treat it as the service account',
    row: { id: 'usr_erin', role: 'System', email: 'erin@example.test' },
  },
  {
    name: 'an id that merely CONTAINS the system id as a substring',
    row: { id: `${SystemUserId.SYSTEM}_2`, role: 'member', email: 'frank@example.test' },
  },
  {
    name: 'a row with neither id nor role',
    row: { email: 'ghost@example.test' },
  },
  { name: 'a null row', row: null },
  { name: 'an undefined row', row: undefined },
];

/**
 * The NON-OBJECT input class — held separately from {@link CORPUS} on purpose.
 *
 * ## Why it is a second array and not four more corpus entries
 *
 * `CORPUS`'s contract is that every entry is a shape a `sys_user` read can
 * really return, and these are not: a real read yields plain objects, measured
 * against a real `SqlDriver` over the shipped `SysUser` declaration. Filing
 * them into `CORPUS` would quietly falsify that promise and blur the one
 * distinction that decides how a failure here should be read.
 *
 * ## Why it is pinned at all, given it is unreachable
 *
 * This class is the gap the original pin deliberately left: it was excluded
 * because at the time it would have FAILED, not because it was uninteresting.
 * The two owners genuinely disagreed on it — `isHumanUserRow` requires
 * `typeof row === 'object'` and answered `false`, while plugin-security's
 * hand-spelled copy ran a bare truthiness check whose two property comparisons
 * are both `undefined` on a non-object and therefore both pass, answering
 * `true`. That direction fails OPEN on the copy that performs the
 * platform-admin promotion.
 *
 * Unreachable-today would be a fine reason to shrug if the asymmetry had a
 * scheduled end. It does not: consolidating the predicate into a package both
 * plugins depend on stays declined (it would widen a published surface), so
 * nothing is going to delete this divergence on its own. The guard closed it
 * instead, and this group is what stops it coming back — if a refactor ever
 * makes a non-object row reachable, or if the guard is dropped as noise, these
 * cases are the only mechanism that says so. Without them the pin sits green
 * through exactly the edit that reopens the hole.
 *
 * Both owners must answer NON-HUMAN here. That is the fail-closed direction,
 * and for a promotion predicate the safe answer to malformed input is "no".
 */
const NON_OBJECT_CORPUS: { name: string; row: unknown }[] = [
  {
    name: 'a bare id STRING where a row was expected',
    row: 'usr_alice',
  },
  {
    name: "the SYSTEM account's own id as a bare string — fail-open would promote the service account",
    row: SystemUserId.SYSTEM,
  },
  { name: 'a number', row: 42 },
  { name: 'the boolean true', row: true },
  {
    name: 'a function — truthy, and every property read on it is undefined',
    row: () => 'not a row',
  },
  { name: 'the number zero — falsy, so the decision already agreed', row: 0 },
  { name: 'an empty string — falsy, so the decision already agreed', row: '' },
];

describe('human-user predicate agreement — plugin-security `isHumanUser` vs plugin-auth `isHumanUserRow`', () => {
  const saved: Record<string, string | undefined> = {};
  const PINNED_ENV = ['OS_TENANCY_POSTURE', 'OS_PLATFORM_OWNER_EMAIL'];

  beforeEach(() => {
    for (const key of PINNED_ENV) saved[key] = process.env[key];
    // Pin the posture: the first-human promotion path is `single`. Left to the
    // ambient env this file would silently change which branch it measures.
    process.env.OS_TENANCY_POSTURE = 'single';
    delete process.env.OS_PLATFORM_OWNER_EMAIL;
  });

  afterEach(() => {
    for (const key of PINNED_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  for (const { name, row } of CORPUS) {
    it(`agrees on ${name}`, async () => {
      const authSays = isHumanUserRow(row);
      const security = await securityVerdict(row);

      expect(
        security.human,
        `plugin-security and plugin-auth disagree on this row.\n` +
          `  row:            ${JSON.stringify(row)}\n` +
          `  plugin-auth  isHumanUserRow -> ${authSays}\n` +
          `  plugin-security isHumanUser -> ${security.human} (reason: ${security.reason ?? 'none'})\n` +
          `Do NOT resolve this by editing one of them until it has been decided which is right —\n` +
          `they gate two halves of one boot (admission vs promotion) on one population.`,
      ).toBe(authSays);

      // Prove which branch produced a negative: only the human filter reaches
      // `no_users`. Without this the pin would pass on a harness that never got
      // as far as the predicate.
      if (!security.human) {
        expect(security.reason, 'negative verdict did not come from the human filter').toBe(
          'no_users',
        );
      }
    });
  }

  it('anti-vacuity: the corpus really exercises both answers, and the harness can say both', async () => {
    const verdicts = await Promise.all(CORPUS.map(({ row }) => securityVerdict(row)));
    expect(verdicts.some((v) => v.human), 'no row was judged human — harness is stuck').toBe(true);
    expect(verdicts.some((v) => !v.human), 'no row was judged non-human — harness is stuck').toBe(
      true,
    );
    expect(CORPUS.map(({ row }) => isHumanUserRow(row)).some(Boolean)).toBe(true);
    expect(CORPUS.map(({ row }) => isHumanUserRow(row)).some((v) => !v)).toBe(true);
  });

  describe('the non-object input class — unreachable today, and fail-CLOSED on both sides', () => {
    for (const { name, row } of NON_OBJECT_CORPUS) {
      it(`agrees on ${name}`, async () => {
        const authSays = isHumanUserRow(row);
        const security = await securityVerdict(row);

        // Stated as an absolute, not just as agreement: two predicates could
        // agree by both failing OPEN, which is the outcome this group exists
        // to forbid. `isHumanUserRow` is asserted false first so a regression
        // in the OWNER cannot be laundered into "well, they still agree".
        expect(
          authSays,
          `plugin-auth isHumanUserRow must answer NON-HUMAN for a non-object row.\n` +
            `  row: ${String(row)} (typeof ${typeof row})`,
        ).toBe(false);

        expect(
          security.human,
          `plugin-security and plugin-auth disagree on a NON-OBJECT row — the security\n` +
            `copy is failing OPEN on malformed input, and it is the copy that PERFORMS\n` +
            `platform-admin promotion.\n` +
            `  row:            ${String(row)} (typeof ${typeof row})\n` +
            `  plugin-auth  isHumanUserRow -> ${authSays}\n` +
            `  plugin-security isHumanUser -> ${security.human} (reason: ${security.reason ?? 'none'})\n` +
            `The fix is the \`typeof\` guard in bootstrap-platform-admin.ts, mirroring\n` +
            `isHumanUserRow — not a relaxation of this expectation.`,
        ).toBe(false);

        // Same anti-vacuity guard the reachable corpus uses: only the human
        // filter reaches `no_users`, so this proves the negative came from the
        // predicate rather than from a harness that broke earlier.
        expect(security.reason, 'negative verdict did not come from the human filter').toBe(
          'no_users',
        );
      });
    }

    it('anti-vacuity: this group really carries truthy non-objects, not just falsy ones', () => {
      // A falsy row is non-human on both sides even with the guard removed, so
      // a group that had quietly lost its truthy members would keep passing
      // through the very regression it is here to catch.
      const truthyNonObjects = NON_OBJECT_CORPUS.filter(
        ({ row }) => Boolean(row) && typeof row !== 'object',
      );
      expect(truthyNonObjects.length, 'no truthy non-object rows left in the group').toBeGreaterThan(
        0,
      );
    });
  });

  it('the legacy usr_system row alone leaves the install with NO admin and awaiting a human', async () => {
    // The card's harm model, stated as an outcome rather than a predicate call:
    // a DB carrying only the legacy service row must be "no humans yet" on BOTH
    // sides — security declines to promote it, auth declines to count it.
    const legacy = { id: SystemUserId.SYSTEM, role: 'system', email: 'system@internal.test' };
    expect(isHumanUserRow(legacy)).toBe(false);
    const security = await securityVerdict(legacy);
    expect(security.human).toBe(false);
    expect(security.reason).toBe('no_users');
  });
});
