// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22568 — page `slots.details` refused beside `slots.tabs`. A narrowing of
// the slot map, not a key removal: both slots stay live on their own, so there
// is no tombstone and no RETIRED_KEYS_BY_MAJOR row — the parse refuses the
// pair through `checkPageSlotPair` (ui/page.zod.ts). No D2 conversion: where
// the details body goes inside an authored tab strip (which item, under which
// label) is the author's call, and the move makes visible a body that never
// rendered.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'page-slots-details-beside-tabs-refused',
  surface:
    'page.slots.details authored beside page.slots.tabs on one page — either slot a single component '
    + 'or an array, an empty details array included, whatever the page kind',
  replacement:
    'One `tabs` slot whose items carry the details body: the `record:details` component (its '
    + '`sections` and `hideFields` unchanged) as the `children` of a `tabs` item, the first one by '
    + 'convention — e.g. `{ label: \'Details\', children: [{ type: \'record:details\', properties: { … } }] }` '
    + '— and no `details` slot. To keep the synthesized tab strip with the authored details body in '
    + 'its Details tab instead, delete `slots.tabs`.',
  reason:
    'The slot map declared `details` and `tabs` as two independent optional slots, and they are not: '
    + 'on a slotted record page `details` replaces the body of the Details tab, that tab lives inside '
    + 'the synthesized `page:tabs` strip, and `tabs` replaces the whole strip. The console\'s '
    + 'default-page synthesizer therefore reads `tabs` and never reads `details` when both are '
    + 'authored, so the pair passed `PageSchema.parse`, `objectstack validate` and the metadata save '
    + 'door while the authored details body — its sections, its hidden fields — silently never '
    + 'applied. The platform\'s own `sys_user_detail` page authored both, so its Identity and Audit '
    + 'sections never showed and the ban columns it hides were never hidden by it; it now carries its '
    + '`record:details` as the first `tabs` item. The parse now refuses the pair at `slots.details`, '
    + 'naming both slots and the fix: `definePage`, `defineStack` (`STACK_SCHEMA_INVALID`, 422), '
    + '`objectstack validate` and the metadata save door (`422 INVALID_METADATA`). '
    + 'Measured reach before the narrowing: in this repository only `sys_user_detail` authored the '
    + 'pair (no example app page does), and hotcrm\'s one slotted page authors `header` and '
    + '`discussion` only. '
    + '⚠️ No D2 conversion: which tab item carries the details body, and under which label, is the '
    + 'author\'s decision, and moving it makes visible a body that never rendered — a change to the '
    + 'page, not a respelling. '
    + '⚠️ A page row already stored with the pair is replayed unchanged at load (no conversion '
    + 'touches it), so it renders as before — the authored tabs, without the details body — while '
    + 'its read diagnostics name the pair and saving it again is refused until the details body '
    + 'moves. ADR-0087.',
  acceptanceCriteria:
    'Grep every page in `defineStack` pages sources, exported stacks and every page row in '
    + '`sys_metadata` for a `slots` map carrying both a `details` and a `tabs` key. For each, move the '
    + '`details` component(s) into the `tabs` items — as the `children` of a tab item, the first one by '
    + 'convention, with its `sections` and `hideFields` unchanged — and delete `slots.details`, or '
    + 'delete `slots.tabs` to keep the synthesized tabs. Then `objectstack validate` reports nothing '
    + 'at `pages.N.slots.details`, saving each formerly affected page through the metadata API '
    + 'succeeds instead of answering a 422 that names `slots.details`, and the record page shows the '
    + 'authored details body (its sections, without its hidden fields) in the tab that now carries it. '
    + 'A page authoring only one of the two slots parses and renders byte-identically to before.',
};
