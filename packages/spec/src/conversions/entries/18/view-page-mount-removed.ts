// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `view-page-mount-removed` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `viewPageMountRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapViewPayloads } from '../../walk.js';
import { type Dict } from '../shared.js';

/**
 * The `type: 'page'` list-view mount leaves the spec (protocol 18, #17063 —
 * maintainer ruling 2026-09-09, decision batch #107 item 1, verbatim 「撤」).
 *
 * `page` was added to the list-view `type` enum with a `pageName` binding so a
 * view could render nothing of its own and delegate to an already-published
 * page (#13216 direction 1). Only the spec half landed (PR #13372). No renderer
 * ever routed the member: objectui's `ListView` switch shares its `default:`
 * arm with `case 'grid'`, and `isListViewVisualization('page')` is false — so a
 * `page` view has always drawn an empty grid where the page was supposed to be.
 * ADR-0049 enforce-or-remove, on the principle that a published capability with
 * zero consumers earns no exemption from its sunk cost.
 *
 * ## Why this STRIPS `type` rather than rewriting it to `'grid'`
 *
 * Deleting the key is not the platform choosing a view type: `type` carries
 * `.default('grid')` on {@link ListViewSchema}, so a payload with no `type`
 * parses to `grid` by the schema's own declared default — the same value, but
 * declared in one place instead of guessed here. And it lands the row on
 * exactly what it already rendered, so the conversion changes the document
 * without changing a pixel. `stripKeys`-shaped deletion is idempotent by
 * construction (a second replay finds nothing to remove).
 *
 * `pageName` is stripped unconditionally on a list payload, not only beside a
 * `page` type: the key is retired on every list-view door, and a pre-#13372 row
 * can carry it beside any type (the both-directions refusal that used to catch
 * that is retired with the mount).
 *
 * `retiredFromLoadPath`: the enum refuses `'page'` by name and `pageName` is a
 * `retiredKey()` tombstone, so a LIVE author is taught at parse rather than
 * silently rewritten. The entry exists so stored 17.x rows replay clean through
 * `applyConversionsToStoredItem`, and so `os migrate meta --from 17` lists the
 * mechanical edits for author sources.
 *
 * ⚠️ Coverage boundary, stated rather than left to be discovered: this walks
 * `stack.views[]` in all three persisted spellings ({@link mapViewPayloads}) —
 * the same reach `view-export-options-pdf-removed` has, and the same reach the
 * conversion walk offers. `objects[].listViews.*` is NOT reached by any
 * conversion in this registry, so an object body carrying a page mount is
 * refused at its own door rather than converted. Measured population for both:
 * zero authored `type: 'page'` list views in this tree or any consuming app the
 * seats can read (the 25 in-tree `type: 'page'` hits are app NAV items, a
 * different key on `PageNavItemSchema` that stays).
 */
const viewPageMountRemoved: MetadataConversion = {
  id: 'view-page-mount-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: "view.list / view.listViews.* — the list-view type 'page' and its pageName binding",
  summary:
    "list-view type 'page' and its `pageName` binding removed (retired rather than finished: the "
    + 'delegating render half was never built, so a page view fell through to the grid branch and '
    + 'drew an empty table; ADR-0049 enforce-or-remove)',
  apply(stack, emit) {
    const stripMount = (payload: Dict, path: string): Dict => {
      const hasPageType = payload.type === 'page';
      const hasPageName = 'pageName' in payload;
      if (!hasPageType && !hasPageName) return payload;
      const next = { ...payload };
      if (hasPageType) {
        // Deleted, not rewritten: `ListViewSchema.type` defaults to `'grid'`.
        emit({ from: 'page', to: '(removed)', path: `${path}.type` });
        delete next.type;
      }
      if (hasPageName) {
        emit({ from: 'pageName', to: '(removed)', path: `${path}.pageName` });
        delete next.pageName;
      }
      return next;
    };
    return mapViewPayloads(stack, (payload, kind, path) =>
      kind === 'list' ? stripMount(payload, path) : payload);
  },
  fixture: {
    before: {
      views: [{
        object: 'crm_contract',
        // A complete page mount: both keys go, and the surviving `columns: []`
        // is left alone — an empty column list is what the grid default
        // derivation already reads as "no authored projection".
        list: { type: 'page', pageName: 'contract_landing', columns: [] },
        listViews: {
          // A pre-#13372 row: `pageName` beside a type that never read it.
          strays: { type: 'grid', pageName: 'contract_landing', columns: ['name'] },
          // Neither key declared -> untouched, by reference.
          all: { type: 'grid', columns: ['name'] },
        },
      }],
    },
    after: {
      views: [{
        object: 'crm_contract',
        list: { columns: [] },
        listViews: {
          strays: { type: 'grid', columns: ['name'] },
          all: { type: 'grid', columns: ['name'] },
        },
      }],
    },
    expectedNotices: 3,
  },
};

export { viewPageMountRemoved };
