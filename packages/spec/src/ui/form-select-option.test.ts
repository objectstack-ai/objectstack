// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12868] The per-option `default` key is narrowed OUT of the form-view
 * options vocabulary — and ONLY there (maintainer-ruled disposition 甲,
 * 2026-08-28, on the objectui#6263 analysis).
 *
 * `SelectOptionSchema` serves two surfaces:
 *
 * - **Object-field options** (`Field.select.options`): `default` is ENFORCED
 *   (#7246 ruling, PR #7388 — `applyFieldDefaults` falls back to the option
 *   marked `default: true`; `defaultValue` wins when both are declared). That
 *   face is UNTOUCHED by the narrowing, alias rows included — the positive
 *   half below pins it.
 * - **Form-view options** (`FormFieldSchema.options`, via
 *   `FormSelectOptionSchema`): the key parsed clean and nothing read it, so it
 *   is refused with a tombstone prescription pointing at the object
 *   definition — the negative half below pins the refusal AND the prose.
 *
 * Plus the derivation pins: the form-view option shape is an Omit of the
 * object face's shape (every key minus exactly `default`), its alias table is
 * the object face's minus the two rows that pointed at the removed key
 * (`isDefault`/`selected`), and those two spellings are answered by `guidance`
 * instead of a rename — suggesting a key the schema refuses is the
 * `triggerPhrases` failure shape `shared/strict-object.ts` documents.
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema, SelectOptionSchema } from '../data/field.zod';
import { FormFieldSchema, FormSelectOptionSchema, FormViewSchema } from './view.zod';
import { strictObjectDeclarations } from '../shared/strict-object';

/**
 * The `unrecognized_keys` message for `value`, or a loud failure — same
 * helper, same reasoning, as `editability-boundary.test.ts`: probe bodies are
 * minimal and may also miss a required key, so a whole-error stringify could
 * let an assertion pass on text from an unrelated issue.
 */
function unknownKeyMessage(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } },
  value: unknown,
): string {
  const r = schema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  const issues = (r.error as { issues?: Array<{ code?: string; message?: string }> }).issues ?? [];
  const hit = issues.find((i) => i.code === 'unrecognized_keys');
  expect(hit, `no \`unrecognized_keys\` issue in ${JSON.stringify(issues)}`).toBeDefined();
  return hit?.message ?? '';
}

/** Minimal valid option body (`value` is a SystemIdentifier — min 2 chars). */
const OPTION = { label: 'Open', value: 'open' } as const;

// ===========================================================================
// 1. The refused half — form-view options reject `default`, with the
//    prescription (ADR-0112-adjacent: assert the message, not just the throw)
// ===========================================================================

describe('form-view options refuse the per-option `default` key', () => {
  it('`default` is refused with the tombstone prescription', () => {
    const m = unknownKeyMessage(FormSelectOptionSchema, { ...OPTION, default: true });
    expect(m).toMatch(/`options\[\]\.default` on a form-view field was removed from the FormView vocabulary/);
    // The prescription names BOTH enforced destinations and their precedence.
    expect(m).toContain('field-level `defaultValue`');
    expect(m).toContain('`default: true`');
    expect(m).toMatch(/`defaultValue` winning when both are declared/);
    // House migrate sentence (route D wording — a property of the tool).
    expect(m).toContain('Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.');
    // No rename suggestion toward a key this shape refuses.
    expect(m).not.toContain('Did you mean');
  });

  it.each(['isDefault', 'selected'] as const)('the object-face alias spelling `%s` gets guidance, not a rename', (key) => {
    const m = unknownKeyMessage(FormSelectOptionSchema, { ...OPTION, [key]: true });
    expect(m).toContain(`\`${key}\` is an object-field spelling`);
    expect(m).toContain('declare the pre-selected choice on the object definition');
    // A rename would point at a key this shape refuses (the `triggerPhrases`
    // failure shape) — guidance must have replaced it.
    expect(m).not.toContain('Did you mean');
  });

  it('the refusal fires through the real doors — a form field row and a whole FormView', () => {
    const row = {
      field: 'status',
      type: 'select',
      options: [{ ...OPTION, default: true }, { label: 'Closed', value: 'closed' }],
    };
    const viaField = FormFieldSchema.safeParse(row);
    expect(viaField.success).toBe(false);
    const flat = JSON.stringify((viaField as { error?: { issues?: unknown } }).error?.issues ?? []);
    expect(flat).toContain('removed from the FormView vocabulary');

    const viaForm = FormViewSchema.safeParse({ sections: [{ label: 'Details', fields: [row] }] });
    expect(viaForm.success).toBe(false);
    // The union door nests the issue; the prescription must still be there.
    expect(JSON.stringify((viaForm as { error?: { issues?: unknown } }).error?.issues ?? []))
      .toContain('removed from the FormView vocabulary');
  });

  it('the refusal recurses into nested sub-field rows (composite/repeater/record)', () => {
    const nested = FormFieldSchema.safeParse({
      field: 'meta',
      type: 'composite',
      fields: [{
        field: 'priority',
        type: 'radio',
        options: [{ label: 'High', value: 'high', isDefault: true }],
      }],
    });
    expect(nested.success).toBe(false);
    expect(JSON.stringify((nested as { error?: { issues?: unknown } }).error?.issues ?? []))
      .toContain('object-field spelling');
  });

  it('an option WITHOUT the key parses green through the whole FormView — the narrowing removed one key, not the vocabulary', () => {
    const r = FormViewSchema.safeParse({
      sections: [{
        label: 'Details',
        fields: [{
          field: 'status',
          type: 'select',
          options: [
            { label: 'Open', value: 'open', color: '#3B82F6', visibleWhen: "record.country == 'cn'" },
            { label: 'Closed', value: 'closed' },
          ],
        }],
      }],
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error ?? {})).toBe(true);
  });
});

// ===========================================================================
// 2. The untouched half — the OBJECT-field face still accepts `default`
// ===========================================================================

describe('the object-field face is untouched', () => {
  it('`SelectOptionSchema` still accepts `default: true` (the enforced face)', () => {
    const r = SelectOptionSchema.safeParse({ ...OPTION, default: true });
    expect(r.success).toBe(true);
    expect((r as { data?: { default?: boolean } }).data?.default).toBe(true);
  });

  it('a whole object field still accepts a defaulted option through `FieldSchema`', () => {
    const r = FieldSchema.safeParse({
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [{ label: 'Open', value: 'open', default: true }, { label: 'Closed', value: 'closed' }],
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error ?? {})).toBe(true);
  });

  it('the object face keeps its alias rows for the spellings the form face refuses', () => {
    // Forcing the parse first registers the declaration (lazySchema).
    SelectOptionSchema.safeParse(OPTION);
    const decl = strictObjectDeclarations().find((d) => d.options.surface === 'this select option');
    expect(decl, '`SelectOptionSchema` did not register a declaration').toBeDefined();
    expect(decl!.options.aliases?.isDefault).toBe('default');
    expect(decl!.options.aliases?.selected).toBe('default');
  });
});

// ===========================================================================
// 3. Derivation pins — the two faces cannot drift apart key-by-key
// ===========================================================================

describe('FormSelectOptionSchema is an Omit of SelectOptionSchema', () => {
  it('shape = the object face minus exactly `default`', () => {
    const objectKeys = Object.keys(SelectOptionSchema.shape).sort();
    const formKeys = Object.keys(FormSelectOptionSchema.shape).sort();
    expect(objectKeys).toContain('default');
    expect(formKeys).toEqual(objectKeys.filter((k) => k !== 'default'));
  });

  it('property schemas are shared BY REFERENCE — an Omit, not a copy', () => {
    for (const key of Object.keys(FormSelectOptionSchema.shape)) {
      expect(
        FormSelectOptionSchema.shape[key as keyof typeof FormSelectOptionSchema.shape],
        `\`${key}\` must be the object face's own property schema`,
      ).toBe(SelectOptionSchema.shape[key as keyof typeof SelectOptionSchema.shape]);
    }
  });

  it('alias table = the object face minus the rows that pointed at `default`; those spellings moved to guidance', () => {
    FormSelectOptionSchema.safeParse(OPTION);
    SelectOptionSchema.safeParse(OPTION);
    const decls = strictObjectDeclarations();
    const objectDecl = decls.find((d) => d.options.surface === 'this select option');
    const formDecl = decls.find((d) => d.options.surface === 'this form-view select option');
    expect(objectDecl).toBeDefined();
    expect(formDecl, '`FormSelectOptionSchema` did not register a declaration').toBeDefined();

    const objectAliases = objectDecl!.options.aliases ?? {};
    const removedRows = Object.entries(objectAliases).filter(([, target]) => target === 'default');
    expect(removedRows.map(([k]) => k).sort()).toEqual(['isDefault', 'selected']);

    const expectedFormAliases = Object.fromEntries(
      Object.entries(objectAliases).filter(([, target]) => target !== 'default'),
    );
    expect(formDecl!.options.aliases).toEqual(expectedFormAliases);

    // The removed key and its two spellings are all answered by guidance.
    expect(Object.keys(formDecl!.options.guidance ?? {}).sort()).toEqual(['default', 'isDefault', 'selected']);
  });

  it('the editability boundary rides along (one vocabulary, per-shape answer)', () => {
    FormSelectOptionSchema.safeParse(OPTION);
    const formDecl = strictObjectDeclarations().find((d) => d.options.surface === 'this form-view select option');
    expect(formDecl!.options.guidanceSets?.map((s) => s.name))
      .toContain('SELECT_OPTION_EDITABILITY_BOUNDARY_KEYS');
    // The verdict is unchanged too, not just the message.
    expect(FormSelectOptionSchema.safeParse({ ...OPTION, disabled: true }).success).toBe(false);
  });

  it('the surviving rename channel still fires on the form face', () => {
    expect(unknownKeyMessage(FormSelectOptionSchema, { ...OPTION, colour: 'red' }))
      .toContain('Did you mean `colour` → `color`?');
    expect(unknownKeyMessage(FormSelectOptionSchema, { ...OPTION, title: 'X' }))
      .toContain('Did you mean `title` → `label`?');
  });
});
