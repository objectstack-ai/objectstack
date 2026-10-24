/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * How wide a page block sits in its region's 12-column block grid
 * (objectui#12624).
 *
 * The width is DERIVED from the block's kind, never authored:
 * `@objectstack/spec`'s `PageComponentSchema` declares no `span`, and on
 * `PageRegionSchema` `span` is only a refused alias of `width`. So this file
 * adds no key an author can write; it names, once, which registered block
 * types are metric tiles (3 of 12) and which are charts (6 of 12). Every other
 * type, a type this table does not name included, spans the full 12.
 *
 * The keys are the registry keys the blocks are registered under (the bare
 * key where the registration keeps one, and the namespaced key). The page
 * renderer (`RegionContent` in `./page.tsx`) and the Studio page designer's
 * block card (app-shell `PageBlockCanvas`) both read this table, so the span
 * the designer shows is the span the page draws.
 */
export type PageBlockSpan = 3 | 6 | 12;

const TILE = 3;
const CHART = 6;

/** Registered block type → its span, for the types narrower than 12. */
export const PAGE_BLOCK_SPANS: ReadonlyMap<string, 3 | 6> = new Map<string, 3 | 6>([
  // Metric / stat tiles — one number each.
  ['element:number', TILE],
  ['statistic', TILE],
  ['ui:statistic', TILE],
  ['object-metric', TILE],
  ['plugin-dashboard:object-metric', TILE],
  ['plugin-dashboard:metric', TILE],
  ['plugin-dashboard:metric-card', TILE],
  // Charts.
  ['chart', CHART],
  ['view:chart', CHART],
  ['plugin-charts:chart', CHART],
  ['object-chart', CHART],
  ['plugin-charts:object-chart', CHART],
  ['bar-chart', CHART],
  ['plugin-charts:bar-chart', CHART],
  ['chart:bar', CHART],
  ['plugin-charts:chart:bar', CHART],
]);

/**
 * The span a block of this type takes; a type the table does not name takes
 * 12. A block in a `rail` region (below) takes 12 whatever its kind: a rail is
 * a narrow column, where a fold by viewport width would squeeze a tile to a
 * sliver.
 */
export function pageBlockSpan(type: unknown, rail = false): PageBlockSpan {
  if (rail) return 12;
  return (typeof type === 'string' && PAGE_BLOCK_SPANS.get(type)) || 12;
}

/**
 * Is this region a rail — the narrow `sidebar` / `aside` column beside `main`?
 * Both are on every layout that places those slots beside `main` (no
 * template, `default`, `full-width`, `three-column`); `header-sidebar-main`
 * places only `sidebar` there (an `aside` joins `main`'s column); the
 * `dashboard` template makes every region but `header` / `footer` a grid cell,
 * so it has none. The page renderer passes the same answer structurally, by
 * the slot it places a region in.
 */
export function isPageRailRegion(regionName: unknown, template?: unknown): boolean {
  if (template === 'dashboard') return false;
  const name = typeof regionName === 'string' ? regionName.toLowerCase() : '';
  return name === 'sidebar' || (name === 'aside' && template !== 'header-sidebar-main');
}

/**
 * The span folded by breakpoint: as declared from `xl` (1280px) up; between
 * `md` (768px) and `xl` tiles take 6 and charts 12; under `md` every block
 * takes 12. LITERAL class strings so Tailwind's scanner emits them.
 */
export const PAGE_BLOCK_SPAN_CLASS: Readonly<Record<PageBlockSpan, string>> = {
  3: 'col-span-12 md:col-span-6 xl:col-span-3',
  6: 'col-span-12 xl:col-span-6',
  12: 'col-span-12',
};
