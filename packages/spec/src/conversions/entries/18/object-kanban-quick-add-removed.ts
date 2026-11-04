// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `object-kanban-quick-add-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `objectKanbanQuickAddRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `object-kanban`'s per-column quick-add switch leaves the contract (protocol
 * 18, #17260, ADR-0049 enforce-or-remove; the spec half of the objectui#8285
 * director-seat ruling, decision batch #91, 2026-09-08 — ruled option B,
 * `quickAdd` is retired from the board. The ruling kept the control on the
 * `kanban-ui` block, where a React host can supply the runtime function it
 * needs; objectui has since retired that block (objectui#8257), so
 * `object-kanban` offers no quick-add control and no block a document can
 * name offers one either).
 *
 * **A pure lossless delete.** The key never had an effect to preserve.
 * Measured at the `.objectui-sha` pin (`53ded82bf`): the board FORWARDS it —
 * `ObjectKanban.tsx:931` spreads the authored bag into `KanbanRenderer`,
 * which passes `quickAdd={schema.quickAdd}` alongside
 * `onQuickAdd={schema.onQuickAdd}` (`plugin-kanban/src/index.tsx:196`) — but
 * `KanbanImpl` gates the affordance on BOTH (`:355`, `:368`), and
 * `onQuickAdd` is a host-supplied FUNCTION that JSON cannot carry and that no
 * producer puts on an `object-kanban` node (`ObjectKanban.tsx` names neither
 * half of the pair: 0 occurrences each, against 6 for the sibling
 * `onCardClick` in the same file). So the gate was permanently false and
 * deleting the key preserves observed behaviour exactly.
 *
 * ⚠️ Scoped by component `type`, never by key name, so the strip cannot
 * generalise into a name-keyed one: a node of any other type that authors the
 * same key is left alone. The `kanban-ui` block the ruling kept the control on
 * is retired (objectui#8257) and was never a component type this spec
 * declares, so no stack this walk reaches is expected to carry it. The
 * fixture's non-carrier control is an `object-grid` authoring the same key
 * name.
 *
 * The neighbouring forwarded keys `coverImageField` and `conditionalFormatting`
 * are LIVE and survive untouched (both are read on this very path, by
 * `KanbanRenderer` / `bucketCardsIntoColumns`).
 *
 * Zero authored occurrences in this repo's corpora — no `object-kanban`
 * component is authored anywhere under `examples/` or `apps/` at all (control:
 * `object-grid` 3, `object-metric` 8 in the same corpora, same instrument) —
 * so this entry exists for stored `sys_metadata` rows and for authors outside
 * the repo, which the filing seat explicitly could not measure.
 */
const objectKanbanQuickAddRemoved: MetadataConversion = {
  id: 'object-kanban-quick-add-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'page.component.object-kanban.quickAdd',
  summary:
    "object-kanban component prop 'quickAdd' removed (retired from the board under ADR-0049 "
    + 'enforce-or-remove — the affordance is gated on a '
    + "host-supplied 'onQuickAdd' function no producer puts on an object-kanban node, so the key "
    + "was accepted and dropped; delete the key — object-kanban offers no quick-add control)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'object-kanban') return component;
      const properties = component.properties;
      if (!isDict(properties) || !('quickAdd' in properties)) return component;
      const stripped = stripKeys(properties, ['quickAdd'], emit, `${path}.properties`);
      return { ...component, properties: stripped };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'delivery_board',
          regions: [
            {
              name: 'main',
              components: [
                // The carrier: an `object-kanban` authoring the retired key.
                {
                  type: 'object-kanban',
                  id: 'k1',
                  properties: { objectName: 'crm_task', groupBy: 'status', quickAdd: true },
                },
                // ⚠️ The same key name on a component that is NOT an
                // `object-kanban` — not this entry's key. Untouched: the strip
                // is scoped by component type, never by key name, which is what
                // keeps this key out of every other component type's reach.
                {
                  type: 'object-grid',
                  id: 'g1',
                  properties: { objectName: 'crm_task', quickAdd: true },
                },
                // A board WITHOUT the key rides through untouched — the strip
                // dispatches on key presence and the copy-on-write contract
                // keeps the reference.
                {
                  type: 'object-kanban',
                  id: 'k3',
                  properties: { objectName: 'crm_task', cardFields: ['title'] },
                },
                // The nested position (#6775's lesson): a board inside a
                // card's `children` is still a component.
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-kanban',
                        id: 'k4',
                        properties: { objectName: 'crm_lead', groupBy: 'stage', quickAdd: false },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape (#6776): a board authored into a slotted page.
        {
          name: 'delivery_board_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-kanban',
              id: 'k5',
              properties: { objectName: 'crm_task', groupBy: 'status', quickAdd: true },
            },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'delivery_board',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-kanban',
                  id: 'k1',
                  properties: { objectName: 'crm_task', groupBy: 'status' },
                },
                {
                  type: 'object-grid',
                  id: 'g1',
                  properties: { objectName: 'crm_task', quickAdd: true },
                },
                {
                  type: 'object-kanban',
                  id: 'k3',
                  properties: { objectName: 'crm_task', cardFields: ['title'] },
                },
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-kanban',
                        id: 'k4',
                        properties: { objectName: 'crm_lead', groupBy: 'stage' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'delivery_board_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-kanban',
              id: 'k5',
              properties: { objectName: 'crm_task', groupBy: 'status' },
            },
          },
        },
      ],
    },
    // Three notices: the region-level board, the nested one and the slotted
    // one. The `object-grid` sibling and the board without the key emit none.
    expectedNotices: 3,
  },
};

export { objectKanbanQuickAddRemoved };
