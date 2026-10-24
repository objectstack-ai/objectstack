/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 */

/**
 * Registers the plugin blocks the **catalog gallery** renders. A companion to
 * `./registerLayoutBlocks`, which every example host imports directly and which
 * this module deliberately does NOT re-export: `scripts/__tests__/site-
 * playground-layout-registration-3904.test.ts` discovers each `SchemaRenderer`
 * host and reads its imports, so a host reaching the layout registrar through
 * here would read as a host that registers nothing. Two imports, two
 * responsibilities, one visible in each host.
 *
 * Why this exists (objectui#4600): `ComponentRegistry` only knows a type once
 * the package owning it has been loaded, and `/docs/guide/schema-catalog`
 * loads no plugin at all — `SchemaCatalogIndex` -> `SchemaThumbnail` imported
 * `@object-ui/react`, `@object-ui/components` and the layout blocks, and
 * nothing else. `PluginLoader` covers the individual docs pages that embed a
 * demo, but the gallery embeds EVERY example and never wraps them in one.
 *
 * ## Why the list is the WHOLE bucket census, not two packages (objectui#4616)
 *
 * #4600 registered only the two packages its own category needed. Measured on
 * `origin/main` @ `e028dfcd8` — every one of the 423 catalog entries rendered
 * the way `SchemaThumbnail` renders it — that left **33 entries** still
 * painting the registry's red "Unknown component type … (OBJUI-001)" panel, in
 * 14 categories:
 *
 *   components-form-calendar 6 (calendar)   plugin-chatbot 3 (chatbot)
 *   plugin-editor 3 (code-editor)           plugin-gantt 3 (object-gantt)
 *   plugin-map 3 (object-map)               plugin-markdown 3 (markdown)
 *   plugin-timeline 3 (timeline)            plugin-calendar 2 (calendar-view)
 *   plugin-kanban 2 (kanban)                components-complex-filter-ui 1
 *   components-complex-sort-ui 1            components-complex-view-switcher 1
 *   components-disclosure-toggle-group 1    core-schema-renderer 1
 *
 * The gallery page's PURPOSE is to render the whole catalog, so its baseline is
 * that every type an entry names is registered before the render. Nine of the
 * imports below are exactly the packages that census resolved to — not a
 * precautionary sweep of the workspace.
 *
 * ## The list is no longer ONLY that census (objectui#6167)
 *
 * `@object-ui/plugin-form` is here for a different reason, and the header has
 * to say so rather than let the sentence above keep describing a property this
 * file no longer has. The two `plugin-form` catalog entries are real
 * `object-form` nodes as of objectui#6167, and `object-form` is registered by
 * `@object-ui/plugin-form` — so the gallery depends on that package by name.
 *
 * What it did NOT do is change what resolves. Measured before adding it, with
 * exactly the eleven imports this file used to carry: `object-form`,
 * `plugin-form:object-form`, `embeddable-form`, `form-analytics`,
 * `object-master-detail-form`, `record:line_items` and `view:form` all resolved
 * already, because `@object-ui/plugin-view` — import #11 below — does
 * `import { ObjectForm } from '@object-ui/plugin-form'`
 * (`packages/plugin-view/src/ObjectView.tsx:38`), and importing that entry runs
 * its `ComponentRegistry.register` calls. The package's graph was therefore
 * ALREADY in this route's eager closure; the import below adds a declaration,
 * not a payload. Registration is idempotent for the same reason: an ES module
 * executes once, so naming it here does not re-run anything.
 *
 * `@object-ui/plugin-grid` joins on the same argument and with the same
 * measured non-effect (objectui#6025). The `plugin-grid` entries have been real
 * `object-grid` nodes since objectui#5856, and `object-grid` reached this
 * registry only because `ObjectView.tsx:37` — the line above the one quoted
 * above — imports `ObjectGrid`. That is a COMPONENT import, not a plugin
 * dependency: a refactor that stopped `object-view` from drawing a grid itself
 * would be entirely reasonable, would say nothing about the gallery, and would
 * turn two catalog tiles into OBJUI-001 panels several files from the cause.
 *
 * So the list below is: the census (nine), plus objectui#4600's original two,
 * plus two packages the gallery's own entries depend on BY NAME. What it is not
 * is a sweep — nothing is here that the catalog does not render.
 *
 * ## The cost, measured before deciding (objectui#4616 ruling 1)
 *
 * Eager registration pulls each package's graph into the `/docs/[[...slug]]`
 * route — and that route is shared by all 181 docs pages, not just the gallery
 * (measured: `/docs/guide/schema-catalog` and `/docs/guide/architecture` load
 * an identical chunk set, and `SchemaThumbnail`'s own code sits in one of
 * them). So the cost had to be measured, not assumed. Next 16.3 + Turbopack
 * prints no "Size / First Load JS" columns, so the figure was reconstructed
 * from the build on disk — the `<script src>` set of the prerendered route:
 *
 *   before  7738.7 kB across 29 chunks
 *   after   9542.6 kB across 40 chunks
 *   delta   +1803.9 kB  (+23.3%)   — the ruling's stop condition was +50%
 *
 * The prerender is unaffected: the build still emits 556/556 static pages, and
 * the gallery's own HTML still carries all 440 thumbnail frames (it grew
 * 572.1 -> 580.7 kB). `/playground`, which imports the layout registrar but not
 * this module, is byte-identical at 6872.8 kB — the widening is confined to the
 * docs route. Whole-app `static/chunks` did not grow at all (27582.2 ->
 * 27517.2 kB): the plugin code was already being emitted for the docs pages
 * that load it through `PluginLoader`, and what changed is which chunks the
 * docs route pulls in up front.
 *
 * Worth knowing when re-reading this: the thumbnails themselves are
 * NOT in that HTML — `SchemaThumbnail` gates its mount behind an
 * `IntersectionObserver`, so the OBJUI-001 panels appeared on the client after
 * hydration. The eagerness here is still what makes registration precede the
 * first client render of a tile; it is not what puts a tile in the HTML.
 *
 * ## What this does NOT fix
 *
 * 31 of those 33 tiles go from the panel to a drawn component. The rest are
 * not registration defects, so they are filed and named rather than fixed here:
 *
 *   objectui#4624  `components-disclosure-toggle-group/with-labels` names root
 *                  type `single`, which no package registers.
 *   objectui#4625  the six `components-form-calendar/*` author the bare
 *                  `calendar` keyword, which `@object-ui/components`
 *                  deliberately registers as `ui:calendar` only (`skipFallback`,
 *                  "collides with the plugin-calendar full CRUD calendar VIEW")
 *                  — so they reach `ObjectCalendar` and swap the OBJUI-001
 *                  panel for its missing-data-source error.
 *   objectui#4627  the two `plugin-calendar/*` entries author 2024 event dates,
 *                  outside the window `calendar-view` paints.
 *
 * (`core-schema-renderer/unknown-component-type` also keeps the panel, on
 * purpose — the panel IS that example.) Two further entries were found blank
 * rather than red by the same sweep and filed as objectui#4626.
 *
 * EAGER, at module scope, for the same reason `./registerLayoutBlocks` is
 * eager: registration has then already happened before the first tile renders,
 * instead of a tile painting the red panel and repainting once a lazy chunk
 * lands. Not every package declares `sideEffects: false`, so a bare side-effect
 * import survives bundling (checked); the layout package is the one that needs
 * an explicit call, which its own module does.
 *
 * Deliberately NOT imported by `InteractiveDemo` / `LiveSplitDemo`: those host
 * demos on ordinary docs pages, which opt into their plugins through
 * `PluginLoader`, and making them eager would pull every graph below into any
 * page carrying a demo. The gallery page's own modal preview is unaffected — it
 * renders after `SchemaThumbnail` has already registered these on that page.
 *
 * IMPORT ORDER IS CONTRACT. The last registration of a bare keyword wins, so
 * where two of the packages below claim one, the order decides what draws.
 * Re-derived with `deriveRegistryKeys` (`scripts/check-doc-component-types.mjs`)
 * on `origin/main` @ `e929c562a`, none of them do today (objectui#6442): bare
 * `chart` is `plugin-charts`' alone — neither `plugin-dashboard` nor
 * `plugin-report` registers it, and the two `apps/console` sites that also hold
 * the key are `registerLazy` stubs whose loader is `plugin-charts` itself — and
 * bare `calendar` is `plugin-calendar`'s alone, because `@object-ui/components`
 * passes `skipFallback` on `ui:calendar` precisely to stay out of that keyword.
 * The order stays fixed against the day that changes: the first two lines keep
 * the order objectui#4600 established; the rest are appended, which is the
 * order the census above was measured in.
 *
 * Guarded by two pins in `examples/schema-catalog/test/`:
 * `plugin-dashboard-gallery-render.test.tsx` (objectui#4600, the dashboard
 * category) and `catalog-gallery-render.test.tsx` (objectui#4616, every
 * category), both of which mirror this list and fail if it stops loading a
 * package.
 *
 * ## What weighs an ADDITION to this list (objectui#6316)
 *
 * Not `check:eager-closure`, whatever the cards that added to this list said:
 * that gate reads `apps/console/dist/eager-closure.json` and weighs the CONSOLE.
 * The figures above were taken by hand, once, and nothing re-takes them.
 *
 * `pnpm check:docs-route-closure`
 * (`scripts/check-docs-route-eager-closure.mjs`) is what governs a new line
 * here. It walks the `/docs/[[...slug]]` route's STATIC module graph — the
 * entries, plus every compiled `content/docs/**\/*.mdx` module — and requires
 * each package named below to be either already reachable without this file
 * naming it (a declaration and no payload: measurably the case for the last two
 * imports, through `@object-ui/plugin-view`) or recorded in that script's
 * `MEASURED_PAYLOAD` with what it is for. A package that is neither is a
 * genuinely new graph on a route all 181 docs pages share, and it fails there
 * so that someone argues for it in review.
 *
 * It is structural, not byte-level, and deliberately so: it costs no docs
 * build, and it does not re-take the measurement above or claim to.
 */
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
