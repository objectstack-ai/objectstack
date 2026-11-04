// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `mapping-lookup-params-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `mappingLookupParamsRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `mapping.fieldMapping[].params` lookup keys removed (commit 15d58dbf1, ADR-0049
 * enforce-or-remove — the sub-walk half of the 17.0.0 #4509 mapping cleanup).
 *
 * `object` / `fromField` / `toField` / `autoCreate` declared a per-entry
 * reference-resolution dialect that the import path never implemented:
 * `applyMappingToRows` handles `lookup` in the same branch as `none` (the cell
 * is copied through unchanged), and reference resolution runs afterwards in
 * `import-coerce.ts` off the TARGET FIELD's own metadata — never off these
 * keys. Implementing them (a second reference-resolution dialect on the import
 * path) is what the code comment in `packages/rest/src/import-mapping.ts`
 * declines to build, and the triage ruling commit 15d58dbf1 landed confirms that posture.
 *
 * `autoCreate` was the one with teeth: it read as "create the referenced
 * record when nothing matches", and nothing was ever created — with or without
 * the key, an unresolved cell fails its row with `import_reference_not_found`.
 * The schema prescription says so outright, because an author who believed the
 * key is one support ticket away from "my import used to create these".
 *
 * **A pure lossless delete.** None of the four ever had an effect to lose, so
 * stripping them preserves observed import behaviour exactly.
 *
 * Scoped to the `mappings` collection, then drilled two levels down
 * (`fieldMapping[]` is an ARRAY one level below the item, `params` a dict one
 * below that), so the top-level-only `stripKeys` runs per entry's params bag —
 * the `metric-filters-removed` shape, one level deeper. Deliberately narrow:
 * `object` / `targetObject`-style keys are live all over the tree, and a
 * stack-wide strip would delete enforced keys from other types.
 */
const mappingLookupParamsRemoved: MetadataConversion = {
  id: 'mapping-lookup-params-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.2.0',
  surface: 'mapping.fieldMapping[].params.object / .fromField / .toField / .autoCreate',
  summary:
    "mapping lookup params 'object'/'fromField'/'toField'/'autoCreate' removed (ADR-0049 — "
    + 'the import path never read them: `lookup` copies the cell through and '
    + "reference resolution runs off the target field's own metadata. `autoCreate` never "
    + 'created anything — an unresolved reference fails the row either way. Implementing them '
    + 'instead would have added a second reference-resolution dialect to the import path)',
  apply(stack, emit) {
    const RETIRED = ['object', 'fromField', 'toField', 'autoCreate'];
    return mapCollection(stack, 'mappings', (m, path) => {
      const entries = m.fieldMapping;
      if (!Array.isArray(entries)) return m;
      let touched = false;
      const nextEntries = entries.map((entry, i) => {
        if (!isDict(entry)) return entry;
        const params = entry.params;
        if (!isDict(params)) return entry;
        const stripped = stripKeys(params, RETIRED, emit, `${path}.fieldMapping[${i}].params`);
        if (stripped === params) return entry;
        touched = true;
        return { ...entry, params: stripped };
      });
      if (!touched) return m;
      return { ...m, fieldMapping: nextEntries };
    });
  },
  fixture: {
    before: {
      mappings: [{
        name: 'csv_import_contacts',
        targetObject: 'contact',
        fieldMapping: [
          // The retired shape: a lookup entry steering nothing.
          {
            source: 'Account Name',
            target: 'account_id',
            transform: 'lookup',
            params: { object: 'account', fromField: 'name', toField: 'id', autoCreate: true },
          },
          // A live params bag on another transform rides through untouched —
          // the strip dispatches on key presence, and copy-on-write keeps the
          // reference.
          {
            source: 'Status',
            target: 'status',
            transform: 'map',
            params: { valueMap: { Open: 'open' } },
          },
          // No params at all — untouched.
          { source: 'Email', target: 'email' },
        ],
      }],
    },
    after: {
      mappings: [{
        name: 'csv_import_contacts',
        targetObject: 'contact',
        fieldMapping: [
          // The emptied bag stays: the conversion strips KEYS, and deleting
          // the bag itself would be a second, unprescribed edit. `params: {}`
          // parses clean.
          {
            source: 'Account Name',
            target: 'account_id',
            transform: 'lookup',
            params: {},
          },
          {
            source: 'Status',
            target: 'status',
            transform: 'map',
            params: { valueMap: { Open: 'open' } },
          },
          { source: 'Email', target: 'email' },
        ],
      }],
    },
    // Four notices: one per retired key on the single lookup entry.
    expectedNotices: 4,
  },
};

export { mappingLookupParamsRemoved };
