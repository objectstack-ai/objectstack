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
 * first-user promotion. `claimSeedOwnership` (best-effort, on the promotion
 * path) short-circuits because this object exposes no `registry`.
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
      return rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          return (r as any)?.[k] === v;
        }),
      );
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any) {
      const row = (tables[object] ?? []).find((r) => (r as any)?.id === data?.id);
      if (row) Object.assign(row as object, data);
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
