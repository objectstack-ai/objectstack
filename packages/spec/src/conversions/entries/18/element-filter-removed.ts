// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `element-filter-removed` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `elementFilterRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `element:filter` — the whole element retired (protocol 18, #9220, ADR-0049
 * enforce-or-remove at ELEMENT grain).
 *
 * #9198 retired `targetVariable` per-key on the two input elements and left
 * this element's copy alone because the finding was wider than one key:
 * measured at retirement time (objectstack @2f65b1b42, objectui @5ffcc14; cloud
 * per the card's recorded sweep), NO renderer or behavior reader of
 * `element:filter` exists anywhere. objectui registers no renderer (its
 * `renderers/basic/elements.tsx` header deferred the element to "owning
 * plugins" that never materialized), Studio's designer palette carries it as a
 * no-renderer PALETTE_EXCLUSIONS entry ("list surfaces own filtering
 * (userFilters / filter builder)"), and the 2026-06 page-liveness audit
 * recorded it rendering "Unknown component type". Every key was a capability
 * claim nothing kept — per-key retirement would have been the wrong grain, so
 * all six authorable keys are tombstoned together and this conversion strips
 * them together.
 *
 * Pure lossless deletes — no key ever had an effect to lose. The component
 * node itself is NOT removed: deleting authored page nodes is a layout
 * decision a mechanical conversion must not make. The bare node it leaves is
 * not the end state — `element:filter` is a member of
 * `RETIRED_PAGE_COMPONENT_TYPES`, so the parse refuses it by name and the
 * prescription tells the author to delete the component and use the list
 * surface's own filtering instead. Mechanical where it can be, located where
 * it cannot.
 */
const elementFilterRemoved: MetadataConversion = {
  id: 'element-filter-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.0.0',
  surface:
    'page.component.element:filter.object / page.component.element:filter.fields / '
    + 'page.component.element:filter.targetVariable / page.component.element:filter.layout / '
    + 'page.component.element:filter.showSearch / page.component.element:filter.aria',
  summary:
    "the whole 'element:filter' element retired (ADR-0049 enforce-or-remove at element grain, "
    + 'not key by key — no renderer for it ever shipped in any repo, so every key was a '
    + 'capability claim nothing kept; list surfaces own their '
    + "filtering via a view's userFilters / the list filter builder). All six props are "
    + 'stripped; the bare node the conversion leaves is refused by name at the parse, with '
    + 'the prescription to delete the component',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'element:filter') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const stripped = stripKeys(
        properties,
        ['object', 'fields', 'targetVariable', 'layout', 'showSearch', 'aria'],
        emit,
        `${path}.properties`,
      );
      if (stripped === properties) return component;
      return { ...component, properties: stripped };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'order_board',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'element:filter',
                  properties: {
                    object: 'order',
                    fields: ['status', 'priority'],
                    targetVariable: 'active_filter',
                    layout: 'sidebar',
                    showSearch: true,
                  },
                },
                // Key overlap on a DIFFERENT type rides through untouched —
                // `object` is also a live `element:metadata_viewer` prop (its
                // metadata owner), and the strip dispatches on the component
                // type, not the key name. (The neighbor was `element:form`
                // until #9249 retired that element whole, then
                // `element:record_picker` until #11509 retired its flat
                // `object`; either one's own conversion would now touch it.)
                { type: 'element:metadata_viewer', properties: { type: 'state_machine', name: 'order_status', object: 'order' } },
                // Nested one container down (#6775) — the walk descends.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Orders',
                    children: [
                      { type: 'element:filter', properties: { object: 'order', fields: ['status'] } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape, on a slotted record page.
        {
          name: 'order_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            side: [
              {
                type: 'element:filter',
                properties: { object: 'order', fields: ['status'], aria: { label: 'Order filter' } },
              },
            ],
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'order_board',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'element:filter', properties: {} },
                { type: 'element:metadata_viewer', properties: { type: 'state_machine', name: 'order_status', object: 'order' } },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Orders',
                    children: [
                      { type: 'element:filter', properties: {} },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'order_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            side: [
              { type: 'element:filter', properties: {} },
            ],
          },
        },
      ],
    },
    // One per stripped key: 5 on the top-level node, 2 on the nested one,
    // 3 on the slotted one. The `element:metadata_viewer` neighbor is untouched.
    expectedNotices: 10,
  },
};

export { elementFilterRemoved };
