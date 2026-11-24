// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { anonymousFormIntakeCandidates } from '@objectstack/spec/ui';
import {
  addressProblem,
  fieldsOnForm,
  fillableFields,
  isPublicFormItem,
  missingRequiredFields,
  newPublicFormModel,
  objectRequiredFields,
  previewSectionsOf,
  publicFormItemOf,
  publicFormModelOf,
  slugFromTitle,
  takenAddresses,
  withField,
  withFieldMoved,
  withoutField,
  withoutSection,
  withRequired,
  withSection,
  withSectionLabel,
  withSectionMoved,
} from './publicFormDesign';

/**
 * objectstack#36444 — the rules of Studio's public form designer: which
 * fields a form may hold and must keep, the address rule, and the view item a
 * design is saved as.
 */

const lead = {
  name: 'crm_lead',
  fields: {
    name: { type: 'text', label: 'Lead Name', required: true },
    company: { type: 'text', label: 'Company' },
    email: { type: 'email', label: 'Email', required: true },
    phone: { type: 'phone', label: 'Phone' },
    title: { type: 'text', label: 'Title' },
    score: { type: 'formula', label: 'Score' },
    total: { type: 'summary', label: 'Total' },
    code: { type: 'autonumber', label: 'Code' },
    internal: { type: 'text', label: 'Internal', hidden: true },
    locked: { type: 'text', label: 'Locked', readonly: true },
    owning_business_unit_id: { type: 'lookup', system: true, hidden: true },
    created_at: { type: 'datetime', label: 'Created' },
  },
};

const stored = {
  name: 'crm_lead.web_to_lead',
  object: 'crm_lead',
  viewKind: 'form',
  label: 'Contact us',
  _packageId: 'com.example.crm',
  config: {
    type: 'simple',
    data: { provider: 'object', object: 'crm_lead' },
    sections: [
      {
        name: 'contact_us',
        label: 'Contact us',
        collapsible: false,
        columns: 1,
        fields: [
          { field: 'name', required: true, span: 'auto' },
          { field: 'company' },
          { field: 'email', required: true },
          { field: 'phone' },
          { field: 'title' },
        ],
      },
    ],
    sharing: { enabled: true, publicLink: '/forms/contact-us', allowAnonymous: true },
  },
};

const required = new Set(objectRequiredFields(lead));

describe('the fields a public form may hold', () => {
  it('offers the fillable fields only: no hidden, read-only, system, formula, roll-up or auto-number field', () => {
    expect(fillableFields(lead).map((f) => f.name)).toEqual(['name', 'company', 'email', 'phone', 'title']);
  });
  it('knows the fields the object requires', () => {
    expect(objectRequiredFields(lead)).toEqual(['name', 'email']);
  });
  it('does not hold a form to a field the object fills in itself (a default value, or a default choice)', () => {
    const withDefaults = {
      fields: {
        status: { type: 'select', required: true, defaultValue: 'new' },
        stage: { type: 'select', required: true, options: [{ value: 'a' }, { value: 'b', default: true }] },
        source: { type: 'select', required: true, options: [{ value: 'web' }] },
      },
    };
    expect(objectRequiredFields(withDefaults)).toEqual(['source']);
  });
  it('reads `fields` as an array too', () => {
    expect(fillableFields({ fields: [{ name: 'a', type: 'text' }, { name: 'b', type: 'formula' }] }).map((f) => f.name)).toEqual(['a']);
  });
});

describe('the model of a stored public form', () => {
  it('reads title, address, sections and required marks', () => {
    const model = publicFormModelOf(stored);
    expect(model).toMatchObject({ name: 'crm_lead.web_to_lead', object: 'crm_lead', title: 'Contact us', slug: 'contact-us', enabled: true });
    expect(model.sections).toEqual([
      {
        key: 'contact_us',
        label: 'Contact us',
        fields: [
          { field: 'name', required: true },
          { field: 'company', required: false },
          { field: 'email', required: true },
          { field: 'phone', required: false },
          { field: 'title', required: false },
        ],
      },
    ]);
  });

  it('writes back only what was edited, keeping every other key and dropping the read\'s decorations', () => {
    let model = publicFormModelOf(stored);
    model = withRequired(model, 'phone', true, required);
    model = withoutField(model, 'title', required);
    model = { ...model, title: 'Get in touch' };
    const item = publicFormItemOf(model, stored);
    expect(item._packageId).toBeUndefined();
    expect(item.label).toBe('Get in touch');
    expect(item.config.title).toBe('Get in touch');
    expect(item.config.sections[0]).toEqual({
      name: 'contact_us',
      label: 'Contact us',
      collapsible: false,
      columns: 1,
      fields: [
        { field: 'name', required: true, span: 'auto' },
        { field: 'company' },
        { field: 'email', required: true },
        { field: 'phone', required: true },
      ],
    });
    expect(item.config.sharing).toEqual(stored.config.sharing);
    // The served rule still opens it, at the same address.
    expect(anonymousFormIntakeCandidates(item).map((c) => c.slug)).toEqual(['contact-us']);
  });

  it('writes the after-submit message as a thank-you panel, and removes it when cleared', () => {
    const model = { ...publicFormModelOf(stored), thankYouTitle: 'Thanks!', thankYouMessage: 'We will be in touch.' };
    const item = publicFormItemOf(model, stored);
    expect(item.config.submitBehavior).toEqual({ kind: 'thank-you', title: 'Thanks!', message: 'We will be in touch.' });
    const back = publicFormModelOf(item);
    expect([back.thankYouTitle, back.thankYouMessage]).toEqual(['Thanks!', 'We will be in touch.']);
    const cleared = publicFormItemOf({ ...back, thankYouTitle: '', thankYouMessage: '' }, item);
    expect(cleared.config.submitBehavior).toBeUndefined();
  });

  it('keeps a submit behaviour that is not a thank-you panel', () => {
    const redirecting = { ...stored, config: { ...stored.config, submitBehavior: { kind: 'redirect', url: '/thanks' } } };
    const item = publicFormItemOf(publicFormModelOf(redirecting), redirecting);
    expect(item.config.submitBehavior).toEqual({ kind: 'redirect', url: '/thanks' });
  });
});

describe('writing back a form stored in other shapes the spec allows', () => {
  it('keeps every key of a section stored without a name, and of its field entries', () => {
    const unnamed = {
      ...stored,
      config: {
        ...stored.config,
        sections: [
          {
            label: 'About you',
            description: 'Tell us who you are',
            columns: 2,
            collapsible: true,
            collapsed: false,
            visibleOn: "record.source == 'web'",
            fields: [{ field: 'name', required: true, span: 'full' }, { field: 'company', helpText: 'Where you work' }, 'email'],
          },
          { name: 'more', columns: 1, fields: [{ field: 'phone', placeholder: '+1' }] },
        ],
      },
    };
    let model = publicFormModelOf(unnamed);
    expect(model.sections.map((s) => s.key)).toEqual(['section_1', 'more']);
    model = withRequired(model, 'company', true, required);
    model = withFieldMoved(model, 'phone', 'section_1', 0);
    const item = publicFormItemOf(model, unnamed);
    expect(item.config.sections[0]).toEqual({
      name: 'section_1',
      label: 'About you',
      description: 'Tell us who you are',
      columns: 2,
      collapsible: true,
      collapsed: false,
      visibleOn: "record.source == 'web'",
      fields: [
        // A field moved from another section keeps its own keys.
        { field: 'phone', placeholder: '+1' },
        { field: 'name', required: true, span: 'full' },
        { field: 'company', helpText: 'Where you work', required: true },
        // A field stored as its bare name is written as an entry.
        { field: 'email' },
      ],
    });
    expect(item.config.sections[1]).toEqual({ name: 'more', columns: 1, fields: [] });
  });

  it('keys an unnamed section apart from a section named like its place', () => {
    const clash = { ...stored, config: { ...stored.config, sections: [{ label: 'A', columns: 2, fields: ['name'] }, { name: 'section_1', label: 'B', fields: ['email'] }] } };
    const model = publicFormModelOf(clash);
    expect(model.sections.map((s) => s.key)).toEqual(['section_2', 'section_1']);
    const item = publicFormItemOf(model, clash);
    expect(item.config.sections.map((s: { label: string; columns?: number }) => [s.label, s.columns])).toEqual([['A', 2], ['B', undefined]]);
  });

  it('keeps titles and labels stored as maps of translations when they were not edited', () => {
    const translated = {
      ...stored,
      label: undefined,
      config: {
        ...stored.config,
        title: { en: 'Contact us', 'zh-CN': '联系我们' },
        description: { en: 'We reply in a day', 'zh-CN': '一天内回复' },
        sections: [{ ...stored.config.sections[0], label: { en: 'About you', 'zh-CN': '关于你' } }],
        submitBehavior: { kind: 'thank-you', title: { en: 'Thanks', 'zh-CN': '谢谢' }, message: 'We will be in touch.' },
      },
    };
    const model = withRequired(publicFormModelOf(translated), 'phone', true, required);
    const item = publicFormItemOf({ ...model, thankYouMessage: 'Talk soon.' }, translated);
    expect(item.config.title).toEqual(translated.config.title);
    expect(item.config.description).toEqual(translated.config.description);
    expect(item.config.sections[0].label).toEqual({ en: 'About you', 'zh-CN': '关于你' });
    expect(item.config.submitBehavior).toEqual({ kind: 'thank-you', title: { en: 'Thanks', 'zh-CN': '谢谢' }, message: 'Talk soon.' });
    expect(item.label).toBeUndefined();

    // A text the person did edit replaces the map.
    const renamed = withSectionLabel({ ...model, title: 'Get in touch' }, 'contact_us', 'Who you are');
    const edited = publicFormItemOf(renamed, translated);
    expect(edited.config.title).toBe('Get in touch');
    expect(edited.label).toBe('Get in touch');
    expect(edited.config.sections[0].label).toBe('Who you are');
  });

  it('keeps a thank-you title stored as translations when only the message is cleared', () => {
    const translated = { ...stored, config: { ...stored.config, submitBehavior: { kind: 'thank-you', title: { en: 'Thanks', 'zh-CN': '谢谢' }, message: 'We will be in touch.' } } };
    const item = publicFormItemOf({ ...publicFormModelOf(translated), thankYouMessage: '' }, translated);
    expect(item.config.submitBehavior).toEqual({ kind: 'thank-you', title: { en: 'Thanks', 'zh-CN': '谢谢' } });
  });

  it('writes no column count onto a section that had none', () => {
    const model = withSection(newPublicFormModel('crm_lead', 'Demo signup', 'demo-signup', lead), 'More');
    const item = publicFormItemOf(model, null);
    expect(item.config.sections.map((s: Record<string, unknown>) => 'columns' in s)).toEqual([false, false]);
    const kept = publicFormItemOf(publicFormModelOf(stored), stored);
    expect(kept.config.sections[0].columns).toBe(1);
  });
});

describe('a new public form', () => {
  it('starts on with one section holding the fields the object requires, and saves as a form view of its object', () => {
    const model = newPublicFormModel('crm_lead', 'Demo signup', 'demo-signup', lead);
    expect(model.name).toBe('crm_lead.demo_signup');
    expect(model.sections).toEqual([{ key: 'main', label: '', fields: [{ field: 'name', required: true }, { field: 'email', required: true }] }]);
    const item = publicFormItemOf(withField(withField(model, 'company', null, required), 'phone', null, required), null);
    expect(item).toMatchObject({ name: 'crm_lead.demo_signup', object: 'crm_lead', viewKind: 'form', label: 'Demo signup' });
    expect(item.config.data).toEqual({ provider: 'object', object: 'crm_lead' });
    expect(item.config.sections[0].fields.map((f: { field: string }) => f.field)).toEqual(['name', 'email', 'company', 'phone']);
    expect(isPublicFormItem(item)).toBe(true);
    expect(anonymousFormIntakeCandidates(item)).toEqual([expect.objectContaining({ key: 'crm_lead.demo_signup', slug: 'demo-signup' })]);
  });

  it('makes an address from a title', () => {
    expect(slugFromTitle('Demo signup')).toBe('demo-signup');
    expect(slugFromTitle('  Contact Us — 2026!  ')).toBe('contact-us-2026');
    expect(slugFromTitle('线索')).toBe('');
  });
});

describe('the address', () => {
  const taken = takenAddresses([stored, { name: 'x.form', viewKind: 'form', config: {} }, { name: 'other', config: { sharing: { publicLink: 'demo' } } }]);
  it('is refused empty, malformed, or used by another form (switched off included)', () => {
    expect(addressProblem('', 'crm_lead.new', taken)).toBe('empty');
    expect(addressProblem('Contact Us', 'crm_lead.new', taken)).toBe('shape');
    expect(addressProblem('a', 'crm_lead.new', taken)).toBe('shape');
    expect(addressProblem('-x', 'crm_lead.new', taken)).toBe('shape');
    expect(addressProblem('contact-us', 'crm_lead.new', taken)).toBe('taken');
    expect(addressProblem('demo', 'crm_lead.new', taken)).toBe('taken');
  });
  it('is the form\'s own address, or a free one', () => {
    expect(addressProblem('contact-us', 'crm_lead.web_to_lead', taken)).toBeNull();
    expect(addressProblem('demo-signup', 'crm_lead.new', taken)).toBeNull();
  });
});

describe('editing the fields', () => {
  const model = publicFormModelOf(stored);

  it('refuses to remove a field the object requires, and removes any other', () => {
    expect(withoutField(model, 'email', required)).toBe(model);
    expect(fieldsOnForm(withoutField(model, 'title', required))).not.toContain('title');
  });

  it('keeps a field the object requires required on the form', () => {
    const after = withRequired(model, 'email', false, required);
    expect(after.sections[0].fields.find((f) => f.field === 'email')?.required).toBe(true);
    expect(withRequired(model, 'phone', true, required).sections[0].fields.find((f) => f.field === 'phone')?.required).toBe(true);
  });

  it('adds a field once, required when the object requires it', () => {
    const without = withoutField(model, 'title', required);
    expect(withField(without, 'title', 'contact_us', required).sections[0].fields.at(-1)).toEqual({ field: 'title', required: false });
    expect(withField(model, 'title', 'contact_us', required)).toBe(model);
  });

  it('moves a field within a section and across sections', () => {
    const reordered = withFieldMoved(model, 'title', 'contact_us', 0);
    expect(fieldsOnForm(reordered)).toEqual(['title', 'name', 'company', 'email', 'phone']);
    const two = withSection(model, 'About you');
    const key = two.sections[1].key;
    const moved = withFieldMoved(two, 'phone', key, 0);
    expect(moved.sections[1].fields).toEqual([{ field: 'phone', required: false }]);
    expect(fieldsOnForm(moved)).toHaveLength(5);
  });

  it('groups fields into named sections; removing a section keeps its fields', () => {
    const two = withSection(model, 'About you');
    const key = two.sections[1].key;
    const moved = withFieldMoved(two, 'phone', key, 0);
    const swapped = withSectionMoved(moved, key, -1);
    expect(swapped.sections.map((s) => s.label)).toEqual(['About you', 'Contact us']);
    const gone = withoutSection(swapped, key);
    expect(gone.sections).toHaveLength(1);
    expect(fieldsOnForm(gone).sort()).toEqual(['company', 'email', 'name', 'phone', 'title']);
    expect(withoutSection(gone, gone.sections[0].key)).toBe(gone);
  });

  it('names the object-required fields a form lacks', () => {
    const lacking = { ...model, sections: [{ ...model.sections[0], fields: [{ field: 'company', required: false }] }] };
    expect(missingRequiredFields(lacking, required)).toEqual(['name', 'email']);
    expect(missingRequiredFields(model, required)).toEqual([]);
  });

  it('previews an untitled section with no heading', () => {
    const model = newPublicFormModel('crm_lead', 'Demo signup', 'demo-signup', lead);
    expect(previewSectionsOf(model)).toEqual([{ fields: [{ field: 'name', required: true }, { field: 'email', required: true }] }]);
  });

  it('previews the sections as the runtime form takes them', () => {
    expect(previewSectionsOf(model)[0]).toEqual({
      name: 'contact_us',
      label: 'Contact us',
      fields: [{ field: 'name', required: true }, { field: 'company' }, { field: 'email', required: true }, { field: 'phone' }, { field: 'title' }],
    });
  });
});
