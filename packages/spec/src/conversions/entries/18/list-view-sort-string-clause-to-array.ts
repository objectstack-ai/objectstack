// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `list-view-sort-string-clause-to-array` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `listViewSortStringClauseToArray` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapViewPayloads } from '../../walk.js';

/**
 * [#17053] The bare string `sort` clause on a list-view payload becomes the
 * `{ field, order }[]` array — one sort orthography platform-wide.
 *
 * The ruling is objectui#8221's decision batch #77 (2026-09-07, option B), the
 * same one `object-block-sort-item-array` carries for the two
 * `ComponentPropsMap` doors. Its consumer half, objectui PR #8758, makes
 * `convertSortToQueryParams` REFUSE a runtime string — which is what made this
 * a p2 rather than a spelling preference: `ListViewSchema` was the PRODUCER of
 * those documents, so a view authored with `sort: 'created_at desc'` validated
 * upstream and failed downstream, and the author was told off by the wrong
 * layer.
 *
 * The rewrite is lossless and wholly mechanical, which is why the data repair
 * is a D2 conversion (the family's D3 entry,
 * `list-view-sort-string-clause-retired`, carries the clauses this rewrite
 * leaves alone): `'created_at desc'` carries exactly the tuple
 * `{ field: 'created_at', order: 'desc' }`; a bare field name meant ASCENDING,
 * so it is written out as `order: 'asc'` rather than omitted (`order` is
 * required on the entry); and the comma-separated multi-key form the wire
 * normalizer splits on becomes one entry per key, in the same order.
 *
 * ⚠️ A string that does NOT parse as that grammar is left ALONE and emits
 * nothing — the `'-field'` OData-ish dialect above all. That dialect belongs to
 * `RecordRelatedListProps.sort`, is normalised by objectui's own
 * `RelatedList.normalizeSortSpec`, never reaches `convertSortToQueryParams`,
 * and retiring it was NOT ruled; guessing a direction for it here would invent
 * an ordering the author never wrote. On a list view it now meets
 * {@link LIST_VIEW_SORT_STRING_RETIRED} at the door instead, which is the
 * honest outcome for a clause this conversion cannot lower.
 *
 * `retiredFromLoadPath`: the union refuses the string by name with a
 * prescription, so a LIVE author is taught at parse rather than silently
 * rewritten. The entry exists so stored 17.x rows replay clean through
 * `applyConversionsToStoredItem`, and so `os migrate meta --from 17` lists the
 * mechanical edits for author sources — which it has real work to do on: the
 * in-tree census found the clause authored on a shipped showcase list view.
 *
 * ⚠️ Coverage boundary, stated rather than left to be discovered: this walks
 * `stack.views[]` in all three persisted spellings ({@link mapViewPayloads}) —
 * the same reach `view-page-mount-removed` and `view-export-options-pdf-removed`
 * have, and the same reach the conversion walk offers. `objects[].listViews.*`
 * is NOT reached by any conversion in this registry, so an object body carrying
 * a string clause is refused at its own door rather than converted.
 */
const listViewSortStringClauseToArray: MetadataConversion = {
  id: 'list-view-sort-string-clause-to-array',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'view.list.sort / view.listViews.*.sort — the bare string sort clause',
  summary:
    'the bare string list-view `sort` clause becomes the `{ field, order }[]` array (one sort '
    + 'orthography platform-wide, the array: objectui already refuses the string, so the schema '
    + 'stops minting documents its own consumer refuses)',
  apply(stack, emit) {
    /** `'a desc, b'` -> `[{field:'a',order:'desc'},{field:'b',order:'asc'}]`, or `null`. */
    const lower = (clause: string): Array<{ field: string; order: 'asc' | 'desc' }> | null => {
      const parts = clause.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
      if (parts.length === 0) return null;
      const entries: Array<{ field: string; order: 'asc' | 'desc' }> = [];
      for (const part of parts) {
        // `<field>` or `<field> <asc|desc>`, and nothing else — a leading `-`
        // is the related-list dialect this conversion deliberately declines.
        const m = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\s+(asc|desc))?$/i
          .exec(part);
        if (!m) return null;
        entries.push({ field: m[1]!, order: (m[2]?.toLowerCase() as 'asc' | 'desc') ?? 'asc' });
      }
      return entries;
    };

    return mapViewPayloads(stack, (payload, kind, path) => {
      if (kind !== 'list' || typeof payload.sort !== 'string') return payload;
      const lowered = lower(payload.sort);
      if (!lowered) return payload;
      emit({ from: payload.sort, to: JSON.stringify(lowered), path: `${path}.sort` });
      return { ...payload, sort: lowered };
    });
  },
  fixture: {
    before: {
      views: [{
        object: 'crm_opportunity',
        // The single-key clause, the shape the showcase shipped.
        list: { sort: 'created_at desc', columns: ['name'] },
        listViews: {
          // A bare field name: ascending, written out rather than omitted.
          bare: { type: 'grid', sort: 'amount', columns: ['name'] },
          // The comma-separated multi-key form, one entry per key, in order.
          multi: { type: 'grid', sort: 'stage asc, amount desc', columns: ['name'] },
          // Already canonical -> untouched, by reference.
          canonical: {
            type: 'grid',
            sort: [{ field: 'amount', order: 'desc' }],
            columns: ['name'],
          },
        },
      }],
    },
    after: {
      views: [{
        object: 'crm_opportunity',
        list: { sort: [{ field: 'created_at', order: 'desc' }], columns: ['name'] },
        listViews: {
          bare: { type: 'grid', sort: [{ field: 'amount', order: 'asc' }], columns: ['name'] },
          multi: {
            type: 'grid',
            sort: [{ field: 'stage', order: 'asc' }, { field: 'amount', order: 'desc' }],
            columns: ['name'],
          },
          canonical: {
            type: 'grid',
            sort: [{ field: 'amount', order: 'desc' }],
            columns: ['name'],
          },
        },
      }],
    },
    expectedNotices: 3,
  },
};

export { listViewSortStringClauseToArray };
