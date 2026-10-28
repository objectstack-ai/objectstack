// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// `books.<name>.…` — the extractor walks a doc book's translation group.
//
// A book's title and section titles frame every page of a docs sidebar, and
// `translateBook` overlays them from the bundle. Without this walk
// `os i18n extract` would scaffold no key for them and `os i18n check` would
// measure a debt of zero while the sidebar shipped in the authoring language.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema } from '@objectstack/spec/system';

const config = () => ({
  books: [
    {
      name: 'crm_manual',
      label: 'User Manual',
      description: 'Everything a sales rep needs',
      groups: [
        { key: 'start', label: 'Getting started', include: 'crm_start_*' },
        { key: 'pipeline', label: 'Pipeline', include: 'crm_pipe_*' },
      ],
    },
    // No label, no description: nothing an author wrote, so nothing is demanded.
    { name: 'crm_admin_manual', groups: [{ key: 'setup', label: 'Setup' }] },
  ],
});

const keys = () =>
  collectExpectedEntries(config())
    .filter((e) => e.path[0] === 'books')
    .map((e) => e.path.join('.'))
    .sort();

describe('i18n extract — the `books` group', () => {
  it('walks each book\'s label, description and every group label by its key', () => {
    expect(keys()).toEqual([
      'books.crm_admin_manual.description',
      'books.crm_admin_manual.groups.setup.label',
      'books.crm_admin_manual.label',
      'books.crm_manual.description',
      'books.crm_manual.groups.pipeline.label',
      'books.crm_manual.groups.start.label',
      'books.crm_manual.label',
    ]);
  });

  it('seeds authored text and records an unwritten string without demanding it', () => {
    const byKey = new Map(collectExpectedEntries(config()).map((e) => [e.path.join('.'), e]));
    expect(byKey.get('books.crm_manual.label'))
      .toMatchObject({ sourceValue: 'User Manual', inline: 'User Manual', source: 'book' });
    expect(byKey.get('books.crm_manual.groups.start.label'))
      .toMatchObject({ sourceValue: 'Getting started', inline: 'Getting started', source: 'book' });
    const unwritten = byKey.get('books.crm_admin_manual.label');
    expect(unwritten?.sourceValue).toBeUndefined();
    expect(unwritten?.inline).toBeUndefined();
  });

  it('`TranslationDataSchema` accepts a bundle written at the extracted paths', () => {
    const out = extractTranslations(config(), { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(Object.keys(zh?.books ?? {}).sort()).toEqual(['crm_admin_manual', 'crm_manual']);
    expect(Object.keys(zh?.books?.crm_manual?.groups ?? {}).sort()).toEqual(['pipeline', 'start']);
    expect(TranslationDataSchema.safeParse({ books: zh.books }).success).toBe(true);
  });

  it('reports an untranslated label under its own bucket', () => {
    const report = computeI18nCoverage({
      ...config(),
      i18n: { supportedLocales: ['en', 'zh-CN'] },
      translations: [
        { 'zh-CN': { books: { crm_manual: { label: '使用手册', groups: { start: { label: '快速上手' } } } } } },
      ],
    });
    const zhIssues = report.issues.filter((i) => i.locale === 'zh-CN');
    const missing = zhIssues.map((i) => i.key);
    expect(missing).toContain('books.crm_manual.groups.pipeline.label');
    expect(missing).toContain('books.crm_manual.description');
    expect(missing).toContain('books.crm_admin_manual.groups.setup.label');
    expect(missing).not.toContain('books.crm_manual.label');
    expect(missing).not.toContain('books.crm_manual.groups.start.label');
    // Nothing authored ⇒ nothing to translate.
    expect(missing).not.toContain('books.crm_admin_manual.label');
    expect(zhIssues.find((i) => i.key === 'books.crm_manual.groups.pipeline.label')?.source).toBe('book');
  });
});
