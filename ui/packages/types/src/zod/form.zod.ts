/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Form Component Zod Validators
 * 
 * Zod validation schemas for form input and interactive components.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/form
 * @packageDocumentation
 */

import { z } from 'zod';
import { aliasKeyRefusal, handlerKeyRefusal, neitherContentChannelGuidance, retirementTombstone } from './tombstone.zod.js';
import { FieldSchema as SpecFieldSchema, SelectOptionSchema as SpecSelectOptionSchema } from '@objectstack/spec/data';
import { FormSelectOptionSchema as SpecFormSelectOptionSchema } from '@objectstack/spec/ui';
import { BaseSchema, SchemaNodeSchema } from './base.zod.js';
// The predicate wire shape (`string | { dialect?, source }`, #2212) was a
// module-private const here until objectui#7530 hoisted it into
// `./expression.zod.js`, so `BaseSchema`'s `visible` / `hidden` / `disabled`
// and the form predicate keys below read ONE definition. Its docblock and
// rationale moved with it.
import { ExpressionWireSchema } from './expression.zod.js';
import { EvaluatedExpressionInputSchema as SpecEvaluatedExpressionInputSchema } from '@objectstack/spec/shared';
import { stripImportedDefaults } from './imported-defaults.js';
import { closeStrictUnionArms } from './node-derivation.js';
import { GRID_FIELD_RETIRED_KEYS, type GridFieldRetiredKey } from '../field-types.js';

/**
 * ⭐ THE IMPORT BOUNDARY (objectui#8317, decision batch #90, 2026-09-08).
 *
 * **This mirror authors no default, imported subschemas included.** Batch #69
 * (objectui#7735) ruled that a validator validates and does not write values
 * into an author's document; batch #90 ruled that this holds for EVERY key
 * `safeValidateSchema` answers, not only the sites this repository wrote. So a
 * schema arriving from `@objectstack/spec` crosses into a mirror shape only
 * through `stripImportedDefaults`, which removes each reachable `ZodDefault`
 * with `.removeDefault()` and keeps the key omissible. Keys, types, checks and
 * the accept set are untouched, and a subtree carrying no default comes back
 * reference-equal — so this is a no-op the day the spec adopts the same
 * principle.
 *
 * ⛔ Spelled at every crossing rather than once per file, deliberately: a local
 * `const Spec… = stripImportedDefaults(…)` would put the spec's provenance one
 * hop away from every declaration that reads it, and `check:spec-symbols`
 * (rule 1) reads exactly one hop — a mirror export under a spec-owned name has
 * to show the spec binding in its OWN initializer. The verbosity is the
 * provenance.
 *
 * ⚠️ A read that is NOT a crossing stays unwrapped and is declared as such: a
 * value VOCABULARY (`./views.zod.ts`'s `SpecListViewTypeEnum` and
 * `./objectql.zod.ts`'s `ViewKindEnum`, which unwrap the spec's own
 * `.default('grid')` to reach its enum) and a TYPE position — neither puts a
 * default into a parsed document. `../__tests__/imported-defaults-8317.test.ts`
 * re-derives that exception list from the source rather than trusting this
 * paragraph, and fails if an entry stops matching a real read.
 */


/**
 * The wire of the field-rule TRIAD — `visibleWhen` / `readonlyWhen` /
 * `requiredWhen` on a form field: `ExpressionWireSchema` itself, with ONE check
 * added. A predicate whose text is blank after trimming — `''`, whitespace, or
 * an envelope whose `source` is either — is refused at parse (objectui#8069).
 *
 * This is ADR-0137 D1 ("a predicate slot accepts only what the engine can
 * run"; an authored blank predicate is "refused at authoring") on objectui's
 * own form wire, mirroring what `@objectstack/spec` already does to the same
 * three keys on `FieldSchema` with `EvaluatedExpressionInputSchema`. The
 * blankness is not restated here: the predicate's TEXT (the string itself, or
 * an envelope's `source`) is handed to that spec schema, and its verdict and
 * its sentence (`EVALUATED_EXPRESSION_SOURCE_REQUIRED`) are the refusal — so
 * the two refusals of one mistake read alike and cannot drift apart (the
 * objectui#8563 reason for chaining a spec rule rather than copying it). It is
 * the authoring half of a pair: D2 refuses a blank that is
 * already STORED at submit (the form renderer, the console's form page and the
 * wizard's final gate refuse a blank `visibleWhen`; the server refuses a blank
 * `requiredWhen` / `readonlyWhen`), so a blank is refused at the first place
 * that can see it, never silently read as "no rule" (ADR-0137 refuses that
 * reading for the triad in its Alternatives).
 *
 * ## Also the two GATE mirrors whose spec key refuses a blank (objectui#11262)
 *
 * Named for the triad it was written for, and since objectui#11262 carried by
 * two gate keys as well: {@link SelectOptionSchema}'s `visibleWhen` and
 * {@link FormFieldSchema}'s view-level `visibleOn`. Each mirrors a key
 * `@objectstack/spec` declares as `EvaluatedExpressionInputSchema` — the
 * option's `visibleWhen` on the data `SelectOptionSchema`, the form view
 * field's `visibleWhen` / deprecated `visibleOn` — so the spec refuses a blank
 * there at authoring (D1) and objectui's mirror, which overrides the key to keep
 * its own wire, followed it nowhere: a mirror wider than the spec on the same
 * key is a second authority. They follow D1 with this same check, not a copy of
 * it. Their RUNTIME verdict is unchanged: a stored blank gate is still "no gate"
 * plus a one-time `[blank]` diagnostic (ADR-0137 D4), never refused at submit.
 *
 * ⚠️ Deliberately a REFINEMENT and not a second schema. The accepted SHAPE is
 * exactly the one wire type objectui#7530 ruled for the whole platform — the
 * very two option schemas `ExpressionWireSchema` holds, by reference, with the
 * same output — and only the blank VALUE is taken out of it. The spec's
 * `EvaluatedExpressionInputSchema` is not reused because it is a different
 * shape: it rewrites a string into an envelope and narrows `dialect` to the
 * spec enum. The pin is `base-schema-predicate-envelope-7530.test.ts`.
 *
 * ⛔ Not for objectui-only gates. `BaseSchema`'s `visible` / `hidden` /
 * `disabled` have no spec twin — `BaseSchema` is objectui's own declaration —
 * so there is no spec refusal for them to follow: they keep the plain wire,
 * and a blank there stays "no gate" plus a one-time diagnostic (ADR-0137 D4,
 * objectui#3850 / #3960), which objectui#11262's triage records as diagnosed,
 * not refused.
 *
 * Declared ahead of {@link SelectOptionSchema}, its first reader.
 */
const FieldRulePredicateWireSchema = ExpressionWireSchema.superRefine((predicate, ctx) => {
  // Only the TEXT is judged by the spec schema — never the envelope itself,
  // whose `dialect` enum is narrower than this wire's and would refuse shapes
  // objectui#7530 admits. A non-blank text always passes its string arm.
  const verdict = stripImportedDefaults(SpecEvaluatedExpressionInputSchema).safeParse(
    typeof predicate === 'string' ? predicate : predicate.source,
  );
  if (!verdict.success) {
    for (const issue of verdict.error.issues) ctx.addIssue({ code: 'custom', message: issue.message });
  }
});

/**
 * The keys the spec's OBJECT-field option takes and its FORM-VIEW option leaves
 * out — `default` and `kind` on `@objectstack/spec` 18 (objectui#12736). The
 * runtime twin of `ObjectFieldOnlyOptionKey` in `../form`, derived the same way:
 * the set difference of the two spec schemas' own shapes, never a list.
 */
type ObjectFieldOnlyOptionKey = Exclude<
  keyof typeof SpecSelectOptionSchema.shape,
  keyof typeof SpecFormSelectOptionSchema.shape
>;

/**
 * One named refusal per {@link ObjectFieldOnlyOptionKey} (objectui#12736). The
 * form option below is a bare `z.object`, which STRIPS an undeclared key and
 * reports success — so merely leaving these keys out of its shape would turn
 * "accepted and silently ignored" into "stripped and silently ignored". Each
 * key is declared unwritable instead, and a value written there is refused at
 * parse with the issue path naming the key.
 */
function objectFieldOnlyOptionRefusals() {
  // Only the KEY sets are read here; they still cross the objectui#8317 import
  // boundary, which leaves keys untouched.
  const formKeys = new Set(Object.keys(stripImportedDefaults(SpecFormSelectOptionSchema).shape));
  const refusals = {} as Record<ObjectFieldOnlyOptionKey, ReturnType<typeof retirementTombstone>>;
  for (const key of Object.keys(stripImportedDefaults(SpecSelectOptionSchema).shape)) {
    if (formKeys.has(key)) continue;
    refusals[key as ObjectFieldOnlyOptionKey] = retirementTombstone(
      `\`${key}\` is an object-field option key, not a form option key: the spec's form-view option `
      + '(`FormSelectOptionSchema`) does not take it, and nothing on the form path reads it. '
      + `Delete it here and declare \`${key}\` on the object field's own \`options\` entry.`,
    );
  }
  return refusals;
}

/**
 * Select Option Schema — the SDUI FORM option, derived from `@objectstack/spec/ui`
 * `FormSelectOptionSchema` (objectui#12736; before it, from the data
 * `SelectOptionSchema`, objectstack#4115), with two pinned divergences, two
 * UI-only extensions, and a named refusal for each object-field-only key
 * ({@link objectFieldOnlyOptionRefusals}). Drift guard:
 * `__tests__/select-option-spec-parity.test.ts`.
 *
 * Spec keys flow in **by reference** via the spread: before the first derivation
 * the schema silently stripped `color` (which `@object-ui/fields` renders as
 * badge/dot colors) and `visibleWhen` (which the select widgets evaluate for
 * per-option gating) — a strip-mode schema fails silently, which is why the gap
 * survived. The same reason is why `default` and `kind` are REFUSED rather than
 * left out.
 */
export const SelectOptionSchema = z.object({
  ...stripImportedDefaults(SpecFormSelectOptionSchema).shape,
  // Deliberate divergence: the spec requires a lowercase machine identifier;
  // standalone UI forms legitimately bind numeric/boolean values. The parity
  // test pins both directions so a future spec widening gets noticed.
  value: z.union([z.string(), z.number(), z.boolean()]).describe('Option value'),
  // Deliberate divergence in SHAPE: keep objectui's wire contract (#2212)
  // instead of the spec's envelope-canonicalizing ExpressionInput pipe. Not in
  // VALUE: a blank predicate is refused here as the spec refuses it
  // (objectui#11262, ADR-0137 D1) — see `FieldRulePredicateWireSchema`.
  visibleWhen: FieldRulePredicateWireSchema.optional()
    .describe('Per-option visibility predicate (CEL) — option offered only when TRUE'),
  // objectui-only UI extensions (not in the spec; the parity test asserts the
  // spec has not claimed these names).
  disabled: z.boolean().optional().describe('Whether option is disabled'),
  icon: z.string().optional().describe('Option icon'),
  // objectui#12736: `default` and `kind` belong to the object field's options;
  // refused here by name rather than stripped.
  ...objectFieldOnlyOptionRefusals(),
});

/**
 * Radio Option Schema
 */
export const RadioOptionSchema = z.object({
  label: z.string().describe('Option label'),
  value: z.union([z.string(), z.number()]).describe('Option value'),
  disabled: z.boolean().optional().describe('Whether option is disabled'),
  description: z.string().optional().describe('Option description'),
});

/**
 * Combobox Option Schema
 */
export const ComboboxOptionSchema = z.object({
  value: z.string().describe('Option value'),
  label: z.string().describe('Option label'),
  disabled: z.boolean().optional().describe('Whether option is disabled'),
});

/**
 * Command Item Schema
 */
export const CommandItemSchema = z.object({
  value: z.string().describe('Item value'),
  label: z.string().describe('Item label'),
  icon: z.string().optional().describe('Item icon'),
});

/**
 * Command Group Schema
 */
export const CommandGroupSchema = z.object({
  heading: z.string().optional().describe('Group heading'),
  items: z.array(CommandItemSchema).describe('Group items'),
});

/**
 * Bounded numeric rule — the `{ value, message }` object react-hook-form
 * consumes for `minLength` / `maxLength` / `min` / `max`.
 */
const BoundedRuleSchema = (valueDescription: string) =>
  z.object({
    value: z.number().describe(valueDescription),
    message: z.string().describe('Error message shown when the rule fails'),
  });

/**
 * Validation Rule Schema — the zod mirror of `FieldValidationRules`
 * (`../form.ts`), which is the shape `form.tsx`'s read point spreads into
 * react-hook-form. Every rule except `required` is a `{ value, message }`
 * object; `required` is `string | boolean` (a string IS the message —
 * react-hook-form semantics).
 *
 * Until objectui#5186 this schema declared a flat scalar dialect
 * (`minLength: z.number()`, `pattern: z.string()`) that NO read point
 * consumed: `objectui validate` rejected metadata written to the public TS
 * contract and passed a dialect react-hook-form silently drops — #5099's
 * "looks validated, executes nothing", hidden on the zod face. The inner
 * shape is pinned by `__tests__/form-field-zod-coverage.test.ts`.
 *
 * `pattern.value` must be a compiled `RegExp` (#5099 ruling): react-hook-form
 * applies `pattern` only when `value instanceof RegExp`, and JSON/YAML cannot
 * express one — so on the JSON face a hand-written `pattern` is rejected BY
 * NAME with guidance toward the metadata route (`FieldSchema.pattern`, a
 * string the field pipeline compiles via `new RegExp(...)` in
 * `buildValidationRules`, `@object-ui/fields`, before it reaches this shape).
 * Deliberately NOT a string→RegExp coercion here — consumer-side tolerance
 * would re-open exactly what #5099 closed (AGENTS.md #0.1).
 */
export const FieldConstraintsSchema = z.object({
  required: z.union([z.boolean(), z.string()]).optional()
    .describe('Required rule — boolean flag, or the error message itself (string implies required)'),
  minLength: BoundedRuleSchema('Minimum length').optional().describe('Minimum length rule'),
  maxLength: BoundedRuleSchema('Maximum length').optional().describe('Maximum length rule'),
  min: BoundedRuleSchema('Minimum value').optional().describe('Minimum value rule (numbers)'),
  max: BoundedRuleSchema('Maximum value').optional().describe('Maximum value rule (numbers)'),
  pattern: z.object({
    value: z.custom<RegExp>((v) => v instanceof RegExp, {
      message:
        'pattern.value must be a compiled RegExp — react-hook-form runs `pattern` only when ' +
        'value instanceof RegExp, and JSON/YAML metadata cannot express one (objectui#5099). ' +
        'Declare the pattern on the field metadata route instead: `FieldSchema.pattern` (a ' +
        'string), which is compiled before it reaches this shape.',
    }).describe('Compiled RegExp — never a string; JSON authors use FieldSchema.pattern'),
    message: z.string().describe('Error message shown when the pattern fails'),
  }).optional().describe('Pattern rule (RegExp value + message)'),
  // RUNTIME SLOT (objectui#7759 group E, the objectui#6124 shape): the form
  // renderer spreads `validation` into react-hook-form's `rules` and keeps a
  // field-authored `validate` function running beside its own `required`
  // entry, so the TypeScript member keeps its function type. JSON authors use
  // the declarative rules above; the mirror refuses this key by name.
  validate: handlerKeyRefusal('validate', 'runtime-slot', 'Custom validation function'),
});

/**
 * Field Condition Schema
 */
export const FieldConditionSchema = z.object({
  field: z.string().describe('Field name to check'),
  equals: z.any().optional().describe('Value must equal'),
  notEquals: z.any().optional().describe('Value must not equal'),
  in: z.array(z.any()).optional().describe('Value must be in array'),
  // RETIRED (objectui#7759 group E, the objectui#6124 shape): nothing reads it.
  // The form renderer translates `condition` to CEL through
  // `legacyConditionToCel`, which reads `field` / `equals` / `notEquals` / `in`
  // and never `custom`, so an authored function was inert. Refused by name; the
  // TypeScript member is a `?: never` tombstone.
  custom: handlerKeyRefusal('custom', 'retired', 'Custom condition function'),
});

/**
 * Button Schema - Button component
 */
export const ButtonSchema = BaseSchema.extend({
  type: z.literal('button'),
  label: z.string().optional().describe('Button text label'),
  variant: z.enum(['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'])
    .optional()
    .describe('Button variant/style'),
  size: z.enum(['default', 'sm', 'lg', 'icon'])
    .optional()
    .describe('Button size'),
  loading: z.boolean().optional().describe('Whether button is in loading state'),
  icon: z.string().optional().describe('Icon to display (lucide-react icon name)'),
  iconPosition: z.enum(['left', 'right']).optional().describe('Icon position'),
  onClick: handlerKeyRefusal('onClick', 'runtime-slot', 'Click handler'),
  buttonType: z.enum(['button', 'submit', 'reset'])
    .optional()
    .describe('Button type'),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional(),
});

/**
 * objectui#9256 (`input` slice): ONE refusal string for both content channels
 * of {@link InputSchema}. The `email` / `password` arm below
 * ({@link InputShorthandSchema}) inherits this pair through its `.omit()` and
 * overrides it with its own string, which names that node and its route.
 */
const INPUT_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'input',
  '`ui:input` is the only registration claiming the bare key, and it hands the node to the `input` renderer, which reads it as `InputSchema`',
  'one input field — `label`, `placeholder`, `inputType`, `value` / `defaultValue`, `description`, `error`, `required`',
);

/**
 * Input Schema - Text input component
 */
export const InputSchema = BaseSchema.extend({
  type: z.literal('input'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('Input label'),
  placeholder: z.string().optional().describe('Placeholder text'),
  inputType: z.enum([
    'text', 'email', 'password', 'number', 'tel', 'url', 'search',
    'date', 'time', 'datetime-local',
  ])
    .optional()
    .describe('Input type'),
  defaultValue: z.union([z.string(), z.number()]).optional().describe('Default value'),
  value: z.union([z.string(), z.number()]).optional().describe('Controlled value'),
  required: z.boolean().optional().describe('Whether field is required'),
  readOnly: z.boolean().optional().describe('Whether field is read-only'),
  description: z.string().optional().describe('Help text'),
  error: z.string().optional().describe('Error message'),
  onChange: handlerKeyRefusal('onChange', 'runtime-slot', 'Change handler'),
  // `renderers/form/input.tsx` reads it onto the wrapper element —
  // `cn("grid w-full items-center gap-1.5", schema.wrapperClass)` — and the TS
  // face has declared it all along; the mirror had not, so a wrong-typed value
  // rode through `.passthrough()` unexamined while all eight sibling readers
  // refused it at the key (`c974edf14`).
  wrapperClass: z.string().optional()
    .describe('Classes on the wrapper div around the input and its label'),
  min: z.number().optional().describe('Minimum value (for number type)'),
  max: z.number().optional().describe('Maximum value (for number type)'),
  step: z.number().optional().describe('Step value (for number type)'),
  maxLength: z.number().optional().describe('Maximum length'),
  pattern: z.string().optional().describe('Validation pattern'),
  // objectui#9256 (`input` slice): the renderer reads NEITHER content channel, so both are
  // refused by name here as on the TypeScript twin, each kept a MEMBER. `body` was already
  // refused by `BaseSchema` (objectui#6771), whose message names `children` as the remedy.
  body: retirementTombstone(INPUT_NEITHER_CHANNEL),
  children: retirementTombstone(INPUT_NEITHER_CHANNEL),
});

/**
 * Textarea Schema - Multi-line text input
 */
export const TextareaSchema = BaseSchema.extend({
  type: z.literal('textarea'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('Textarea label'),
  placeholder: z.string().optional().describe('Placeholder text'),
  defaultValue: z.string().optional().describe('Default value'),
  value: z.string().optional().describe('Controlled value'),
  rows: z.number().optional().describe('Number of visible rows'),
  required: z.boolean().optional().describe('Whether field is required'),
  readOnly: z.boolean().optional().describe('Whether field is read-only'),
  description: z.string().optional().describe('Help text'),
  error: z.string().optional().describe('Error message'),
  wrapperClass: z.string().optional()
    .describe('Classes on the wrapper div around the textarea and its label (objectui#7722)'),
  onChange: handlerKeyRefusal('onChange', 'runtime-slot', 'Change handler'),
  maxLength: z.number().optional().describe('Maximum length'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `textarea` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `id`, `label`, `name`, `placeholder`, `readOnly`, '
    + '`required`, `rows`, `value`, `wrapperClass`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `textarea` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `id`, `label`, `name`, `placeholder`, `readOnly`, '
    + '`required`, `rows`, `value`, `wrapperClass`.',
  ),
});

/**
 * Select Schema - Select/dropdown component
 */
export const SelectSchema = BaseSchema.extend({
  type: z.literal('select'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('Select label'),
  placeholder: z.string().optional().describe('Placeholder text'),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Default value'),
  value: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Controlled value'),
  options: z.array(SelectOptionSchema).describe('Select options'),
  required: z.boolean().optional().describe('Whether field is required'),
  description: z.string().optional().describe('Help text'),
  error: z.string().optional().describe('Error message'),
  wrapperClass: z.string().optional()
    .describe('Classes on the wrapper div around the trigger and its label (objectui#7722)'),
  onChange: handlerKeyRefusal('onChange', 'runtime-slot', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `select` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `label`, `name`, `options`, `placeholder`, `required`, '
    + '`value`, `wrapperClass`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `select` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `label`, `name`, `options`, `placeholder`, `required`, '
    + '`value`, `wrapperClass`.',
  ),
});

/**
 * Checkbox Schema - Checkbox component
 */
export const CheckboxSchema = BaseSchema.extend({
  type: z.literal('checkbox'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('Checkbox label'),
  defaultChecked: z.boolean().optional().describe('Default checked state'),
  checked: z.boolean().optional().describe('Controlled checked state'),
  required: z.boolean().optional()
    .describe("Required affordance — sets `required` on the Radix Checkbox and gates the label's `*` marker (objectui#6150)"),
  wrapperClass: z.string().optional()
    .describe('Classes on the wrapper div around the box and its label'),
  description: z.string().optional().describe('Help text'),
  error: z.string().optional().describe('Error message'),
  onChange: handlerKeyRefusal('onChange', 'runtime-slot', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `checkbox` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `checked`, `defaultChecked`, `id`, `label`, `name`, `required`, '
    + '`wrapperClass`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `checkbox` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `checked`, `defaultChecked`, `id`, `label`, `name`, `required`, '
    + '`wrapperClass`.',
  ),
});

/**
 * Radio Group Schema - Radio button group
 */
export const RadioGroupSchema = BaseSchema.extend({
  type: z.literal('radio-group'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('Radio group label'),
  defaultValue: z.union([z.string(), z.number()]).optional().describe('Default value'),
  value: z.union([z.string(), z.number()]).optional().describe('Controlled value'),
  options: z.array(RadioOptionSchema).describe('Radio options'),
  orientation: z.enum(['horizontal', 'vertical']).optional().describe('Layout orientation'),
  description: z.string().optional().describe('Help text'),
  error: z.string().optional().describe('Error message'),
  onChange: handlerKeyRefusal('onChange', 'retired', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `radio-group` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `id`, `options`, `orientation`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `radio-group` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `id`, `options`, `orientation`.',
  ),
});

/**
 * Switch Schema - Toggle switch component
 */
export const SwitchSchema = BaseSchema.extend({
  type: z.literal('switch'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('Switch label'),
  defaultChecked: z.boolean().optional().describe('Default checked state'),
  checked: z.boolean().optional().describe('Controlled checked state'),
  description: z.string().optional().describe('Help text'),
  wrapperClass: z.string().optional()
    .describe("Classes on the wrapper div around the switch and its label (objectui#7722)"),
  onChange: handlerKeyRefusal('onChange', 'retired', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `switch` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `id`, `label`, `wrapperClass`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `switch` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `id`, `label`, `wrapperClass`.',
  ),
});

/**
 * Toggle Schema - Toggle button component
 */
export const ToggleSchema = BaseSchema.extend({
  type: z.literal('toggle'),
  label: z.string().optional().describe('Toggle label'),
  defaultPressed: z.boolean().optional().describe('Default pressed state'),
  pressed: z.boolean().optional().describe('Controlled pressed state'),
  variant: z.enum(['default', 'outline']).optional().describe('Toggle variant'),
  size: z.enum(['default', 'sm', 'lg']).optional().describe('Toggle size'),
  onChange: handlerKeyRefusal('onChange', 'retired', 'Change handler'),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional(),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this toggle node',
    '`toggle` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/form/toggle.tsx`). '
    + '`body` is the child-list spelling objectui#6771 retired — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/**
 * Slider Schema - Range slider component
 */
export const SliderSchema = BaseSchema.extend({
  type: z.literal('slider'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('Slider label'),
  defaultValue: z.union([z.number(), z.array(z.number())]).optional()
    .describe('Default value(s) — a single number or one per thumb; the renderer wraps a scalar into a list'),
  value: retirementTombstone(
    'REFUSED (objectui#10280, ADR-0049) — `slider` has no read site for `value`: the renderer reads '
    + '`defaultValue`, `max`, `min`, `step` off the node, and the form-control DOM whitelist drops `value` '
    + 'from the props it spreads, so an authored value rendered NOTHING. Author `defaultValue` for the '
    + 'initial position.',
  ),
  min: z.number().optional().describe('Minimum value'),
  max: z.number().optional().describe('Maximum value'),
  step: z.number().optional().describe('Step value'),
  description: z.string().optional().describe('Help text'),
  onChange: handlerKeyRefusal('onChange', 'retired', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `slider` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `max`, `min`, `step`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `slider` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `max`, `min`, `step`.',
  ),
});

/**
 * File Upload Schema - File upload component
 */
export const FileUploadSchema = BaseSchema.extend({
  type: z.literal('file-upload'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('Upload label'),
  buttonText: z.string().optional()
    .describe('Drop-zone label; falls back to "DROP PAYLOAD OR CLICK TO UPLOAD" when unset (objectui#6150)'),
  wrapperClass: z.string().optional()
    .describe('Outer wrapper classes, appended to the renderer\'s own grid classes (objectui#6150)'),
  accept: z.string().optional().describe('Accepted file types'),
  multiple: z.boolean().optional().describe('Allow multiple files'),
  maxSize: z.number().optional().describe('Maximum file size (bytes)'),
  maxFiles: z.number().optional().describe('Maximum number of files'),
  description: z.string().optional().describe('Help text'),
  error: z.string().optional().describe('Error message'),
  onChange: handlerKeyRefusal('onChange', 'runtime-slot', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `file-upload` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `accept`, `buttonText`, `id`, `label`, `multiple`, `wrapperClass`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `file-upload` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `accept`, `buttonText`, `id`, `label`, `multiple`, `wrapperClass`.',
  ),
});

/**
 * Date Picker Schema - Date picker component
 */
export const DatePickerSchema = BaseSchema.extend({
  type: z.literal('date-picker'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('Date picker label'),
  placeholder: z.string().optional().describe('Placeholder text'),
  defaultValue: z.union([z.string(), z.date()]).optional().describe('Default value'),
  value: z.union([z.string(), z.date()]).optional().describe('Controlled value'),
  minDate: z.union([z.string(), z.date()]).optional().describe('Minimum date'),
  maxDate: z.union([z.string(), z.date()]).optional().describe('Maximum date'),
  format: z.string().optional().describe('Date format string'),
  description: z.string().optional().describe('Help text'),
  error: z.string().optional().describe('Error message'),
  wrapperClass: z.string().optional()
    .describe("Classes on the wrapper div around the popover trigger and its label (objectui#7722)"),
  onChange: handlerKeyRefusal('onChange', 'runtime-slot', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `date-picker` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `format`, `id`, `label`, `placeholder`, `wrapperClass`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `date-picker` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `format`, `id`, `label`, `placeholder`, `wrapperClass`.',
  ),
});

// objectui#10293: one calendar day. The string arm is the JSON authoring
// type, an ISO 8601 date string, which the `calendar` renderer coerces to a
// `Date`. The `z.date()` arm stays for in-process callers, as on
// `DatePickerSchema`.
const CalendarDaySchema = z.union([z.string(), z.date()]);

// objectui#10304: the `{ from, to }` pair `mode: 'range'` reads. Strict, so a
// misspelled bound (`start` / `end`) is refused instead of selecting nothing.
const CalendarDayRangeSchema = z.strictObject({
  from: CalendarDaySchema,
  to: CalendarDaySchema.optional(),
});

// objectui#10304: every selection shape the date picker reads. WHICH one a node
// may carry is decided by its `mode`, and `calendarSelectionFitsMode` below
// holds that pairing; this union alone is the key-level set.
// objectui#11073: the strict range arm is closed where it meets this union (see
// `closeStrictUnionArms` in `./node-derivation.ts`).
const CalendarSelectionSchema = z.union(closeStrictUnionArms([
  CalendarDaySchema,
  z.array(CalendarDaySchema),
  CalendarDayRangeSchema,
] as const));

/**
 * objectui#10304 — a selection must have the shape its `mode` reads.
 *
 * The date picker reads one day in `single` mode (the default), a LIST in
 * `multiple` mode and `{ from, to }` in `range` mode. A document whose value
 * does not fit crashed the node (`multiple` given one day threw inside the
 * picker) or selected nothing without a word (`range` given anything but a
 * pair). The pairing spans two keys, so it is a refinement on the node rather
 * than a type on either key.
 */
const calendarSelectionFitsMode = (
  node: { mode?: 'single' | 'multiple' | 'range'; value?: unknown; defaultValue?: unknown },
  ctx: z.RefinementCtx,
): void => {
  const mode = node.mode ?? 'single';
  for (const key of ['value', 'defaultValue'] as const) {
    const selection = node[key];
    if (selection === undefined) continue;
    const isList = Array.isArray(selection);
    const isRange = !isList && typeof selection === 'object' && !(selection instanceof Date);
    const fits = mode === 'multiple' ? isList : mode === 'range' ? isRange : !isList && !isRange;
    if (fits) continue;
    const expected = mode === 'multiple'
      ? 'a list of days (ISO 8601 date strings)'
      : mode === 'range'
        ? 'a `{ from, to }` range of days (ISO 8601 date strings)'
        : 'one day (an ISO 8601 date string)';
    ctx.addIssue({
      code: 'custom',
      path: [key],
      message: `\`${key}\` does not fit \`mode: '${mode}'\`, which selects ${expected} (objectui#10304)`,
    });
  }
};

/**
 * Calendar key set, shared by {@link CalendarSchema} and
 * {@link UiCalendarSchema}. Unexported: each public schema adds the
 * mode/selection refinement itself, because zod refuses to `.extend()` an
 * object that already carries one.
 */
const CalendarObjectSchema = BaseSchema.extend({
  type: z.literal('calendar'),
  defaultValue: CalendarSelectionSchema.optional()
    .describe("Default selection: one ISO 8601 day, a list of days for mode 'multiple', or { from, to } for mode 'range'"),
  value: CalendarSelectionSchema.optional()
    .describe("Controlled selection: one ISO 8601 day, a list of days for mode 'multiple', or { from, to } for mode 'range'"),
  mode: z.enum(['single', 'multiple', 'range']).optional().describe('Selection mode'),
  minDate: z.union([z.string(), z.date()]).optional().describe('Minimum date'),
  maxDate: z.union([z.string(), z.date()]).optional().describe('Maximum date'),
  onChange: handlerKeyRefusal('onChange', 'retired', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `calendar` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `mode`, `value`. '
    + 'Both readers answer NEITHER: the bare key resolves to plugin-calendar’s calendar VIEW, and this '
    + 'key set describes the `ui:calendar` date-picker primitive. This refusal propagates onto '
    + '`UiCalendarSchema` on both faces: the mirror `.extend()`s this one, and the TypeScript face '
    + 'inherits this declaration through an index-signature-safe `Omit` (objectui#9256). '
    + '`view:calendar` is the measured SOLE owner of the bare `calendar` key (`ui:calendar` passes `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `calendar` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `mode`, `value`. '
    + 'Both readers answer NEITHER: the bare key resolves to plugin-calendar’s calendar VIEW, and this '
    + 'key set describes the `ui:calendar` date-picker primitive. This refusal propagates onto '
    + '`UiCalendarSchema` on both faces: the mirror `.extend()`s this one, and the TypeScript face '
    + 'inherits this declaration through an index-signature-safe `Omit` (objectui#9256). '
    + '`view:calendar` is the measured SOLE owner of the bare `calendar` key (`ui:calendar` passes `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
});

/**
 * Calendar Schema - Calendar component
 */
export const CalendarSchema = CalendarObjectSchema.superRefine(calendarSelectionFitsMode);

/**
 * Input OTP Schema - One-time password input
 */
export const InputOTPSchema = BaseSchema.extend({
  type: z.literal('input-otp'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('OTP input label'),
  length: z.number().optional().describe('Number of OTP digits'),
  separator: z
    .boolean()
    .optional()
    .describe('Draw a visual separator between two halves of the slots (objectui#11365)'),
  defaultValue: z.string().optional().describe('Default value'),
  value: z.string().optional().describe('Controlled value'),
  description: z.string().optional().describe('Help text'),
  error: z.string().optional().describe('Error message'),
  onChange: handlerKeyRefusal('onChange', 'runtime-slot', 'Change handler'),
  onComplete: handlerKeyRefusal('onComplete', 'retired', 'Complete handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `input-otp` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `length`, `separator`, `value`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `input-otp` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `length`, `separator`, `value`.',
  ),
});

/**
 * Combobox Schema - Searchable select component
 */
export const ComboboxSchema = BaseSchema.extend({
  type: z.literal('combobox'),
  name: z.string().optional().describe('Field name for form submission'),
  label: z.string().optional().describe('Combobox label'),
  placeholder: z.string().optional().describe('Placeholder text'),
  options: z.array(ComboboxOptionSchema).optional().describe('Combobox options'),
  defaultValue: retirementTombstone(
    'Default value — RETIRED (objectui#8140, ADR-0049). Write `value` instead. `combobox` is a ' +
      'standalone node type only: it is not a built-in form field type and no `field:combobox` ' +
      'widget exists, so a form field authored `type: "combobox"` never reaches this renderer, ' +
      'and on the node path the selection is frozen — the renderer passes no change handler and ' +
      'the DOM pass-through forwards none, so an option cannot be selected. On a control whose ' +
      'selection cannot change, a default value and a value are the same thing, and this key ' +
      'could only ever have been a second spelling of `value`.',
  ),
  value: z.string().optional().describe('Controlled value'),
  description: z
    .string()
    .optional()
    .describe(
      'Help text — rendered as a paragraph below the control and tied to the trigger with ' +
        '`aria-describedby`, so assistive tech announces it with the field (objectui#8140).',
    ),
  error: z.string().optional().describe('Error message'),
  onChange: handlerKeyRefusal('onChange', 'retired', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `combobox` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `description`, `options`, `placeholder`, `value`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `combobox` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `description`, `options`, `placeholder`, `value`.',
  ),
});

/**
 * Label Schema - Form label component
 */
export const LabelSchema = BaseSchema.extend({
  type: z.literal('label'),
  text: z.string().optional().describe('Label text'),
  label: z.string().optional().describe('Label text (alternative)'),
  // objectui#6152 round 4 — a THIRD spelling of the label's text, retired on both faces
  // (the TypeScript twin is `content?: never`) and dropped from the renderer's read.
  // A tombstone, not a deletion: `BaseSchema` is `.passthrough()`, so a deleted arm
  // would KEEP an authored value in silence.
  content: retirementTombstone(
    'RETIRED (objectui#6152, ADR-0049) — `content` was a third spelling of the label text, and the '
    + '`label` renderer no longer reads it. Write the text as `text` (or `label`) instead.',
  ),
  htmlFor: z.string().optional().describe('Associated input ID'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `label` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `label`, `text`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `label` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `label`, `text`.',
  ),
});

/**
 * Command Schema - Command palette component
 */
export const CommandSchema = BaseSchema.extend({
  type: z.literal('command'),
  placeholder: z.string().optional().describe('Search placeholder'),
  emptyText: z.string().optional().describe('Empty state text'),
  groups: z.array(CommandGroupSchema).optional().describe('Command groups'),
  onChange: handlerKeyRefusal('onChange', 'retired', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `command` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `emptyText`, `groups`, `placeholder`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `command` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `emptyText`, `groups`, `placeholder`.',
  ),
});

/**
 * Form Field Schema — the RUNTIME form-field vocabulary (`name` = data path,
 * `type` = widget). This is deliberately NOT the spec's `FormFieldSchema`
 * (`field` = object-field reference, presentation deltas only): the two are
 * different layers, and `normalizeSectionField` in `@object-ui/plugin-form` is
 * the translation chokepoint between them (#3090).
 *
 * Keys mirror the AUTHORABLE surface of the `FormField` interface in
 * `../form.ts` — not every key that interface declares. `FormField.field` (the
 * resolved object-field metadata stash) is runtime-only and stays OUT of this
 * schema on purpose: in the authored vocabulary that same key name carries a
 * different meaning — a string naming the referenced object field — so
 * validating it here would re-open the pun #3090 closed (objectui#6609).
 *
 * Until #3090 this schema validated only 13 of the interface's declared keys
 * and *required* `type` (the interface says optional) — so `objectui validate`
 * silently ignored typos in `visibleWhen`/`widget`/`dependsOn`/… (strip mode)
 * and rejected metadata the renderer accepts. The pinned key list lives in
 * `__tests__/form-field-zod-coverage.test.ts`.
 */
/**
 * The ONE namespace a form field's widget id may name — objectui#5254,
 * maintainer ruling of 2026-08-19, made an authoring-time ERROR by
 * objectui#5375.
 *
 * ## What this refuses, and why it is an error rather than a warning
 *
 * A colon-qualified form-field widget id that does not name `field:`. Measured
 * on the real `form` renderer on the built-in path (no `registerAllFields()`):
 *
 *   type            registry hit   rendered type
 *   ui:password     TRUE           text
 *   secret          false          text
 *   field:secret    false          text
 *
 * `ui:password` **is** registered — as an SDUI node renderer for a top-level
 * `{ type: 'email' }`-style node — so an author who checks whether it resolves
 * gets a YES, and still gets a clear-text box on the field path. Refusing the
 * NAMESPACE closes that class instead of today's spellings, and it is an error
 * rather than a warning because a warning IS the silent degrade the rule
 * exists to kill, in a new spelling.
 *
 * `field:` passes whether or not the widget is registered: registration is a
 * RUNTIME fact (`registerAllFields()`, a lazily loaded plugin) that no
 * authoring-time validator can see, and the renderer already answers an
 * unregistered `field:` id with a visible refusal (objectui#5322). A BARE name
 * passes too — it is an open set, every registered `field:<name>` widget being
 * reachable by its short name. What is decidable statically is the namespace,
 * and it is a CLOSED set of one.
 *
 * ## Why the rule is stated twice, and what pins the copies together
 *
 * `validateFieldWidgetNamespace` in `@object-ui/core`
 * (`packages/core/src/validation/schema-validator.ts`) enforces the same rule
 * for `validateSchema`/`assertValidSchema`. This module cannot delegate to it:
 * `@object-ui/core` depends on `@object-ui/types`, so importing back would be
 * a cycle, and this package is declared "Zero deps. No React." The rule is
 * pure string logic, so the second statement costs nothing but drift — and
 * `__tests__/form-field-widget-namespace.test.ts` pins it case-for-case
 * against the table above, in the same rows core's own test uses.
 *
 * Until objectui#5449 only core enforced it, so `objectui validate` — the
 * surface an author actually runs before shipping, reaching this schema
 * through `safeValidateSchema` — returned a green tick on a document the
 * runtime rejects. Having done exactly the diligence objectui#5375 asks for,
 * the author shipped the bad metadata anyway.
 *
 * This is deliberately NOT an answer to "which validator is canonical"
 * (objectui#5449, objectui#4631): a third hand-rolled implementation lives in
 * `packages/vscode-extension/src/providers/SchemaValidator.ts`, and whether
 * the end state is one canonical validator or a contract the others defer to
 * is a maintainer architecture call. Closing the authoring-time gap is not,
 * and is all that happens here.
 */
const FIELD_WIDGET_NAMESPACE = 'field:';

/**
 * The two keys of an AUTHORED form field that can carry a widget id.
 *
 * Both are `unknown` rather than `string` because this narrowing has to be
 * done by the check itself: the refinement below also runs against values that
 * only reached it because the surrounding parse has not failed yet.
 */
interface AuthoredFieldWidgetKeys {
  type?: unknown;
  widget?: unknown;
}

/**
 * The widget id a form field will actually be RENDERED as.
 *
 * Mirrors the renderer's own precedence (`resolvedType` in
 * `packages/components/src/renderers/form/form.tsx`: explicit form-config
 * `widget`, then the resolved field metadata's widget hint, then the bare
 * `type`) and core's `resolveAuthoredFieldWidgetId`. Only the two keys an
 * AUTHORED schema carries are read here — the metadata widget hint is a
 * RESOLVED object that a hand-authored standalone form does not have.
 *
 * The mirroring is the point, not a convenience: a validator that disagrees
 * with the renderer about which component will actually render is how the
 * clear-text box got shipped in the first place.
 */
function resolveAuthoredFieldWidgetId(
  field: AuthoredFieldWidgetKeys,
): string | undefined {
  const id = field.widget ?? field.type;
  return typeof id === 'string' ? id : undefined;
}

/**
 * The refusal message for an unresolvable namespaced field widget id.
 *
 * Held identical to `@object-ui/core`'s wording on purpose: the two entry
 * points must not be able to describe the same defect differently, or an
 * author who saw one and then the other has to work out whether they are the
 * same finding.
 */
function unresolvableFieldWidgetNamespaceMessage(id: string): string {
  return (
    `'${id}' is not a form field widget: a namespaced field widget id must name the ` +
    `\`field:\` namespace (objectui#5254), so this id resolves NOTHING on the field path ` +
    `and the renderer would fall through to a plain text box — putting a secret on screen ` +
    `in clear text when the field holds one (objectui#5375). Write the built-in spelling ` +
    `(e.g. \`password\`), or the field widget id \`field:${id.slice(id.indexOf(':') + 1)}\`. ` +
    `Resolving in the registry is not proof it resolves HERE — \`ui:password\` is a ` +
    `registered SDUI node renderer and still renders clear text as a field.`
  );
}

/**
 * The alias refusal for one of the `grid` widget's retired snake_case
 * field-level keys (objectui#11610), on `FormFieldSchema`: the
 * {@link aliasKeyRefusal} lead sentence names the camelCase key the entry
 * should carry, read from `GRID_FIELD_RETIRED_KEYS`, so the arm, the TS twin's
 * `?: never` tombstone and the `grid` widget's refusal name the same
 * replacement. The value an author wrote is valid under the new key as it
 * stands; only the key changes.
 */
function retiredGridFieldKey(alias: GridFieldRetiredKey) {
  const canonical = GRID_FIELD_RETIRED_KEYS[alias];
  return aliasKeyRefusal(
    alias,
    canonical,
    'this form field',
    `The \`grid\` widget's field-level keys are camelCase since objectui#11610, and no reader reads the `
    + `snake_case spelling, so it is refused here by name rather than stripped. Rename the key to \`${canonical}\`; `
    + 'its value stays the same.',
  );
}

/**
 * The refusal of `scale` on a `currency` form field (objectui#11070 round 13).
 *
 * `FormFieldSchema.scale` is the spec's `FieldSchema.scale` by reference, but a
 * member taken off `.shape` does not bring the spec's cross-key rules with it,
 * and the spec refuses this key on exactly one field type: `currency`
 * (objectstack-ai/objectstack#19629, ruling B — a currency amount's decimal
 * places are its currency's). The `currency` widget does not read `scale`, so
 * the key would be accepted here and do nothing. So this one rule is carried,
 * keyed on `type` as the spec keys it, with the spec's own wording: the spec
 * exports neither the rule nor its text, so the text is held identical here and
 * `strict-face-read-keys-11070.test.ts` pins it equal to the spec's issue for the
 * same entry. The spec's other cross-key rules (`rows`, `minLength` /
 * `maxLength`, `multiple`) are not carried: they key on the spec's field-type
 * sets, and this face's `type` is a widget id (`input`, `select`, …) the spec
 * does not know.
 */
const CURRENCY_FIELD_SCALE_REFUSAL =
  '`scale` is not valid on a `currency` field — delete the key. A currency amount\'s decimal '
  + 'places are its currency\'s, not a field setting: the currency\'s ISO 4217 minor unit (2 for '
  + 'USD, 0 for JPY, 3 for KWD) decides how the amount displays, and the field\'s write allowance '
  + 'stays unconstrained — a currency write is accepted with the decimals it carries, as it always '
  + 'was on a currency field that declared no `scale`. The key\'s one enforced effect was refusing '
  + 'writes with more decimals, which this field type no longer does.';

export const FormFieldSchema = z.object({
  id: z.string().optional().describe('Field ID'),
  name: z.string().describe('Field name (form data path)'),
  label: z.string().optional().describe('Field label'),
  description: z.string().optional().describe('Field description'),
  type: z.string().optional().describe('Widget type (defaults per renderer when omitted)'),
  inputType: z.string().optional().describe('Input type'),
  required: z.boolean().optional().describe('Required flag'),
  disabled: z.boolean().optional().describe('Disabled flag'),
  placeholder: z.string().optional().describe('Placeholder text'),
  options: z.array(SelectOptionSchema).optional().describe('Options for select/radio'),
  validation: FieldConstraintsSchema.optional().describe('Validation rules'),
  condition: FieldConditionSchema.optional().describe('Conditional display (legacy)'),
  widget: z.string().optional().describe('Custom widget/component name override'),
  dependsOn: z.union([
    z.string(),
    z.array(z.union([
      z.string(),
      z.object({ field: z.string(), param: z.string().optional() }),
    ])),
  ]).nullish().describe('Parent field(s) for cascading/dependent fields'),
  hidden: z.boolean().optional().describe('Whether the field is hidden'),
  readonly: z.boolean().optional().describe('Whether the field is read-only'),
  // The form view's gate, refused blank at authoring as the spec's form view
  // field refuses it (objectui#11262, ADR-0137 D1) — see
  // `FieldRulePredicateWireSchema`.
  visibleOn: FieldRulePredicateWireSchema.optional()
    .describe('View-level visibility predicate (CEL) — ANDed with visibleWhen'),
  visibleWhen: FieldRulePredicateWireSchema.optional()
    .describe('Field-level visibility rule (CEL) — field shown only when TRUE'),
  readonlyWhen: FieldRulePredicateWireSchema.optional()
    .describe('Field-level read-only rule (CEL)'),
  requiredWhen: FieldRulePredicateWireSchema.optional()
    .describe('Field-level required rule (CEL)'),
  colSpan: z.number().optional().describe('Column span in grid layout (legacy — prefer span)'),
  span: z.enum(['auto', 'full']).optional().describe('Relative field width'),
  fields: z.array(z.string()).optional()
    .describe('Section grouping claim (objectui#6236) — section-divider rows only: names of the fields the section claims (the FormFieldTab.fields membership shape); the divider predicate then gates the whole group'),
  // objectui#13055 — the fault direction of a section-divider row's predicate,
  // mirrored from `FormField.visibleWhenFault` (the reasoning is on the TS twin).
  visibleWhenFault: z.enum(['hidden', 'shown']).optional()
    .describe("Section-divider rows only: what a visibleWhen that cannot be evaluated does to the section — 'hidden' hides heading and claimed fields (a field group's fail-closed predicate); 'shown' or absent keeps the fail-open default"),
  // objectui#11070 — field metadata a hand-authored form writes on the entry
  // itself, which the renderer hands to each field widget as its metadata
  // carrier. Every member but `pattern` is the spec's `FieldSchema` member BY
  // REFERENCE (values, checks and `.describe()` text included), so it cannot
  // drift from the key the widgets were written against. The reads, and the
  // read keys deliberately NOT declared, are reasoned on the TS twin.
  multiple: stripImportedDefaults(SpecFieldSchema).shape.multiple,
  rows: stripImportedDefaults(SpecFieldSchema).shape.rows,
  accept: stripImportedDefaults(SpecFieldSchema).shape.accept,
  dimensions: stripImportedDefaults(SpecFieldSchema).shape.dimensions,
  // The spec spelling of a lookup / user field's target object, and the only
  // one the widgets read; the retired `reference_to` is read by nothing and
  // stays undeclared (objectui#11070).
  reference: stripImportedDefaults(SpecFieldSchema).shape.reference,
  min: stripImportedDefaults(SpecFieldSchema).shape.min,
  max: stripImportedDefaults(SpecFieldSchema).shape.max,
  // objectui#11070 round 13 — the decimal places the `number`, `percent`,
  // `formula` and `summary` widgets read, and the fixed-currency declaration
  // the `currency` widget reads through `resolveFieldCurrency`. The spec's
  // `FieldSchema` refuses `scale` on a `currency` field; the superRefine
  // below carries that one rule (`CURRENCY_FIELD_SCALE_REFUSAL`).
  scale: stripImportedDefaults(SpecFieldSchema).shape.scale,
  currencyConfig: stripImportedDefaults(SpecFieldSchema).shape.currencyConfig,
  minLength: stripImportedDefaults(SpecFieldSchema).shape.minLength,
  maxLength: stripImportedDefaults(SpecFieldSchema).shape.maxLength,
  pattern: z.string().optional()
    .describe('Regular expression the value must match, as a string (JSON has no RegExp) — the built-in input branch puts it on the native control as `pattern`; the field-level spelling the `validation.pattern` refusal directs JSON authors to'),
  // The spec spellings the `formula` and `summary` widgets read; their
  // snake_case forms (`return_type`, `summary_type`, `summary_object`,
  // `summary_field`) are retired and stay undeclared (objectui#11070).
  returnType: stripImportedDefaults(SpecFieldSchema).shape.returnType,
  summaryOperations: stripImportedDefaults(SpecFieldSchema).shape.summaryOperations,
  // The `grid` widget's columns: the spec's `inlineColumns` list (its strict,
  // `name`-keyed inline grid column), by reference. objectui's `grid` field
  // type spells the list `columns` (objectui#11070).
  columns: stripImportedDefaults(SpecFieldSchema).shape.inlineColumns,
  // objectui#11070 round 10 — the `grid` widget's field-level keys, which it
  // reads off a `fields[]` entry of `type: 'grid'` (its metadata carrier). They
  // are `GridFieldMetadata`'s members, which the TS twin carries by reference;
  // `@objectstack/spec` declares none of them (a `grid` field is objectui's own
  // type), so each value schema here is the TS member's own type, stated once.
  // objectui#11610 renamed all eight from snake_case to camelCase.
  minRows: z.number().optional()
    .describe('Minimum row count of a `grid` field; read only by the `grid` widget'),
  maxRows: z.number().optional()
    .describe('Maximum row count of a `grid` field; read only by the `grid` widget'),
  allowAdd: z.boolean().optional()
    .describe('Whether a `grid` field offers Add (on unless false); read only by the `grid` widget'),
  allowDelete: z.boolean().optional()
    .describe('Whether a `grid` field offers Delete (on unless false); read only by the `grid` widget'),
  allowReorder: z.boolean().optional()
    .describe('Whether a `grid` field\'s rows can be drag-reordered (on unless false); read only by the `grid` widget'),
  totalField: z.string().optional()
    .describe('Name of the CHILD column a `grid` field sums into its footer total; read only by the `grid` widget'),
  addLabel: z.string().optional()
    .describe('Label of a `grid` field\'s Add button; read only by the `grid` widget'),
  sortField: z.string().optional()
    .describe('Name of the row field a `grid` field stamps with each row\'s index, so a drag-reorder persists; read only by the `grid` widget'),
  // objectui#11610 — the eight retired snake_case spellings, each REFUSED BY
  // NAME with the camelCase key to write instead (the TS twin's `?: never`
  // tombstones). One list feeds both the arms and the `grid` widget's own
  // refusal: `GRID_FIELD_RETIRED_KEYS`.
  min_rows: retiredGridFieldKey('min_rows'),
  max_rows: retiredGridFieldKey('max_rows'),
  allow_add: retiredGridFieldKey('allow_add'),
  allow_delete: retiredGridFieldKey('allow_delete'),
  allow_reorder: retiredGridFieldKey('allow_reorder'),
  total_field: retiredGridFieldKey('total_field'),
  add_label: retiredGridFieldKey('add_label'),
  sort_field: retiredGridFieldKey('sort_field'),
  // objectui#12130 — the rest of the field metadata the channel reads off the
  // entry, measured at runtime (the census and effects pins under
  // `examples/schema-catalog/test/`). The spec's `FieldSchema` members by
  // reference (`step` among them, so HTML's `'any'` is refused); `idField` /
  // `picker` / `subtitle` stated once as the TS twin declares them (the entry
  // is their declaring face since objectui#12242 moved them off the field
  // metadata types); `capture`, `crop`, `defaultName`, `avatarField` and
  // `className` typed as they are read.
  // `defaultValue` and `defaultChecked` stay undeclared: no reader asks for
  // either, and neither becomes the field's value (`FormSchema.defaultValues`
  // does). `avatar_field` stays undeclared: the second spelling of
  // `avatarField` (AGENTS.md #0.1).
  language: stripImportedDefaults(SpecFieldSchema).shape.language,
  maxSize: stripImportedDefaults(SpecFieldSchema).shape.maxSize,
  capture: z.union([z.enum(['environment', 'user']), z.literal(false)]).optional()
    .describe('Camera capture mode of a `file` field; `false` never offers a camera input; read only by the `file` widget'),
  crop: z.boolean().optional()
    .describe('`false` turns off inline cropping on an `image` field; read only by the `image` widget'),
  defaultName: z.string().optional()
    .describe('Name an empty `avatar` field draws its initials from; read only by the `avatar` widget'),
  allowCreate: stripImportedDefaults(SpecFieldSchema).shape.allowCreate,
  descriptionField: stripImportedDefaults(SpecFieldSchema).shape.descriptionField,
  displayField: stripImportedDefaults(SpecFieldSchema).shape.displayField,
  idField: z.string().optional()
    .describe('Record field a `lookup` pick commits as the value (default `id`); read by the `lookup` widget'),
  lookupColumns: stripImportedDefaults(SpecFieldSchema).shape.lookupColumns,
  lookupFilters: stripImportedDefaults(SpecFieldSchema).shape.lookupFilters,
  lookupPageSize: stripImportedDefaults(SpecFieldSchema).shape.lookupPageSize,
  picker: z.enum(['search', 'default']).optional()
    .describe('Picker of a `lookup` / `user` field: `search` is the search-first people picker; read by the `lookup` and `user` widgets'),
  subtitle: z.array(z.string()).optional()
    .describe('Record fields shown beside each candidate of the search picker; read by the `lookup` and `user` widgets'),
  avatarField: z.string().optional()
    .describe('Record field each candidate of the search picker draws its avatar image from (default `image`); read by the `lookup` and `user` widgets'),
  step: stripImportedDefaults(SpecFieldSchema).shape.step,
  className: z.string().optional()
    .describe('Classes for the element this field\'s type renders (the control, or a section-divider row\'s divider), joined with that element\'s own classes; never the field row'),
}).superRefine((field, ctx) => {
  // objectui#11070 round 13 — the spec's one cross-key rule on `scale`; see
  // CURRENCY_FIELD_SCALE_REFUSAL.
  if (field.type === 'currency' && field.scale !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['scale'], message: CURRENCY_FIELD_SCALE_REFUSAL });
  }
  // objectui#5449 — the namespace rule `@object-ui/core` has enforced since
  // objectui#5375, stated here so `objectui validate` (which reaches this
  // schema via its strict twin, `StrictAnyComponentSchema`) stops green-lighting a document the
  // runtime rejects. Rule, census and the drift pin: FIELD_WIDGET_NAMESPACE.
  const id = resolveAuthoredFieldWidgetId(field);
  if (!id || !id.includes(':') || id.startsWith(FIELD_WIDGET_NAMESPACE)) return;
  ctx.addIssue({
    code: 'custom',
    // Same key core blames, chosen the same way: `widget` wins the precedence
    // above, so it is the key to fix when it is the one carrying the id.
    path: [typeof field.widget === 'string' ? 'widget' : 'type'],
    // Carries core's error code so a consumer can key off the finding rather
    // than string-matching the message. Zod's own `code` is `custom` for every
    // refinement, which cannot tell two of them apart.
    params: { code: 'UNRESOLVABLE_FIELD_WIDGET_NAMESPACE' },
    message: unresolvableFieldWidgetNamespaceMessage(id),
  });
});

/**
 * Form Schema - Complete form component
 */
/**
 * objectui#6152 round 3 — one tab of a tabbed field layout (`FormSchema.fieldTabs`),
 * restated member for member from the interface's `FormFieldTab`. Module-private: it
 * is a nested shape of the `form` arm, not a registered pair of its own.
 */
const FormFieldTabEntrySchema = z.object({
  key: z.string().describe('Stable tab key (the Radix Tabs value)'),
  label: z.string().optional().describe('Tab trigger text; falls back to key'),
  description: z.string().optional().describe('Blurb rendered above the tab fields'),
  fields: z.array(z.string()).describe('Names of the fields (from FormSchema.fields) this tab renders, in order'),
  containerClass: z.string().optional().describe('Field-grid classes for this tab panel'),
  visibleWhen: ExpressionWireSchema.optional()
    .describe('Predicate gating the tab: a bare string or the { dialect?, source } envelope; a hidden tab still submits'),
  // objectui#13055 — mirrored from `FormFieldTab.visibleWhenFault`.
  visibleWhenFault: z.enum(['hidden', 'shown']).optional()
    .describe("What a visibleWhen that cannot be evaluated does to the tab: 'hidden' hides it (a field group's fail-closed predicate); 'shown' or absent keeps the fail-open default"),
});

/**
 * objectui#6152 round 3 — one pane of a split field layout (`FormSchema.fieldPanes`),
 * restated member for member from the interface's `FormFieldPane`. Module-private,
 * like `FormFieldTabEntrySchema` above.
 */
const FormFieldPaneEntrySchema = z.object({
  key: z.string().describe('Stable pane key'),
  fields: z.array(z.string()).describe('Names of the fields (from FormSchema.fields) this pane renders, in order'),
  defaultSize: z.number().optional().describe('Initial pane size as a percentage of the group (1-99)'),
  minSize: z.number().optional().describe('Minimum pane size as a percentage of the group'),
  containerClass: z.string().optional().describe('Field-grid classes for this pane'),
});

export const FormSchema = BaseSchema.extend({
  type: z.literal('form'),
  objectName: z.string().optional().describe('Owning object name (drives field locators)'),
  fields: z.array(FormFieldSchema).describe('Form fields'),
  defaultValues: z.record(z.string(), z.any()).optional().describe('Default form values'),
  previousValues: z
    .record(z.string(), z.any())
    .optional()
    .describe('Persisted record being edited — binds `previous` for field-rule CEL predicates'),
  submitLabel: z.string().optional().describe('Submit button label'),
  cancelLabel: z.string().optional().describe('Cancel button label'),
  showCancel: z.boolean().optional().describe('Show cancel button'),
  // objectui#11070 — read by the `form` renderer (destructured off the node,
  // default `true`; the submit button renders only while it holds) and
  // refused by the strict authoring face until declared here.
  showSubmit: z.boolean().optional().describe('Show the submit button (default true); `false` renders the fields with no submit button'),
  // objectui#11168 slice 3 (objectui#7759 group C): `grid` retired. The
  // declaration states `vertical | horizontal`, the `form` registration
  // publishes those two, and the renderer reads only `layout === 'horizontal'`,
  // so `grid` drew exactly what `vertical` draws.
  layout: z.enum(['vertical', 'horizontal']).optional().describe('Label placement: vertical (the default) or horizontal'),
  columns: z.number().optional().describe('Number of columns the fields are laid out in (multi-column layout)'),
  validationMode: z.enum(['onSubmit', 'onChange', 'onBlur', 'onTouched', 'all']).optional().describe('Validation mode'),
  resetOnSubmit: z.boolean().optional().describe('Reset form on successful submit'),
  mode: retirementTombstone(
    'REFUSED (objectui#10286, ADR-0049; objectui#7759 ruling D1-(ii)) — the `form` node reads no `mode`: '
    + 'the key is not in `@objectstack/spec`, the `form` renderer never reads it, and every spelling '
    + 'rendered the same form — no render-time error or warning; only the parser tier\'s `unknown-prop` warning noticed it. The create / edit / view mode belongs to the '
    + '`object-form` node, in its `properties` bag (`ComponentPropsMap[\'object-form\'].mode`): author '
    + '`{ "type": "object-form", "properties": { "objectName": …, "mode": "edit", "recordId": … } }` for it. '
    + 'To make this form non-editable, set `disabled`.',
  ),
  actions: z.array(z.any()).optional().describe('Custom actions'),
  onSubmit: handlerKeyRefusal('onSubmit', 'runtime-slot', 'Submit handler'),
  onChange: handlerKeyRefusal('onChange', 'runtime-slot', 'Change handler'),
  onCancel: handlerKeyRefusal('onCancel', 'runtime-slot', 'Cancel handler'),
  showActions: z.boolean().optional().describe('Show action buttons'),
  // objectui#6152 round 3 — eight layout members the interface declared and this
  // mirror had never heard of, each READ by the `form` renderer
  // (`renderers/form/form.tsx`, off `schema.*`), and each a plain omission from this
  // object literal: the mirror already carried their neighbours. `fieldContainerClass`
  // and `mobileStickyActions` are also written by `ObjectForm` when it builds a `form`
  // node in code.
  mobileStickyActions: z.boolean().optional()
    .describe('Pin the Submit/Cancel row to the bottom of small viewports; no-op on desktop'),
  fieldContainerClass: z.string().optional().describe('Field container CSS classes'),
  fieldTabs: z.array(FormFieldTabEntrySchema).optional()
    .describe('Tabbed field layout: each tab claims a subset of fields by name, inside one form'),
  defaultFieldTab: z.string().optional().describe('Initially active fieldTabs key; defaults to the first tab'),
  fieldTabsPosition: z.enum(['top', 'bottom', 'left', 'right']).optional()
    .describe('Where the fieldTabs strip sits relative to the panels (default top)'),
  fieldPanes: z.array(FormFieldPaneEntrySchema).optional()
    .describe('Split field layout: each pane claims a subset of fields by name, inside one form'),
  fieldPanesOrientation: z.enum(['horizontal', 'vertical']).optional()
    .describe('Direction the fieldPanes are laid out in (default horizontal)'),
  fieldPanesResizable: z.boolean().optional().describe('Whether the fieldPanes divider offers a drag handle (default true)'),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this form node',
    '`form` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/form/form.tsx`). '
    + '`body` is the child-list spelling objectui#6771 retired — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/**
 * The one string this arm's `inputType` refusal carries into BOTH author-facing
 * channels — the parse-time issue message and the `.describe()` metadata — so
 * they cannot drift apart ({@link retirementTombstone}'s discipline).
 *
 * ⚠️ The closing sentence is a claim about a DIFFERENT surface and is pinned as
 * such: on the FORM FIELD path the precedence is the other way round
 * (`renderers/form/form.tsx`, `type={inputType || NATIVE_INPUT_FIELD_TYPES[declaredType] || 'text'}`),
 * so an author who meets this message inside `fields: [ … ]` is not the author it
 * is addressed to. `__tests__/shorthand-input-type-refusal-8762.test.ts` fails if
 * the message stops saying it; the components-side pin
 * (`renderers/form/__tests__/shorthand-input-type-discarded-8762.test.tsx`) fails
 * if either precedence moves.
 */
const SHORTHAND_INPUT_TYPE_REFUSAL =
  '`inputType` is NOT authorable on the `email` / `password` shorthands (objectui#8762). ' +
  '`packages/components/src/renderers/form/input.tsx` registers each of them by wrapping the ' +
  '`input` renderer and spreading its OWN `inputType` LAST, so an authored value is overwritten ' +
  'before the renderer reads it: `{ "type": "password", "inputType": "text" }` renders a MASKED ' +
  'field, not a text one. Write the input node itself when the input type is the choice — ' +
  '`{ "type": "input", "inputType": "email" }`, the spelling that IS read. ' +
  '(A form FIELD is a different position: inside `fields: [ … ]` an authored `inputType` still ' +
  'wins over the one the field type implies, and this refusal does not reach there.)';

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `InputShorthandSchema`. */
const INPUT_SHORTHAND_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'email` / `password',
  'both registrations spread the node into the `input` renderer with `inputType` pinned, and that renderer reads it as `InputSchema`',
  'one input field — `label`, `placeholder`, `value` / `defaultValue`, `description`, `error`, `required`',
);

/**
 * Input Shorthand Schema — the `email` / `password` aliases
 * `packages/components/src/renderers/form/input.tsx` registers (objectui#8499).
 *
 * Both are the SAME renderer as `input`, wrapped so that `inputType` is pinned:
 *
 * ```tsx
 * ComponentRegistry.register('password',
 *   (props) => <InputRenderer {...props} schema={{ ...props.schema, inputType: 'password' }} />, …)
 * ```
 *
 * ⛔ `inputType` is therefore NOT a member here, and that is the whole difference
 * from {@link InputSchema}. The wrapper spreads its own value LAST, so an
 * authored `inputType` never reaches the renderer. Write
 * `{ type: 'input', inputType: 'email' }` when the input type is the choice.
 *
 * ## Why the key is DECLARED-AND-REFUSED rather than merely omitted (objectui#8762)
 *
 * ⚠️ objectui#8499 shipped this arm with the key simply OMITTED and recorded the
 * reading that made that insufficient: `BaseSchema` is `.passthrough()`, so
 * `{ type: 'password', inputType: 'text' }` PARSED GREEN and the value survived
 * into `safeParse`'s output — omission states the contract on the declared face,
 * it does not refuse the value. Re-measured on this card's base before the
 * change: ACCEPT, with `inputType: 'text'` still present in the parsed data,
 * while the DOM rendered `type="password"`. That is the class-(c) trap — a
 * validated key the runtime discards — so #8499's report left the repair to its
 * own ruling, which is this card.
 *
 * The key therefore stays DECLARED and unwritable, refused BY NAME with guidance
 * ({@link retirementTombstone}, the mechanism `./tombstone.zod.ts` owns). ⚠️ Not
 * an ADR-0049 retirement of `inputType` itself — the key is alive and honoured on
 * {@link InputSchema}; what is unwritable is this POSITION. That is the same
 * reading `MenuItemSchema.type` (`overlay.zod.ts`) is filed under, and
 * `aliasKeyRefusal`'s docblock records why declaration history is not what picks
 * the helper. ⛔ Not `aliasKeyRefusal` either: the remedy here is a different
 * `type`, not a sibling spelling of a key on this same object, so its
 * "Did you mean `inputType` → `inputType`?" lead would be nonsense.
 *
 * ⛔ The repair is NOT to flip the wrapper's precedence so the author wins:
 * `{ type: 'password', inputType: 'text' }` would then render an UNMASKED field
 * under a `password` key, which is worse than refusing it. The card records this
 * so the cheaper-looking route is not taken by accident.
 *
 * ONE rule, not an enumeration: the refusal is a single member on this ONE arm,
 * whose `type` is an enum, so it covers both literals and any literal later added
 * to that enum. A shorthand registered in `input.tsx` and NOT added to the enum
 * is refused whole by `AnyComponentSchema` (no arm claims the literal) rather
 * than silently accepted — the loud direction — and
 * `__tests__/shorthand-input-type-refusal-8762.test.ts` compares the enum against
 * the registration site so the gap turns red instead of widening in silence.
 *
 * Every other key is {@link InputSchema}'s, because it is literally the same
 * renderer reading the same schema.
 */
export const InputShorthandSchema = InputSchema.omit({ type: true, inputType: true }).extend({
  type: z.enum(['email', 'password'])
    .describe('Input shorthand — `renderers/form/input.tsx` pins `inputType` to match'),
  // Declared and unwritable — the `.omit()` above removes the HONOURED enum
  // {@link InputSchema} carries, and this puts a named refusal in its place.
  inputType: retirementTombstone(SHORTHAND_INPUT_TYPE_REFUSAL),
  // ⭐ `wrapperClass` used to be RE-DECLARED here, because {@link InputSchema}
  // did not carry it and copying the gap into a NEW pair would have minted a
  // second parity-ledger row for a key that is demonstrably read. `c974edf14`
  // shrank that row instead: the key is on {@link InputSchema} now, so this arm
  // inherits it through the `.omit()` above like every other key, and the
  // restatement is gone rather than left standing as a duplicate of it.
  // `__tests__/input-wrapper-class-mirrored-8072.test.ts` pins this arm's
  // membership and its refusal, so the inheritance is measured, not assumed.
  //
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  // ⚠️ Since the `input` slice, `.omit()` above already carries {@link InputSchema}'s own
  // tombstone pair of the same shape, so these two refuse nothing new. They are kept because
  // they override that pair's message with one that names `email` / `password` and the wrapper
  // route, which is what an author of these two nodes reads.
  body: retirementTombstone(INPUT_SHORTHAND_NEITHER_CHANNEL),
  children: retirementTombstone(INPUT_SHORTHAND_NEITHER_CHANNEL),
});

/**
 * Ui Calendar Schema — the date-picker primitive
 * `packages/components/src/renderers/form/calendar.tsx` registers, reachable at
 * `ui:calendar` ONLY (objectui#8499).
 *
 * ⚠️ `ui:calendar`, not `calendar`, and the two are different components. That
 * registration carries `skipFallback: true` with its reason written beside it:
 *
 * > `calendar` collides with the plugin-calendar full CRUD calendar VIEW, which
 * > owns the bare `type: 'calendar'` schema keyword; this date-picker primitive
 * > is reached via `ui:calendar` only.
 *
 * So the namespaced spelling is not a stylistic variant of {@link CalendarSchema}
 * — it is the only spelling that resolves to this renderer. Five catalog
 * fixtures under `examples/schema-catalog/src/schemas/components-form-calendar/`
 * author it, every one of them rendered and every one of them refused by
 * `AnyComponentSchema` until this arm.
 *
 * The key set is {@link CalendarSchema}'s: `calendar.tsx` reads `schema.mode`,
 * `schema.value`, `schema.defaultValue` and `className`, which is what that
 * schema already declares — it mirrors this primitive's shape while its own
 * literal resolves to the plugin view. It is built from the same unexported
 * key set and carries the same mode/selection refinement (objectui#10304), so
 * the two spellings accept exactly the same selections.
 */
export const UiCalendarSchema = CalendarObjectSchema.extend({
  type: z.literal('ui:calendar')
    .describe('The `ui`-namespaced date-picker primitive — `calendar` alone names the plugin-calendar view'),
}).superRefine(calendarSelectionFitsMode);

/** objectui#9256 (family-D re-measure): ONE refusal string for both content channels of `CodeEditorSchema`. */
const CODE_EDITOR_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'code-editor',
  'its registration (`plugin-editor:code-editor`) reads the node through `CodeEditorRenderer`\'s inline '
    + 'props type, which forwards `value`, `language`, `theme`, `height`, `readOnly` and `className` to Monaco',
  'a Monaco editor over `value`, in `language` and `theme`',
);

/**
 * Form Component Schema Union - All form component schemas
 */
/**
 * Code Editor Schema — mirrors `CodeEditorSchema` in `../form.ts`.
 *
 * Closes the other half of objectui#6318's bucket B: `code-editor` is a
 * REGISTERED component (`@object-ui/plugin-editor`) that no union member
 * modelled, so every document naming it failed `safeValidateSchema` and three
 * schema-catalog entries were reported as unrecognised content.
 *
 * Derived from the renderer's forwards
 * (`plugin-editor/src/index.tsx:43-49`), not from a view of what a code editor
 * ought to accept. `language` stays `z.string()` rather than the registration's
 * six-name picker list, because the renderer hands the value straight to Monaco
 * and the plugin's own declaration already widens that list with `| string`;
 * `theme` stays closed because both declarations agree it is two spellings.
 */
export const CodeEditorSchema = BaseSchema.extend({
  type: z.literal('code-editor'),
  value: z.string().optional().describe('Code content'),
  language: z.string().optional().describe('Monaco language id for syntax highlighting'),
  theme: z.enum(['vs-dark', 'light']).optional().describe('Editor colour theme'),
  height: z.string().optional().describe('Editor height as a CSS length'),
  readOnly: z.boolean().optional().describe('Whether the editor refuses edits'),
  onChange: handlerKeyRefusal('onChange', 'runtime-slot', 'Change handler'),
  // objectui#9256 (family-D re-measure): the renderer reads NEITHER content channel, so both are
  // refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(CODE_EDITOR_NEITHER_CHANNEL),
  children: retirementTombstone(CODE_EDITOR_NEITHER_CHANNEL),
});

const FormComponentSchemaInferred = z.discriminatedUnion('type', [
  ButtonSchema,
  InputSchema,
  TextareaSchema,
  SelectSchema,
  CheckboxSchema,
  RadioGroupSchema,
  SwitchSchema,
  ToggleSchema,
  SliderSchema,
  FileUploadSchema,
  DatePickerSchema,
  CalendarSchema,
  InputOTPSchema,
  ComboboxSchema,
  LabelSchema,
  CommandSchema,
  FormSchema,
  CodeEditorSchema,
  InputShorthandSchema,
  UiCalendarSchema,
]);

/**
 * The TYPE of {@link FormComponentSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface FormComponentZodType extends FormComponentSchemaInferredType {
  options: FormComponentSchemaInferredType['options'];
}
type FormComponentSchemaInferredType = typeof FormComponentSchemaInferred;

/** The union above, typed by its named {@link FormComponentZodType}. */
export const FormComponentSchema: FormComponentZodType = FormComponentSchemaInferred;
