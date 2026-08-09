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
 * The two surfaces AGREE today, and the staging that made them disagree is
 * over: #6520 added `$icontains` to `FILTER_OPERATORS` in the same PR that gave
 * every JS evaluation face an arm, which is the only order in which that name
 * could be added at all. Measured on the branch that added it EARLY (#5701):
 * driver-memory's gate stopped refusing it and
 * `match({ name: 'zzz' }, { name: { $icontains: 'acme' } })` returned `true` —
 * the predicate silently dropped, every row matched. That is the widening #3948
 * is about, and it is why the empty set below is a result rather than a default.
 *
 * The pin is deliberately an EQUALITY, not a subset check, so it fails in both
 * directions: an operator declared but not enforced fails here (stage it
 * knowingly, by adding it to this list with an issue), and so does one enforced
 * without being declared. The failure message is the instruction.
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
      'FieldOperatorsSchema declares an operator FILTER_OPERATORS does not enforce, and nothing '
        + 'records the staging. That is legal but never silent: an operator in FILTER_OPERATORS '
        + 'with no backend arm makes driver-memory accept it and silently DROP the predicate '
        + '(measured, #5701 — a dropped predicate WIDENS, which on an RLS read scope is #3948), '
        + 'so declaring ahead of the arms is the correct staging. To stage one: declare it in '
        + 'FieldOperatorsSchema, add it to the array THIS assertion compares against, and note on '
        + 'FILTER_OPERATORS which issue implements it. To clear one: implement it on EVERY face '
        + 'in ONE PR — spec word list, driver-memory (query path, reference matcher, analytics '
        + 'face), driver-mongodb, service-analytics (3 compilers), objectql `having`, formula — '
        + 'then empty this list. #6520 is the worked example of the clearing direction.',
    ).toEqual([]);
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
    // an author into a second error. The check is against the DECLARATION
    // surface, which since #6520 is the same set as the enforcement surface —
    // it stays written this way because a prescription must name something an
    // author may WRITE, and that is what FieldOperatorsSchema answers.
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
