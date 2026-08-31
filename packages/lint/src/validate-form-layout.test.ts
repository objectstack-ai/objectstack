// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { defineStack, normalizeStackInput } from '@objectstack/spec';
import {
  validateFormLayout,
  FORM_FIELD_UNKNOWN,
  FORM_COLSPAN_ABSOLUTE,
  FORM_SECTION_GROUP_UNKNOWN,
} from './validate-form-layout.js';

type AnyRec = Record<string, unknown>;

const objects = [
  { name: 'contract', fields: { name: {}, amount: {}, status: {}, notes: {} } },
];

/**
 * [#13855] The same object, plus the declared field groups a section may now
 * reference. Kept separate from `objects` so every pre-existing test above
 * still runs against an object with NO groups — which is also the state the
 * `declares no field groups at all` hint is written for.
 */
const groupedObjects = [
  {
    name: 'contract',
    fieldGroups: [
      { key: 'basics', label: 'Basics' },
      { key: 'money', label: 'Money' },
    ],
    fields: {
      name: { group: 'basics' },
      amount: { group: 'money' },
      status: {},
      notes: {},
    },
  },
];

describe('validateFormLayout (#2578)', () => {
  it('is clean for a well-formed multi-column form (known fields, no colSpan)', () => {
    const stack = {
      objects,
      views: [
        {
          name: 'contract_form',
          type: 'simple',
          data: { provider: 'object', object: 'contract' },
          sections: [
            { label: 'Basics', columns: 2, fields: ['name', 'amount', { field: 'notes', span: 'full' }] },
          ],
        },
      ],
    };
    expect(validateFormLayout(stack)).toEqual([]);
  });

  it('flags a section field that is not on the bound object', () => {
    const stack = {
      objects,
      views: [
        {
          name: 'contract_form',
          data: { provider: 'object', object: 'contract' },
          sections: [{ columns: 2, fields: ['name', 'ghost_field'] }],
        },
      ],
    };
    const findings = validateFormLayout(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FORM_FIELD_UNKNOWN);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('ghost_field');
    expect(findings[0].path).toBe('views[0].sections[0].fields[1]');
  });

  it('discourages absolute colSpan and steers to span', () => {
    const stack = {
      objects,
      views: [
        {
          name: 'contract_form',
          data: { provider: 'object', object: 'contract' },
          sections: [{ columns: 2, fields: ['name', { field: 'amount', colSpan: 2 }] }],
        },
      ],
    };
    const findings = validateFormLayout(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FORM_COLSPAN_ABSOLUTE);
    expect(findings[0].hint).toContain("span: 'full'");
    expect(findings[0].path).toBe('views[0].sections[0].fields[1].colSpan');
  });

  it('reports both rules for the same field independently', () => {
    const stack = {
      objects,
      views: [
        {
          name: 'contract_form',
          data: { provider: 'object', object: 'contract' },
          sections: [{ columns: 2, fields: [{ field: 'ghost', colSpan: 3 }] }],
        },
      ],
    };
    const rules = validateFormLayout(stack).map(f => f.rule).sort();
    expect(rules).toEqual([FORM_COLSPAN_ABSOLUTE, FORM_FIELD_UNKNOWN].sort());
  });

  it('skips reference-checking when the bound object cannot be resolved', () => {
    const stack = {
      objects,
      views: [
        {
          name: 'orphan_form',
          data: { provider: 'object', object: 'does_not_exist' },
          sections: [{ columns: 2, fields: ['whatever', { field: 'x', colSpan: 2 }] }],
        },
      ],
    };
    const findings = validateFormLayout(stack);
    // No form-field-unknown (object unresolved), but colSpan is still flagged.
    expect(findings.map(f => f.rule)).toEqual([FORM_COLSPAN_ABSOLUTE]);
  });

  it('ignores non-form views (no sections array)', () => {
    const stack = {
      objects,
      views: [
        { name: 'grid', type: 'grid', data: { object: 'contract' }, columns: ['name', 'ghost'] },
      ],
    };
    expect(validateFormLayout(stack)).toEqual([]);
  });

  it('tolerates an empty / shapeless stack', () => {
    expect(validateFormLayout({})).toEqual([]);
    expect(validateFormLayout({ views: [], objects: [] })).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// #13855 — `section.group` names a field group on the bound object.
//
// The spec door takes any well-formed snake_case key (the cross-schema
// existence question is not one a section schema can answer — the
// `UserFilterFieldSchema.field` precedent), so THIS is where a dangling key is
// reported. A miss is total, not partial: the reference form and the enumerated
// form are mutually exclusive at parse, so a key that resolves to nothing
// leaves the section with no member source at all and it does not render.
// ───────────────────────────────────────────────────────────────────────────

describe('#13855 — dangling `section.group` references', () => {
  const viewWith = (sections: unknown, bucket: 'sections' | 'groups' = 'sections') => ({
    objects: groupedObjects,
    views: [{
      name: 'contract_form',
      data: { provider: 'object', object: 'contract' },
      [bucket]: sections,
    }],
  });

  it('is clean when the key names a declared group', () => {
    expect(validateFormLayout(viewWith([{ group: 'basics' }, { group: 'money' }]))).toEqual([]);
  });

  it('flags a key that names no declared group, with the declared set in the hint', () => {
    const findings = validateFormLayout(viewWith([{ group: 'contact_info' }]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FORM_SECTION_GROUP_UNKNOWN);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('views[0].sections[0].group');
    expect(findings[0].message).toContain('field group "contact_info"');
    // The consequence, in the words the severity is argued from.
    expect(findings[0].message).toContain('silently does not render');
    expect(findings[0].hint).toContain('Declared groups on contract: basics, money.');
  });

  it('reads the LEGACY `groups` bucket too — a rule silent on the alias is half a rule', () => {
    const findings = validateFormLayout(viewWith([{ group: 'nope' }], 'groups'));
    expect(findings.map(f => `${f.rule}@${f.path}`)).toEqual([
      `${FORM_SECTION_GROUP_UNKNOWN}@views[0].groups[0].group`,
    ]);
  });

  it('tells an author with NO declared groups what to do instead', () => {
    // `objects` (not `groupedObjects`) declares no `fieldGroups` at all.
    const findings = validateFormLayout({
      objects,
      views: [{ name: 'f', data: { provider: 'object', object: 'contract' }, sections: [{ group: 'basics' }] }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].hint).toContain('declares no field groups at all');
  });

  it('says nothing about an object this stack does not define', () => {
    // Same skip the field-existence rule takes: the object may come from
    // another installed package, and a group cannot be judged on a schema we
    // cannot see. A finding here would be one the author cannot act on.
    const findings = validateFormLayout({
      objects: groupedObjects,
      views: [{ name: 'f', data: { provider: 'object', object: 'from_another_package' }, sections: [{ group: 'nope' }] }],
    });
    expect(findings).toEqual([]);
  });

  it('reports the group miss alongside — not instead of — the field misses', () => {
    const findings = validateFormLayout(viewWith([
      { group: 'ghost_group' },
      { fields: ['name', 'ghost_field'] },
    ]));
    expect(findings.map(f => `${f.rule}@${f.path}`)).toEqual([
      `${FORM_SECTION_GROUP_UNKNOWN}@views[0].sections[0].group`,
      `${FORM_FIELD_UNKNOWN}@views[0].sections[1].fields[1]`,
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// #6251 — `views[]` is a view CONTAINER, and both rules above were unreachable
// on the shape real apps actually ship.
//
// The measurement that opened the issue: one broken form, three placements.
// Only the placement the strict schema REFUSES was being read, so an app whose
// forms all live under `form` / `formViews.<key>` — i.e. every app — got a
// clean report from a rule that had read nothing at all. That is the ghost
// check #4984 / #5009 name: green because nothing was inspected.
// ───────────────────────────────────────────────────────────────────────────

/** The one broken form, reused verbatim in every placement below. */
const brokenForm = {
  data: { provider: 'object', object: 'contract' },
  sections: [{ columns: 2, fields: ['name', 'ghost_field'] }],
};

describe('#6251 — the view CONTAINER ladder', () => {
  it('reports the SAME broken form in all three placements', () => {
    const at = (view: AnyRec) =>
      validateFormLayout({ objects, views: [view] }).map((f) => `${f.rule}@${f.path}`);

    // (1) the entry IS a bare form view — the only shape read before #6251.
    expect(at({ name: 'contract_form', ...brokenForm })).toEqual([
      `${FORM_FIELD_UNKNOWN}@views[0].sections[0].fields[1]`,
    ]);
    // (2) the container's DEFAULT form.
    expect(at({ name: 'contract_views', object: 'contract', form: brokenForm })).toEqual([
      `${FORM_FIELD_UNKNOWN}@views[0].form.sections[0].fields[1]`,
    ]);
    // (3) a NAMED form view — where `os build` on app-showcase actually puts them.
    expect(at({ name: 'contract_views', object: 'contract', formViews: { edit: brokenForm } })).toEqual([
      `${FORM_FIELD_UNKNOWN}@views[0].formViews.edit.sections[0].fields[1]`,
    ]);
  });

  it('names the sub-container in `where`, so two forms under one view are distinguishable', () => {
    const findings = validateFormLayout({
      objects,
      views: [{
        name: 'contract_views',
        object: 'contract',
        form: brokenForm,
        formViews: { edit: brokenForm, create: brokenForm },
      }],
    });
    expect(findings.map((f) => f.where)).toEqual([
      'view "contract_views" · form',
      'view "contract_views" · formViews.edit',
      'view "contract_views" · formViews.create',
    ]);
  });

  it('a sub-container INHERITS the container binding when it declares none', () => {
    // The canonical container carries `object`; a `formViews.<key>` entry that
    // omits its own `data.object` still renders against that object, so a
    // dangling field reference there is as real as anywhere else.
    const findings = validateFormLayout({
      objects,
      views: [{
        name: 'contract_views',
        object: 'contract',
        formViews: { edit: { sections: [{ fields: ['ghost_inherited'] }] } },
      }],
    });
    expect(findings.map((f) => f.rule)).toEqual([FORM_FIELD_UNKNOWN]);
    expect(findings[0].message).toContain('ghost_inherited');
    expect(findings[0].message).toContain('"contract"');
  });

  it('reads the legacy `groups` bucket too — measured NOT folded into `sections` at parse', () => {
    const findings = validateFormLayout({
      objects,
      views: [{
        name: 'contract_views',
        object: 'contract',
        form: { data: { object: 'contract' }, groups: [{ fields: ['name', { field: 'ghost_g', colSpan: 3 }] }] },
      }],
    });
    expect(findings.map((f) => `${f.rule}@${f.path}`)).toEqual([
      `${FORM_FIELD_UNKNOWN}@views[0].form.groups[0].fields[1]`,
      `${FORM_COLSPAN_ABSOLUTE}@views[0].form.groups[0].fields[1].colSpan`,
    ]);
  });

  it('reports a map-shaped `views` at the key it sits at, not a synthetic index', () => {
    const findings = validateFormLayout({
      objects,
      views: { contract_views: { object: 'contract', formViews: { edit: brokenForm } } },
    });
    expect(findings.map((f) => f.path)).toEqual(['views.contract_views.formViews.edit.sections[0].fields[1]']);
  });

  // NEGATIVE polarity — this one cannot go red when the traversal is reverted
  // (a narrower walk trivially satisfies "does not walk list views"). It is
  // here to pin the SCHEMA fact, not the fix: `list` / `listViews.<key>` are
  // `ObjectListViewSchema`, which declares no `sections`, so a `sections` key
  // there is not a form and must not be judged as one.
  it('does not walk `list` / `listViews.*` (they carry no sections by schema)', () => {
    expect(validateFormLayout({
      objects,
      views: [{ name: 'contract_views', object: 'contract', list: brokenForm, listViews: { all: brokenForm } }],
    })).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The anti-ghost pin: the rule must fire on a stack built through the REAL
// authoring door, not only on a hand-shaped object literal.
//
// `cliTierFor` is exactly what `os validate` / `os compile` hand the registry:
// `defineStack` (which Zod-PARSES) followed by `normalizeStackInput`. So a
// fixture that survives it is a shape an author can really ship — and a rule
// that reports on it is really reachable. Without this, "the fix works" could
// still mean "the fix works on shapes the schema refuses", which is how this
// rule was silently dead for four minor versions.
// ───────────────────────────────────────────────────────────────────────────

/** `defineStack` warns on the D2 conversion channel; keep test output clean. */
function quietly<T>(fn: () => T): { value?: T; error?: Error } {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return { value: fn() };
  } catch (e) {
    return { error: e as Error };
  } finally {
    spy.mockRestore();
  }
}

const cliTierFor = (stack: AnyRec): AnyRec =>
  normalizeStackInput(defineStack(stack as never) as unknown as AnyRec);

describe('#6251 — reachable on a REAL parsed app stack', () => {
  const manifest = {
    id: 'com.example.formlayout',
    namespace: 'fl',
    version: '1.0.0',
    type: 'app',
    name: 'Form Layout Probe',
    engines: { protocol: '^17' },
  };

  const data = { provider: 'object' as const, object: 'fl_contact' };

  /**
   * The container ladder copied from `examples/app-showcase/src/ui/views/
   * contact.view.ts` — default `form` grouped into sections, plus a sparse
   * `formViews.create` override — with one dangling field planted in each.
   */
  const appShape: AnyRec = {
    manifest,
    objects: [{
      name: 'fl_contact',
      label: 'Contact',
      fields: {
        name: { type: 'text', label: 'Name' },
        email: { type: 'email', label: 'Email' },
        phone: { type: 'phone', label: 'Phone' },
      },
    }],
    views: [{
      name: 'fl_contact',
      object: 'fl_contact',
      list: { label: 'Contacts', type: 'grid', data, columns: [{ field: 'name' }] },
      form: {
        type: 'simple',
        data,
        sections: [{ name: 'contact', label: 'Contact', columns: 2, fields: ['name', 'email', 'ghost_default'] }],
      },
      formViews: {
        create: {
          type: 'simple',
          data,
          title: 'New contact',
          sections: [{ label: 'Who is this?', columns: 1, fields: ['name', { field: 'ghost_named', colSpan: 2 }] }],
        },
      },
    }],
  };

  it('the fixture is a shape the strict schema ACCEPTS (so the pin is not testing a rejected stack)', () => {
    const { error, value } = quietly(() => cliTierFor(structuredClone(appShape)));
    expect(error).toBeUndefined();
    // And it really is the container shape: no `sections` at the entry root.
    const view = (value!.views as AnyRec[])[0];
    expect(Object.keys(view).sort()).toEqual(['form', 'formViews', 'list', 'name', 'object']);
    expect(view.sections).toBeUndefined();
  });

  it('reports every planted defect on that stack — this is the assertion #6251 exists for', () => {
    const { value } = quietly(() => cliTierFor(structuredClone(appShape)));
    expect(validateFormLayout(value!).map((f) => `${f.rule}@${f.path}`)).toEqual([
      `${FORM_FIELD_UNKNOWN}@views[0].form.sections[0].fields[2]`,
      `${FORM_FIELD_UNKNOWN}@views[0].formViews.create.sections[0].fields[1]`,
      `${FORM_COLSPAN_ABSOLUTE}@views[0].formViews.create.sections[0].fields[1].colSpan`,
    ]);
  });

  // EMPTY-GREEN, declared. Revert the container ladder and this test still
  // passes — because nothing was read, not because nothing is wrong. It is kept
  // (a false-positive guard is worth having) but it is only meaningful PAIRED
  // with the test above, which proves on the same fixture family that the
  // traversal does read these sites. If that one is ever weakened, this one
  // stops guarding anything; do not treat it as independent cover.
  it('a CLEAN app stack of the same shape reports nothing — the fix adds no false positives', () => {
    const clean = structuredClone(appShape);
    const view = (clean.views as AnyRec[])[0];
    (view.form as AnyRec).sections = [{ name: 'contact', label: 'Contact', columns: 2, fields: ['name', 'email', 'phone'] }];
    (view.formViews as AnyRec).create = {
      type: 'simple', data, title: 'New contact',
      sections: [{ label: 'Who is this?', columns: 1, fields: ['name', { field: 'email', span: 'full' }] }],
    };
    const { error, value } = quietly(() => cliTierFor(clean));
    expect(error).toBeUndefined();
    expect(validateFormLayout(value!)).toEqual([]);
  });
});
