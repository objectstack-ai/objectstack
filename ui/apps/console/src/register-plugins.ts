/**
 * Console plugin registration — the SDUI block layer.
 *
 * Extracted from `main.tsx` so it can be imported WITHOUT booting the app
 * (which mounts React, resolves runtime config and inits Sentry). Two consumers
 * need exactly this and nothing else:
 *
 *   - `src/__tests__/public-contract.test.ts` — pins which curated
 *     `PUBLIC_BLOCKS` tags the console actually makes available. That guard is
 *     only meaningful if it reads the REAL registration list rather than a
 *     hand-copied one (objectui#2953 was a public block silently missing from
 *     the contract; a duplicated list would have hidden it just as well).
 *   - `dev/manifest-registry.ts` — imports this alongside its own eager plugin
 *     imports, so a plugin the console lazy-registers but that module forgets
 *     to load eagerly shows up as a `lazy: true` stub and fails the build. It
 *     is the registry both `dev/manifest-dump.tsx` and the console build's
 *     `dist/sdui.manifest.json` step read.
 *
 * Import order note: this module's own imports are hoisted, so the eager
 * plugins below register during import and the `registerLazy` calls run in this
 * module's body — the same relative order they had inline in `main.tsx`.
 * `registerPlaceholders()` still runs in `main.tsx`, after this module, because
 * it must only fill gaps left by every real registration.
 */

import { ComponentRegistry } from '@object-ui/core';

// Eager imports — core views needed on most pages.  These are cheap (no heavy
// 3rd-party deps) so paying their cost upfront is the right tradeoff.
import '@object-ui/plugin-grid';
import '@object-ui/plugin-form';
import '@object-ui/plugin-view';
import '@object-ui/plugin-list';
import '@object-ui/plugin-detail';

// Lazy plugins — registered as deferred loaders.  The first time the
// SchemaRenderer encounters one of these `type` values, the plugin module is
// imported on-demand (and its top-level `ComponentRegistry.register()` calls
// run as a side-effect).  This keeps maplibre-gl, recharts, frappe-gantt,
// markdown renderers, etc. out of the initial bundle.
//
// A lazily-registered tag is still a full member of the public contract:
// `getPublicConfigs()` resolves these stubs, so `kind:'react'` pages get them
// in scope before the chunk loads (objectui#2953).
ComponentRegistry.registerLazy('object-map', () => import('@object-ui/plugin-map'), {
  namespace: 'plugin-map',
  category: 'view',
});
// ⛔ The bare `map` node type key is RETIRED (objectui#10393, executing the
// objectui#8008 family ruling of 2026-09-09) — `object-map` above is the
// surviving spelling. The STORED `NamedListView.type` value `map` is a
// different layer and is untouched: `ObjectView`'s `switch (viewType)` already
// emits `object-map` for it.

ComponentRegistry.registerLazy('object-tree', () => import('@object-ui/plugin-tree'), {
  namespace: 'plugin-tree',
  category: 'view',
});
// ⛔ The bare `tree` node type key is RETIRED (objectui#10859 batch 8, the
// objectui#10393 route) — `object-tree` above is the surviving spelling. The
// STORED / host view type `tree` is a different layer and is untouched:
// `ObjectView` and `ListView` already emit `object-tree` for it.

// Dashboard plugin — only used on dashboard / home pages. Lazy-load all 7
// component types so the ~150 KB widget/pivot/metric tree stays out of the
// initial bundle for users who never visit a dashboard.
//
// ⛔ objectui#10859 batch 8 (phase 2b): `dashboard-grid` is RETIRED (the
// plugin no longer registers it, so a stub here would paint `Loading …`
// forever), and `metric` / `metric-card` register with `skipFallback: true`, so
// their stubs decline the bare key too — a stub that claimed it would keep the
// retired spelling resolvable until the chunk loaded, and blessed by the key
// derivation for good.
for (const variant of ['dashboard', 'object-metric', 'pivot', 'object-pivot', 'object-data-table']) {
  ComponentRegistry.registerLazy(variant, () => import('@object-ui/plugin-dashboard'), {
    namespace: 'plugin-dashboard',
    category: 'view',
  });
}
for (const variant of ['metric', 'metric-card']) {
  ComponentRegistry.registerLazy(variant, () => import('@object-ui/plugin-dashboard'), {
    namespace: 'plugin-dashboard',
    skipFallback: true,
    category: 'view',
  });
}

ComponentRegistry.registerLazy('chart', () => import('@object-ui/plugin-charts'), {
  namespace: 'plugin-charts',
  category: 'chart',
});
// Additional chart variants registered by @object-ui/plugin-charts so the
// renderer can lazy-load when any chart type appears in a schema.
//
// ⛔ Every key in this list must be one `@object-ui/plugin-charts` ACTUALLY
// REGISTERS. A stub for a key the loaded module never registers does not fail
// — it succeeds at being useless (objectui#8760). `Registry.loadLazy` resolves
// "whether or not the loaded module actually registered the expected type",
// and the renderer's lazy branch re-checks `hasLazy` on every pass, so an
// unfulfilled stub leaves `SchemaRenderer` painting `Loading <type>…` FOREVER:
// no OBJUI-001, no error, no console warning. Meanwhile the key is in
// `getKnownTypes()`, so `check:doc-types` and the CLI's `KNOWN_SCHEMA_TYPES`
// snapshot both bless it and the documentation is free to teach it.
//
// ⛔ `line-chart`, `area-chart` and `advanced-chart` are RETIRED from this list
// (objectui#8760) — they were stubs this package never fulfilled. Authors
// reach those chart families the way the plugin actually registers them:
// `{ "type": "chart", "chartType": "line" | "area" }`, which
// `CHART_TYPE_KEYWORD_FAMILIES` resolves. `advanced-chart` was never a family
// at all — it named `AdvancedChartImpl`, an internal module.
// ⛔ Do not re-add a key here without a matching `ComponentRegistry.register()`
// in `packages/plugin-charts/src`: `unfulfilled-chart-stubs-8760.test.ts`
// drives this very list through the real loader and fails on the first key
// that resolves to nothing.
// ⛔ `scatter-chart` (objectui#10859 batch 8, phase 2b) and `pie-chart`,
// `donut-chart`, `radar-chart` (phase 2c) are RETIRED from this list with their
// registrations — those families are `{ "type": "chart", "chartType": "scatter"
// | "pie" | "donut" | "radar" }`.
for (const variant of ['object-chart', 'bar-chart', 'chart:bar']) {
  ComponentRegistry.registerLazy(variant, () => import('@object-ui/plugin-charts'), {
    namespace: 'plugin-charts',
    category: 'chart',
  });
}

ComponentRegistry.registerLazy('object-gantt', () => import('@object-ui/plugin-gantt'), {
  namespace: 'plugin-gantt',
  category: 'view',
});
// ⛔ The bare `gantt` node type key is RETIRED (objectui#8008, maintainer
// ruling 2026-09-09, route 3) — `object-gantt` above is the surviving spelling.
// The STORED `NamedListView.type` value `gantt` is a different layer and is
// untouched: `ObjectView`'s `switch (viewType)` already emits `object-gantt`
// for it.

ComponentRegistry.registerLazy('markdown', () => import('@object-ui/plugin-markdown'), {
  namespace: 'plugin-markdown',
  category: 'display',
});

ComponentRegistry.registerLazy('object-timeline', () => import('@object-ui/plugin-timeline'), {
  namespace: 'plugin-timeline',
  category: 'view',
});
ComponentRegistry.registerLazy('timeline', () => import('@object-ui/plugin-timeline'), {
  namespace: 'view',
  category: 'view',
});

ComponentRegistry.registerLazy('object-calendar', () => import('@object-ui/plugin-calendar'), {
  namespace: 'plugin-calendar',
  category: 'view',
});
ComponentRegistry.registerLazy('calendar', () => import('@object-ui/plugin-calendar'), {
  namespace: 'view',
  category: 'view',
});
ComponentRegistry.registerLazy('calendar-view', () => import('@object-ui/plugin-calendar'), {
  namespace: 'plugin-calendar',
  category: 'view',
});

ComponentRegistry.registerLazy('object-kanban', () => import('@object-ui/plugin-kanban'), {
  namespace: 'plugin-kanban',
  category: 'view',
});
// ⛔ The bare `kanban` key (objectui#8802) and the `kanban-ui` /
// `kanban-enhanced` variants (objectui#8257) are RETIRED — maintainer rulings
// 2026-09-09. `object-kanban` above is the surviving spelling. The STORED
// `NamedListView.type` value `kanban` is a different layer and is untouched:
// `ObjectView`'s `switch (viewType)` already emits `object-kanban` for it.

ComponentRegistry.registerLazy('report', () => import('@object-ui/plugin-report'), {
  namespace: 'plugin-report',
  category: 'view',
});
ComponentRegistry.registerLazy('report-viewer', () => import('@object-ui/plugin-report'), {
  namespace: 'plugin-report',
  category: 'view',
});
// ⛔ No lazy stub for `spec-report`: the key is RETIRED (objectui#11440), so
// `@object-ui/plugin-report` no longer registers it and a stub here would never
// be satisfied. A report embedded in JSON is the `report` node, its report in
// the node's `report` member.
