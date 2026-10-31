// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A form view's thank-you panel (the `title` / `message` of a
// `kind: 'thank-you'` `FormViewSchema.submitBehavior`) is translated through
// `objects.<object>._views.<view>.submitBehavior.{title,message}`
// (`translateView` overlays it onto the served form item's
// `config.submitBehavior`). The walker emits both slots for every form a view
// container serves and for a form item, keyed by the composer's runtime
// identity, so `os i18n extract` scaffolds them and the coverage gate reports
// a locale that leaves an authored panel untranslated.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';

const panelKeys = (config: any) =>
  collectExpectedEntries(config)
    .map((e) => e.path.join('.'))
    .filter((p) => p.includes('.submitBehavior.'));

const leadForm = (extra: Record<string, unknown> = {}) => ({
  type: 'simple',
  data: { provider: 'object', object: 'crm_lead' },
  sections: [{ name: 'basics', label: 'Basics', fields: ['name'] }],
  ...extra,
});

const config = (translations: unknown[] = []) => ({
  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
  objects: [{ name: 'crm_lead', label: 'Lead', fields: { name: { type: 'text', label: 'Name' } } }],
  views: [
    {
      list: { type: 'grid', name: 'all_leads', label: 'All Leads', data: { provider: 'object', object: 'crm_lead' } },
      form: leadForm({ submitBehavior: { kind: 'thank-you', title: 'Saved' } }),
      formViews: {
        web_to_lead: leadForm({ submitBehavior: { kind: 'thank-you', title: 'Thanks!', message: 'We will reach out shortly.' } }),
        redirect: leadForm({ submitBehavior: { kind: 'redirect', url: '/thanks' } }),
      },
    },
    {
      name: 'referral',
      object: 'crm_lead',
      viewKind: 'form',
      config: leadForm({ submitBehavior: { kind: 'thank-you', message: 'Thank you for the referral.' } }),
    },
  ],
  translations,
});

describe('i18n walker — a form view\'s thank-you panel, `_views.<view>.submitBehavior`', () => {
  it('emits both slots for each form a container serves and for a form item, keyed by the runtime identity', () => {
    expect(panelKeys(config()).sort()).toEqual([
      'objects.crm_lead._views.form.submitBehavior.message',
      'objects.crm_lead._views.form.submitBehavior.title',
      'objects.crm_lead._views.redirect.submitBehavior.message',
      'objects.crm_lead._views.redirect.submitBehavior.title',
      'objects.crm_lead._views.referral.submitBehavior.message',
      'objects.crm_lead._views.referral.submitBehavior.title',
      'objects.crm_lead._views.web_to_lead.submitBehavior.message',
      'objects.crm_lead._views.web_to_lead.submitBehavior.title',
    ]);
  });

  it('seeds authored panel copy and leaves unauthored copy — and every non-thank-you kind — unseeded', () => {
    const entries = collectExpectedEntries(config());
    const at = (p: string) => entries.find((e) => e.path.join('.') === p);
    expect(at('objects.crm_lead._views.web_to_lead.submitBehavior.title')).toMatchObject({ sourceValue: 'Thanks!', inline: 'Thanks!' });
    expect(at('objects.crm_lead._views.web_to_lead.submitBehavior.message')).toMatchObject({ sourceValue: 'We will reach out shortly.' });
    expect(at('objects.crm_lead._views.form.submitBehavior.title')).toMatchObject({ sourceValue: 'Saved' });
    expect(at('objects.crm_lead._views.form.submitBehavior.message')?.inline).toBeUndefined();
    expect(at('objects.crm_lead._views.referral.submitBehavior.message')).toMatchObject({ sourceValue: 'Thank you for the referral.' });
    expect(at('objects.crm_lead._views.redirect.submitBehavior.title')?.inline).toBeUndefined();
    expect(at('objects.crm_lead._views.redirect.submitBehavior.message')?.inline).toBeUndefined();
  });

  it('CONTROL: the list view emits no panel slot', () => {
    const paths = collectExpectedEntries(config()).map((e) => e.path.join('.'));
    expect(paths).toContain('objects.crm_lead._views.all_leads.label');
    expect(paths.filter((p) => p.startsWith('objects.crm_lead._views.all_leads.submitBehavior'))).toEqual([]);
  });

  it('`os i18n extract` writes a skeleton the translation schema accepts', () => {
    const lead: any = extractTranslations(config(), { locales: ['en'] }).bundles.en?.objects?.crm_lead;
    expect(lead?._views?.web_to_lead?.submitBehavior).toEqual({ title: 'Thanks!', message: 'We will reach out shortly.' });
    const parsed = ObjectTranslationDataSchema.safeParse(lead);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('the coverage gate reports authored panel copy a supported locale leaves untranslated', () => {
    const missing = computeI18nCoverage(config([{ 'zh-CN': { objects: { crm_lead: { label: '线索' } } } }]))
      .issues.filter((i) => i.locale === 'zh-CN' && i.key.includes('.submitBehavior.'))
      .map((i) => i.key)
      .sort();
    expect(missing).toEqual([
      'objects.crm_lead._views.form.submitBehavior.title',
      'objects.crm_lead._views.referral.submitBehavior.message',
      'objects.crm_lead._views.web_to_lead.submitBehavior.message',
      'objects.crm_lead._views.web_to_lead.submitBehavior.title',
    ]);
    const covered = computeI18nCoverage(config([{
      'zh-CN': {
        objects: {
          crm_lead: {
            label: '线索',
            _views: {
              web_to_lead: { submitBehavior: { title: '感谢您！', message: '我们会尽快与您联系。' } },
              form: { submitBehavior: { title: '已保存' } },
              referral: { submitBehavior: { message: '感谢您的推荐。' } },
            },
          },
        },
      },
    }])).issues.filter((i) => i.locale === 'zh-CN' && i.key.includes('.submitBehavior.'));
    expect(covered).toEqual([]);
  });
});
