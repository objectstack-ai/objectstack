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
 * excluded: several are codes or format specimens (e.g. `date_format` =
 * "YYYY-MM-DD", `number_format` = "1,234.56") that must not be "translated",
 * and option-level parity is filled per-locale on a best-effort basis.
 */

import { describe, it, expect } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import * as manifestsModule from '../manifests/index.js';
import { zhCN, jaJP, esES } from './index.js';

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
});
