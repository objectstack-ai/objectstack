// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `object-grid-resizable-columns-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `objectGridResizableColumnsRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `object-grid`'s legacy column-resize spelling leaves the contract (protocol
 * 18, #21445, ADR-0049 enforce-or-remove; objectui#6152 ruling A — `resizable`
 * is canonical — with the startup rule of immediate retirement).
 *
 * `resizableColumns` was the second spelling of `resizable`, read only as
 * `schema.resizable ?? schema.resizableColumns` — measured at the
 * `.objectui-sha` pin `89cad75d55`, `plugin-grid/src/ObjectGrid.tsx:5361`. One
 * switch, two spellings, and a grid authoring both silently ignored this one.
 *
 * The conversion follows that precedence exactly, so it preserves what every
 * grid has been doing. Where `resizable` is absent (or null — the `??` reads
 * through it) the legacy value WAS the grid's setting, so it moves to
 * `resizable` unchanged. Where `resizable` holds a value the legacy key was
 * never read, so it strips as a lossless delete — whatever the two values
 * were. Zero authored occurrences in either repository's corpora (the card's
 * measurement, re-run at dispatch), so this entry exists for stored
 * `sys_metadata` rows and for authors outside the repositories.
 *
 * objectui#6152 retires the renderer's `?? schema.resizableColumns` read on
 * its own schedule, once a released spec carries this.
 */
const objectGridResizableColumnsRemoved: MetadataConversion = {
  id: 'object-grid-resizable-columns-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.6.0',
  surface: 'page.component.object-grid.resizableColumns',
  summary:
    "object-grid component prop 'resizableColumns' removed (the legacy second spelling of "
    + "'resizable', read only when 'resizable' was absent, retires at once so 'resizable' is the one "
    + "spelling; the value moves to 'resizable' when that is absent, and is deleted when it is present)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'object-grid') return component;
      const properties = component.properties;
      if (!isDict(properties) || !('resizableColumns' in properties)) return component;
      if (properties.resizable != null) {
        // `resizable` holds a value: the legacy key was never read — a pure
        // lossless delete, whatever it said.
        const stripped = stripKeys(properties, ['resizableColumns'], emit, `${path}.properties`);
        return { ...component, properties: stripped };
      }
      // `resizable` absent (or null, which `??` reads through): the legacy key
      // WAS the setting. It moves, value unchanged.
      const { resizableColumns, ...rest } = properties;
      emit({ from: 'resizableColumns', to: 'resizable', path: `${path}.properties.resizable` });
      return { ...component, properties: { ...rest, resizable: resizableColumns } };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'account_desk',
          regions: [
            {
              name: 'main',
              components: [
                // The legacy key alone: it IS the setting, so it moves.
                {
                  type: 'object-grid',
                  id: 'g1',
                  properties: { objectName: 'crm_account', resizableColumns: false },
                },
                // Both spellings with DIFFERENT values: `resizable` wins (the
                // renderer's own precedence), so the legacy key strips.
                {
                  type: 'object-grid',
                  id: 'g2',
                  properties: { objectName: 'crm_account', resizable: true, resizableColumns: false },
                },
                // The same key name on a component that is NOT an
                // `object-grid` — not this entry's key. The strip is scoped
                // by component type, never by key name.
                {
                  type: 'object-kanban',
                  id: 'k1',
                  properties: { objectName: 'crm_account', resizableColumns: true },
                },
                // A grid without the key rides through untouched.
                {
                  type: 'object-grid',
                  id: 'g3',
                  properties: { objectName: 'crm_account', resizable: false },
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
                        properties: { objectName: 'crm_contact', resizableColumns: true },
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
          name: 'account_desk_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-grid',
              id: 'g5',
              properties: { objectName: 'crm_account', resizableColumns: false },
            },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'account_desk',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-grid',
                  id: 'g1',
                  properties: { objectName: 'crm_account', resizable: false },
                },
                {
                  type: 'object-grid',
                  id: 'g2',
                  properties: { objectName: 'crm_account', resizable: true },
                },
                {
                  type: 'object-kanban',
                  id: 'k1',
                  properties: { objectName: 'crm_account', resizableColumns: true },
                },
                {
                  type: 'object-grid',
                  id: 'g3',
                  properties: { objectName: 'crm_account', resizable: false },
                },
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-grid',
                        id: 'g4',
                        properties: { objectName: 'crm_contact', resizable: true },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'account_desk_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-grid',
              id: 'g5',
              properties: { objectName: 'crm_account', resizable: false },
            },
          },
        },
      ],
    },
    // Four notices: three renames (g1, the nested g4, the slotted g5) and one
    // strip (g2, where `resizable` already won). The kanban sibling and the
    // grid without the key emit none.
    expectedNotices: 4,
  },
};

export { objectGridResizableColumnsRemoved };
