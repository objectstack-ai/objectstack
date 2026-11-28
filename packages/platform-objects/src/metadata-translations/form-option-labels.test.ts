// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A select on a Studio metadata form names its choices by `options[].label`,
// and the server translates them through
// `metadataForms.<type>.fields.<path>.options.<value>`. This reads the SERVED
// bundle (`MetadataFormsTranslations`, after `withSourceFallback`) and the real
// form registry, the pair `/api/v1/meta/types` localizes forms with.

import { describe, it, expect } from 'vitest';
import { METADATA_FORM_REGISTRY, resolveMetadataFormLabels } from '@objectstack/spec/system';
import { MetadataFormsTranslations } from './index.js';

/** Every select row of every registered form that lists `options`, with its dot path. */
function optionRows(): Array<{ type: string; path: string; field: any }> {
  const rows: Array<{ type: string; path: string; field: any }> = [];
  const walk = (field: any, type: string, parent: string): void => {
    if (!field || typeof field !== 'object') return;
    const name = typeof field.field === 'string' ? field.field : undefined;
    const path = name ? (parent ? `${parent}.${name}` : name) : parent;
    if (Array.isArray(field.options) && field.options.length > 0) rows.push({ type, path, field });
    if (Array.isArray(field.fields)) for (const child of field.fields) walk(child, type, path);
  };
  for (const [type, form] of Object.entries<any>(METADATA_FORM_REGISTRY)) {
    for (const section of [...(form.sections ?? []), ...(form.groups ?? [])]) {
      for (const field of section.fields ?? []) walk(field, type, '');
    }
  }
  return rows;
}

const LOCALES = Object.keys(MetadataFormsTranslations).filter((locale) => locale !== 'en');

describe('served metadata forms name select choices in the reader\'s language', () => {
  it('the object form\'s sharing model reads 私有 — 仅所有者 in zh-CN', () => {
    const form = resolveMetadataFormLabels(METADATA_FORM_REGISTRY.object as any, 'object', MetadataFormsTranslations, { locale: 'zh-CN' });
    const sharing = form.sections.flatMap((s: any) => s.fields ?? []).find((f: any) => f?.field === 'sharingModel');
    expect(sharing?.options?.find((o: any) => o.value === 'private')?.label).toBe('私有 — 仅所有者');
    // The English registry the console would otherwise show:
    const source = (METADATA_FORM_REGISTRY.object as any).sections.flatMap((s: any) => s.fields ?? []).find((f: any) => f?.field === 'sharingModel');
    expect(source.options.find((o: any) => o.value === 'private').label).toBe('Private — owner only');
  });

  it('the reading this rests on: there are option rows to translate', () => {
    const rows = optionRows();
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expect(new Set(rows.map((r) => r.type)).size).toBeGreaterThanOrEqual(8);
  });

  for (const locale of LOCALES) {
    it(`${locale}: every choice of every form select is named in the locale, not in English`, () => {
      const untranslated: string[] = [];
      for (const { type, path, field } of optionRows()) {
        const entry = (MetadataFormsTranslations[locale]?.metadataForms as any)?.[type]?.fields?.[path];
        for (const option of field.options) {
          const text = entry?.options?.[option.value];
          if (typeof text !== 'string' || text.length === 0 || text === option.label) untranslated.push(`${type}.${path}.${option.value}`);
        }
      }
      expect(untranslated).toEqual([]);
    });
  }
});
