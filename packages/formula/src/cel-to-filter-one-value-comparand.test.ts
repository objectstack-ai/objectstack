// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886 stage 2d] Every comparison the pushdown compiler lowers compares ONE
 * value, and an `in` list holds one value per member. Stage 2c refused a list
 * under `==` / `!=` opposite a field; the same fault stayed open one position
 * over, each measured admitting and storing the writes a row-level `check` was
 * written to refuse (real `SecurityPlugin` + ObjectQL, driver-sql and
 * driver-memory):
 *
 * | predicate                                   | lowered to (before)                          | write-check evaluator (before) |
 * |---------------------------------------------|----------------------------------------------|--------------------------------|
 * | `!(record.status in [['closed', 'archived']])` | `$not { status: { $in: [[…]] } }`          | every write admitted           |
 * | `record.status > ['m']`                     | `{ status: { $gt: ['m'] } }`                 | compared as the string `'m'`   |
 * | `current_user.org_user_ids != 'x'`          | `{}` — "no restriction"                      | every write admitted           |
 * | `current_user.org_user_ids > 'a'`           | `{}` — folded on the coerced string          | every write admitted           |
 * | `record.reviewer_id > current_user`         | `{ reviewer_id: { $gt: <context object> } }` | compared as `[object Object]`  |
 *
 * Each is now `unsupported`, so every consumer fails closed on the path it
 * already has: the RLS compiler drops the policy (`RLS_DENY_FILTER` when
 * nothing else applies), the sharing seeder skips the rule, and the authoring
 * gate reports what the SOURCE shows (a list literal, the variable root). A
 * variable's value exists per request, so a resolved list is refused at
 * request time with the shape check still passing the source.
 *
 * NOT here, because the lowering cannot see it: a field compared with another
 * field whose column holds a list (`record.status != record.tags`, `tags` a
 * json or multiple field). The compiler knows the predicate's text, not the
 * object's field types; that one is refused by the write-check evaluator
 * (`matches-filter-array-comparand.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { compileCelToFilter, isPushdownableCel } from './cel-to-filter';
import { isSupportedRlsExpression } from './rls-predicate';

const VARS = {
  current_user: {
    id: 'u_me',
    email: 'me@example.test',
    org_user_ids: ['u_me', 'u_peer'],
    // A membership set a host staged with a list member — the ExecutionContext
    // contract declares string members, so only a host violating it supplies one.
    nested_set: [['acc_secret_a', 'acc_secret_b']],
    profile: { tier: 'gold' },
  },
};

const refusedEverywhere = (source: string) => {
  const compiled = compileCelToFilter(source, { variables: VARS });
  expect(compiled.ok).toBe(false);
  expect(compiled.ok ? undefined : compiled.reason).toBe('unsupported');
  return compiled.ok ? '' : compiled.detail;
};

/** Refused per request AND by the authoring shape check: the source shows the fault. */
const REFUSED_BY_SHAPE: Array<[string, string]> = [
  // (b) a nested list under `in`
  ['(b) not-in with a nested list', "!(record.status in [['closed', 'archived']])"],
  ['(b) in with a nested list', "record.status in [['closed', 'archived']]"],
  ['(b) a nested list beside a scalar member', "record.status in ['open', ['closed']]"],
  ['(b) an empty nested list', 'record.status in [[]]'],
  ['(b) under && / ||', "record.owner_id == current_user.id || !(record.status in [['closed']])"],
  // (c) an ordering operator against a list literal, either side, negated, constant
  ['(c) > a list literal', "record.status > ['m']"],
  ['(c) >= an empty list', 'record.amount >= []'],
  ['(c) <= a list literal', 'record.amount <= [10, 20]'],
  ['(c) negated <', "!(record.status < ['m'])"],
  ['(c) the list on the left', "['m'] < record.status"],
  ['(c) a constant ordering against a list literal', "['a'] > 'b'"],
  // (e) a list literal on the constant branch
  ['(e) a constant != against a list literal', "['a'] != 'x'"],
  // (d) the variable root under an ordering operator
  ['(d) > the variable root', 'record.reviewer_id > current_user'],
  ['(d) the root on the left of <=', 'current_user <= record.reviewer_id'],
  ['(d) a constant ordering of the root', "current_user > 'a'"],
];

describe('[#19886 stage 2d] a comparand that is not one value is refused — visible to the authoring gate', () => {
  for (const [name, source] of REFUSED_BY_SHAPE) {
    it(`${name}: ${source}`, () => {
      refusedEverywhere(source);
      expect(isPushdownableCel(source).ok).toBe(false);
      expect(isSupportedRlsExpression(source)).toBe(false);
    });
  }
});

/** Refused per request; the source passes the shape check because the value is per request. */
const REFUSED_PER_REQUEST: Array<[string, string, RegExp]> = [
  ['(b) a membership set with a list member', '!(record.account in current_user.nested_set)', /current_user\.nested_set/],
  ['(c) > a membership set', 'record.reviewer_id > current_user.org_user_ids', /current_user\.org_user_ids/],
  ['(c) a membership set on the left of <=', 'current_user.org_user_ids <= record.reviewer_id', /current_user\.org_user_ids/],
  ['(c) a constant ordering of a membership set', "current_user.org_user_ids > 'a'", /current_user\.org_user_ids/],
  ['(e) a constant != of a membership set', "current_user.org_user_ids != 'x'", /current_user\.org_user_ids/],
  ['(e) a constant == of a membership set', "current_user.org_user_ids == 'u_me'", /current_user\.org_user_ids/],
  ['(d) > a key that resolves to an object', 'record.tier > current_user.profile', /current_user\.profile/],
];

describe('[#19886 stage 2d] a resolved comparand that is not one value is refused at request time', () => {
  for (const [name, source, names] of REFUSED_PER_REQUEST) {
    it(`${name}: ${source} — naming the variable, withholding its value`, () => {
      const detail = refusedEverywhere(source);
      expect(detail).toMatch(names);
      for (const secret of ['u_me', 'u_peer', 'acc_secret_a', 'acc_secret_b', 'gold']) {
        expect(detail).not.toContain(secret);
      }
      expect(isPushdownableCel(source).ok).toBe(true);
      expect(isSupportedRlsExpression(source)).toBe(true);
    });
  }
});

describe('[#19886 stage 2d] each refusal carries its own remedy', () => {
  it('an ordering operator is told to take one bound, a range, or `in`', () => {
    const detail = refusedEverywhere("record.status > ['m']");
    expect(detail).toContain('`>` orders against one value');
    expect(detail).toContain("record.f > 'm'");
    expect(detail).toContain('&&');
  });

  it('a nested list is told to flatten, naming the member', () => {
    const detail = refusedEverywhere("!(record.status in ['open', ['closed']])");
    expect(detail).toContain('member 1 of the list literal is itself a list');
    expect(detail).toContain("record.f in ['a', 'b']");
  });

  it('`==` / `!=` keep the stage 2c remedy', () => {
    const detail = refusedEverywhere("current_user.org_user_ids != 'x'");
    expect(detail).toContain('`!=` compares one value');
    expect(detail).toContain('!(record.f in current_user.org_user_ids)');
  });
});

describe('[#19886 stage 2d] every neighbouring comparison lowers exactly as before', () => {
  const ok = (source: string) => {
    const r = compileCelToFilter(source, { variables: VARS });
    if (!r.ok) throw new Error(`expected "${source}" to lower, got ${r.reason}: ${r.detail}`);
    return r.filter;
  };

  it('an ordering operator against one literal, one scalar key, and another field', () => {
    expect(ok("record.status > 'm'")).toEqual({ status: { $gt: 'm' } });
    expect(ok('record.amount <= 10')).toEqual({ amount: { $lte: 10 } });
    expect(ok('record.owner_id >= current_user.id')).toEqual({ owner_id: { $gte: 'u_me' } });
    expect(ok('record.a > record.b')).toEqual({ a: { $gt: { $field: 'b' } } });
  });

  it('`in` / `not in` against a flat list and a membership set', () => {
    expect(ok("record.status in ['open', 'pending']")).toEqual({ status: { $in: ['open', 'pending'] } });
    expect(ok("!(record.status in ['closed'])")).toEqual({ $not: { status: { $in: ['closed'] } } });
    expect(ok('record.owner_id in current_user.org_user_ids')).toEqual({ owner_id: { $in: ['u_me', 'u_peer'] } });
    expect(ok('record.status in []')).toEqual({ status: { $in: [] } });
  });

  it('constant comparisons over scalars still fold', () => {
    expect(ok('1 == 1')).toEqual({});
    expect(ok("current_user.id != 'guest'")).toEqual({});
    expect(ok("current_user.id > 'a'")).toEqual({});
  });

  it('field-to-field `==` / `!=` still lower — the column TYPE is not the lowering\'s to judge', () => {
    expect(ok('record.status != record.tags')).toEqual({ status: { $ne: { $field: 'tags' } } });
    expect(ok('!(record.status == record.tags)')).toEqual({ $not: { status: { $eq: { $field: 'tags' } } } });
  });
});
