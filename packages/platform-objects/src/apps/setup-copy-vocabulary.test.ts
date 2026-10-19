// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup copy carries no design-record vocabulary.
 *
 * An administrator reads three kinds of string this package ships: the
 * sentence under a Setup page title (the object's `description`), a field's
 * help tooltip (the field's `description`, extracted as `help`), and the Setup
 * left nav (`SETUP_APP` plus `SETUP_NAV_CONTRIBUTIONS`). The generated bundles
 * carry the same strings into every locale. An ADR number, a decision id
 * ("D2"), a review-finding id ("finding F2"), an API call ("emit()") or a
 * runtime internal ("kernel") means nothing to that reader: the reference
 * belongs in the docblock or comment next to the string, never in the string.
 *
 * Population, all of it read from this checkout's source (no build artifact
 * except `@objectstack/metadata-core`, a registered unaliased pair in
 * `scripts/check-test-source-alias.mjs`):
 *
 *   1. every object schema this package exports, plus every one
 *      `@objectstack/metadata-core` exports (`sys_metadata_commit` included,
 *      which no bundle carries) — each `label`, `pluralLabel` and
 *      `description` anywhere in the definition;
 *   2. every leaf of the four committed `objects` bundles;
 *   3. the type-level `label` / `description` of the four `metadataForms`
 *      bundles — the sentence a Setup metadata page (Positions, Capabilities,
 *      Permission Sets) shows under its title, plus the six form leaves named
 *      in `FORM_HELP_LEAVES` (the Permission Sets and Positions help texts and
 *      the view form's End-user controls description). The other section
 *      descriptions and field `helpText` of those forms are the spec's form
 *      copy and are not judged here;
 *   4. `SETUP_APP` and this package's `SETUP_NAV_CONTRIBUTIONS`, and the
 *      hand-authored `apps.setup` subtree of each locale.
 *
 * Nav entries other packages contribute, and the service-messaging objects,
 * are outside this package's import graph; `service-messaging` pins its own
 * objects in `src/objects/admin-copy-vocabulary.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import * as MetadataCore from '@objectstack/metadata-core';
import * as PlatformObjects from '../index.js';
import { SETUP_APP } from './setup.app.js';
import { SETUP_NAV_CONTRIBUTIONS } from './setup-nav.contributions.js';
import { en } from './translations/en.js';
import { zhCN } from './translations/zh-CN.js';
import { jaJP } from './translations/ja-JP.js';
import { esES } from './translations/es-ES.js';
import { enObjects } from './translations/en.objects.generated.js';
import { zhCNObjects } from './translations/zh-CN.objects.generated.js';
import { jaJPObjects } from './translations/ja-JP.objects.generated.js';
import { esESObjects } from './translations/es-ES.objects.generated.js';
import { enMetadataForms } from './translations/en.metadata-forms.generated.js';
import { zhCNMetadataForms } from './translations/zh-CN.metadata-forms.generated.js';
import { jaJPMetadataForms } from './translations/ja-JP.metadata-forms.generated.js';
import { esESMetadataForms } from './translations/es-ES.metadata-forms.generated.js';

/** The design-record vocabulary an admin-facing string must not carry. */
const DESIGN_RECORD_VOCABULARY: ReadonlyArray<readonly [string, RegExp]> = [
  ['an ADR number', /ADR-\d/],
  ['a decision id', /\bD\d+\b/],
  ['a review-finding id', /finding F/],
  ['an API call', /\bemit\(\)/],
  ['a runtime internal', /\bkernel\b/i],
];

function vocabularyIn(text: string): string[] {
  return DESIGN_RECORD_VOCABULARY.filter(([, re]) => re.test(text)).map(([name]) => name);
}

const COPY_KEYS = new Set(['label', 'pluralLabel', 'description']);

/** Every `label` / `pluralLabel` / `description` string under `node`, with its path. */
function copyStrings(node: unknown, path: string, out: Array<[string, string]>): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => copyStrings(v, `${path}[${i}]`, out));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    const at = path ? `${path}.${k}` : k;
    if (typeof v === 'string') {
      if (COPY_KEYS.has(k)) out.push([at, v]);
    } else {
      copyStrings(v, at, out);
    }
  }
}

/** Every string leaf under `node`, with its path. */
function leafStrings(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === 'string') {
    out.push([path, node]);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) leafStrings(v, path ? `${path}.${k}` : k, out);
}

function offenders(strings: Array<[string, string]>): string[] {
  return strings
    .map(([at, text]) => [at, text, vocabularyIn(text)] as const)
    .filter(([, , hits]) => hits.length > 0)
    .map(([at, text, hits]) => `${at} (${hits.join(', ')}): ${text}`);
}

type ObjectLike = { name: string; fields: Record<string, unknown> };
function isObjectSchema(v: unknown): v is ObjectLike {
  return !!v && typeof v === 'object'
    && typeof (v as ObjectLike).name === 'string'
    && !!(v as ObjectLike).fields && typeof (v as ObjectLike).fields === 'object';
}

function objectSchemas(...modules: Array<Record<string, unknown>>): Map<string, ObjectLike> {
  const byName = new Map<string, ObjectLike>();
  for (const mod of modules) {
    for (const v of Object.values(mod)) if (isObjectSchema(v) && !byName.has(v.name)) byName.set(v.name, v);
  }
  return byName;
}

const LOCALES = { en, 'zh-CN': zhCN, 'ja-JP': jaJP, 'es-ES': esES } as const;
const OBJECT_BUNDLES = { en: enObjects, 'zh-CN': zhCNObjects, 'ja-JP': jaJPObjects, 'es-ES': esESObjects } as const;
const FORM_BUNDLES = {
  en: enMetadataForms, 'zh-CN': zhCNMetadataForms, 'ja-JP': jaJPMetadataForms, 'es-ES': esESMetadataForms,
} as const;

describe('Setup copy carries no design-record vocabulary', () => {
  it('the matcher recognises each kind of vocabulary it exists to keep out', () => {
    // A matcher that matches nothing passes every assertion below; each kind
    // must be seen on a sentence of the shape it was written for.
    expect(vocabularyIn('Business Unit tree (ADR-0057).')).toEqual(['an ADR number']);
    expect(vocabularyIn('Placement intent, decision D12.')).toEqual(['a decision id']);
    expect(vocabularyIn('Bypass rule (finding F2).')).toEqual(['a review-finding id']);
    expect(vocabularyIn('One row per emit().')).toEqual(['an API call']);
    expect(vocabularyIn('The Kernel API is additive.')).toEqual(['a runtime internal']);
    expect(vocabularyIn('Your company structure, used to scope data and reports.')).toEqual([]);
  });

  it('object, field and view copy of every object this package and metadata-core export', () => {
    const objects = objectSchemas(
      PlatformObjects as unknown as Record<string, unknown>,
      MetadataCore as unknown as Record<string, unknown>,
    );
    // The population is not allowed to shrink to nothing: the objects whose
    // copy this suite was written against must still be in it.
    for (const name of [
      'sys_user', 'sys_business_unit', 'sys_notification', 'sys_sso_provider',
      'sys_metadata', 'sys_metadata_audit', 'sys_metadata_commit', 'sys_metadata_activation',
    ]) {
      expect(objects.has(name), `${name} is in the population`).toBe(true);
    }
    expect(objects.size).toBeGreaterThanOrEqual(50);

    const strings: Array<[string, string]> = [];
    for (const [name, def] of objects) copyStrings(def, name, strings);
    expect(offenders(strings)).toEqual([]);
  });

  it.each(Object.keys(OBJECT_BUNDLES))('every leaf of the %s objects bundle', (locale) => {
    const strings: Array<[string, string]> = [];
    leafStrings(OBJECT_BUNDLES[locale as keyof typeof OBJECT_BUNDLES], `objects`, strings);
    expect(strings.length).toBeGreaterThan(1000);
    expect(offenders(strings)).toEqual([]);
  });

  it.each(Object.keys(FORM_BUNDLES))('the type-level label and description of the %s metadataForms bundle', (locale) => {
    const forms = FORM_BUNDLES[locale as keyof typeof FORM_BUNDLES] as Record<string, { label?: string; description?: string }>;
    const strings: Array<[string, string]> = [];
    for (const [type, form] of Object.entries(forms)) {
      if (typeof form.label === 'string') strings.push([`metadataForms.${type}.label`, form.label]);
      if (typeof form.description === 'string') strings.push([`metadataForms.${type}.description`, form.description]);
    }
    expect(forms.capability?.description, 'the Capability page sentence is in the population').toBeTypeOf('string');
    expect(offenders(strings)).toEqual([]);
  });

  // The help texts an admin reads on Setup's Permission Sets and Positions edit
  // forms, and the view form's End-user controls section. Each one carried a
  // decision-record reference until the spec form source moved it into the
  // comment beside the row; `en` is regenerated from that source, so judging
  // the four bundles judges the source too.
  const FORM_HELP_LEAVES = [
    ['permission', 'fields', 'isDefault', 'helpText'],
    ['permission', 'fields', 'packageId', 'helpText'],
    ['permission', 'fields', 'adminScope', 'helpText'],
    ['position', 'fields', 'delegatable', 'helpText'],
    ['view', 'sections', 'end_user_controls', 'description'],
  ] as const;

  function formHelpLeaves(bundle: unknown, locale: string): Array<[string, string]> {
    return FORM_HELP_LEAVES.map((path) => {
      const value = path.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], bundle);
      const at = `${locale}.metadataForms.${path.join('.')}`;
      expect(value, `${at} is in the population`).toBeTypeOf('string');
      return [at, value as string];
    });
  }

  it.each(Object.keys(FORM_BUNDLES))('the Permission Set, Position and view form help texts of the %s metadataForms bundle', (locale) => {
    const strings = formHelpLeaves(FORM_BUNDLES[locale as keyof typeof FORM_BUNDLES], locale);
    expect(strings).toHaveLength(FORM_HELP_LEAVES.length);
    expect(offenders(strings)).toEqual([]);
  });

  it('the form help-text assertion fires on the prose it replaced', () => {
    // Dark leg: the same walk over a bundle carrying the replaced wording must
    // name every leaf, so a walk that reaches nothing cannot pass above.
    const replaced = {
      permission: { fields: {
        isDefault: { helpText: 'App baseline for the everyone position (ADR-0090 D5): an app-level set is auto-bound at boot.' },
        packageId: { helpText: 'Owning package id for a package-shipped set (ADR-0086 D3).' },
        adminScope: { helpText: 'Delegated administration (ADR-0090 D12): lets holders of this set administer one business-unit subtree.' },
      } },
      position: { fields: {
        delegatable: { helpText: 'Holders may delegate this position themselves, time-boxed and with a reason (ADR-0091 D3).' },
      } },
      view: { sections: {
        end_user_controls: { description: 'What end users can do on this view (ADR-0047, Airtable Interface parity).' },
      } },
    };
    expect(offenders(formHelpLeaves(replaced, 'replaced'))).toHaveLength(FORM_HELP_LEAVES.length);
  });

  it('the Setup app, its nav contributions, and every locale\'s apps.setup translations', () => {
    const strings: Array<[string, string]> = [];
    copyStrings(SETUP_APP, 'SETUP_APP', strings);
    copyStrings(SETUP_NAV_CONTRIBUTIONS, 'SETUP_NAV_CONTRIBUTIONS', strings);
    for (const [locale, data] of Object.entries(LOCALES)) {
      leafStrings(data.apps?.setup, `${locale}.apps.setup`, strings);
    }
    expect(strings.some(([at]) => at.endsWith('nav_business_units.label'))).toBe(true);
    expect(offenders(strings)).toEqual([]);
  });
});
