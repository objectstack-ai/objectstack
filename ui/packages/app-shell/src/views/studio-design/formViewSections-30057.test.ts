// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30057 — which layout the Studio form designer edits, and how it
 * writes a form view's sections.
 *
 * Pinned:
 *  - `formLayoutChoiceOf` answers what `selectRecordFormView` answers, for
 *    each flow: the resolver is called, never re-read (a stubbed answer comes
 *    straight back); no form view → none, a default view → it for both flows,
 *    a `create` view → it for New and the default for Edit, and the two flows
 *    then differ;
 *  - `writeFormSectionLayout` keeps every key the designer does not arrange: a
 *    field entry's own keys, a section's other keys, entries the canvas does
 *    not show; a field placed in no section leaves the form; a `group`
 *    section is kept as it is until its members change;
 *  - the section helpers name a new section, rename, move and remove by key.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/recordFormNavigation', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../utils/recordFormNavigation')>();
  return { ...mod, selectRecordFormView: vi.fn(mod.selectRecordFormView) };
});

import { selectRecordFormView, type ObjectDefinitionForFormView } from '../../utils/recordFormNavigation';
import { formLayoutChoiceOf } from './useFormViewDraft';
import {
  addFormSection,
  formSectionMembers,
  formViewSectionsOf,
  moveFormSection,
  removeFormSection,
  renameFormSection,
  withFormViewSections,
  writeFormSectionLayout,
} from './formViewSections';

const formView = { name: 'deal.form', isDefault: true, sections: [{ name: 'basic', fields: ['name'] }] };
const createView = { name: 'deal.create', sections: [{ name: 'quick', fields: ['name'] }] };

describe('formLayoutChoiceOf follows selectRecordFormView (objectstack#30057)', () => {
  it('no form view: no view, for either flow', () => {
    const def: ObjectDefinitionForFormView = { name: 'deal' };
    for (const flow of ['create', 'edit'] as const) {
      expect(formLayoutChoiceOf(def, flow)).toEqual({ flow, view: null, viewId: '', flowsDiffer: false });
    }
  });

  it('a default form view: that view for both flows', () => {
    const def: ObjectDefinitionForFormView = { name: 'deal', form: formView, formViews: { 'deal.form': formView } };
    expect(formLayoutChoiceOf(def, 'create')).toMatchObject({ view: formView, viewId: 'deal.form', flowsDiffer: false });
    expect(formLayoutChoiceOf(def, 'edit')).toMatchObject({ view: formView, viewId: 'deal.form', flowsDiffer: false });
  });

  it('a create form view: New shows it, Edit the default, and the flows differ', () => {
    const def: ObjectDefinitionForFormView = {
      name: 'deal',
      form: formView,
      formViews: { 'deal.form': formView, 'deal.create': createView },
    };
    expect(formLayoutChoiceOf(def, 'create')).toMatchObject({ view: createView, viewId: 'deal.create', flowsDiffer: true });
    expect(formLayoutChoiceOf(def, 'edit')).toMatchObject({ view: formView, viewId: 'deal.form', flowsDiffer: true });
  });

  it("is the resolver's answer, not a second reading of its rule", () => {
    const stub = { name: 'deal.stubbed', sections: [] };
    vi.mocked(selectRecordFormView).mockImplementation(() => stub);
    try {
      const choice = formLayoutChoiceOf({ name: 'deal' }, 'edit');
      expect(choice.view).toBe(stub);
      expect(choice.viewId).toBe('deal.stubbed');
      expect(vi.mocked(selectRecordFormView)).toHaveBeenCalledWith({ name: 'deal' }, 'edit');
    } finally {
      vi.mocked(selectRecordFormView).mockReset();
    }
  });
});

const groupOf = (groups: Record<string, string>) => (f: string) => groups[f];

describe('writeFormSectionLayout keeps what the designer does not arrange (objectstack#30057)', () => {
  const sections = [
    { name: 'basic', label: 'Basic', columns: 2, collapsible: true, fields: [{ field: 'name', required: true }, 'amount', 'created_at'] },
    { name: 'more', label: 'More', fields: [{ field: 'stage', readonly: true }] },
  ];
  const shown = ['name', 'amount', 'stage', 'notes'];

  it('reads members among the shown fields, and writes a move with every entry kept', () => {
    expect(Object.fromEntries(formSectionMembers(sections, shown, groupOf({})))).toEqual({
      basic: ['name', 'amount'],
      more: ['stage'],
    });
    const next = writeFormSectionLayout(
      sections,
      new Map([
        ['basic', ['amount']],
        ['more', ['stage', 'name', 'notes']],
      ]),
      shown,
      [],
      groupOf({}),
    );
    expect(next).toEqual([
      // `created_at` is not drawn: it rides back after the shown fields.
      { name: 'basic', label: 'Basic', columns: 2, collapsible: true, fields: ['amount', 'created_at'] },
      { name: 'more', label: 'More', fields: [{ field: 'stage', readonly: true }, { field: 'name', required: true }, { field: 'notes' }] },
    ]);
  });

  it('a field placed in no section leaves the form', () => {
    const next = writeFormSectionLayout(sections, new Map([['basic', ['name']], ['more', ['stage']]]), shown, [], groupOf({}));
    expect(next[0].fields).toEqual([{ field: 'name', required: true }, 'created_at']);
  });

  it('a group section is kept while its members are, and written out once they change', () => {
    const withGroup = [{ group: 'contact', columns: 1 }, ...sections];
    const groups = [{ key: 'contact', label: 'Contact' }];
    const of = groupOf({ notes: 'contact' });
    const layout = new Map<string, string[]>([
      ['#0', ['notes']],
      ['basic', ['name', 'amount']],
      ['more', ['stage']],
    ]);
    expect(writeFormSectionLayout(withGroup, layout, shown, groups, of)[0]).toBe(withGroup[0]);
    layout.set('#0', ['notes', 'stage']);
    layout.set('more', []);
    expect(writeFormSectionLayout(withGroup, layout, shown, groups, of)[0]).toEqual({
      columns: 1,
      name: 'contact',
      label: 'Contact',
      fields: [{ field: 'notes' }, { field: 'stage' }],
    });
  });
});

describe('form view section helpers (objectstack#30057)', () => {
  const sections = [{ name: 'a', label: 'A', fields: [] }, { label: 'Unnamed', fields: [] }];

  it('add names the new section; rename, move and remove address it by key', () => {
    const added = addFormSection(sections, 'Contact Info');
    expect(added[2]).toEqual({ name: 'contact_info', label: 'Contact Info', fields: [] });
    expect(renameFormSection(sections, '#1', 'Other')[1]).toEqual({ label: 'Other', fields: [] });
    expect(moveFormSection(sections, 'a', 1).map((s) => s.label)).toEqual(['Unnamed', 'A']);
    expect(removeFormSection(sections, 'a')).toEqual([{ label: 'Unnamed', fields: [] }]);
  });

  it('reads and writes the sections of a record-shaped and a flat view item', () => {
    const record = { name: 'deal.form', viewKind: 'form', config: { type: 'tabbed', sections } };
    expect(formViewSectionsOf(record)).toEqual(sections);
    expect(withFormViewSections(record, [])).toEqual({ name: 'deal.form', viewKind: 'form', config: { type: 'tabbed', sections: [] } });
    const flat = { name: 'deal.form', sections };
    expect(withFormViewSections(flat, [])).toEqual({ name: 'deal.form', sections: [] });
  });
});
