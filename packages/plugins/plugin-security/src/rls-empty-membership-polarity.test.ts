// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13552] The RLS emptied-membership deny guard must be POLARITY-AWARE.
 *
 * `isEmptyMembershipFilter` exists so a pre-resolved membership set that
 * RESOLVES EMPTY drops the policy and the single-policy path fails closed via
 * `RLS_DENY_FILTER`. Before #13552 it shape-matched the bare positive form
 * (`{ f: { $in: [] } }`) only — but `not in` is a first-class pushdown shape
 * (`!(x in y)` → `$not` wrapping `$in`, cel-to-filter.ts), and under `$not` an
 * empty `$in: []` INVERTS from constant FALSE to constant TRUE: the policy the
 * guard exists to turn into a DENY compiled to ALLOW-ALL on the read scope.
 *
 * This suite is the triage-mandated enumeration (issue #13552, grading
 * comment): every negation/composition shape the guard must fire under, the
 * shapes it must NOT fire under (the working `not in` feature; the legitimate
 * positive-composite cases), and row-level evidence via the formula evaluator
 * that the pre-fix filter really admitted everything while the deny sentinel
 * admits nothing.
 */

import { describe, it, expect } from 'vitest';
import { isPushdownableCel, matchesFilterCondition } from '@objectstack/formula';
import { RLSCompiler, RLS_DENY_FILTER, isEmptyMembershipFilter } from './rls-compiler.js';

/** Five-row fixture: distinct owners, one null — mirrors the issue's measurement. */
const ROWS: Record<string, unknown>[] = [
  { id: 'r1', owner: 'u_me', status: 'open' },
  { id: 'r2', owner: 'u_other', status: 'open' },
  { id: 'r3', owner: 'u_third', status: 'closed' },
  { id: 'r4', owner: null, status: 'open' },
  { id: 'r5', owner: 'u_fourth', status: 'closed' },
];

const admitted = (filter: Record<string, unknown>): number =>
  ROWS.filter((row) => matchesFilterCondition(row, filter as any)).length;

const policy = (using: string): any => ({ object: 'task', operation: 'select', using });

/** Context whose membership sets all RESOLVE EMPTY (the degenerate context). */
const EMPTY_CTX: any = {
  userId: 'u_me',
  tenantId: 'org-1',
  positions: [],
  org_user_ids: [],
  rlsMembership: { team_ids: [], blocked_ids: [] },
};

describe('[#13552] emptied membership under negation — the guard must fire (deny sentinel)', () => {
  const compiler = new RLSCompiler();

  // ── The decisive control first: the DANGER is real at the evaluator ──────
  it('evaluator control: `$not` over an empty `$in` is constant TRUE — 5 of 5 rows', () => {
    // Independent of the guard: this pins WHY the guard must fire. The same
    // inversion holds at the analytics lowering (`read-scope-sql.ts`:
    // `$in: []` → `1 = 0`, and `NOT (1 = 0)` is TRUE for every row).
    expect(admitted({ $not: { owner: { $in: [] } } })).toBe(5);
    // …and the deny sentinel admits nothing.
    expect(admitted(RLS_DENY_FILTER as Record<string, unknown>)).toBe(0);
  });

  // ── Enumeration: shapes the guard fires under, driven through authored CEL ──
  const MUST_DENY: Array<[label: string, cel: string]> = [
    ['direct `$not` wrap — `not in` on an emptied set',
      '!(owner in current_user.org_user_ids)'],
    ['`$not` nested inside `$or`',
      '!(owner in current_user.team_ids) || owner == current_user.id'],
    ['`$not` nested inside `$and`',
      '!(owner in current_user.blocked_ids) && status == "open"'],
    ['`$not` over a composite containing the emptied membership ($and)',
      '!(owner in current_user.team_ids && status == "open")'],
    ['`$not` over a composite containing the emptied membership ($or)',
      '!(owner in current_user.team_ids || status == "archived")'],
    ['multi-level `$not`, odd (triple)',
      '!(!(!(owner in current_user.org_user_ids)))'],
    ['multi-level `$not`, even (double) — constant FALSE, sentinel preferred',
      '!(!(owner in current_user.org_user_ids))'],
    ['bare positive (the pre-#13552 behaviour, preserved)',
      'owner in current_user.org_user_ids'],
  ];

  it('every enumerated shape is an AUTHORABLE pushdown shape (isPushdownableCel ok)', () => {
    for (const [label, cel] of MUST_DENY) {
      expect(isPushdownableCel(cel), `${label}: ${cel}`).toEqual({ ok: true });
    }
  });

  for (const [label, cel] of MUST_DENY) {
    it(`${label} → RLS_DENY_FILTER (zero rows)`, () => {
      const filter = compiler.compileFilter([policy(cel)], EMPTY_CTX);
      expect(filter, `policy: ${cel}`).toEqual(RLS_DENY_FILTER);
      // Row-level: the compiled scope admits NOTHING. Before the #13552 fix
      // the negated shapes compiled to a constant-TRUE filter admitting 5/5.
      expect(admitted(filter as Record<string, unknown>), `policy: ${cel}`).toBe(0);
    });
  }

  // ── Shapes the guard must NOT fire under ─────────────────────────────────
  it('NON-empty membership under `$not` keeps working — the `not in` feature', () => {
    const ctx: any = { userId: 'u_me', tenantId: 'org-1', positions: [], org_user_ids: ['u_other', 'u_third'] };
    const filter = compiler.compileFilter([policy('!(owner in current_user.org_user_ids)')], ctx);
    expect(filter).toEqual({ $not: { owner: { $in: ['u_other', 'u_third'] } } });
    // r1 (u_me), r4 (null owner — $in over null is false, $not inverts), r5 (u_fourth).
    expect(admitted(filter as Record<string, unknown>)).toBe(3);
  });

  it('emptied POSITIVE membership as an `$or` arm stays inert — own rows keep flowing', () => {
    const filter = compiler.compileFilter(
      [policy('owner in current_user.team_ids || owner == current_user.id')],
      EMPTY_CTX,
    );
    expect(filter).toEqual({ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] });
    expect(admitted(filter as Record<string, unknown>)).toBe(1); // r1 only
  });

  it('deliberate allow-all stays authorable as literal `true`', () => {
    const filter = compiler.compileFilter([policy('true')], EMPTY_CTX);
    expect(filter).toEqual({});
    expect(admitted(filter as Record<string, unknown>)).toBe(5);
  });

  it('multi-policy: a dropped negated-empty policy removes only its grant — the sibling still grants', () => {
    const filter = compiler.compileFilter(
      [policy('!(owner in current_user.org_user_ids)'), policy('owner == current_user.id')],
      EMPTY_CTX,
    );
    // The degenerate policy contributes nothing; the sibling's grant survives.
    expect(filter).toEqual({ owner: 'u_me' });
    expect(admitted(filter as Record<string, unknown>)).toBe(1);
  });
});

describe('[#13552] guard shape tests — FilterCondition forms CEL cannot author', () => {
  // The guard's contract is over the compiled FilterCondition, which is wider
  // than what cel-to-filter emits today. Direct shape pins so the defensive
  // arms are not phantom checks.
  const fires = (f: Record<string, unknown>) => isEmptyMembershipFilter(f);

  it('multi-key implicit AND under `$not` (constant TRUE by De Morgan) fires', () => {
    expect(fires({ $not: { owner: { $in: [] }, status: 'open' } })).toBe(true);
    // Evaluator agreement: NOT(FALSE AND …) admits everything.
    expect(admitted({ $not: { owner: { $in: [] }, status: 'open' } })).toBe(5);
  });

  it('bare `{ $not: { $in: [] } }` still fires — pre-#13552 guard parity', () => {
    expect(fires({ $not: { $in: [] } })).toBe(true);
  });

  it('empty `$nin` (intrinsically constant TRUE) fires at positive polarity', () => {
    // Not emitted by cel-to-filter today; recognised so a future lowering
    // cannot fail open through the same blind spot ($nin: [] → `1 = 1` at the
    // read-scope SQL lowering).
    expect(fires({ owner: { $nin: [] } })).toBe(true);
    expect(fires({ $or: [{ owner: { $nin: [] } }, { status: 'open' }] })).toBe(true);
  });

  it('non-membership shapes do not fire', () => {
    expect(fires({ owner: 'u_me' })).toBe(false);
    expect(fires({ $not: { owner: { $in: ['a'] } } })).toBe(false);
    expect(fires({ $not: { owner: { $null: true } } })).toBe(false);
    expect(fires({ $and: [{ owner: { $in: [] } }, { status: 'open' }] })).toBe(false); // constant FALSE — denies by itself
    expect(fires({})).toBe(false);
  });

  it('even-`$not` emptied membership NESTED in a composite stays inert (constant FALSE arm)', () => {
    expect(fires({ $or: [{ $not: { $not: { owner: { $in: [] } } } }, { owner: 'u_me' }] })).toBe(false);
  });
});
