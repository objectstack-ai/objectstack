// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21500] `ViewSchema.form` is a container's "Default form view" and
// `formViews` are "Additional named form views". The expansion every registrar
// shares serves exactly that: `form` is its own item and the one default form;
// a named form is never the default and never stands in for `form`; with no
// `form` there is no default form. The list family collapses its default `list`
// only into a named entry that restates the whole body.
//
// The door-level probe for the same contract is
// `packages/qa/dogfood/test/view-container-default-form.dogfood.test.ts`.

import { describe, it, expect } from 'vitest';
import { expandViewContainerWithDiagnostics, type ExpandedViewItem } from './view.zod';

const OBJ = 'crm_lead';
const data = { provider: 'object', object: OBJ };

const forms = (items: ExpandedViewItem[]) => items.filter((i) => i.viewKind === 'form');
const lists = (items: ExpandedViewItem[]) => items.filter((i) => i.viewKind === 'list');
const defaults = (items: ExpandedViewItem[]) => items.filter((i) => i.isDefault === true).map((i) => i.name);
const sectionNames = (item: ExpandedViewItem | undefined) =>
  ((item?.config?.sections ?? []) as Array<{ name?: string }>).map((s) => s.name);

/** The default form: type `simple`, no label, no columns, one `intake` section. */
const defaultForm = {
  type: 'simple',
  sections: [{ name: 'intake', label: 'Intake', fields: [{ field: 'name' }, { field: 'need_type' }] }],
};

describe('expandViewContainerWithDiagnostics — the form family serves `form` as the one default form', () => {
  it('a `form` beside named forms of its own type, label and columns is served, and is the only default', () => {
    // HotCRM's shape: two named forms share `form`'s { type, label, columns }.
    const { items, collisions } = expandViewContainerWithDiagnostics(OBJ, {
      form: defaultForm,
      formViews: {
        detail_form: { type: 'tabbed', sections: [{ name: 'general', label: 'General', fields: [{ field: 'name' }] }] },
        web_to_lead: { type: 'simple', data, sections: [{ name: 'contact_us', label: 'Contact us', fields: [{ field: 'name' }] }] },
        advanced_conditional: { type: 'simple', sections: [{ name: 'rules', label: 'Rules', fields: [{ field: 'name' }] }] },
      },
    });
    expect(collisions).toEqual([]);
    expect(forms(items).map((i) => i.name)).toEqual([
      `${OBJ}.detail_form`, `${OBJ}.web_to_lead`, `${OBJ}.advanced_conditional`, `${OBJ}.form`,
    ]);
    expect(defaults(forms(items))).toEqual([`${OBJ}.form`]);
    expect(sectionNames(forms(items).find((i) => i.name === `${OBJ}.form`))).toEqual(['intake']);
  });

  it('a named form whose body equals `form` stays its own named item, and only `form` is default', () => {
    const { items } = expandViewContainerWithDiagnostics(OBJ, {
      form: defaultForm,
      formViews: { same: structuredClone(defaultForm) },
    });
    expect(forms(items).map((i) => i.name)).toEqual([`${OBJ}.same`, `${OBJ}.form`]);
    expect(defaults(forms(items))).toEqual([`${OBJ}.form`]);
    expect(forms(items).find((i) => i.name === `${OBJ}.same`)!.isDefault).toBeUndefined();
  });

  it('a container with no `form` declares no default form: every named form is served by name, none default', () => {
    const { items } = expandViewContainerWithDiagnostics(OBJ, {
      list: { type: 'grid', label: 'All', data, columns: ['name'] },
      formViews: {
        web_to_lead: { type: 'simple', data, sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/contact-us' } },
        edit: { type: 'simple', data, sections: [{ name: 'lead', label: 'Lead', fields: [{ field: 'name' }] }] },
      },
    });
    expect(forms(items).map((i) => i.name)).toEqual([`${OBJ}.web_to_lead`, `${OBJ}.edit`]);
    // "Not default" is the list family's own spelling: no `isDefault` key at all.
    for (const item of forms(items)) expect(item).not.toHaveProperty('isDefault');
    // The list family's default is untouched.
    expect(defaults(lists(items))).toEqual([`${OBJ}.default`]);
  });
});

describe('expandViewContainerWithDiagnostics — the list family collapses `list` only into a whole-body restatement', () => {
  const list = { type: 'grid', label: 'All Leads', data, columns: [{ field: 'name' }, { field: 'company' }] };

  it('a named list of the same type, label and columns but a different filter is its own view; `list` is served beside it as the default', () => {
    const mine = { ...list, filter: [{ field: 'owner', operator: 'equals', value: '$currentUser' }] };
    const { items, collisions } = expandViewContainerWithDiagnostics(OBJ, { list, listViews: { mine } });
    expect(collisions).toEqual([]);
    expect(lists(items).map((i) => i.name)).toEqual([`${OBJ}.mine`, `${OBJ}.default`]);
    expect(defaults(lists(items))).toEqual([`${OBJ}.default`]);
    // Both bodies survive: the default list carries no filter, the named one keeps its own.
    expect(lists(items).find((i) => i.name === `${OBJ}.default`)!.config.filter).toBeUndefined();
    expect(lists(items).find((i) => i.name === `${OBJ}.mine`)!.config.filter).toEqual(mine.filter);
  });

  it('a named list that restates `list` key for key, in any key order, collapses with it into the named item, which is the default', () => {
    const all = { columns: list.columns, data, label: list.label, type: list.type };
    const { items, collisions } = expandViewContainerWithDiagnostics(OBJ, { list, listViews: { all } });
    expect(collisions).toEqual([]);
    expect(lists(items).map((i) => i.name)).toEqual([`${OBJ}.all`]);
    expect(defaults(lists(items))).toEqual([`${OBJ}.all`]);
  });

  it('the default list\'s own `name` is its identity, not its body: a restatement that differs only there still collapses', () => {
    const { items } = expandViewContainerWithDiagnostics(OBJ, { list: { ...list, name: 'all_leads' }, listViews: { all: list } });
    expect(lists(items).map((i) => i.name)).toEqual([`${OBJ}.all`]);
    expect(defaults(lists(items))).toEqual([`${OBJ}.all`]);
  });
});
