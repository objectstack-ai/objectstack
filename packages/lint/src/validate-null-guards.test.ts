// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4763 — `has(x)` reads as a null guard and is not one. These tests pin the
// decision procedure itself; `validate-expressions.test.ts` pins the wiring
// into the gating rule (and with it the publish gate).

import { describe, it, expect } from 'vitest';

import { celEngine, parseCelToAst } from '@objectstack/formula';

import {
  findUnguardedNullableOperands,
  nullGuardMessage,
  NULL_GUARD_HINT,
} from './validate-null-guards.js';

const nullableFields = new Set(['start_date', 'end_date', 'budget', 'spent', 'score']);
const find = (source: string) => findUnguardedNullableOperands(source, { nullableFields });

describe('findUnguardedNullableOperands — the `has()` trap (#4763)', () => {
  it('rejects the `has(a) && has(b) && a < b` shape and names both operands', () => {
    const findings = find(
      'has(record.start_date) && has(record.end_date) && record.end_date < record.start_date',
    );
    expect(findings.map((f) => f.operand).sort()).toEqual(['record.end_date', 'record.start_date']);
    expect(findings.every((f) => f.operator === '<')).toBe(true);
    // `has()` was present and still did not count — that is the whole point.
    expect(findings.every((f) => f.hasOnlyGuard)).toBe(true);
  });

  it('accepts the `!= null` form', () => {
    expect(
      find('record.start_date != null && record.end_date != null && record.end_date < record.start_date'),
    ).toEqual([]);
  });

  it('accepts a guard written on either side of the null literal', () => {
    expect(find('null != record.budget && record.budget > 100')).toEqual([]);
  });

  it('rejects an un-guarded ordering comparison against a literal', () => {
    const findings = find('record.score > 100');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ operand: 'record.score', operator: '>', hasOnlyGuard: false });
  });

  it('rejects an un-guarded operand inside arithmetic', () => {
    const findings = find('record.spent != null && record.spent > record.budget * 1.2');
    expect(findings.map((f) => f.operand)).toEqual(['record.budget']);
    expect(findings[0].operator).toBe('*');
  });

  it('accepts arithmetic whose operands are all guarded', () => {
    expect(
      find('record.budget != null && record.spent != null && record.spent > record.budget * 1.2'),
    ).toEqual([]);
  });
});

describe('findUnguardedNullableOperands — what stays legal', () => {
  it('leaves `has()` over an UNDECLARED key alone (its legitimate use)', () => {
    // `churn_reason` is not in `nullableFields` here: not a declared field of
    // this object, so nothing about it is decidable and nothing is reported.
    expect(find('!has(record.churn_reason) || record.churn_reason == null')).toEqual([]);
    expect(find('has(record.some_transient_key)')).toEqual([]);
  });

  it('never flags equality — CEL evaluates a null equality cleanly to false', () => {
    expect(find("record.budget == null || record.budget != 0")).toEqual([]);
    expect(find("record.score == 100")).toEqual([]);
  });

  it('never flags a NON-nullable declared field', () => {
    expect(findUnguardedNullableOperands('record.amount > 100', { nullableFields: new Set() })).toEqual([]);
  });

  it('never flags a nested / cross-object path it cannot judge', () => {
    expect(find('record.account.budget > 100')).toEqual([]);
  });

  it('never flags a bare identifier (flow-variable shape)', () => {
    expect(find('budget > 100')).toEqual([]);
  });

  it('honours a guard reached through `||` short-circuit (`x == null || x < y`)', () => {
    expect(find('record.budget == null || record.budget > 100')).toEqual([]);
  });

  it('honours a guard reached through a ternary', () => {
    expect(find('record.budget == null ? false : record.budget > 100')).toEqual([]);
    expect(find('record.budget != null ? record.budget > 100 : false')).toEqual([]);
  });

  it('honours `!isBlank(x)` as a real guard', () => {
    expect(find('!isBlank(record.budget) && record.budget > 100')).toEqual([]);
  });

  it('does NOT let a guard leak backwards across `&&`', () => {
    // The comparison is evaluated BEFORE the guard, so the guard cannot save it.
    const findings = find('record.budget > 100 && record.budget != null');
    expect(findings.map((f) => f.operand)).toEqual(['record.budget']);
  });

  it('does NOT accept a guard that only one arm of a `||` proves', () => {
    const findings = find('(record.budget != null || record.score != null) && record.budget > 100');
    expect(findings.map((f) => f.operand)).toEqual(['record.budget']);
  });

  it('returns nothing for an unparseable source (syntax is another gate’s verdict)', () => {
    expect(find('record.budget >')).toEqual([]);
    expect(find('')).toEqual([]);
  });

  it('reports each operand/operator pair once, not per occurrence', () => {
    expect(find('record.budget > 1 && record.budget > 2')).toHaveLength(1);
  });
});

describe('findUnguardedNullableOperands — one answer to "what parses" (#4812)', () => {
  // Until #4812 this module built its own bare cel-js `Environment`, with no
  // `limits`. It therefore parsed — and adjudicated — predicates the platform
  // rejects outright, holding the MORE permissive of two answers to "what can
  // be parsed". Routing through `@objectstack/formula`'s `parseCelToAst` makes
  // the two answers one.
  //
  // Note the direction, because #4812's issue body guessed the other one: the
  // hole was never "formula accepts something lint cannot parse, so lint
  // silently skips it". That is impossible by construction — `rewriteNullableTernary`
  // parses first and returns the source unchanged on failure, so it can never
  // make an unparseable source parseable (pinned in
  // `packages/formula/src/parse-cel-to-ast.test.ts`). The real divergence ran
  // the opposite way, and it was the bounds.

  /**
   * `record.budget > 100 && record.f0 + record.f1 + … + record.f299 > 0`.
   *
   * Two properties, and BOTH are load-bearing:
   *  - it is over `DEFAULT_LIMITS.maxAstNodes` (256) — 300 member accesses alone
   *    are 600 nodes — so the canonical entry will not parse it;
   *  - `record.budget > 100` is an ordering operator over an UNGUARDED nullable
   *    declared field, so a parse that DOES succeed yields exactly one finding.
   *
   * The second property is what makes the assertion below mean anything. A
   * first draft of this fixture guarded budget (`record.budget != null && …`)
   * and returned `[]` under both parses — passing because nothing was produced
   * rather than because the boundary moved. Reverse-verification caught it.
   */
  const overBounds =
    'record.budget > 100 && ' +
    Array.from({ length: 300 }, (_, i) => `record.f${i}`).join(' + ') +
    ' > 0';

  it('defers an over-bounds predicate to the gate that owns that verdict', () => {
    // The canonical entry cannot parse it — because the platform cannot either.
    expect(parseCelToAst(overBounds)).toBeNull();
    expect(find(overBounds)).toEqual([]);
  });

  it('would have judged that very predicate under the old limitless parse', () => {
    // The other half of the red/green line, asserted rather than asserted-about:
    // shrink the same shape to something within bounds and the unguarded
    // `record.budget > 100` IS reported. So the `[]` above is the bounds
    // boundary moving, not an empty walk over a tree with nothing in it.
    const sameShapeWithinBounds =
      'record.budget > 100 && ' +
      Array.from({ length: 10 }, (_, i) => `record.f${i}`).join(' + ') +
      ' > 0';
    expect(parseCelToAst(sameShapeWithinBounds)).not.toBeNull();
    expect(find(sameShapeWithinBounds).map((f) => f.operand)).toEqual(['record.budget']);
  });

  it('loses no coverage doing so — the bounds gate speaks, and loudly', () => {
    // The silence above is only correct because `validateExpression` runs at the
    // SAME call sites (`validate-expressions.ts` calls `check()` alongside
    // `checkNullGuards()`) and rejects this source with a blocking error. A
    // second, quieter finding about null guards on a predicate that can never be
    // published would be noise; once the author fixes the bounds fault the
    // null-guard verdict comes back.
    const compiled = celEngine.compile(overBounds);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.error.kind).toBe('bounds');
      expect(compiled.error.message).toMatch(/Exceeded maxAstNodes/i);
    }
  });

  it('still judges the same predicate once it is within bounds', () => {
    // Same shape, small enough to parse: the verdict is unchanged, so the only
    // thing #4812 moved is where the boundary sits — not what the rule decides.
    const withinBounds = 'record.f0 + record.f1 > 0 && record.budget > 100';
    expect(parseCelToAst(withinBounds)).not.toBeNull();
    expect(find(withinBounds).map((f) => f.operand)).toEqual(['record.budget']);
  });

  it('is verdict-neutral for the #3306 rewrite, which is why nothing else moved', () => {
    // The canonical entry hands this pass a rewritten AST (`cond ? dyn(x) : null`).
    // That cannot change a verdict here: the rewrite fires ONLY when exactly one
    // ternary branch is the `null` literal, and `truthGuards`/`falseGuards`
    // already prove nothing from a `null` branch — so the guard sets are
    // identical before and after, and `dyn(...)` is transparent to the operand
    // walk. Pinned on both outcomes rather than argued.
    expect(find('record.budget != null ? record.budget - 1 : null')).toEqual([]);
    // `record.owner` is not a declared nullable field here, so the condition
    // contributes nothing and the dyn-wrapped branch is the only thing judged.
    expect(find('record.owner == "acme" ? record.budget - 1 : null').map((f) => f.operand)).toEqual(
      ['record.budget'],
    );
  });
});

describe('nullGuardMessage', () => {
  it('names the rule, the operand and the `!= null` fix', () => {
    const [finding] = find('has(record.end_date) && record.end_date < 5');
    const msg = nullGuardMessage("validation rule 'end_after_start'", 'showcase_project', finding);
    expect(msg).toContain("validation rule 'end_after_start'");
    expect(msg).toContain('record.end_date');
    expect(msg).toContain('showcase_project');
    expect(msg).toContain('`<`');
    expect(msg).toContain('has(record.end_date)` does not guard it');
    expect(msg).toContain(NULL_GUARD_HINT);
  });

  it('closes with the runtime rejection wording verbatim (one voice, two gates)', () => {
    // Lifted from `unevaluableRuleError` in
    // packages/objectql/src/validation/rule-validator.ts — if that text moves,
    // this assertion is the tripwire.
    expect(NULL_GUARD_HINT).toBe(
      "Guard it with '!= null'" +
        " — 'has(x)' does NOT do that: a declared field holding null is still PRESENT, so has(x) is true.",
    );
  });
});
