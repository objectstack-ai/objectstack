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
 * title, and each field label. Dropdown *option* labels are intentionally
 * excluded: several must not be "translated" (the `timezone` option "UTC" is a
 * code; each `locale` option names its language in that language), and
 * option-level parity is filled per-locale on a best-effort basis.
 */

import { describe, it, expect } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import * as manifestsModule from '../manifests/index.js';
import { en, zhCN, jaJP, esES } from './index.js';

// The manifests barrel also exports action handlers and the aggregate array;
// keep only the manifest objects.
const manifests = Object.values(manifestsModule).filter(
  (v): v is SettingsManifest =>
    !!v &&
    typeof v === 'object' &&
    'namespace' in v &&
    Array.isArray((v as SettingsManifest).specifiers),
);

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
    } else if (s.key) {
      if (tr?.keys?.[s.key]?.label == null) missing.push(`key:${s.key}`);
    }
  }
  return missing;
}

/**
 * The other direction: copy for a group or key no manifest declares. Such an
 * entry renders nowhere, so it survives every review as dead text. The four
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
    for (const s of m.specifiers) {
      if (s.type === 'group') {
        if (s.id) groups.add(s.id);
      } else if (s.key) {
        keys.add(s.key);
      }
    }
    for (const g of Object.keys(tr?.groups ?? {})) if (!groups.has(g)) extra.push(`${ns}.group:${g}`);
    for (const k of Object.keys(tr?.keys ?? {})) if (!keys.has(k)) extra.push(`${ns}.key:${k}`);
  }
  return extra;
}

describe('settings translation coverage', () => {
  it('covers every built-in settings manifest', () => {
    expect(manifests.length).toBeGreaterThanOrEqual(10);
  });

  for (const [locale, data] of LOCALES) {
    for (const m of manifests) {
      it(`${locale} covers settings.${m.namespace} (title / groups / keys)`, () => {
        const missing = missingFor(data, m);
        expect(missing, `${locale} missing for ${m.namespace}: ${missing.join(', ')}`).toEqual([]);
      });
    }
  }

  for (const [locale, data] of [['en', en], ...LOCALES] as typeof LOCALES) {
    it(`${locale} carries no copy for a group or key no manifest declares`, () => {
      const extra = undeclaredIn(data);
      expect(extra, `${locale} has undeclared settings copy: ${extra.join(', ')}`).toEqual([]);
    });
  }
});
