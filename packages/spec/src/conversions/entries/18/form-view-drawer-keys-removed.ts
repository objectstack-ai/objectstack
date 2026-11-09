// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `form-view-drawer-keys-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `formViewDrawerKeysRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, mapViewPayloads } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * `drawerSide` and `drawerWidth` leave the form view (protocol 18, #29012 —
 * ADR-0049 enforce-or-remove, triage ruling: retire). `type: 'drawer'` left the
 * form view in #27155 ({@link formViewPresentationTypesRemoved}), so no form
 * view opens in a drawer, and no metadata form-view surface reads either key:
 * a stored `drawerSide: 'left'` saved, served and changed nothing.
 *
 * Authoring refuses both keys by their `retiredKey()` tombstones
 * (`ui/view.zod.ts`). Deleting is the whole edit, and it changes nothing a
 * reader sees. The React `ObjectForm` block keeps its own `drawerSide` /
 * `drawerWidth` props (`react-blocks.ts` overlay) and the `object-form` PAGE
 * BLOCK keeps them in `ObjectFormPropsSchema`: its `formType: 'drawer'`
 * container reads them, so this entry never walks page components.
 *
 * **Reach: every FORM payload**, as {@link formViewButtonsResetRemoved}:
 * {@link mapViewPayloads} (`form`, `formViews.*`, a form view item's `config`,
 * a flattened form overlay) and the assembled-manifest `viewItems` channel
 * ({@link ASSEMBLED_VIEW_ITEMS_KEY}). A list payload is never judged.
 *
 * The schema accepted both keys through 18.2.0 and `PUT /meta/view` persists
 * form views, so a stored `view` row CAN carry them. **Retired from the load
 * path from day one**: a live author meets the parse's prescription, and this
 * entry serves stored-row rehydration, assembled artifacts and
 * `os migrate meta`. Idempotent by construction (`stripKeys`).
 *
 * Its D3 entry is `ui-form-view-drawer-keys-retired`.
 */
const formViewDrawerKeysRemoved: MetadataConversion = {
  id: 'form-view-drawer-keys-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface: 'view.form.drawerSide / view.form.drawerWidth / view.formViews.<key>.drawerSide / view.formViews.<key>.drawerWidth',
  summary:
    'form view `drawerSide` and `drawerWidth` removed (no form view opens in a drawer since `type: \'drawer\'` '
    + 'retired, and no form-view surface read either key). Both keys are deleted, which changes nothing a reader '
    + 'sees; the React `ObjectForm` block and the `object-form` page block keep their own `drawerSide` / '
    + '`drawerWidth` for the drawer they open',
  apply(stack, emit) {
    const convertForm = (form: Dict, path: string): Dict => stripKeys(form, ['drawerSide', 'drawerWidth'], emit, path);
    const withViews = mapViewPayloads(stack, (payload, kind, path) =>
      kind === 'form' ? convertForm(payload, path) : payload);
    return mapCollection(withViews, ASSEMBLED_VIEW_ITEMS_KEY, (item, path) => {
      if (item.viewKind !== 'form') return item;
      if (isDict(item.config)) {
        const config = convertForm(item.config, `${path}.config`);
        return config === item.config ? item : { ...item, config };
      }
      // A flattened form overlay — the body IS the payload. A present but
      // malformed `config` is neither shape and is left for the parse.
      return item.config === undefined ? convertForm(item, path) : item;
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'fvd_task_desk',
          regions: [
            {
              name: 'main',
              components: [
                // The `object-form` page block keeps both keys: its drawer reads them.
                { type: 'object-form', properties: { objectName: 'fvd_task', formType: 'drawer', drawerSide: 'left', drawerWidth: '480px' } },
              ],
            },
          ],
        },
      ],
      views: [
        {
          object: 'fvd_task',
          // Both keys go; the rest of the form rides through.
          form: { columns: 2, drawerSide: 'left', drawerWidth: '480px', sections: [{ label: 'Main', fields: ['title'] }] },
          formViews: {
            // `modalSize` is live (the console's record dialog reads it) and stays.
            quick: { modalSize: 'lg', drawerWidth: '50%' },
            // A form without the keys rides through by reference.
            plain: { columns: 1 },
          },
        },
        // A form view item record: the payload is `config`.
        { name: 'fvd_task.peek', object: 'fvd_task', viewKind: 'form', config: { drawerSide: 'right' } },
        // A list payload is never judged.
        { name: 'fvd_task.all', object: 'fvd_task', viewKind: 'list', config: { type: 'grid', columns: ['title'] } },
      ],
      viewItems: [
        // An assembled flattened form overlay — the body IS the payload.
        { name: 'fvd_task.side', object: 'fvd_task', viewKind: 'form', drawerSide: 'top' },
      ],
    },
    after: {
      pages: [
        {
          name: 'fvd_task_desk',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'object-form', properties: { objectName: 'fvd_task', formType: 'drawer', drawerSide: 'left', drawerWidth: '480px' } },
              ],
            },
          ],
        },
      ],
      views: [
        {
          object: 'fvd_task',
          form: { columns: 2, sections: [{ label: 'Main', fields: ['title'] }] },
          formViews: {
            quick: { modalSize: 'lg' },
            plain: { columns: 1 },
          },
        },
        { name: 'fvd_task.peek', object: 'fvd_task', viewKind: 'form', config: {} },
        { name: 'fvd_task.all', object: 'fvd_task', viewKind: 'list', config: { type: 'grid', columns: ['title'] } },
      ],
      viewItems: [
        { name: 'fvd_task.side', object: 'fvd_task', viewKind: 'form' },
      ],
    },
    // `form`: both keys (2). `quick`, the item record and the assembled
    // overlay: one each (3). The page block, `plain` and the list emit none.
    expectedNotices: 5,
  },
};

export { formViewDrawerKeysRemoved };
