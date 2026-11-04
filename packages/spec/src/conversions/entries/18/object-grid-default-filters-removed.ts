// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `object-grid-default-filters-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helpers
// `gridFilterIsEmpty`, `gridFilterHasContent` are read by this conversion
// alone). A LEAF: it imports neither `registry.ts` nor another conversion's
// module. `registry.ts` imports `objectGridDefaultFiltersRemoved` and lists it
// where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { describeBlock, isDict, stripKeys } from '../shared.js';

/**
 * A `filter` value the grid's lowering reads as NOTHING — absent, `null`, an
 * empty rule array or an empty record — which is exactly when `object-grid`
 * read `defaultFilters` instead.
 */
function gridFilterIsEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return isDict(value) && Object.keys(value).length === 0;
}

/** A `filter` value with rules (or record keys) in it — the grid read it, and never `defaultFilters`. */
function gridFilterHasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return isDict(value) && Object.keys(value).length > 0;
}

/**
 * `object-grid`'s legacy base-filter fallback leaves the contract (protocol 18,
 * #11509, ruling A-narrow, sub-question 1: "retires with a conversion in the
 * shape `defaultSort`'s took").
 *
 * `defaultFilters` was the second spelling of `filter`: the same rules, read by
 * the grid only when `filter` lowered to nothing. #19514 narrowed it to the
 * rule array and said, in as many words, that refusing it outright needed its
 * own ruling; #11509 is that ruling. Its narrowing's D3 entry
 * (`object-grid-default-filters-rule-array`, unreleased in any major) is
 * absorbed into this retirement's, and so is the narrowing's D2 arm: the
 * `properties.defaultFilters` reach of `page-component-filter-record-to-rule-array`
 * is gone, because this entry runs BEFORE that one (order 35.5, below its 36)
 * and leaves no `defaultFilters` for it to see — a record-form fallback it
 * moves lands on `filter`, where that entry converts it like any other.
 *
 * The renderer's own precedence decides the rewrite, as it did for
 * {@link objectGridDefaultSortRemoved}:
 *
 * - `filter` EMPTY (absent, `null`, `[]` or `{}`) — the fallback WAS the
 *   grid's filter, so it moves onto `filter`, unchanged;
 * - `filter` WITH CONTENT — the fallback was never read, so it is deleted (a
 *   pure lossless delete), and so is an empty fallback beside anything;
 * - `filter` a value no lowering reads (a bare string, a number, a boolean) —
 *   the grid fell back to `defaultFilters` there too, but moving the fallback
 *   would overwrite what the author wrote at `filter`, so the site is left as
 *   stored and reported as a TODO.
 *
 * Zero authored occurrences in this repository (the showcase pins it at zero),
 * so the entry exists for stored `sys_metadata` rows and for authors outside
 * the repo. Retired from the load path: an author writing the key is refused
 * by `os validate`, `os build` and `os lint` (the component-props gate) with
 * the prescription.
 */
const objectGridDefaultFiltersRemoved: MetadataConversion = {
  id: 'object-grid-default-filters-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.component.object-grid.defaultFilters',
  summary:
    "object-grid component prop 'defaultFilters' removed (the legacy second spelling of 'filter', read "
    + "only when 'filter' lowered to nothing; its rules move onto an empty 'filter', and the key is "
    + "deleted beside a 'filter' that has content, which the grid always read instead)",
  apply(stack, emit, context) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'object-grid') return component;
      const properties = component.properties;
      if (!isDict(properties) || !('defaultFilters' in properties)) return component;
      const fallback = properties.defaultFilters;
      const filter = properties.filter;
      if (gridFilterIsEmpty(fallback) || gridFilterHasContent(filter)) {
        // Nothing to carry, or `filter` won: a lossless delete.
        return { ...component, properties: stripKeys(properties, ['defaultFilters'], emit, `${path}.properties`) };
      }
      if (gridFilterIsEmpty(filter)) {
        // The fallback WAS the filter: it moves, unchanged.
        const { defaultFilters, ...rest } = properties;
        emit({ from: 'defaultFilters', to: 'filter', path: `${path}.properties.filter` });
        return { ...component, properties: { ...rest, filter: defaultFilters } };
      }
      context?.reportTodo?.({
        path: `${path}.properties.defaultFilters`,
        from: JSON.stringify(fallback),
        reason: `On ${describeBlock(component)}, \`filter\` is ${JSON.stringify(filter)}, a value no filter `
          + 'lowering reads, so the grid fell back to `defaultFilters`; moving the fallback onto `filter` '
          + 'would overwrite what was written there. Write the rules the grid should apply at `filter` and '
          + 'delete `defaultFilters`. Left as stored, it no longer reaches the query.',
      });
      return component;
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'work_queue',
          regions: [
            {
              name: 'main',
              components: [
                // No `filter`: the fallback WAS the filter, so it moves.
                {
                  type: 'object-grid',
                  id: 'g1',
                  properties: {
                    objectName: 'crm_task',
                    defaultFilters: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
                  },
                },
                // `filter` has rules: the fallback was never read — deleted.
                {
                  type: 'object-grid',
                  id: 'g2',
                  properties: {
                    objectName: 'crm_task',
                    filter: [{ field: 'status', operator: 'equals', value: 'open' }],
                    defaultFilters: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
                  },
                },
                // `filter: []` lowers to nothing: the grid read the fallback.
                {
                  type: 'object-grid',
                  id: 'g3',
                  properties: {
                    objectName: 'crm_task',
                    filter: [],
                    defaultFilters: [{ field: 'priority', operator: 'equals', value: 'high' }],
                  },
                },
                // `defaultFilters` on a component that is not an object-grid —
                // not this entry's key (scoped by component type, never by key
                // name).
                {
                  type: 'object-kanban',
                  id: 'k1',
                  properties: {
                    objectName: 'crm_task',
                    defaultFilters: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
                  },
                },
                // Nested one container down: still a component.
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-grid',
                        id: 'g4',
                        properties: {
                          objectName: 'crm_lead',
                          defaultFilters: [{ field: 'status', operator: 'equals', value: 'new' }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape: `filter: {}` (an empty record) lowers to
        // nothing too, so the fallback moves onto it.
        {
          name: 'work_queue_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-grid',
              id: 'g5',
              properties: {
                objectName: 'crm_task',
                filter: {},
                defaultFilters: [{ field: 'status', operator: 'not_equals', value: 'done' }],
              },
            },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'work_queue',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-grid',
                  id: 'g1',
                  properties: {
                    objectName: 'crm_task',
                    filter: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
                  },
                },
                {
                  type: 'object-grid',
                  id: 'g2',
                  properties: {
                    objectName: 'crm_task',
                    filter: [{ field: 'status', operator: 'equals', value: 'open' }],
                  },
                },
                {
                  type: 'object-grid',
                  id: 'g3',
                  properties: {
                    objectName: 'crm_task',
                    filter: [{ field: 'priority', operator: 'equals', value: 'high' }],
                  },
                },
                {
                  type: 'object-kanban',
                  id: 'k1',
                  properties: {
                    objectName: 'crm_task',
                    defaultFilters: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
                  },
                },
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-grid',
                        id: 'g4',
                        properties: {
                          objectName: 'crm_lead',
                          filter: [{ field: 'status', operator: 'equals', value: 'new' }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'work_queue_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-grid',
              id: 'g5',
              properties: {
                objectName: 'crm_task',
                filter: [{ field: 'status', operator: 'not_equals', value: 'done' }],
              },
            },
          },
        },
      ],
    },
    // One per grid that carried the key: g1, g2, g3, g4, g5. The kanban
    // neighbour is untouched.
    expectedNotices: 5,
  },
};

export { objectGridDefaultFiltersRemoved };
