// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4763 — `has(x)` reads as a null guard and is not one. These tests pin the
// decision procedure itself; `validate-expressions.test.ts` pins the wiring
// into the gating rule (and with it the publish gate).

import { describe, it, expect } from 'vitest';

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
