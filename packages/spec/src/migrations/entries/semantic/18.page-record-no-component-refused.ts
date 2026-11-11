// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An accept-set narrowing, not a key removal: a `kind: 'full'` record page
// (`type: 'record'`, the default type) that places no component in its
// `regions` is refused through `checkPageRecordPlacesComponent`
// (ui/page.zod.ts). No key or value is retired, so no tombstone and no
// RETIRED_KEYS_BY_MAJOR row. No D2 conversion: such a page drew a blank detail
// panel, and the only rewrites that draw something — the object's default
// record page (delete the page, or make it `kind: 'slotted'`) or authored
// components — each change what the page shows, which is the author's call,
// and a conversion that changes the screen is not a lossless rewrite. Data at
// rest therefore stays with the parse, the way an unplaced region does
// (`page-template-closed-region-unplaced-refused`): a stored row is served
// unchanged, flagged invalid in its `_diagnostics`, and refused on its next
// save. No relevance question: the surface reaches pages a plugin registers in
// code and stored rows.
export const entry: SemanticMigration = {
  id: 'page-record-no-component-refused',
  surface:
    'pages[] — a record page (type record, the default type) of kind full (the default kind) that places no '
    + 'component: no regions, or only regions whose components list is empty; in a stack, on a page a package '
    + 'registers, or in a page saved through the metadata API',
  replacement:
    'Delete the page, so the record view of its object opens the default record page again; or make it '
    + "`kind: 'slotted'` to keep that default page and replace only the slots it names; or place the "
    + "components the page should draw in a region, e.g. `regions: [{ name: 'main', components: [{ type: "
    + "'record:details' }] }]`. A home, app, utility or list page with no regions is unchanged.",
  reason:
    'The console draws a kind full record page exactly as authored, and on a record page the components in its '
    + 'regions are all it draws: the page label belongs to its page:header block, its description is not drawn, '
    + 'no layout template draws anything of its own, and slots and interfaceConfig are not read on a full page. '
    + 'So a record page that placed no component — the smallest page that validated, and a shape AI authors '
    + 'write — opened every record of its object on a blank detail panel, the breadcrumb and nothing else, '
    + 'while the save door answered 200 with _diagnostics.valid true, and deleting the page brought the default '
    + 'detail view back. The regions field also claimed that an empty full page falls back to the synthesized '
    + 'default layout; the console never did that. The page parse now refuses such a page at regions, saying '
    + 'that every record would open on a blank panel and naming both fixes — by definePage, defineStack (so '
    + 'objectstack validate and objectstack build, STACK_SCHEMA_INVALID 422), package registration (an installed '
    + 'package body carrying such a page included) and the metadata save door (422 INVALID_METADATA). Home, app '
    + 'and utility pages draw their label as the page heading when no page:header '
    + 'owns it, and list pages draw through interfaceConfig, so they keep accepting no regions; slotted, html and '
    + 'react pages draw their slots or source and are not judged. '
    + '⚠️ No D2 conversion: every rewrite that draws something changes what the page shows. '
    + '⚠️ A page row already stored this way is served unchanged, with _diagnostics.valid false and the finding '
    + 'at regions, and saving it again is refused until it places a component; until it is fixed or deleted, '
    + 'the console still draws the blank panel for its object. ADR-0087.',
  acceptanceCriteria:
    'Grep every page in defineStack pages sources, exported stacks and every page row in sys_metadata for a '
    + 'record page (type record or no type) of kind full (or no kind) whose regions are absent, empty, or hold no '
    + 'component. Delete each one, make it kind slotted, or place its components. Then objectstack validate '
    + 'reports nothing at pages.N.regions, saving each kept page through the metadata API succeeds, and opening '
    + 'a record of each affected object shows its detail view — the default record page, or the components you '
    + 'placed — not a blank panel.',
};
