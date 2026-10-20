// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A form view's title (`FormViewSchema.title`) is translated through
// `objects.<object>._views.<view>.title` (`translateView` overlays it onto the
// served form item's `config.title`). The walker emits that slot for every
// form a view container serves, keyed by the composer's runtime identity, so
// `os i18n extract` scaffolds it and the coverage gate reports a locale that
// leaves an authored title untranslated.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';

const titleKeys = (config: any) =>
  collectExpectedEntries(config)
    .map((e) => e.path.join('.'))
    .filter((p) => p.endsWith('.title') && p.includes('._views.'));

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
      form: leadForm({ title: 'New lead' }),
      formViews: {
        web_to_lead: leadForm({ title: 'Contact us' }),
        quick: leadForm(),
      },
    },
    {
      name: 'referral',
      object: 'crm_lead',
      viewKind: 'form',
      config: leadForm({ title: 'Refer a friend' }),
    },
  ],
  translations,
});

describe('i18n walker — a form view\'s title, `_views.<view>.title`', () => {
  it('emits the slot for each form a container serves and for a form item, keyed by the runtime identity', () => {
    expect(titleKeys(config()).sort()).toEqual([
      'objects.crm_lead._views.form.title',
      'objects.crm_lead._views.quick.title',
      'objects.crm_lead._views.referral.title',
      'objects.crm_lead._views.web_to_lead.title',
    ]);
  });

  it('seeds an authored title and leaves a form without one unseeded', () => {
    const entries = collectExpectedEntries(config());
    const at = (p: string) => entries.find((e) => e.path.join('.') === p);
    expect(at('objects.crm_lead._views.web_to_lead.title')).toMatchObject({ sourceValue: 'Contact us', inline: 'Contact us' });
    expect(at('objects.crm_lead._views.form.title')).toMatchObject({ sourceValue: 'New lead' });
    expect(at('objects.crm_lead._views.quick.title')?.inline).toBeUndefined();
  });

  it('CONTROL: the list view emits no title slot, and the container forms emit no `label` slot', () => {
    const paths = collectExpectedEntries(config()).map((e) => e.path.join('.'));
    expect(paths).toContain('objects.crm_lead._views.all_leads.label');
    expect(paths).not.toContain('objects.crm_lead._views.all_leads.title');
    expect(paths).not.toContain('objects.crm_lead._views.web_to_lead.label');
  });

  it('`os i18n extract` writes a skeleton the translation schema accepts', () => {
    const lead: any = extractTranslations(config(), { locales: ['en'] }).bundles.en?.objects?.crm_lead;
    expect(lead?._views?.web_to_lead?.title).toBe('Contact us');
    const parsed = ObjectTranslationDataSchema.safeParse(lead);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('the coverage gate reports an authored title a supported locale leaves untranslated', () => {
    const missing = computeI18nCoverage(config([{ 'zh-CN': { objects: { crm_lead: { label: '线索' } } } }]))
      .issues.filter((i) => i.locale === 'zh-CN' && i.key.endsWith('.title'))
      .map((i) => i.key)
      .sort();
    expect(missing).toEqual([
      'objects.crm_lead._views.form.title',
      'objects.crm_lead._views.referral.title',
      'objects.crm_lead._views.web_to_lead.title',
    ]);
    const covered = computeI18nCoverage(config([{
      'zh-CN': {
        objects: {
          crm_lead: {
            label: '线索',
            _views: { web_to_lead: { title: '联系我们' }, form: { title: '新建线索' }, referral: { title: '推荐朋友' } },
          },
        },
      },
    }])).issues.filter((i) => i.locale === 'zh-CN' && i.key.endsWith('.title'));
    expect(covered).toEqual([]);
  });
});
