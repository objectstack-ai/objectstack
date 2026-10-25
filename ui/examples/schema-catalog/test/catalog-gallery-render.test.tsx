/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4616 — EVERY catalog entry is rendered the way the docs gallery
 * renders it, and no tile may show the registry's "Unknown component type"
 * panel or the renderer's error boundary.
 *
 * ## What this generalizes
 *
 * `plugin-dashboard-gallery-render.test.tsx` (objectui#4600) pinned one
 * category. It closed the blind spot for that category and left the rest of the
 * corpus in it: `smoke.test.tsx` has no `render(` call at all (its assertions
 * are structural — every entry is an object with a non-empty `type`) and
 * `plugin-dashboard-global-filters-spec.test.ts` (objectui#4356) validates
 * `globalFilters` against the spec without rendering. Both are satisfied by an
 * entry that renders nothing but a red error box.
 *
 * Measured on `origin/main` @ `e028dfcd8`, rendering all 423 entries against
 * the gallery's registration set as it stood after #4600 — 33 entries painted
 * the OBJUI-001 panel:
 *
 *   components-form-calendar 6 (calendar)   plugin-chatbot 3 (chatbot)
 *   plugin-editor 3 (code-editor)           plugin-gantt 3 (object-gantt)
 *   plugin-map 3 (object-map)               plugin-markdown 3 (markdown)
 *   plugin-timeline 3 (timeline)            plugin-calendar 2 (calendar-view)
 *   plugin-kanban 2 (kanban)                components-complex-filter-ui 1
 *   components-complex-sort-ui 1            components-complex-view-switcher 1
 *   components-disclosure-toggle-group 1    core-schema-renderer 1
 *
 * That is the red this file was written against. `apps/site/app/components/
 * registerCatalogBlocks.ts` loads the nine further packages that census
 * resolved to — further packages have joined that list since, none of them
 * from this census (see the host file's own header) — which takes 31 of those
 * 33 tiles from the panel to a drawn
 * component. What registration cannot reach is named — never skipped silently —
 * in the tables below. Four classes were defects in the entries, one issue each:
 *
 *   objectui#4624  1 entry  names root type "single", which nothing registers
 *   objectui#4625  6 entries author the bare `calendar` keyword, which belongs
 *                          to plugin-calendar's data-bound ObjectCalendar
 *   objectui#4626  2 entries were filed as blank tiles, each authoring a key
 *                          its own renderer never reads — one of the two was
 *                          measured to be neither (see below)
 *   objectui#4627  2 entries author events in a fixed past month, outside the
 *                          window `calendar-view` paints around today
 *
 * All four are FIXED in the entries — the first three as of objectui#4624's
 * PR, #4627 as of its own — so the ten entries they covered carry the full
 * assertion set here and no longer appear in either table. What #4624 measured,
 * and corrects in this header:
 *
 *  - #4625's six now author `ui:calendar`, the namespaced key the primitive is
 *    registered under. Probed through this file's own render path before the
 *    rewrite: `type: 'ui:calendar'` resolves and paints the date-picker grid
 *    (115 elements), because `Registry.get(type)` looks the string up verbatim
 *    and `register()` stores the namespaced form as `ui:calendar`. The bare
 *    keyword still reaches `ObjectCalendar` — that is not a bug to route
 *    around, it is `skipFallback: true` working as designed.
 *  - #4626's `basic-tooltip` was a real blank tile: it authored its trigger
 *    under `children`, which the tooltip renderer never reads. Now `trigger`.
 *  - #4626's `basic-hover-card` was NOT blank and authored no unread key.
 *    Measured: the text renderer reads `schema.content || schema.value`
 *    (`packages/components/src/renderers/basic/text.tsx:35,40`), so the
 *    authored `value` WAS read and the tile drew the text node "Hover over
 *    me" — which `drewSomething` accepts, and which an element-only view of
 *    the DOM (the one the filing reports) cannot see. Its real defect was
 *    that a bare text node is not an element, so `HoverCardTrigger asChild`
 *    had nothing to attach to and the card could never open; the trigger is
 *    now a link-variant button, the shape the renderer's own `defaultProps`
 *    declare. Removing its exclusion turns nothing red — verified by removing
 *    it BEFORE touching the entry.
 *
 * DATASOURCE_REQUIRED stays asserted, for the reason #4625 first supplied:
 * registering a package is not the same as a tile drawing, and a pin naming
 * only OBJUI-001 would have reported those six as fixed. It is now a
 * regression guard — an entry sliding back to the bare `calendar` keyword
 * fails on that string rather than on the panel.
 *
 * Six further entries are not rendered here at all, for reasons that are limits
 * of the environment rather than defects in anything: `plugin-editor`'s three
 * mount Monaco and `plugin-map`'s three mount maplibre, which between them want
 * a CDN loader script, WebGL2, and a live third-party tile host. The exclusion
 * table says why for each; what stays pinned for both buckets is the thing
 * objectui#4616 actually changed — that their types resolve — asserted in the
 * control case below.
 *
 * ## Why the module-scope package imports
 *
 * `ComponentRegistry` only knows a type once the package owning it has loaded,
 * so this file mirrors exactly what the gallery host registers, in the same
 * order — several packages claim the same bare keyword (`chart`, `calendar`)
 * and the last registration wins, so a reordered mirror would not be a mirror.
 * The last case in this file reads the host and fails if the two lists drift.
 *
 * ## What is asserted, per entry
 *
 * None of the three diagnostics — all three, for every entry: there are no
 * per-entry diagnostic exemptions left — and, the non-vacuity half, since an
 * entry that renders nothing at all trivially satisfies all three, the tile
 * actually produced DOM or text of its own. That control is not decoration: it
 * is what found objectui#4626's blank tooltip tile, which no red-tile sweep can
 * see. Note what it deliberately does NOT claim: text alone satisfies it, so a
 * tile drawing a bare text node passes — correctly, since `components-basic-
 * text/*` are exactly that. `basic-hover-card` is the case that proves the
 * distinction matters in both directions (see the header). For
 * the categories objectui#4616 newly registered, a stronger positive control on
 * top: the titles the entry itself authors are on screen
 * (`AUTHORED_TEXT_EXEMPT` records any that cannot be asserted that way, with
 * the reason — it is empty as of objectui#4627, and every entry in those
 * categories carries the control).
 *
 * The diagnostic strings are COPIED as literals rather than imported from the
 * packages' internals, for the reason objectui#4600 gave: they are
 * user-visible contract for this pin, and a reworded panel should turn it red
 * for review rather than silently follow along.
 *
 * `role="alert"` is deliberately NOT asserted category-wide the way #4600
 * asserts it for dashboards. Measured: `components-data-display-alert`'s two
 * entries render `role="alert"` because that is what an Alert IS — the
 * assertion is correct for a dashboard tile and wrong for the corpus.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@object-ui/components';
// Mirrors apps/site/app/components/registerCatalogBlocks.ts, in its order.
import '@object-ui/plugin-dashboard';
import '@object-ui/plugin-charts';
import '@object-ui/plugin-calendar';
import '@object-ui/plugin-chatbot';
import '@object-ui/plugin-editor';
import '@object-ui/plugin-gantt';
import '@object-ui/plugin-kanban';
import '@object-ui/plugin-map';
import '@object-ui/plugin-markdown';
import '@object-ui/plugin-timeline';
import '@object-ui/plugin-view';
import '@object-ui/plugin-form';
import '@object-ui/plugin-grid';
import { SidebarProvider } from '@object-ui/components';
import { registerLayout } from '@object-ui/layout';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererContext, toRenderableSchema } from '@object-ui/react';
import fs from 'node:fs';
import path from 'node:path';
import { allExamples } from '../src/index.js';

/**
 * The repo root, derived from THIS FILE's own location — never from
 * `process.cwd()` (objectui#7799, and the gate that closed the class,
 * objectui#8953).
 *
 * What stood at the read sites below was `path.join(process.cwd(), …)`
 * under the comment "`process.cwd()` is the repo root by construction:
 * `scripts/vitest-invocation-guard.mjs` refuses any run whose Vitest root is
 * not it". THAT PREMISE IS FALSE. The guard rejects a run whose VITEST root is
 * not the repo root; this package's own `test` script — `vitest run --root ../..
 * examples/schema-catalog/`, which is what `pnpm --filter … test` and
 * `turbo run test` both run — sets that root correctly while leaving
 * `process.cwd()` in the package directory. The guard passes and the cwd is the
 * package, so `apps/site/app/components` resolved to a path that does not
 * exist and every read below threw.
 *
 * Spelled in string operations, copying the landed precedent of objectui#7791
 * (PR #7796) and objectui#7799 (PR #7806): only BARE `import.meta.url` is read
 * here and taken apart by hand.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 4; // examples / schema-catalog / test / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');
// Plain-JS CI helper; types are inferred from the `.mjs` source (`allowJs`), the
// same route `scripts/__tests__/known-schema-types-derivation-5115.test.ts`
// takes. objectui#6024 reuses this derivation rather than re-deriving: a second
// copy of "which package registers which key" is the enumeration this pin
// exists to stop keeping by hand.
import { deriveRegistryKeys } from '../../../scripts/check-doc-component-types.mjs';

registerLayout();

/** The registry's panel for a type no loaded package registers (OBJUI-001). */
const UNKNOWN_COMPONENT = 'Unknown component type';
/** `SchemaRenderer`'s error boundary (packages/react/src/SchemaRenderer.tsx). */
const FAILED_TO_RENDER = 'failed to render';
/**
 * The data-bound plugins' guard when the host supplies no data source
 * (`ObjectCalendar.tsx`, `ObjectGantt.tsx`, `ObjectMap.tsx` all throw it).
 * Asserted alongside the other two because registering a package is not the
 * same as the tile drawing: `components-form-calendar/*` used to trade the
 * OBJUI-001 panel for exactly this string, and a pin that named only the panel
 * would have reported those six as fixed. They now author `ui:calendar` and
 * draw the primitive, so this string is what would catch them sliding back to
 * the bare keyword.
 */
const DATASOURCE_REQUIRED = 'DataSource required for the object provider';

const ALL_DIAGNOSTICS = [UNKNOWN_COMPONENT, FAILED_TO_RENDER, DATASOURCE_REQUIRED];

/**
 * The placeholder every `@object-ui/plugin-form` container paints while it
 * fetches (`ObjectForm`'s `t('publicForm.loading')` line, and the same key in
 * `TabbedForm`, `SplitForm`, `WizardForm`, `DrawerForm`). NOT a diagnostic — it
 * is a frame on the way to the tile — but `renderEntry` has to settle past it,
 * so it is a literal here, as the three above are.
 *
 * ⚠️ The wait below is NEGATIVE (`not.toContain`), so a reworded placeholder
 * does not turn a whole-file run red: the wait just passes at once, and the
 * frame is no longer waited for. So this literal has to move with the string
 * by hand, as it did when objectui#11039 made the placeholder the `en` pack's
 * `publicForm.loading` (U+2026 in place of three full stops). This file mounts
 * no i18n provider, so the containers render their English defaults table,
 * which `pnpm check:i18n-keys` holds byte-identical to the `en` pack.
 */
const FORM_LOADING = 'Loading form…';

/** The packages the gallery host must load, in the host's own order. */
const HOST_PACKAGES = [
  '@object-ui/plugin-dashboard',
  '@object-ui/plugin-charts',
  '@object-ui/plugin-calendar',
  '@object-ui/plugin-chatbot',
  '@object-ui/plugin-editor',
  '@object-ui/plugin-gantt',
  '@object-ui/plugin-kanban',
  '@object-ui/plugin-map',
  '@object-ui/plugin-markdown',
  '@object-ui/plugin-timeline',
  '@object-ui/plugin-view',
  '@object-ui/plugin-form',
  '@object-ui/plugin-grid',
];

/**
 * Entries this pin does NOT hold to the no-red-tile rule, each with the reason
 * it is not a registration defect. Named here rather than skipped silently:
 * an exclusion that stops being true should be visible to the next reader, and
 * the case below fails if an id here no longer exists.
 */
const EXCLUSIONS: Record<string, string> = {
  'core-schema-renderer/unknown-component-type':
    'Demonstrates the OBJUI-001 panel on purpose — the panel IS the example.',
  // The three below are an ENVIRONMENT limit, not a defect in the entries.
  // Rendering `code-editor` mounts `@monaco-editor/react`, which appends its
  // loader as a `script` tag pointing at a CDN. happy-dom cannot fetch it and
  // dispatches a resource-load `error` event, which Vitest reports as an
  // unhandled error and exits non-zero on — while every assertion in the file
  // passes (measured: 2534/2534 tests green, 4 unhandled errors, exit 1).
  // `packages/plugin-editor/src/index.test.ts` reached the same place first and
  // settled it the same way: that suite asserts registration and metadata and
  // never renders, with a header explaining Monaco's cost. So what is pinned
  // for this bucket is `ComponentRegistry.get('code-editor')` in the control
  // case above — which IS what objectui#4616 changed for it.
  'plugin-editor/javascript-editor': "Monaco's CDN loader cannot run under happy-dom.",
  'plugin-editor/python-editor': "Monaco's CDN loader cannot run under happy-dom.",
  'plugin-editor/read-only-json-viewer': "Monaco's CDN loader cannot run under happy-dom.",
  // The three below are the same class as Monaco, one layer worse. Rendering
  // `object-map` mounts maplibre, which (a) refuses to initialise without WebGL2
  // — "WebGL2 is required to display this map", GPUInitializationError, verbatim
  // from the run — and then trips `SchemaRenderer`'s error boundary tearing its
  // own painter down, and (b) fetches its style sheet from
  // `https://demotiles.maplibre.org` over the real network. (b) is the reason
  // this is an exclusion rather than a narrowed assertion: a unit test that
  // reaches a third-party host is nondeterministic and makes CI depend on that
  // host being up, whatever it asserts. All five of `packages/plugin-map`'s own
  // test files reach the same conclusion and `vi.mock('react-map-gl/maplibre')`;
  // this pin renders the gallery's real stack, so it cannot mock and must
  // abstain instead. `ComponentRegistry.get('object-map')` in the control case
  // is what stays pinned — and that IS what objectui#4616 changed here.
  'plugin-map/event-venue-finder': 'maplibre needs WebGL2 and a live tile host.',
  'plugin-map/real-time-delivery-tracking': 'maplibre needs WebGL2 and a live tile host.',
  'plugin-map/store-locator-map': 'maplibre needs WebGL2 and a live tile host.',
};

/**
 * Categories objectui#4616 newly registered a package for. These get the
 * stronger positive control — the entry's own authored strings on screen —
 * because they are the ones whose tiles were red before this change, and
 * "no longer red" must not be satisfiable by a tile that draws nothing.
 */
const NEWLY_REGISTERED_CATEGORIES = [
  'components-complex-filter-ui',
  'components-complex-sort-ui',
  'components-complex-view-switcher',
  'plugin-calendar',
  'plugin-chatbot',
  'plugin-editor',
  'plugin-gantt',
  'plugin-kanban',
  'plugin-map',
  'plugin-markdown',
  'plugin-timeline',
];

/**
 * Entries in those categories whose authored titles provably cannot reach the
 * DOM. Each would still carry the full no-red-tile assertion and the
 * DOM-was-produced control above; only the authored-title control is lifted,
 * with the measured reason.
 *
 * EMPTY, and that is the assertion: every entry in the newly-registered
 * categories now puts its own authored titles on screen. The table held
 * `plugin-calendar`'s two until objectui#4627 — `calendar-view` paints the
 * window around `currentDate`, which defaults to TODAY, and both entries
 * authored events in a fixed past month, so no event title could ever be in
 * range (measured on a 2026-08-14 run: the tiles drew "August 2026" and
 * "Aug 9 - Aug 15, 2026" around an empty grid). That was a staleness question
 * about the entries' data, not a render defect: both already drew a real
 * calendar, 163 and 421 elements. Both entries now author `currentDate` — the
 * registry input `calendar-view` declares, parsed from its documented ISO
 * string at the renderer boundary since objectui#4452 — pinning each view onto
 * its own events, so the exemption is gone rather than reworded.
 *
 * (`plugin-editor`'s and `plugin-map`'s six are absent from this table because
 * they are not rendered here at all — see `EXCLUSIONS`.)
 */
const AUTHORED_TEXT_EXEMPT: Record<string, string> = {};

/**
 * The gallery's data source, in the shape `SchemaThumbnail` supplies it. Kept
 * as a local literal rather than imported from `apps/site` because `apps/**` is
 * outside every root Vitest project (`vitest.config.mts` `sharedExclude`); the
 * host-parity cases at the end guard the two from drifting apart.
 *
 * objectui#5113 added the object surface (`getObjectSchema` / `find` / the
 * writes) to the host fixture, because `object-view` reaches its data through
 * exactly this context value — `dataSource` is not a schema key. The same is
 * true of `object-grid`, which is how objectui#5856 could give `plugin-grid`
 * real entries without touching the fixture at all. Both categories' entries
 * render through it, which is what `CATEGORY_OWN_TYPE` below asserts. What the
 * mirror reproduces is the host's SURFACE and its rows; the query semantics
 * ($search / $orderby / windowing) are the host's, and the parity case pins the
 * method names rather than re-deriving them here.
 *
 * objectui#6317 widened that guard where it had to be widened. Pinning method
 * NAMES left the field declarations unwatched, and they drifted: the host
 * declared `options` on `role` / `status` in `4b0b12630` and this schema did
 * not follow for 330 commits, with every case in this file green throughout.
 * The `USERS_SCHEMA` below is now compared to the host's WHOLE, options
 * included — see the #6317 cases at the end of this file.
 */
const USERS_ROWS = [
  { id: '1', name: 'Alice Johnson', email: 'alice@example.com', role: 'admin', department: 'Engineering', status: 'active', created_at: '2024-01-14' },
  { id: '2', name: 'Bob Chen', email: 'bob@example.com', role: 'member', department: 'Design', status: 'active', created_at: '2024-02-03' },
  { id: '3', name: 'Carla Gómez', email: 'carla@example.com', role: 'member', department: 'Sales', status: 'invited', created_at: '2024-03-21' },
  { id: '4', name: 'Dan Whitfield', email: 'dan@example.com', role: 'viewer', department: 'Support', status: 'suspended', created_at: '2024-04-09' },
  { id: '5', name: 'Emily Novak', email: 'emily@example.com', role: 'member', department: 'Engineering', status: 'active', created_at: '2024-05-30' },
];

const USERS_SCHEMA = {
  name: 'users',
  label: 'Users',
  fields: {
    name: { label: 'Name', type: 'text' },
    email: { label: 'Email', type: 'email' },
    role: {
      label: 'Role',
      type: 'select',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Member', value: 'member' },
        { label: 'Viewer', value: 'viewer' },
      ],
    },
    department: { label: 'Department', type: 'text' },
    status: {
      label: 'Status',
      type: 'select',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Invited', value: 'invited' },
        { label: 'Suspended', value: 'suspended' },
      ],
    },
    created_at: { label: 'Created', type: 'date' },
  },
};

const galleryDataSource = {
  queryDataset: async (
    _dataset: string,
    query: { dimensions?: string[]; measures?: string[] },
  ) => {
    const dimensions = query?.dimensions ?? [];
    const measures = query?.measures ?? [];
    const measure = measures[0] ?? 'value';
    const rows = dimensions.length
      ? [
          { [dimensions[0]]: 'Alpha', [measure]: 42 },
          { [dimensions[0]]: 'Beta', [measure]: 27 },
        ]
      : [{ [measure]: 69 }];
    return { rows, fields: [] };
  },
  getObjectSchema: async (objectName: string) =>
    objectName === 'users' ? USERS_SCHEMA : { name: objectName, label: objectName, fields: {} },
  find: async (objectName: string) =>
    objectName === 'users'
      ? { data: [...USERS_ROWS], total: USERS_ROWS.length }
      : { data: [], total: 0 },
  findOne: async (objectName: string, id: string | number) =>
    (objectName === 'users' ? USERS_ROWS : []).find((row) => String(row.id) === String(id)) ?? null,
  create: async (_objectName: string, data: Record<string, unknown>) => ({ ...data, id: 'demo' }),
  update: async (_objectName: string, id: string | number, data: Record<string, unknown>) => ({ ...data, id }),
  delete: async () => true,
};

/** The method names the host fixture must expose for the mirror to be one. */
const GALLERY_DATA_SOURCE_METHODS = [
  'queryDataset',
  'getObjectSchema',
  'find',
  'findOne',
  'create',
  'update',
  'delete',
];

/** The two wrapper elements this harness adds around the entry's own root. */
const WRAPPER_ELEMENTS = 2;

interface Rendered {
  text: string;
  elements: number;
  /**
   * The values of the tile's form controls. `textContent` cannot see them, and
   * for a FORM that is exactly where the data it was given ends up — see
   * `carriesFixtureRecord` below.
   */
  controlValues: string[];
  unmount: () => void;
}

/**
 * Did the tile draw anything of its own? Elements OR text, because both are
 * real: a `text` node that authors neither `variant`, `align`, `className` nor a
 * designer id renders as a bare text node with no element around it (measured —
 * `components-basic-text/simple-text` puts "Hello, World!" directly in the
 * wrapper), so an element-count-only control reads correct tiles as empty. Since
 * objectui#6942 the variant-carrying entries in that category DO wrap, but the
 * unadorned ones — here and in every other category — still do not.
 */
const drewSomething = (elements: number, text: string) =>
  elements > WRAPPER_ELEMENTS || text.trim().length > 0;

/** Render one entry exactly as `SchemaThumbnail` does, then let it settle. */
async function renderEntry(schema: unknown): Promise<Rendered> {
  const { container, unmount } = render(
    <SchemaRendererContext.Provider value={{ dataSource: galleryDataSource } as never}>
      <SidebarProvider className="min-h-0 w-full" defaultOpen={false}>
        <div className="w-full p-4">
          <SchemaRenderer
            schema={toRenderableSchema(schema as never) as never}
            dataSource={galleryDataSource as never}
          />
        </div>
      </SidebarProvider>
    </SchemaRendererContext.Provider>,
  );
  // Two settles, for two different asynchronous shapes:
  //  - a dataset widget starts in `loading` and resolves on a promise;
  //  - `code-editor`, `kanban` and `markdown` are `React.lazy` behind
  //    `Suspense`, so their first paint is the fallback and their real DOM
  //    arrives one dynamic import later.
  // Asserting before either settles would pass while the diagnostic is still a
  // tick away — the vacuous green this pin exists to prevent.
  await waitFor(() =>
    expect(container.querySelector('[data-testid="dataset-loading"]')).toBeNull(),
  );
  await waitFor(() =>
    expect(
      drewSomething(container.querySelectorAll('*').length, container.textContent ?? ''),
    ).toBe(true),
  );
  // A third shape (objectui#6167), and the one that makes the two above
  // insufficient: a data-bound form holds its first paint behind
  // `Loading form…` while it fetches the object schema and the record. That
  // placeholder is 5 elements of real DOM, so `drewSomething` accepts it — and
  // every assertion after it would then be measured against a frame that was
  // never the tile. Measured: without this wait the `plugin-form` entries'
  // DATA-provenance cases PASS in a whole-file run (the 570 renders before them
  // leave the promises resolved) and FAIL when the file is run with `-t`, which
  // is the definition of a reading that is not a measurement.
  await waitFor(() => expect(container.textContent ?? '').not.toContain(FORM_LOADING));
  return {
    text: container.textContent ?? '',
    elements: container.querySelectorAll('*').length,
    controlValues: Array.from(
      container.querySelectorAll('input, textarea, select'),
    ).map((el) => (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value ?? ''),
    unmount,
  };
}

/**
 * `object-map` tears maplibre down through a GL context that happy-dom never
 * gave it, so unmount throws `Cannot read properties of undefined (reading
 * 'destroy')` for those three entries. Swallowed HERE, at teardown only, so it
 * cannot mask anything the assertions above already read off the settled DOM —
 * and done explicitly so RTL's auto-cleanup does not hit it later, out of band,
 * where it would surface as an unattributable error on some other file.
 */
function teardown(r: Rendered) {
  try {
    r.unmount();
  } catch {
    /* environment-only; see the comment above */
  }
}

/**
 * Authored TITLES at any depth — the same key objectui#4600 used for dashboard
 * widgets, generalized. Deliberately only `title`:
 *  - `label` also names the options inside a filter/sort config, which are not
 *    on screen until a row is added (measured: `components-complex-filter-ui/
 *    filter-ui` renders "Filters" and authors Name/Status/Open/Closed);
 *  - `content` on a markdown block is markdown SOURCE, whose rendered form is
 *    deliberately not the source text.
 * Both would make this control fail on tiles that are drawing correctly.
 */
function authoredTitles(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) authoredTitles(n, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (
        k === 'title' &&
        typeof v === 'string' &&
        v.trim().length > 1 &&
        // Template expressions resolve against data this corpus does not ship.
        !v.includes('{{') &&
        !v.includes('${')
      ) {
        acc.push(v.trim());
      }
      authoredTitles(v, acc);
    }
  }
  return acc;
}

const entries = allExamples();
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/* ────────────────────────────────────────────────────────────────────────────
 * objectui#7307 — this file's `/api/v1/security/explain` escape, served here.
 *
 * Nothing below asks for a security verdict, yet every run opened a REAL TCP
 * connection to `http://localhost:3000`. Traced with a stack probe on the
 * network-escape guard's attribution point:
 *
 *   the grid-bearing tiles (`object-grid`, and `object-view` around it)
 *     -> ObjectGrid             packages/plugin-grid/src/ObjectGrid.tsx:1407
 *       -> useRecordCrudVerdicts  packages/plugin-grid/src/hooks/useRecordCrudVerdicts.ts:199
 *         -> `const doFetch = apiFetch ?? fetch`      <- the escape
 *           POST /api/v1/security/explain  (batched, `recordIds` per page)
 *
 * The hook reads the host's AUTHENTICATED `apiFetch` off
 * `SchemaRendererContext` and, with no host supplying one, degrades to the
 * GLOBAL `fetch` by design — a standalone embed must keep rendering rather than
 * crash. Under happy-dom that global is a real HTTP client and the document URL
 * defaults to `http://localhost:3000`, so the relative path resolved to a live
 * request. The gallery harness below supplies a `dataSource` on `SchemaRendererContext` but no `apiFetch`, so the fallback is taken. The read is best-effort (a network or parse failure leaves the verdict map empty — fail open), which is why the sweep stayed green while 18 requests per run always failed.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on and
 * `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx`
 * carries. Deliberately NOT a blanket network stub: it records every URL it is
 * handed and `afterEach` fails on any URL that is not the explain route, so an
 * escape to somewhere else reds here instead of vanishing into that `catch`.
 *
 * What it answers, and why that changes no assertion here: the permissive
 * verdict, in the two response shapes the two hooks read (ADR-0090 D6 /
 * ADR-0095 C2) — `{ record: { visible } }` for a single `recordId`,
 * `{ records: [{ recordId, visible }] }` for a batched `recordIds`.
 * `useRecordEditable` initialises `allowed` to `true` and its failure path
 * leaves it there, and the ONLY consumer of the batched lookup is
 * `resolveRowRecordCrudAffordance`, whose rule is `recordVerdict !== false` —
 * so `true` and the absent verdict the failing request produced are the same
 * value at every read site. This file asserts that each tile drew something other than a diagnostic panel; no tile's DOM is derived from the verdict.
 * ──────────────────────────────────────────────────────────────────────────── */

const EXPLAIN_ROUTE = '/api/v1/security/explain';

/** Every URL this render handed the global `fetch`, in request order. */
let explainCalls: string[] = [];

/** Serve `POST /api/v1/security/explain` permissively; record everything. */
function installExplainDouble() {
  explainCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      explainCalls.push(url);
      if (url !== EXPLAIN_ROUTE) return { ok: false, status: 404, json: async () => ({}) };
      let body: { recordId?: unknown; recordIds?: unknown } = {};
      try {
        body = JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? '{}'));
      } catch {
        /* a non-JSON body is not a request this route can answer */
      }
      const recordIds = Array.isArray(body.recordIds) ? body.recordIds : null;
      return {
        ok: true,
        status: 200,
        json: async () =>
          recordIds
            ? { records: recordIds.map((recordId) => ({ recordId, visible: true })) }
            : { record: { visible: true } },
      };
    }),
  );
}

beforeEach(() => {
  installExplainDouble();
});

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into the hook's best-effort `catch`.
  expect(explainCalls.filter((url) => url !== EXPLAIN_ROUTE)).toEqual([]);
  // Unmount BEFORE restoring the real `fetch`. Vitest runs `afterEach` hooks in
  // reverse registration order, so this file's teardown runs before the root
  // setup's RTL cleanup: unstubbing first would leave the tree mounted with the
  // real global back in place, and a verdict effect settling in that window
  // escapes again (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#4616 — every catalog entry renders in the docs gallery', () => {
  /**
   * NON-VACUITY CONTROL for the sweep as a whole. `it.each([])` reports nothing
   * rather than failing, and every root type resolving to the red panel would
   * still leave each per-entry case asserting over a string — so pin the corpus
   * size and the registration set the sweep depends on.
   */
  it('the corpus is populated and every package the census needs is loaded', () => {
    expect(entries.length).toBeGreaterThanOrEqual(423);
    // One type per package below, chosen as the one the census actually needed.
    for (const type of [
      'dashboard',
      'chart',
      'calendar-view',
      'chatbot',
      'code-editor',
      'object-gantt',
      // ⚠️ `'kanban'` until objectui#8802 retired the bare node type key
      // (maintainer ruling 2026-09-09); `object-kanban` is the surviving key
      // that this package's registration now publishes, and it is what the
      // census needs from `@object-ui/plugin-kanban`.
      'object-kanban',
      'object-map',
      'markdown',
      'timeline',
      'filter-ui',
      'sort-ui',
      'view-switcher',
    ]) {
      expect(ComponentRegistry.get(type), `${type} is not registered`).toBeTruthy();
    }
  });

  it('every exclusion still names a real entry', () => {
    const ids = new Set(entries.map((e) => e.id));
    for (const id of [...Object.keys(EXCLUSIONS), ...Object.keys(AUTHORED_TEXT_EXEMPT)]) {
      expect(ids.has(id), `${id} is excluded but no longer exists in the catalog`).toBe(true);
    }
  });

  it.each(entries.filter((e) => !EXCLUSIONS[e.id]).map((e) => [e.id, e.schema] as const))(
    '%s renders without a red tile',
    async (id, schema) => {
      const r = await renderEntry(schema);
      try {
        for (const diagnostic of ALL_DIAGNOSTICS) {
          expect(r.text, `${id} shows "${diagnostic}"`).not.toContain(diagnostic);
        }
        // Positive control: the tile drew something of its own.
        expect(drewSomething(r.elements, r.text)).toBe(true);
      } finally {
        teardown(r);
      }
    },
  );

  it.each(
    entries
      .filter(
        (e) =>
          NEWLY_REGISTERED_CATEGORIES.includes(e.meta.category) &&
          !EXCLUSIONS[e.id] &&
          !AUTHORED_TEXT_EXEMPT[e.id],
      )
      .map((e) => [e.id, e.schema] as const),
  )('%s puts its authored content on screen', async (_id, schema) => {
    const r = await renderEntry(schema);
    try {
      const titles = [...new Set(authoredTitles(schema))];
      if (titles.length > 0) {
        // Same control objectui#4600 applies to dashboard widget titles.
        expect(titles.filter((t) => !r.text.includes(t))).toEqual([]);
      } else {
        // Entries in these categories that author no `title` at all —
        // `filter-ui`, `sort-ui`, `view-switcher`, `markdown` — still have to
        // paint text of their own rather than an empty frame.
        expect(r.text.trim().length).toBeGreaterThan(0);
      }
    } finally {
      teardown(r);
    }
  });

  /**
   * The same facts as COUNTS, so a regression reports "3 entries across
   * plugin-gantt and plugin-timeline" rather than one failing entry at a time —
   * and so the numbers in this file's header stay measured numbers.
   */
  it('the whole corpus produces zero unknown-type panels and zero error tiles', async () => {
    const counts: Record<string, number> = {
      [UNKNOWN_COMPONENT]: 0,
      [FAILED_TO_RENDER]: 0,
      [DATASOURCE_REQUIRED]: 0,
    };
    const broken: string[] = [];
    for (const entry of entries) {
      if (EXCLUSIONS[entry.id]) continue;
      const r = await renderEntry(entry.schema);
      const hits: string[] = [];
      for (const diagnostic of ALL_DIAGNOSTICS) {
        const n = occurrences(r.text, diagnostic);
        counts[diagnostic] += n;
        if (n) hits.push(`${diagnostic} x${n}`);
      }
      teardown(r);
      if (hits.length) broken.push(`${entry.meta.category} :: ${entry.id}: ${hits.join(', ')}`);
    }
    expect({ ...counts, broken }).toEqual({
      [UNKNOWN_COMPONENT]: 0,
      [FAILED_TO_RENDER]: 0,
      [DATASOURCE_REQUIRED]: 0,
      broken: [],
    });
  }, 120000);

  /**
   * HOST PARITY (source-text guard, deliberately not behavioural).
   *
   * Everything above mirrors the gallery: the same registration set, in the
   * same order, with the same dataset-capable `dataSource`. It cannot mirror it
   * by construction — `apps/**` is outside every root Vitest project — so
   * deleting a package from the host would leave this file green while
   * `/docs/guide/schema-catalog` went back to painting red panels. This case
   * reads the host and pins what the sweep assumes about it.
   */
  describe('the docs-site gallery host registers the same set', () => {
    // Rooted at this file, never at the cwd — see `REPO_ROOT` above.
    const siteDir = path.join(REPO_ROOT, 'apps/site/app/components');
    const read = (f: string) => fs.readFileSync(path.join(siteDir, f), 'utf8');

    it('loads every package this pin loads, in this pin’s order', () => {
      const source = read('registerCatalogBlocks.ts');
      const imported = [...source.matchAll(/^import\s+'(@object-ui\/[^']+)';$/gm)].map(
        (m) => m[1],
      );
      expect(imported).toEqual(HOST_PACKAGES);
    });

    it('is imported by the gallery thumbnail host', () => {
      expect(read('SchemaThumbnail.tsx')).toMatch(
        /^import\s+'\.\/registerCatalogBlocks';$/m,
      );
    });

    /**
     * The objectui#4600 separation, restated because objectui#4616 is exactly
     * the change that would tempt someone to collapse it: the per-page demo
     * hosts opt into their plugins through `PluginLoader`, and importing this
     * module from them would make every docs page carrying a demo load every
     * graph in that list eagerly.
     */
    it.each(['InteractiveDemo.tsx', 'LiveSplitDemo.tsx'])(
      '%s still does NOT import it (PluginLoader stays lazy there)',
      (host) => {
        expect(read(host)).not.toContain('registerCatalogBlocks');
      },
    );
  });
});

/**
 * EVERY `plugin-*` CATEGORY'S ENTRIES ACTUALLY USE THEIR PLUGIN
 * (objectui#5113 for `plugin-view`, objectui#5856 for `plugin-grid`,
 * objectui#6024 for the generalization to all thirteen).
 *
 * The sweep above answers "does every tile draw". It cannot answer the question
 * objectui#5113 was filed on: whether an example mounted under a PLUGIN's docs
 * page exercises that plugin. Two categories failed it in exactly the same way,
 * one card apart. `plugin-view`'s three entries used to be hand-built static
 * card layouts — `card` / `flex` / `text` / `badge`, no `object-view` node
 * anywhere — sitting on `content/docs/plugins/plugin-view.mdx` under an
 * "Interactive Examples" heading and inside a `PluginLoader plugins={['view']}`
 * wrapper none of them used. `plugin-grid`'s two were the same defect on
 * `content/docs/plugins/plugin-grid.mdx`. Every check in the repo was green on
 * all five: the types they named ARE registered (`check-doc-component-types`
 * asks only that), and the tiles DID draw (the sweep above asks only that).
 * Neither gate can see this defect, which is why this one exists.
 *
 * ## The two halves, and which entries carry which
 *
 * The card that generalized this named the hazard it had to avoid, and it is
 * the reason the classification below is COUNTED rather than implied: a pin
 * turned on for thirteen categories that silently applies only its cheap half
 * to eleven of them is WORSE than the honest two-category pin it replaced —
 * the coverage number goes up, the assurance goes down, and the number is what
 * gets quoted. So every entry's tier is derived, printed by
 * `it('states its own coverage split…')`, and pinned there as a literal that a
 * new category or a re-tiered entry turns red.
 *
 *  1. STRUCTURE (every entry) — the entry authors a node whose `type` is in the
 *     set its OWN package registers.
 *  2. MOUNT (every entry) — that node sits where the renderer actually paints.
 *     Measured by substitution: replace every own-type node with an inert probe
 *     and re-render; the probe's marker has to reach the DOM. This is the half
 *     that generalizes objectui#5113's RENDER assertion, and it is the answer
 *     to the specific hole in STRUCTURE — a STRAY node. A `type` that is not a
 *     node at all (a field's `type: 'select'`, a validation rule's
 *     discriminant), a node under a branch the parent never renders, or one
 *     behind a satisfied `hidden` expression all satisfy STRUCTURE and all fail
 *     MOUNT.
 *  3. DATA PROVENANCE (only entries that bind to an object the gallery fixture
 *     serves) — the tile shows a record that exists ONLY in the gallery's data
 *     source, so the rows on screen came through the registered renderer →
 *     `dataSource.find`, not out of the entry's own JSON. This is
 *     objectui#5113's original second fact, unweakened.
 *
 * ## What "shows a record" means, after objectui#6167
 *
 * The provenance token is looked for in the tile's TEXT **and** in the values
 * of its form CONTROLS, because those are two different places the same fact
 * lands. A grid puts a row into text; a form puts the record into
 * `input.value`, which `textContent` cannot see. Measured on the `plugin-form`
 * entries this card added: `Alice Johnson` arrives as the value of
 * `input[name]`, while the whole tile's text reads
 * `NameEmailDepartmentCancelSave changes`. A text-only reading would have
 * called a correctly bound form unbound — the blind-instrument failure, on the
 * very half that does the work.
 *
 * The widening is a SUPERSET of the old reading, so it cannot turn a red entry
 * green by relaxing anything; and `it('the provenance instrument still fails
 * on a surface with no record behind it')` below is the control that it still
 * discriminates — the same renderer in `create` mode paints the same controls
 * with nothing in them, and fails.
 *
 * (3) is the strongest of the three and it does NOT generalize, for a reason
 * that is a property of the entries rather than a gap in this file: the other
 * eleven categories author their data INLINE (`data`, `staticData`, `messages`,
 * `columns`, `content`), so there is no record that could only have come from
 * the fixture. Measured, entry by entry, on this card's merge-base: exactly the
 * five `plugin-view` / `plugin-grid` entries author `objectName` at all. Rather
 * than declare that in a table, `DATA_BOUND` is derived from each entry's own
 * JSON against the fixture's own object names — a category that becomes
 * object-bound picks the half up with no edit here, and one that loses it moves
 * the printed split and turns the summary red.
 *
 * ## What MOUNT does and does not claim
 *
 * It claims the entry's own-plugin node occupies a painted position in the
 * tile. It does not claim the plugin's renderer produced any particular pixel:
 * that is what (3) claims where it applies. Two weaker formulations were built
 * and MEASURED before being rejected, both as "the live tile shows content the
 * probe-substituted tile does not":
 *
 *   - by TEXT: `plugin-charts` renders recharts into a container that happy-dom
 *     gives zero size, so two of its three tiles paint no text at all
 *     (`advanced-line-chart`, `simple-bar-chart` — 0 new tokens against the
 *     probe render). The assertion would be red on entries that are correct.
 *   - by ELEMENT COUNT: same two tiles measured 3 elements live against 3
 *     probe-substituted, i.e. no margin at all, and the `React.lazy` categories
 *     (`kanban`, `markdown`, `code-editor`) make the count depend on whether
 *     the dynamic import has landed.
 *
 * A discriminator that is red on correct entries gets the gate deleted, so the
 * honest claim is the one asserted, and the split says how far it goes.
 *
 * ## The map is DERIVED from the `register()` calls, never enumerated
 *
 * A hard-coded `category → type` table is the same enumeration the `register()`
 * calls already own, and it rots the first time a plugin renames a type. So
 * `CATEGORY_OWN_TYPES` comes out of `deriveRegistryKeys` — the same derivation
 * `scripts/check-doc-component-types.mjs` runs for its own universe and
 * `scripts/regenerate-known-schema-types.mjs` for its generated list — keyed by
 * the `packages/<dir>/…` site each key was registered from. Catalog category
 * and package directory are the same string (`plugin-view` ↔
 * `packages/plugin-view`), which is what makes the join a derivation rather
 * than a second table.
 *
 * That it is a derivation is not a claim to take on trust — the rot it exists
 * to prevent had ALREADY happened by the time it was written. The card that
 * asked for this carried a hand-written table reading `plugin-form  form`, and
 * measured against the register calls that is wrong: `form` is registered by
 * `packages/components/src/renderers/form/form.tsx`, not by
 * `@object-ui/plugin-form`, whose own keys are `object-form`,
 * `embeddable-form`, `form-analytics` and `object-master-detail-form`. The two
 * `plugin-form` entries were therefore the third instance of the #5113 defect,
 * and were ledgered in `OWN_PLUGIN_DEBT` below until objectui#6167 rewrote them
 * as real `object-form` nodes; the ledger is empty as of that card. An
 * enumerated table would have inherited that mistake and reported them green.
 *
 * ## Why the set, not a single type
 *
 * `plugin-charts` breaks one-type-per-category: its entries author `chart` AND
 * `bar-chart`, both registered by `packages/plugin-charts`. The value is a SET,
 * and the rule stays PER ENTRY — *every* entry authors a node whose type is in
 * the set its own package registers. Deliberately NOT "the category authors at
 * least one type this package registers", which one conforming entry satisfies
 * while every other entry in the category drifts.
 *
 * The types are asserted to be REGISTERED separately from the render, because a
 * type that resolves to nothing fails every case below with the OBJUI-001 panel
 * rather than with anything about the entries. That separation was written for
 * `object-grid`, which used to reach this registry ONLY because
 * `@object-ui/plugin-view` imports `ObjectGrid` from `@object-ui/plugin-grid` —
 * load-bearing and invisible. objectui#6025 made both `@object-ui/plugin-grid`
 * and `@object-ui/plugin-form` declared imports of the gallery host, so
 * resolution no longer rides on that component import. The transitive path
 * still exists and still works, which is precisely why "is it registered"
 * cannot judge whether the declaration is there — see
 * `objectui#6025 — the gallery DECLARES the packages its entries need` below.
 *
 * ## No environment exclusions, and that is a result rather than an oversight
 *
 * `plugin-editor` and `plugin-map` are in `EXCLUSIONS` above because Monaco
 * wants a CDN loader and maplibre wants WebGL2 and a live tile host. Neither
 * half here needs them to render: MOUNT replaces the own-type node with the
 * probe, so `code-editor` and `object-map` never mount, and DATA PROVENANCE
 * does not apply to either (no `objectName`). Both categories carry the same
 * assertions as every other non-object-bound category — the environment limit
 * costs them nothing in this pin.
 */
/** Catalog categories that sit on a plugin's docs page. */
const PLUGIN_CATEGORIES = [
  ...new Set(entries.map((e) => e.meta.category).filter((c) => c.startsWith('plugin-'))),
].sort();

/**
 * Rooted at this file, never at the cwd — see `REPO_ROOT` above. This one is
 * the shape objectui#8953's gate states it cannot see: the repository path is
 * resolved by the HELPER, on this file's behalf, so no filesystem call here
 * carries the cwd and nothing scanning this file's own reads would find it.
 */
const derivedRegistry = deriveRegistryKeys(REPO_ROOT);

/**
 * category → the key set `packages/<category>` registers, joined on the
 * registration SITE. Both spellings a package produces are kept (the bare
 * `object-view` and the namespaced `plugin-view:object-view`), because an entry
 * may legitimately author either.
 */
const CATEGORY_OWN_TYPES = new Map<string, Set<string>>();
for (const [key, sites] of derivedRegistry.keys as Map<string, string[]>) {
  for (const site of sites) {
    const owner = /^packages\/([^/]+)\//.exec(site)?.[1];
    if (!owner || !PLUGIN_CATEGORIES.includes(owner)) continue;
    if (!CATEGORY_OWN_TYPES.has(owner)) CATEGORY_OWN_TYPES.set(owner, new Set());
    CATEGORY_OWN_TYPES.get(owner)!.add(key);
  }
}

/** Every `type` string anywhere in a schema tree. */
function nodeTypes(node: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const n of node) nodeTypes(n, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'type' && typeof v === 'string') acc.add(v);
      nodeTypes(v, acc);
    }
  }
  return acc;
}

const ownTypesIn = (schema: unknown, own: Set<string>) =>
  [...nodeTypes(schema)].filter((t) => own.has(t)).sort();

/**
 * The inert stand-in MOUNT substitutes for the entry's own-plugin nodes. It is
 * namespaced with `skipFallback` so it claims no bare key any catalog entry
 * could name, and it is unregistered on teardown because the registry is a
 * process-level singleton.
 */
const PROBE_TYPE = 'catalog-pin:own-plugin-probe';
const PROBE_MARK = 'OWN-PLUGIN-NODE-PAINTED-HERE';
ComponentRegistry.register(
  'own-plugin-probe',
  () => <span data-testid="own-plugin-probe">{PROBE_MARK}</span>,
  { namespace: 'catalog-pin', skipFallback: true },
);
afterAll(() => {
  ComponentRegistry.unregister('own-plugin-probe', 'catalog-pin');
});

/** The entry's schema with every own-plugin node swapped for the probe. */
function substituteOwnNodes(node: unknown, own: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((n) => substituteOwnNodes(n, own));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] =
        k === 'type' && typeof v === 'string' && own.has(v)
          ? PROBE_TYPE
          : substituteOwnNodes(v, own);
    }
    return out;
  }
  return node;
}

/**
 * The objects the gallery fixture actually serves rows for. Read off the
 * fixture above rather than restated, so an entry binding to some other object
 * is classified as not-data-bound instead of being asserted against rows the
 * fixture would never return.
 */
const FIXTURE_OBJECTS = new Set([USERS_SCHEMA.name]);

/** The record that exists ONLY in the fixture — the provenance token. */
const FIXTURE_ONLY_RECORD = USERS_ROWS[0].name;

/**
 * Did the fixture's record reach the DOM at all? TEXT **or** the value of a
 * form control — see "What \"shows a record\" means" in the header. A form is
 * the case that needs the second half: its record lands in `input.value`,
 * where `textContent` cannot see it.
 */
const carriesFixtureRecord = (r: Rendered) =>
  r.text.includes(FIXTURE_ONLY_RECORD) ||
  r.controlValues.some((v) => v.includes(FIXTURE_ONLY_RECORD));

/** Does the entry bind to an object the fixture serves? Read off its own JSON. */
function bindsFixtureObject(node: unknown): boolean {
  if (Array.isArray(node)) return node.some((n) => bindsFixtureObject(n));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'objectName' && typeof v === 'string' && FIXTURE_OBJECTS.has(v)) return true;
      if (bindsFixtureObject(v)) return true;
    }
  }
  return false;
}

/**
 * Entries that author NO node of their own package's types — the #5113 defect,
 * still open. Ledgered rather than skipped, keyed to the card that owns the
 * fix, and asserted below to STILL FAIL: an entry that starts conforming fails
 * this file until its line is deleted, so the ledger cannot rot green.
 *
 * EMPTY as of objectui#6167, and that emptiness is an assertion rather than a
 * dormant mechanism: the coverage-split case below pins `ledgered-debt` to `[]`,
 * so the day an entry is added here the split moves and says so. The two lines
 * it used to carry were `plugin-form/basic-form` and `plugin-form/contact-form`,
 * deleted by that card together with the entries they described — the ledger is
 * emptied by fixing entries, never by editing this list.
 *
 * ⛔ This is not an exemption list. Nothing may be added here to make a red
 * turn green — a new entry that does not use its own plugin is a defect in that
 * entry, and the fix is the entry.
 */
const OWN_PLUGIN_DEBT: Record<string, string> = {};

const pluginEntries = entries.filter((e) => PLUGIN_CATEGORIES.includes(e.meta.category));
const isDataBound = (e: (typeof pluginEntries)[number]) => bindsFixtureObject(e.schema);

describe('objectui#6024 — the derivation this pin is built on', () => {
  it('resolves every registration site — an unresolved one would shrink the sets silently', () => {
    expect(derivedRegistry.findings).toEqual([]);
  });

  it('is not vacuous: every plugin category resolved to a non-empty key set', () => {
    const empty = PLUGIN_CATEGORIES.filter((c) => !(CATEGORY_OWN_TYPES.get(c)?.size ?? 0));
    expect(empty).toEqual([]);
    expect(derivedRegistry.counters.resolved).toBeGreaterThan(100);
  });

  /**
   * The provenance token is only provenance if the entries it is asserted
   * against cannot supply it. Asserted rather than asserted-in-a-comment: an
   * entry that happened to author the fixture's first record would turn the
   * DATA half into a tautology — green forever, checking nothing.
   *
   * Scoped to the `plugin-*` corpus, which is this pin's universe, and that
   * scope is measured rather than assumed: two entries elsewhere in the catalog
   * DO author the string (`components-layout-card/profile-detail-card` and
   * `components-layout-card/user-list-card`, found by this case on the first
   * run). They are hand-built cards about a person named like the fixture's
   * first row, they are not held to the DATA half, and a corpus-wide assertion
   * would have been red on two correct entries.
   */
  it(`no plugin-* entry authors ${FIXTURE_ONLY_RECORD} — for them it exists only in the fixture`, () => {
    const authoring = pluginEntries
      .filter((e) => JSON.stringify(e.schema).includes(FIXTURE_ONLY_RECORD))
      .map((e) => e.id);
    expect(authoring).toEqual([]);
  });

  /**
   * THE PROVENANCE INSTRUMENT STILL DISCRIMINATES (objectui#6167).
   *
   * `carriesFixtureRecord` reads text OR control values, which is a WIDER
   * reading than the `r.text` one objectui#5113 wrote. A widened instrument has
   * to be shown to still fail on the thing it is meant to catch, or the entries
   * it newly admits are admitted by relaxation.
   *
   * The control is the `plugin-form` entries' own shape with ONE thing changed:
   * a `recordId` the fixture does not serve. Same renderer, same object, same
   * mode, same harness — so what it measures is the record and nothing else.
   * Its controls still render, which is asserted first: without that, a form
   * that painted nothing would satisfy the line below while measuring nothing.
   *
   * (`mode: 'create'` was tried first and is NOT usable here: it paints its
   * shell before the object schema resolves, so `renderEntry` — which settles
   * on "something was drawn" — returns with zero controls. The edit path holds
   * its first paint until the fetch lands, which is why this shape settles.)
   */
  it('the provenance instrument still fails on a surface with no record behind it', async () => {
    // The entries' spelling: the props in the `properties` bag (objectui#10859 batch 4).
    const r = await renderEntry({
      type: 'object-form',
      properties: {
        objectName: 'users',
        mode: 'edit',
        recordId: 'no-such-record',
        fields: ['name', 'email', 'department'],
      },
    });
    try {
      expect(
        r.controlValues.length,
        'the control form rendered no controls at all, so the assertion below would ' +
          'pass without measuring anything',
      ).toBeGreaterThan(0);
      expect(carriesFixtureRecord(r)).toBe(false);
    } finally {
      teardown(r);
    }
  });

  /**
   * THE SPLIT, STATED BY THE GATE ITSELF. Breadth is not depth: this case is
   * what stops "the pin covers all thirteen categories" from being read as
   * "all thirteen carry the strong half". The literal is measured, and a new
   * category, a new entry, or an entry changing tier turns it red for review.
   */
  it('states its own coverage split — how many entries carry which half', () => {
    const tierOf = (e: (typeof pluginEntries)[number]) =>
      OWN_PLUGIN_DEBT[e.id] ? 'ledgered-debt' : isDataBound(e) ? 'structure+mount+data' : 'structure+mount';
    const byTier: Record<string, string[]> = {};
    for (const e of pluginEntries) (byTier[tierOf(e)] ??= []).push(e.id);
    const categoriesIn = (tier: string) =>
      [...new Set((byTier[tier] ?? []).map((id) => id.split('/')[0]))].sort();

    expect({
      categories: PLUGIN_CATEGORIES.length,
      entries: pluginEntries.length,
      'structure+mount+data': {
        categories: categoriesIn('structure+mount+data'),
        entries: (byTier['structure+mount+data'] ?? []).length,
      },
      'structure+mount': {
        categories: categoriesIn('structure+mount'),
        entries: (byTier['structure+mount'] ?? []).length,
      },
      'ledgered-debt': byTier['ledgered-debt'] ?? [],
    }).toEqual({
      categories: 13,
      entries: 41,
      // The strong half — the tile shows a record only the fixture holds.
      // These are the three categories whose entries bind to `users`.
      'structure+mount+data': {
        categories: ['plugin-form', 'plugin-grid', 'plugin-view'],
        entries: 7,
      },
      // The other eleven author their data inline, so no fixture-only record
      // can reach their tiles. They carry STRUCTURE and MOUNT, and nothing here
      // claims otherwise.
      'structure+mount': {
        categories: [
          'plugin-calendar',
          'plugin-charts',
          'plugin-chatbot',
          'plugin-dashboard',
          'plugin-editor',
          'plugin-gantt',
          'plugin-kanban',
          'plugin-map',
          'plugin-markdown',
          'plugin-timeline',
        ],
        entries: 34,
      },
      // Open defects with an owning card, NOT exemptions. See OWN_PLUGIN_DEBT.
      // EMPTY as of objectui#6167 — every plugin category is now held to the
      // rule, and adding a line to the ledger moves this literal.
      'ledgered-debt': [],
    });
  });

  it('every ledgered entry still exists and still fails — the ledger cannot rot green', () => {
    const ids = new Set(entries.map((e) => e.id));
    for (const [id, reason] of Object.entries(OWN_PLUGIN_DEBT)) {
      expect(ids.has(id), `${id} is ledgered but no longer exists in the catalog`).toBe(true);
      expect(reason).toMatch(/objectui#\d+/);
      const entry = entries.find((e) => e.id === id)!;
      const own = CATEGORY_OWN_TYPES.get(entry.meta.category) ?? new Set<string>();
      expect(
        ownTypesIn(entry.schema, own),
        `${id} now authors a node its own package registers — delete its OWN_PLUGIN_DEBT ` +
          'line so the entry is held to the rule like every other one.',
      ).toEqual([]);
    }
  });
});

describe.each(PLUGIN_CATEGORIES)(
  'objectui#5113/#5856/#6024 — the %s entries use their own plugin',
  (category) => {
    const own = CATEGORY_OWN_TYPES.get(category) ?? new Set<string>();
    const categoryEntries = pluginEntries.filter((e) => e.meta.category === category);
    const held = categoryEntries.filter((e) => !OWN_PLUGIN_DEBT[e.id]);

    it('the category is populated (guard is not vacuous)', () => {
      expect(categoryEntries.length).toBeGreaterThanOrEqual(2);
    });

    it(`every type packages/${category} registers resolves in the gallery's registration set`, () => {
      const unresolved = [...own].filter((t) => !ComponentRegistry.get(t));
      expect(
        unresolved,
        `these types resolve to no renderer, so a render case below would fail with the ` +
          'OBJUI-001 panel rather than with anything about the entries. For `object-grid` ' +
          'this is transitive — see the header.',
      ).toEqual([]);
    });

    it.each(held.map((e) => [e.id, e.schema] as const))(
      '%s authors a node whose type its own package registers',
      (id, schema) => {
        expect(
          ownTypesIn(schema, own),
          `${id} authors none of ${[...own].sort().join(', ')} — it is a picture of the ` +
            'component rather than the component. Fix the entry, never this list.',
        ).not.toEqual([]);
      },
    );

    it.each(held.map((e) => [e.id, e.schema] as const))(
      '%s mounts that node where the tile actually paints',
      async (id, schema) => {
        const r = await renderEntry(substituteOwnNodes(schema, own));
        try {
          expect(
            r.text,
            `${id} authors a node its own package registers, but replacing it with an inert ` +
              'probe changes nothing on screen — the node never reached the DOM, so it is a ' +
              'stray rather than the thing the tile is made of.',
          ).toContain(PROBE_MARK);
        } finally {
          teardown(r);
        }
      },
    );

    const dataBound = held.filter((e) => isDataBound(e));
    if (dataBound.length > 0) {
      it.each(dataBound.map((e) => [e.id, e.schema] as const))(
        '%s puts data from the gallery data source on screen',
        async (id, schema) => {
          const r = await renderEntry(schema);
          try {
            // Not authored anywhere in the catalog — it exists only in the
            // fixture, which the case above pins. Read out of the text OR a
            // control's value: a grid shows it, a form holds it.
            expect(
              carriesFixtureRecord(r),
              `${id} renders with ${FIXTURE_ONLY_RECORD} nowhere in it — not in the tile's ` +
                "text and not in a form control's value — so nothing on screen came through " +
                'the registered renderer → `dataSource.find`.',
            ).toBe(true);
          } finally {
            teardown(r);
          }
        },
      );
    }
  },
);

/**
 * DECLARED, NOT TRANSITIVE (objectui#6025).
 *
 * ## Why this is not the same question as "is the type registered"
 *
 * `object-grid` resolved in this registry long before the host declared it, and
 * it still would if the declaration were deleted: `@object-ui/plugin-view`
 * imports `ObjectGrid` from `@object-ui/plugin-grid`
 * (`packages/plugin-view/src/ObjectView.tsx:37`), and importing that entry runs
 * its `register` calls. The same is true of `@object-ui/plugin-form` one line
 * below it. Measured on this card's merge-base, importing exactly the eleven
 * packages the host then carried: `object-grid`, `object-form`,
 * `plugin-form:object-form`, `embeddable-form`, `form-analytics`,
 * `object-master-detail-form`, `record:line_items`, `view:form` and
 * `import-wizard` ALL resolved.
 *
 * So `expect(ComponentRegistry.get('object-grid')).toBeTruthy()` — which this
 * file does assert, for its own reason, in every category's own case — passes
 * in the declared world and in the transitive one alike. For THIS question it
 * is a ghost: an assertion that cannot fail in either world.
 *
 * What is asserted here instead is the host's DECLARATION, and it is a real
 * judge because of the case it leans on: the parity case above ties
 * `HOST_PACKAGES` to the literal import list in `registerCatalogBlocks.ts`.
 * Remove the import from the host and parity reds; remove it from both and this
 * case reds. No transitive import can satisfy either, because neither reads the
 * registry at all.
 *
 * The rule is derived, not enumerated: every `plugin-*` CATEGORY that has
 * catalog entries names a package the gallery renders through, so the host must
 * load that package by name. A new plugin category with entries picks the
 * requirement up with no edit here.
 */
describe('objectui#6025 — the gallery DECLARES the packages its entries need', () => {
  it('every plugin category with catalog entries is loaded BY NAME by the host', () => {
    expect(
      PLUGIN_CATEGORIES.length,
      'no plugin categories were derived, so this case would be vacuous',
    ).toBeGreaterThanOrEqual(13);

    const undeclared = PLUGIN_CATEGORIES.map((category) => `@object-ui/${category}`).filter(
      (pkg) => !HOST_PACKAGES.includes(pkg),
    );
    expect(
      undeclared,
      'these packages register the types their own category’s entries author, and the ' +
        'gallery host does not name them. Whether the types resolve anyway through some ' +
        'other package’s component import is a different question and not this one — add ' +
        'the side-effect import to `apps/site/app/components/registerCatalogBlocks.ts` and ' +
        'mirror it in `HOST_PACKAGES`.',
    ).toEqual([]);
  });
});

/**
 * HOST PARITY for the fixture, same technique and same reason as the
 * registration-set parity above: the mirror at the top of this file is what
 * the assertions run against, so a host fixture that lost `find` would leave
 * this file green while the docs page went back to an empty view.
 */
describe('objectui#5113 — the docs-site hosts supply the same fixture', () => {
  const siteDir = path.join(REPO_ROOT, 'apps/site/app/components');
  const read = (f: string) => fs.readFileSync(path.join(siteDir, f), 'utf8');

  it('the host fixture exposes every method this mirror implements', () => {
    const source = read('galleryDataSource.ts');
    const missing = GALLERY_DATA_SOURCE_METHODS.filter(
      (method) => !new RegExp(`\\basync ${method}\\s*\\(`).test(source),
    );
    expect(missing).toEqual([]);
  });

  it.each(['SchemaThumbnail.tsx', 'InteractiveDemo.tsx'])(
    '%s hands it to the renderer',
    (host) => {
      expect(read(host)).toMatch(/^import \{ galleryDataSource \} from '\.\/galleryDataSource';$/m);
      expect(read(host)).toContain('dataSource: galleryDataSource');
    },
  );
});

/**
 * objectui#6317 — every `select` field in the fixture declares the options its
 * own rows use, and this mirror declares exactly what the host declares.
 *
 * ## The defect
 *
 * `ObjectForm` copies a field's options through verbatim — `formField.options =
 * field.options || []` (`packages/plugin-form/src/ObjectForm.tsx`) — so a
 * `select` field with no `options` renders the "No options available" empty
 * state. Measured through this file's own render path, an `object-form` over
 * `users` with no `fields` restriction:
 *
 *   before: "NameEmailRoleNo options availableDepartmentStatusNo options
 *            availableCancelUpdate"
 *   after:  "NameEmailRoleAdminAdminMemberViewerDepartmentStatusActiveActive
 *            InvitedSuspendedCancelUpdate"
 *
 * and the record's own `role` / `status` join the form's control values
 * (`["Alice Johnson","alice@example.com","Engineering"]` → `["Alice Johnson",
 * "alice@example.com","admin","Engineering","active"]`), so the two fields stop
 * being dropped on the way in.
 *
 * ## Why the grid and view tiles do NOT move with it
 *
 * Worth recording, because the expectation going in was that they would.
 * `ObjectGrid` SYNTHESISES options for an option-less select from the distinct
 * values in the loaded rows (`packages/plugin-grid/src/ObjectGrid.tsx` —
 * `fieldMeta.options = uniqueValues.map(v => ({ value: v, label:
 * humanizeLabel(String(v)) }))`), so `admin` already printed as "Admin".
 * Measured: the tile text of all seven `users`-bound entries is byte-identical
 * before and after this declaration. The grid has a fallback for the missing
 * declaration; the FORM path has none. That asymmetry is the whole card.
 *
 * ## Two directions, because a one-sided pin cannot see this drift
 *
 * The host declared these options in `4b0b12630` and this mirror did not
 * follow for 330 commits — with every case in this file green throughout. The
 * `select`-coverage case below catches a fixture that declares neither; the
 * parity case catches the two files declaring different things.
 */

interface UsersFieldDecl {
  label?: string;
  type?: string;
  options?: Array<{ label: string; value: string }>;
}

/** Distinct values the mirror's rows carry for one field — walked, not grepped. */
function distinctRowValues(field: string): Set<string> {
  const seen = new Set<string>();
  for (const row of USERS_ROWS) {
    const value = (row as Record<string, unknown>)[field];
    if (value !== undefined && value !== null) seen.add(String(value));
  }
  return seen;
}

/**
 * The host's `USERS_SCHEMA`, read off its source. `apps/**` is outside every
 * root Vitest project, which is the same constraint that makes this file a
 * mirror in the first place. Brace-matched rather than pattern-matched and then
 * JSON-ified, so an extraction that stops working fails LOUDLY here rather than
 * quietly comparing less than it claims to.
 */
function readHostUsersFields(source: string): Record<string, UsersFieldDecl> {
  const start = source.indexOf('const USERS_SCHEMA = {');
  expect(start, 'the host fixture no longer declares `const USERS_SCHEMA = {`').toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, 'the host `USERS_SCHEMA` literal has unbalanced braces').toBeGreaterThan(-1);
  const json = source
    .slice(open, end + 1)
    .replace(/'/g, '"')
    .replace(/([{,[]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, '$1');
  let parsed: { fields?: Record<string, UsersFieldDecl> };
  try {
    parsed = JSON.parse(json) as { fields?: Record<string, UsersFieldDecl> };
  } catch (error) {
    throw new Error(
      'the host `USERS_SCHEMA` is no longer a plain single-quoted literal, so this ' +
        'parity case can no longer read it — a comment inside the literal, or an ' +
        'apostrophe inside a string, would each do it. Fix the reader, not the pin.',
      { cause: error },
    );
  }
  expect(parsed.fields, 'the host `USERS_SCHEMA` declares no `fields`').toBeTruthy();
  return parsed.fields as Record<string, UsersFieldDecl>;
}

describe('objectui#6317 — a `select` field declares the options its rows use', () => {
  const mirrorFields = USERS_SCHEMA.fields as Record<string, UsersFieldDecl>;
  const selectFields = Object.entries(mirrorFields)
    .filter(([, field]) => field.type === 'select')
    .map(([name]) => name);

  it('the fixture declares select fields at all — otherwise the cases below are vacuous', () => {
    expect(selectFields).not.toEqual([]);
  });

  it.each(selectFields)('`%s` declares options, and they cover its rows exactly', (name) => {
    const declared = mirrorFields[name].options;
    expect(
      declared,
      `\`${name}\` is declared \`type: 'select'\` with no \`options\`. ObjectForm copies ` +
        'a field\'s options through verbatim, so a form bound to it renders the "No ' +
        'options available" empty state — on a docs page whose whole purpose is to ' +
        'show the component working.',
    ).toBeTruthy();
    const optionValues = new Set((declared ?? []).map((option) => String(option.value)));
    const rowValues = distinctRowValues(name);
    expect(
      [...rowValues].filter((value) => !optionValues.has(value)),
      `rows carry these \`${name}\` values that no option declares — they would render as a blank cell`,
    ).toEqual([]);
    expect(
      [...optionValues].filter((value) => !rowValues.has(value)),
      `these \`${name}\` options match no row, so nothing in the gallery demonstrates them`,
    ).toEqual([]);
  });

  it('the host fixture declares the SAME field surface, options included', () => {
    const hostSource = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/site/app/components/galleryDataSource.ts'),
      'utf8',
    );
    expect(
      readHostUsersFields(hostSource),
      'the host fixture and this mirror declare different `users` field surfaces. They ' +
        'are ONE fixture in two files and have to move together: the host gained its ' +
        '`role` / `status` options in 4b0b12630 and this mirror did not follow for 330 ' +
        'commits, with every case in this file green the whole time.',
    ).toEqual(mirrorFields);
  });
});

/**
 * objectui#6537 — the two `plugin-form` entries stop steering around the
 * fixture's `select` fields.
 *
 * ## What the entries were working around
 *
 * Both `plugin-form` entries authored a field list that omitted `role` and
 * `status` — the only two `select` fields the `users` fixture declares:
 * `object-form-record` listed `["name","email","department"]` and
 * `object-form-tabbed-sections` sectioned over `[name,email]` /
 * `[department,created_at]`. That was never an authoring choice. Until
 * objectui#6317 this mirror declared both fields with NO `options`, and
 * `ObjectForm` copies a field's options through verbatim (`formField.options =
 * field.options || []`), so a form over either one painted the "No options
 * available" empty state — on a docs page whose whole purpose is to show the
 * component working. The five `plugin-grid` / `plugin-view` entries over the
 * same object never steered around them, because `ObjectGrid` SYNTHESISES
 * options for an option-less select from the loaded rows. That asymmetry is
 * what #6317 measured, and it is why only the FORM entries carried a
 * workaround.
 *
 * #6317 declared the options in the host fixture's `users` schema and in this
 * mirror, so the constraint is gone and both entries carry the full field
 * surface again.
 *
 * Measured through this file's own render path, before and after this card:
 *
 *   object-form-record
 *     before "NameEmailDepartmentCancelSave changes"
 *     after  "NameEmailRoleAdminAdminMemberViewerDepartmentStatusActiveActive
 *             InvitedSuspendedCancelSave changes"
 *   object-form-tabbed-sections
 *     before "IdentityOrganisationNameEmailDepartmentCreatedCancelSave changes"
 *     after  "IdentityOrganisationAccessNameEmailDepartmentCreatedRoleAdmin
 *             AdminMemberViewerStatusActiveActiveInvitedSuspendedCancelSave
 *             changes"
 *
 * ("Admin" twice: the closed trigger shows the selected option's label, and
 * the option list carries it again.) The record's own values join the form's
 * controls with them — `["Alice Johnson","alice@example.com","Engineering"]`
 * becomes `["Alice Johnson","alice@example.com","admin","Engineering",
 * "active"]` — so the two fields stop being dropped on the way in.
 *
 * That the text MOVES is the point, and it is the half #6317 could not show:
 * the seven `users`-bound tiles were byte-identical across that card because
 * the grid synthesises what the declaration was missing. The form path has no
 * such fallback, so here the declaration is visible.
 *
 * The tabbed entry is measurable from its `identity` default tab because
 * `TabbedForm` keeps EVERY panel mounted inside one `<form>` (objectui#2959,
 * so a tab the user leaves keeps its values and one submit spans them all) —
 * the `Access` tab's controls are in the DOM without activating it.
 *
 * ## Why this is a pin and not just an edit
 *
 * The workaround is invisible in the entries themselves — a shorter `fields`
 * list reads as a deliberately trimmed demo, and every case in this file was
 * green the whole time it was there. Nothing would notice it coming back. So
 * the rule is stated positively and DERIVED from the fixture: every
 * `plugin-form` entry authors every `select` field the fixture declares, and
 * each of those fields puts its declared option labels on screen. A field that
 * becomes a `select`, or an option that is added, joins this pin with no edit
 * here; an entry that drops one turns it red.
 *
 * The render half is what makes it a measurement rather than a restatement of
 * the JSON: an authored field that renders the empty state satisfies the
 * authoring half and fails here.
 */

/** The empty state a `select` with no options paints (`packages/fields/src/widgets/useFieldTranslation.ts`, `packages/components/src/renderers/form/form.tsx`). Copied as a literal for the same reason the three diagnostics at the top of this file are: it is user-visible contract for this pin. */
const OPTIONS_EMPTY = 'No options available';

/**
 * Field NAMES an entry authors, at any depth: the string members of any
 * `fields` array. Walked rather than read off a known path, because the two
 * entries put them in different places — one at the root, one inside
 * `sections[].fields` — and a path-specific reader would report the tabbed
 * entry as authoring none, which is the vacuous green this pin has to avoid.
 */
function authoredFieldNames(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) authoredFieldNames(n, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'fields' && Array.isArray(v)) {
        for (const f of v) if (typeof f === 'string') acc.push(f);
      }
      authoredFieldNames(v, acc);
    }
  }
  return acc;
}

describe('objectui#6537 — the `plugin-form` entries author the fixture\'s `select` fields', () => {
  const mirrorFields = USERS_SCHEMA.fields as Record<string, UsersFieldDecl>;
  const selectFields = Object.entries(mirrorFields)
    .filter(([, field]) => field.type === 'select')
    .map(([name]) => name);
  const formEntries = entries.filter((e) => e.meta.category === 'plugin-form');
  const cases = formEntries.map((e) => [e.id, e.schema] as const);

  it('is not vacuous: there are form entries, they restrict their fields, and the fixture has selects', () => {
    expect(formEntries.map((e) => e.id)).not.toEqual([]);
    expect(selectFields).not.toEqual([]);
    // An entry that authors NO field list takes the whole object surface and
    // would satisfy the authoring case below for free.
    expect(
      formEntries.filter((e) => authoredFieldNames(e.schema).length === 0).map((e) => e.id),
    ).toEqual([]);
  });

  it.each(cases)('%s authors every select field the fixture declares', (_id, schema) => {
    const authored = authoredFieldNames(schema);
    expect(
      selectFields.filter((name) => !authored.includes(name)),
      'this entry steers around a `select` field of the object it binds to. That was a ' +
        'workaround for an option-less fixture field (objectui#6317) and the fixture now ' +
        'declares the options — a form demo that avoids the only pickers in its object ' +
        'demonstrates less than the component does.',
    ).toEqual([]);
  });

  it.each(cases)('%s puts every declared option label on screen', async (_id, schema) => {
    const r = await renderEntry(schema);
    try {
      expect(
        r.text.includes(OPTIONS_EMPTY),
        `the tile paints "${OPTIONS_EMPTY}" — a select reached the form with no options`,
      ).toBe(false);
      const missing = selectFields.flatMap((name) =>
        (mirrorFields[name].options ?? [])
          .map((option) => option.label)
          .filter((label) => !r.text.includes(label)),
      );
      expect(
        missing,
        'these option labels the fixture declares are not on the tile, so the picker the ' +
          'docs page exists to show is not being shown',
      ).toEqual([]);
    } finally {
      teardown(r);
    }
  });

  it.each(cases)("%s carries the record's own select values in its controls", async (_id, schema) => {
    const r = await renderEntry(schema);
    try {
      expect(r.controlValues.length).toBeGreaterThan(0);
      const record = USERS_ROWS[0] as Record<string, unknown>;
      expect(
        selectFields.filter((name) => !r.controlValues.includes(String(record[name]))),
        "the record's own values for these select fields never reached a form control, so " +
          'the field is on screen but the record is being dropped on the way in',
      ).toEqual([]);
    } finally {
      teardown(r);
    }
  });
});
