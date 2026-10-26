// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `BaseSchema.visible` / `.hidden` / `.disabled` declare the CEL envelope object
 * the shared evaluator already accepts, as ONE named wire type (objectui#7530,
 * maintainer ruling 2026-09-04: option A -- declare on all three by reusing
 * `ExpressionWireSchema`; not B, a per-key branch in `hasDeclaredPredicate`).
 *
 * ## The measured fact this closes
 *
 * `hasDeclaredPredicate` (`packages/core/src/evaluator/declaredPredicate.ts`)
 * is the one definition of "is a gate declared?" every leg of `shouldHide` /
 * `shouldDisable` asks, and it -- with `toPredicateInput` under it -- accepts
 * three shapes: a boolean, an expression string, and the envelope
 * `{ dialect?, source }`. `SchemaRenderer.hiddenDeclaredGate.test.tsx` and
 * `SchemaRenderer.disabledDeclaredGate.test.tsx` had pinned the envelope as
 * WORKING on `hidden` and `disabled` through a `Record` cast, because no key
 * declared it. Measured before this change on `origin/main` `f96a781`:
 *
 *   - TS  -- all three were `boolean | string` (`base.ts:281` / `:359` / `:385`).
 *   - zod -- all three were `z.union([z.boolean(), z.string()])`
 *     (`base.zod.ts:158` / `:188` / `:203`), and
 *     `BaseSchema.safeParse({ type, hidden: { dialect: 'cel', source: 'true' } })`
 *     returned `success: false` with `invalid_union` at path `hidden` -- the
 *     same envelope `FormFieldSchema.visibleWhen` parsed one file over.
 *
 * So a schema authoring the envelope on any of the three keys failed `validate`
 * and rendered. Declared != enforced, in the direction that gives an AI author
 * no signal.
 *
 * ## What this file pins, and why in this shape
 *
 *   1. Type level -- each key is EXACTLY `boolean | ExpressionWire | undefined`,
 *      invariantly, and the three carry the SAME declared type. `Equal`, not
 *      `extends`: the old `boolean | string` is assignable to the wide union,
 *      so a one-way check stays green on a widening that never happened, and
 *      `BaseSchema`'s `[key: string]: any` index signature meant a DELETED
 *      member read `any` (until objectui#8347), which a one-way check also
 *      accepts.
 *   2. Twin parity -- `ExpressionWire` (TS) and `z.input` of
 *      `ExpressionWireSchema` (zod) are the same union, so the two faces cannot
 *      drift apart the way `hidden` did between #4581 and #7455.
 *   3. Reuse by REFERENCE -- the object arm each key's zod union carries IS
 *      `ExpressionWireSchema`. A faithful copy passes every value
 *      comparison; identity is the only check that distinguishes reuse from
 *      the second envelope type the ruling forbids (the insight
 *      `spec-subschema-parity` already wrote down for spec re-exports).
 *      The form's field-rule TRIAD (`visibleWhen` / `readonlyWhen` /
 *      `requiredWhen`) carries the SAME wire -- the very option schemas of
 *      `ExpressionWireSchema`, by reference -- with one blank check added
 *      (objectui#8069): ADR-0137 D1 refuses an authored blank predicate in a
 *      field-rule slot, as the spec's `EvaluatedExpressionInputSchema` does on
 *      `FieldSchema`, and the objectui#8069 ruling (card comment 5910115531,
 *      as the seat applied it after contract review 5915380177) handles
 *      objectui's own wire in the same round. What this pin protects is the
 *      ONE accepted SHAPE across the platform; a refused VALUE is not a second
 *      shape, and the case below pins exactly that line. The form's two GATE
 *      mirrors whose spec key refuses a blank -- `visibleOn` and an option's
 *      `visibleWhen` -- carry that same refined wire since objectui#11262
 *      (ADR-0137 D1, followed where the spec narrowed the key); `BaseSchema`'s
 *      three objectui-only gates have no spec twin and keep the bare const.
 *   4. Runtime -- the envelope `safeParse`s GREEN in full on all three keys,
 *      with and without `dialect`, beside the string and boolean controls; and
 *      the anti-overshoot guards: `{}` (no `source`), `{ dialect: 'cel' }`,
 *      `{ source: 123 }`, a bare number and `null` are still refused AT THE
 *      KEY'S PATH. `z.any()` would satisfy every positive case on its own.
 *
 * ## Why `dialect` is optional and unconstrained
 *
 * Because the runtime reads it that way. `toPredicateInput` keeps a `'cel'`
 * envelope on the canonical engine and unwraps EVERY other dialect (absent,
 * `'template'`, unknown) onto the legacy `${...}` path; an object without a
 * string `source` is "no predicate". `{ dialect: 'cel' }` alone would refuse a
 * spelling the evaluator answers -- a declaration narrower than the runtime is
 * the same defect in the other direction.
 *
 * ## ADR-0089, read again for this card
 *
 * D4 -- "the boolean `visible` (Tab on/off) is a different type and concept and
 * is explicitly out of scope" -- governs `packages/spec`'s keys, not this
 * surface; `BaseSchema` is objectui's own declaration (#7455's triage). The ADR
 * contains no statement that a predicate key is string-only: its D1 gives
 * `visibleWhen` the spec's `ExpressionInputSchema` value, which IS the envelope.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * With `base.ts` / `base.zod.ts` at their `origin/main` `f96a781` blobs and
 * this file in place: `tsc -p tsconfig.test.json` reports TS2344 on the three
 * key assertions (TS face); the twin-parity and wire-shape assertions stay
 * clean (they do not read `BaseSchema`); every `safeParse`-green envelope case
 * fails with `invalid_union` at the key's path (zod face); every control case
 * and every refusal case stays green; the identity cases fail because the
 * object arm of `boolean | string` does not exist.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import type { BaseSchema } from '../base';
import type { ExpressionWire } from '../expression';
import { BaseSchema as Mirror } from '../zod/base.zod';
import { ExpressionWireSchema } from '../zod/expression.zod';
import { FormFieldSchema, SelectOptionSchema } from '../zod/form.zod';
import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '@objectstack/spec/shared';

/* -- Type-level helpers ---------------------------------------------------- */

/** Invariant equality -- `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* -- The declared type is exactly what the evaluator accepts --------------- */

/** The union all three keys carry, pinned here so the checks below cannot drift from it. */
type BasePredicate = boolean | ExpressionWire | undefined;

export type assertionVisible = Expect< Equal< BaseSchema['visible'], BasePredicate > >;
export type assertionHidden = Expect< Equal< BaseSchema['hidden'], BasePredicate > >;
export type assertionDisabled = Expect< Equal< BaseSchema['disabled'], BasePredicate > >;

/** The wire union itself, spelled out -- the name must not quietly widen. */
export type assertionWireShape = Expect<
  Equal< ExpressionWire, string | { dialect?: string; source: string } >
>;

/** The two faces of the wire type are one union. */
export type assertionTwinParity = Expect<
  Equal< ExpressionWire, z.input< typeof ExpressionWireSchema > >
>;

/** The helper can FAIL -- the old union is not the new one. */
export type assertionEqualCanFail = Expect<
  Equal< Equal< boolean | string | undefined, BasePredicate >, false >
>;

/* -- Authorable fixtures, no cast ------------------------------------------ */

/** The capability the renderer implements, now declared on each key. */
export const visibleEnvelopeIsAuthorable: BaseSchema = {
  type: 'test-component',
  visible: { dialect: 'cel', source: 'record.status == "open"' },
};
export const hiddenEnvelopeIsAuthorable: BaseSchema = {
  type: 'test-component',
  hidden: { dialect: 'cel', source: 'record.status == "draft"' },
};
export const disabledEnvelopeIsAuthorable: BaseSchema = {
  type: 'test-component',
  disabled: { dialect: 'cel', source: 'record.status == "locked"' },
};

/** `dialect` is optional on the wire -- the legacy-path envelope is authorable too. */
export const dialectlessEnvelopeIsAuthorable: BaseSchema = {
  type: 'test-component',
  visible: { source: '${data.role === "admin"}' },
};

/* -- Runtime companion (the zod mirror) ------------------------------------ */

const KEYS = ['visible', 'hidden', 'disabled'] as const;
/** The form's field-rule triad (objectui#8069) -- the three keys ADR-0137 D1 narrows. */
const TRIAD = ['visibleWhen', 'readonlyWhen', 'requiredWhen'] as const;
type PredicateKey = (typeof KEYS)[number];

const CEL_ENVELOPE = { dialect: 'cel', source: 'data.status == "draft"' };
const DIALECTLESS_ENVELOPE = { source: '${data.status === "draft"}' };
const PREDICATE = '${data.status === "draft"}';

const REFUSED: Array<{ label: string; value: unknown }> = [
  { label: '{} (no source)', value: {} },
  { label: "{ dialect: 'cel' } (no source)", value: { dialect: 'cel' } },
  { label: '{ source: 123 } (source is not a string)', value: { source: 123 } },
  { label: '123 (a number)', value: 123 },
  { label: 'null', value: null },
];

/** The object arm of a key's `z.union([z.boolean(), ExpressionWireSchema]).optional()`. */
function envelopeArmOf(key: PredicateKey): unknown {
  const union = Mirror.shape[key].unwrap();
  return union.options[1];
}

describe.each(KEYS)('BaseSchema.%s declares the CEL envelope (objectui#7530)', (key) => {
  it('zod mirror: the CEL envelope parses in full', () => {
    // Full parse, not just "no unrecognized_keys": this is a judgement about
    // the VALUE, so nothing short of a green `safeParse` measures it.
    expect(Mirror.safeParse({ type: 'test-component', [key]: CEL_ENVELOPE }).success).toBe(true);
  });

  it('zod mirror: an envelope without a dialect parses too -- `dialect` is optional on the wire', () => {
    expect(Mirror.safeParse({ type: 'test-component', [key]: DIALECTLESS_ENVELOPE }).success).toBe(true);
  });

  it('zod mirror: the string and boolean forms still parse -- a widening, not a replacement', () => {
    expect(Mirror.safeParse({ type: 'test-component', [key]: PREDICATE }).success).toBe(true);
    expect(Mirror.safeParse({ type: 'test-component', [key]: true }).success).toBe(true);
    expect(Mirror.safeParse({ type: 'test-component', [key]: false }).success).toBe(true);
  });

  it.each(REFUSED)('zod mirror: $label is still refused at the key path -- the anti-overshoot guard', ({ value }) => {
    // `BaseSchema` is `.passthrough()`, but the key is DECLARED, so a
    // wrong-typed value is an error at its path rather than a passthrough.
    const result = Mirror.safeParse({ type: 'test-component', [key]: value });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === key)).toBe(true);
    }
  });
});

describe('one envelope type across the package -- reuse pinned by reference (objectui#7530)', () => {
  it.each(KEYS)('BaseSchema.shape.%s carries ExpressionWireSchema itself, not a copy', (key) => {
    expect(envelopeArmOf(key)).toBe(ExpressionWireSchema);
  });

  it('the form GATE mirrors carry the triad\u2019s refined wire -- one object, not a third wire (objectui#11262)', () => {
    const triad = FormFieldSchema.shape.visibleWhen.unwrap();
    expect(FormFieldSchema.shape.visibleOn.unwrap()).toBe(triad);
    expect(SelectOptionSchema.shape.visibleWhen.unwrap()).toBe(triad);
    expect(triad.options).toBe(ExpressionWireSchema.options);
  });

  it.each(TRIAD)('FormFieldSchema.shape.%s is the same wire SHAPE -- the same option schemas by reference -- plus a blank check (objectui#8069)', (key) => {
    const wire = FormFieldSchema.shape[key].unwrap();
    // Not the bare const: it carries the ADR-0137 D1 check...
    expect(wire).not.toBe(ExpressionWireSchema);
    // ...over the SAME accepted shape: the union's arms are the const's own
    // schemas, not copies -- which is what "one wire type" means.
    expect(wire.options).toBe(ExpressionWireSchema.options);
    expect(wire.options[0]).toBe(ExpressionWireSchema.options[0]);
    expect(wire.options[1]).toBe(ExpressionWireSchema.options[1]);
    expect(wire.constructor).toBe(ExpressionWireSchema.constructor);
  });

  it('... and the form leg still parses the envelope -- the hoist moved the const, not its verdict', () => {
    expect(SelectOptionSchema.safeParse({ label: 'Draft', value: 'draft', visibleWhen: CEL_ENVELOPE }).success).toBe(true);
    expect(SelectOptionSchema.safeParse({ label: 'Draft', value: 'draft', visibleWhen: PREDICATE }).success).toBe(true);
    expect(SelectOptionSchema.safeParse({ label: 'Draft', value: 'draft', visibleWhen: {} }).success).toBe(false);
  });

  it('the shared const accepts exactly the wire union', () => {
    expect(ExpressionWireSchema.safeParse(PREDICATE).success).toBe(true);
    expect(ExpressionWireSchema.safeParse(CEL_ENVELOPE).success).toBe(true);
    expect(ExpressionWireSchema.safeParse(DIALECTLESS_ENVELOPE).success).toBe(true);
    expect(ExpressionWireSchema.safeParse(true).success).toBe(false);
    expect(ExpressionWireSchema.safeParse({}).success).toBe(false);
  });

  it('type-level: the three keys and the twin parity are pinned invariantly', () => {
    // Erased at runtime; `tsc -p tsconfig.test.json` is the checker, chained
    // from this package's `type-check` script. The runtime case exists so a
    // green vitest run is not mistaken for the proof.
    expect(visibleEnvelopeIsAuthorable.visible).toEqual({ dialect: 'cel', source: 'record.status == "open"' });
    expect(hiddenEnvelopeIsAuthorable.hidden).toEqual({ dialect: 'cel', source: 'record.status == "draft"' });
    expect(disabledEnvelopeIsAuthorable.disabled).toEqual({ dialect: 'cel', source: 'record.status == "locked"' });
    expect(dialectlessEnvelopeIsAuthorable.visible).toEqual({ source: '${data.role === "admin"}' });
  });
});

/* -- objectui#8069: the triad refuses a BLANK predicate at parse (ADR-0137 D1) -- */

/** The blank spellings -- a string, and an envelope whose `source` is one. */
const BLANKS: Array<{ label: string; value: unknown }> = [
  { label: "''", value: '' },
  { label: 'whitespace', value: '   ' },
  { label: "{ source: '' }", value: { source: '' } },
  { label: "{ dialect: 'cel', source: '  ' }", value: { dialect: 'cel', source: '  ' } },
];

const field = (key: (typeof TRIAD)[number], value: unknown) => ({ name: 'amount', [key]: value });

describe.each(TRIAD)('FormFieldSchema.%s refuses a blank predicate (objectui#8069, ADR-0137 D1)', (key) => {
  it.each(BLANKS)('$label is refused AT THE KEY, with the spec\u2019s own sentence', ({ value }) => {
    const result = FormFieldSchema.safeParse(field(key, value));
    expect(result.success).toBe(false);
    if (!result.success) {
      const atKey = result.error.issues.filter((issue) => issue.path.join('.') === key);
      expect(atKey.map((issue) => issue.message)).toEqual([EVALUATED_EXPRESSION_SOURCE_REQUIRED]);
    }
  });

  it('a non-blank string, a CEL envelope and a dialect-less envelope all parse in full', () => {
    expect(FormFieldSchema.safeParse(field(key, PREDICATE)).success).toBe(true);
    expect(FormFieldSchema.safeParse(field(key, "record.stage == 'won'")).success).toBe(true);
    expect(FormFieldSchema.safeParse(field(key, CEL_ENVELOPE)).success).toBe(true);
    expect(FormFieldSchema.safeParse(field(key, DIALECTLESS_ENVELOPE)).success).toBe(true);
  });

  it('the parsed value is the authored one, unchanged -- the check narrows the VALUE set, not the shape', () => {
    const parsed = FormFieldSchema.parse(field(key, "record.stage == 'won'"));
    expect(parsed[key]).toBe("record.stage == 'won'");
    expect(FormFieldSchema.parse(field(key, CEL_ENVELOPE))[key]).toEqual(CEL_ENVELOPE);
  });

  it('junk is still refused at the key -- the anti-overshoot guard, unchanged', () => {
    expect(FormFieldSchema.safeParse(field(key, {})).success).toBe(false);
    expect(FormFieldSchema.safeParse(field(key, 42)).success).toBe(false);
  });

  it('control -- an ABSENT rule is no rule and parses', () => {
    expect(FormFieldSchema.safeParse({ name: 'amount' }).success).toBe(true);
  });
});

/* -- objectui#11262: the two gate MIRRORS whose spec key refuses a blank follow D1 -- */

/**
 * Each parse, and the path its refusal must land on. The spec declares both
 * keys `EvaluatedExpressionInputSchema` (the data `SelectOptionSchema`'s
 * `visibleWhen`; the form view field's `visibleWhen` / deprecated `visibleOn`),
 * so the spec refuses a blank there at authoring and the mirror, which
 * overrides the key to keep objectui's wire, now refuses it too.
 */
const GATE_MIRRORS = [
  ['FormFieldSchema.visibleOn', 'visibleOn', (value: unknown) => FormFieldSchema.safeParse({ name: 'amount', visibleOn: value })],
  [
    'SelectOptionSchema.visibleWhen',
    'visibleWhen',
    (value: unknown) => SelectOptionSchema.safeParse({ label: 'Draft', value: 'draft', visibleWhen: value }),
  ],
] as const;

describe.each(GATE_MIRRORS)(
  '%s refuses a blank predicate, as the spec key it mirrors does (objectui#11262, ADR-0137 D1)',
  (_label, key, parse) => {
    it.each(BLANKS)('$label is refused AT THE KEY, with the spec\u2019s own sentence', ({ value }) => {
      const result = parse(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        const atKey = result.error.issues.filter((issue) => issue.path.join('.') === key);
        expect(atKey.map((issue) => issue.message)).toEqual([EVALUATED_EXPRESSION_SOURCE_REQUIRED]);
      }
    });

    it('a non-blank string, a CEL envelope and a dialect-less envelope all parse, the value unchanged', () => {
      for (const value of [PREDICATE, "record.stage == 'won'", CEL_ENVELOPE, DIALECTLESS_ENVELOPE]) {
        const result = parse(value);
        expect(result.success).toBe(true);
        if (result.success) expect((result.data as Record<string, unknown>)[key]).toEqual(value);
      }
    });

    it('junk is still refused at the key -- the anti-overshoot guard, unchanged', () => {
      expect(parse({}).success).toBe(false);
      expect(parse(42).success).toBe(false);
    });
  },
);

describe('control -- an objectui-only GATE keeps the plain wire: "no gate", not a refusal (ADR-0137 D4, objectui#3850)', () => {
  // `BaseSchema`'s three gates have no spec twin, so there is no spec refusal
  // for them to follow (objectui#11262's triage): a blank stays "no gate" plus
  // the one-time `[blank]` diagnostic, and it parses.
  it.each(KEYS)("BaseSchema.%s: '' and a blank envelope still parse", (key) => {
    expect(Mirror.safeParse({ type: 'test-component', [key]: '' }).success).toBe(true);
    expect(Mirror.safeParse({ type: 'test-component', [key]: { dialect: 'cel', source: ' ' } }).success).toBe(true);
  });

  it('an ABSENT view-level visibleOn and an option without visibleWhen still parse -- no gate is no gate', () => {
    expect(FormFieldSchema.safeParse({ name: 'amount' }).success).toBe(true);
    expect(SelectOptionSchema.safeParse({ label: 'Draft', value: 'draft' }).success).toBe(true);
  });
});
