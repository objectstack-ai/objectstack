// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { compileCelToFilter, isPushdownableCel } from './cel-to-filter';

/** current_user context used across the value-resolution cases. */
const VARS = {
  current_user: {
    id: 'u_me',
    organization_id: 'org_1',
    org_user_ids: ['u_me', 'u_peer'],
    team_member_ids: ['u_me', 'u_report'],
    department: 'sales',
  },
};

const ok = (src: string, vars = VARS) => {
  const r = compileCelToFilter(src, { variables: vars });
  if (!r.ok) throw new Error(`expected ok for "${src}" but got ${r.reason}: ${r.detail}`);
  return r.filter;
};
const fail = (src: string, vars: Record<string, unknown> = VARS) =>
  compileCelToFilter(src, { variables: vars });

describe('compileCelToFilter — equality & literals', () => {
  it('field == variable → implicit equality with resolved value', () => {
    expect(ok('owner_id == current_user.id')).toEqual({ owner_id: 'u_me' });
  });
  it('record.field == variable (strips record root)', () => {
    expect(ok('record.organization_id == current_user.organization_id')).toEqual({ organization_id: 'org_1' });
  });
  it('field == string literal', () => {
    expect(ok("record.region == 'EMEA'")).toEqual({ region: 'EMEA' });
  });
  it('field == number literal (bigint coerced to number)', () => {
    expect(ok('record.amount == 1000')).toEqual({ amount: 1000 });
  });
  it('field == boolean literal', () => {
    expect(ok('record.active == true')).toEqual({ active: true });
  });
  it('field != variable → $ne', () => {
    expect(ok('record.owner_id != current_user.id')).toEqual({ owner_id: { $ne: 'u_me' } });
  });
});

describe('compileCelToFilter — null & exists', () => {
  it('field == null → $null:true', () => {
    expect(ok('record.target_channels == null')).toEqual({ target_channels: { $null: true } });
  });
  it('field != null → $null:false', () => {
    expect(ok('record.target_channels != null')).toEqual({ target_channels: { $null: false } });
  });
});

describe('compileCelToFilter — comparisons (with right-side field flip)', () => {
  it('>', () => expect(ok('record.amount > 1000')).toEqual({ amount: { $gt: 1000 } }));
  it('>=', () => expect(ok('record.rating >= 4')).toEqual({ rating: { $gte: 4 } }));
  it('<', () => expect(ok('record.amount < 500')).toEqual({ amount: { $lt: 500 } }));
  it('<=', () => expect(ok('record.amount <= 500')).toEqual({ amount: { $lte: 500 } }));
  it('flips when the field is on the right (100 > record.amount → amount < 100)', () => {
    expect(ok('100 > record.amount')).toEqual({ amount: { $lt: 100 } });
  });
});

describe('compileCelToFilter — membership (in → $in)', () => {
  it('field in current_user.<array> (the RLS membership IN-form)', () => {
    expect(ok('id in current_user.org_user_ids')).toEqual({ id: { $in: ['u_me', 'u_peer'] } });
  });
  it('record.field in <inline list>', () => {
    expect(ok("record.status in ['open','won']")).toEqual({ status: { $in: ['open', 'won'] } });
  });
  it('not in → !(x in y) → $not wrapping $in', () => {
    expect(ok('!(record.status in [\'lost\'])')).toEqual({ $not: { status: { $in: ['lost'] } } });
  });
});

describe('compileCelToFilter — string methods', () => {
  it('startsWith → $startsWith', () => {
    expect(ok("record.name.startsWith('Acme')")).toEqual({ name: { $startsWith: 'Acme' } });
  });
  it('endsWith → $endsWith', () => {
    expect(ok("record.email.endsWith('@corp.com')")).toEqual({ email: { $endsWith: '@corp.com' } });
  });
  it('contains → $contains', () => {
    expect(ok("record.name.contains('beta')")).toEqual({ name: { $contains: 'beta' } });
  });
});

describe('compileCelToFilter — logical combinators (the #1887 compound-condition target)', () => {
  it('&& → $and', () => {
    expect(ok("record.stage == 'won' && record.amount >= 500")).toEqual({
      $and: [{ stage: 'won' }, { amount: { $gte: 500 } }],
    });
  });
  it('|| → $or', () => {
    expect(ok("record.tier == 'gold' || record.tier == 'platinum'")).toEqual({
      $or: [{ tier: 'gold' }, { tier: 'platinum' }],
    });
  });
  it('! → $not', () => {
    expect(ok('!(record.secret == true)')).toEqual({ $not: { secret: true } });
  });
  it('flattens nested same-operator (a && b && c → one $and)', () => {
    expect(ok("record.a == 1 && record.b == 2 && record.c == 3")).toEqual({
      $and: [{ a: 1 }, { b: 2 }, { c: 3 }],
    });
  });
  it('nested mixed precedence', () => {
    expect(ok("record.region == 'EMEA' && (record.tier == 'gold' || record.amount > 10000)")).toEqual({
      $and: [{ region: 'EMEA' }, { $or: [{ tier: 'gold' }, { amount: { $gt: 10000 } }] }],
    });
  });
});

describe('compileCelToFilter — field-to-field ($field reference)', () => {
  it('record.a == record.b → $eq $field', () => {
    expect(ok('record.created_by == record.owner_id')).toEqual({
      created_by: { $eq: { $field: 'owner_id' } },
    });
  });
});

describe('compileCelToFilter — allow-all constant fold', () => {
  it('1 == 1 → {} (no restriction)', () => {
    expect(ok('1 == 1')).toEqual({});
  });
  it('true → {}', () => {
    expect(ok('true')).toEqual({});
  });
  it('1 == 2 → fails closed (not allow-all)', () => {
    expect(fail('1 == 2').ok).toBe(false);
  });
});

describe('compileCelToFilter — fail-closed on non-pushdownable (ADR-0055 / D5)', () => {
  const unsupported = [
    "record.name.matches('A.*')",     // unsupported rcall method
    'record.amount + 1 > 2',          // arithmetic
    'size(record.tags) > 0',          // function call
    'record.account.region == \'X\'', // cross-object / nested relation traversal
    'account.region == \'X\'',        // unknown-root relation traversal
    "record.cond ? record.a : record.b == 1", // ternary
  ];
  for (const src of unsupported) {
    it(`refuses: ${src}`, () => {
      const r = fail(src);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('unsupported');
    });
  }
  it('parse error is reported, not thrown', () => {
    const r = fail('record.a == ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('parse-error');
  });
});

describe('compileCelToFilter — unresolved variable fails closed', () => {
  it('missing current_user.* → unresolved-variable', () => {
    const r = compileCelToFilter('record.owner_id == current_user.id', { variables: { current_user: {} } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unresolved-variable');
  });
  it('null variable (e.g. no active org) → unresolved-variable (fail closed)', () => {
    const r = compileCelToFilter('record.organization_id == current_user.organization_id', {
      variables: { current_user: { organization_id: null } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unresolved-variable');
  });
  it('empty membership array still compiles to $in:[] (caller decides)', () => {
    expect(ok('id in current_user.org_user_ids', { current_user: { org_user_ids: [] } })).toEqual({
      id: { $in: [] },
    });
  });
});

describe('isPushdownableCel — shape-only gate (no variables)', () => {
  const supported = [
    'owner_id == current_user.id',
    "record.region == 'EMEA'",
    'record.amount > 1000',
    'id in current_user.org_user_ids',
    "record.status in ['a','b']",
    'record.target_channels != null',
    "record.a == 1 && record.b == 2",
    "record.name.startsWith('A')",
    '1 == 1',
  ];
  for (const src of supported) {
    it(`accepts: ${src}`, () => expect(isPushdownableCel(src).ok).toBe(true));
  }
  const refused = [
    'record.amount + 1 > 2',
    'size(record.tags) > 0',
    "record.account.region == 'X'",
  ];
  for (const src of refused) {
    it(`rejects: ${src}`, () => expect(isPushdownableCel(src).ok).toBe(false));
  }
});

describe('compileCelToFilter — input shapes', () => {
  it('accepts a { dialect, source } expression object', () => {
    expect(ok({ dialect: 'cel', source: "record.region == 'EMEA'" } as unknown as string)).toBeUndefined;
    const r = compileCelToFilter({ source: "record.region == 'EMEA'" }, { variables: VARS });
    expect(r.ok && r.filter).toEqual({ region: 'EMEA' });
  });
  it('custom variableRoots/fieldRoots', () => {
    const r = compileCelToFilter('row.dept == ctx.department', {
      fieldRoots: ['row'],
      variableRoots: ['ctx'],
      variables: { ctx: { department: 'sales' } },
    });
    expect(r.ok && r.filter).toEqual({ dept: 'sales' });
  });
});

/**
 * A null/undefined MEMBER of a resolved membership array fails closed, like the
 * null SCALAR variable already pinned above (maintainer ruling, 2026-08-31).
 *
 * BOTH POLARITIES are pinned, and that is the point of the suite rather than a
 * completeness flourish. The alternative repair — stripping the unresolved member
 * — is safe in POSITIVE polarity (`$in` over the surviving members never grants
 * more than those members grant) and INVERTS under the supported `not in` form:
 * `!(x in y)` lowers to `$not` wrapping `$in`, and `$in: []` matching nothing makes
 * `$not { $in: [] }` match the whole table. A positive-only suite is green for both
 * repairs and therefore pins nothing about the one that was ruled on.
 */
describe('compileCelToFilter — a null MEMBER of a membership array fails closed', () => {
  const vars = (org_user_ids: unknown[]) => ({ current_user: { id: 'u_me', org_user_ids } });
  const expectUnresolved = (r: ReturnType<typeof compileCelToFilter>, path = 'current_user.org_user_ids') => {
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unresolved-variable');
    expect(r.detail).toContain(path);
    expect(r.detail).toContain('unresolved member');
  };

  // ---- POSITIVE polarity: `x in y` -> $in ---------------------------------
  it('positive: null among resolved members → unresolved-variable (no $in emitted)', () => {
    expectUnresolved(compileCelToFilter('id in current_user.org_user_ids', { variables: vars(['u_me', null]) }));
  });
  it('positive: a lone null member → unresolved-variable', () => {
    expectUnresolved(compileCelToFilter('id in current_user.org_user_ids', { variables: vars([null]) }));
  });
  it('positive: an undefined member fails closed too (the scalar path refuses both)', () => {
    expectUnresolved(compileCelToFilter('id in current_user.org_user_ids', { variables: vars(['u_me', undefined]) }));
  });

  // ---- NEGATIVE polarity: `!(x in y)` -> $not wrapping $in ----------------
  // This is where stripping inverted into allow-all; refusing must reach the SAME
  // result here as in positive polarity, with no polarity threading in the lowerer.
  it('negated `not in`: null among resolved members → unresolved-variable (no $not{$in} emitted)', () => {
    expectUnresolved(compileCelToFilter('!(id in current_user.org_user_ids)', { variables: vars(['u_me', null]) }));
  });
  it('negated `not in`: a lone null member → unresolved-variable, NOT $not{$in:[]} (whole table)', () => {
    expectUnresolved(compileCelToFilter('!(id in current_user.org_user_ids)', { variables: vars([null]) }));
  });
  it('negated inside a disjunction: the surviving disjunct does not rescue the compile', () => {
    expectUnresolved(
      compileCelToFilter("!(id in current_user.org_user_ids) || owner == current_user.id", {
        variables: vars([null]),
      }),
    );
  });
  it('negated inside a conjunction fails closed as well', () => {
    expectUnresolved(
      compileCelToFilter("!(id in current_user.org_user_ids) && owner == current_user.id", {
        variables: vars(['u_me', null]),
      }),
    );
  });

  // ---- the two polarities agree, which is the ruling's "same treatment" ----
  it('both polarities and the null SCALAR variable yield the identical reason', () => {
    const scalar = compileCelToFilter('record.organization_id == current_user.organization_id', {
      variables: { current_user: { organization_id: null } },
    });
    const positive = compileCelToFilter('id in current_user.org_user_ids', { variables: vars([null]) });
    const negated = compileCelToFilter('!(id in current_user.org_user_ids)', { variables: vars([null]) });
    const reasons = [scalar, positive, negated].map((r) => (r.ok ? 'ok' : r.reason));
    expect(reasons).toEqual(['unresolved-variable', 'unresolved-variable', 'unresolved-variable']);
  });

  // ---- shapes this guard must NOT move --------------------------------------
  it('a fully resolved membership array still compiles, in both polarities', () => {
    expect(ok('id in current_user.org_user_ids', vars(['u_me', 'u_peer']))).toEqual({
      id: { $in: ['u_me', 'u_peer'] },
    });
    expect(ok('!(id in current_user.org_user_ids)', vars(['u_me', 'u_peer']))).toEqual({
      $not: { id: { $in: ['u_me', 'u_peer'] } },
    });
  });
  it('an EMPTY membership array still compiles to $in:[] in both polarities (a declared predicate, unchanged here)', () => {
    expect(ok('id in current_user.org_user_ids', vars([]))).toEqual({ id: { $in: [] } });
    expect(ok('!(id in current_user.org_user_ids)', vars([]))).toEqual({ $not: { id: { $in: [] } } });
  });
  it('an AUTHORED literal null in a list is not an unresolved variable — out of this guard scope', () => {
    // A declared predicate, the same way `record.x == null` lowers to `$null` rather
    // than failing closed. What such a filter SELECTS is a separate open question;
    // this pin records only that the compiler still lowers it, unchanged.
    expect(ok("record.status in ['lost', null]")).toEqual({ status: { $in: ['lost', null] } });
  });
  it('isPushdownableCel is untouched: the authoring gate resolves no variables', () => {
    expect(isPushdownableCel('id in current_user.org_user_ids').ok).toBe(true);
    expect(isPushdownableCel('!(id in current_user.org_user_ids)').ok).toBe(true);
  });
});
