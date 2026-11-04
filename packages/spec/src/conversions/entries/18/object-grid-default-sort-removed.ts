// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `object-grid-default-sort-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `objectGridDefaultSortRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `object-grid`'s legacy single-sort fallback leaves the contract (protocol 18,
 * #11805, ADR-0049 enforce-or-remove; maintainer ruling 2026-08-25,
 * decision-inbox batch 4 — the producer half of objectui#5861, under the
 * objectui#4869 「接受所有」 direction).
 *
 * `defaultSort` was the second spelling of `sort`: a SINGLE `{ field, order }`
 * pair the renderer read only when `sort` was absent — measured at the
 * `.objectui-sha` pin (`190fbd01d`), `plugin-grid/src/ObjectGrid.tsx:1244-1246`
 * (the `$orderby` fetch fallback) and `:2847`, where the header-arrow path
 * wraps it `[schema.defaultSort]`, the exact array shape `sort` carries. One
 * intent, two spellings, and only the spec's strictObject can refuse the
 * legacy one: objectui's mirror schema exists for parity tests and parses
 * nothing at runtime, so stopping the reads without this producer-side
 * retirement would turn a declared contract into a silent no-op.
 *
 * NOT a pure lossless delete, unlike the retired `page-structure-inert-keys-removed`
 * (#25767):
 * when `sort` is absent the fallback WAS the grid's sort, so the conversion
 * carries the pair over — renamed to `sort` and wrapped in the array shape the
 * renderer itself wraps it into at `:2847`. When `sort` is present the
 * fallback was never read (the renderer's own precedence), and the key strips
 * as a lossless delete. Zero authored occurrences in either repo's corpora
 * (the card's measurement, re-run at dispatch), so this entry exists for
 * stored `sys_metadata` rows and for authors outside the repo.
 *
 * objectui#5861 (retire the renderer's two reads) is the consumer half and
 * proceeds on its own schedule after a released spec version reaches the pin.
 */
const objectGridDefaultSortRemoved: MetadataConversion = {
  id: 'object-grid-default-sort-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.2.0',
  surface: 'page.component.object-grid.defaultSort',
  summary:
    "object-grid component prop 'defaultSort' removed (retired under ADR-0049 enforce-or-remove "
    + "as the legacy single-sort second spelling of 'sort', read only when 'sort' was absent; the "
    + 'pair moves to sort: [{ field, order }], the array shape every read path honours)',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'object-grid') return component;
      const properties = component.properties;
      if (!isDict(properties) || !('defaultSort' in properties)) return component;
      if ('sort' in properties) {
        // `sort` present: the fallback was never read — a pure lossless delete.
        const stripped = stripKeys(properties, ['defaultSort'], emit, `${path}.properties`);
        return { ...component, properties: stripped };
      }
      // `sort` absent: the fallback WAS the sort. Carry the pair, wrapped in
      // the array shape `sort` reads (the renderer's own `[schema.defaultSort]`
      // equivalence); an already-array value moves as-is — an array never
      // worked in `defaultSort` (the fetch path read `.field` off it), and
      // `sort` is where an array is legal.
      const { defaultSort, ...rest } = properties;
      emit({ from: 'defaultSort', to: 'sort', path: `${path}.properties.sort` });
      return {
        ...component,
        properties: { ...rest, sort: Array.isArray(defaultSort) ? defaultSort : [defaultSort] },
      };
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
                // The fallback IS the sort: no `sort` beside it, so the pair
                // moves — renamed and wrapped.
                {
                  type: 'object-grid',
                  id: 'g1',
                  properties: { objectName: 'crm_task', defaultSort: { field: 'due_date', order: 'asc' } },
                },
                // Both spellings authored: `sort` wins (the renderer's own
                // precedence), so the fallback strips as a lossless delete.
                {
                  type: 'object-grid',
                  id: 'g2',
                  properties: {
                    objectName: 'crm_task',
                    sort: [{ field: 'priority', order: 'desc' }],
                    defaultSort: { field: 'due_date', order: 'asc' },
                  },
                },
                // `defaultSort` on a component that is not an object-grid —
                // not this entry's key (the strip is scoped by component type,
                // never by key name).
                {
                  type: 'object-kanban',
                  id: 'k1',
                  properties: { objectName: 'crm_task', defaultSort: { field: 'due_date', order: 'asc' } },
                },
                // The nested position (#6775's lesson): a grid inside a card's
                // `children` is still a component.
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-grid',
                        id: 'g3',
                        properties: { objectName: 'crm_lead', defaultSort: { field: 'created_at', order: 'desc' } },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape (#6776): a grid authored into a slotted page.
        {
          name: 'work_queue_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-grid',
              id: 'g4',
              properties: { objectName: 'crm_task', defaultSort: { field: 'updated_at', order: 'desc' } },
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
                  properties: { objectName: 'crm_task', sort: [{ field: 'due_date', order: 'asc' }] },
                },
                {
                  type: 'object-grid',
                  id: 'g2',
                  properties: {
                    objectName: 'crm_task',
                    sort: [{ field: 'priority', order: 'desc' }],
                  },
                },
                {
                  type: 'object-kanban',
                  id: 'k1',
                  properties: { objectName: 'crm_task', defaultSort: { field: 'due_date', order: 'asc' } },
                },
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-grid',
                        id: 'g3',
                        properties: { objectName: 'crm_lead', sort: [{ field: 'created_at', order: 'desc' }] },
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
              id: 'g4',
              properties: { objectName: 'crm_task', sort: [{ field: 'updated_at', order: 'desc' }] },
            },
          },
        },
      ],
    },
    // Four notices: three wrap-and-renames (g1, the nested g3, the slotted g4)
    // and one strip (g2, where `sort` already won).
    expectedNotices: 4,
  },
};

export { objectGridDefaultSortRemoved };
