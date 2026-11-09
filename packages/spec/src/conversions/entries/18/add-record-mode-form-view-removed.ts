// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `add-record-mode-form-view-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `addRecordModeFormViewRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapAddRecordBlocks, stripKeys } from '../shared.js';

/**
 * `addRecord.mode` / `addRecord.formView` leave the authorable surface
 * (protocol 18, #24692 — ADR-0049 enforce-or-remove, ruling letter B′).
 *
 * Both keys parsed, were stored, and changed nothing: no renderer ever read
 * either. objectui's list Add button opens the object's create form, the one
 * the object list's New opens, whatever `mode` said (`inline`, its default,
 * was never built), and it never opened the form `formView` named. The create
 * form is chosen by convention instead — `formViews.create` when the object's
 * view container declares one, else `form` / `formViews.default` — and how it
 * opens stays the renderer's.
 *
 * **Retired from the load path** — both keys are `retiredKey()` tombstones on
 * `AddRecordConfigSchema`, so a live author is refused at parse with the
 * prescription. The entry exists because a stored row CAN carry them: every
 * list-view door, the object door and the page door accepted and persisted
 * them until this release, the Studio forms offered them, and the 18.0 parse
 * materialized `mode: 'inline'` into every built `addRecord`. Without it such a
 * row or artifact would carry a retired key back to a strict door. It also
 * lets `os migrate meta --from 17` list the mechanical edits for existing
 * sources.
 *
 * The delete is lossless in pixels: no renderer read either key, so removing
 * them changes no screen. A `formView` that named the object's `create` form
 * keeps opening it, by the convention above. `stripKeys` deletion is
 * idempotent by construction.
 */
const addRecordModeFormViewRemoved: MetadataConversion = {
  id: 'add-record-mode-form-view-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.0.0',
  surface: 'view.list.addRecord.mode / view.list.addRecord.formView / object.listViews.*.addRecord.mode / object.listViews.*.addRecord.formView / page.interfaceConfig.addRecord.mode / page.interfaceConfig.addRecord.formView / page.component.list-view.addRecord.mode / page.component.list-view.addRecord.formView',
  summary:
    "add-record keys 'mode'/'formView' removed (ADR-0049 enforce-or-remove — parsed and stored, read by "
    + 'no renderer: the Add button always opens the create form, chosen by convention as '
    + '`formViews.create` when declared, else the default form)',
  apply(stack, emit) {
    return mapAddRecordBlocks(stack, (block, path) => stripKeys(block, ['mode', 'formView'], emit, path));
  },
  fixture: {
    before: {
      views: [
        // A container: the default `list` carries both keys, the named entry
        // only `mode`, the other named entry neither and rides through.
        {
          object: 'arx_contact',
          list: { type: 'grid', columns: ['name'], addRecord: { enabled: true, mode: 'form', formView: 'create' } },
          listViews: {
            recent: { type: 'grid', columns: ['name'], addRecord: { enabled: true, position: 'both', mode: 'inline' } },
            all: { type: 'grid', columns: ['name'], addRecord: { enabled: false } },
          },
        },
      ],
      objects: [
        { name: 'arx_contact', label: 'Contact', listViews: { mine: { type: 'grid', columns: ['name'], addRecord: { enabled: true, formView: 'default' } } } },
      ],
      pages: [
        {
          name: 'arx_contacts',
          label: 'Contacts',
          type: 'list',
          interfaceConfig: { source: 'arx_contact', addRecord: { enabled: true, position: 'top', mode: 'modal', formView: 'default' } },
        },
        {
          name: 'arx_people',
          label: 'People',
          regions: [{ name: 'main', components: [{ type: 'list-view', properties: { addRecord: { enabled: true, mode: 'form' } } }] }],
        },
      ],
    },
    after: {
      views: [
        {
          object: 'arx_contact',
          list: { type: 'grid', columns: ['name'], addRecord: { enabled: true } },
          listViews: {
            recent: { type: 'grid', columns: ['name'], addRecord: { enabled: true, position: 'both' } },
            all: { type: 'grid', columns: ['name'], addRecord: { enabled: false } },
          },
        },
      ],
      objects: [
        { name: 'arx_contact', label: 'Contact', listViews: { mine: { type: 'grid', columns: ['name'], addRecord: { enabled: true } } } },
      ],
      pages: [
        {
          name: 'arx_contacts',
          label: 'Contacts',
          type: 'list',
          interfaceConfig: { source: 'arx_contact', addRecord: { enabled: true, position: 'top' } },
        },
        {
          name: 'arx_people',
          label: 'People',
          regions: [{ name: 'main', components: [{ type: 'list-view', properties: { addRecord: { enabled: true } } }] }],
        },
      ],
    },
    // One notice per key removed: `list` (2), `listViews.recent` (1), the
    // object's `listViews.mine` (1), the page's `interfaceConfig` (2), the
    // page `list-view` node's `properties` (1).
    expectedNotices: 7,
  },
};

export { addRecordModeFormViewRemoved };
