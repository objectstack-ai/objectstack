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

// ---------------------------------------------------------------------------
// #16458 item ③, first half — the catalogs were ALREADY correct, and this pin
// exists so the next reader cannot "repair" them backwards.
//
// The card and its triage both prescribe the opposite of the truth: "every
// generated catalog names `refreshInterval`, not `refreshIntervalSeconds`".
// That direction is inverted. `refreshInterval` was RENAMED to
// `refreshIntervalSeconds` in @objectstack/spec 17 (#15680, ruling B on
// #14478) and is now a `retiredKey` tombstone — authoring it is a parse error
// (`packages/spec/src/ui/dashboard.test.ts` pins the refusal). The live
// authorable key is `refreshIntervalSeconds`, which is what these catalogs and
// `dashboard.form.ts` already name.
//
// The card's reading came from a substring: `refreshInterval` "occurs" in
// `dashboard.zod.ts` only inside `refreshIntervalSeconds`, in the rename
// comment and in the tombstone's own prose. Under `grep -P '\brefreshInterval\b'`
// there is no live field by that name at all.
//
// So carrying out that acceptance literally would have written the tombstoned
// key into all four catalogs and created exactly the never-matching entry the
// card set out to remove.
describe('#16458 item ③ — the catalogs name the LIVE refresh key, not the tombstone', () => {
  for (const { name, forms } of LOCALES) {
    it(`${name}: names \`refreshIntervalSeconds\` and never the retired \`refreshInterval\``, () => {
      const fields = forms.dashboard?.fields ?? {};
      expect(typeof fields.refreshIntervalSeconds?.label, `${name} names the live key`).toBe('string');
      expect(
        Object.keys(fields),
        `${name} carries the tombstoned \`refreshInterval\` — it is a parse error in the spec, so the entry could never match`,
      ).not.toContain('refreshInterval');
    });
  }

  it('the key the catalogs name is the key the form declares — one source, not two', () => {
    const declared = new Set<string>();
    for (const section of (dashboardForm as any).sections ?? []) {
      for (const field of section.fields ?? []) if (field?.field) declared.add(String(field.field));
    }
    // Control — the form really was walked, so an empty set cannot pass by vacuity.
    expect(declared.has('columns'), 'dashboardForm declares the neighbouring `columns`').toBe(true);
    expect(declared.has('refreshIntervalSeconds')).toBe(true);
    expect(declared.has('refreshInterval')).toBe(false);
    expect(Object.keys(enMetadataForms.dashboard?.fields ?? {})).toContain('refreshIntervalSeconds');
  });
});
