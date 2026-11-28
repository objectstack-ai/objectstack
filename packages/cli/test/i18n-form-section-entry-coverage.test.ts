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
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-bundle-extract';
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

// [ADR-0159 D8] An authored `form` item's section copy is read at the form's
// own node, `forms.<name>.sections.<section>…`, and at the object-level
// default `objects.<object>._sections.<section>…` for each key the node lacks.
describe('i18n walker — a `form` item\'s sections, `forms.<name>.sections.<section>…`', () => {
  const FORM = 'crm_case.intake';
  const formConfig = (translations: unknown[] = []) => ({
    i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
    objects: [{
      name: 'crm_case',
      label: 'Case',
      fields: { subject: { type: 'text', label: 'Subject' }, contact_name: { type: 'text', label: 'Contact name' } },
    }],
    forms: [{
      name: FORM,
      object: 'crm_case',
      type: 'simple',
      sections: [
        { name: 'about', label: 'About you', description: 'Who is asking', fields: [{ field: 'contact_name', label: 'Your name', helpText: 'As on your ID' }, 'subject'] },
        { label: 'Nameless', fields: ['subject'] },
      ],
    }],
    translations,
  });
  const formKeys = (config: any) => collectExpectedEntries(config)
    .map((e) => e.path.join('.'))
    .filter((p) => p.startsWith(`forms.${FORM}.sections.`) || p.includes('._sections.'));
  const zhMissing = (translations: unknown[]) => computeI18nCoverage(formConfig(translations)).issues
    .filter((i) => i.locale === 'zh-CN' && (i.key.startsWith(`forms.${FORM}.`) || i.key.includes('._sections.')))
    .map((i) => i.key)
    .sort();

  it('emits each named section\'s authored copy at the form\'s own node, with the object-level slot as its fallback', () => {
    expect(formKeys(formConfig()).sort()).toEqual([
      `forms.${FORM}.sections.about.description`,
      `forms.${FORM}.sections.about.fields.contact_name.helpText`,
      `forms.${FORM}.sections.about.fields.contact_name.label`,
      `forms.${FORM}.sections.about.label`,
    ]);
    const label = collectExpectedEntries(formConfig()).find((e) => e.path.join('.') === `forms.${FORM}.sections.about.label`);
    expect(label?.fallbackPath?.join('.')).toBe('objects.crm_case._sections.about.label');
  });

  it('the coverage gate counts the section translated at either address, and reports it untranslated at neither', () => {
    expect(zhMissing([{ 'zh-CN': { objects: { crm_case: { label: '工单' } } } }])).toEqual([
      `forms.${FORM}.sections.about.description`,
      `forms.${FORM}.sections.about.fields.contact_name.helpText`,
      `forms.${FORM}.sections.about.fields.contact_name.label`,
      `forms.${FORM}.sections.about.label`,
    ]);
    const atTheFormsNode = { label: '关于您', description: '提问者', fields: { contact_name: { label: '您的姓名', helpText: '与证件一致' } } };
    expect(zhMissing([{ 'zh-CN': { objects: { crm_case: { label: '工单' } }, forms: { [FORM]: { sections: { about: atTheFormsNode } } } } }])).toEqual([]);
    expect(zhMissing([{ 'zh-CN': { objects: { crm_case: { label: '工单', _sections: { about: atTheFormsNode } } } } }])).toEqual([]);
  });

  it('`os i18n extract` writes the form\'s own node, and no translated-locale value over a translation the object-level slot holds', () => {
    const en: any = extractTranslations(formConfig(), { locales: ['en'] }).bundles.en;
    expect(en?.forms?.[FORM]?.sections?.about?.label).toBe('About you');
    expect(en?.objects?.crm_case?._sections).toBeUndefined();
    const zh: any = extractTranslations(
      formConfig([{ 'zh-CN': { objects: { crm_case: { _sections: { about: { label: '关于您' } } } } } }]),
      { locales: ['zh-CN'], fill: 'todo' },
    ).bundles['zh-CN'];
    expect(zh?.forms?.[FORM]?.sections?.about?.label).toBeUndefined();
    // CONTROL: a key the object-level slot does not hold is scaffolded at the form's node.
    expect(zh?.forms?.[FORM]?.sections?.about?.description).toBe('[TODO] Who is asking');
  });
});
