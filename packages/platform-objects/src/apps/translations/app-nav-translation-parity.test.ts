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
// Setup's nav LEAVES are deliberately NOT covered by the presence direction
// below: they do not exist on the app object at all until the runtime merges
// contributions in, so this file would have nothing to walk. (Its nine static
// group anchors do exist statically, and the default-locale content check at
// the bottom of this file walks exactly those — see that block's own note for
// why a content claim can be made where a coverage claim cannot.)
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
import { SETUP_APP } from '../setup.app.js';
import { SystemOverviewDashboard } from '../dashboards/index.js';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';
import { jaJP } from './ja-JP.js';
import { esES } from './es-ES.js';

const LOCALES = { en, 'zh-CN': zhCN, 'ja-JP': jaJP, 'es-ES': esES } as const;

/** Every statically declared nav item of an app, depth-first, with its label. */
function navItems(app: { navigation?: unknown[] }): Array<{ id: string; label?: string }> {
  const out: Array<{ id: string; label?: string }> = [];
  const walk = (items: unknown[]) => {
    for (const raw of items ?? []) {
      const item = raw as { id?: string; label?: string; children?: unknown[] };
      if (item?.id) out.push({ id: item.id, label: item.label });
      if (Array.isArray(item?.children)) walk(item.children);
    }
  };
  walk(app.navigation ?? []);
  return out;
}

/** Every nav id in an app's statically declared navigation tree, depth-first. */
function navIds(app: { navigation?: unknown[] }): string[] {
  return navItems(app).map((item) => item.id);
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

  // The reverse direction, for the same reason it exists for Studio's nav above:
  // a translation for a widget the board no longer declares is dead weight that
  // reads as coverage. This half was missing, and a removal proved why — when
  // `widget_permission_changes` was deleted from the board, its title and
  // description stayed behind in all four locales and every gate in this package
  // was green. A dashboard CAN be walked statically (unlike Setup, which is
  // composed at runtime — see `setup-nav-dead-key-tombstone.test.ts`), so there
  // is nothing here to stop the general claim being made.
  for (const [locale, data] of Object.entries(LOCALES)) {
    it(`${dashboard.name} — ${locale} carries no translation for a removed widget`, () => {
      const declared = new Set(
        (dashboard.widgets ?? []).map((w) => w.id).filter((id): id is string => !!id),
      );
      const translated = Object.keys(
        (data.dashboards?.[dashboard.name]?.widgets ?? {}) as Record<string, unknown>,
      );
      expect(
        translated.filter((id) => !declared.has(id)),
        `dashboards.${dashboard.name}.widgets keys with no declaring widget`,
      ).toEqual([]);
    });
  }
});

// ── The default locale serves the SOURCE string, not an old copy of it ───────
//
// Every claim above is a key-set claim: it judges whether a key exists on one
// side or both. A key whose VALUE has gone stale satisfies all of them, and one
// did — `widget_recent_events` kept `Recent Audit Events` in all four bundles
// after the widget was converted into an ADR-0021 by-action breakdown whose
// declared title says so. Since the translation is what renders, the declared
// string reached nobody in any locale, under a fully green build.
//
// What can be asserted mechanically is the DEFAULT locale, because `en.ts` is a
// copy of the source rather than a translation of it. That is the same
// invariant the generated half of this package's i18n already enforces by
// rewriting the `en` bundle from the source on every extract (see
// `scripts/i18n-extract.config.ts`); this half is hand-authored and cannot be
// regenerated — regenerating it would delete ~40 runtime-contributed nav
// translations per locale — so the invariant is asserted here instead of being
// produced by a generator.
//
// Deliberately NOT claimed here: anything about zh-CN / ja-JP / es-ES. What a
// translated locale should do when its source string changes (keep serving the
// stale value, fall back to the source, fail the build) is a product decision,
// not a test's to invent. This block is the half that needs no decision; the
// half that does is #8765, and note what pinning `en` does to it — the drift
// stops being uniform across all four bundles and becomes locale-specific,
// invisible to every reviewer who reads the product in English.
//
// Direction: source ⇒ en, one-way. A key in `en.ts` with no declaring source is
// NOT judged — that set is exactly Setup's runtime-contributed nav leaves,
// which no static walk can see and which `pnpm check:app-nav-i18n` and
// `setup-nav-dead-key-tombstone.test.ts` own. Setup's nine static group anchors
// ARE walked: a coverage claim over Setup is impossible here (most of its ids
// are absent at import time), but a content claim over the few it does declare
// is sound — the walk judges what it finds, and finds nothing it cannot judge.
//
// `pages.*` is out of the walk on purpose: those entries mirror page metadata
// authored in OTHER packages (@objectstack/cloud-connection, @objectstack/mcp),
// which this package does not import and must not depend on to run its tests.
// A static walk in this package cannot close that gap; where it IS covered
// is `pnpm check:app-nav-i18n` (`packages/cli/scripts/check-app-nav-i18n.mjs`),
// which boots the real composition and asserts the `en` copy of `pages.*` —
// label, description, and every `page:header` title/subtitle — against the
// composed page metadata, verbatim: the same default-locale content claim
// this block makes for `apps.*` and `dashboards.*`, one section over.
// Default locale only: per-locale coverage of those `pages.*` keys in
// `zh-CN` / `ja-JP` / `es-ES` remains unasserted anywhere in this repo. All
// three were in parity when this block was written.
describe('the default locale bundle serves the declared source string verbatim', () => {
  type Drift = { path: string; source: string; en: string | undefined };

  const collect = (
    drift: Drift[],
    path: string,
    source: string | undefined,
    served: string | undefined,
  ) => {
    // An undeclared source string makes no claim — only a declared one does.
    if (typeof source !== 'string') return;
    if (served !== source) drift.push({ path, source, en: served });
  };

  const APPS = [SETUP_APP, STUDIO_APP, ACCOUNT_APP] as unknown as Array<{
    name: string;
    label?: string;
    description?: string;
    navigation?: unknown[];
  }>;

  for (const app of APPS) {
    it(`apps.${app.name} — label, description and every statically declared nav label`, () => {
      const served = (en.apps?.[app.name] ?? {}) as {
        label?: string;
        description?: string;
        navigation?: Record<string, { label?: string }>;
      };
      const drift: Drift[] = [];
      collect(drift, `apps.${app.name}.label`, app.label, served.label);
      collect(drift, `apps.${app.name}.description`, app.description, served.description);
      for (const item of navItems(app)) {
        collect(
          drift,
          `apps.${app.name}.navigation.${item.id}.label`,
          item.label,
          served.navigation?.[item.id]?.label,
        );
      }
      expect(
        drift,
        `en.ts no longer matches the declared source in apps.${app.name} — `
          + 'edit the bundle to the source string (this half is hand-authored; do NOT regenerate it)',
      ).toEqual([]);
    });
  }

  it('dashboards.system_overview — label, description and every widget title/description', () => {
    const dashboard = SystemOverviewDashboard as unknown as {
      name: string;
      label?: string;
      description?: string;
      widgets?: Array<{ id?: string; title?: string; description?: string }>;
    };
    const served = (en.dashboards?.[dashboard.name] ?? {}) as {
      label?: string;
      description?: string;
      widgets?: Record<string, { title?: string; description?: string }>;
    };
    const drift: Drift[] = [];
    collect(drift, `dashboards.${dashboard.name}.label`, dashboard.label, served.label);
    collect(
      drift,
      `dashboards.${dashboard.name}.description`,
      dashboard.description,
      served.description,
    );
    for (const widget of dashboard.widgets ?? []) {
      if (!widget.id) continue;
      const base = `dashboards.${dashboard.name}.widgets.${widget.id}`;
      collect(drift, `${base}.title`, widget.title, served.widgets?.[widget.id]?.title);
      collect(
        drift,
        `${base}.description`,
        widget.description,
        served.widgets?.[widget.id]?.description,
      );
    }
    expect(
      drift,
      'en.ts no longer matches the declared source in dashboards.system_overview — '
        + 'edit the bundle to the source string (this half is hand-authored; do NOT regenerate it)',
    ).toEqual([]);
  });
});
