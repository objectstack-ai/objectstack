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

  // Issue #3583 — `FieldSchema.options` is canonically a `{value,label}[]`
  // ARRAY, but coverage only walked the record-map shape, so option-label
  // coverage silently never fired for a canonically-shaped select field.
  it('covers options declared in the canonical array shape', () => {
    const arrayOptionConfig: any = {
      objects: [
        {
          name: 'account',
          label: 'Account',
          fields: {
            stage: {
              label: 'Stage',
              options: [
                { value: 'planning', label: 'Planning' },
                { value: 'direct_mail', label: 'Direct Mail' },
              ],
            },
          },
        },
      ],
      translations: [{ 'zh-CN': {} }],
    };
    const report = computeI18nCoverage(arrayOptionConfig, { defaultLocale: 'en' });
    const zhKeys = new Set(report.issues.filter((i) => i.locale === 'zh-CN').map((i) => i.key));
    expect(zhKeys.has('objects.account.fields.stage.options.planning')).toBe(true);
    expect(zhKeys.has('objects.account.fields.stage.options.direct_mail')).toBe(true);
  });

  it('#8543: bare-string options are DERIVED — no translation demanded for a machine identifier', () => {
    // A bare-string option has no authored display text: its "label" is a
    // copy of the machine value (`Field.select(['planning'])` normalizes to
    // `{ value: 'planning', label: 'planning' }`). This test used to pin the
    // opposite — that the gate demands a zh-CN translation of `planning` /
    // `closed` — which both erased the authored/derived axis the extractor
    // documents and taught authors to "translate" machine identifiers.
    // Authored option labels (previous test) stay gated; a bundle that
    // externalizes text for a derived key re-enters the expected set via
    // `authoredInBundle`.
    const stringOptionConfig: any = {
      objects: [
        {
          name: 'account',
          label: 'Account',
          fields: { stage: { label: 'Stage', options: ['planning', 'closed'] } },
        },
      ],
      translations: [{ 'zh-CN': {} }],
    };
    const report = computeI18nCoverage(stringOptionConfig, { defaultLocale: 'en' });
    const zhKeys = new Set(report.issues.filter((i) => i.locale === 'zh-CN').map((i) => i.key));
    expect(zhKeys.has('objects.account.fields.stage.options.planning')).toBe(false);
    expect(zhKeys.has('objects.account.fields.stage.options.closed')).toBe(false);
    // The field's own authored label is still owed.
    expect(zhKeys.has('objects.account.fields.stage.label')).toBe(true);
  });

  it('#8543: a bundle that authors text for a derived option key re-enters the expected set', () => {
    // The other half of the derived-channel contract: `inline` unset does not
    // mean "never gated" — a project that externalizes display text for a
    // bare-string option into some bundle owes the other locales a
    // translation of it, exactly like any externalized string.
    const externalized: any = {
      objects: [
        {
          name: 'account',
          label: 'Account',
          fields: { stage: { label: 'Stage', options: ['planning'] } },
        },
      ],
      translations: [
        {
          en: { objects: { account: { fields: { stage: { options: { planning: 'Planning' } } } } } },
          'zh-CN': {},
        },
      ],
    };
    const report = computeI18nCoverage(externalized, { defaultLocale: 'en' });
    const zhKeys = new Set(report.issues.filter((i) => i.locale === 'zh-CN').map((i) => i.key));
    expect(zhKeys.has('objects.account.fields.stage.options.planning')).toBe(true);
  });

  it('promotes warnings to errors under --strict', () => {
    const report = computeI18nCoverage(baseConfig, { defaultLocale: 'en', strict: true });
    const zhIssues = report.issues.filter((i) => i.locale === 'zh-CN');
    expect(zhIssues.length).toBeGreaterThan(0);
    expect(zhIssues.every((i) => i.severity === 'error')).toBe(true);
    expect(report.totals.errors).toBeGreaterThan(0);
  });

  it('raises errors when the default locale itself is incomplete', () => {
    // A genuine default-locale gap: zh-CN carries a string that has no source
    // text anywhere for `en` — neither inline on the action nor in the bundle.
    const incomplete = JSON.parse(JSON.stringify(baseConfig));
    delete incomplete.translations[0].en.objects.account._actions.merge_accounts.label;
    delete incomplete.actions[0].label;
    const report = computeI18nCoverage(incomplete, { defaultLocale: 'en' });
    const enErrors = report.issues.filter((i) => i.locale === 'en' && i.severity === 'error');
    expect(enErrors.some((i) => i.key === 'objects.account._actions.merge_accounts.label')).toBe(true);
  });

  it('does not fault the default locale for a string authored inline', () => {
    // Dropping a bundle entry that merely restates the inline `label:` is not
    // a gap — the runtime resolver falls back to the inline text. Regression
    // guard for the blank template linting with i18n errors out of the box.
    const inlineOnly = JSON.parse(JSON.stringify(baseConfig));
    delete inlineOnly.translations[0].en.objects.account._actions.merge_accounts.label;
    const report = computeI18nCoverage(inlineOnly, { defaultLocale: 'en' });
    const enErrors = report.issues.filter((i) => i.locale === 'en' && i.severity === 'error');
    expect(enErrors.map((i) => i.key)).not.toContain('objects.account._actions.merge_accounts.label');
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

  describe('inline metadata as the default-locale source', () => {
    // Shape of the `create-objectstack` blank template: inline labels, no
    // translation bundle. It must lint clean (#3103).
    const scaffold: any = {
      objects: [
        {
          name: 'demo_note',
          label: 'Note',
          pluralLabel: 'Notes',
          fields: { title: { label: 'Title' }, body: { label: 'Body' } },
        },
      ],
      translations: [],
    };

    it('reports no default-locale errors for a bundle-less scaffold', () => {
      const report = computeI18nCoverage(scaffold, { defaultLocale: 'en' });
      expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    });

    it('reports 100% default-locale coverage when every string is authored inline', () => {
      const report = computeI18nCoverage(scaffold, { defaultLocale: 'en' });
      expect(report.stats.find((s) => s.locale === 'en')!.coveragePercent).toBe(100);
    });

    it('still warns for a non-default locale — inline text is not a translation', () => {
      const withZh = { ...scaffold, translations: [{ 'zh-CN': {} }] };
      const report = computeI18nCoverage(withZh, { defaultLocale: 'en' });
      const zhKeys = report.issues.filter((i) => i.locale === 'zh-CN').map((i) => i.key);
      expect(zhKeys).toContain('objects.demo_note.label');
      expect(zhKeys).toContain('objects.demo_note.fields.title.label');
    });

    it('treats the inline label as the source for whatever locale is the default', () => {
      // Inline text is the source string, not "English" — a zh-CN-first
      // project authoring inline Chinese labels is complete, not broken.
      const zhFirst = {
        objects: [{ name: 'demo_note', label: '备注', pluralLabel: '备注', fields: { title: { label: '标题' } } }],
        translations: [],
      };
      const report = computeI18nCoverage(zhFirst, { defaultLocale: 'zh-CN' });
      expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    });

    it('does not demand a pluralLabel translation when none is authored', () => {
      const noPlural = {
        objects: [{ name: 'demo_note', label: 'Note', fields: {} }],
        translations: [],
      };
      const report = computeI18nCoverage(noPlural, { defaultLocale: 'en' });
      expect(report.issues.map((i) => i.key)).not.toContain('objects.demo_note.pluralLabel');
    });

    it('leaves an unlabelled field to required/label rather than reporting an i18n gap', () => {
      const unlabelled = {
        objects: [{ name: 'demo_note', label: 'Note', fields: { title: {} } }],
        translations: [],
      };
      const report = computeI18nCoverage(unlabelled, { defaultLocale: 'en' });
      expect(report.issues.map((i) => i.key)).not.toContain('objects.demo_note.fields.title.label');
    });

    it('still expects a key that is authored only in a bundle', () => {
      // No inline label, but zh-CN externalizes one — `en` genuinely lacks a
      // source string for it, so the default-locale gate must still fire.
      const bundleOnly = {
        objects: [{ name: 'demo_note', label: 'Note', fields: { title: {} } }],
        translations: [{ 'zh-CN': { objects: { demo_note: { fields: { title: { label: '标题' } } } } } }],
      };
      const report = computeI18nCoverage(bundleOnly, { defaultLocale: 'en' });
      const enErrors = report.issues.filter((i) => i.locale === 'en' && i.severity === 'error');
      expect(enErrors.map((i) => i.key)).toContain('objects.demo_note.fields.title.label');
    });
  });

  it('counts the platform metadataForms baseline as covered for the default locale', () => {
    // The registry authors those labels inline, so `en` needs no bundle. A
    // non-default locale still owes a translation for each of them.
    const report = computeI18nCoverage(
      { objects: [], views: [], actions: [], translations: [{ 'zh-CN': {} }] },
      { defaultLocale: 'en' },
    );
    expect(report.issues.filter((i) => i.locale === 'en')).toEqual([]);
    const zh = report.issues.filter((i) => i.locale === 'zh-CN');
    expect(zh.some((i) => i.key === 'metadataForms.flow.fields.name.label')).toBe(true);
    expect(zh.every((i) => i.severity === 'warning')).toBe(true);
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
