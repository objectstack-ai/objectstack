// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `view-list-tabs-removed` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `viewListTabsRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapViewPayloads } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * The list view's own `tabs` leaves the authorable surface (protocol 18,
 * #20301 — ADR-0049 enforce-or-remove; triage verdict RETIRE under the
 * maintainer's #18900 criterion: mainstream named-view switching is already
 * delivered here, by `listViews`).
 *
 * `ListViewSchema.tabs` parsed, was stored, and drew nothing. A list view's
 * own `tabs` has no reader, and objectui's `TabBar` — the one component that
 * would draw it — has zero production mounts at the pinned objectui sha. The
 * tab strip above an object's records is the saved-view switcher
 * (`ViewTabBar`), which renders one tab per NAMED LIST VIEW and reads no `tabs`
 * key. `userFilters.tabs`, a different key of the same element type, is read
 * and rendered (the page preset bar) and stays. The measurement, with lit
 * controls, is on the ledger row (`liveness/view.json`,
 * `/props/list/children/tabs`).
 *
 * **Retired from the load path** — the key is a `retiredKey()` tombstone on the
 * list-view shape, so a live author is refused at parse with the prescription
 * (which also says how to move each tab to a `listViews` entry — that move is
 * an authoring decision, never this conversion's). The entry exists because a
 * stored `view` row CAN carry the key: every list-view door accepted and
 * persisted it until this release, and `applyConversionsToStoredItem` replays
 * the chain over stored `view` rows as `{ views: [row] }`. Without it such a
 * row would carry the retired key back to the strict write door, which refuses
 * it on the next save, over a key that never had an effect. It also lets
 * `os migrate meta --from 17` list the mechanical edits for existing sources.
 *
 * The delete is lossless in pixels: no renderer ever drew the tabs, so
 * removing them changes no screen. `stripKeys` deletion is idempotent by
 * construction (a second replay finds nothing to remove).
 *
 * ⚠️ Coverage boundary, stated rather than left to be discovered: this walks
 * `stack.views[]` in all three persisted spellings ({@link mapViewPayloads}) —
 * the same reach `view-page-mount-removed`, `list-view-sort-string-clause-to-array`
 * and `view-export-options-pdf-removed` have. `objects[].listViews.*` is NOT
 * reached by any conversion in this registry, so an object body carrying the
 * key is refused at its own door rather than converted. Measured population
 * for both: zero authored list-view `tabs` in this tree's examples or platform
 * sources (the in-tree hits are test fixtures of two author-time reference
 * walks, which read raw input and never parse it); the one published skill
 * example that taught it is corrected in the same change.
 */
const viewListTabsRemoved: MetadataConversion = {
  id: 'view-list-tabs-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'view.list.tabs / view.listViews.*.tabs — the list view\'s own tab definitions',
  summary:
    "list-view key 'tabs' removed (ADR-0049 enforce-or-remove — parsed and stored, drawn by nothing: no "
    + 'renderer ever mounted a tab bar for it, and the tab strip above an object\'s records is the '
    + 'saved-view switcher, which renders one tab per `listViews` entry; move each tab you want to a '
    + 'named list view)',
  apply(stack, emit) {
    return mapViewPayloads(stack, (payload, kind, path) =>
      kind === 'list' ? stripKeys(payload, ['tabs'], emit, path) : payload);
  },
  fixture: {
    before: {
      views: [
        // A container: the default `list` and one named entry carry the key,
        // the other named entry does not and rides through by reference.
        {
          object: 'crm_ticket',
          list: {
            type: 'grid',
            columns: ['subject'],
            tabs: [{ name: 'mine', label: 'Mine', filter: [{ field: 'status', operator: 'equals', value: 'open' }] }],
          },
          listViews: {
            triage: { type: 'grid', columns: ['subject'], tabs: [{ name: 'urgent', label: 'Urgent' }] },
            all: { type: 'grid', columns: ['subject'] },
          },
        },
        // A ViewItem record: the payload hangs off `config`.
        {
          name: 'crm_ticket.queue',
          object: 'crm_ticket',
          viewKind: 'list',
          config: { type: 'grid', columns: ['subject'], tabs: [] },
        },
        // A form payload has no `tabs` key to strip — untouched.
        { name: 'crm_ticket.intake', object: 'crm_ticket', viewKind: 'form', config: { type: 'simple' } },
      ],
    },
    after: {
      views: [
        {
          object: 'crm_ticket',
          list: { type: 'grid', columns: ['subject'] },
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

export { viewListTabsRemoved };
