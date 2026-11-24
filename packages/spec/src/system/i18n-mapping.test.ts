// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `mappings.<name>.label` — a named import mapping's translation group, and
// the translator that overlays it on the served `mapping` document.
//
// Before this group existed a shipped import mapping showed its authored
// label in every locale: the console's import wizard offers mappings by label
// (`GET /meta/mapping`), the label is a plain string on the mapping, and the
// bundle had no key for it.

import { describe, it, expect } from 'vitest';
import {
  TranslationDataSchema,
  TranslationItemSchema,
  PlatformTranslationDataSchema,
  ServedTranslationDataSchema,
  type TranslationBundle,
} from './translation.zod';
import { translateMetadataDocument, translateMapping, TRANSLATABLE_METADATA_TYPES } from './i18n-resolver';
// The fixture is PARSED by the authoring schema rather than hand-shaped, so a
// translator reading a member the schema does not carry cannot pass here.
import { MappingSchema } from '../data/mapping.zod';

const mapping = () => MappingSchema.parse({
  name: 'weekly_supply_import',
  label: 'Weekly Supply Import (CSV)',
  sourceFormat: 'csv',
  targetObject: 'supply_plan',
  fieldMapping: [
    { source: 'Week', target: 'supply_week' },
    { source: 'Reserved', target: 'domestic_reserved_qty' },
  ],
}) as any;

const bundle: TranslationBundle = {
  'zh-CN': { mappings: { weekly_supply_import: { label: '每周供应导入（CSV）' } } },
};

describe('TranslationDataSchema — mappings', () => {
  it('opens at every door — bundle entry, platform bundle, served document and registered item', () => {
    expect(TranslationDataSchema.safeParse(bundle['zh-CN']).success).toBe(true);
    expect(PlatformTranslationDataSchema.safeParse(bundle['zh-CN']).success).toBe(true);
    expect(ServedTranslationDataSchema.safeParse(bundle['zh-CN']).success).toBe(true);
    expect(TranslationItemSchema.safeParse({ locale: 'zh-CN', ...bundle['zh-CN'] }).success).toBe(true);
  });

  it('closes the face at the mapping\'s `label`', () => {
    const result = TranslationDataSchema.safeParse({ mappings: { weekly_supply_import: { icon: 'csv' } } });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('renames the singular and the label\'s aliases onto the declared keys', () => {
    expect(() => TranslationDataSchema.parse({ mapping: { m: { label: 'x' } } })).toThrow(/mappings/);
    expect(() => TranslationDataSchema.parse({ mappings: { m: { title: 'x' } } })).toThrow(/label/);
    expect(() => TranslationItemSchema.parse({ locale: 'zh-CN', mapping: { m: { label: 'x' } } })).toThrow(/mappings/);
  });

  it('names why `description` and `fieldMapping` have no key, rather than suggesting one', () => {
    const description = TranslationDataSchema.safeParse({ mappings: { m: { description: 'x' } } });
    expect(description.success).toBe(false);
    expect(JSON.stringify(description.error!.issues)).toContain('declares no `description`');
    const fields = TranslationDataSchema.safeParse({ mappings: { m: { fieldMapping: {} } } });
    expect(fields.success).toBe(false);
    expect(JSON.stringify(fields.error!.issues)).toContain('objects.<object>.fields.<field>.label');
  });
});

describe('translateMapping', () => {
  it('is registered in the dispatch table, so the REST boundary follows', () => {
    // `TRANSLATABLE_METADATA_TYPES` is DERIVED from the dispatch table and
    // `@objectstack/rest` reads it: `GET /meta/mapping` (list and item) is
    // localized with no further wiring.
    expect(TRANSLATABLE_METADATA_TYPES.has('mapping')).toBe(true);
  });

  it('a zh-CN reader gets the translated label; identity and field mapping ride through', () => {
    const doc = mapping();
    const out = translateMetadataDocument('mapping', doc, bundle, { locale: 'zh-CN' }) as any;
    expect(out.label).toBe('每周供应导入（CSV）');
    expect(out.name).toBe('weekly_supply_import');
    expect(out.fieldMapping).toBe(doc.fieldMapping);
  });

  it('an en-US reader is unchanged — the same reference, the authored label', () => {
    const doc = mapping();
    expect(translateMapping(doc, bundle, { locale: 'en-US' })).toBe(doc);
    expect(translateMapping(doc, undefined, { locale: 'zh-CN' })).toBe(doc);
  });

  it('reads only its own mapping\'s entry, and applies the BCP-47 ladder and the fallback chain', () => {
    const other = MappingSchema.parse({ name: 'other_import', label: 'Other', targetObject: 'supply_plan', fieldMapping: [] }) as any;
    expect(translateMapping(other, bundle, { locale: 'zh-CN' })).toBe(other);
    expect((translateMapping(mapping(), bundle, { locale: 'zh' }) as any).label).toBe('每周供应导入（CSV）');
    expect((translateMapping(mapping(), bundle, { locale: 'fr-FR', fallbackChain: ['zh-CN'] }) as any).label).toBe('每周供应导入（CSV）');
  });

  it('an empty translated label is no translation — the authored label stands', () => {
    const doc = mapping();
    const empty: TranslationBundle = { 'zh-CN': { mappings: { weekly_supply_import: { label: '' } } } };
    expect(translateMapping(doc, empty, { locale: 'zh-CN' })).toBe(doc);
  });

  it('does not mutate the input', () => {
    const doc = mapping();
    const before = JSON.parse(JSON.stringify(doc));
    translateMapping(doc, bundle, { locale: 'zh-CN' });
    expect(doc).toEqual(before);
  });
});
