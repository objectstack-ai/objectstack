// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8676 — the guard's lists are derived from the installed contract on
 * every run, never recalled. objectui#11253 added the second one, for choice
 * fields; its derivation is the last two `describe` blocks below.
 *
 * ## Why this file is the point rather than a formality
 *
 * The card this guard closes is about an enumeration that went stale while
 * nothing said so. `RELATIONSHIP_TYPES_REQUIRING_REFERENCE` is the only
 * enumeration the fix itself keeps, so it does not get to be exempt from the
 * card's own lesson. This re-derives it from `@objectstack/spec` — parsing a
 * minimal `{ type, label }` document for EVERY member of `FieldType` and keeping
 * the types the contract refuses at path `reference` — and asserts the guard's
 * array equals that. A spec release that makes a third field type require a
 * target turns this red, which is precisely what nothing did for the writers.
 *
 * ⚠ The derivation carries its own controls. A probe that refuses everything, or
 * accepts everything, would also "agree" with some array, so the run asserts
 * that the population is non-trivial and that a type OUTSIDE the derived set
 * parses green on the same minimal document.
 *
 * ⛔ Deliberately a TEST and not a runtime probe. Parsing 50 documents on the way
 * to every save pays a hot-path cost to re-learn something that changes at most
 * once per spec release, and a runtime probe that throws must choose between
 * blocking writes and failing open. A pin has neither problem: it fails at CI
 * time with nothing at stake.
 */

import { describe, expect, it } from 'vitest';
import { FieldSchema, FieldType, ObjectSchema } from '@objectstack/spec/data';
import { checkFieldCompleteness, FIELD_CHOICE_WITHOUT_OPTIONS } from '@objectstack/spec/kernel';
import {
  CHOICE_TYPES_REQUIRING_OPTIONS,
  RELATIONSHIP_TYPES_REQUIRING_REFERENCE,
} from './object-metadata-write-guard';

/** Every field type the installed contract refuses for want of a `reference`. */
function deriveTypesRequiringReference(): string[] {
  const derived: string[] = [];
  for (const type of FieldType.options) {
    const result = FieldSchema.safeParse({ type, label: 'L' });
    if (result.success) continue;
    if (result.error.issues.some((issue) => issue.path.join('.') === 'reference')) derived.push(type);
  }
  return derived;
}

describe('RELATIONSHIP_TYPES_REQUIRING_REFERENCE — derived from the installed spec', () => {
  it('is exactly the set the contract refuses at `reference`', () => {
    const derived = deriveTypesRequiringReference();
    expect([...RELATIONSHIP_TYPES_REQUIRING_REFERENCE].sort()).toEqual([...derived].sort());
  });

  it('CONTROL — the probe is neither refusing nor accepting everything', () => {
    const derived = deriveTypesRequiringReference();
    // Non-trivial on both sides: some types are in, most are not. Without this,
    // a probe that collapsed to "all" or "none" could still agree with an array.
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.length).toBeLessThan(FieldType.options.length);
    expect(FieldType.options.length).toBeGreaterThan(10);
  });

  it('CONTROL — a type outside the derived set parses green on the same document', () => {
    const outside = FieldType.options.filter((type) => !RELATIONSHIP_TYPES_REQUIRING_REFERENCE.includes(type));
    expect(outside.length).toBeGreaterThan(0);
    expect(FieldSchema.safeParse({ type: 'text', label: 'L' }).success).toBe(true);
  });
});

describe('the four target states, measured against the contract rather than asserted', () => {
  // The guard's message distinguishes four states. This is where the claim that
  // all four are REFUSED BY THE SERVER is re-measured, so the guard's "it
  // forecloses nothing the server would have taken" argument stays checkable.
  const cases: Array<[string, Record<string, unknown>]> = [
    ['absent', { type: 'lookup', label: 'L' }],
    ['null', { type: 'lookup', label: 'L', reference: null }],
    ['empty string', { type: 'lookup', label: 'L', reference: '' }],
    ['whitespace only', { type: 'lookup', label: 'L', reference: '   ' }],
  ];

  for (const [label, field] of cases) {
    it(`the contract refuses a lookup whose reference is ${label}`, () => {
      const result = ObjectSchema.safeParse({ name: 'account', label: 'A', fields: { rel: field } });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('fields.rel.reference');
    });
  }

  it('CONTROL — a usable target is ACCEPTED by the same schema on the same document', () => {
    const result = ObjectSchema.safeParse({
      name: 'account',
      label: 'A',
      fields: { rel: { type: 'lookup', label: 'L', reference: 'contact' } },
    });
    expect(result.success).toBe(true);
  });
});

/**
 * objectui#11253 — the choice set, and the one claim the guard's docblock makes
 * about the server for it.
 *
 * The set is derived from ADR-0078's author-time rule,
 * `field/choice-without-options` in `checkFieldCompleteness`, which the
 * maintainer's ruling A on objectstack#20827 names as the rule its door adopts,
 * keeping only the `error`-severity findings (the `warning` one is
 * `checkboxes`, which the ruling does not name). The door itself shipped in
 * `@objectstack/spec` 17.7.0, and the block below requires `FieldSchema`'s
 * answer to equal this one (objectui#11717).
 */
function deriveChoiceTypesRequiringOptions(): string[] {
  return FieldType.options.filter((type) =>
    checkFieldCompleteness({ type, label: 'L' }).some(
      (finding) => finding.rule === FIELD_CHOICE_WITHOUT_OPTIONS && finding.severity === 'error',
    ),
  );
}

describe('CHOICE_TYPES_REQUIRING_OPTIONS — derived from the installed spec (objectui#11253)', () => {
  it('is exactly the set the contract reports as an inert choice at `error`', () => {
    expect([...CHOICE_TYPES_REQUIRING_OPTIONS].sort()).toEqual(deriveChoiceTypesRequiringOptions().sort());
  });

  it('CONTROL — the probe is neither reporting nor passing everything', () => {
    const derived = deriveChoiceTypesRequiringOptions();
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.length).toBeLessThan(FieldType.options.length);
    // The same rule at `warning` exists, and is excluded by severity, not by luck.
    expect(checkFieldCompleteness({ type: 'checkboxes', label: 'L' })).toEqual([
      expect.objectContaining({ rule: FIELD_CHOICE_WITHOUT_OPTIONS, severity: 'warning' }),
    ]);
  });

  it('an EMPTY `options` list is no option source, and one option is', () => {
    // The guard refuses `options: []` on this reading, which is the list the
    // metadata-admin canvas seeds a new choice field with.
    for (const type of CHOICE_TYPES_REQUIRING_OPTIONS) {
      expect(checkFieldCompleteness({ type, label: 'L', options: [] }).map((f) => f.rule))
        .toContain(FIELD_CHOICE_WITHOUT_OPTIONS);
      expect(checkFieldCompleteness({ type, label: 'L', options: [{ label: 'Open', value: 'open' }] })
        .map((f) => f.rule)).not.toContain(FIELD_CHOICE_WITHOUT_OPTIONS);
    }
  });
});

describe('the installed server refuses a choice with no options one layer down (objectui#11253)', () => {
  // The guard's docblock says its choice refusal forecloses nothing the server
  // would take. That is a claim about the installed artifact, so it is measured
  // here rather than left in prose (AGENTS.md #9).
  //
  // Until `@objectstack/spec` 17.7.0 this block pinned the opposite — the server
  // still ACCEPTED a choice with no options, and the guard was ahead of it by
  // ruling — and it named what to do when it went red: the door shipped
  // (objectstack#21390), so the guard's docblock paragraph collapsed into the
  // relationship form, and this block became the refusal pin the relationship
  // rule has above: refused at `options` (objectui#11717).
  for (const type of CHOICE_TYPES_REQUIRING_OPTIONS) {
    for (const [label, extra] of [['no `options`', {}], ['an EMPTY `options` list', { options: [] }]] as const) {
      it(`the contract refuses a \`${type}\` with ${label}, at \`options\``, () => {
        const result = ObjectSchema.safeParse({ name: 'account', label: 'A', fields: { stage: { type, label: 'L', ...extra } } });
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('fields.stage.options');
      });
    }

    it(`CONTROL — a \`${type}\` with one option, or a shared \`picklist\`, is ACCEPTED by the same schema`, () => {
      for (const extra of [{ options: [{ label: 'Open', value: 'open' }] }, { picklist: 'stage_values' }]) {
        const result = ObjectSchema.safeParse({ name: 'account', label: 'A', fields: { stage: { type, label: 'L', ...extra } } });
        expect(result.success, JSON.stringify(extra)).toBe(true);
      }
    });
  }

  it('the server-refused choice set is the guard\'s list: `FieldSchema` and `checkFieldCompleteness` give one answer', () => {
    const refusedAtOptions = FieldType.options.filter((type) => {
      const result = FieldSchema.safeParse({ type, label: 'L' });
      return !result.success && result.error.issues.some((issue) => issue.path.join('.') === 'options');
    });
    expect([...refusedAtOptions].sort()).toEqual([...CHOICE_TYPES_REQUIRING_OPTIONS].sort());
  });

  it('CONTROL — the same schema on the same document DOES refuse a target-less lookup', () => {
    const result = ObjectSchema.safeParse({ name: 'account', label: 'A', fields: { stage: { type: 'lookup', label: 'L' } } });
    expect(result.success).toBe(false);
  });
});
