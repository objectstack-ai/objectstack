// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886] `==` / `!=` against a LIST LITERAL is a compile error, not a lowering.
 *
 * It used to lower to `{ f: { $ne: [...] } }` and to the bare-array
 * `{ f: [...] }` (with `$not` around it for `!(… == [...])`). Those shapes
 * reached the backends through the RLS `using` clause, which is composed AFTER
 * the engine's comparand-shape seam, and two backends widened on them
 * (`$ne: [...]` matched every row on the write-check evaluator and every scalar
 * row on driver-mongodb). Refused here, every consumer of this compiler fails
 * closed on its own existing `unsupported` path: the RLS compiler drops the
 * policy, the sharing seeder skips the rule, and the authoring gate
 * (`isPushdownableCel` / `isSupportedRlsExpression`) reports it.
 *
 * Scope, pinned by what is NOT here as much as by what is: a `current_user`
 * variable that resolves to an array is not refused by this change.
 */

import { describe, expect, it } from 'vitest';

import { compileCelToFilter, isPushdownableCel } from './cel-to-filter';
import { isSupportedRlsExpression } from './rls-predicate';

const VARS = { current_user: { id: 'u_me', org_user_ids: ['u_me', 'u_peer'] } };

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

  it('`in` against a resolved membership array', () => {
    expect(ok('record.owner_id in current_user.org_user_ids')).toEqual({ owner_id: { $in: ['u_me', 'u_peer'] } });
  });

  it('scalar == / != against a literal and against a resolved scalar', () => {
    expect(ok("record.status != 'closed'")).toEqual({ status: { $ne: 'closed' } });
    expect(ok("record.status == 'open'")).toEqual({ status: 'open' });
    expect(ok('record.owner_id == current_user.id')).toEqual({ owner_id: 'u_me' });
    expect(ok('record.owner_id != current_user.id')).toEqual({ owner_id: { $ne: 'u_me' } });
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
