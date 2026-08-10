// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// App/dashboard translation parity (#3762).
//
// The `apps.*` / `dashboards.*` half of this package's i18n is HAND-AUTHORED in
// `<locale>.ts` — it cannot be generated, because the Setup app is a shell of
// empty group anchors whose entries are contributed at runtime (ADR-0029 D7),
// so a bundle built from a static walk would be structurally incomplete.
//
// Being hand-authored, nothing regenerates it when a nav item is added, and the
// gap is invisible in the UI: an untranslated nav id falls back to the app's own
// English label, so a Chinese Studio menu simply shows one English entry among
// thirty. `apps.studio.navigation.nav_app_builder.label` sat missing in ALL FOUR
// locales that way.
//
// It went unnoticed for a second reason worth pinning against: the extract
// config's merge baseline listed only the GENERATED subtrees, so coverage
// reported all 77 declared app/dashboard keys as untranslated in every locale —
// 231 strings of phantom debt that drowned the one real miss. With the baseline
// complete and the ratchet at 0, that tool now reports the truth; this test is
// the local, CLI-independent version of the same invariant.
//
// Setup is deliberately NOT covered here: its nav ids do not exist on the app
// object at all until the runtime merges contributions in, so this file would
// have nothing to walk.
//
// Where they ARE covered: `pnpm check:app-nav-i18n`
// (`packages/cli/scripts/check-app-nav-i18n.mjs`), which boots the real
// composition, merges the contributions through `applyNavContributions`, and
// asserts the same invariant this file asserts — every nav id labelled in every
// locale — over the merged tree.
//
// This line used to read "Those labels are gated by the coverage ratchet",
// which was the #5750 defect in one sentence. The ratchet
// (`scripts/check-i18n-coverage.mjs`) runs `os lint` over STATIC stack configs
// and never saw a runtime-contributed id in its life; the extract config on the
// other side named the ratchet right back. Two comments declared an owner, no
// gate implemented one, and four Setup nav entries sat untranslated in `zh-CN`
// under a green build. Do not re-delegate Setup to a gate that cannot walk it —
// if this file grows a Setup case, it has to boot something.

import { describe, it, expect } from 'vitest';
import { STUDIO_APP } from '../studio.app.js';
import { ACCOUNT_APP } from '../account.app.js';
import { SystemOverviewDashboard } from '../dashboards/index.js';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';
import { jaJP } from './ja-JP.js';
import { esES } from './es-ES.js';

const LOCALES = { en, 'zh-CN': zhCN, 'ja-JP': jaJP, 'es-ES': esES } as const;

/** Every nav id in an app's statically declared navigation tree, depth-first. */
function navIds(app: { navigation?: unknown[] }): string[] {
  const out: string[] = [];
  const walk = (items: unknown[]) => {
    for (const raw of items ?? []) {
      const item = raw as { id?: string; children?: unknown[] };
      if (item?.id) out.push(item.id);
      if (Array.isArray(item?.children)) walk(item.children);
    }
  };
  walk(app.navigation ?? []);
  return out;
}

describe('statically declared app navigation is translated in every locale', () => {
  for (const app of [STUDIO_APP, ACCOUNT_APP] as Array<{ name: string; navigation?: unknown[] }>) {
    for (const [locale, data] of Object.entries(LOCALES)) {
      it(`${app.name} — ${locale}`, () => {
        const nav = (data.apps?.[app.name]?.navigation ?? {}) as Record<string, { label?: string }>;
        const missing = navIds(app).filter((id) => !nav[id]?.label);
        expect(missing, `untranslated nav ids in apps.${app.name}.navigation`).toEqual([]);
      });
    }
  }

  // The reverse direction. A translation for an id the app no longer declares is
  // dead weight that reads as coverage — `nav_workflows` outlived its menu entry
  // in all four locales and nothing said so.
  for (const app of [STUDIO_APP] as Array<{ name: string; navigation?: unknown[] }>) {
    for (const [locale, data] of Object.entries(LOCALES)) {
      it(`${app.name} — ${locale} carries no translation for a removed nav id`, () => {
        const declared = new Set(navIds(app));
        const translated = Object.keys(data.apps?.[app.name]?.navigation ?? {});
        expect(
          translated.filter((id) => !declared.has(id)),
          `apps.${app.name}.navigation keys with no declaring nav item`,
        ).toEqual([]);
      });
    }
  }
});

describe('dashboard widgets are translated in every locale', () => {
  const dashboard = SystemOverviewDashboard as unknown as {
    name: string;
    widgets?: Array<{ id?: string; title?: string }>;
  };

  for (const [locale, data] of Object.entries(LOCALES)) {
    it(`${dashboard.name} — ${locale}`, () => {
      const entry = data.dashboards?.[dashboard.name];
      expect(entry?.label, `dashboards.${dashboard.name}.label`).toBeTruthy();

      const widgets = (entry?.widgets ?? {}) as Record<string, { title?: string }>;
      const missing = (dashboard.widgets ?? [])
        .map((w) => w.id)
        .filter((id): id is string => !!id)
        .filter((id) => !widgets[id]?.title);
      expect(missing, `untranslated widget titles in dashboards.${dashboard.name}`).toEqual([]);
    });
  }
});
