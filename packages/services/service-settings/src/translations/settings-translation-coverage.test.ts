// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Settings-translation coverage guard (zh-CN / ja-JP / es-ES).
 *
 * Every built-in settings manifest ships English labels inline; the console
 * localizes them by resolving `settings.<namespace>.…` against the shipped
 * translation bundles (see `useSettingsLabel`). When a manifest gains a new
 * group or field but a locale bundle isn't updated, the setting silently
 * renders English under a translated UI (objectui#2851).
 *
 * This test pins each shipped non-English locale to full coverage of every
 * manifest's structural strings — namespace title/description, each group
 * title, each field label, each `info_banner`'s title and text (keyed by
 * the banner's `id` under `settings.<namespace>.banners`), and each
 * `action_button`'s label (keyed by the button's `id` under
 * `settings.<namespace>.actions`). Dropdown *option* labels are intentionally
 * excluded: several must not be "translated" (the `timezone` option "UTC" is a
 * code; each `locale` option names its language in that language), and
 * option-level parity is filled per-locale on a best-effort basis.
 */

import { describe, it, expect } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import { lifecycleSettingsManifest } from '@objectstack/objectql';
import * as manifestsModule from '../manifests/index.js';
import { en, zhCN, jaJP, esES } from './index.js';

// The manifests barrel also exports action handlers and the aggregate array;
// keep only the manifest objects.
const bundledManifests = Object.values(manifestsModule).filter(
  (v): v is SettingsManifest =>
    !!v &&
    typeof v === 'object' &&
    'namespace' in v &&
    Array.isArray((v as SettingsManifest).specifiers),
);

/**
 * Platform manifests another package registers into the same settings hub,
 * whose copy this bundle carries because that package ships no translation
 * bundle of its own. `@objectstack/objectql` registers `lifecycle` (Data
 * Lifecycle) at `kernel:ready`. Each one listed here is held to the same full
 * coverage as a bundled manifest, and its namespace is a declared one for the
 * no-undeclared-copy check below.
 */
const hostedManifests: SettingsManifest[] = [lifecycleSettingsManifest];

/** Every manifest whose `settings.<namespace>.…` copy lives in this bundle. */
const manifests = [...bundledManifests, ...hostedManifests];

const LOCALES: Array<[string, { settings?: Record<string, any> }]> = [
  ['zh-CN', zhCN],
  ['ja-JP', jaJP],
  ['es-ES', esES],
];

function missingFor(data: { settings?: Record<string, any> }, m: SettingsManifest): string[] {
  const tr = (data.settings ?? {})[m.namespace];
  const missing: string[] = [];
  if (tr?.title == null) missing.push('title');
  if (m.description && tr?.description == null) missing.push('description');
  for (const s of m.specifiers) {
    if (s.type === 'group') {
      if (s.id && tr?.groups?.[s.id]?.title == null) missing.push(`group:${s.id}`);
    } else if (s.type === 'info_banner') {
      // A banner without an `id` has no address in the bundle, so no locale
      // can ever translate it: that is a gap in the manifest, reported here.
      if (!s.id) {
        missing.push('banner without an id');
        continue;
      }
      if (tr?.banners?.[s.id]?.title == null) missing.push(`banner:${s.id}.title`);
      if (tr?.banners?.[s.id]?.text == null) missing.push(`banner:${s.id}.text`);
    } else if (s.type === 'action_button') {
      // Same as a banner: an action button is addressed by its `id`, and one
      // without an id has no place in the bundle for its label.
      if (!s.id) {
        missing.push('action without an id');
        continue;
      }
      if (tr?.actions?.[s.id]?.label == null) missing.push(`action:${s.id}`);
    } else if (s.key) {
      if (tr?.keys?.[s.key]?.label == null) missing.push(`key:${s.key}`);
    }
  }
  return missing;
}

/**
 * The other direction: copy for a group, key, banner or action no manifest declares.
 * Such an entry renders nowhere, so it survives every review as dead text. The four
 * Localization format keys retired by #21958 are the case that named it.
 */
function undeclaredIn(data: { settings?: Record<string, any> }): string[] {
  const byNamespace = new Map(manifests.map((m) => [m.namespace, m]));
  const extra: string[] = [];
  for (const [ns, tr] of Object.entries(data.settings ?? {})) {
    const m = byNamespace.get(ns);
    if (!m) {
      extra.push(`namespace:${ns}`);
      continue;
    }
    const groups = new Set<string>();
    const keys = new Set<string>();
    const banners = new Set<string>();
    const actions = new Set<string>();
    for (const s of m.specifiers) {
      if (s.type === 'group') {
        if (s.id) groups.add(s.id);
      } else if (s.type === 'info_banner') {
        if (s.id) banners.add(s.id);
      } else if (s.type === 'action_button') {
        if (s.id) actions.add(s.id);
      } else if (s.key) {
        keys.add(s.key);
      }
    }
    for (const g of Object.keys(tr?.groups ?? {})) if (!groups.has(g)) extra.push(`${ns}.group:${g}`);
    for (const k of Object.keys(tr?.keys ?? {})) if (!keys.has(k)) extra.push(`${ns}.key:${k}`);
    for (const b of Object.keys(tr?.banners ?? {})) if (!banners.has(b)) extra.push(`${ns}.banner:${b}`);
    for (const a of Object.keys(tr?.actions ?? {})) if (!actions.has(a)) extra.push(`${ns}.action:${a}`);
  }
  return extra;
}

describe('settings translation coverage', () => {
  it('covers every built-in settings manifest', () => {
    expect(bundledManifests.length).toBeGreaterThanOrEqual(10);
  });

  it('covers the hosted platform manifests by namespace', () => {
    expect(manifests.map((m) => m.namespace)).toContain('lifecycle');
    const namespaces = manifests.map((m) => m.namespace);
    expect(new Set(namespaces).size, 'a namespace is declared twice').toBe(namespaces.length);
  });

  for (const [locale, data] of LOCALES) {
    for (const m of manifests) {
      it(`${locale} covers settings.${m.namespace} (title / groups / keys / banners / actions)`, () => {
        const missing = missingFor(data, m);
        expect(missing, `${locale} missing for ${m.namespace}: ${missing.join(', ')}`).toEqual([]);
      });
    }
  }

  for (const [locale, data] of [['en', en], ...LOCALES] as typeof LOCALES) {
    it(`${locale} carries no copy for a group, key, banner or action no manifest declares`, () => {
      const extra = undeclaredIn(data);
      expect(extra, `${locale} has undeclared settings copy: ${extra.join(', ')}`).toEqual([]);
    });
  }
});

/**
 * A warning reaches the admin as an `info_banner` row with
 * `bannerSeverity: 'warning'` — never as a hand-spelled warning glyph inside a
 * description or help string, where it reads as one more sentence of the
 * subtitle or the field's help. This sweeps every manifest's description, its
 * `helpText` and each specifier's help (`description`), and every locale's
 * copy of them (`description`, group `description`, key `help`).
 */
const WARNING_GLYPH = '⚠';

function manifestHelpStrings(m: SettingsManifest): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (m.description) out.push([`${m.namespace}.description`, m.description]);
  if (m.helpText) out.push([`${m.namespace}.helpText`, m.helpText]);
  for (const s of m.specifiers) {
    if (s.description) out.push([`${m.namespace}.${s.key ?? s.id ?? s.type}.description`, s.description]);
  }
  return out;
}

function bundleHelpStrings(data: { settings?: Record<string, any> }): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [ns, tr] of Object.entries(data.settings ?? {})) {
    if (typeof tr?.description === 'string') out.push([`${ns}.description`, tr.description]);
    for (const [g, gt] of Object.entries<any>(tr?.groups ?? {})) {
      if (typeof gt?.description === 'string') out.push([`${ns}.groups.${g}.description`, gt.description]);
    }
    for (const [k, kt] of Object.entries<any>(tr?.keys ?? {})) {
      if (typeof kt?.help === 'string') out.push([`${ns}.keys.${k}.help`, kt.help]);
    }
  }
  return out;
}

describe('warnings live in info_banner rows, not in description or help strings', () => {
  it('no manifest description, helpText or specifier help carries the warning glyph', () => {
    const strings = manifests.flatMap(manifestHelpStrings);
    // Non-vacuity: the sweep reads real strings, not an empty set.
    expect(strings.length).toBeGreaterThan(50);
    const hits = strings.filter(([, v]) => v.includes(WARNING_GLYPH)).map(([path]) => path);
    expect(hits, `warning glyph in manifest help strings: ${hits.join(', ')}`).toEqual([]);
  });

  for (const [locale, data] of [['en', en], ...LOCALES] as typeof LOCALES) {
    it(`${locale} carries the warning glyph in no description or help copy`, () => {
      const strings = bundleHelpStrings(data);
      expect(strings.length).toBeGreaterThan(50);
      const hits = strings.filter(([, v]) => v.includes(WARNING_GLYPH)).map(([path]) => path);
      expect(hits, `${locale} has the warning glyph in: ${hits.join(', ')}`).toEqual([]);
    });
  }
});
