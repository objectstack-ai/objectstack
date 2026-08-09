// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The filter operator vocabulary has TWO surfaces, and #5701 made them
 * temporarily disagree on purpose. This file is what stops that from being
 * silent.
 *
 * - **Declaration**: `FieldOperatorsSchema` / `StringOperatorSchema` /
 *   `Filter<T>` — what an author may write and what `tsc` accepts. Nothing
 *   derives a runtime allowlist from these (verified: `NormalizedFilterSchema`
 *   is their only consumer and nothing parses a filter through it at runtime).
 * - **Enforcement**: `FILTER_OPERATORS` — the array `driver-memory`'s shape
 *   gate and `service-analytics`' coverage test DERIVE from. An entry here is a
 *   claim that backends implement the operator.
 *
 * `$icontains` is declared and still not enforced (#5701 is the contract half
 * of the #4706 ruling; #5702 wrote the lowerings for the SQL family only, and
 * #6520 is what the remaining JS faces wait on). Measured on the branch that
 * added it to `FILTER_OPERATORS` early: driver-memory's gate stopped refusing
 * it and `match({ name: 'zzz' }, { name: { $icontains: 'acme' } })` returned
 * `true` — the predicate silently dropped, every row matched. That is the
 * widening #3948 is about, so the staging is not a stylistic choice, and
 * #5702 landing did NOT clear it: the array is read by the two faces that
 * still refuse the operator, not by the three that answer it.
 *
 * The pin below is deliberately an EQUALITY, not a subset check, so it fails in
 * both directions: a second staged operator added without recording it fails
 * here, and so does clearing `$icontains` in #6520 — which is the point. The
 * failure message is the instruction.
 */

import { describe, it, expect } from 'vitest';
import {
  FieldOperatorsSchema,
  StringOperatorSchema,
  FILTER_OPERATORS,
  LOGICAL_OPERATORS,
  RETIRED_FILTER_OPERATORS,
} from './filter.zod';

const declaredKeys = () => Object.keys(FieldOperatorsSchema.shape).sort();

describe('the declaration surface and the enforcement surface', () => {
  it('differ by EXACTLY the operators staged ahead of their backends', () => {
    const declared = new Set(declaredKeys());
    const enforced = new Set<string>(FILTER_OPERATORS);
    const stagedOnly = [...declared].filter((op) => !enforced.has(op)).sort();

    expect(
      stagedOnly,
      'FieldOperatorsSchema and FILTER_OPERATORS differ by something other than the recorded '
        + 'staging. If you are ADDING an operator: declare it in FieldOperatorsSchema only, and '
        + 'add it here plus a note on FILTER_OPERATORS saying which issue implements it — an '
        + 'operator in FILTER_OPERATORS with no backend arm makes driver-memory accept it and '
        + "silently DROP the predicate (measured, #5701). If you are CLEARING one because you "
        + 'just implemented it on EVERY face (for `$icontains` that is #6520 — #5702 did the SQL '
        + 'family and correctly left the staging in place): remove it from this list AND delete '
        + 'the staging paragraph on FILTER_OPERATORS, which is now describing something that is '
        + 'no longer true.',
    ).toEqual(['$icontains']);
  });

  it('has no operator enforced that is not declared', () => {
    const declared = new Set(declaredKeys());
    const undeclared = FILTER_OPERATORS.filter((op) => !declared.has(op));
    expect(
      undeclared,
      'FILTER_OPERATORS demands backends implement an operator FieldOperatorsSchema does not '
        + 'declare, so an author cannot write it and `tsc` will reject it. This direction is '
        + 'never staging — it is a drift.',
    ).toEqual([]);
  });

  it('declares $icontains on the string operator schema too', () => {
    expect(Object.keys(StringOperatorSchema.shape)).toContain('$icontains');
  });

  it('accepts a declared $icontains rather than stripping it', () => {
    const parsed = FieldOperatorsSchema.parse({ $icontains: 'acme' });
    expect(parsed).toEqual({ $icontains: 'acme' });
  });

  it('rejects a non-string $icontains comparand at the schema', () => {
    expect(() => FieldOperatorsSchema.parse({ $icontains: 42 })).toThrow();
  });
});

describe('RETIRED_FILTER_OPERATORS', () => {
  const entries = Object.entries(RETIRED_FILTER_OPERATORS);

  it('covers the operators #4706 retired', () => {
    expect(Object.keys(RETIRED_FILTER_OPERATORS).sort()).toEqual(['$options', '$regex']);
  });

  it('never points at an operator the protocol no longer has', () => {
    // The `authoring-key-lint.test.ts` rule, applied to operators: a guidance
    // table whose prescriptions name something undeclared is advice that sends
    // an author into a second error. Note the check is against the DECLARATION
    // surface, because `$icontains` is deliberately not in FILTER_OPERATORS yet.
    const declared = new Set(declaredKeys());
    for (const [op, guidance] of entries) {
      if (guidance.to === undefined) continue;
      expect(declared.has(guidance.to), `${op} prescribes ${guidance.to}, which is not declared`).toBe(true);
    }
  });

  it('states the replacement inside the prescription, not only in the `to` field', () => {
    // A refusal prints `why`. If the replacement lives only in a sibling field
    // the caller may not render, the error tells the author they are wrong
    // without telling them what to write — which is the failure the tombstone
    // convention exists to prevent (AGENTS.md, Post-Task Checklist step 3).
    for (const [op, guidance] of entries) {
      if (guidance.to === undefined) continue;
      expect(guidance.why, `${op}'s prescription never names ${guidance.to}`).toContain(guidance.to);
    }
  });

  it('names the retired operator itself, so a refusal can quote one string', () => {
    for (const [op, guidance] of entries) {
      expect(guidance.why, `${op}'s prescription never names ${op}`).toContain(op);
    }
  });

  it('is not simultaneously declared anywhere — retired means gone', () => {
    const declared = new Set([...declaredKeys(), ...FILTER_OPERATORS, ...LOGICAL_OPERATORS]);
    for (const op of Object.keys(RETIRED_FILTER_OPERATORS)) {
      expect(declared.has(op), `${op} is both retired and declared`).toBe(false);
    }
  });

  it('is frozen — a consumer cannot mutate the shared prescriptions', () => {
    expect(Object.isFrozen(RETIRED_FILTER_OPERATORS)).toBe(true);
  });
});
