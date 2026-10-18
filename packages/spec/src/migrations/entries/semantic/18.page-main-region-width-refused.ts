// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An accept-set narrowing of one region's width, not a key removal: `width`
// stays declared on every region, `'full'` stays live on `main` with its
// page-wide meaning, and every other region accepts the widths it did — so no
// tombstone and no RETIRED_KEYS_BY_MAJOR row. The parse refuses `'small'`,
// `'medium'` and `'large'` on a region named `main` through
// `checkPageMainRegionWidth` (ui/page.zod.ts). No grace window on the
// AUTHORING surface: the edit is a one-key delete that changes nothing on
// screen, and the refusal says so. Data at rest is the other half: an
// installed or stored page carrying such a width replays the retired D2 entry
// `page-main-region-width-removed` on read, which deletes exactly the widths
// the parse refuses. No relevance question: the surface reaches pages a plugin
// registers in code and stored rows.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'page-main-region-width-refused',
  surface:
    'pages[].regions[].width on a region named main (matched case-insensitively) — small, medium or large, on '
    + 'any page kind and any template; in a stack, on a page a package registers, or in a page saved through '
    + 'the metadata API',
  replacement:
    'Delete `width` from the `main` region: the page renders exactly as before, since no layout read it. Write '
    + "`width: 'full'` only for a full-bleed page — it lifts the page's max-width cap. Every other region "
    + 'accepts the same widths as before.',
  reason:
    'PageRegionSchema.width is one enum shared by every region, so a main region accepted small, medium and large. '
    + 'The console never read them: every layout draws main at the width the layout leaves it (the flexible '
    + 'column beside sidebar and aside on default, header-sidebar-main, three-column and a page that names no '
    + 'template; one grid cell on dashboard), and the only reader of main.width is the page itself, for full, '
    + 'which removes the page max-width cap. A shipped three-column home page declaring a large main rendered '
    + 'its main at the space the two rails left, wider than large means on a sidebar, and every door reported '
    + 'success. The parse now refuses small, medium and large on a region named main at regions.N.width, naming '
    + 'the region and full as the one value it takes — by definePage, defineStack (so objectstack validate and '
    + 'objectstack build, STACK_SCHEMA_INVALID 422) and the metadata save door (422 INVALID_METADATA). '
    + '⚠️ No D2 conversion on the authoring surface: an author meets the refusal, which names the one-key edit. '
    + 'Data at rest replays the retired conversion page-main-region-width-removed on read — a stored row, a '
    + 'compiled artifact inside the window its declared protocol range opens, and a package body registered with '
    + 'its declared range — so an installed or stored page keeps loading and renders as it did. ADR-0087.',
  acceptanceCriteria:
    'Grep every page in defineStack pages sources, exported stacks and every page row in sys_metadata for a '
    + 'region named main (any case) that declares width small, medium or large, and delete that width. Then '
    + 'objectstack validate reports nothing at pages.N.regions.M.width, saving each formerly affected page '
    + 'through the metadata API succeeds, and each page renders exactly as it did before the edit.',
};
