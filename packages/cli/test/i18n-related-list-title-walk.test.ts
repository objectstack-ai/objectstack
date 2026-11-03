// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A lookup / master-detail field's related-list title
// (`objects.<child>.fields.<field>.relatedListTitle`) is an authored,
// user-visible label: the parent record page heads the derived related list
// with it. It is served through `translateObject`, so without this walk
// `os i18n extract` scaffolded no key for it and `os i18n check` measured a
// debt of zero while a zh-CN user read it in English.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema } from '@objectstack/spec/system';

const config = () => ({
  objects: [
    {
      name: 'contract',
      label: 'Contract',
      fields: {
        // A lookup from the object back to itself: its related list sits on a
        // contract's own record page.
        renewed_from: { type: 'lookup', label: 'Renewed From', reference: 'contract', relatedListTitle: 'Renewals' },
        // No relatedListTitle: the list is headed by the child's label, nothing to demand.
        amended_from: { type: 'lookup', label: 'Amended From', reference: 'contract' },
      },
    },
  ],
});

const byKey = () => new Map(collectExpectedEntries(config()).map((e) => [e.path.join('.'), e]));

describe('i18n extract — a field\'s relatedListTitle', () => {
  it('walks the title on the child field that declares it, and only there', () => {
    const entries = byKey();
    expect(entries.get('objects.contract.fields.renewed_from.relatedListTitle'))
      .toMatchObject({ sourceValue: 'Renewals', inline: 'Renewals', source: 'field' });
    expect(entries.get('objects.contract.fields.amended_from.relatedListTitle')?.inline).toBeUndefined();
  });

  it('`TranslationDataSchema` accepts a bundle written at the extracted path', () => {
    const out = extractTranslations(config(), { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(zh?.objects?.contract?.fields?.renewed_from?.relatedListTitle).toBeDefined();
    expect(TranslationDataSchema.safeParse({ objects: zh.objects }).success).toBe(true);
  });
});

describe('i18n check — a field\'s relatedListTitle', () => {
  it('reports an untranslated title, and clears it once translated', () => {
    const coverage = (translations: unknown[]) => computeI18nCoverage({
      ...config(),
      i18n: { supportedLocales: ['en', 'zh-CN'] },
      translations,
    } as any).issues.filter((i) => i.locale === 'zh-CN').map((i) => i.key);

    const before = coverage([{ 'zh-CN': { objects: { contract: { label: '合同' } } } }]);
    expect(before).toContain('objects.contract.fields.renewed_from.relatedListTitle');
    // Nothing authored ⇒ nothing to translate.
    expect(before).not.toContain('objects.contract.fields.amended_from.relatedListTitle');

    const after = coverage([{
      'zh-CN': { objects: { contract: { label: '合同', fields: { renewed_from: { relatedListTitle: '续签合同' } } } } },
    }]);
    expect(after).not.toContain('objects.contract.fields.renewed_from.relatedListTitle');
  });
});
