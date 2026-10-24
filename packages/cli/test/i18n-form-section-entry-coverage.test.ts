// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A form section entry's override copy — the `label`, `placeholder` and
// `helpText` an entry object authors over the object field it renders — is
// translated through `objects.<object>._sections.<section>.fields.<field>`
// (`translateView` overlays it onto the served section's entries). The walker
// emits that slot for every authored string of a form view's named sections,
// so `os i18n extract` scaffolds it and the coverage gate reports a locale
// that leaves one untranslated.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';

const entryKeys = (config: any) =>
  collectExpectedEntries(config)
    .map((e) => e.path.join('.'))
    .filter((p) => p.includes('._sections.') && p.includes('.fields.'));

const caseForm = (sections: unknown[]) => ({
  type: 'simple',
  data: { provider: 'object', object: 'crm_case' },
  sections,
});

const config = (translations: unknown[] = []) => ({
  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
  objects: [{
    name: 'crm_case',
    label: 'Case',
    fields: {
      contact_name: { type: 'text', label: 'Contact name' },
      contact_email: { type: 'email', label: 'Contact email' },
      subject: { type: 'text', label: 'Subject' },
    },
  }],
  views: [
    {
      list: { type: 'grid', name: 'all_cases', label: 'All Cases', data: { provider: 'object', object: 'crm_case' } },
      formViews: {
        support: caseForm([
          {
            name: 'submitter',
            label: 'About you',
            fields: [
              { field: 'contact_name', label: 'Your name', placeholder: 'Jane Doe', helpText: 'As on your ID' },
              { field: 'contact_email', label: 'Your email' },
              'subject',
            ],
          },
          // No `name`: its entries have no address.
          { label: 'Details', fields: [{ field: 'subject', label: 'What happened' }] },
        ]),
      },
    },
  ],
  pages: [{
    name: 'case_record',
    type: 'record',
    object: 'crm_case',
    regions: [{
      name: 'main',
      components: [{
        type: 'record:details',
        properties: { sections: [{ name: 'page_only', label: 'Page', fields: [{ field: 'subject', label: 'Page label' }] }] },
      }],
    }],
  }],
  translations,
});

describe('i18n walker — a form section entry\'s copy, `_sections.<section>.fields.<field>`', () => {
  it('emits one slot per AUTHORED entry string of a named form-view section', () => {
    expect(entryKeys(config()).sort()).toEqual([
      'objects.crm_case._sections.submitter.fields.contact_email.label',
      'objects.crm_case._sections.submitter.fields.contact_name.helpText',
      'objects.crm_case._sections.submitter.fields.contact_name.label',
      'objects.crm_case._sections.submitter.fields.contact_name.placeholder',
    ]);
  });

  it('seeds each slot with the authored string, under the `section` bucket', () => {
    const at = (p: string) => collectExpectedEntries(config()).find((e) => e.path.join('.') === p);
    expect(at('objects.crm_case._sections.submitter.fields.contact_name.placeholder'))
      .toMatchObject({ sourceValue: 'Jane Doe', inline: 'Jane Doe', source: 'section', objectName: 'crm_case' });
  });

  it('`os i18n extract` writes a skeleton the translation schema accepts', () => {
    const node: any = extractTranslations(config(), { locales: ['en'] }).bundles.en?.objects?.crm_case;
    expect(node?._sections?.submitter?.fields?.contact_name).toEqual({
      label: 'Your name', placeholder: 'Jane Doe', helpText: 'As on your ID',
    });
    const parsed = ObjectTranslationDataSchema.safeParse(node);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('the coverage gate reports an authored entry string a supported locale leaves untranslated', () => {
    const missing = computeI18nCoverage(config([{ 'zh-CN': { objects: { crm_case: { label: '工单' } } } }]))
      .issues.filter((i) => i.locale === 'zh-CN' && i.key.includes('.fields.') && i.key.includes('._sections.'))
      .map((i) => i.key)
      .sort();
    expect(missing).toEqual(entryKeys(config()).sort());
    const covered = computeI18nCoverage(config([{
      'zh-CN': {
        objects: {
          crm_case: {
            label: '工单',
            _sections: {
              submitter: {
                fields: {
                  contact_name: { label: '您的姓名', placeholder: '张三', helpText: '与证件一致' },
                  contact_email: { label: '您的邮箱' },
                },
              },
            },
          },
        },
      },
    }])).issues.filter((i) => i.locale === 'zh-CN' && i.key.includes('.fields.') && i.key.includes('._sections.'));
    expect(covered).toEqual([]);
  });
});
