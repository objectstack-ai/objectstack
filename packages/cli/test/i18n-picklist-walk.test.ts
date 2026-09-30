// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// `picklists.<name>.…` — the extractor walks the shared option-list group.
//
// A picklist is translated once, under the list: every field that references
// it inherits the option labels (`translateObject`), and a picklist-bound field
// declares no `options` of its own, so the field walk emits nothing for it.
// Without this walk `os i18n extract` scaffolded no key for the group and
// `check:i18n-coverage` measured a debt of zero while the labels shipped in
// English (`check:i18n-walk-parity`).

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema } from '@objectstack/spec/system';

const picklistEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path[0] === 'picklists');

const picklistKeys = (config: any): string[] => picklistEntries(config).map((e) => e.path.join('.'));

const config = () => ({
  picklists: [
    {
      name: 'industry',
      label: 'Industry',
      options: [
        { label: 'Technology', value: 'technology' },
        { label: 'Finance', value: 'finance' },
      ],
    },
  ],
  picklistExtensions: [
    { extend: 'industry', options: [{ label: 'Healthcare', value: 'healthcare' }] },
  ],
  objects: [
    {
      name: 'account',
      label: 'Account',
      fields: { industry: { type: 'select', label: 'Industry', picklist: 'industry' } },
    },
  ],
});

describe('i18n extract — the `picklists` group', () => {
  it('walks the list label and every option, an extension\'s options under the extended list', () => {
    expect(picklistKeys(config()).sort()).toEqual([
      'picklists.industry.label',
      'picklists.industry.options.finance',
      'picklists.industry.options.healthcare',
      'picklists.industry.options.technology',
    ]);
  });

  it('seeds each key with the authored literal', () => {
    const byKey = new Map(picklistEntries(config()).map((e) => [e.path.join('.'), e]));
    expect(byKey.get('picklists.industry.label')).toMatchObject({ sourceValue: 'Industry', inline: 'Industry', source: 'picklist' });
    expect(byKey.get('picklists.industry.options.healthcare')).toMatchObject({ sourceValue: 'Healthcare', inline: 'Healthcare' });
  });

  it('seeds an option whose label is its own value, but demands no translation of it', () => {
    const entry = picklistEntries({
      picklists: [{ name: 'tier', label: 'Tier', options: [{ label: 'gold', value: 'gold' }] }],
    }).find((e) => e.path.join('.') === 'picklists.tier.options.gold');
    expect(entry?.sourceValue).toBe('gold');
    expect(entry?.inline).toBeUndefined();
  });

  it('emits no field-level option key for a picklist-bound field', () => {
    const fieldOptionKeys = collectExpectedEntries(config())
      .map((e) => e.path.join('.'))
      .filter((k) => k.startsWith('objects.account.fields.industry.options.'));
    expect(fieldOptionKeys).toEqual([]);
  });

  it('`TranslationDataSchema` accepts a bundle written at the extracted paths', () => {
    const out = extractTranslations(config(), { locales: ['zh-CN'] });
    const zh = (out.bundles['zh-CN'] as any)?.picklists;
    expect(zh?.industry?.label).toBeDefined();
    expect(Object.keys(zh?.industry?.options ?? {}).sort()).toEqual(['finance', 'healthcare', 'technology']);
    expect(TranslationDataSchema.safeParse({ picklists: zh }).success).toBe(true);
  });

  it('reports an untranslated option under its own bucket, `i18n/missing-picklist`', () => {
    const report = computeI18nCoverage({
      ...config(),
      i18n: { supportedLocales: ['en', 'zh-CN'] },
      translations: [
        { 'zh-CN': { picklists: { industry: { label: '行业', options: { technology: '科技' } } } } },
      ],
    });
    const issues = report.issues.filter((i) => i.key.startsWith('picklists.'));
    const keys = issues.map((i) => i.key);
    expect(keys).toContain('picklists.industry.options.finance');
    expect(keys).not.toContain('picklists.industry.options.technology');
    expect(keys).not.toContain('picklists.industry.label');
    expect(issues.every((i) => i.source === 'picklist')).toBe(true);
  });
});
