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
// Setup is the extreme of a shape every app of this package can have, though,
// and the Account app has the mild version of it: ONE contributed entry beside
// eleven static ones. Both directions below therefore judge a population of
// `static declaration ∪ runtime contributions` rather than the static walk
// alone — see `CONTRIBUTED_NAV_IDS` for what that second term is, what it is
// deliberately not, and how it was measured.
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

// ── The second term of the population: runtime contributions ────────────────
//
// An app of this package can carry nav entries it does not declare. Another
// package aims a `navigationContributions[]` entry (ADR-0029 D7) at it BY NAME
// and the registry folds the items into the named group at runtime; the app
// object this file imports never changes. Those ids are ordinary menu entries
// with ordinary labels, and the bundles carry a key for each of them —
// `apps.<app>.navigation.<id>`, one namespace per app — so a population read
// off `app.navigation` alone judges them wrong in BOTH directions: their keys
// look like dead weight to the reverse direction, and a missing translation
// for one is invisible to the presence direction.
//
// So the population is `static declaration ∪ runtime contributions`, and the
// second term is declared here, per target app.
//
// ⛔ NOT a place to list Setup's contributed leaves. Setup is a shell of empty
// group anchors whose entries all arrive at runtime from a dozen contributors,
// several of them conditional — writing ~40 ids here would re-declare an owner
// this file cannot implement, which is the #5750 defect in one edit. Setup's
// merged tree belongs to `pnpm check:app-nav-i18n` (which boots) and the ids
// no single boot can decide belong to `setup-nav-dead-key-tombstone.test.ts`
// (which pins them one by one). `account` is the opposite shape — one
// contributor, one id — which is the only reason it can be written down.
//
// MEASURED, not assumed, on `9ccc4179ee`: a sweep of every `app: '<name>'`
// contribution target in `packages/` and `examples/` returns `setup` ×20,
// `account` ×1 and `studio` ×0, and the one `account` entry is
// `CONNECT_AGENT_UI_BUNDLE.navigationContributions[1]` in
// `packages/mcp/src/connect-ui.ts` (`group: 'grp_account_developer'`), which
// `MCPServerPlugin` registers on `kernel:ready` behind `isMcpServerEnabled()`.
// Worth stating because it is NOT how Setup's arrive: this package owns
// `SETUP_NAV_CONTRIBUTIONS` itself and `@objectstack/setup` registers it,
// whereas `@objectstack/account` registers `apps: [ACCOUNT_APP]` and no
// contributions at all — the Account entry comes from a package on the other
// side of the dependency graph.
//
// Which is also why this is a declaration and not an import. `@objectstack/mcp`
// is one of the packages this one deliberately does not depend on to run its
// tests (see the `pages.*` note at the bottom of this file), and a booting gate
// cannot close it either: `nav_connect_agent` is contributed only where the MCP
// server is enabled, so from one composition "opted out" and "retired" are the
// same observation — the same reason `CONDITIONAL_SETUP_NAV_IDS` in
// `setup-nav-dead-key-tombstone.test.ts` is a hand-kept list. The declaring
// side is confirmed by grep and named above.
//
// WHEN THIS GOES RED: a line here is deleted in the same commit that retires
// its contribution, never before and never after. Delete it first and the
// presence direction reds on an entry that still ships untranslated; delete it
// after, and the reverse direction stays green over four dead keys — which is
// the exact "dead weight that reads as coverage" this file exists to refuse.
const CONTRIBUTED_NAV_IDS: Readonly<Record<string, readonly string[]>> = {
  account: ['nav_connect_agent'],
};

/**
 * The ids an app really presents: its static declaration ∪ the ids contributed
 * into it at runtime. Both directions below judge this set, so the two stay
 * exact converses of each other.
 */
function navPopulation(app: { name: string; navigation?: unknown[] }): string[] {
  return [...new Set([...navIds(app), ...(CONTRIBUTED_NAV_IDS[app.name] ?? [])])];
}

describe('every nav id an app presents is translated in every locale', () => {
  for (const app of [STUDIO_APP, ACCOUNT_APP] as Array<{ name: string; navigation?: unknown[] }>) {
    for (const [locale, data] of Object.entries(LOCALES)) {
      it(`${app.name} — ${locale}`, () => {
        const nav = (data.apps?.[app.name]?.navigation ?? {}) as Record<string, { label?: string }>;
        const missing = navPopulation(app).filter((id) => !nav[id]?.label);
        expect(missing, `untranslated nav ids in apps.${app.name}.navigation`).toEqual([]);
      });
    }
  }

  // The reverse direction. A translation for an id the app no longer presents is
  // dead weight that reads as coverage — `nav_workflows` outlived its menu entry
  // in all four locales and nothing said so.
  //
  // "Presents", not "declares": the judged set is `navPopulation`, so a key for
  // a runtime-contributed entry is coverage of a real menu item, not an orphan.
  // That distinction is what kept the Account app out of this loop. Judged
  // against the static walk alone it reports four orphans — the
  // `apps.account.navigation.nav_connect_agent` key in each locale — for a menu
  // entry every user with the MCP server enabled actually sees, so the
  // direction that catches dead keys could not be run over the app at all. The
  // union is what lets it run. Exempting contributed keys instead would have
  // bought the same green by giving the assertion up.
  for (const app of [STUDIO_APP, ACCOUNT_APP] as Array<{ name: string; navigation?: unknown[] }>) {
    for (const [locale, data] of Object.entries(LOCALES)) {
      it(`${app.name} — ${locale} carries no translation for a removed nav id`, () => {
        const declared = new Set(navPopulation(app));
        const translated = Object.keys(data.apps?.[app.name]?.navigation ?? {});
        expect(
          translated.filter((id) => !declared.has(id)),
          `apps.${app.name}.navigation keys with no nav item declaring or `
            + 'contributing them — see CONTRIBUTED_NAV_IDS in this file',
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
// Still NOT claimed here: anything about zh-CN / ja-JP / es-ES. That used to be
// because the question was undecided — what a translated locale should do when
// its source string changes (keep serving the stale value, fall back to the
// source, fail the build) was a product call, not a test's to invent. It has
// since been ruled (#8765, Option B: record the source hash at translation
// time; a mismatch marks the translation stale, and stale falls back to the
// source text) and implemented in `source-hash.ts`, which `setup.translation.ts`
// applies when it assembles the served bundle.
//
// So the reason this block stops at `en` has changed, and the new one is worth
// stating: staleness in a translated locale is now a SERVING rule, not an
// assertion. Nothing here — or anywhere — fails a build because zh-CN lags a
// source edit; the stale leaf is simply served as the source string, which is
// the same degradation an untranslated key already produces. Asserting the
// absence of stale translations in this file would re-introduce Option C
// (a four-locale translation task in front of every one-word source edit),
// which the ruling rejected. `source-hash.test.ts` pins the mechanism on
// synthetic bundles for exactly that reason, and says so.
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
// Default locale only, and that clause needs one qualification since #8765.
// Per-locale COVERAGE of those `pages.*` keys in `zh-CN` / `ja-JP` / `es-ES`
// — does a translation exist for each one — is still unasserted anywhere in
// this repo. Their FRESHNESS is no longer unjudged, though: those leaves carry
// recorded source hashes like every other hand-authored leaf, so a `pages.*`
// source edit makes the three translated copies fall back to the source string
// instead of serving the pre-edit text (`source-hash.ts`). That is a serving
// rule, not an assertion — it fails no build, and it does not make the missing
// coverage claim above. All three were in parity when this block was written.
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
