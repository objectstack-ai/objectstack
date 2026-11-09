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
import { ObjectExtensionSchema, ObjectSchema } from './object.zod';

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
  'referenceNameVisible',
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

// ---------------------------------------------------------------------------
// What the slot refuses beyond its key sets (ADR-0146 D10): a field the same
// extension replaces, an option key no option can carry, and `__proto__`; and
// the renames it carries from the shapes it patches. Each refusal names its
// code, path and subject, beside a control through the same parse.
// ---------------------------------------------------------------------------

/** Parse an extension body as the save door does: a JSON document, so `__proto__` is an own key. */
function jsonIssues(json: string): Issue[] {
  const r = ObjectExtensionSchema.safeParse(JSON.parse(json));
  return r.success ? [] : (r.error.issues as unknown as Issue[]);
}

const INDUSTRY_FIELD = { name: 'industry', type: 'text', label: 'Industry' } as const;

describe('`fieldPatches` — what the slot refuses beyond its keys, and the renames it carries', () => {
  it('refuses a field the same extension both replaces in `fields` and patches: patch it or declare your own, not both', () => {
    const r = ObjectExtensionSchema.safeParse({
      extend: 'crm_account',
      fields: { industry: INDUSTRY_FIELD },
      fieldPatches: { industry: { label: 'Sector' } },
    });
    expect(r.success).toBe(false);
    const issues = r.success ? [] : (r.error.issues as unknown as Issue[]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.path).toEqual(['fieldPatches', 'industry']);
    expect(issues[0]!.message).toMatch(/^`industry` is both replaced in `fields` and patched in `fieldPatches`/);
    expect(issues[0]!.message).toContain('not both');
  });

  it('control: a patch beside a `fields` entry of ANOTHER name parses', () => {
    const r = ObjectExtensionSchema.safeParse({
      extend: 'crm_account',
      fields: { region: { name: 'region', type: 'text', label: 'Region' } },
      fieldPatches: { industry: { label: 'Sector' } },
    });
    expect(r.success).toBe(true);
  });

  it('a `__c` key in both is refused once, by the `__c` rule, whose prescription already names `fields`', () => {
    const r = ObjectExtensionSchema.safeParse({
      extend: 'crm_account',
      fields: { region__c: { name: 'region__c', type: 'text', label: 'Region' } },
      fieldPatches: { region__c: { label: 'Region' } },
    });
    const issues = r.success ? [] : (r.error.issues as unknown as Issue[]);
    expect(issues.map((i) => [i.code, i.path.join('.')])).toEqual([['custom', 'fieldPatches.region__c']]);
    expect(issues[0]!.message).toContain('spelled as an extension field');
  });

  it('refuses an option key no option can carry: the map is keyed by `SelectOptionSchema.shape.value`', () => {
    const issues = patchIssues({ options: { 'Tech Sector': { label: 'Tech' } } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('invalid_key');
    expect(issues[0]!.path).toEqual(['fieldPatches', 'industry', 'options', 'Tech Sector']);
    expect(issues[0]!.message).toMatch(/^`Tech Sector` cannot be an option's stored value/);
  });

  it('control: every key the option `value` grammar admits is accepted, and the key schema IS that grammar', () => {
    expect(patchIssues({ options: { technology: { label: 'Tech' }, 'sector.retail_2': { label: 'Retail' } } })).toEqual([]);
    for (const key of ['technology', 'Tech Sector', 'x', '2nd']) {
      expect(patchIssues({ options: { [key]: { label: 'L' } } }).length === 0, key)
        .toBe(SelectOptionSchema.shape.value.safeParse(key).success);
    }
  });

  it.each([
    ['fields', '{"extend":"crm_account","fields":{"__proto__":{"name":"x","type":"text","label":"X"}}}', ['fields', '__proto__']],
    ['fieldPatches', '{"extend":"crm_account","fieldPatches":{"__proto__":{"label":"X"}}}', ['fieldPatches', '__proto__']],
    ['options', '{"extend":"crm_account","fieldPatches":{"industry":{"options":{"__proto__":{"label":"X"}}}}}', ['fieldPatches', 'industry', 'options', '__proto__']],
  ])('refuses a `__proto__` own key in `%s`, which zod would drop while reporting success', (slot, json, path) => {
    const issues = jsonIssues(json);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.path).toEqual(path);
    expect(issues[0]!.message).toMatch(new RegExp(`^\`${slot}\` cannot contain a key named "__proto__"`));
  });

  it('control: the same JSON documents without `__proto__` parse, and keep every key', () => {
    const parsed = ObjectExtensionSchema.parse(JSON.parse(
      '{"extend":"crm_account","fields":{"region":{"name":"region","type":"text","label":"Region"}},' +
      '"fieldPatches":{"industry":{"options":{"technology":{"label":"Tech"}}}}}',
    ));
    expect(Object.keys(parsed.fields ?? {})).toEqual(['region']);
    expect(parsed.fieldPatches?.industry?.options).toEqual({ technology: { label: 'Tech' } });
  });

  it.each([
    ['helpText', 'inlineHelpText'],
    ['tooltip', 'inlineHelpText'],
    ['title', 'label'],
    ['displayName', 'label'],
  ])('a field patch carries the field\'s rename `%s` → `%s`', (written, target) => {
    const issues = patchIssues({ [written]: 'Display text' });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('unrecognized_keys');
    expect(issues[0]!.keys).toEqual([written]);
    expect(issues[0]!.message).toContain(`\`${written}\` → \`${target}\``);
  });

  it.each([['text'], ['name'], ['title']])('an option patch carries the option\'s rename `%s` → `label`', (written) => {
    const issues = patchIssues({ options: { technology: { [written]: 'Tech' } } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('unrecognized_keys');
    expect(issues[0]!.path).toEqual(['fieldPatches', 'industry', 'options', 'technology']);
    expect(issues[0]!.message).toContain(`\`${written}\` → \`label\``);
  });

  it('control: a rename whose target the patch refuses is not carried (no `isRequired` → `required`, no `key` → `value`)', () => {
    const field = patchIssues({ isRequired: true });
    expect(field.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(field[0]!.message).not.toContain('→');
    const option = patchIssues({ options: { technology: { key: 'tech' } } });
    expect(option.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(option[0]!.message).not.toContain('→');
    // `colour` → `color` is carried only once the whitelist admits `color` (`field-patches-derived.test.ts`).
    const colour = patchIssues({ options: { technology: { colour: '#2563eb' } } });
    expect(colour.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(colour[0]!.message).not.toContain('`colour` → `color`');
  });

  it('the description lists the whitelist\'s members, read from the constant', () => {
    const description = shapeOf(ObjectExtensionSchema).fieldPatches!.description ?? '';
    for (const key of [...BASE_FIELD_DISPLAY_WHITELIST.field, ...BASE_FIELD_DISPLAY_WHITELIST.option]) {
      expect(description, key).toContain(`\`${key}\``);
    }
  });
});

/** Parse an extension whose `fieldPatches` is `fieldPatches`; return the issues. */
function fieldPatchesIssues(fieldPatches: Record<string, unknown>): Issue[] {
  const r = ObjectExtensionSchema.safeParse({ extend: 'crm_account', fieldPatches });
  return r.success ? [] : (r.error.issues as unknown as Issue[]);
}

/** Does `ObjectSchema.fields` admit `key` as a field name? Read off its own parse, so the grammar is not restated. */
function objectFieldsAdmit(key: string): boolean {
  const r = ObjectSchema.safeParse({ name: 'crm_account', label: 'Account', fields: { [key]: { type: 'text', label: 'X' } } });
  const issues = r.success ? [] : (r.error.issues as unknown as Issue[]);
  return !issues.some((i) => i.code === 'invalid_key' && i.path.join('.') === `fields.${key}`);
}

describe('`fieldPatches` keys — the field map\'s own key grammar', () => {
  it.each([['Industry'], ['Annual Revenue'], ['annual-revenue'], ['2nd_phone']])(
    'refuses `%s`, which no field name can be: one `invalid_key` at its key, naming the grammar and an example',
    (key) => {
      const issues = fieldPatchesIssues({ [key]: { label: 'Sector' } });
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('invalid_key');
      expect(issues[0]!.path).toEqual(['fieldPatches', key]);
      expect(issues[0]!.message).toMatch(new RegExp(`^\`${key}\` cannot be a field name`));
      expect(issues[0]!.message).toContain('lowercase snake_case such as `industry`');
      expect(issues[0]!.message).not.toMatch(/#\d{3,}/);
    },
  );

  it('control: a snake_case key parses, and so does a `__c` key, which stays the `__c` rule\'s to refuse', () => {
    expect(fieldPatchesIssues({ annual_revenue: { label: 'Revenue' } })).toEqual([]);
    const issues = fieldPatchesIssues({ region__c: { label: 'Region' } });
    expect(issues.map((i) => [i.code, i.path.join('.')])).toEqual([['custom', 'fieldPatches.region__c']]);
  });

  it('control: the authored example of the object-extension guide still parses whole', () => {
    // `content/docs/data-modeling/object-extensions.mdx`, "Relabelling a vendor field".
    const parsed = ObjectExtensionSchema.parse({
      extend: 'crm_account',
      fieldPatches: {
        industry: {
          label: 'Sector',
          inlineHelpText: 'The market the account sells into.',
          options: { technology: { label: 'Tech' } },
        },
      },
    });
    expect(parsed.fieldPatches?.industry?.label).toBe('Sector');
  });

  it('the key schema IS the one `ObjectSchema.fields` reads: both admit exactly the same keys', () => {
    const keys = ['industry', 'annual_revenue', '_internal', 'region__c', 'a1', 'Industry', 'Annual Revenue', 'annual-revenue', '2nd_phone', 'industryName', ''];
    const admitted = keys.filter((key) => objectFieldsAdmit(key));
    // Guard against a vacuous agreement: the sample holds keys on both sides of the grammar.
    expect(admitted.length).toBeGreaterThan(0);
    expect(admitted.length).toBeLessThan(keys.length);
    for (const key of keys) {
      const refusedAtKey = fieldPatchesIssues({ [key]: { label: 'L' } })
        .some((i) => i.code === 'invalid_key' && i.path.join('.') === `fieldPatches.${key}`);
      expect(refusedAtKey, key).toBe(!admitted.includes(key));
    }
  });
});

/** Parse an extension whose `fields` is `fields`; return the issues. */
function extensionFieldsIssues(fields: Record<string, unknown>): Issue[] {
  const r = ObjectExtensionSchema.safeParse({ extend: 'crm_account', fields });
  return r.success ? [] : (r.error.issues as unknown as Issue[]);
}

describe('extension `fields` keys — the field map\'s own key grammar', () => {
  it.each([['Region Code'], ['RegionCode'], ['region-code'], ['2nd_phone'], ['Region Code__c']])(
    'refuses `%s`, which no field name can be: one `invalid_key` at its key, naming the grammar and an example',
    (key) => {
      const issues = extensionFieldsIssues({ [key]: { type: 'text', label: 'Region' } });
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('invalid_key');
      expect(issues[0]!.path).toEqual(['fields', key]);
      expect(issues[0]!.message.startsWith(`\`${key}\` cannot be a field name`)).toBe(true);
      expect(issues[0]!.message).toContain('lowercase snake_case such as `region_code`');
      expect(issues[0]!.message).not.toMatch(/#\d{3,}/);
    },
  );

  it('control: a snake_case key parses, and so does one spelled `__c` (the suffix is judged at the doors)', () => {
    expect(extensionFieldsIssues({ region_code: { type: 'text', label: 'Region' } })).toEqual([]);
    expect(extensionFieldsIssues({ region_code__c: { type: 'text', label: 'Region' } })).toEqual([]);
  });

  it('control: the authored examples of the object-extension guide still parse whole', () => {
    // `content/docs/data-modeling/object-extensions.mdx`, the declaration and the worked example.
    const declared = ObjectExtensionSchema.parse({
      extend: 'showcase_account',
      fields: {
        loyalty_tier: { type: 'select', label: 'Loyalty Tier', options: [{ label: 'Gold', value: 'gold' }] },
        csat_score: { type: 'number', label: 'CSAT Score', min: 0, max: 100 },
      },
      priority: 210,
    });
    expect(Object.keys(declared.fields ?? {})).toEqual(['loyalty_tier', 'csat_score']);
    const worked = ObjectExtensionSchema.parse({
      extend: 'crm_account',
      fields: {
        cs_health_score: { type: 'number', label: 'Health Score', min: 0, max: 100 },
        cs_renewal_date: { type: 'date', label: 'Renewal Date' },
        cs_owner: { type: 'text', label: 'Success Manager' },
      },
      indexes: [{ name: 'idx_crm_account_cs_renewal', fields: ['cs_renewal_date'] }],
      priority: 300,
    });
    expect(Object.keys(worked.fields ?? {})).toEqual(['cs_health_score', 'cs_renewal_date', 'cs_owner']);
  });

  it('the key schema IS the one `ObjectSchema.fields` reads: both admit exactly the same grammar', () => {
    // `constructor` / `prototype` are left out: `ObjectSchema.fields` refuses them by record refines, outside the key schema.
    const keys = ['region', 'region_code', '_internal', 'region__c', 'a1', 'Region', 'Region Code', 'region-code', '2nd_phone', 'regionCode', ''];
    const admitted = keys.filter((key) => objectFieldsAdmit(key));
    // Guard against a vacuous agreement: the sample holds keys on both sides of the grammar.
    expect(admitted.length).toBeGreaterThan(0);
    expect(admitted.length).toBeLessThan(keys.length);
    for (const key of keys) {
      const refusedAtKey = extensionFieldsIssues({ [key]: { type: 'text', label: 'L' } })
        .some((i) => i.code === 'invalid_key' && i.path.join('.') === `fields.${key}`);
      expect(refusedAtKey, key).toBe(!admitted.includes(key));
    }
  });
});
