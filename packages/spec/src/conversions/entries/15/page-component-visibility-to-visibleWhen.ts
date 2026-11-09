// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-component-visibility-to-visibleWhen` conversion
// (`toMajor: 15`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageComponentVisibilityToVisibleWhen` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { renameVisibilityAlias } from '../shared.js';

/**
 * Page component `visibility` → `visibleWhen` (protocol 15, ADR-0089 D2).
 *
 * The page-component spelling of the same predicate. Applies to every page
 * component {@link mapPageComponents} reaches — `regions[].components[]`,
 * `slots.<slot>`, and the containers a component nests under its `properties`
 * (#6776, #6775). (An AI agent's `visibility` property is a different,
 * unrelated surface and is not touched.)
 *
 * ## Retired from the load path at 18 (#23543, ruling F4 A)
 *
 * Same terms as {@link viewVisibleOnToVisibleWhen}, retired in the same change:
 * `PageComponentSchema.visibility` is a `retiredKey()` tombstone naming
 * `visibleWhen` (`ui/page.zod.ts`) and its parse-time fold is gone, so the
 * authoring funnel no longer replays this entry. Stored pages are the
 * `includeRetired` seams (stored-row rehydration, the artifact-ingestion door
 * inside its window); `os migrate meta` does not reach it, protocol 15 being
 * below `MIGRATION_SUPPORT_FLOOR`.
 */
const pageComponentVisibilityToVisibleWhen: MetadataConversion = {
  id: 'page-component-visibility-to-visibleWhen',
  toMajor: 15,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.component.visibility',
  summary: "page component key 'visibility' → 'visibleWhen' (ADR-0089)",
  apply(stack, emit) {
    // The region→component descent this used to open-code is the shared
    // `mapPageComponents` walker (#5509, adopted per #5511): identical
    // copy-on-write contract, identical `pages[i].regions[j].components[k]`
    // paths, and one fewer hand-rolled traversal to keep in step with
    // `PageComponentSchema`'s reach.
    return mapPageComponents(stack, (component, path) =>
      renameVisibilityAlias(component, 'visibility', path, emit));
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'crm_home',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'record:list', visibility: "page.selectedId != ''" },
                { type: 'element:divider' },
                // Nested one container down (#6775): the predicate means the
                // same thing inside a card as it does at region level, so the
                // walk reaches it there too.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Selected',
                    children: [{ type: 'record:detail', visibility: "page.selectedId != ''" }],
                  },
                },
              ],
            },
          ],
        },
        // …and in a named slot on a slotted record page (#6776).
        {
          name: 'crm_lead_record',
          kind: 'slotted',
          regions: [],
          slots: {
            highlights: { type: 'record:detail', visibility: "record.stage == 'won'" },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'crm_home',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'record:list', visibleWhen: "page.selectedId != ''" },
                { type: 'element:divider' },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Selected',
                    children: [{ type: 'record:detail', visibleWhen: "page.selectedId != ''" }],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'crm_lead_record',
          kind: 'slotted',
          regions: [],
          slots: {
            highlights: { type: 'record:detail', visibleWhen: "record.stage == 'won'" },
          },
        },
      ],
    },
    expectedNotices: 3,
  },
};

export { pageComponentVisibilityToVisibleWhen };
