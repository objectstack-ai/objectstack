// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23610, maintainer ruling A on Q2 (record 6190536588). Two accept-set
// narrowings of one layout vocabulary: `PageSchema.template` closes to the
// templates the console registers (`PageTemplateSchema`, the retired
// `full-width` refused by name through the enum's error map), and a region
// whose name the page's template does not place is refused through
// `checkPageRegionPlacement` (ui/page.zod.ts), against the declared slot table
// `PAGE_TEMPLATE_SLOTS`. No key is removed, so no tombstone. No D2 conversion,
// per the ruling (no alias window): `full-width` → `default` is a one-word
// edit, and a region's rename is a choice of which slot the author meant.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'page-template-closed-region-unplaced-refused',
  surface:
    'pages[].template — a name the console does not register (full-width, two-column, single-column and any '
    + 'other); and pages[].regions[].name on a kind full page — a name the page\'s template does not place '
    + '(left_sidebar, right_sidebar, content and any other name outside header, sidebar, main, aside, footer '
    + 'on default and three-column, or outside header, sidebar, main on header-sidebar-main)',
  replacement:
    'A registered template: `default` (header, sidebar, main, aside, footer), `header-sidebar-main` (header, '
    + 'sidebar, main), `three-column` (header, sidebar, main, aside, footer) or `dashboard` (header, footer, '
    + 'and every other region a grid cell) — `full-width` is `default`. Name each region for the slot it '
    + 'fills: `left_sidebar` → `sidebar`, `right_sidebar` → `aside`, `content` → `main`; or choose `dashboard` '
    + 'when the regions are meant as a grid.',
  reason:
    'PageSchema.template and regions[].name were free strings, and the slot names a template places were '
    + 'declared nowhere, so neither an author nor objectstack validate could know that left_sidebar is not a '
    + 'sidebar. The console laid an unregistered template out as the page type\'s default layout, and stacked '
    + 'every region its template does not place under main at full width, dropping its declared width — a '
    + 'shipped three-column home page with left_sidebar and right_sidebar drew as one column, and every door '
    + 'reported success. The template set and each template\'s slots are now part of the contract '
    + '(PageTemplateSchema, PAGE_TEMPLATE_SLOTS), measured against the console\'s template registry: an '
    + 'unregistered template is refused at template, the retired full-width (a second name for default, the '
    + 'same layout) by name with its replacement, and an unplaced region at regions.N.name, naming the '
    + 'template\'s slots — by the page parse: definePage, defineStack (so objectstack validate and objectstack '
    + 'build, STACK_SCHEMA_INVALID 422) and the metadata save door (422 INVALID_METADATA). Region names match '
    + 'case-insensitively, as the console\'s do; dashboard places every name by design; slotted, html and '
    + 'react pages, which do not lay out regions by template, are not judged on region names. '
    + '⚠️ No D2 conversion: the ruling keeps no alias window for full-width, and which slot a renamed region '
    + 'fills is the author\'s call. '
    + '⚠️ A page row already stored with an unregistered template or an unplaced region is served unchanged '
    + 'and renders as before, while saving it again is refused until it is renamed. ADR-0087.',
  acceptanceCriteria:
    'Grep every page in defineStack pages sources, exported stacks and every page row in sys_metadata for a '
    + 'template outside default, header-sidebar-main, three-column and dashboard, and, on kind full pages, '
    + 'for a region name its template does not place. Rename them. Then objectstack validate reports nothing '
    + 'at pages.N.template or pages.N.regions.M.name, saving each formerly affected page through the metadata '
    + 'API succeeds, and each renamed region draws in its slot — a sidebar beside main at its declared width, '
    + 'not stacked under it. A page on full-width renders exactly as it did once it says default.',
};
