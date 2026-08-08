// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { viewContainerSites, formViewSites } from './view-walk.js';
import { validateVisibilityPredicates } from './validate-visibility-predicates.js';
import { validateFormLayout } from './validate-form-layout.js';
import { validateTranslatableSections } from './validate-translatable-sections.js';

type AnyRec = Record<string, unknown>;

describe('viewContainerSites — the ladder (#6381)', () => {
  it('yields every rung, in ladder order, with its path / surface / kind', () => {
    const view: AnyRec = {
      name: 'case_views',
      sections: [],
      list: { type: 'grid' },
      form: { sections: [] },
      listViews: { all: { type: 'grid' }, mine: { type: 'grid' } },
      formViews: { edit: { sections: [] }, create: { sections: [] } },
    };

    // Order is contract, not accident: findings are emitted in walk order, so
    // `self → form → listViews.* → formViews.*` is what both consumers'
    // pinned output orders depend on.
    expect(viewContainerSites(view, 'views[0]')).toEqual([
      { view, path: 'views[0]', surface: '', kind: 'self' },
      { view: view.form, path: 'views[0].form', surface: 'form', kind: 'form' },
      { view: (view.listViews as AnyRec).all, path: 'views[0].listViews.all', surface: 'listViews.all', kind: 'listView' },
      { view: (view.listViews as AnyRec).mine, path: 'views[0].listViews.mine', surface: 'listViews.mine', kind: 'listView' },
      { view: (view.formViews as AnyRec).edit, path: 'views[0].formViews.edit', surface: 'formViews.edit', kind: 'formView' },
      { view: (view.formViews as AnyRec).create, path: 'views[0].formViews.create', surface: 'formViews.create', kind: 'formView' },
    ]);
  });

  it('always yields the entry itself — the bare FormViewSchema shape', () => {
    const view: AnyRec = { sections: [{ label: 'Basics' }] };
    expect(viewContainerSites(view, 'views[2]')).toEqual([
      { view, path: 'views[2]', surface: '', kind: 'self' },
    ]);
  });

  it('descends `list` NOT at all — only `listViews.<key>`', () => {
    // `list` is `ObjectListViewSchema` exactly as `listViews.<key>` is, but no
    // rule ever asked for it and adding it would be a widening, not a merge.
    const sites = viewContainerSites({ list: { sections: [] } }, 'views[0]');
    expect(sites.map((s) => s.path)).toEqual(['views[0]']);
  });

  it('skips a rung that is not a record (string / array / number / null)', () => {
    const sites = viewContainerSites(
      { form: 'nope', formViews: ['nope'], listViews: 42, list: null },
      'views[0]',
    );
    expect(sites.map((s) => s.kind)).toEqual(['self']);
  });

  it('skips a non-record sub-entry but keeps its record siblings', () => {
    const ok = { sections: [] };
    const sites = viewContainerSites({ formViews: { bad: null, ok } }, 'views[0]');
    expect(sites.map((s) => s.path)).toEqual(['views[0]', 'views[0].formViews.ok']);
    expect(sites[1].view).toBe(ok);
  });

  it('returns nothing for a non-record entry', () => {
    expect(viewContainerSites(null as unknown as AnyRec, 'views[0]')).toEqual([]);
  });
});

describe('formViewSites — the form-carrying subset', () => {
  const view: AnyRec = {
    form: { sections: [] },
    listViews: { all: { sections: [] } },
    formViews: { edit: { sections: [] } },
  };

  it('is the ladder minus `listViews.*`, order preserved', () => {
    expect(formViewSites(view, 'views[0]').map((s) => [s.kind, s.path])).toEqual([
      ['self', 'views[0]'],
      ['form', 'views[0].form'],
      ['formView', 'views[0].formViews.edit'],
    ]);
  });

  it('is a FILTER over the one ladder, not a second ladder', () => {
    // The single-source property, asserted structurally: every site the subset
    // yields is the very object the full ladder yielded (identity, not a copy).
    const all = viewContainerSites(view, 'views[0]');
    for (const site of formViewSites(view, 'views[0]')) {
      expect(all.some((s) => s.path === site.path && s.view === site.view)).toBe(true);
    }
  });
});

/**
 * The property this convergence buys: ONE ladder, THREE consumers.
 *
 * Each rung below is fed to all three rules at once. Break a rung in
 * `view-walk.ts` and every column of the table that depends on it goes red
 * together — which is the whole point. Before #6381 the same rung had to be
 * fixed three times, and twice it was fixed in only one place (#6128 / #6248,
 * then #6251).
 *
 * The `listViews.<key>` row is deliberately asymmetric, and that asymmetry is
 * the design: `ObjectListViewSchema` declares no `sections`
 * (`view.zod.ts:1864-1865` over `ListViewSchema` at `:1067`; the only
 * `sections` / `groups` declaration in the file is `FormViewSchema`'s at
 * `:1649-1650`), so the two form rules filter the rung out while
 * `validate-translatable-sections` keeps it — its module docblock declares
 * `objects[].listViews` as part of its section face, and `os lint` runs over a
 * NORMALIZED stack where an off-spec `listViews.x.sections` is still present.
 */
describe('one ladder, three consumers (#6381)', () => {
  const objects = [{ name: 'crm_case', fields: { subject: {}, status: {} } }];
  const translations = [{ 'zh-CN': { objects: { crm_case: { label: '个案' } } } }];

  /** A form body that trips all three rules at once, at one site. */
  const body = () => ({
    sections: [
      {
        label: 'Basics', // nameless + labelled  → translatable-sections
        fields: [
          'ghost_field', //                       → form-layout (unknown field)
          { field: 'subject', visibleWhen: 'status == "open"' }, // → visibility (bare id)
        ],
      },
    ],
  });

  const rungs: Array<{ rung: string; view: AnyRec; sitePath: string }> = [
    { rung: 'the entry itself (bare form view)', view: { object: 'crm_case', ...body() }, sitePath: 'views[0]' },
    { rung: 'the container default `form` (#5415)', view: { object: 'crm_case', form: body() }, sitePath: 'views[0].form' },
    { rung: '`formViews.<key>`', view: { object: 'crm_case', formViews: { edit: body() } }, sitePath: 'views[0].formViews.edit' },
  ];

  for (const { rung, view, sitePath } of rungs) {
    const stack = { objects, views: [{ name: 'case_views', ...view }], translations };

    it(`all three rules reach ${rung}`, () => {
      const visibility = validateVisibilityPredicates(stack);
      expect(visibility.map((f) => f.path)).toEqual([`${sitePath}.sections[0].fields[1]`]);

      const layout = validateFormLayout(stack);
      expect(layout.map((f) => f.path)).toEqual([`${sitePath}.sections[0].fields[0]`]);

      const translatable = validateTranslatableSections(stack);
      expect(translatable.map((f) => f.path)).toEqual([`${sitePath}.sections[0]`]);
    });
  }

  it('`listViews.<key>` is reached by translatable-sections and by neither form rule', () => {
    const stack = {
      objects,
      views: [{ name: 'case_views', object: 'crm_case', listViews: { all: body() } }],
      translations,
    };

    // Kept: this rung is how the rule reaches an object's own `listViews`.
    expect(validateTranslatableSections(stack).map((f) => f.path)).toEqual([
      'views[0].listViews.all.sections[0]',
    ]);

    // Filtered: a list view declares no `sections`, so descending it can only
    // ever read `undefined` on a schema-valid stack.
    expect(validateVisibilityPredicates(stack)).toEqual([]);
    expect(validateFormLayout(stack)).toEqual([]);
  });

  it("reaches an object's own `listViews` container through the same rung", () => {
    const stack = {
      objects: [{ ...objects[0], listViews: { compact: body() } }],
      translations,
    };
    expect(validateTranslatableSections(stack).map((f) => f.path)).toEqual([
      'objects[0].listViews.compact.sections[0]',
    ]);
  });
});
