// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `view-list-filterable-fields-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `viewListFilterableFieldsRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapViewPayloads } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * The list view's `filterableFields` leaves the authorable surface (protocol
 * 18, #24640 — ADR-0049 enforce-or-remove; maintainer ruling C, record
 * 6278975049, pulled into 18.0 by record 6279033298).
 *
 * The key carried two meanings: `ListViewSchema` described it as the legacy
 * shorthand for `userFilters.fields` (the quick-filter bar), and its one
 * renderer — objectui's `ListView`, the `filterFields` memo, fed by the app
 * shell's object view — read it as the Filter panel's field WHITELIST, the
 * fields "Add filter" offers (a hidden field included when named). The ruling
 * is that the platform carries no per-view Filter-panel whitelist, so the key
 * retires with no replacement key.
 *
 * **A DROP, never a rewrite.** ⛔ This conversion must not rewrite the key to
 * `userFilters.fields`: measured on the seat's correction (record
 * 6278907207), that keeps nothing an author saw — the whitelist would vanish
 * and quick-filter chips would appear. It strips the key, the
 * `view-list-passthrough-keys-removed` shape, and the D3 entry
 * `list-view-filterable-fields-retired` carries the judgement it cannot make
 * (whether the author wanted a curated filter bar, which is `userFilters`).
 * Unlike that precedent the delete is NOT lossless in pixels: a stored view
 * that named a whitelist has its Filter panel widen to every field the user
 * may read, minus the fields the object marks `hidden` — the ruled end state.
 *
 * **Retired from the load path** — the key is a `retiredKey()` tombstone on
 * the list-view shape, so a live author is refused at parse with the
 * prescription. The entry exists because a stored `view` row CAN carry the
 * key: the Studio view form offered it as an input and every list-view door
 * accepted and persisted it until this release, and
 * `applyConversionsToStoredItem` replays the chain over stored `view` rows as
 * `{ views: [row] }`. Without it such a row would carry the retired key back
 * to the strict write door, which refuses it on the next save. It also lets
 * `os migrate meta --from 17` list the mechanical edits for existing sources.
 * `stripKeys` deletion is idempotent by construction.
 *
 * ⚠️ Coverage boundary, stated rather than left to be discovered: this walks
 * `stack.views[]` in all three persisted spellings ({@link mapViewPayloads}),
 * the reach `view-list-tabs-removed` has. `objects[].listViews.*` is reached
 * by no conversion in this registry, so an object body carrying the key is
 * refused at its own door rather than converted. Measured population for
 * both: zero authored `filterableFields` in this tree's examples, platform
 * objects, app packages, scaffolding templates or QA apps.
 */
const viewListFilterableFieldsRemoved: MetadataConversion = {
  id: 'view-list-filterable-fields-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'view.list.filterableFields / view.listViews.*.filterableFields — the list view\'s Filter-panel field whitelist',
  summary:
    "list-view key 'filterableFields' removed (ADR-0049 enforce-or-remove — declared as a shorthand "
    + 'for `userFilters.fields` while its one renderer read it as a whitelist of the fields the Filter '
    + 'panel offers; no per-view whitelist replaces it: a curated end-user filter bar is `userFilters`, '
    + 'and the Filter panel offers every field the user may read)',
  apply(stack, emit) {
    return mapViewPayloads(stack, (payload, kind, path) =>
      kind === 'list' ? stripKeys(payload, ['filterableFields'], emit, path) : payload);
  },
  fixture: {
    before: {
      views: [
        // A container: the default `list` and one named entry carry the key,
        // the other named entry does not and rides through by reference.
        // `searchableFields` beside it survives — a different key that stays.
        {
          object: 'crm_ticket',
          list: {
            type: 'grid',
            columns: ['subject'],
            searchableFields: ['subject'],
            filterableFields: ['status', 'priority'],
          },
          listViews: {
            triage: { type: 'grid', columns: ['subject'], filterableFields: ['status'] },
            all: { type: 'grid', columns: ['subject'] },
          },
        },
        // A ViewItem record: the payload hangs off `config`.
        {
          name: 'crm_ticket.queue',
          object: 'crm_ticket',
          viewKind: 'list',
          config: { type: 'grid', columns: ['subject'], filterableFields: [] },
        },
        // A form payload has no `filterableFields` key to strip — untouched.
        { name: 'crm_ticket.intake', object: 'crm_ticket', viewKind: 'form', config: { type: 'simple' } },
      ],
    },
    after: {
      views: [
        {
          object: 'crm_ticket',
          list: { type: 'grid', columns: ['subject'], searchableFields: ['subject'] },
          listViews: {
            triage: { type: 'grid', columns: ['subject'] },
            all: { type: 'grid', columns: ['subject'] },
          },
        },
        {
          name: 'crm_ticket.queue',
          object: 'crm_ticket',
          viewKind: 'list',
          config: { type: 'grid', columns: ['subject'] },
        },
        { name: 'crm_ticket.intake', object: 'crm_ticket', viewKind: 'form', config: { type: 'simple' } },
      ],
    },
    // One notice per key removed: `list`, `listViews.triage`, the record's `config`.
    expectedNotices: 3,
  },
};

export { viewListFilterableFieldsRemoved };
