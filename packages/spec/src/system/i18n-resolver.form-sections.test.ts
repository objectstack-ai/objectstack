// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: `translateView` localizes a served FORM view's `sections` — each
 * section's `label` and `description` — through
 * `objects.<object>._sections.<name>`, on the shared locale chain and under
 * the same catalog-vs-explicit-override rule as every other string the view
 * translator overlays (ADR-0029 D9.2a).
 *
 * Before this, `TranslationDataSchema` declared the key, the i18n extractor
 * scaffolded it and objectui's form renderers resolved it client-side, but no
 * exported resolver read it: a server-side reader that has to translate on the
 * caller's behalf — the anonymous public form, whose visitor cannot load the
 * bundle — served every section heading as authored, beside translated field
 * labels.
 *
 * The served documents below are what `expandViewContainer` emits from an
 * authored container (the composer the registrars run), and both the
 * container and the bundle's object node are PARSED by the authoring schemas,
 * so a section address or a catalog key neither schema carries cannot pass.
 */

import { describe, it, expect } from 'vitest';
import { translateView, translateMetadataDocument } from './i18n-resolver';
import { ObjectTranslationDataSchema, type TranslationBundle } from './translation.zod';
import { ViewSchema, expandViewContainer } from '../ui/view.zod';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** The container as the package ships it. */
const CONTAINER = {
  form: {
    type: 'simple' as const,
    data: { provider: 'object' as const, object: 'crm_lead' },
    sections: [
      { name: 'basics', label: 'Basics', description: 'Who is asking', fields: ['name'] },
      // No bundle entry — the negative control for a missing key.
      { name: 'notes', label: 'Notes', description: 'Anything else', fields: ['note'] },
      // No `name`: no `_sections` key, whatever the bundle carries — including a
      // key equal to the slug of its label, which must NOT be read.
      { label: 'Contact Details', description: 'How to reach them', fields: ['email'] },
      // Named, but authors neither a heading nor a description.
      { name: 'extra', fields: ['phone'] },
    ],
  },
  formViews: {
    // Retargeted at another object: its sections key under the form's OWN
    // binding, the object the extractor and the linter bind them to.
    referral: {
      type: 'simple' as const,
      data: { provider: 'object' as const, object: 'crm_contact' },
      sections: [{ name: 'basics', label: 'Basics', fields: ['name'] }],
    },
  },
};

const served = (name: string): any => {
  const item = expandViewContainer('crm_lead', CONTAINER).find((v) => v.name === name);
  if (!item) throw new Error(`fixture missing ${name}`);
  return item;
};
const PACKAGED = served('crm_lead.form');

const LEAD_ZH = {
  _sections: {
    basics: { label: '基本信息', description: '咨询人是谁' },
    contact_details: { label: 'MUST-NOT-APPLY', description: 'MUST-NOT-APPLY' },
    extra: { label: 'MUST-NOT-APPLY', description: 'MUST-NOT-APPLY' },
  },
};
const LEAD_EN = {
  _sections: { basics: { label: 'Basics', description: 'Who is asking' } },
};
const CONTACT_ZH = {
  _sections: { basics: { label: '联系人基本信息' } },
};

const BUNDLE: TranslationBundle = {
  en: { objects: { crm_lead: LEAD_EN } } as any,
  'zh-CN': { objects: { crm_lead: LEAD_ZH, crm_contact: CONTACT_ZH } } as any,
};

const section = (view: any, name: string): any => view.config.sections.find((s: any) => s.name === name);

describe('translateView — a form view\'s sections, keyed under `_sections`', () => {
  it('composes the identity this test is pinned to — legal fixtures, sections live under `config`', () => {
    expect(ViewSchema.safeParse(CONTAINER).success).toBe(true);
    for (const node of [LEAD_ZH, LEAD_EN, CONTACT_ZH]) {
      expect(ObjectTranslationDataSchema.safeParse(node).success).toBe(true);
    }
    expect(PACKAGED.viewKind).toBe('form');
    expect(PACKAGED.object).toBe('crm_lead');
    expect(PACKAGED.sections).toBeUndefined();
    expect(PACKAGED.config.sections.map((s: any) => s.name)).toEqual(['basics', 'notes', undefined, 'extra']);
  });

  it('a zh-CN pack with a `_sections` key yields the translated label and description', () => {
    const out = translateMetadataDocument('view', clone(PACKAGED), BUNDLE, { locale: 'zh-CN' });
    expect(section(out, 'basics')).toMatchObject({ label: '基本信息', description: '咨询人是谁', fields: ['name'] });
  });

  it('a missing key yields the authored text', () => {
    const out = translateMetadataDocument('view', clone(PACKAGED), BUNDLE, { locale: 'zh-CN' });
    expect(section(out, 'notes')).toEqual(PACKAGED.config.sections[1]);
    // A key that carries a label but no description leaves the description as authored.
    const label = translateMetadataDocument('view', clone(served('crm_lead.referral')), BUNDLE, { locale: 'zh-CN' });
    expect(section(label, 'basics').label).toBe('联系人基本信息');
    expect(section(label, 'basics').description).toBeUndefined();
  });

  it('a section with no `name` is left as authored — it has no key, and its label is never slugged into one', () => {
    const doc = clone(PACKAGED);
    const out = translateView(doc, BUNDLE, { locale: 'zh-CN' }) as any;
    expect(out.config.sections[2]).toBe(doc.config.sections[2]);
    expect(out.config.sections[2]).toMatchObject({ label: 'Contact Details', description: 'How to reach them' });
  });

  it('the catalog translates authored copy only — it never adds a heading or a description', () => {
    const out = translateView(clone(PACKAGED), BUNDLE, { locale: 'zh-CN' }) as any;
    expect(section(out, 'extra').label).toBeUndefined();
    expect(section(out, 'extra').description).toBeUndefined();
  });

  it('an inline locale map heading is authored text and takes the catalog, as a view label does', () => {
    const doc = clone(PACKAGED);
    doc.config.sections[0].label = { en: 'Basics', 'zh-CN': '基础' };
    const out = translateView(doc, BUNDLE, { locale: 'zh-CN' }) as any;
    expect(section(out, 'basics').label).toBe('基本信息');
  });

  it('keys a retargeted form\'s sections under the form\'s own `data.object`', () => {
    const referral = served('crm_lead.referral');
    expect(referral.object).toBe('crm_lead');
    const out = translateView(clone(referral), BUNDLE, { locale: 'zh-CN' }) as any;
    // `crm_lead._sections.basics` would read 基本信息; the form binds crm_contact.
    expect(section(out, 'basics').label).toBe('联系人基本信息');
  });

  it('walks the shared locale chain — BCP-47 ladder, declared fallback chain, default locale', () => {
    expect(section(translateView(clone(PACKAGED), BUNDLE, { locale: 'zh' }), 'basics').label).toBe('基本信息');
    const viaChain = translateView(clone(PACKAGED), BUNDLE, { locale: 'fr-FR', fallbackChain: ['zh-CN'] });
    expect(section(viaChain, 'basics').label).toBe('基本信息');
    // A request for the default locale never walks the chain: the authored text answers.
    const asDefault = translateView(clone(PACKAGED), BUNDLE, {
      locale: 'fr-FR', defaultLocale: 'fr-FR', fallbackChain: ['zh-CN'],
    });
    expect(section(asDefault, 'basics').label).toBe('Basics');
  });

  it('returns the SAME `config` reference when no section gained a translation, and never mutates its input', () => {
    const doc = clone(PACKAGED);
    expect((translateView(doc, { 'ja-JP': {} }, { locale: 'ja-JP' }) as any).config).toBe(doc.config);
    const before = clone(doc);
    translateView(doc, BUNDLE, { locale: 'zh-CN' });
    expect(doc).toEqual(before);
  });
});

describe('translateView — a form section\'s copy loses to an explicit override (ADR-0029 D9.2a)', () => {
  it('an unedited form view gets the catalog for every section string', () => {
    const out = translateView(clone(PACKAGED), BUNDLE, { locale: 'zh-CN', packagedBase: PACKAGED });
    expect(section(out, 'basics')).toMatchObject({ label: '基本信息', description: '咨询人是谁' });
  });

  it('an edited heading is served as edited — in zh-CN and in the source locale — and judged apart from its description', () => {
    const doc = clone(PACKAGED);
    doc.config.sections[0].label = 'Basics (edited)';
    for (const locale of ['zh-CN', 'en']) {
      const out = translateView(doc, BUNDLE, { locale, packagedBase: PACKAGED });
      expect(section(out, 'basics').label, locale).toBe('Basics (edited)');
    }
    expect(section(translateView(doc, BUNDLE, { locale: 'zh-CN', packagedBase: PACKAGED }), 'basics').description)
      .toBe('咨询人是谁');
  });

  it('a section the package does not ship was authored after the fact and keeps its strings', () => {
    const doc = clone(PACKAGED);
    doc.config.sections[0].name = 'contact_details';
    doc.config.sections[0].label = 'Added by the org';
    const out = translateView(doc, BUNDLE, { locale: 'zh-CN', packagedBase: PACKAGED });
    expect(section(out, 'contact_details').label).toBe('Added by the org');
  });

  it('NO packaged base supplied → the catalog applies (the control)', () => {
    const doc = clone(PACKAGED);
    doc.config.sections[0].label = 'Basics (edited)';
    expect(section(translateView(doc, BUNDLE, { locale: 'zh-CN' }), 'basics').label).toBe('基本信息');
  });
});

/**
 * A section's ENTRIES override an object field's `label`, `placeholder` and
 * `helpText` for that form alone, and those three are addressed under the
 * section's own node: `objects.<object>._sections.<section>.fields.<field>`.
 */
const ENTRY_CONTAINER = {
  form: {
    type: 'simple' as const,
    data: { provider: 'object' as const, object: 'crm_case' },
    sections: [
      {
        name: 'submitter',
        label: 'About you',
        fields: [
          { field: 'contact_name', label: 'Your name', placeholder: 'Jane Doe', helpText: 'As on your ID' },
          // Authors only a label: the catalog never adds a placeholder or help text.
          { field: 'contact_email', label: 'Your email' },
          // A bare name authors no copy at all.
          'subject',
          // No bundle entry — the negative control for a missing key.
          { field: 'phone', label: 'Your phone', placeholder: '+1 555', helpText: 'Optional' },
        ],
      },
      // No `name`: its entries have no address, whatever the bundle carries.
      { label: 'Details', fields: [{ field: 'description', label: 'What happened' }] },
    ],
  },
};

const ENTRY_PACKAGED: any = expandViewContainer('crm_case', ENTRY_CONTAINER).find((v) => v.name === 'crm_case.form');

const CASE_ZH = {
  _sections: {
    submitter: {
      label: '关于您',
      fields: {
        contact_name: { label: '您的姓名', placeholder: '张三', helpText: '与证件一致' },
        contact_email: { label: '您的邮箱', placeholder: 'MUST-NOT-APPLY', helpText: 'MUST-NOT-APPLY' },
        subject: { label: 'MUST-NOT-APPLY' },
      },
    },
    details: { fields: { description: { label: 'MUST-NOT-APPLY' } } },
  },
};

const ENTRY_BUNDLE: TranslationBundle = { 'zh-CN': { objects: { crm_case: CASE_ZH } } as any };

const entry = (view: any, sectionIndex: number, field: string): any =>
  view.config.sections[sectionIndex].fields.find((f: any) => (typeof f === 'string' ? f : f.field) === field);

describe('translateView — a form section entry\'s copy, keyed under `_sections.<section>.fields.<field>`', () => {
  it('composes legal fixtures — the container and the pack node both parse', () => {
    expect(ViewSchema.safeParse(ENTRY_CONTAINER).success).toBe(true);
    expect(ObjectTranslationDataSchema.safeParse(CASE_ZH).success).toBe(true);
    expect(ENTRY_PACKAGED.config.sections[0].fields).toHaveLength(4);
  });

  it('a zh-CN pack yields the translated entry `label`', () => {
    const out = translateView(clone(ENTRY_PACKAGED), ENTRY_BUNDLE, { locale: 'zh-CN' });
    expect(entry(out, 0, 'contact_name').label).toBe('您的姓名');
  });

  it('a zh-CN pack yields the translated entry `placeholder`', () => {
    const out = translateView(clone(ENTRY_PACKAGED), ENTRY_BUNDLE, { locale: 'zh-CN' });
    expect(entry(out, 0, 'contact_name').placeholder).toBe('张三');
  });

  it('a zh-CN pack yields the translated entry `helpText`', () => {
    const out = translateView(clone(ENTRY_PACKAGED), ENTRY_BUNDLE, { locale: 'zh-CN' });
    expect(entry(out, 0, 'contact_name').helpText).toBe('与证件一致');
    // The section heading beside it is translated by the same reading.
    expect(out.config.sections[0].label).toBe('关于您');
  });

  it('a missing key yields the authored entry copy', () => {
    const out = translateView(clone(ENTRY_PACKAGED), ENTRY_BUNDLE, { locale: 'zh-CN' });
    expect(entry(out, 0, 'phone')).toEqual(ENTRY_PACKAGED.config.sections[0].fields[3]);
  });

  it('only authored copy is translated — the catalog never adds a placeholder or help text, nor copy to a bare name', () => {
    const out = translateView(clone(ENTRY_PACKAGED), ENTRY_BUNDLE, { locale: 'zh-CN' });
    expect(entry(out, 0, 'contact_email')).toEqual({ field: 'contact_email', label: '您的邮箱' });
    expect(entry(out, 0, 'subject')).toBe('subject');
  });

  it('an entry of a section with no `name` is left as authored', () => {
    const doc = clone(ENTRY_PACKAGED);
    const out = translateView(doc, ENTRY_BUNDLE, { locale: 'zh-CN' }) as any;
    expect(out.config.sections[1]).toBe(doc.config.sections[1]);
  });

  it('an edited entry string keeps its value against the packaged base, judged apart from its siblings', () => {
    const doc = clone(ENTRY_PACKAGED);
    doc.config.sections[0].fields[0].label = 'Full name (edited)';
    const out = translateView(doc, ENTRY_BUNDLE, { locale: 'zh-CN', packagedBase: ENTRY_PACKAGED });
    expect(entry(out, 0, 'contact_name')).toMatchObject({
      label: 'Full name (edited)', placeholder: '张三', helpText: '与证件一致',
    });
    // NO packaged base supplied → the catalog applies (the control).
    expect(entry(translateView(doc, ENTRY_BUNDLE, { locale: 'zh-CN' }), 0, 'contact_name').label).toBe('您的姓名');
  });

  it('an entry the packaged section does not carry was authored after the fact and keeps its strings', () => {
    const base = clone(ENTRY_PACKAGED);
    base.config.sections[0].fields = base.config.sections[0].fields.slice(1);
    const out = translateView(clone(ENTRY_PACKAGED), ENTRY_BUNDLE, { locale: 'zh-CN', packagedBase: base });
    expect(entry(out, 0, 'contact_name').label).toBe('Your name');
  });

  it('never mutates its input', () => {
    const doc = clone(ENTRY_PACKAGED);
    const before = clone(doc);
    translateView(doc, ENTRY_BUNDLE, { locale: 'zh-CN' });
    expect(doc).toEqual(before);
  });
});
