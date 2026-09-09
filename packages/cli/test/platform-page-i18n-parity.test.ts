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
import * as PlatformPages from '@objectstack/platform-objects/pages';
import { PAGE_COMPONENT_COPY_KEYS, translatePage, walkAddressedPageComponents } from '@objectstack/spec/system';
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
// was written twice, once in `translatePage` (`packages/spec`) and once in
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
// Since #13218 (ruled 2026-08-30) the walk itself is ONE exported symbol —
// `walkAddressedPageComponents` in `@objectstack/spec/system` — and both sides
// consume it, so the five invariants this block measures (roots, descent key,
// depth cap, cycle guard, collision arbitration) have a single source. This
// block is the convergence's REGRESSION GUARD, preserved by that ruling: it
// still measures end to end, so it catches what sharing a symbol cannot — a
// consumer detaching from the walk again, or wiring it up so the two sides
// diverge in what they DO at each component. The deep-chain case runs a chain
// deeper than the (module-private) cap and asserts both sides stop at the same
// depth, cap drift included.

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
            // renderer-side back-compat fallback, not an authorable
            // composition spelling.
            body: [{ id: 'card_body_child', type: 'object-metric', properties: { title: 'Body child' } }],
            footer: [{ id: 'card_footer_child', type: 'object-metric', properties: { title: 'Footer child' } }],
            // DESCENDED since #16772 — a `page:tabs` / `page:accordion`
            // panel's `items[].children`, one level below the container.
            items: [{ label: 'Panel', children: [{ id: 'tab_child', type: 'object-metric', properties: { title: 'Tab child' } }] }],
          },
        },
      ],
    },
  ],
  // A ROOT since #16772 — a `kind: 'slotted'` page authors its components
  // here (one component or an array per slot); walked after the regions.
  slots: {
    aside: { id: 'slot_child', type: 'object-metric', properties: { title: 'Slot child' } },
    details: [{ id: 'slot_list_child', type: 'record:details', properties: { title: 'Slot list child' } }],
  },
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
    // NO standing exception any more. This list used to read `['hdr']` — a
    // region-level `page:header` carrying an id, whose copy the extractor
    // deliberately offers under `pages.PAGE.title` / `.subtitle` while the
    // resolver went on honouring the id route for it and PREFERRING it. That
    // was the second half of the failure pair `walkAddressedPageComponents`
    // exists to prevent (the resolver reading an id the extractor omits), and
    // the 2026-09-06 ruling (decision batch #58) closed it by making the
    // page-name route canonical for this component. Empty in BOTH directions
    // is now the invariant; an entry reappearing here is a regression, not an
    // exception to document.
    expect({ appliedButNotOffered: [...applied].filter((id) => !offered.has(id)).sort() })
      .toEqual({ appliedButNotOffered: [] });
  });

  it('pins the two sets by name, so a shape that stops being reachable is visible', () => {
    const page = walkParityPage();
    expect([...idsExtractorOffers(page)].sort()).toEqual([
      'card', 'inner_flex', 'kpi_1', 'kpi_deep', 'kpi_label', 'nested_header', 'region_metric',
      'slot_child', 'slot_list_child', 'tab_child',
    ]);
    // `card_body_child` and `card_footer_child` are absent from BOTH sides —
    // the shapes `translatePage` does not descend. `tab_child`, `slot_child`
    // and `slot_list_child` are present on BOTH sides since #16772 widened
    // the shared walk to `items[].children` and to the `slots.<slot>` roots.
    // `hdr` — the region-level `page:header` — is absent from BOTH sides since
    // the ruling. `nested_header` stays: a `page:header` inside a container is
    // reached by the id route only, so the id key is the only key it has.
    expect([...idsResolverApplies(page)].sort()).toEqual([
      'card', 'inner_flex', 'kpi_1', 'kpi_deep', 'kpi_label', 'nested_header', 'region_metric',
      'slot_child', 'slot_list_child', 'tab_child',
    ]);
  });

  it('offers and reads the page-name header route for a `slots.header` page:header — a slotted page has a header too (#16772)', () => {
    const page = {
      name: 'slotted_header_page',
      label: 'Contract',
      kind: 'slotted',
      regions: [],
      slots: {
        header: { id: 'hdr', type: 'page:header', properties: { title: 'Contract detail', subtitle: 'Lifecycle' } },
      },
    };
    const offered = collectExpectedEntries({ pages: [page] } as any)
      .filter((e) => e.path[0] === 'pages' && e.path[1] === page.name)
      .map((e) => e.path.slice(2).join('.'))
      .sort();
    // Page-name route offered; the id route NOT offered for a root-level
    // header, exactly as for a region-level one.
    expect(offered).toEqual(['label', 'subtitle', 'title']);

    const bundle = {
      en: { pages: { slotted_header_page: { title: 'T::title', subtitle: 'T::subtitle', components: { hdr: { title: 'ID-ROUTE' } } } } },
    } as any;
    const out = translatePage(page as any, bundle, { locale: 'en' });
    expect(out.slots.header.properties).toEqual({ title: 'T::title', subtitle: 'T::subtitle' });
  });

  // ── The ruled invariant, pinned directly (decision batch #58, 2026-09-06) ──
  //
  // Maintainer 「同意」, option 1, verbatim: "The page-name route is canonical
  // for a region-level `page:header`. `translatePage` stops reading the id
  // route (`pages.PAGE.components.HEADERID.*`) for a `page:header` at region
  // level; a `page:header` nested inside a container stays id-only, as its doc
  // already says. One component, one address — `title` and `subtitle` now
  // follow the same rule."
  //
  // The set comparisons above measure `title` alone, because that is the key
  // both fixtures carry. This case walks the WHOLE shared key list and asserts
  // BOTH verbs of the failure pair on one component, in one place: the id key
  // is neither OFFERED nor READ. It also pins the three things that must NOT
  // move with it — the page-name route still translates the header, a nested
  // `page:header` is still id-addressed, and a bundle carrying both routes
  // resolves to the page-name one — so a regression that simply stops
  // translating region-level headers cannot pass here either.
  const headerRoutePage = (): Record<string, any> => ({
    name: 'header_route_page',
    regions: [
      {
        name: 'top',
        components: [
          // Region level, WITH an id — the shape the card measured (hotcrm's
          // five headers all carry one).
          { id: 'home_header', type: 'page:header', properties: { title: 'Sales Home', subtitle: 'Welcome back' } },
        ],
      },
      {
        name: 'main',
        components: [
          {
            id: 'wrap',
            type: 'page:card',
            properties: {
              title: 'Wrap',
              children: [
                // Nested — the page-name route does not reach it, so the id
                // route is the ONLY route it has. Unchanged by the ruling.
                { id: 'inner_header', type: 'page:header', properties: { title: 'Inner header' } },
              ],
            },
          },
        ],
      },
    ],
  });

  /** Every key of the shared list under one id, sentinel-valued. */
  const everyKeyFor = (id: string): Record<string, string> =>
    Object.fromEntries(PAGE_COMPONENT_COPY_KEYS.map((k) => [k, `ID::${id}::${k}`]));

  it('neither offers nor reads the id key for a region-level `page:header` (batch #58)', () => {
    const page = headerRoutePage();

    // Half one — the extractor offers NOTHING under `components.home_header`,
    // for any key of the shared list.
    expect(componentRows(page).filter((r) => r.key.startsWith('home_header.'))).toEqual([]);

    // Half two — the resolver reads nothing there either. The bundle offers
    // every key of the shared list under that id; a sentinel reaching the
    // output would mean the id route is still live for this component.
    const idBundle = {
      en: {
        pages: {
          header_route_page: {
            components: { home_header: everyKeyFor('home_header'), wrap: everyKeyFor('wrap') },
          },
        },
      },
    } as any;
    const viaId = translatePage(page as any, idBundle, { locale: 'en' });
    const header = viaId.regions[0].components[0];
    expect(header.properties).toEqual({ title: 'Sales Home', subtitle: 'Welcome back' });
    expect(header.label).toBeUndefined();
    // Positive control for that empty: the SAME bundle shape does reach a
    // component the id route serves, so the two assertions above are a reading
    // and not an inert fixture.
    expect(viaId.regions[1].components[0].properties.title).toEqual('ID::wrap::title');

    // Half three — the page-name route still translates the header. The fix is
    // "one address", not "no address".
    const nameBundle = {
      en: { pages: { header_route_page: { title: 'BY-NAME', subtitle: 'SUB-BY-NAME' } } },
    } as any;
    const viaName = translatePage(page as any, nameBundle, { locale: 'en' });
    expect(viaName.regions[0].components[0].properties)
      .toEqual({ title: 'BY-NAME', subtitle: 'SUB-BY-NAME' });
    // ...and it stops at region level: the nested header keeps its literal.
    expect(viaName.regions[1].components[0].properties.children[0].properties.title)
      .toEqual('Inner header');

    // Half four — a nested `page:header` is still reached, by the id route.
    const nestedBundle = {
      en: {
        pages: {
          header_route_page: { title: 'BY-NAME', components: { inner_header: { title: 'ID::inner' } } },
        },
      },
    } as any;
    const viaNested = translatePage(page as any, nestedBundle, { locale: 'en' });
    expect(viaNested.regions[1].components[0].properties.children[0].properties.title)
      .toEqual('ID::inner');
    // The extractor offers that nested id, which is the other half of "stays
    // id-only" — the two sides agree about it as much as about the region one.
    expect(componentRows(page).filter((r) => r.key === 'inner_header.title'))
      .toEqual([{ key: 'inner_header.title', value: 'Inner header' }]);

    // Half five — the card's Leg A shape 3, inverted. Both routes present:
    // BEFORE the ruling the id route won here ("ZH-by-ID"); the page-name
    // route is canonical now, so the components key is inert on this component
    // and the bundle that overrode a header title through it falls back.
    const bothBundle = {
      en: {
        pages: {
          header_route_page: {
            title: 'BY-NAME',
            subtitle: 'SUB-BY-NAME',
            components: { home_header: { title: 'BY-ID' } },
          },
        },
      },
    } as any;
    expect(translatePage(page as any, bothBundle, { locale: 'en' }).regions[0].components[0].properties)
      .toEqual({ title: 'BY-NAME', subtitle: 'SUB-BY-NAME' });
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
    // the nested one would be a key the resolver ignores. The ruling changed
    // what the resolver READS for that id, not who OWNS it: the arbitration is
    // a property of the document and both consumers still decide it the same
    // way, which is why this half is unchanged.
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
    // `hdr_id` is the region-level `page:header`: the bundle's `H` under
    // `components.hdr_id.title` is NOT read, and this page has no
    // `pages.walk_collision_page.title` either, so the authored literal stands.
    expect(region[1].properties.title).toEqual('Header holds this id');
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


// --- The three shipped platform RECORD pages (#14817) ----------------------
//
// The guard at the top of this file owns the plugin-carried Setup pages whose
// copy lives in the BUNDLE. This block owns the other three pages the platform
// ships -- `sys_user_detail`, `sys_organization_detail`, `sys_position_detail`,
// contributed by plugin-auth and plugin-security -- whose copy is almost
// entirely authored INLINE, and which were in no `os i18n extract` config and
// under no gate at all.
//
// ## The measurement this block was written from
//
// Fed through the real `collectExpectedEntries`, the three pages together
// offer exactly THREE keys -- one page-level `label` each. Nothing else. All
// three author `regions: []` and put every component under `slots.*`, and the
// shared walk (`walkAddressedPageComponents`, `@objectstack/spec/system`) roots
// at `regions[].components[]` only. So 45 further authored copy sites, every
// one of them an inline `{ en, 'zh-CN', ... }` locale map, are not reachable
// from the bundle face at all. A control page authored under `regions` with a
// `component.id` DOES get its component copy offered, which is how we know the
// extractor is working and the absence is the pages' SHAPE.
//
// ## Why that is not a defect this block tries to fix
//
// The inline map is the RULED route for page copy, not a workaround: the
// maintainer ruled (2026-08-06) that it is a delivered capability, which is why
// `I18nLabelSchema` is a union of a plain string and an inline map, and why
// `translation.zod.ts` declines `content` on the bundle face for the identical
// shape. Whether the EXTRACTOR should also see those maps is an open question
// (#14749) and a maintainer decision. This block therefore does not widen
// anything -- it makes the boundary measurable and puts the surface under a
// gate for the first time.
//
// ## What each assertion buys
//
// The harm recorded on #14817 is not today's debt (there is none) -- it is that
// `check:i18n-coverage`'s `0` for `platform-objects` reads as "checked, clean"
// over a population that never contained these pages, so "a fourth plugin page,
// or one new untranslated section heading, lands green". The population below
// is read from the `@objectstack/platform-objects/pages` BARREL rather than
// listed here, so a fourth page joins this gate by existing; and the inline-map
// assertion judges the authoring site, which is the half the bundle face
// cannot see. Both directions of that sentence now red instead of shipping.
//
// ## The `pages.*` bundle entry this block once refused -- and the ruling that
// ## delivered it (#15743)
//
// This section used to say the block "does not require a `pages.*` BUNDLE entry
// for these three", and record why: the three page-level `label`s are the only
// keys the extractor offers, so translating them is the one piece of real debt
// here (`User` / `Organization` / `Position` rendered in English in every
// locale), but adding those entries turned `check:app-nav-i18n` RED on two of
// the three -- `pages.sys_user_detail` and `pages.sys_organization_detail` came
// back as keys "the booted composition contains no page by that name", its
// orphan verdict. That gate's `CONTRIBUTORS` roster is deliberately explicit
// and deliberately a NAV roster: `@objectstack/plugin-auth`, which contributes
// those two pages, is not in it, and adding it is not a one-line edit --
// `new AuthPlugin({})` refuses to boot ("secret is required"), and the roster
// separately requires every entry to land at least one nav id, which
// plugin-auth's conditional `nav_sso_providers` cannot promise. Only
// `sys_position_detail` (plugin-security, which IS in the roster) verified
// clean. The block escalated rather than deciding.
//
// It was ruled at PR #15739 and taken on #15743: option B, move the `pages.*`
// parity verdict OFF that roster and onto this file, then translate the three
// labels. Both halves are below -- the moved verdict and its red-shape controls
// in the next block, the nine delivered translation units in the one after. The
// three pages now DO carry a `pages.*` entry in all four shipped locales, and
// the assertion two below still holds: `label` remains the only key the
// extractor offers them, because nothing about their SHAPE changed.

/** Every page the platform's own `pages` barrel exports, as the plugins take them. */
const RECORD_PAGES: Array<Record<string, any>> = Object.values(
  PlatformPages as unknown as Record<string, unknown>,
).filter(
  (v): v is Record<string, any> =>
    Boolean(v) && typeof v === 'object' && typeof (v as any).name === 'string',
);

/** The locales the shipped bundle actually carries -- never a hard-coded list. */
const SHIPPED_LOCALES = Object.keys(SetupAppTranslations as Record<string, unknown>);

/**
 * A key is a locale code (`en`, `zh-CN`). Deliberately a shape test rather than
 * a membership test against `SHIPPED_LOCALES`: a map carrying a locale the
 * bundle does not ship is still an inline map, and must still be judged.
 */
const LOCALE_KEY = /^[a-z]{2}(-[A-Z]{2})?$/;

/** An inline `I18nLabel` map: every key a locale code, every value a string. */
const isInlineLocaleMap = (value: unknown): value is Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as object);
  return keys.length > 0
    && keys.every((k) => LOCALE_KEY.test(k))
    && Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
};

/**
 * Every inline locale map anywhere in a page document, by authored path. A
 * generic JSON walk with its own cycle guard, deliberately NOT a copy of either
 * the resolver's or the extractor's traversal -- the whole point is to reach
 * what those two do not.
 */
const inlineLocaleMaps = (
  node: unknown,
  path: string,
  out: Array<{ path: string; locales: string[] }> = [],
  seen = new Set<object>(),
): Array<{ path: string; locales: string[] }> => {
  if (!node || typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    node.forEach((item, i) => inlineLocaleMaps(item, `${path}[${i}]`, out, seen));
    return out;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (isInlineLocaleMap(value)) {
      out.push({ path: here, locales: Object.keys(value) });
      continue;
    }
    inlineLocaleMaps(value, here, out, seen);
  }
  return out;
};

describe('shipped platform record pages -- i18n ownership (#14817)', () => {
  it('reads a non-empty population from the pages barrel', () => {
    // A floor, not an equality: adding a page is ordinary work and must not
    // red here. What this refuses is the scan that finds NOTHING -- an empty
    // population would satisfy every `for` loop below and report success over
    // zero pages, which is the exact shape of the `0` that reads as "clean".
    expect(RECORD_PAGES.length).toBeGreaterThanOrEqual(3);
    expect(RECORD_PAGES.map((p) => p.name).sort()).toEqual(
      expect.arrayContaining(['sys_organization_detail', 'sys_position_detail', 'sys_user_detail']),
    );
    expect(SHIPPED_LOCALES).toContain(EN);
    expect(SHIPPED_LOCALES.length).toBeGreaterThan(1);
  });

  it('records that the walk now reaches under `slots`, that these pages author no component id there, and so the extractor still offers the label alone', () => {
    // A BOUNDARY PIN, not an endorsement — re-measured, and the reason moved.
    // Until #16772 `offered: ['label']` held because the shared walk rooted at
    // `regions[].components[]` and these pages author `regions: []`: the 45
    // inline sites under `slots.*` were UNREACHABLE. #16772 widened the walk
    // to the `slots.<slot>` roots and to `items[].children`, and the notice the
    // old pin promised fired — so this is the answer to it, measured off the
    // documents: the walk now VISITS every component under `slots` (`reached`
    // below), and not one of them carries an `id`, so nothing is addressable
    // by `pages.<name>.components.<id>` and the extractor still offers the
    // page label alone. These pages gained no bundle surface, need no entries,
    // and their coverage home stays this file (the inline-map case below).
    // Both halves are held so the next change is told precisely: `reached`
    // reds if the roots narrow again; `offered` grows the day one of these
    // components takes an id, and that component then needs a bundle entry.
    for (const page of RECORD_PAGES) {
      let visited = 0;
      let addressed = 0;
      walkAddressedPageComponents(page as any, (component, ctx) => {
        visited += 1;
        if (ctx.addressed) addressed += 1;
        return component;
      });
      const offered = collectExpectedEntries({ pages: [page] } as any)
        .filter((e) => e.path[0] === 'pages' && e.path[1] === page.name)
        .map((e) => e.path.slice(2).join('.'))
        .sort();
      expect({ page: page.name, regions: page.regions, reached: visited > 0, addressed, offered })
        .toEqual({ page: page.name, regions: [], reached: true, addressed: 0, offered: ['label'] });
    }
  });

  it('holds every inline locale map on those pages complete in every shipped locale', () => {
    // The recurrence guard, and the answer to "nobody would learn if it stopped
    // being zero". These maps are invisible to `os i18n extract` and therefore
    // to `check:i18n-coverage`; before this assertion a new section heading
    // authored with `en` alone shipped green and rendered English to every
    // reader. The population is measured off the documents, so it grows with
    // the pages instead of needing a list here.
    const maps = RECORD_PAGES.flatMap((page) => inlineLocaleMaps(page, page.name));

    // Same refusal as the population floor: zero maps means the walk broke, not
    // that the pages went monolingual.
    expect(maps.length).toBeGreaterThanOrEqual(45);

    const incomplete = maps
      .filter((m) => SHIPPED_LOCALES.some((locale) => !m.locales.includes(locale)))
      .map((m) => ({ path: m.path, missing: SHIPPED_LOCALES.filter((l) => !m.locales.includes(l)) }));
    expect(incomplete).toEqual([]);
  });
});

// ─── The `pages.*` default-locale parity verdict (#8764, moved here by #15743) ─
//
// This verdict used to live in `packages/cli/scripts/check-app-nav-i18n.mjs`,
// beside that gate's `CONTRIBUTORS` roster. #15743 ruled it out of there
// (option B, ruled at PR #15739) and into this file. The reason is not tidiness
// — it is the roster's own defect class:
//
//   > the defect class this whole card is about is ONE roster silently serving
//   > TWO populations — exactly what produced the ambiguous 0
//
// `CONTRIBUTORS` is a NAV roster: every entry must land at least one nav id or
// the gate fails, and it boots each contributor to get them. The pages rode
// along because the same manifests happened to carry `pages:`. Those two
// populations are NOT the same set, and the measurement that settles it: the
// booted composition contains FOUR pages (`cloud_connection_settings`,
// `connect_agent`, `marketplace_installed`, `sys_position_detail`) while the
// platform ships SIX. `sys_user_detail` and `sys_organization_detail` come from
// `@objectstack/plugin-auth`, which cannot join a NAV roster at all —
// `new AuthPlugin({})` refuses to boot ("secret is required") and its only nav
// contribution (`nav_sso_providers`) is conditional, so it can never satisfy the
// at-least-one-nav-id invariant. A bundle entry for either page therefore drew
// the gate's ORPHAN verdict, "the booted composition contains no page by that
// name" — true about that composition, false about the platform.
//
// ⛔ Option A — splitting the roster into a NAV population and a PAGE
// population, booting `plugin-auth` with a test secret, and exempting pages
// from the nav-id invariant — was refused on #15743 and is not to be revived:
// it makes one roster serve two populations explicitly, with a credential
// fixture and a hand-carved exemption, which is the original defect with better
// documentation.
//
// Here the population is READ, not rostered: the contributing plugins' UI
// bundles plus the `@objectstack/platform-objects/pages` barrel, neither of
// which needs a boot, a credential or a nav id. That is a strict superset of
// what the gate could reach (six pages against four), so the move ADDS the two
// pages the roster structurally could not judge rather than trading coverage
// for placement.
//
// What is preserved verbatim from the gate: the three finding kinds, because
// their REMEDIES differ —
//
//   drift      the bundle serves a string the source no longer says. Fix the
//              bundle (and the other locales, now stale too).
//   orphan     the bundle names a page no shipped population contains. The
//              ANTI-VACUITY half: without it, renaming a page silently reduces
//              this assertion to comparing nothing, and a parity gate that
//              cannot fail is the exact defect class #8764 is about.
//   no-source  the bundle declares a key the page has nothing to overlay — a
//              phantom key that translates nothing (ADR-0078's shape). Delete
//              the key or restore the field at the source.
//
// …and the RED-SHAPE controls the gate ran under `--self-test`, which are now
// ordinary test cases below. A verdict moved without them would be a verdict
// nobody has seen fail.

/** The component type whose `title` / `subtitle` the page bundle addresses. */
const PAGE_HEADER_COMPONENT = 'page:header';

interface PageSourceCopy {
  label?: string;
  description?: string;
  title: string[];
  subtitle: string[];
}

/**
 * The source literals a page offers, keyed the way the bundle addresses them.
 * The mapping is not invented here — it is the one `translatePage` implements
 * and `TranslationDataSchema.pages` documents:
 *
 *   pages.<name>.label       → the page document's own `label`
 *   pages.<name>.description → the page document's own `description`
 *   pages.<name>.title       → every `page:header`'s `properties.title`
 *   pages.<name>.subtitle    → every `page:header`'s `properties.subtitle`
 *
 * `title`/`subtitle` are ARRAYS because the resolver overlays every
 * `page:header` in the regions, not the first one — so parity has to hold for
 * all of them or the bundle is right about one header and wrong about another.
 */
const pageSourceCopy = (page: Record<string, any> | undefined): PageSourceCopy => {
  const headers: Array<Record<string, any>> = [];
  for (const region of page?.regions ?? []) {
    for (const component of region?.components ?? []) {
      if (component?.type === PAGE_HEADER_COMPONENT) headers.push(component?.properties ?? {});
    }
  }
  const strings = (key: string): string[] =>
    headers.map((h) => h?.[key]).filter((v): v is string => typeof v === 'string');
  return {
    label: typeof page?.label === 'string' ? page.label : undefined,
    description: typeof page?.description === 'string' ? page.description : undefined,
    title: strings('title'),
    subtitle: strings('subtitle'),
  };
};

type PageFindingKind = 'drift' | 'orphan' | 'no-source';
interface PageFinding {
  kind: PageFindingKind;
  path: string;
  source?: string;
  served?: string;
}

/**
 * Every way the default-locale `pages.*` section can disagree with the page
 * metadata it copies.
 *
 * ⚠️ `title` implements the resolver's fallback: `pages.<name>.title` defaults
 * to `pages.<name>.label` when omitted. That is not a detail — it is a real
 * drift path. A header `title` edited to differ from the page `label` would be
 * silently overwritten by the label in every locale, `en` included, with
 * nothing else in the repo comparing the two.
 */
const defaultLocalePageDrift = (
  pageTranslations: Record<string, any> | undefined,
  sourceByName: Map<string, PageSourceCopy>,
): PageFinding[] => {
  const findings: PageFinding[] = [];
  const add = (kind: PageFindingKind, path: string, source?: string, served?: string) =>
    findings.push({ kind, path, source, served });

  for (const [name, entry] of Object.entries(pageTranslations ?? {})) {
    const source = sourceByName.get(name);
    if (!source) {
      add('orphan', `pages.${name}`);
      continue;
    }

    // The page document's own fields.
    for (const attr of ['label', 'description'] as const) {
      const served = entry?.[attr];
      if (typeof served !== 'string') continue; // an undeclared key makes no claim
      if (typeof source[attr] !== 'string') { add('no-source', `pages.${name}.${attr}`, undefined, served); continue; }
      if (served !== source[attr]) add('drift', `pages.${name}.${attr}`, source[attr], served);
    }

    // The `page:header` copy.
    const explicitTitle = typeof entry?.title === 'string' ? entry.title : undefined;
    const servedTitle = explicitTitle ?? (typeof entry?.label === 'string' ? entry.label : undefined);
    const titlePath = `pages.${name}.${explicitTitle !== undefined ? 'title' : 'label'}`;
    if (servedTitle !== undefined) {
      // An explicit `title` with no header to land on is a phantom key. The
      // `label` FALLBACK is not — `label` has already been judged above against
      // the page's own field, and a page with no header title is not a page the
      // fallback makes a claim about.
      if (source.title.length === 0) {
        if (explicitTitle !== undefined) add('no-source', titlePath, undefined, explicitTitle);
      } else {
        for (const t of source.title) if (servedTitle !== t) add('drift', titlePath, t, servedTitle);
      }
    }
    const servedSubtitle = entry?.subtitle;
    if (typeof servedSubtitle === 'string') {
      if (source.subtitle.length === 0) add('no-source', `pages.${name}.subtitle`, undefined, servedSubtitle);
      else for (const s of source.subtitle) if (servedSubtitle !== s) add('drift', `pages.${name}.subtitle`, s, servedSubtitle);
    }
  }
  return findings;
};

/**
 * Every page the platform ships that the `pages.*` bundle section can address,
 * with the package that authors its literals — so a failure names where to go.
 *
 * Read from the two carriers rather than listed: the capability plugins' UI
 * bundles (all of their pages, not just the first) and the platform's own pages
 * barrel. A fourth page joins this verdict by existing.
 */
const ALL_PAGE_SOURCES: Array<{ page: Record<string, any>; authoredBy: string }> = [
  ...([
    [MARKETPLACE_INSTALLED_UI_BUNDLE, '@objectstack/cloud-connection'],
    [CLOUD_CONNECTION_UI_BUNDLE, '@objectstack/cloud-connection'],
    [CONNECT_AGENT_UI_BUNDLE, '@objectstack/mcp'],
  ] as Array<[{ pages?: Array<Record<string, any>> }, string]>).flatMap(([bundle, authoredBy]) =>
    (bundle.pages ?? []).map((page) => ({ page, authoredBy })),
  ),
  ...RECORD_PAGES.map((page) => ({ page, authoredBy: '@objectstack/platform-objects/pages' })),
];

const SOURCE_BY_NAME = new Map<string, PageSourceCopy>(
  ALL_PAGE_SOURCES.map(({ page }) => [page.name as string, pageSourceCopy(page)]),
);
const AUTHORED_BY = new Map<string, string>(
  ALL_PAGE_SOURCES.map(({ page, authoredBy }) => [page.name as string, authoredBy]),
);

describe('`pages.*` default-locale parity (#8764, moved off the nav roster by #15743)', () => {
  it('judges a population that covers every page the shipped bundle addresses', () => {
    // The anti-vacuity floor, stated before the verdict runs. A verdict over an
    // empty or shrunken population is the ambiguous `0` this whole card is
    // about: every loop below would be satisfied and report success.
    expect(SOURCE_BY_NAME.size).toBeGreaterThanOrEqual(6);
    expect([...SOURCE_BY_NAME.keys()].sort()).toEqual(
      expect.arrayContaining([
        'cloud_connection_settings',
        'connect_agent',
        'marketplace_installed',
        'sys_organization_detail',
        'sys_position_detail',
        'sys_user_detail',
      ]),
    );
    // …and it is strictly larger than what the booted nav composition reached,
    // which is the measured reason the verdict moved: `plugin-auth` cannot join
    // a NAV roster, so those two pages had no judge at all.
    expect(SOURCE_BY_NAME.has('sys_user_detail')).toBe(true);
    expect(SOURCE_BY_NAME.has('sys_organization_detail')).toBe(true);
  });

  it('holds the `en` bundle in verbatim parity with the page sources', () => {
    const enPages = pagesOf(EN);
    // Absence is loud: an `en` section that lost its entries would make the
    // verdict below compare nothing at all.
    expect(Object.keys(enPages).length).toBeGreaterThanOrEqual(6);

    const findings = defaultLocalePageDrift(enPages, SOURCE_BY_NAME).map((f) => ({
      ...f,
      authoredBy: AUTHORED_BY.get(f.path.split('.')[1]) ?? '(no page by that name)',
    }));
    expect(findings).toEqual([]);
  });

  it('carries a `pages.*` entry for every page in the population', () => {
    // The reverse of the orphan direction: the bundle must not go SILENT on a
    // page either. An unaddressed page renders its authored literal in every
    // locale, which is exactly the debt #15743 was filed for.
    const enPages = pagesOf(EN);
    const unaddressed = [...SOURCE_BY_NAME.keys()].filter((name) => !enPages[name]).sort();
    expect(unaddressed).toEqual([]);
  });

  // ── The RED-SHAPE controls. These were `--self-test` cases on the gate; a
  //    verdict moved without them is a verdict nobody has seen fail.
  const SAMPLE_PAGE = {
    name: 'marketplace_installed',
    label: 'Installed Apps',
    regions: [
      {
        name: 'header',
        components: [
          {
            type: 'page:header',
            properties: {
              title: 'Installed Apps',
              subtitle: "Marketplace packages currently installed into this runtime's kernel.",
            },
          },
        ],
      },
      { name: 'main', components: [{ type: 'marketplace:installed-list', properties: {} }] },
    ],
  };
  const SAMPLE_SOURCES = new Map([[SAMPLE_PAGE.name, pageSourceCopy(SAMPLE_PAGE)]]);
  const IN_PARITY = {
    marketplace_installed: {
      label: 'Installed Apps',
      subtitle: "Marketplace packages currently installed into this runtime's kernel.",
    },
  };

  it('CONTROL: reads the page label and the header copy out of the regions', () => {
    const copy = pageSourceCopy(SAMPLE_PAGE);
    expect({ label: copy.label, title: copy.title, subtitles: copy.subtitle.length })
      .toEqual({ label: 'Installed Apps', title: ['Installed Apps'], subtitles: 1 });
    // A bare page yields no header copy rather than throwing.
    expect(pageSourceCopy({ name: 'x' }).title).toEqual([]);
  });

  it('CONTROL: a bundle in parity reports nothing', () => {
    expect(defaultLocalePageDrift(IN_PARITY, SAMPLE_SOURCES)).toEqual([]);
  });

  it('CONTROL: a source string edited in another package is reported as drift', () => {
    const findings = defaultLocalePageDrift(
      { marketplace_installed: { ...IN_PARITY.marketplace_installed, subtitle: 'Packages installed into this kernel.' } },
      SAMPLE_SOURCES,
    );
    expect(findings.map((f) => ({ kind: f.kind, path: f.path }))).toEqual([
      { kind: 'drift', path: 'pages.marketplace_installed.subtitle' },
    ]);
    // The verdict carries BOTH strings — the whole point is that a reader can
    // see which side moved without opening two packages.
    expect({
      source: findings[0]?.source?.startsWith('Marketplace packages'),
      served: findings[0]?.served?.startsWith('Packages installed'),
    }).toEqual({ source: true, served: true });
  });

  it('CONTROL: the title fallback catches a header edited away from the label', () => {
    // The bundle declares `label` only, so `label` is what serves the header
    // title. A header title edited to differ from the page label is drift
    // NOTHING else in the repo compares.
    const headerEdited = new Map([[
      'marketplace_installed',
      pageSourceCopy({
        ...SAMPLE_PAGE,
        regions: [{
          name: 'header',
          components: [{
            type: 'page:header',
            properties: { title: 'Installed Packages', subtitle: IN_PARITY.marketplace_installed.subtitle },
          }],
        }],
      }),
    ]]);
    expect(
      defaultLocalePageDrift(IN_PARITY, headerEdited).some((f) => f.kind === 'drift' && f.source === 'Installed Packages'),
    ).toBe(true);
  });

  it('CONTROL: an entry with no page in the population is an orphan, never parity', () => {
    const findings = defaultLocalePageDrift(IN_PARITY, new Map());
    expect(findings.map((f) => ({ kind: f.kind, path: f.path }))).toEqual([
      { kind: 'orphan', path: 'pages.marketplace_installed' },
    ]);
  });

  it('CONTROL: a key the page cannot carry is a phantom key, but the label fallback is not', () => {
    const phantom = defaultLocalePageDrift(
      { marketplace_installed: { ...IN_PARITY.marketplace_installed, description: 'Anything' } },
      SAMPLE_SOURCES,
    );
    expect(phantom.some((f) => f.kind === 'no-source' && f.path.endsWith('.description'))).toBe(true);
    // …but a headerless page must raise nothing from the `label` fallback, or
    // every one of the three record pages would report a finding it cannot act
    // on: they all author `regions: []`.
    const headerless = defaultLocalePageDrift(
      { p: { label: 'P' } },
      new Map([['p', pageSourceCopy({ name: 'p', label: 'P' })]]),
    );
    expect(headerless).toEqual([]);
  });
});

describe('platform record page labels are translated in every shipped locale (#15743)', () => {
  /**
   * The debt this card was filed for: `User` / `Organization` / `Position` are
   * page-level `label`s on the three record pages, they are the ONLY keys the
   * extractor reaches on those pages (the block above pins that), and they
   * rendered English in every locale — 3 keys × 3 translated locales = 9 units.
   *
   * ⚠️ This is a coverage claim of its own, deliberately NOT a restatement of
   * the key-set assertion further up this file, which compares page-name SETS
   * and says nothing about the copy inside an entry. It is scoped to these three
   * pages: requiring every leaf of every page to differ from `en` would be a
   * different, much larger claim.
   *
   * It reads `SetupAppTranslations`, which is the SERVED bundle — the three
   * translated locales pass through `withSourceFallback` (#8765 Option B), so a
   * wrong recorded source hash would serve the English source here and red this
   * assertion rather than shipping a silent regression.
   */
  const RECORD_PAGE_NAMES = ['sys_user_detail', 'sys_organization_detail', 'sys_position_detail'];
  const TRANSLATED_LOCALES = SHIPPED_LOCALES.filter((locale) => locale !== EN);

  it('has a real, non-English label for each of the three in each translated locale', () => {
    expect(TRANSLATED_LOCALES.length).toBeGreaterThanOrEqual(3);

    const english = pagesOf(EN);
    const untranslated: Array<{ locale: string; page: string; label: unknown }> = [];
    for (const locale of TRANSLATED_LOCALES) {
      const served = pagesOf(locale);
      for (const name of RECORD_PAGE_NAMES) {
        const label = served[name]?.label;
        if (typeof label !== 'string' || label.length === 0 || label === english[name]?.label) {
          untranslated.push({ locale, page: name, label });
        }
      }
    }
    expect(untranslated).toEqual([]);
  });

  it('translates the page label end to end through `translatePage`', () => {
    // The chain the reader actually meets: page metadata in, localized label
    // out. Asserting the bundle alone would not prove the resolver reads it.
    for (const page of RECORD_PAGES) {
      // Snapshot by value up front — comparing two live reads of the same
      // object afterwards could not detect a mutation.
      const before = page.label;
      const translated = translatePage(page as any, SetupAppTranslations, { locale: 'zh-CN' });
      expect({ page: page.name, changed: translated.label !== before })
        .toEqual({ page: page.name, changed: true });
      // The shared page object is a module-level singleton the kernel
      // registers once — it must not be mutated.
      expect({ page: page.name, label: page.label }).toEqual({ page: page.name, label: before });
    }
  });
});
