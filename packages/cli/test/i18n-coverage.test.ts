// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';

const baseConfig: any = {
  objects: [
    {
      name: 'account',
      label: 'Account',
      pluralLabel: 'Accounts',
      fields: {
        name: { label: 'Name' },
        type: {
          label: 'Type',
          options: { customer: 'Customer', partner: 'Partner' },
        },
      },
    },
  ],
  views: [
    { name: 'all_accounts', label: 'All Accounts', objectName: 'account' },
    { name: 'data_form', label: 'Data Object View', data: { object: 'account' } },
  ],
  actions: [
    {
      name: 'merge_accounts',
      label: 'Merge Accounts',
      objectName: 'account',
      confirmText: 'Merge?',
      successMessage: 'Merged.',
    },
    {
      name: 'export_csv',
      label: 'Export CSV',
      successMessage: 'Done.',
    },
  ],
  translations: [
    {
      en: {
        objects: {
          account: {
            label: 'Account',
            pluralLabel: 'Accounts',
            fields: {
              name: { label: 'Name' },
              type: {
                label: 'Type',
                options: { customer: 'Customer', partner: 'Partner' },
              },
            },
            _views: {
              all_accounts: { label: 'All Accounts' },
              data_form: { label: 'Data Object View' },
            },
            _actions: {
              merge_accounts: {
                label: 'Merge Accounts',
                confirmText: 'Merge?',
                successMessage: 'Merged.',
              },
            },
          },
        },
        globalActions: {
          export_csv: { label: 'Export CSV', successMessage: 'Done.' },
        },
      },
      'zh-CN': {
        objects: {
          account: {
            label: '客户',
            pluralLabel: '客户',
            fields: {
              name: { label: '名称' },
              // type label + options missing
            },
            _views: {
              all_accounts: { label: '全部客户' },
              // data_form missing
            },
            _actions: {
              merge_accounts: {
                label: '合并客户',
                // confirmText + successMessage missing
              },
            },
          },
        },
        // globalActions missing entirely
      },
    },
  ],
};

describe('computeI18nCoverage', () => {
  it('reports 100% coverage for the default locale when bundle is complete', () => {
    const report = computeI18nCoverage(baseConfig, { defaultLocale: 'en' });
    // metadataForms.* keys come from the global METADATA_FORM_REGISTRY and
    // are not provided by this minimal test bundle. Limit the assertion to
    // object/view/action-source keys (what this fixture exercises).
    const objectSources = new Set(['object', 'field', 'option', 'view', 'action', 'globalAction']);
    const enObjectErrors = report.issues.filter(
      (i) => i.locale === 'en' && objectSources.has(i.source) && i.severity === 'error',
    );
    expect(enObjectErrors).toEqual([]);
  });

  it('flags missing keys in zh-CN as warnings (default-locale only mode)', () => {
    const report = computeI18nCoverage(baseConfig, { defaultLocale: 'en' });
    const zh = report.stats.find((s) => s.locale === 'zh-CN')!;
    expect(zh.missing).toBeGreaterThan(0);
    expect(zh.coveragePercent).toBeLessThan(100);
    const zhIssues = report.issues.filter((i) => i.locale === 'zh-CN');
    expect(zhIssues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('detects every missing key shape', () => {
    const report = computeI18nCoverage(baseConfig, { defaultLocale: 'en' });
    const zhKeys = new Set(report.issues.filter((i) => i.locale === 'zh-CN').map((i) => i.key));
    expect(zhKeys.has('objects.account.fields.type.label')).toBe(true);
    expect(zhKeys.has('objects.account.fields.type.options.customer')).toBe(true);
    expect(zhKeys.has('objects.account.fields.type.options.partner')).toBe(true);
    expect(zhKeys.has('objects.account._views.data_form.label')).toBe(true);
    expect(zhKeys.has('objects.account._actions.merge_accounts.confirmText')).toBe(true);
    expect(zhKeys.has('objects.account._actions.merge_accounts.successMessage')).toBe(true);
    expect(zhKeys.has('globalActions.export_csv.label')).toBe(true);
    expect(zhKeys.has('globalActions.export_csv.successMessage')).toBe(true);
  });

  it('promotes warnings to errors under --strict', () => {
    const report = computeI18nCoverage(baseConfig, { defaultLocale: 'en', strict: true });
    const zhIssues = report.issues.filter((i) => i.locale === 'zh-CN');
    expect(zhIssues.length).toBeGreaterThan(0);
    expect(zhIssues.every((i) => i.severity === 'error')).toBe(true);
    expect(report.totals.errors).toBeGreaterThan(0);
  });

  it('raises errors when the default locale itself is incomplete', () => {
    const incomplete = JSON.parse(JSON.stringify(baseConfig));
    delete incomplete.translations[0].en.objects.account._actions.merge_accounts.label;
    const report = computeI18nCoverage(incomplete, { defaultLocale: 'en' });
    const enErrors = report.issues.filter((i) => i.locale === 'en' && i.severity === 'error');
    expect(enErrors.some((i) => i.key === 'objects.account._actions.merge_accounts.label')).toBe(true);
  });

  it('honours an explicit --locales filter', () => {
    const report = computeI18nCoverage(baseConfig, { defaultLocale: 'en', locales: ['ja-JP'] });
    expect(report.locales.sort()).toEqual(['en', 'ja-JP']);
    const ja = report.stats.find((s) => s.locale === 'ja-JP')!;
    expect(ja.coveragePercent).toBe(0);
  });

  it('returns only metadataForms baseline when there are no objects/views/actions', () => {
    const report = computeI18nCoverage({ objects: [], views: [], actions: [], translations: [] });
    // No objects/views/actions = zero object-source keys. metadataForms.*
    // keys still come from the global METADATA_FORM_REGISTRY baseline.
    const objectSources = new Set(['object', 'field', 'option', 'view', 'action', 'globalAction']);
    expect(report.issues.filter((i) => objectSources.has(i.source))).toEqual([]);
    expect(report.totals.expectedKeys).toBeGreaterThan(0); // metadataForms baseline
  });

  it('treats data.object as fallback for view objectName', () => {
    const report = computeI18nCoverage(baseConfig, { defaultLocale: 'en' });
    const dataFormKeys = report.issues.filter(
      (i) => i.key === 'objects.account._views.data_form.label',
    );
    // present in en, missing in zh-CN
    expect(dataFormKeys.find((i) => i.locale === 'zh-CN')).toBeDefined();
    expect(dataFormKeys.find((i) => i.locale === 'en')).toBeUndefined();
  });
});
