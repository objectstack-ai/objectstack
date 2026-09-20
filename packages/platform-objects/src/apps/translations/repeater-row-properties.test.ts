// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #17508 — THE class guard for "a repeater's column heads are English in
// every locale".
//
// Studio renders a `type: 'repeater'` as a table. Its column names come from
// the form's DECLARED row children when the form declares any, and from the
// served JSON Schema (`items.properties[k].title`) when it declares none —
// and `os i18n extract` walks a form field's declared `fields`, so only a
// DECLARED child ever gets a `metadataForms.<type>.fields['<path>.<prop>']`
// key. #17232 (PR #17500) authored the English `.meta({ title })` on thirteen
// item schemas; #17505 and #17506 added four more carriers. None of them had
// a catalog channel: an un-enumerated repeater printed its English titles to
// a Chinese, Japanese or Spanish author, in every locale, forever.
//
// This file is the loudness for the catalog half, in the shape
// `dashboard-header-children.test.ts` established for #17227's one carrier:
//
//   • every enumerated row child declares a `label` — without one the
//     extractor emits `humanizeFieldPath(path)` as the English SOURCE, which
//     then overlays back onto the schema and OVERRIDES the authored title
//     (`page.variables.source` read "Source" against the schema's
//     "Written By" until this pin was written);
//   • the `en` leaf IS that declared label — one English string, not two;
//   • every locale names every leaf;
//   • ⛔ and a translated leaf is NEVER a copy of its `en` source, which is
//     what refuses an `en`-echo catalog masquerading as a translation.
//
// The population is DERIVED from the forms, not listed here, so a repeater
// enumerated tomorrow is red on the day it lands rather than a month later.
// `view.columns` / `view.sort` / `view.tabs` enumerate no children and are
// therefore outside it — their titles are #17507's.

import { describe, it, expect } from 'vitest';

import { agentForm, skillForm, toolForm } from '@objectstack/spec/ai';
import { flowForm } from '@objectstack/spec/automation';
import { fieldForm, hookForm, objectForm } from '@objectstack/spec/data';
import { positionForm } from '@objectstack/spec/identity';
import {
  actionForm,
  appForm,
  dashboardForm,
  datasetForm,
  pageForm,
  reportForm,
  viewForm,
} from '@objectstack/spec/ui';

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

/** Every `*.form.ts` the spec package exports, by its export name. */
const FORMS: ReadonlyArray<readonly [string, unknown]> = [
  ['actionForm', actionForm],
  ['agentForm', agentForm],
  ['appForm', appForm],
  ['dashboardForm', dashboardForm],
  ['datasetForm', datasetForm],
  ['fieldForm', fieldForm],
  ['flowForm', flowForm],
  ['hookForm', hookForm],
  ['objectForm', objectForm],
  ['pageForm', pageForm],
  ['positionForm', positionForm],
  ['reportForm', reportForm],
  ['skillForm', skillForm],
  ['toolForm', toolForm],
  ['viewForm', viewForm],
];

interface RowProperty {
  /** `<metadata type>:<dotted repeater path>.<row property>` — the test name. */
  id: string;
  type: string;
  /** The bundle key: `<dotted repeater path>.<row property>`. */
  key: string;
  /** The form's declared `label`, or `undefined` when it declares none. */
  label: string | undefined;
}

/** Every `{ path, spec }` a form declares, composite/repeater children included. */
function* walkFormFields(fields: any[] | undefined, prefix = ''): Generator<{ path: string; spec: any }> {
  for (const f of fields ?? []) {
    if (!f || typeof f !== 'object' || !f.field) continue;
    const path = prefix ? `${prefix}.${f.field}` : String(f.field);
    yield { path, spec: f };
    if (Array.isArray(f.fields)) yield* walkFormFields(f.fields, path);
  }
}

/** The row properties every ENUMERATED repeater declares, across every form. */
function declaredRowProperties(): RowProperty[] {
  const out: RowProperty[] = [];
  for (const [, form] of FORMS) {
    const f = form as any;
    const type = f?.data?.schemaId as string | undefined;
    if (!type) continue;
    const fields = (f.sections ?? []).flatMap((s: any) => s.fields ?? []);
    for (const { path, spec } of walkFormFields(fields)) {
      if (spec.type !== 'repeater' || !Array.isArray(spec.fields)) continue;
      for (const child of spec.fields) {
        if (!child?.field) continue;
        const key = `${path}.${child.field}`;
        out.push({
          id: `${type}:${key}`,
          type,
          key,
          label: typeof child.label === 'string' ? child.label : undefined,
        });
      }
    }
  }
  return out;
}

const ROW_PROPERTIES = declaredRowProperties();
/** The repeaters those properties belong to — used for the vacuity controls. */
const CARRIERS = [...new Set(ROW_PROPERTIES.map((p) => `${p.type}:${p.key.replace(/\.[^.]+$/, '')}`))];

describe('#17508 — the enumerated-repeater survey itself (controls before verdicts)', () => {
  it('walks every form the spec exports and finds row properties only where one is enumerated', () => {
    // Lit — the walk really ran, over the whole form roster.
    expect(FORMS.length).toBe(15);
    expect(ROW_PROPERTIES.length).toBeGreaterThan(100);
    expect(CARRIERS.length).toBeGreaterThan(15);
    expect(CARRIERS).toContain('dashboard:header.actions');

    const carrying = new Set(ROW_PROPERTIES.map((p) => p.type));
    for (const type of ['action', 'app', 'dashboard', 'dataset', 'field', 'flow', 'page', 'report', 'skill']) {
      expect(carrying.has(type), `${type} enumerates a repeater's row properties`).toBe(true);
    }
    // Dark — forms that enumerate none contribute none. A walk that matched
    // everything, or nothing, cannot pass both halves.
    for (const type of ['agent', 'tool', 'hook', 'position']) {
      expect(carrying.has(type), `${type} enumerates no repeater row properties`).toBe(false);
    }
    // Dark — `view.columns` / `view.sort` / `view.tabs` enumerate no children
    // (their titles are #17507's), so `view` is outside this population.
    expect(carrying.has('view'), 'view enumerates no repeater row properties yet').toBe(false);
  });

  it('every enumerated row child declares a `label` — an omitted one silently becomes the English source', () => {
    // `walkFormField` in the extractor falls back to `humanizeFieldPath(path)`,
    // and `resolveMetadataFormSchemaTitles` then writes that text over the
    // item schema's own `.meta({ title })`. Two English names, the worse one
    // winning, in every locale.
    const unlabelled = ROW_PROPERTIES.filter((p) => !p.label || p.label.length === 0).map((p) => p.id);
    expect(unlabelled).toEqual([]);
  });
});

describe('#17508 — every enumerated row property is named in every catalog', () => {
  for (const { name, forms } of LOCALES) {
    it(`${name}: names every enumerated row property`, () => {
      for (const { id, type, key } of ROW_PROPERTIES) {
        const label = forms[type]?.fields?.[key]?.label;
        expect(typeof label, `${name} ${id} is missing from the catalog`).toBe('string');
        expect(label.length, `${name} ${id} is empty`).toBeGreaterThan(0);
      }
      // Control — a neighbouring key known to exist, so an empty `fields` map
      // cannot pass by vacuity.
      expect(typeof forms.dashboard?.fields?.widgets?.label).toBe('string');
    });
  }

  it('en: each leaf IS the form\'s declared label — one English string, not two', () => {
    for (const { id, type, key, label } of ROW_PROPERTIES) {
      expect(enMetadataForms[type]?.fields?.[key]?.label, `en ${id}`).toBe(label);
    }
  });

  it('translated locales carry their own text for every leaf, not a copy of the source', () => {
    const echoes: string[] = [];
    for (const { name, forms } of LOCALES) {
      if (name === 'en') continue;
      for (const { id, type, key } of ROW_PROPERTIES) {
        const en = (enMetadataForms as any)[type]?.fields?.[key]?.label;
        if (forms[type]?.fields?.[key]?.label === en) echoes.push(`${name} ${id} (${JSON.stringify(en)})`);
      }
    }
    expect(echoes, 'these leaves still read the en source — an en-echo is not a translation').toEqual([]);
  });
});
