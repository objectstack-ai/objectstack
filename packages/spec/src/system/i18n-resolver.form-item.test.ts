// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0159 card ② item 8] The `forms` translation family: a `form` item's
 * `label`, `description`, `title` and `submitBehavior` read `forms.NAME`
 * first; `title` and `submitBehavior` fall back to the `_views.KEY` tails a
 * pack keyed under the old view address carries; `_views.KEY.label` is never
 * read (a view's label names the view, not the form).
 */

import { describe, expect, it } from 'vitest';
import { translateForm, translateMetadataDocument } from './i18n-resolver';
import { TranslationDataSchema, type TranslationBundle } from './translation.zod';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const FORM = {
  name: 'crm_lead.web_to_lead',
  object: 'crm_lead',
  label: 'Web to lead',
  description: 'The public lead form',
  title: 'Contact us',
  submitBehavior: { kind: 'thank-you', title: 'Thanks!', message: 'We will be in touch.' },
  sections: [{ fields: [{ field: 'name' }] }],
};

const ZH_FORMS = {
  forms: {
    'crm_lead.web_to_lead': {
      label: '网页线索',
      description: '公开的线索表单',
      title: '联系我们',
      submitBehavior: { title: '谢谢！' },
    },
  },
};
const ZH_VIEWS_ONLY = {
  objects: {
    crm_lead: {
      _views: { web_to_lead: { label: 'MUST-NOT-APPLY', title: '旧地址标题', submitBehavior: { message: '旧地址消息' } } },
    },
  },
};

describe('translateForm — the `forms` family, `_views` tails as fallback', () => {
  it('composes a legal pack: the `forms` group is part of the translation data', () => {
    const parsed = TranslationDataSchema.safeParse(ZH_FORMS);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('reads `forms.NAME` for every translatable string', () => {
    const bundle: TranslationBundle = { 'zh-CN': ZH_FORMS as any };
    const out = translateMetadataDocument('form', clone(FORM), bundle, { locale: 'zh-CN' }) as any;
    expect(out).toMatchObject({
      label: '网页线索',
      description: '公开的线索表单',
      title: '联系我们',
      submitBehavior: { title: '谢谢！', message: 'We will be in touch.' },
    });
  });

  it('falls back to the `_views.KEY` tails for title and submitBehavior, never for the label', () => {
    const bundle: TranslationBundle = { 'zh-CN': ZH_VIEWS_ONLY as any };
    const out = translateForm(clone(FORM), bundle, { locale: 'zh-CN' }) as any;
    expect(out.title).toBe('旧地址标题');
    expect(out.submitBehavior.message).toBe('旧地址消息');
    expect(out.label).toBe('Web to lead');
  });

  it('`forms.NAME` wins over the `_views` tail when both are present', () => {
    const bundle: TranslationBundle = { 'zh-CN': { ...ZH_VIEWS_ONLY, ...ZH_FORMS } as any };
    const out = translateForm(clone(FORM), bundle, { locale: 'zh-CN' }) as any;
    expect(out.title).toBe('联系我们');
  });

  it('CONTROL: no key leaves the authored strings, and the document unchanged', () => {
    const doc = clone(FORM);
    expect(translateForm(doc, { 'zh-CN': {} as any }, { locale: 'zh-CN' })).toBe(doc);
  });
});
