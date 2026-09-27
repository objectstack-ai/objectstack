// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886] `==` / `!=` against a LIST is a compile error, not a lowering — a
 * list literal, and a `current_user` variable that resolves to an array.
 *
 * It used to lower to `{ f: { $ne: [...] } }` and to the bare-array
 * `{ f: [...] }` (with `$not` around it for `!(… == [...])`). Those shapes
 * reached the backends through the RLS `using` clause, which is composed AFTER
 * the engine's comparand-shape seam, and two backends widened on them
 * (`$ne: [...]` matched every row on the write-check evaluator and every scalar
 * row on driver-mongodb). Refused here, every consumer of this compiler fails
 * closed on its own existing `unsupported` path: the RLS compiler drops the
 * policy, the sharing seeder skips the rule, and the authoring gate
 * (`isPushdownableCel` / `isSupportedRlsExpression`) reports a literal.
 *
 * A variable's value exists only per request, so the shape check cannot see a
 * resolved array: that refusal is pinned at request time, with the shape check
 * still passing the source.
 */

import { describe, expect, it } from 'vitest';

import { compileCelToFilter, isPushdownableCel } from './cel-to-filter';
import { isSupportedRlsExpression } from './rls-predicate';

const VARS = {
  current_user: {
    id: 'u_me',
    email: 'me@example.test',
    org_user_ids: ['u_me', 'u_peer'],
    // A §7.3.1 membership set staged by an app resolver, and an emptied one.
    blocked_accounts: ['acc_secret'],
    empty_set: [] as string[],
  },
};

const REFUSED = [
  "record.status != ['closed', 'archived']",
  "record.status == ['open', 'pending']",
  "!(record.status == ['closed', 'archived'])",
  "!(record.status != ['closed', 'archived'])",
  "['closed', 'archived'] != record.status",
  "['open'] == record.status",
  'record.status != []',
  "record.owner_id == current_user.id && record.status != ['closed']",
  "record.owner_id == current_user.id || !(record.status == ['closed'])",
];

describe('[#19886] == / != against a list literal is refused at the lowering', () => {
  for (const source of REFUSED) {
    it(`${source} — unsupported, at request time and at authoring time`, () => {
      const compiled = compileCelToFilter(source, { variables: VARS });
      expect(compiled.ok).toBe(false);
      expect(compiled.ok ? undefined : compiled.reason).toBe('unsupported');
      // The authoring gate asks the same compiler in shape mode, so the refusal
      // is visible before any request: the lint and the RLS compiler's
      // "uncompilable predicate" branch both read this.
      expect(isPushdownableCel(source).ok).toBe(false);
      expect(isSupportedRlsExpression(source)).toBe(false);
    });
  }
});

const REFUSED_RESOLVED = [
  'record.reviewer_id != current_user.org_user_ids',
  'record.reviewer_id == current_user.org_user_ids',
  '!(record.reviewer_id == current_user.org_user_ids)',
  '!(record.reviewer_id != current_user.org_user_ids)',
  'current_user.org_user_ids != record.reviewer_id',
  'current_user.org_user_ids == record.reviewer_id',
  'record.account != current_user.blocked_accounts',
  'record.account != current_user.empty_set',
  "record.status == 'open' && record.reviewer_id != current_user.org_user_ids",
  "record.status == 'open' || !(record.reviewer_id == current_user.org_user_ids)",
];

describe('[#19886] == / != against a variable that RESOLVES to a list is refused at request time', () => {
  for (const source of REFUSED_RESOLVED) {
    it(`${source} — unsupported, naming the variable and withholding its value`, () => {
      const compiled = compileCelToFilter(source, { variables: VARS });
      expect(compiled.ok).toBe(false);
      expect(compiled.ok ? undefined : compiled.reason).toBe('unsupported');
      const detail = compiled.ok ? '' : compiled.detail;
      expect(detail).toMatch(/current_user\.(org_user_ids|blocked_accounts|empty_set)/);
      for (const member of ['u_me', 'u_peer', 'acc_secret']) expect(detail).not.toContain(member);
      // The value is per request, so the shape check passes the source: the
      // refusal lands on the RLS compiler's per-request denial path instead.
      expect(isPushdownableCel(source).ok).toBe(true);
      expect(isSupportedRlsExpression(source)).toBe(true);
    });
  }
});

describe('[#19886] every neighbouring comparison lowers exactly as before', () => {
  const ok = (source: string) => {
    const r = compileCelToFilter(source, { variables: VARS });
    if (!r.ok) throw new Error(`expected "${source}" to lower, got ${r.reason}: ${r.detail}`);
    return r.filter;
  };

  it('`in` / `not in` against a list literal — the spelling the refusal points at', () => {
    expect(ok("record.status in ['open', 'pending']")).toEqual({ status: { $in: ['open', 'pending'] } });
    expect(ok("!(record.status in ['closed', 'archived'])")).toEqual({ $not: { status: { $in: ['closed', 'archived'] } } });
  });

  it('`in` / `not in` against a resolved membership array', () => {
    expect(ok('record.owner_id in current_user.org_user_ids')).toEqual({ owner_id: { $in: ['u_me', 'u_peer'] } });
    expect(ok('!(record.owner_id in current_user.org_user_ids)')).toEqual({
      $not: { owner_id: { $in: ['u_me', 'u_peer'] } },
    });
  });

  it('scalar == / != against a literal and against a resolved scalar', () => {
    expect(ok("record.status != 'closed'")).toEqual({ status: { $ne: 'closed' } });
    expect(ok("record.status == 'open'")).toEqual({ status: 'open' });
    expect(ok('record.owner_id == current_user.id')).toEqual({ owner_id: 'u_me' });
    expect(ok('record.owner_id != current_user.id')).toEqual({ owner_id: { $ne: 'u_me' } });
    expect(ok('current_user.email == record.owner')).toEqual({ owner: 'me@example.test' });
  });

  it('== null / != null', () => {
    expect(ok('record.closed_at == null')).toEqual({ closed_at: { $null: true } });
    expect(ok('record.closed_at != null')).toEqual({ closed_at: { $null: false } });
  });

  it('field-to-field { $field } references', () => {
    expect(ok('record.owner == record.manager')).toEqual({ owner: { $eq: { $field: 'manager' } } });
    expect(ok('record.owner != record.manager')).toEqual({ owner: { $ne: { $field: 'manager' } } });
  });
});
