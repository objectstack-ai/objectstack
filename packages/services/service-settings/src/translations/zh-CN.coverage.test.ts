// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * zh-CN settings-translation coverage guard.
 *
 * Every built-in settings manifest ships English labels inline; the console
 * localizes them by resolving `settings.<namespace>.…` against the shipped
 * translation bundles (see `useSettingsLabel`). When a manifest gains a new
 * group or field but the zh-CN bundle isn't updated, the setting silently
 * renders English under a Chinese UI (objectui#2851).
 *
 * This test pins zh-CN to full coverage of every manifest's structural
 * strings — namespace title/description, each group title, and each field
 * label. Dropdown *option* labels are intentionally excluded: several are
 * codes or format specimens (e.g. `date_format` = "YYYY-MM-DD",
 * `number_format` = "1,234.56") that must not be "translated".
 */

import { describe, it, expect } from 'vitest';
import * as manifestsModule from '../manifests/index';
import { zhCN } from './index';

type Specifier = { type?: string; id?: string; key?: string; label?: string; description?: string };
type Manifest = { namespace: string; description?: string; specifiers: Specifier[] };

const manifests = Object.values(manifestsModule).filter(
  (v): v is Manifest =>
    !!v && typeof v === 'object' && 'namespace' in v && Array.isArray((v as Manifest).specifiers),
);

const settings = (zhCN as { settings?: Record<string, any> }).settings ?? {};

describe('zh-CN settings translation coverage', () => {
  it('covers every built-in settings manifest', () => {
    expect(manifests.length).toBeGreaterThanOrEqual(10);
  });

  for (const m of manifests) {
    it(`covers settings.${m.namespace} (title / groups / keys)`, () => {
      const tr = settings[m.namespace];
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
      expect(missing, `zh-CN missing for ${m.namespace}: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
