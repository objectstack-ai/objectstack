// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: `translateView` localizes a served FORM view's thank-you panel — the
 * `title` and `message` of a `kind: 'thank-you'` `FormViewSchema
 * .submitBehavior`, served at `config.submitBehavior` — through
 * `objects.<object>._views.<view>.submitBehavior.{title,message}`, on the
 * shared locale chain and under the same catalog-vs-explicit-override rule as
 * every other string the view translator overlays (ADR-0029 D9.2a).
 *
 * Before this, the panel had no translation key at all: the strict `_views`
 * entry declared no `submitBehavior`, and `translateView` never read
 * `config.submitBehavior`. A public form read in another language showed a
 * translated heading and field labels, then confirmed the submit in the
 * authoring language.
 *
 * The served documents below are what `expandViewContainer` emits from an
 * authored container, and both the container and the bundle's object node are
 * PARSED by the authoring schemas, so an address neither schema carries cannot
 * pass.
 */

import { describe, it, expect } from 'vitest';
import { translateView, translateMetadataDocument } from './i18n-resolver';
import { ObjectTranslationDataSchema, type TranslationBundle } from './translation.zod';
import { ViewSchema, expandViewContainer } from '../ui/view.zod';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const data = { provider: 'object' as const, object: 'crm_lead' };
const sections = [{ name: 'basics', label: 'Basics', fields: ['name'] }];

const CONTAINER = {
  form: {
    type: 'simple' as const,
    data,
    sections,
    submitBehavior: { kind: 'thank-you' as const, title: 'Saved', message: 'The lead is in.' },
  },
  formViews: {
    web_to_lead: {
      type: 'simple' as const,
      data,
      title: 'Contact us',
      sections,
      submitBehavior: { kind: 'thank-you' as const, title: 'Thanks!', message: 'We will reach out shortly.' },
    },
    // Authors a title and no message: the bundle's message must not invent one.
    title_only: {
      type: 'simple' as const,
      data,
      sections,
      submitBehavior: { kind: 'thank-you' as const, title: 'Got it' },
    },
    // Not a thank-you panel: its keys translate nothing.
    redirect: {
      type: 'simple' as const,
      data,
      sections,
      submitBehavior: { kind: 'redirect' as const, url: '/thanks' },
    },
    // Authors a panel the bundle carries no key for.
    referral: {
      type: 'simple' as const,
      data,
      sections,
      submitBehavior: { kind: 'thank-you' as const, title: 'Referral sent', message: 'Thank you for the referral.' },
    },
  },
};

const served = (name: string): any => {
  const item = expandViewContainer('crm_lead', CONTAINER).find((v) => v.name === name);
  if (!item) throw new Error(`fixture missing ${name}`);
  return item;
};

const LEAD_ZH = {
  _views: {
    web_to_lead: {
      title: '联系我们',
      submitBehavior: { title: '感谢您！', message: '我们会尽快与您联系。' },
    },
    form: { submitBehavior: { title: '已保存', message: '线索已录入。' } },
    title_only: { submitBehavior: { title: '收到', message: 'MUST-NOT-APPLY' } },
    redirect: { submitBehavior: { title: 'MUST-NOT-APPLY', message: 'MUST-NOT-APPLY' } },
  },
};
const LEAD_EN = { _views: { web_to_lead: { submitBehavior: { title: 'Thanks!' } } } };

const BUNDLE: TranslationBundle = {
  en: { objects: { crm_lead: LEAD_EN } } as any,
  'zh-CN': { objects: { crm_lead: LEAD_ZH } } as any,
};

describe("translateView — a form view's thank-you panel, keyed `_views.<view>.submitBehavior`", () => {
  it('composes the identity this test is pinned to — legal fixtures, the panel lives under `config`', () => {
    expect(ViewSchema.safeParse(CONTAINER).success).toBe(true);
    for (const node of [LEAD_ZH, LEAD_EN]) {
      const parsed = ObjectTranslationDataSchema.safeParse(node);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
    const item = served('crm_lead.web_to_lead');
    expect(item.viewKind).toBe('form');
    expect(item.config.submitBehavior).toEqual(CONTAINER.formViews.web_to_lead.submitBehavior);
  });

  it('a zh-CN pack yields the translated panel title and message', () => {
    const out = translateMetadataDocument('view', clone(served('crm_lead.web_to_lead')), BUNDLE, { locale: 'zh-CN' });
    expect(out.config.submitBehavior).toEqual({ kind: 'thank-you', title: '感谢您！', message: '我们会尽快与您联系。' });
    // The form heading is translated beside it, from its own key.
    expect(out.config.title).toBe('联系我们');
    // The default form is keyed by its runtime identity, `form`.
    const def = translateMetadataDocument('view', clone(served('crm_lead.form')), BUNDLE, { locale: 'zh-CN' });
    expect(def.config.submitBehavior).toEqual({ kind: 'thank-you', title: '已保存', message: '线索已录入。' });
  });

  it('a locale the bundle lacks reads the declared fallback chain — ja-JP over `[zh-CN]`', () => {
    const out = translateView(clone(served('crm_lead.web_to_lead')), BUNDLE, { locale: 'ja-JP', fallbackChain: ['zh-CN'] }) as any;
    expect(out.config.submitBehavior.title).toBe('感谢您！');
    expect(out.config.submitBehavior.message).toBe('我们会尽快与您联系。');
  });

  it('a missing key yields the authored panel', () => {
    const out = translateView(clone(served('crm_lead.referral')), BUNDLE, { locale: 'zh-CN' }) as any;
    expect(out.config.submitBehavior).toEqual(CONTAINER.formViews.referral.submitBehavior);
  });

  it('CONTROL: a panel that authors no message gains none — the bundle key does not invent one', () => {
    const out = translateView(clone(served('crm_lead.title_only')), BUNDLE, { locale: 'zh-CN' }) as any;
    expect(out.config.submitBehavior).toEqual({ kind: 'thank-you', title: '收到' });
    expect('message' in out.config.submitBehavior).toBe(false);
  });

  it('CONTROL: a `redirect` behavior is not a panel — its keys translate nothing and its `config` reference is kept', () => {
    const doc = clone(served('crm_lead.redirect'));
    const out = translateView(doc, BUNDLE, { locale: 'zh-CN' }) as any;
    expect(out.config).toBe(doc.config);
    expect(out.config.submitBehavior).toEqual({ kind: 'redirect', url: '/thanks' });
  });

  it('CONTROL: the panel title key does not reach the form heading, and the heading key does not reach the panel', () => {
    const headingOnly: TranslationBundle = {
      'zh-CN': { objects: { crm_lead: { _views: { web_to_lead: { title: '联系我们' } } } } } as any,
    };
    const viaHeading = translateView(clone(served('crm_lead.web_to_lead')), headingOnly, { locale: 'zh-CN' }) as any;
    expect(viaHeading.config.title).toBe('联系我们');
    expect(viaHeading.config.submitBehavior.title).toBe('Thanks!');
    const panelOnly: TranslationBundle = {
      'zh-CN': { objects: { crm_lead: { _views: { web_to_lead: { submitBehavior: { title: '感谢您！' } } } } } } as any,
    };
    const viaPanel = translateView(clone(served('crm_lead.web_to_lead')), panelOnly, { locale: 'zh-CN' }) as any;
    expect(viaPanel.config.title).toBe('Contact us');
    expect(viaPanel.config.submitBehavior.title).toBe('感谢您！');
  });

  it('an override beats the catalog — an edited panel string keeps the edit against the packaged view, per string', () => {
    const packaged = served('crm_lead.web_to_lead');
    const edited = clone(packaged);
    edited.config.submitBehavior.message = 'Sales will call you (edited)';
    const out = translateView(edited, BUNDLE, { locale: 'zh-CN', packagedBase: packaged }) as any;
    expect(out.config.submitBehavior.message).toBe('Sales will call you (edited)');
    // The unedited sibling string, judged against the same base, translates.
    expect(out.config.submitBehavior.title).toBe('感谢您！');
    // A packaged view with no panel makes every served string an authored one.
    const bare = clone(packaged);
    delete bare.config.submitBehavior;
    const authored = translateView(clone(packaged), BUNDLE, { locale: 'zh-CN', packagedBase: bare }) as any;
    expect(authored.config.submitBehavior.title).toBe('Thanks!');
  });

  it('the served document is not mutated', () => {
    const doc = clone(served('crm_lead.web_to_lead'));
    translateView(doc, BUNDLE, { locale: 'zh-CN' });
    expect(doc.config.submitBehavior).toEqual(CONTAINER.formViews.web_to_lead.submitBehavior);
  });
});
