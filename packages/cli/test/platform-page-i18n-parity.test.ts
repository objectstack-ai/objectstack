// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Drift guard for the plugin-carried Setup pages' i18n (#3589).
 *
 * Three Setup pages ship as metadata inside capability plugins
 * (`@objectstack/cloud-connection`, `@objectstack/mcp`) while their
 * translations live in `@objectstack/platform-objects` — the two are edited
 * in different packages by different people. `translatePage` applies the
 * bundle for EVERY locale including `en`, so an `en` entry that has drifted
 * from the metadata literal silently *overrides* the newer authored copy
 * rather than falling back to it. Nothing else in the build notices.
 *
 * The pages are fed through the CLI's own `collectExpectedEntries` — the same
 * extractor behind `os i18n extract` / `coverage` — so this doubles as a
 * dogfood of that tooling against the platform's own shipped metadata.
 *
 * Placement: `packages/cli` is the only package that already depends on all
 * three, and it owns the i18n coverage tooling. `platform-objects` must not
 * depend on plugins (wrong direction), and the qa contract packages carry
 * none of them.
 */

import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_INSTALLED_UI_BUNDLE,
  CLOUD_CONNECTION_UI_BUNDLE,
} from '@objectstack/cloud-connection';
import { CONNECT_AGENT_UI_BUNDLE } from '@objectstack/mcp';
import { SetupAppTranslations } from '@objectstack/platform-objects';
import { PAGE_COMPONENT_COPY_KEYS, translatePage } from '@objectstack/spec/system';
import { collectExpectedEntries } from '../src/utils/i18n-extract.js';

/** The pages exactly as the plugins register them with the kernel. */
const PAGES = [
  MARKETPLACE_INSTALLED_UI_BUNDLE.pages?.[0],
  CLOUD_CONNECTION_UI_BUNDLE.pages?.[0],
  CONNECT_AGENT_UI_BUNDLE.pages?.[0],
].filter(Boolean) as Array<Record<string, any>>;

const EN = 'en';
const pagesOf = (locale: string): Record<string, any> =>
  ((SetupAppTranslations as Record<string, any>)[locale]?.pages ?? {});

const read = (node: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>(
    (acc, seg) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : undefined),
    node,
  );

describe('plugin-carried Setup pages — i18n drift guard (#3589)', () => {
  it('finds all three pages through the plugins’ UI bundles', () => {
    expect(PAGES.map((p) => p.name).sort()).toEqual([
      'cloud_connection_settings',
      'connect_agent',
      'marketplace_installed',
    ]);
  });

  it('has an `en` translation entry for every page', () => {
    const en = pagesOf(EN);
    for (const page of PAGES) {
      expect({ page: page.name, hasEntry: Boolean(en[page.name]) })
        .toEqual({ page: page.name, hasEntry: true });
    }
  });

  it('keeps the `en` bundle byte-identical to the metadata literals', () => {
    // The real drift: someone edits `properties.subtitle` in the plugin and
    // leaves the bundle alone. `en` requests then render the STALE bundle
    // text, so the edit appears to do nothing.
    const en = pagesOf(EN);
    const expected = collectExpectedEntries({ pages: PAGES } as any)
      .filter((e) => e.path[0] === 'pages');

    expect(expected.length).toBeGreaterThan(0);

    for (const entry of expected) {
      const [, pageName, ...rest] = entry.path;
      const key = rest.join('.');
      expect({ page: pageName, key, value: read(en[pageName], key) })
        .toEqual({ page: pageName, key, value: entry.sourceValue });
    }
  });

  it('carries an entry for every page in every shipped locale (key sets, not leaf copy)', () => {
    // Scope, stated because this title used to promise “no silent English
    // fallback” — a guarantee the assertion below does not make. What it
    // compares is the SET OF PAGE NAMES under each locale’s `pages` against
    // `en`’s: an entry exists per page per locale, and no locale carries one
    // `en` lacks. It says nothing about the copy INSIDE an entry, which may
    // legitimately be the English source text — that is what the extractor
    // writes for an untranslated key under `--fill=default`, and under #8765’s
    // ruled Option B a leaf whose recorded source hash disagrees with the
    // current source is deliberately served as the source string (see
    // `platform-objects/src/apps/translations/source-hash.ts`, whose header
    // names this test as a key-set claim its fallback must not disturb).
    // Requiring each locale’s leaf to DIFFER from `en` is a coverage claim of
    // its own, not a restatement of this one.
    const locales = Object.keys(SetupAppTranslations as Record<string, unknown>);
    expect(locales).toContain(EN);
    expect(locales.length).toBeGreaterThan(1);

    const enKeys = Object.keys(pagesOf(EN)).sort();
    for (const locale of locales) {
      expect({ locale, pages: Object.keys(pagesOf(locale)).sort() })
        .toEqual({ locale, pages: enKeys });
    }
  });

  it('rewrites the page:header copy end-to-end for a non-English locale', () => {
    // The whole point of the chain: metadata in, localized header out.
    const headerOf = (page: Record<string, any>) => {
      for (const region of page.regions ?? []) {
        for (const component of region.components ?? []) {
          if (component.type === 'page:header') return component.properties ?? {};
        }
      }
      return {};
    };

    for (const page of PAGES) {
      // Snapshot by value up front — comparing two live reads of the same
      // object afterwards could not detect a mutation.
      const before = { ...headerOf(page) };
      const translated = translatePage(page as any, SetupAppTranslations, { locale: 'zh-CN' });
      const after = headerOf(translated);

      expect({ page: page.name, titleChanged: after.title !== before.title })
        .toEqual({ page: page.name, titleChanged: true });
      expect({ page: page.name, subtitleChanged: after.subtitle !== before.subtitle })
        .toEqual({ page: page.name, subtitleChanged: true });
      // Non-translatable props survive the overlay.
      expect({ page: page.name, icon: after.icon }).toEqual({ page: page.name, icon: before.icon });
      // The shared plugin-owned page object must not be mutated — it is a
      // module-level singleton the kernel registers once.
      expect({ page: page.name, header: headerOf(page) }).toEqual({ page: page.name, header: before });
    }
  });
});

// ─── Extractor ↔ resolver WALK parity (#13109) ─────────────────────────────
//
// The guard above compares extractor output against the SHIPPED bundle, so it
// only ever sees keys the extractor already emits — it is structurally blind
// to "a key that should have been offered and wasn't", which is exactly the
// defect #13109 records. This block is the differential the shared
// `PAGE_COMPONENT_COPY_KEYS` list cannot give: the KEY LIST has one definition
// and both sides import it, but the WALK — which COMPONENTS carry those keys —
// is written twice, once in `translatePage` (`packages/spec`) and once in
// `collectExpectedEntries`. `PAGE_COMPONENT_COPY_KEYS`' own JSDoc names the
// failure pair a second hand-maintained copy produces: offering a key the
// resolver ignores, or omitting one it reads. These tests fail on BOTH halves.
//
// The instrument is deliberately not a restatement of either walk: it runs the
// real `translatePage` against a sentinel bundle and asks which components it
// ACTUALLY rewrote, then compares that set against the ids the real extractor
// ACTUALLY offered. A copy of the traversal in the test would drift with
// whichever side it was copied from and pass through the drift it exists to
// catch.
//
// ⚠️ `MAX_NESTED_COMPONENT_DEPTH` is deliberately NOT exported by
// `packages/spec`, so the extractor mirrors the number rather than importing
// it. The deep-chain case below is what keeps the mirror honest: it walks
// deeper than the cap and asserts the two sides agree about where the descent
// stops, so raising the cap on one side alone reds here.

/**
 * Every component record reachable anywhere in a page document, by id — a
 * generic JSON walk, deliberately NOT a copy of either side's traversal, so it
 * cannot drift with the walk it is measuring. `seen` is its own cycle guard:
 * one fixture below is self-referential.
 */
const titlesById = (
  node: unknown,
  out = new Map<string, string>(),
  seen = new Set<object>(),
): Map<string, string> => {
  if (!node || typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) titlesById(item, out, seen);
    return out;
  }
  const rec = node as Record<string, any>;
  const props = rec.properties;
  if (
    typeof rec.id === 'string' && rec.id.length > 0 &&
    props && typeof props === 'object' && typeof props.title === 'string'
  ) {
    out.set(rec.id, props.title);
  }
  for (const value of Object.values(rec)) titlesById(value, out, seen);
  return out;
};

/** The sentinel a bundle entry carries, so an applied overlay is unmistakable. */
const sentinel = (id: string): string => `SENTINEL::${id}`;

/**
 * Ids `translatePage` ACTUALLY rewrote — measured, not restated: a bundle that
 * offers `pages.PAGE.components.ID.title` for EVERY id in the document, then a
 * walk of the result for the ones that came back carrying the sentinel.
 */
const idsResolverApplies = (page: Record<string, any>): Set<string> => {
  const ids = [...titlesById(page).keys()];
  const bundle = {
    en: {
      pages: {
        [page.name]: {
          components: Object.fromEntries(ids.map((id) => [id, { title: sentinel(id) }])),
        },
      },
    },
  } as any;
  const translated = titlesById(translatePage(page as any, bundle, { locale: 'en' }));
  return new Set(ids.filter((id) => translated.get(id) === sentinel(id)));
};

/** Ids the extractor offers a `components.ID.title` key for. */
const idsExtractorOffers = (page: Record<string, any>): Set<string> =>
  new Set(
    collectExpectedEntries({ pages: [page] } as any)
      .filter((e) =>
        e.path[0] === 'pages' && e.path[1] === page.name &&
        e.path[2] === 'components' && e.path[4] === 'title')
      .map((e) => e.path[3]),
  );

/** Entries the extractor offers under `pages.PAGE.components`, as flat rows. */
const componentRows = (page: Record<string, any>): Array<{ key: string; value?: string }> =>
  collectExpectedEntries({ pages: [page] } as any)
    .filter((e) => e.path[0] === 'pages' && e.path[1] === page.name && e.path[2] === 'components')
    .map((e) => ({ key: e.path.slice(3).join('.'), value: e.sourceValue }));

/**
 * One page carrying every nesting shape that exists on this surface — the ones
 * `translatePage` descends and the ones it deliberately does not. Built fresh
 * per call because `translatePage` returns a new document and the fixtures are
 * compared against their own source.
 */
const walkParityPage = (): Record<string, any> => ({
  name: 'walk_parity_page',
  regions: [
    {
      name: 'top',
      components: [
        // Region-level `page:header` WITH an id — see the exception below.
        { id: 'hdr', type: 'page:header', properties: { title: 'Header title' } },
      ],
    },
    {
      name: 'main',
      components: [
        { id: 'region_metric', type: 'object-metric', properties: { title: 'Region metric' } },
        {
          id: 'card',
          type: 'page:card',
          properties: {
            title: 'Card',
            // DESCENDED — the one composition key the ruling names.
            children: [
              { id: 'kpi_1', type: 'object-metric', properties: { title: 'KPI one' } },
              // `label` authored at top level rather than in props.
              { id: 'kpi_label', type: 'object-metric', label: 'KPI two', properties: { title: 'KPI two title' } },
              {
                id: 'inner_flex',
                type: 'page:flex',
                properties: {
                  title: 'Inner flex',
                  children: [
                    { id: 'kpi_deep', type: 'object-metric', properties: { title: 'Deep KPI' } },
                    // A nested `page:header` is reachable by the id route ONLY
                    // (the page-name route addresses THE page's header and
                    // stops at region level), so it must be offered here.
                    { id: 'nested_header', type: 'page:header', properties: { title: 'Nested header' } },
                  ],
                },
              },
              // `children` is `z.array(z.unknown())` — non-components are legal.
              'bare-component-id-string',
              null,
            ],
            // NOT descended by `translatePage`: `body`/`footer` are a
            // renderer-side back-compat fallback, and `items[].children` sits
            // one level deeper than the slot the ruling names.
            body: [{ id: 'card_body_child', type: 'object-metric', properties: { title: 'Body child' } }],
            footer: [{ id: 'card_footer_child', type: 'object-metric', properties: { title: 'Footer child' } }],
            items: [{ children: [{ id: 'tab_child', type: 'object-metric', properties: { title: 'Tab child' } }] }],
          },
        },
      ],
    },
  ],
  // NOT walked by `translatePage` at all — it maps `regions` only.
  slots: { aside: { id: 'slot_child', type: 'object-metric', properties: { title: 'Slot child' } } },
});

/** A container chain deeper than the resolver's descent cap. */
const deepChainPage = (length: number): Record<string, any> => {
  const node = (depth: number): Record<string, any> => ({
    id: `d${depth}`,
    type: 'page:flex',
    properties: {
      title: `Depth ${depth}`,
      ...(depth + 1 < length ? { children: [node(depth + 1)] } : {}),
    },
  });
  return { name: 'walk_depth_page', regions: [{ name: 'main', components: [node(0)] }] };
};

/** Ids repeated across levels, so the ruled arbitration is observable. */
const collisionPage = (): Record<string, any> => ({
  name: 'walk_collision_page',
  regions: [
    {
      name: 'main',
      components: [
        { id: 'shared', type: 'object-metric', properties: { title: 'Region level wins' } },
        { id: 'hdr_id', type: 'page:header', properties: { title: 'Header holds this id' } },
        {
          id: 'wrap',
          type: 'page:card',
          properties: {
            title: 'Wrap',
            children: [
              { id: 'shared', type: 'object-metric', properties: { title: 'Nested namesake loses' } },
              { id: 'hdr_id', type: 'object-metric', properties: { title: 'Nested under a header id loses' } },
              { id: 'twice', type: 'object-metric', properties: { title: 'First nested wins' } },
              { id: 'twice', type: 'object-metric', properties: { title: 'Second nested loses' } },
            ],
          },
        },
      ],
    },
  ],
});

describe('i18n-extract ↔ translatePage walk parity (#13109)', () => {
  it('offers a per-component key for exactly the components the resolver rewrites', () => {
    const page = walkParityPage();
    const offered = idsExtractorOffers(page);
    const applied = idsResolverApplies(page);

    // Both directions, named separately so a failure says WHICH half broke.
    expect({ offeredButIgnored: [...offered].filter((id) => !applied.has(id)).sort() })
      .toEqual({ offeredButIgnored: [] });
    // The ONE standing exception, pre-dating this card and deliberate: a
    // region-level `page:header`'s copy is offered under `pages.PAGE.title` /
    // `.subtitle` instead, because emitting it here too would offer one string
    // under two keys. The resolver still honours the id route for it, so it
    // shows up as applied-not-offered — listed explicitly rather than filtered
    // out of the fixture, so the exception stays visible and bounded to one id.
    expect({ appliedButNotOffered: [...applied].filter((id) => !offered.has(id)).sort() })
      .toEqual({ appliedButNotOffered: ['hdr'] });
  });

  it('pins the two sets by name, so a shape that stops being reachable is visible', () => {
    const page = walkParityPage();
    expect([...idsExtractorOffers(page)].sort()).toEqual([
      'card', 'inner_flex', 'kpi_1', 'kpi_deep', 'kpi_label', 'nested_header', 'region_metric',
    ]);
    // `card_body_child`, `card_footer_child`, `tab_child` and `slot_child` are
    // absent from BOTH sides — the shapes `translatePage` does not descend.
    expect([...idsResolverApplies(page)].sort()).toEqual([
      'card', 'hdr', 'inner_flex', 'kpi_1', 'kpi_deep', 'kpi_label', 'nested_header', 'region_metric',
    ]);
  });

  it('carries the whole shared key list down into nesting, label either/or included', () => {
    const rows = componentRows(walkParityPage());
    // `label` authored at the component's top level, the same either/or
    // `translatePage` resolves back onto.
    expect(rows).toContainEqual({ key: 'kpi_label.label', value: 'KPI two' });
    expect(rows).toContainEqual({ key: 'kpi_deep.title', value: 'Deep KPI' });
    // Every offered key belongs to the shared list — the extractor must not
    // invent a key the resolver has no reader for.
    const keys = new Set(rows.map((r) => r.key.split('.').slice(1).join('.')));
    expect([...keys].filter((k) => !(PAGE_COMPONENT_COPY_KEYS as readonly string[]).includes(k)))
      .toEqual([]);
  });

  it('stops descending where the resolver stops, on a chain deeper than the cap', () => {
    const page = deepChainPage(40);
    const offered = idsExtractorOffers(page);
    const applied = idsResolverApplies(page);
    expect([...offered].sort()).toEqual([...applied].sort());
    // Stated as a number so the mirrored cap is visible in the failure text;
    // the set comparison above is what actually holds the two sides together.
    const deepest = Math.max(...[...applied].map((id) => Number(id.slice(1))));
    expect({ deepest, offeredCount: offered.size }).toEqual({ deepest: 32, offeredCount: 33 });
  });

  it('resolves a repeated id to one component, the same one the resolver picks', () => {
    const page = collisionPage();
    const rows = componentRows(page);

    // One bundle entry, one component: no id may be offered twice.
    const keys = rows.map((r) => r.key);
    expect(keys.length).toEqual(new Set(keys).size);

    // Region level wins outright over a nested namesake.
    expect(rows.filter((r) => r.key === 'shared.title'))
      .toEqual([{ key: 'shared.title', value: 'Region level wins' }]);
    // Among nested components, document order decides.
    expect(rows.filter((r) => r.key === 'twice.title'))
      .toEqual([{ key: 'twice.title', value: 'First nested wins' }]);
    // A region-level `page:header` emits nothing here, but its id still BLOCKS
    // a nested namesake — the resolver counts it as region-level, so offering
    // the nested one would be a key the resolver ignores.
    expect(rows.filter((r) => r.key.startsWith('hdr_id.'))).toEqual([]);

    // And the resolver agrees about which component the entry lands on.
    const bundle = {
      en: {
        pages: {
          walk_collision_page: {
            components: {
              shared: { title: 'S' }, twice: { title: 'T' }, hdr_id: { title: 'H' },
            },
          },
        },
      },
    } as any;
    const translated = translatePage(page as any, bundle, { locale: 'en' });
    const region = translated.regions[0].components;
    expect(region[0].properties.title).toEqual('S');
    expect(region[1].properties.title).toEqual('H');
    const nested = region[2].properties.children;
    expect(nested.map((c: any) => c.properties.title)).toEqual([
      'Nested namesake loses',
      'Nested under a header id loses',
      'T',
      'Second nested loses',
    ]);
  });

  it('terminates on a self-referential `children` array', () => {
    // `children` is `z.array(z.unknown())` authored data, so the resolver
    // carries an ancestor-path cycle guard and this walk mirrors it.
    //
    // ⚠️ `kind: 'html'` is load-bearing, not decoration. The object-sections
    // pass inside the SAME `collectExpectedEntries` call reaches this page
    // through `@objectstack/lint`'s `walkPageComponents`, which has no cycle
    // guard and blows the stack on this fixture (RangeError, measured) — filed
    // separately, out of scope here. `walkPageComponents` skips source-authored
    // pages, while `translatePage` walks their regions like any other page, so
    // this kind isolates the pass under test. That divergence is itself part of
    // why this walk is NOT `walkPageComponents`.
    const cyclic: Record<string, any> = {
      id: 'loop', type: 'page:flex', properties: { title: 'Loop', children: [] as unknown[] },
    };
    cyclic.properties.children.push(cyclic);
    const page = {
      name: 'walk_cycle_page', kind: 'html',
      regions: [{ name: 'main', components: [cyclic] }],
    };
    expect(componentRows(page)).toEqual([{ key: 'loop.title', value: 'Loop' }]);
    // The resolver terminates on the same document too, and still applies the
    // entry — read directly rather than through the generic walk above, whose
    // by-id map cannot express "the same id twice, one translated".
    const bundle = {
      en: { pages: { walk_cycle_page: { components: { loop: { title: 'L' } } } } },
    } as any;
    const translated = translatePage(page as any, bundle, { locale: 'en' }) as any;
    expect(translated.regions[0].components[0].properties.title).toEqual('L');
  });
});
