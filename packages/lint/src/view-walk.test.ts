// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { viewContainerSites, formViewSites, viewObjectName } from './view-walk.js';
import { validateVisibilityPredicates } from './validate-visibility-predicates.js';
import { validateFormLayout } from './validate-form-layout.js';
import { validateTranslatableSections } from './validate-translatable-sections.js';
import { validateTranslationReferences } from './validate-translation-references.js';

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

/**
 * The base binding ladder (#6662).
 *
 * `objectName` → `object` → `data.object`, in that order, on ONE record. It had
 * three byte-identical copies under two names — `boundObject`
 * (`validate-form-layout`) and `viewObjectName` (`validate-translatable-sections`,
 * `validate-translation-references`) — which is the same copy count, on the same
 * rules, that made the case for `view-walk.ts` itself.
 *
 * What is pinned here is the base rung ONLY. Each rule's own fallback
 * composition is asserted by that rule's own suite, and is deliberately not
 * folded in (see the module docblock).
 */
describe('viewObjectName — the base binding ladder (#6662)', () => {
  it('reads `objectName` first', () => {
    expect(viewObjectName({ objectName: 'a', object: 'b', data: { object: 'c' } })).toBe('a');
  });

  it('falls to `object` when `objectName` is absent', () => {
    expect(viewObjectName({ object: 'b', data: { object: 'c' } })).toBe('b');
  });

  it('falls to `data.object` last — the canonical container shape', () => {
    // On the shape real apps ship, the binding lives INSIDE the sub-container
    // (`form.data.object`), so dropping this rung resolves nothing for them.
    expect(viewObjectName({ data: { provider: 'object', object: 'c' } })).toBe('c');
  });

  it('skips a rung authored as an empty string', () => {
    // `strName` — an empty name is not a name, and binding to `''` would look
    // up an object nobody declared instead of falling through.
    expect(viewObjectName({ objectName: '', object: 'b' })).toBe('b');
    expect(viewObjectName({ objectName: '', object: '', data: { object: 'c' } })).toBe('c');
  });

  it('skips a rung authored with the wrong type', () => {
    expect(viewObjectName({ objectName: 42, object: 'b' })).toBe('b');
    expect(viewObjectName({ object: { nested: true }, data: { object: 'c' } })).toBe('c');
  });

  it('reads `data.object` only when `data` is a record', () => {
    expect(viewObjectName({ data: 'crm_case' })).toBeUndefined();
    expect(viewObjectName({ data: [{ object: 'crm_case' }] })).toBeUndefined();
  });

  it('does NOT read `name` — a form view names itself, not its object', () => {
    // `contract_form`, not `contract`. Reading it here would bind the wrong
    // object and report every field on the form as unknown.
    expect(viewObjectName({ name: 'contract_form' })).toBeUndefined();
  });

  it('resolves to nothing when the record binds nothing', () => {
    expect(viewObjectName({})).toBeUndefined();
  });
});

/**
 * The property this convergence buys: ONE base ladder, THREE binding consumers.
 *
 * The stack below binds its view through the DEEPEST rung only
 * (`data.object`) — the rung a hand-written ladder is likeliest to drop, and the
 * one the canonical container shape actually uses. All three rules must resolve
 * `crm_case` from it, and each is asserted through an observable that only
 * exists when the binding resolved:
 *
 *  - `validate-form-layout` reference-checks fields ONLY when the binding
 *    resolves, so the unknown-field finding is proof it did;
 *  - `validate-translatable-sections` reports a section only when its bound
 *    object is translated, and prints that object in `where`;
 *  - `validate-translation-references` files the form's section names under the
 *    bound object, so a bundle translating one is accepted rather than reported
 *    as naming a section nothing declares.
 *
 * The negative half is asserted too: strip the binding and all three fall
 * silent — without it, "the finding fired" would pass just as well for a rule
 * that resolved the wrong object, or none.
 */
describe('one base ladder, three binding consumers (#6662)', () => {
  const objects = [{ name: 'crm_case', fields: { subject: { type: 'text' } } }];

  /** A container whose ONLY binding is the deepest rung, on the container itself. */
  const container = (data: unknown) => ({
    name: 'case_views',
    ...(data === undefined ? {} : { data }),
    formViews: {
      edit: {
        sections: [
          { name: 'basics', label: 'Basics', fields: ['ghost_field'] },
        ],
      },
    },
  });

  const translations = [
    {
      en: {
        objects: {
          crm_case: { label: 'Case', _sections: { basics: { label: 'Basics' } } },
        },
      },
    },
  ];

  const bound = { objects, views: [container({ provider: 'object', object: 'crm_case' })], translations };
  const unbound = { objects, views: [container(undefined)], translations };

  it('validate-form-layout resolves it — and reference-checks against it', () => {
    const findings = validateFormLayout(bound);
    expect(findings.map((f) => f.path)).toEqual([
      'views[0].formViews.edit.sections[0].fields[0]',
    ]);
    expect(findings[0].message).toContain('crm_case');

    // Negative half: no binding, no reference check, no finding.
    expect(validateFormLayout(unbound)).toEqual([]);
  });

  it('validate-translatable-sections resolves it — and names it in `where`', () => {
    // The section is named AND translated, so the rule is silent on the bound
    // stack; the unbound one cannot resolve an object to check against either.
    // What is asserted is the resolution itself, through the labelled-but-
    // nameless section the rule does report.
    const nameless = {
      objects,
      views: [
        {
          name: 'case_views',
          data: { provider: 'object', object: 'crm_case' },
          formViews: { edit: { sections: [{ label: 'Basics' }] } },
        },
      ],
      translations,
    };
    const findings = validateTranslatableSections(nameless);
    expect(findings.map((f) => f.path)).toEqual(['views[0].formViews.edit.sections[0]']);
    expect(findings[0].where).toContain('object "crm_case"');

    // Negative half: strip the binding and the rule has no object to judge
    // against, so it reports nothing at all.
    const stripped = {
      ...nameless,
      views: [{ name: 'case_views', formViews: { edit: { sections: [{ label: 'Basics' }] } } }],
    };
    expect(validateTranslatableSections(stripped)).toEqual([]);
  });

  it('validate-translation-references resolves it — and files sections under it', () => {
    // Accepted: `basics` is declared on a form bound to `crm_case` by the
    // deepest rung, so the bundle translating it names something that renders.
    expect(validateTranslationReferences(bound)).toEqual([]);

    // Negative half: with the binding gone the section is filed under no
    // object, and the same bundle is reported as naming a section nothing
    // declares.
    const findings = validateTranslationReferences(unbound);
    expect(findings.map((f) => f.path)).toEqual([
      'translations[0].en.objects.crm_case._sections.basics',
    ]);
  });
});
