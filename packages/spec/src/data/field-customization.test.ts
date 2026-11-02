// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D10 — the `__c` reservation and the base-field display-property
 * whitelist, measured against `FieldSchema`, and the extension slot that
 * carries a patch (`ObjectExtensionSchema.fieldPatches`).
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { BASE_FIELD_DISPLAY_WHITELIST, EXTENSION_FIELD_SUFFIX, isExtensionFieldName } from './field-customization';
import { FieldSchema, SelectOptionSchema } from './field.zod';
import { ObjectExtensionSchema } from './object.zod';

/** The object shape behind a (possibly optional) schema. */
function shapeOf(schema: unknown): Record<string, z.ZodTypeAny> {
  const s = schema as { shape?: Record<string, z.ZodTypeAny> };
  if (!s.shape) throw new Error('not an object schema');
  return s.shape;
}

/**
 * The properties D10 and D6 name as the vendor's, plus every `FieldSchema` key
 * whose change alters DDL, a stored value, a validation verdict or a
 * permission — the four things a whitelisted property must leave alone.
 */
const STRUCTURAL_FIELD_KEYS = [
  // D10 / D6, named
  'type', 'required', 'unique', 'reference', 'defaultValue', 'expression', 'options',
  // DDL / storage
  'name', 'storage', 'multiple', 'maxLength', 'precision', 'scale', 'picklist', 'referenceVia',
  'deleteBehavior', 'referenceDeletedWhen', 'autonumberFormat', 'externalId', 'valueDomain', 'returnType',
  // validation verdicts
  'minLength', 'min', 'max', 'requiredWhen', 'accept', 'maxSize',
  // permission
  'requiredPermissions', 'readonly', 'readonlyWhen', 'maskingRule', 'hidden', 'internal', 'system',
] as const;
const STRUCTURAL_OPTION_KEYS = ['value'] as const;

describe('the `__c` reservation', () => {
  it('the suffix is `__c` (maintainer: 「扩展字段用 __c 后缀，只有 .custom 包能用。」)', () => {
    expect(EXTENSION_FIELD_SUFFIX).toBe('__c');
  });

  it.each([
    ['region__c', true],
    ['annual_budget__c', true],
    ['region', false],
    ['region_c', false],
    ['region__c_2', false],
    ['__c', false],
    ['', false],
    [undefined, false],
  ])('isExtensionFieldName(%j) → %s', (name, verdict) => {
    expect(isExtensionFieldName(name)).toBe(verdict);
  });

  it('an extension field name is a valid field name — the reservation needs no grammar change', () => {
    expect(shapeOf(FieldSchema).name!.safeParse('region__c').success).toBe(true);
  });
});

describe('the base-field display-property whitelist', () => {
  const fieldShape = shapeOf(FieldSchema);
  const optionShape = shapeOf(SelectOptionSchema);

  it('is the class ADR-0146 D10 names: label, description, help text, placeholder, option labels', () => {
    expect([...BASE_FIELD_DISPLAY_WHITELIST.field]).toEqual(['label', 'description', 'inlineHelpText', 'placeholder']);
    expect([...BASE_FIELD_DISPLAY_WHITELIST.option]).toEqual(['label']);
  });

  it('is closed: frozen at both levels', () => {
    expect(Object.isFrozen(BASE_FIELD_DISPLAY_WHITELIST)).toBe(true);
    expect(Object.isFrozen(BASE_FIELD_DISPLAY_WHITELIST.field)).toBe(true);
    expect(Object.isFrozen(BASE_FIELD_DISPLAY_WHITELIST.option)).toBe(true);
  });

  it.each(BASE_FIELD_DISPLAY_WHITELIST.field.map((k) => [k]))('field member `%s` exists on FieldSchema and is text', (key) => {
    expect(Object.keys(fieldShape)).toContain(key);
    expect(fieldShape[key]!.safeParse('Display text').success).toBe(true);
  });

  it.each(BASE_FIELD_DISPLAY_WHITELIST.option.map((k) => [k]))('option member `%s` exists on an option of FieldSchema.options and is text', (key) => {
    expect(Object.keys(optionShape)).toContain(key);
    expect(optionShape[key]!.safeParse('Display text').success).toBe(true);
  });

  it('the option schema measured is the one FieldSchema.options holds', () => {
    const parsed = FieldSchema.parse({ type: 'select', options: [{ label: 'Open', value: 'open' }] });
    expect(parsed.options?.[0]).toEqual(expect.objectContaining(SelectOptionSchema.parse({ label: 'Open', value: 'open' })));
  });

  it('every structural key the test names is a real FieldSchema key (the list cannot rot into a no-op)', () => {
    for (const key of STRUCTURAL_FIELD_KEYS) expect(Object.keys(fieldShape), key).toContain(key);
    for (const key of STRUCTURAL_OPTION_KEYS) expect(Object.keys(optionShape), key).toContain(key);
  });

  it('no member is structural', () => {
    const structural = new Set<string>(STRUCTURAL_FIELD_KEYS);
    expect(BASE_FIELD_DISPLAY_WHITELIST.field.filter((k) => structural.has(k))).toEqual([]);
    const structuralOption = new Set<string>(STRUCTURAL_OPTION_KEYS);
    expect(BASE_FIELD_DISPLAY_WHITELIST.option.filter((k) => structuralOption.has(k))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The slot that carries a patch: `ObjectExtensionSchema.fieldPatches`
// (ADR-0146 D10, second rule). Its key sets are derived from the whitelist;
// `field-patches-derived.test.ts` proves a widened whitelist widens it.
// ---------------------------------------------------------------------------

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };

/** Parse an extension carrying `patch` for the base field `industry`; return the issues. */
function patchIssues(patch: unknown): Issue[] {
  const r = ObjectExtensionSchema.safeParse({ extend: 'crm_account', fieldPatches: { industry: patch } });
  return r.success ? [] : (r.error.issues as unknown as Issue[]);
}

describe('`ObjectExtensionSchema.fieldPatches` — the per-field display patch slot', () => {
  it('accepts every field member of the whitelist, read from the constant', () => {
    const patch = Object.fromEntries(BASE_FIELD_DISPLAY_WHITELIST.field.map((k) => [k, `Patched ${k}`]));
    const parsed = ObjectExtensionSchema.parse({ extend: 'crm_account', fieldPatches: { industry: patch } });
    expect(parsed.fieldPatches?.industry).toEqual(patch);
  });

  it.each(BASE_FIELD_DISPLAY_WHITELIST.field.map((k) => [k]))('accepts the field member `%s` on its own', (key) => {
    expect(patchIssues({ [key]: 'Display text' })).toEqual([]);
  });

  it.each(BASE_FIELD_DISPLAY_WHITELIST.option.map((k) => [k]))('accepts the option member `%s`, the option keyed by its stored value', (key) => {
    const parsed = ObjectExtensionSchema.parse({
      extend: 'crm_account',
      fieldPatches: { industry: { options: { tech: { [key]: 'Technology' } } } },
    });
    expect(parsed.fieldPatches?.industry?.options?.tech).toEqual({ [key]: 'Technology' });
  });

  it.each(STRUCTURAL_FIELD_KEYS.filter((k) => k !== 'options').map((k) => [k]))(
    'refuses the structural key `%s` by name, with the D6 prescription naming the whitelist',
    (key) => {
      const issues = patchIssues({ label: 'Sector', [key]: true });
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('unrecognized_keys');
      expect(issues[0]!.path).toEqual(['fieldPatches', 'industry']);
      expect(issues[0]!.keys).toEqual([key]);
      expect(issues[0]!.message).toContain('BASE_FIELD_DISPLAY_WHITELIST');
      expect(issues[0]!.message).toContain('ADR-0146 D6');
    },
  );

  it('refuses `options` membership: the field\'s option LIST is refused, the map keyed by stored value is the only form', () => {
    const issues = patchIssues({ options: [{ label: 'Technology', value: 'tech' }] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('invalid_type');
    expect(issues[0]!.path).toEqual(['fieldPatches', 'industry', 'options']);
    expect(issues[0]!.message).toContain('ADR-0146 D6');
  });

  it('refuses every FieldSchema key the whitelist does not admit — the refused set is derived, not listed', () => {
    const fieldKeys = Object.keys(shapeOf(FieldSchema));
    const admitted = new Set<string>([...BASE_FIELD_DISPLAY_WHITELIST.field, 'options']);
    const refused = fieldKeys.filter((k) => !admitted.has(k));
    expect(refused).toEqual(expect.arrayContaining(STRUCTURAL_FIELD_KEYS.filter((k) => k !== 'options')));
    for (const key of refused) {
      const issues = patchIssues({ [key]: true });
      expect(issues.map((i) => i.code), key).toEqual(['unrecognized_keys']);
      expect(issues[0]!.message, key).toContain('BASE_FIELD_DISPLAY_WHITELIST');
    }
  });

  it('an option patch takes `label` only: the stored `value` is refused with its own prescription', () => {
    const issues = patchIssues({ options: { tech: { label: 'Technology', value: 'technology' } } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('unrecognized_keys');
    expect(issues[0]!.path).toEqual(['fieldPatches', 'industry', 'options', 'tech']);
    expect(issues[0]!.keys).toEqual(['value']);
    expect(issues[0]!.message).toContain('stored value');
    expect(issues[0]!.message).toContain('ADR-0146 D6');
  });

  it('an option patch refuses every other option key with the D6 prescription — derived from the option shape', () => {
    const optionKeys = Object.keys(shapeOf(SelectOptionSchema));
    const refused = optionKeys.filter((k) => !(BASE_FIELD_DISPLAY_WHITELIST.option as readonly string[]).includes(k) && k !== 'value');
    expect(refused.length).toBeGreaterThan(0);
    for (const key of refused) {
      const issues = patchIssues({ options: { tech: { [key]: true } } });
      expect(issues.map((i) => i.code), key).toEqual(['unrecognized_keys']);
      expect(issues[0]!.message, key).toContain('BASE_FIELD_DISPLAY_WHITELIST');
    }
  });

  it('refuses a key spelled as an extension field (`__c`): declare it in `fields`, it is your own field', () => {
    const r = ObjectExtensionSchema.safeParse({ extend: 'crm_account', fieldPatches: { region__c: { label: 'Region' } } });
    expect(r.success).toBe(false);
    const issues = r.success ? [] : (r.error.issues as unknown as Issue[]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.path).toEqual(['fieldPatches', 'region__c']);
    expect(issues[0]!.message).toContain('`fields`');
  });

  it('is pure shape: a field or option the target may not have still parses (the server judges it)', () => {
    expect(patchIssues({ options: { no_such_option: { label: 'Whatever' } } })).toEqual([]);
    expect(ObjectExtensionSchema.safeParse({ extend: 'crm_account', fieldPatches: { no_such_field: { label: 'X' } } }).success).toBe(true);
    expect(patchIssues({})).toEqual([]);
  });

  it('is optional: an extension without it parses to the same output as before the slot', () => {
    const parsed = ObjectExtensionSchema.parse({ extend: 'contact', fields: {} });
    expect(parsed).toEqual({ extend: 'contact', fields: {}, priority: 200 });
    expect('fieldPatches' in parsed).toBe(false);
  });

  it('is live: no `[EXPERIMENTAL — not enforced]` marker, and it names the merge that applies it', () => {
    const description = shapeOf(ObjectExtensionSchema).fieldPatches!.description ?? '';
    expect(description).not.toContain('EXPERIMENTAL');
    expect(description).toContain('mergeObjectDefinitions');
  });
});
