// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #30267 — the catalogs name every child the view form declares under its
// composites, and zh-CN carries its own text for each of them.
//
// `view.form.ts` used to declare `selection`, `pagination`, `userFilters`,
// `appearance`, `userActions`, `navigation` and `sharing` as composites with
// no children. `os i18n extract` walks a form field's DECLARED `fields` only,
// so none of those rows had a `metadataForms.view.fields['<parent>.<child>']`
// key, and the zh-CN Studio read ~70 English rows in the four collapsed
// sections of the view properties panel. The form now spells the children
// out; this file pins the catalog half:
//
//   • every declared child (repeater rows included) is a key in every
//     catalog — the population is DERIVED from the form, so a child declared
//     tomorrow is red here on the day it lands until the catalogs are
//     regenerated;
//   • the `en` leaf IS the form's text — label (or its humanized path) and
//     helpText;
//   • zh-CN never echoes the `en` source on any of these leaves.
//
// ja-JP and es-ES are deliberately NOT held to the no-echo rule here beyond
// the six `userFilters.fields` row properties (`repeater-row-properties.test.ts`
// owns those): the card is the zh-CN panel, and their other new leaves are
// the extractor's en fills.

import { describe, it, expect } from 'vitest';
import { viewForm } from '@objectstack/spec/ui';

import { enMetadataForms } from './en.metadata-forms.generated.js';
import { zhCNMetadataForms } from './zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from './ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from './es-ES.metadata-forms.generated.js';

type FormField = { field?: string; label?: string; helpText?: string; fields?: FormField[] };

const COMPOSITES = ['selection', 'pagination', 'userFilters', 'appearance', 'userActions', 'addRecord', 'navigation', 'sharing'];

/** `{ path, field }` for every child declared under the composites above, recursively. */
function declaredChildren(): Array<{ path: string; f: FormField }> {
  const out: Array<{ path: string; f: FormField }> = [];
  const walk = (fields: FormField[] | undefined, prefix: string) => {
    for (const f of fields ?? []) {
      if (!f?.field) continue;
      const path = `${prefix}.${f.field}`;
      out.push({ path, f });
      walk(f.fields, path);
    }
  };
  for (const section of (viewForm as { sections?: Array<{ fields?: FormField[] }> }).sections ?? []) {
    for (const f of section.fields ?? []) if (f?.field && COMPOSITES.includes(f.field)) walk(f.fields, f.field);
  }
  return out;
}

const CHILDREN = declaredChildren();
const en = (enMetadataForms as Record<string, any>).view.fields as Record<string, Record<string, string>>;
const zh = (zhCNMetadataForms as Record<string, any>).view.fields as Record<string, Record<string, string>>;

describe('#30267 — view composite children in the metadata-forms catalogs', () => {
  it('derives a real population (control)', () => {
    const paths = CHILDREN.map((c) => c.path);
    expect(paths).toContain('pagination.pageSize');
    expect(paths).toContain('userFilters.fields.showCount');
    expect(paths).toContain('sharing.lockedBy');
    expect(paths).not.toContain('navigation.view');
    expect(CHILDREN.length).toBeGreaterThan(30);
  });

  for (const [name, forms] of [['en', enMetadataForms], ['zh-CN', zhCNMetadataForms], ['ja-JP', jaJPMetadataForms], ['es-ES', esESMetadataForms]] as const) {
    it(`${name}: names every declared child`, () => {
      const fields = (forms as Record<string, any>).view.fields;
      const missing = CHILDREN.filter(({ path, f }) => typeof fields[path]?.label !== 'string' || (f.helpText !== undefined && typeof fields[path]?.helpText !== 'string'));
      expect(missing.map((m) => m.path)).toEqual([]);
    });
  }

  it('en: each helpText leaf IS the form\'s declared hint', () => {
    for (const { path, f } of CHILDREN) {
      if (f.helpText !== undefined) expect(en[path].helpText, path).toBe(f.helpText);
      if (f.label !== undefined) expect(en[path].label, path).toBe(f.label);
    }
  });

  it('zh-CN carries its own text for every leaf, never a copy of the en source', () => {
    const echoes = CHILDREN.flatMap(({ path }) =>
      Object.keys(en[path]).filter((leaf) => zh[path]?.[leaf] === en[path][leaf]).map((leaf) => `${path}.${leaf}`),
    );
    expect(echoes).toEqual([]);
  });
});
