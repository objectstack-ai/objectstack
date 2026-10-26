// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// `reports.<name>.…` — the extractor walks the report translation group.
//
// A report is listed by its label and description on the app's report index,
// and headed by its label on the report page. Both are served through
// `translateReport`, so without this walk `os i18n extract` scaffolded no key
// for them and `os i18n check` measured a debt of zero while every report
// listed in the authoring language.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema } from '@objectstack/spec/system';

const config = () => ({
  reports: [
    {
      name: 'opps_by_stage',
      label: 'Opportunities by Stage',
      description: 'Summary of opportunities grouped by stage',
      type: 'summary',
      dataset: 'pipeline',
      rows: ['stage'],
      values: ['amount'],
    },
    // No description: nothing an author wrote, so nothing is demanded.
    { name: 'leads_by_source', label: 'Leads by Source', type: 'summary', dataset: 'leads', values: ['n'] },
  ],
});

const keysOf = (group: string) =>
  collectExpectedEntries(config())
    .filter((e) => e.path[0] === group)
    .map((e) => e.path.join('.'))
    .sort();

describe('i18n extract — the `reports` group', () => {
  it('walks each report\'s label and description', () => {
    expect(keysOf('reports')).toEqual([
      'reports.leads_by_source.description',
      'reports.leads_by_source.label',
      'reports.opps_by_stage.description',
      'reports.opps_by_stage.label',
    ]);
  });

  it('seeds authored text and records an unwritten string without demanding it', () => {
    const byKey = new Map(collectExpectedEntries(config()).map((e) => [e.path.join('.'), e]));
    expect(byKey.get('reports.opps_by_stage.label'))
      .toMatchObject({ sourceValue: 'Opportunities by Stage', inline: 'Opportunities by Stage', source: 'report' });
    expect(byKey.get('reports.opps_by_stage.description'))
      .toMatchObject({ sourceValue: 'Summary of opportunities grouped by stage', source: 'report' });
    const unwritten = byKey.get('reports.leads_by_source.description');
    expect(unwritten?.sourceValue).toBeUndefined();
    expect(unwritten?.inline).toBeUndefined();
  });

  it('`TranslationDataSchema` accepts a bundle written at the extracted paths', () => {
    const out = extractTranslations(config(), { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(Object.keys(zh?.reports ?? {}).sort()).toEqual(['leads_by_source', 'opps_by_stage']);
    expect(zh?.reports?.opps_by_stage?.label).toBeDefined();
    expect(TranslationDataSchema.safeParse({ reports: zh.reports }).success).toBe(true);
  });

  it('reports an untranslated label under its own bucket', () => {
    const report = computeI18nCoverage({
      ...config(),
      i18n: { supportedLocales: ['en', 'zh-CN'] },
      translations: [
        { 'zh-CN': { reports: { opps_by_stage: { label: '各阶段商机', description: '按阶段汇总的商机' } } } },
      ],
    });
    const zhIssues = report.issues.filter((i) => i.locale === 'zh-CN');
    const keys = zhIssues.map((i) => i.key);
    expect(keys).toContain('reports.leads_by_source.label');
    expect(keys).not.toContain('reports.opps_by_stage.label');
    expect(keys).not.toContain('reports.opps_by_stage.description');
    // Nothing authored ⇒ nothing to translate.
    expect(keys).not.toContain('reports.leads_by_source.description');
    expect(zhIssues.find((i) => i.key === 'reports.leads_by_source.label')?.source).toBe('report');
  });
});
