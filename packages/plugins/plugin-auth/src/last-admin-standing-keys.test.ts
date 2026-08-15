// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8734] The SECOND of the two links that bind this guard's standing-key lists
 * to what the authorization resolver actually reads.
 *
 * Link 1 lives in `@objectstack/core`
 * (`security/admin-standing-surface.test.ts`): it drives the real
 * `resolveAuthzContext` over a recording engine and asserts
 * `ADMIN_STANDING_SURFACE` equals the columns observed. So that declaration is
 * a measurement of the resolver, not a copy of it, and a resolver change that
 * starts reading a new column cannot land while it is stale.
 *
 * This link consumes that measurement and requires the guard to have an ANSWER
 * for every column of it: the column is standing-bearing (it is in a list, so a
 * payload touching it pays for a full enumeration), or it is excluded with the
 * reason it cannot empty the administrator population. There is no third state
 * — which is the whole point, because the third state is what
 * `PERMISSION_SET_STANDING_KEYS` was in between #6084 and #8613: a column the
 * resolver had started reading, that the guard did not judge, and that a
 * confident, recently-dated comment said was invisible to "who is an
 * administrator".
 *
 * ## Would this have caught #8613?
 *
 * Yes, and at the earlier of the two links. #8613 made `active` a
 * resolution-time predicate by adding `isRowActive(r)` to the
 * `sys_permission_set` read. That read makes `active` observable, so link 1
 * goes red on the PR that adds it, naming the column. Declaring it there turns
 * link 2 red, because `active` would then be in neither
 * `PERMISSION_SET_STANDING_KEYS` nor the exclusion ledger. Landing #8613 green
 * would have required writing down, explicitly, that deactivating
 * `admin_full_access` cannot empty the administrator population — which is
 * false, and which is the sentence the old comment asserted by accident.
 *
 * ## What this gate deliberately does NOT assert
 *
 * That every standing KEY is a column the resolver reads. That direction reads
 * as the natural other half and it is not: `GRANT_STANDING_KEYS` carries
 * `userId` although the resolver reaches `sys_user_permission_set` rows through
 * a `where` on `user_id` and never touches the camelCase spelling on the row.
 * Enforcing it would put pressure on the guard to DROP entries — to become
 * cheaper, to fire less often — and the guard's list is allowed to be a
 * superset of what any one reader touches. The gate is one-directional on
 * purpose: it can only ever demand that the guard judges MORE.
 */

import { describe, it, expect } from 'vitest';
import { ADMIN_STANDING_SURFACE, adminStandingTables } from '@objectstack/core';

import {
  GRANT_STANDING_KEYS,
  MEMBER_STANDING_KEYS,
  PERMISSION_SET_STANDING_KEYS,
  STANDING_KEYS_BY_TABLE,
  STANDING_KEY_EXCLUSIONS,
} from './last-admin-guard.js';

const derivingTables = adminStandingTables();

describe('[#8734] standing-key lists correspond to what resolveAuthzContext reads', () => {
  it('the resolver derives administrator standing from at least one table', () => {
    // A positive control on the imported declaration itself. Every assertion
    // below is a `for` over this list; an empty one would make all of them pass
    // while checking nothing — the shape that makes a guard green forever.
    expect(derivingTables.length).toBeGreaterThan(0);
  });

  it.each(derivingTables)('the guard carries a standing-key list for %s', (table) => {
    // The table-level link: a resolver that starts deriving administrator
    // standing from a NEW table is reclassified `derives` in core, and this
    // fails until the guard grows a list — and, being a list, a hook.
    expect(Object.keys(STANDING_KEYS_BY_TABLE)).toContain(table);
    expect(STANDING_KEYS_BY_TABLE[table]!.length).toBeGreaterThan(0);
  });

  it.each(derivingTables)('every column read on %s is judged or excluded with a reason', (table) => {
    const declared = ADMIN_STANDING_SURFACE[table]!.columns ?? [];
    const keys = new Set(STANDING_KEYS_BY_TABLE[table] ?? []);
    const excluded = STANDING_KEY_EXCLUSIONS[table] ?? {};

    const undecided = declared.filter((c) => !keys.has(c) && !(c in excluded));
    expect(
      undecided,
      `Columns resolveAuthzContext reads on '${table}' that this guard neither judges nor `
        + 'excludes. Add each to the standing-key list (the usual answer — a payload touching it '
        + 'must pay for an administrator enumeration), or to STANDING_KEY_EXCLUSIONS with the '
        + 'reason it cannot empty the administrator population.',
    ).toEqual([]);
  });

  it.each(derivingTables)('no column on %s is both judged and excluded', (table) => {
    const keys = new Set(STANDING_KEYS_BY_TABLE[table] ?? []);
    const both = Object.keys(STANDING_KEY_EXCLUSIONS[table] ?? {}).filter((c) => keys.has(c));
    expect(both, `contradictory disposition on '${table}'`).toEqual([]);
  });

  it.each(derivingTables)('no exclusion on %s names a column nothing reads', (table) => {
    const declared = new Set(ADMIN_STANDING_SURFACE[table]!.columns ?? []);
    const stale = Object.keys(STANDING_KEY_EXCLUSIONS[table] ?? {}).filter((c) => !declared.has(c));
    // A ledger that keeps entries for columns no reader consults is the stale
    // comment again, in a machine-readable coat: it reads as a considered
    // decision about live code long after the code moved.
    expect(stale, `stale exclusion(s) on '${table}' — the resolver no longer reads them`).toEqual([]);
  });

  it.each(derivingTables)('every exclusion on %s carries a real reason', (table) => {
    for (const [column, reason] of Object.entries(STANDING_KEY_EXCLUSIONS[table] ?? {})) {
      expect(reason.trim().length, `'${table}.${column}' needs a reason, not a placeholder`)
        .toBeGreaterThan(40);
    }
  });

  it('the guard has no standing-key list for a table the resolver does not derive from', () => {
    // The reverse of the table-level link. A list for a table core classifies
    // `reads-only` is either a guard judging a write class nothing derives from,
    // or — far more likely — core's classification having quietly gone wrong.
    for (const table of Object.keys(STANDING_KEYS_BY_TABLE)) {
      expect(derivingTables, `'${table}' has a standing-key list but core does not derive from it`)
        .toContain(table);
    }
  });

  it('the exported lists are the ones the guard actually tests payloads against', () => {
    // STANDING_KEYS_BY_TABLE is what this gate reads; the three consts are what
    // `touchesAny` is called with. Identity, not equality, so the map cannot
    // drift into a second copy that is checked while the guard uses another.
    expect(STANDING_KEYS_BY_TABLE.sys_member).toBe(MEMBER_STANDING_KEYS);
    expect(STANDING_KEYS_BY_TABLE.sys_user_permission_set).toBe(GRANT_STANDING_KEYS);
    expect(STANDING_KEYS_BY_TABLE.sys_permission_set).toBe(PERMISSION_SET_STANDING_KEYS);
  });
});
