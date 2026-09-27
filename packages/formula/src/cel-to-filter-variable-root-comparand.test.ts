// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19959] `==` / `!=` against the bare variable ROOT (`current_user`), or a
 * variable that resolves to an object, is a compile error, not a lowering.
 *
 * `record.owner_id != current_user` used to lower to
 * `{ owner_id: { $ne: <the whole caller context> } }`, `==` to the bare object,
 * and `!(… == current_user)` to `$not` around it. A strict compare never equals
 * an object, so the RLS `check` evaluator admitted every write the policy was
 * written to refuse. On the constant branch `current_user != 'guest'` folded to
 * "no restriction" for the same reason.
 *
 * The root is known from the source, so it is refused in BOTH modes — the shape
 * check (`isPushdownableCel` / `isSupportedRlsExpression`, which the authoring
 * lint and the RLS compiler's "uncompilable predicate" branch read) and every
 * compile, whatever it binds. An object-valued `current_user.<key>` exists only
 * per request, so that refusal is pinned at request time with the shape check
 * still passing.
 */

import { describe, expect, it } from 'vitest';

import { compileCelToFilter, isPushdownableCel } from './cel-to-filter';
import { isSupportedRlsExpression } from './rls-predicate';

/** The RLS compiler's context shape: scalar keys and membership arrays. */
const VARS = {
  current_user: {
    id: 'u_me',
    organization_id: 'org_me',
    email: 'me@example.test',
    positions: ['pos_me'],
    org_user_ids: ['u_me', 'u_peer'],
    accessible_org_ids: ['org_me'],
    // Not a key any in-tree producer binds: the per-request object guard's subject.
    profile: { team: 'team_secret' },
    since: new Date('2026-01-01T00:00:00.000Z'),
  },
};

/** Every value in {@link VARS} — none may appear in a refusal's detail. */
const VALUES = ['u_me', 'org_me', 'me@example.test', 'pos_me', 'u_peer', 'team_secret'];

const detailOf = (source: string, variables: Record<string, unknown>) => {
  const compiled = compileCelToFilter(source, { variables });
  expect(compiled.ok).toBe(false);
  expect(compiled.ok ? undefined : compiled.reason).toBe('unsupported');
  return compiled.ok ? '' : compiled.detail;
};

const REFUSED_ROOT = [
  'record.owner_id != current_user',
  'record.owner_id == current_user',
  '!(record.owner_id == current_user)',
  '!(record.owner_id != current_user)',
  'current_user != record.owner_id',
  'current_user == record.owner_id',
  "record.status == 'open' && record.owner_id != current_user",
  "record.status == 'open' || !(record.owner_id == current_user)",
  // An always-true sibling never folds the refused arm into allow-all.
  '1 == 1 || record.owner_id != current_user',
  // The constant branch: an object is never strictly equal to a literal, so
  // these folded to "no restriction".
  "current_user != 'guest'",
  "'guest' != current_user",
  'current_user != null',
  "record.status == 'open' || current_user != 'guest'",
];

describe('[#19959] == / != against the bare variable root is refused, at authoring time and at request time', () => {
  for (const source of REFUSED_ROOT) {
    it(`${source} — unsupported, naming the root and withholding the context`, () => {
      const detail = detailOf(source, VARS);
      expect(detail).toContain('`current_user` is the variable root itself');
      expect(detail).toContain('current_user.id');
      for (const value of VALUES) expect(detail).not.toContain(value);
      // The same verdict with nothing bound — the sharing seeder's call.
      expect(detailOf(source, {})).toBe(detail);
      // Visible before any request: the lint and the RLS compiler's
      // "uncompilable predicate" branch read this.
      expect(isPushdownableCel(source).ok).toBe(false);
      expect(isSupportedRlsExpression(source)).toBe(false);
    });
  }

  it('the legacy SQL-ish spelling is refused by the authoring gate after the bridge', () => {
    expect(isSupportedRlsExpression('owner_id = current_user')).toBe(false);
  });

  it('a custom variable root is refused the same way', () => {
    const opts = { fieldRoots: ['row'], variableRoots: ['ctx'], variables: { ctx: { department: 'sales' } } };
    const compiled = compileCelToFilter('row.dept != ctx', opts);
    expect(compiled.ok ? undefined : compiled.reason).toBe('unsupported');
    expect(compiled.ok ? '' : compiled.detail).toContain('`ctx` is the variable root itself');
    expect(isPushdownableCel('row.dept != ctx', opts).ok).toBe(false);
  });
});

const REFUSED_OBJECT = [
  'record.team == current_user.profile',
  'record.team != current_user.profile',
  '!(record.team == current_user.profile)',
  'current_user.profile != record.team',
  "current_user.profile != 'guest'",
];

describe('[#19959] == / != against a variable that RESOLVES to an object is refused at request time', () => {
  for (const source of REFUSED_OBJECT) {
    it(`${source} — unsupported, naming the path and withholding its value`, () => {
      const detail = detailOf(source, VARS);
      expect(detail).toContain('`current_user.profile` resolves to an object');
      for (const value of VALUES) expect(detail).not.toContain(value);
      // The value is per request, so the shape check passes the source.
      expect(isPushdownableCel(source).ok).toBe(true);
      expect(isSupportedRlsExpression(source)).toBe(true);
    });
  }
});

describe('[#19959] every neighbouring comparison lowers exactly as before', () => {
  const ok = (source: string) => {
    const r = compileCelToFilter(source, { variables: VARS });
    if (!r.ok) throw new Error(`expected "${source}" to lower, got ${r.reason}: ${r.detail}`);
    return r.filter;
  };

  it('a scalar key of the root — the spelling the refusal points at', () => {
    expect(ok('record.owner_id == current_user.id')).toEqual({ owner_id: 'u_me' });
    expect(ok('record.owner_id != current_user.id')).toEqual({ owner_id: { $ne: 'u_me' } });
    expect(ok('!(record.owner_id == current_user.id)')).toEqual({ $not: { owner_id: 'u_me' } });
    expect(ok('current_user.email == record.owner')).toEqual({ owner: 'me@example.test' });
    expect(ok('record.organization_id == current_user.organization_id')).toEqual({ organization_id: 'org_me' });
  });

  it('a Date-valued key is a literal comparand and passes', () => {
    expect(ok('record.created_at == current_user.since')).toEqual({ created_at: VARS.current_user.since });
  });

  it('membership sets under `in` / `not in`', () => {
    expect(ok('record.owner_id in current_user.org_user_ids')).toEqual({ owner_id: { $in: ['u_me', 'u_peer'] } });
    expect(ok('!(record.owner_id in current_user.org_user_ids)')).toEqual({
      $not: { owner_id: { $in: ['u_me', 'u_peer'] } },
    });
  });

  it('constant comparisons over scalar keys and literals', () => {
    expect(ok('1 == 1')).toEqual({});
    expect(ok("current_user.id != 'guest'")).toEqual({});
  });

  it('field-to-field and null comparisons', () => {
    expect(ok('record.owner == record.manager')).toEqual({ owner: { $eq: { $field: 'manager' } } });
    expect(ok('record.closed_at != null')).toEqual({ closed_at: { $null: false } });
  });
});
