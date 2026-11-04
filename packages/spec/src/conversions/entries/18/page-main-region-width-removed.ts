// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-main-region-width-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageMainRegionWidthRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPages } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `width: 'small' | 'medium' | 'large'` removed from a page region named
 * `main` (protocol 18). The parse refuses those three widths on `main`
 * (`checkPageMainRegionWidth` in `ui/page.zod.ts`); this entry is the
 * data-at-rest half: an installed or stored page still carrying one converts
 * on read instead of failing the strict parse at an artifact door or on a
 * stored-row read.
 *
 * No layout read the key: the console draws `main` at the width its layout
 * leaves it — the flexible column beside `sidebar` and `aside`, one grid cell
 * on `dashboard` — and its one reader of `main.width` is the page's
 * full-bleed, for `'full'` alone (objectui `renderers/layout/page.tsx`, read at
 * the `.objectui-sha` pin). Deleting one of the three therefore changes
 * nothing a page draws: a pure lossless delete. `'full'` is left as authored —
 * it is the one width `main` takes — and so is every other region's width, and
 * a value the width enum itself refuses (that refusal is the enum's).
 *
 * Scoped exactly as the refusal is: every page, whatever its kind or template,
 * and a region name matched case-insensitively, as the renderer's are.
 * `page-main-region-width-removed.test.ts` holds the two in step.
 *
 * **Retired from the authoring surface from the day it lands**, like its
 * siblings `page-is-default-off-record-page-removed` and
 * `page-template-full-width-to-default`: a live author meets the parse's
 * refusal, which names the one-key edit, and data at rest replays this. The
 * paired D3 entry is `page-main-region-width-refused`.
 *
 * ⚠️ Coverage boundary: this walks `stack.pages[]` ({@link mapPages}), the
 * collection every door reads a package's pages from.
 */
const pageMainRegionWidthRemoved: MetadataConversion = {
  id: 'page-main-region-width-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.regions[].width',
  summary:
    "page region key 'width' removed from a region named 'main' when it is 'small', 'medium' or 'large' — the "
    + "console draws main at the width its layout leaves it and reads main's width only for 'full' (the "
    + 'page-wide full-bleed), so the page renders exactly as before',
  apply(stack, emit) {
    return mapPages(stack, (page, path) => {
      const regions = page.regions;
      if (!Array.isArray(regions)) return page;
      let changed = false;
      const nextRegions = regions.map((region, ri) => {
        if (!isDict(region)) return region;
        const { name, width } = region;
        if (typeof name !== 'string' || name.toLowerCase() !== 'main') return region;
        if (width !== 'small' && width !== 'medium' && width !== 'large') return region;
        changed = true;
        return stripKeys(region, ['width'], emit, `${path}.regions[${ri}]`);
      });
      return changed ? { ...page, regions: nextRegions } : page;
    });
  },
  fixture: {
    before: {
      pages: [
        // The shipped shape: a three-column home page asking for a `large` main.
        {
          name: 'sales_home_page',
          label: 'Sales Home',
          type: 'home',
          template: 'three-column',
          regions: [
            { name: 'header', width: 'full', components: [] },
            { name: 'sidebar', width: 'small', components: [] },
            { name: 'main', width: 'large', components: [] },
            { name: 'aside', width: 'medium', components: [] },
          ],
        },
        // Another case of the name, as the renderer matches it; and a dashboard cell.
        { name: 'team_home', label: 'Team Home', type: 'home', regions: [{ name: 'Main', width: 'medium', components: [] }] },
        { name: 'kpi_board', label: 'KPIs', type: 'home', template: 'dashboard', regions: [{ name: 'main', width: 'small', components: [] }] },
        // `'full'` is the one width `main` takes: left as authored.
        { name: 'wallboard', label: 'Wallboard', type: 'home', regions: [{ name: 'main', width: 'full', components: [] }] },
      ],
    },
    after: {
      pages: [
        {
          name: 'sales_home_page',
          label: 'Sales Home',
          type: 'home',
          template: 'three-column',
          regions: [
            { name: 'header', width: 'full', components: [] },
            { name: 'sidebar', width: 'small', components: [] },
            { name: 'main', components: [] },
            { name: 'aside', width: 'medium', components: [] },
          ],
        },
        { name: 'team_home', label: 'Team Home', type: 'home', regions: [{ name: 'Main', components: [] }] },
        { name: 'kpi_board', label: 'KPIs', type: 'home', template: 'dashboard', regions: [{ name: 'main', components: [] }] },
        { name: 'wallboard', label: 'Wallboard', type: 'home', regions: [{ name: 'main', width: 'full', components: [] }] },
      ],
    },
    // One per stripped width: the three `main` regions that declared small,
    // medium or large. The rails, the header and the `full` main emit none.
    expectedNotices: 3,
  },
};

export { pageMainRegionWidthRemoved };
