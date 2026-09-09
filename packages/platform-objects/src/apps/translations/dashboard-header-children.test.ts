// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16458 — the platform catalogs name the `dashboard.header` composite's
// children and the `header.actions[]` ROW properties, in every locale.
//
// Before this pin the four generated catalogs carried `header` alone: the
// extractor walks a form field's DECLARED `fields`, `dashboard.form.ts`
// declared none under `header`, so no `header.<child>` key was ever emitted
// and the only localisation of those three children was a private overlay in
// objectui. The row properties had no channel at all — a repeater's column
// headers are read from the JSON Schema `title`, which the bundle overlays
// through the `<repeater>.<property>` path pinned here.
//
// The English source of a row property's name lives in TWO places by
// construction — the zod `.meta({ title })` the panel reads and the form's
// declared `label` the extractor emits — and `packages/spec`'s
// `dashboard.test.ts` pins those two equal. This file pins the catalog side:
// the `en` leaf equals the form's declared label, and each translated locale
// carries its own text rather than a copy of the source.

import { describe, it, expect } from 'vitest';
import { dashboardForm } from '@objectstack/spec/ui';
import { enMetadataForms } from './en.metadata-forms.generated.js';
import { zhCNMetadataForms } from './zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from './ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from './es-ES.metadata-forms.generated.js';

const LOCALES = [
  { name: 'en', forms: enMetadataForms as Record<string, any> },
  { name: 'zh-CN', forms: zhCNMetadataForms as Record<string, any> },
  { name: 'ja-JP', forms: jaJPMetadataForms as Record<string, any> },
  { name: 'es-ES', forms: esESMetadataForms as Record<string, any> },
];

const HEADER_CHILDREN = ['header.showTitle', 'header.showDescription', 'header.actions'];
const ROW_PROPERTIES = ['label', 'actionUrl', 'actionType', 'icon'];
const ROW_KEYS = ROW_PROPERTIES.map((p) => `header.actions.${p}`);

/** The `actions` repeater as `dashboard.form.ts` declares it, children included. */
function declaredActionsRepeater(): any {
  for (const section of (dashboardForm as any).sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field?.field === 'header') {
        return (field.fields ?? []).find((f: any) => f?.field === 'actions');
      }
    }
  }
  return undefined;
}

describe('#16458 — dashboard header children and row properties in every catalog', () => {
  for (const { name, forms } of LOCALES) {
    it(`${name}: carries the three header children and the four row-property keys`, () => {
      const fields = forms.dashboard?.fields ?? {};
      for (const key of [...HEADER_CHILDREN, ...ROW_KEYS]) {
        expect(typeof fields[key]?.label, `${name} dashboard.fields['${key}'].label`).toBe('string');
        expect(fields[key].label.length, `${name} dashboard.fields['${key}'].label is empty`).toBeGreaterThan(0);
      }
      // The three composite children carry a hint too — the overlay objectui
      // shipped for them had one, and this is what makes it redundant.
      for (const key of HEADER_CHILDREN) {
        expect(typeof fields[key]?.helpText, `${name} dashboard.fields['${key}'].helpText`).toBe('string');
      }
      // Control — a neighbouring key known to exist, so an empty `fields` map
      // cannot pass by vacuity.
      expect(typeof fields.header?.label).toBe('string');
    });
  }

  it('en: each row-property leaf is the form\'s declared label, the English name the panel reads', () => {
    const repeater = declaredActionsRepeater();
    expect(repeater, 'dashboard.form.ts declares header.actions with children').toBeDefined();
    const declared = new Map<string, string>(
      (repeater.fields as any[]).map((f) => [String(f.field), String(f.label)]),
    );
    expect([...declared.keys()]).toEqual(ROW_PROPERTIES);
    for (const prop of ROW_PROPERTIES) {
      expect(enMetadataForms.dashboard?.fields?.[`header.actions.${prop}`]?.label).toBe(declared.get(prop));
    }
  });

  it('translated locales carry their own text for every new leaf, not a copy of the source', () => {
    for (const { name, forms } of LOCALES) {
      if (name === 'en') continue;
      for (const key of [...HEADER_CHILDREN, ...ROW_KEYS]) {
        const en = (enMetadataForms as any).dashboard.fields[key].label;
        expect(forms.dashboard.fields[key].label, `${name} dashboard.fields['${key}'].label still reads the en source`).not.toBe(en);
      }
    }
  });
});
