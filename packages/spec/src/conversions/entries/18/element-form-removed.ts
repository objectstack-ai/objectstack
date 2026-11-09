// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `element-form-removed` conversion (`toMajor: 18`), moved
// out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `elementFormRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `element:form` — the whole element retired (protocol 18, #9249, ADR-0049
 * enforce-or-remove at ELEMENT grain).
 *
 * The #9220 shape one element over, recorded by that card's own verdict sweep
 * and re-measured at retirement time (objectstack @dd84ddd796, objectui
 * @3ece13e33; cloud per the card's two recorded readings @5f1bf23f / @a11458b):
 * NO renderer or behavior reader of `element:form` exists anywhere. objectui
 * registers no renderer (its `renderers/basic/elements.tsx` header deferred
 * the element to "owning plugins" that never materialized), Studio's designer
 * palette carries it as a no-renderer PALETTE_EXCLUSIONS entry naming the live
 * replacement ("no renderer — use the object-bound `object-form` block"), and
 * the 2026-06 page-liveness audit recorded it rendering "Unknown component
 * type". Every key was a capability claim nothing kept — per-key retirement
 * would have been the wrong grain, so all six authorable keys are tombstoned
 * together and this conversion strips them together.
 *
 * Pure lossless deletes — no key ever had an effect to lose. The component
 * node itself is NOT removed: deleting authored page nodes is a layout
 * decision a mechanical conversion must not make. The bare node it leaves is
 * not the end state — `element:form` is a member of
 * `RETIRED_PAGE_COMPONENT_TYPES`, so the parse refuses it by name and the
 * prescription tells the author to delete the component and use the
 * object-bound `object-form` block (#7751) instead — rendered,
 * designer-publishable, and carrying the same intent (`objectName`, `fields`,
 * `mode`, `submitText`). Mechanical where it can be, located where it cannot.
 */
const elementFormRemoved: MetadataConversion = {
  id: 'element-form-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.2.0',
  surface:
    'page.component.element:form.object / page.component.element:form.fields / '
    + 'page.component.element:form.mode / page.component.element:form.submitLabel / '
    + 'page.component.element:form.onSubmit / page.component.element:form.aria',
  summary:
    "the whole 'element:form' element retired (ADR-0049 enforce-or-remove at element grain, "
    + 'not key by key — no renderer for it ever shipped in any repo, so every key was a '
    + 'capability claim nothing kept; use the object-bound '
    + "'object-form' block instead — rendered and designer-publishable). All six props are "
    + 'stripped; the bare node the conversion leaves is refused by name at the parse, with '
    + 'the prescription to delete the component',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'element:form') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const stripped = stripKeys(
        properties,
        ['object', 'fields', 'mode', 'submitLabel', 'onSubmit', 'aria'],
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
          name: 'lead_board',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'element:form',
                  properties: {
                    object: 'lead',
                    fields: ['name', 'email'],
                    mode: 'edit',
                    submitLabel: 'Update Lead',
                    onSubmit: 'navigate_to("lead_detail")',
                  },
                },
                // Key overlap on a DIFFERENT type rides through untouched —
                // `object` is also a live `element:metadata_viewer` prop (its
                // metadata owner), and the strip dispatches on the component
                // type, not the key name. (The neighbor was
                // `element:record_picker` until #11509 retired its flat
                // `object`; that retirement's conversion would now touch it.)
                { type: 'element:metadata_viewer', properties: { type: 'state_machine', name: 'lead_status', object: 'lead' } },
                // Nested one container down (#6775) — the walk descends.
                {
                  type: 'page:card',
                  properties: {
                    title: 'New lead',
                    children: [
                      { type: 'element:form', properties: { object: 'lead', fields: ['name'] } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape, on a slotted record page.
        {
          name: 'lead_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            side: [
              {
                type: 'element:form',
                properties: { object: 'lead', mode: 'create', aria: { label: 'Quick create' } },
              },
            ],
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'lead_board',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'element:form', properties: {} },
                { type: 'element:metadata_viewer', properties: { type: 'state_machine', name: 'lead_status', object: 'lead' } },
                {
                  type: 'page:card',
                  properties: {
                    title: 'New lead',
                    children: [
                      { type: 'element:form', properties: {} },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'lead_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            side: [
              { type: 'element:form', properties: {} },
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

export { elementFormRemoved };
