// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0159 card ② items 1, 4 and 6] The `form` metadata type at the spec
 * layer: the authored item's schema (derived from `FormViewSchema` by
 * reference, the name's prefix equal to its object, `data` and the view-item
 * keys refused by name), THE projection of the three old `view` shapes, and
 * the intake layer the anonymous doors judge withdrawal and closed links by.
 */

import { describe, expect, it } from 'vitest';
import {
  FormSchema,
  FormViewSchema,
  PROJECTED_FORM_SOURCE_KEY,
  defineForm,
  projectViewForms,
  projectedFormsOf,
} from './view.zod';
import { formExplicitlyWithdraws } from './anonymous-form-intake';
import { formIntakeLayer, openFormAt } from './form-intake-layer';
import { oldShapeFormWithdrawals } from './old-shape-form-withdrawals';

const OPEN = { enabled: true, allowAnonymous: true, publicLink: '/forms/contact-us' };
const SECTIONS = [{ fields: [{ field: 'name' }, { field: 'email' }] }];
const authored = (over: Record<string, unknown> = {}) => ({
  name: 'crm_lead.web_to_lead',
  object: 'crm_lead',
  type: 'simple',
  sections: SECTIONS,
  sharing: OPEN,
  ...over,
});
const issuesOf = (value: unknown) => {
  const r = FormSchema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
};

describe('[ADR-0159 D2, D3] FormSchema — the authored `form` item', () => {
  it('parses a form whose name is OBJECT.KEY, its body at the top level', () => {
    const parsed = defineForm(authored() as Parameters<typeof defineForm>[0]);
    expect(parsed.name).toBe('crm_lead.web_to_lead');
    expect(parsed.object).toBe('crm_lead');
    expect(parsed.sharing?.publicLink).toBe('/forms/contact-us');
  });

  it('derives every body key from FormViewSchema by reference, less `data`', () => {
    const body = Object.keys(FormViewSchema.shape).filter((k) => k !== 'data');
    const shape = (FormSchema as any).shape ?? (FormSchema as any)._def?.schema?.shape;
    // The authored item accepts each body key of the form view (none is transcribed).
    for (const key of body) expect(issuesOf(authored({ [key]: undefined })).filter((i) => i.path === key)).toEqual([]);
    expect(shape === undefined || !('data' in shape)).toBe(true);
  });

  it('refuses a name whose prefix is not its object, with the rename', () => {
    const issues = issuesOf(authored({ name: 'crm_contact.web_to_lead' }));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('name');
    expect(issues[0].message).toContain("Rename it 'crm_lead.web_to_lead'");
  });

  it.each(['data', 'viewKind', 'config', 'isDefault', 'order', 'scope'])('refuses `%s` by name', (key) => {
    const issues = issuesOf(authored({ [key]: key === 'data' ? { provider: 'object', object: 'crm_lead' } : 'form' }));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.message).join(' ')).toContain(`\`${key}\``);
  });

  it('applies the form view\'s cross-field rules (one Zod source)', () => {
    // A tabbed form with no sections is refused by the view rules, so it is by the item.
    const view = FormViewSchema.safeParse({ type: 'tabbed' });
    const item = FormSchema.safeParse(authored({ type: 'tabbed', sections: undefined }));
    expect(item.success).toBe(view.success);
  });
});

describe('[ADR-0159 D5] projectViewForms — THE projection of the three old shapes', () => {
  it('projects a container\'s `form` and each `formViews` entry under the names the expansion serves', () => {
    const { forms, lists } = projectViewForms({
      name: 'crm_lead',
      list: { type: 'grid', columns: ['name'] },
      form: { type: 'simple', sections: SECTIONS },
      formViews: { contact: { type: 'simple', sections: SECTIONS, sharing: OPEN } },
    });
    expect(forms.map((f) => [f.name, f.object])).toEqual([['crm_lead.contact', 'crm_lead'], ['crm_lead.form', 'crm_lead']]);
    expect(forms[0].sharing).toEqual(OPEN);
    expect(forms[0][PROJECTED_FORM_SOURCE_KEY]).toBe('view');
    expect(lists.length).toBeGreaterThan(0);
  });

  it('projects a `viewKind: \'form\'` item under its own name, the body lifted unchanged', () => {
    const config = { type: 'simple', data: { provider: 'object', object: 'crm_lead' }, sections: SECTIONS, sharing: OPEN };
    const { forms, lists } = projectViewForms({ name: 'contact_us', viewKind: 'form', label: 'Contact', config });
    expect(lists).toEqual([]);
    expect(forms).toHaveLength(1);
    // Never parsed by FormSchema: the name keeps no OBJECT prefix and `data` stays.
    expect(forms[0]).toMatchObject({ name: 'contact_us', object: 'crm_lead', label: 'Contact', data: config.data });
  });

  it('carries the view item\'s own requiredPermissions onto the projected form', () => {
    const { forms } = projectViewForms({
      name: 'contact_us', viewKind: 'form', requiredPermissions: ['crm.read'],
      config: { data: { provider: 'object', object: 'crm_lead' }, sections: SECTIONS },
    });
    expect(forms[0].requiredPermissions).toEqual(['crm.read']);
  });

  it('reads a list item as a list, never a form', () => {
    expect(projectViewForms({ name: 'all_leads', viewKind: 'list', config: { columns: ['name'] } })).toEqual({ forms: [], lists: ['all_leads'] });
  });

  it.each([
    ['a container `formViews` that is not an object', { name: 'crm_lead', form: { sharing: OPEN }, formViews: 'x' }],
    ['a `formViews` entry that is not an object', { name: 'crm_lead', form: { sharing: OPEN }, formViews: { a: 3 } }],
    ['a `viewKind: \'form\'` item with no config', { name: 'contact_us', viewKind: 'form', sharing: OPEN }],
  ])('reads %s as unreadable, with the links it names (rule 7)', (_label, body) => {
    const projection = projectViewForms(body);
    expect(projection.forms).toEqual([]);
    expect(projection.unreadable?.links).toEqual(['contact-us']);
  });

  it('projectedFormsOf keeps the first body that projects a name, containers first', () => {
    const item = { name: 'crm_lead.contact', viewKind: 'form', config: { data: { provider: 'object', object: 'crm_lead' }, title: 'item' } };
    const container = { name: 'crm_lead', formViews: { contact: { title: 'container' } } };
    const forms = projectedFormsOf([item, container]);
    expect(forms.map((f) => [f.name, f.title])).toEqual([['crm_lead.contact', 'container']]);
  });
});

describe('[ADR-0159 D6] the intake layer — withdrawal by name, closed links', () => {
  it('formExplicitlyWithdraws reads a kept link with an explicit off switch', () => {
    expect(formExplicitlyWithdraws({ sharing: { ...OPEN, enabled: false } })).toBe('contact-us');
    expect(formExplicitlyWithdraws({ sharing: { ...OPEN, allowAnonymous: false } })).toBe('contact-us');
    expect(formExplicitlyWithdraws({ sharing: OPEN })).toBeUndefined();
    expect(formExplicitlyWithdraws({ sharing: { enabled: false } })).toBeUndefined();
  });

  it('oldShapeFormWithdrawals reads through the projection', () => {
    expect(oldShapeFormWithdrawals({ name: 'crm_lead', formViews: { contact: { sharing: { ...OPEN, enabled: false } } } }))
      .toEqual([{ name: 'crm_lead.contact', slug: 'contact-us' }]);
  });

  it('a form withdrawn by name in any body is not served at its address', () => {
    const form = { ...authored(), name: 'crm_lead.web_to_lead' };
    const layer = formIntakeLayer({ forms: [{ ...form, sharing: { ...OPEN, enabled: false } }], views: [] });
    expect(openFormAt([form], layer, 'contact-us')).toBeNull();
    expect(openFormAt([form], formIntakeLayer({ forms: [form], views: [] }), 'contact-us')).toMatchObject({ object: 'crm_lead' });
  });

  it('identity is the whole item\'s name: a withdrawal of another name sharing the slug does not close this form (rule 6)', () => {
    const form = authored();
    const other = { ...authored(), name: 'crm_lead.other', sharing: { ...OPEN, enabled: false } };
    expect(openFormAt([form], formIntakeLayer({ forms: [other], views: [] }), 'contact-us')).toMatchObject({ form });
  });

  it('an unreadable stored body closes the links it names (rule 7)', () => {
    const layer = formIntakeLayer({ forms: [], views: [{ name: 'contact_us', viewKind: 'form', sharing: OPEN, _packageId: 'com.acme' }] });
    expect(layer.closedLinks.get('contact-us')).toMatchObject({ type: 'view', name: 'contact_us', packageId: 'com.acme' });
    expect(openFormAt([authored()], layer, 'contact-us')).toBeNull();
    const reported = formIntakeLayer({ forms: [], views: [], unreadable: [{ type: 'view', name: 'x', reason: 'r', links: ['contact-us'] }] });
    expect(openFormAt([authored()], reported, 'contact-us')).toBeNull();
  });
});
