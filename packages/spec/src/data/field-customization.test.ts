// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D10 — the `__c` reservation and the base-field display-property
 * whitelist, measured against `FieldSchema`.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { BASE_FIELD_DISPLAY_WHITELIST, EXTENSION_FIELD_SUFFIX, isExtensionFieldName } from './field-customization';
import { FieldSchema, SelectOptionSchema } from './field.zod';

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
