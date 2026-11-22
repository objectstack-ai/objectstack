// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `object-grid`'s single-click edit switch leaves the contract (protocol 18,
 * #36270, ADR-0049 enforce-or-remove; the maintainer's ruling A, one editing
 * model).
 *
 * A grid that renders editable now selects a cell first: a click selects it,
 * and double-click, Enter, F2 or typing opens its editor. That model has no
 * single-click entry, so `singleClickEdit` has nothing left to switch: `true`
 * (the renderer's default) would open the editor on the selecting click, and
 * `false` named the double-click entry the model already has. On a grid that
 * renders read-only the key never had an effect.
 *
 * So the key strips as a delete, whatever its value. The grid's behaviour
 * comes from `editable` and the viewer's write verdict, which the conversion
 * leaves alone. Zero authored occurrences in this repository's examples and
 * the hotcrm and gallery corpora (the card's measurement), so this entry
 * exists for stored `sys_metadata` rows and for authors outside the
 * repositories.
 */
const objectGridSingleClickEditRemoved: MetadataConversion = {
  id: 'object-grid-single-click-edit-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'page.component.object-grid.singleClickEdit',
  summary:
    "object-grid component prop 'singleClickEdit' removed (an editable grid now selects a cell on a "
    + "click and opens its editor on double-click, Enter, F2 or typing, so no single-click entry is left "
    + "for the key to switch; it is deleted, whatever its value)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'object-grid') return component;
      const properties = component.properties;
      if (!isDict(properties) || !('singleClickEdit' in properties)) return component;
      const stripped = stripKeys(properties, ['singleClickEdit'], emit, `${path}.properties`);
      return { ...component, properties: stripped };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'task_desk',
          regions: [
            {
              name: 'main',
              components: [
                // The renderer's default value, authored: deleted.
                {
                  type: 'object-grid',
                  id: 'g1',
                  properties: { objectName: 'crm_task', editable: true, singleClickEdit: true },
                },
                // `false` (the double-click entry the model already has):
                // deleted too, and `editable` rides through.
                {
                  type: 'object-grid',
                  id: 'g2',
                  properties: { objectName: 'crm_task', editable: true, singleClickEdit: false },
                },
                // The same key name on a component that is NOT an
                // `object-grid` — not this entry's key. The strip is scoped
                // by component type, never by key name.
                {
                  type: 'object-kanban',
                  id: 'k1',
                  properties: { objectName: 'crm_task', singleClickEdit: true },
                },
                // A grid without the key rides through untouched.
                {
                  type: 'object-grid',
                  id: 'g3',
                  properties: { objectName: 'crm_task', editable: false },
                },
                // The nested position: a grid inside a card's `children`.
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-grid',
                        id: 'g4',
                        properties: { objectName: 'crm_contact', singleClickEdit: true },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape: a grid authored into a slotted page.
        {
          name: 'task_desk_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-grid',
              id: 'g5',
              properties: { objectName: 'crm_task', editable: true, singleClickEdit: false },
            },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'task_desk',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-grid',
                  id: 'g1',
                  properties: { objectName: 'crm_task', editable: true },
                },
                {
                  type: 'object-grid',
                  id: 'g2',
                  properties: { objectName: 'crm_task', editable: true },
                },
                {
                  type: 'object-kanban',
                  id: 'k1',
                  properties: { objectName: 'crm_task', singleClickEdit: true },
                },
                {
                  type: 'object-grid',
                  id: 'g3',
                  properties: { objectName: 'crm_task', editable: false },
                },
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-grid',
                        id: 'g4',
                        properties: { objectName: 'crm_contact' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'task_desk_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-grid',
              id: 'g5',
              properties: { objectName: 'crm_task', editable: true },
            },
          },
        },
      ],
    },
    // Four notices, one per stripped key (g1, g2, the nested g4, the slotted
    // g5). The kanban sibling and the grid without the key emit none.
    expectedNotices: 4,
  },
};

export { objectGridSingleClickEditRemoved };
