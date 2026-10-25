/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `FormFieldSchema` (zod) ↔ `FormField` (TS) coverage gate (#3090).
 *
 * The zod schema is the ONLY runtime enforcement of the form-field contract —
 * `@object-ui/cli`'s published `objectui validate` parses through it, while
 * renderers read plain objects and never parse. Until #3090 it validated 13 of
 * the interface's declared keys and required `type` (the interface says
 * optional): metadata the renderer accepts failed validation, and a typo in
 * `visibleWhen`/`widget`/`dependsOn` passed silently (strip mode).
 *
 * Why a PINNED LIST instead of a derivation: TS interface keys cannot be
 * enumerated at runtime, and `FormField` carries an index signature, which
 * defeats both directions of a compile-time assignability probe (the
 * objectstack#4075 mechanism — see check-spec-symbol-derivation.mjs, lie #3).
 * A set-coverage assertion is the #3017 fallback for exactly this case: the
 * zod side stays deliberate and reviewed, and any schema edit must touch the
 * list here in the same PR. That list is the AUTHORABLE key surface, not every
 * key the interface declares — one declared key sits outside it on purpose, for
 * the reason its own note records (objectui#6609).
 */

import { describe, it, expect } from 'vitest';
import { FieldConstraintsSchema, FormFieldSchema } from '../zod/form.zod.js';

/**
 * The AUTHORABLE key surface of `FormField` (../form.ts) — the keys a DOCUMENT
 * may itself carry, and so the keys `objectui validate` parses through this
 * schema. Ordered to follow the interface loosely, as a reading aid only: the
 * assertion sorts both sides, so the order here carries no claim (`visibleOn`
 * precedes `hidden`/`readonly` in the interface and follows them here).
 *
 * ⚠️ NOT "every key the interface declares by name", and the gap is DELIBERATE.
 * `FormField` also declares `field` — the resolved object-field metadata stash
 * (#3090), which the object-bound form paths fill at RUNTIME with a
 * server-served field definition so widgets can read `precision`, `currency`,
 * `reference`, … No document ever writes it. And on the SPEC form-view side
 * — the other authoring surface, the one #3090 keeps separate — that same key
 * name means something else entirely: a STRING naming the referenced object
 * field. Admitting `field` here and to `FormFieldSchema` would therefore make
 * `objectui validate` accept and type a runtime-only stash on authored
 * documents, re-opening the exact spec-vocabulary pun #3090 closed at the
 * `normalizeSectionField` chokepoint. The refusal is pinned below by the
 * `still rejects the SPEC form-field vocabulary` case: `{ field: 'email' }`
 * must not parse. So a `field` entry here is a contract widening to be ruled
 * on — never housekeeping that restores consistency (objectui#6609).
 */
const DECLARED_KEYS = [
  'id',
  'name',
  'label',
  'description',
  'type',
  'inputType',
  'required',
  'disabled',
  'placeholder',
  'options',
  'validation',
  'condition',
  'widget',
  'dependsOn',
  'hidden',
  'readonly',
  'visibleOn',
  'visibleWhen',
  'readonlyWhen',
  'requiredWhen',
  'colSpan',
  'span',
  // objectui#6236 — the section grouping claim (section-divider rows only).
  'fields',
  // objectui#13055 — the fault direction of a section-divider row's predicate.
  'visibleWhenFault',
  // objectui#11070 — field metadata a hand-authored form writes on the entry
  // itself, read off it by the field widgets and the built-in branches. All
  // but `pattern` are the spec's `FieldSchema` members by reference.
  'multiple',
  'rows',
  'accept',
  'dimensions',
  'reference',
  'min',
  'max',
  // objectui#11070 round 13 — the decimal places the number-family widgets
  // read, and the currency widget's fixed-currency declaration, by reference.
  'scale',
  'currencyConfig',
  'minLength',
  'maxLength',
  'pattern',
  // objectui#11070 round 3 — the spec spellings the `formula` and `summary`
  // widgets read (their snake_case forms are retired), by reference too.
  'returnType',
  'summaryOperations',
  // objectui#11070 round 7 — the `grid` widget's columns: the spec's
  // `inlineColumns` list (its strict inline grid column), by reference.
  'columns',
  // objectui#11070 round 10 — the `grid` widget's field-level keys, the
  // members of `GridFieldMetadata` (the TS twin carries each by reference),
  // camelCase since objectui#11610.
  'minRows',
  'maxRows',
  'allowAdd',
  'allowDelete',
  'allowReorder',
  'totalField',
  'addLabel',
  'sortField',
  // objectui#12130 — the rest of the field metadata the channel reads off the
  // entry, measured at runtime (`form-field-channel-census-12130.test.tsx` in
  // `examples/schema-catalog/test/`). The spec's `FieldSchema` members by
  // reference, plus `idField` / `picker` / `subtitle` (declared on the entry
  // itself since objectui#12242 moved them off the field metadata types) and
  // `capture` / `crop` / `defaultName` as their widgets read them.
  'language',
  'maxSize',
  'capture',
  'crop',
  'defaultName',
  'allowCreate',
  'descriptionField',
  'displayField',
  'idField',
  'lookupColumns',
  'lookupFilters',
  'lookupPageSize',
  'picker',
  'subtitle',
  // objectui#12130 round 2 — the search picker's avatar field, camelCase only;
  // the `avatar_field` spelling the widgets read first stays refused.
  'avatarField',
  // objectui#12130 round 3 — the spec's numeric `step`, by reference, and the
  // classes of the element the field's type renders.
  'step',
  'className',
];

/**
 * Keys the schema DECLARES only to refuse by name — never authorable, so not in
 * {@link DECLARED_KEYS}: the `grid` widget's eight retired snake_case spellings
 * (objectui#11610), each an alias refusal naming its camelCase key, paired with
 * a `?: never` tombstone on the TS twin. Their refusal is pinned in
 * `grid-field-keys-camelcase-11610.test.ts`; this list only keeps the shape
 * count honest, so a ninth arm (or a dropped one) must touch it.
 */
const REFUSED_BY_NAME_KEYS = [
  'min_rows',
  'max_rows',
  'allow_add',
  'allow_delete',
  'allow_reorder',
  'total_field',
  'add_label',
  'sort_field',
];

describe('FormFieldSchema covers the FormField contract', () => {
  it('validates exactly the declared key set, plus the keys it refuses by name', () => {
    expect(Object.keys(FormFieldSchema.shape).sort()).toEqual([...DECLARED_KEYS, ...REFUSED_BY_NAME_KEYS].sort());
  });

  it('each refused-by-name key refuses every value, so none of them is authorable (objectui#11610)', () => {
    for (const key of REFUSED_BY_NAME_KEYS) {
      expect(FormFieldSchema.safeParse({ name: 'lines', type: 'grid', [key]: 1 }).success, key).toBe(false);
      expect(FormFieldSchema.safeParse({ name: 'lines', type: 'grid', [key]: 'x' }).success, key).toBe(false);
    }
  });

  it('requires only `name` — `type` is optional, matching the interface', () => {
    expect(FormFieldSchema.safeParse({ name: 'email' }).success).toBe(true);
  });

  it('keeps the spec-aligned keys it used to strip', () => {
    const parsed = FormFieldSchema.parse({
      name: 'state',
      widget: 'rating',
      dependsOn: ['country', { field: 'region', param: 'region_id' }],
      hidden: false,
      readonly: true,
      visibleOn: { dialect: 'cel', source: "record.priority == 'urgent'" },
      visibleWhen: "record.status == 'sent'",
      readonlyWhen: 'record.locked == true',
      requiredWhen: "record.stage == 'won'",
      span: 'full',
    });
    expect(parsed.widget).toBe('rating');
    expect(parsed.dependsOn).toEqual(['country', { field: 'region', param: 'region_id' }]);
    expect(parsed.visibleOn).toEqual({ dialect: 'cel', source: "record.priority == 'urgent'" });
    expect(parsed.visibleWhen).toBe("record.status == 'sent'");
    expect(parsed.readonlyWhen).toBe('record.locked == true');
    expect(parsed.requiredWhen).toBe("record.stage == 'won'");
    expect(parsed.span).toBe('full');
    expect(parsed.readonly).toBe(true);
  });

  it('now REJECTS a malformed value for a declared key instead of stripping it', () => {
    // Before #3090 `visibleWhen` was unknown to the schema, so `visibleWhen: 42`
    // validated clean with the predicate thrown away.
    expect(FormFieldSchema.safeParse({ name: 'x', visibleWhen: 42 }).success).toBe(false);
  });

  it('still rejects the SPEC form-field vocabulary — the layers stay distinct', () => {
    // `{ field: 'email' }` is the authored (spec) shape; this schema is the
    // runtime shape. The boundary between them is `normalizeSectionField` in
    // @object-ui/plugin-form, not a dual-key read here. (#3090 PR2 upgrades
    // the CLI's error MESSAGE for this case; the verdict must not change.)
    expect(FormFieldSchema.safeParse({ field: 'email', required: true }).success).toBe(false);
  });
});

/**
 * `FieldConstraintsSchema` ↔ `FieldValidationRules` inner-shape pin (#5186).
 *
 * The #3090 block above pins `FormFieldSchema`'s TOP-LEVEL keys only — which
 * is exactly why `validation`'s inner shape drifted silently: the zod side
 * declared a flat scalar dialect (`minLength: number`, `pattern: string`)
 * while the TS contract (`FieldValidationRules`, ../form.ts) and the
 * renderer's only read point (`form.tsx` → react-hook-form) consume
 * `{ value, message }` objects. `objectui validate` was wrong in both
 * directions at once: it rejected metadata written to the public TS contract
 * and passed a dialect react-hook-form silently drops — #5099's "looks
 * validated, executes nothing", hidden on the zod face. These tests pin the
 * inner shape so that drift cannot re-open under a green top-level guard.
 */
describe('FieldConstraintsSchema mirrors FieldValidationRules (#5186)', () => {
  it('declares exactly the FieldValidationRules key set', () => {
    // Same #3017-style set-coverage pin as the block above, one level down:
    // a key added to either side must touch this list in the same PR.
    expect(Object.keys(FieldConstraintsSchema.shape).sort()).toEqual(
      ['required', 'minLength', 'maxLength', 'min', 'max', 'pattern', 'validate'].sort(),
    );
  });

  it('ACCEPTS validation written to the public TS contract', () => {
    const contractShaped = {
      required: 'Email is required', // string = the message itself (react-hook-form semantics)
      minLength: { value: 3, message: 'At least 3 characters' },
      maxLength: { value: 64, message: 'At most 64 characters' },
      min: { value: 1, message: 'Must be at least 1' },
      max: { value: 99, message: 'Must be at most 99' },
      // ⛔ No `validate` here since objectui#7759 group E: it is a RUNTIME SLOT
      // for a host-supplied function, and the mirror refuses it BY NAME (the
      // objectui#6124 shape) — JSON has no function value. That refusal is
      // pinned in `function-slot-keys-json-refusal-7759.test.ts`.
    };
    const parsed = FieldConstraintsSchema.safeParse(contractShaped);
    expect(parsed.success).toBe(true);
    // `required` is the one rule that does NOT follow { value, message }:
    // the TS contract says `string | boolean`, and both faces must pass.
    expect(FieldConstraintsSchema.safeParse({ required: true }).success).toBe(true);
    expect(FieldConstraintsSchema.safeParse({ required: false }).success).toBe(true);
  });

  it('REJECTS the flat scalar dialect no read point consumes', () => {
    // This exact object parsed clean before #5186 while `form.tsx` spread it
    // into react-hook-form where not one of these rules ran.
    const flat = {
      minLength: 3,
      maxLength: 10,
      min: 1,
      max: 99,
      pattern: '^[a-z]+$',
    };
    const parsed = FieldConstraintsSchema.safeParse(flat);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      // Every flat key must be individually rejected — a verdict that hinged
      // on one key would let the other four ride back in one at a time.
      const rejectedKeys = new Set(parsed.error.issues.map((i) => String(i.path[0])));
      expect([...rejectedKeys].sort()).toEqual(['max', 'maxLength', 'min', 'minLength', 'pattern']);
    }
  });

  it('rejects a string pattern.value BY NAME, with guidance toward the metadata route', () => {
    // JSON cannot express a RegExp, so on the JSON face a hand-written
    // pattern can never be satisfied — the honest answer is a named
    // rejection pointing at the route that CAN carry it (#5099 ruling,
    // JSON-face half). Never a silent strip, never a string→RegExp coercion.
    const parsed = FieldConstraintsSchema.safeParse({
      pattern: { value: '^[a-z0-9-]+$', message: 'Lowercase letters, digits, dashes' },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find(
        (i) => i.path.join('.') === 'pattern.value',
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/RegExp/);
      expect(issue?.message).toMatch(/FieldSchema\.pattern/);
    }
  });

  it('accepts a compiled RegExp pattern.value — the TS-contract face stays intact', () => {
    // Programmatic (in-memory) callers hold real RegExp instances; the named
    // rejection above is about what JSON can carry, not a key retirement.
    const parsed = FieldConstraintsSchema.safeParse({
      pattern: { value: /^[a-z0-9-]+$/, message: 'Lowercase letters, digits, dashes' },
    });
    expect(parsed.success).toBe(true);
  });

  it('parses a FormField carrying contract-shaped validation', () => {
    const parsed = FormFieldSchema.parse({
      name: 'email',
      type: 'input',
      validation: {
        required: 'Email is required',
        minLength: { value: 3, message: 'At least 3 characters' },
      },
    });
    expect(parsed.validation).toEqual({
      required: 'Email is required',
      minLength: { value: 3, message: 'At least 3 characters' },
    });
  });
});
