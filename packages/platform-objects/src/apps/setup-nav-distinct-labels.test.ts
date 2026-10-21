// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// No two Setup nav entries in one group read the same in any locale.
//
// The defect: People & Organization carries `nav_organization` (the active
// organization's record page) and `nav_organizations` (the organization list,
// shown where `org-scoping` is mounted). English tells them apart by the
// plural; zh-CN and ja-JP have no plural, so both read "组织" / "組織" and a
// multi-organization deployment showed two identical menu entries that open
// different pages.
import { describe, it, expect } from 'vitest';

import { SETUP_NAV_CONTRIBUTIONS } from './setup-nav.contributions.js';
import { en } from './translations/en.js';
import { zhCN } from './translations/zh-CN.js';
import { jaJP } from './translations/ja-JP.js';
import { esES } from './translations/es-ES.js';

const LOCALES = { en, 'zh-CN': zhCN, 'ja-JP': jaJP, 'es-ES': esES } as const;

type NavItem = { id?: string; label?: string };

describe('Setup nav labels are distinct within a group', () => {
  for (const [locale, bundle] of Object.entries(LOCALES)) {
    const navigation = ((bundle as any).apps?.setup?.navigation ?? {}) as Record<string, { label?: string }>;

    for (const contribution of SETUP_NAV_CONTRIBUTIONS) {
      it(`${locale} · ${contribution.group}`, () => {
        const seen = new Map<string, string>();
        for (const item of (contribution.items ?? []) as NavItem[]) {
          if (!item.id) continue;
          const label = navigation[item.id]?.label ?? item.label;
          if (!label) continue;
          expect(
            seen.get(label),
            `${item.id} and ${seen.get(label)} both read "${label}" in ${locale}`,
          ).toBeUndefined();
          seen.set(label, item.id);
        }
      });
    }
  }
});
