// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: `translateView` localizes a served FORM view's `title`
 * (`FormViewSchema.title`, served at `config.title`) through
 * `objects.<object>._views.<view>.title`, on the shared locale chain and under
 * the same catalog-vs-explicit-override rule as every other string the view
 * translator overlays (ADR-0029 D9.2a).
 *
 * Before this, the title had no translation key at all: the `_views` entry
 * named `title` as a rename onto `label`, and `translateView` never read
 * `config.title`. A public form that declared a title served it in the
 * authoring language to every visitor, so an app could not give a public form
 * a localized title.
 *
 * `title` is its own key, not the view's `label` key, because they are two
 * authored strings: a view item's `label` names the view (and a form-family
 * container entry carries none), while the form's `title` is the heading the
 * form shows. One translation cannot stand for two source strings.
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

const CONTAINER = {
  form: {
    type: 'simple' as const,
    data: { provider: 'object' as const, object: 'crm_lead' },
    title: 'New lead',
    sections: [{ name: 'basics', label: 'Basics', fields: ['name'] }],
  },
  formViews: {
    web_to_lead: {
      type: 'simple' as const,
      data: { provider: 'object' as const, object: 'crm_lead' },
      title: 'Contact us',
      sections: [{ name: 'basics', label: 'Basics', fields: ['name'] }],
    },
    // Authors no title: the bundle's key must not invent one.
    quick: {
      type: 'simple' as const,
      data: { provider: 'object' as const, object: 'crm_lead' },
      sections: [{ name: 'basics', label: 'Basics', fields: ['name'] }],
    },
    // Authors a title the bundle carries no key for.
    referral: {
      type: 'simple' as const,
      data: { provider: 'object' as const, object: 'crm_lead' },
      title: 'Refer a friend',
      sections: [{ name: 'basics', label: 'Basics', fields: ['name'] }],
    },
  },
};

const served = (name: string): any => {
  const item = expandViewContainer('crm_lead', CONTAINER).find((v) => v.name === name);
  if (!item) throw new Error(`fixture missing ${name}`);
  return item;
};

const LEAD_ZH = {
  label: '线索',
  _views: {
    web_to_lead: { title: '联系我们' },
    form: { title: '新建线索' },
    quick: { title: 'MUST-NOT-APPLY' },
  },
};
const LEAD_EN = { _views: { web_to_lead: { title: 'Contact us' } } };

const BUNDLE: TranslationBundle = {
  en: { objects: { crm_lead: LEAD_EN } } as any,
  'zh-CN': { objects: { crm_lead: LEAD_ZH } } as any,
};

describe('translateView — a form view\'s title, keyed `_views.<view>.title`', () => {
  it('composes the identity this test is pinned to — legal fixtures, the title lives under `config`', () => {
    expect(ViewSchema.safeParse(CONTAINER).success).toBe(true);
    for (const node of [LEAD_ZH, LEAD_EN]) {
      const parsed = ObjectTranslationDataSchema.safeParse(node);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
    const item = served('crm_lead.web_to_lead');
    expect(item.viewKind).toBe('form');
    expect(item.label).toBeUndefined();
    expect(item.config.title).toBe('Contact us');
  });

  it('a zh-CN pack with a `_views.<view>.title` key yields the translated title', () => {
    const out = translateMetadataDocument('view', clone(served('crm_lead.web_to_lead')), BUNDLE, { locale: 'zh-CN' });
    expect(out.config.title).toBe('联系我们');
    // The default form is keyed by its runtime identity, `form`.
    const def = translateMetadataDocument('view', clone(served('crm_lead.form')), BUNDLE, { locale: 'zh-CN' });
    expect(def.config.title).toBe('新建线索');
  });

  it('a locale the bundle lacks reads the declared fallback chain — ja-JP over `[zh-CN]`', () => {
    const out = translateView(clone(served('crm_lead.web_to_lead')), BUNDLE, { locale: 'ja-JP', fallbackChain: ['zh-CN'] }) as any;
    expect(out.config.title).toBe('联系我们');
  });

  it('a missing key yields the authored title', () => {
    const out = translateView(clone(served('crm_lead.referral')), BUNDLE, { locale: 'zh-CN' }) as any;
    expect(out.config.title).toBe('Refer a friend');
  });

  it('CONTROL: a form that authors no title gains none — the bundle key does not invent one', () => {
    const doc = clone(served('crm_lead.quick'));
    const out = translateView(doc, BUNDLE, { locale: 'zh-CN' }) as any;
    expect(out.config.title).toBeUndefined();
    expect('title' in out.config).toBe(false);
  });

  it('CONTROL: the title key does not leak into the view `label`, and the `label` key does not reach the title', () => {
    const out = translateView(clone(served('crm_lead.web_to_lead')), BUNDLE, { locale: 'zh-CN' }) as any;
    // No `_views.web_to_lead.label` key: the label falls back to the item's
    // name, exactly as before this change.
    expect(out.label).toBe('crm_lead.web_to_lead');
    const labelOnly: TranslationBundle = {
      'zh-CN': { objects: { crm_lead: { _views: { web_to_lead: { label: '网页线索' } } } } } as any,
    };
    const viaLabel = translateView(clone(served('crm_lead.web_to_lead')), labelOnly, { locale: 'zh-CN' }) as any;
    expect(viaLabel.label).toBe('网页线索');
    expect(viaLabel.config.title).toBe('Contact us');
  });

  it('an override beats the catalog — an edited title keeps the edit against the packaged view', () => {
    const packaged = served('crm_lead.web_to_lead');
    const edited = clone(packaged);
    edited.config.title = 'Talk to sales (edited)';
    const out = translateView(edited, BUNDLE, { locale: 'zh-CN', packagedBase: packaged }) as any;
    expect(out.config.title).toBe('Talk to sales (edited)');
    // CONTROL: the unedited title, judged against the same base, translates.
    const same = translateView(clone(packaged), BUNDLE, { locale: 'zh-CN', packagedBase: packaged }) as any;
    expect(same.config.title).toBe('联系我们');
  });

  it('the served document is not mutated, and a form with nothing to translate keeps its `config` reference', () => {
    const doc = clone(served('crm_lead.web_to_lead'));
    translateView(doc, BUNDLE, { locale: 'zh-CN' });
    expect(doc.config.title).toBe('Contact us');
    const quick = clone(served('crm_lead.quick'));
    expect((translateView(quick, BUNDLE, { locale: 'zh-CN' }) as any).config).toBe(quick.config);
  });
});
