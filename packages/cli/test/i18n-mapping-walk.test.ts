// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// `mappings.<name>.label` — the extractor walks a named import mapping's
// translation group (#34939).
//
// The import wizard offers a shipped mapping by its label, and
// `translateMapping` overlays it from the bundle. Without this walk
// `os i18n extract` would scaffold no key for it and `os i18n check` would
// measure a debt of zero while the wizard showed the authoring language.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-bundle-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema } from '@objectstack/spec/system';

const config = () => ({
  mappings: [
    {
      name: 'lead_feed',
      label: 'Lead feed (CSV)',
      targetObject: 'lead',
      fieldMapping: [{ source: 'Company', target: 'company' }],
    },
    { name: 'contact_feed', label: 'Contact feed', targetObject: 'contact', fieldMapping: [] },
    // No label: nothing an author wrote, so nothing is demanded.
    { name: 'unlabelled_feed', targetObject: 'lead', fieldMapping: [] },
  ],
});

describe('i18n extract — the `mappings` group', () => {
  it('walks each mapping\'s label, and nothing of its field mapping', () => {
    const keys = collectExpectedEntries(config())
      .filter((e) => e.path[0] === 'mappings')
      .map((e) => e.path.join('.'))
      .sort();
    expect(keys).toEqual(['mappings.contact_feed.label', 'mappings.lead_feed.label', 'mappings.unlabelled_feed.label']);
  });

  it('`TranslationDataSchema` accepts a bundle written at the extracted paths', () => {
    const out = extractTranslations(config(), { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(Object.keys(zh?.mappings ?? {}).sort()).toEqual(['contact_feed', 'lead_feed', 'unlabelled_feed']);
    expect(TranslationDataSchema.safeParse({ mappings: zh.mappings }).success).toBe(true);
  });

  it('reports an untranslated label under its own bucket', () => {
    const report = computeI18nCoverage({
      ...config(),
      i18n: { supportedLocales: ['en', 'zh-CN'] },
      translations: [{ 'zh-CN': { mappings: { lead_feed: { label: '线索导入（CSV）' } } } }],
    });
    const zhIssues = report.issues.filter((i) => i.locale === 'zh-CN');
    const missing = zhIssues.map((i) => i.key);
    expect(missing).toContain('mappings.contact_feed.label');
    expect(missing).not.toContain('mappings.lead_feed.label');
    // Nothing authored ⇒ nothing to translate.
    expect(missing).not.toContain('mappings.unlabelled_feed.label');
    expect(zhIssues.find((i) => i.key === 'mappings.contact_feed.label')?.source).toBe('mapping');
  });
});
