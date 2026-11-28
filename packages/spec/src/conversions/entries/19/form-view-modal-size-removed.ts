// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, mapViewPayloads } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * `modalSize` leaves the form view (protocol 19, #36544 — ADR-0049
 * enforce-or-remove, seat ruling on the card: retire). Its one form-view
 * reader was the console's New / Edit record dialog, and that dialog stopped
 * loading a form view in 18 (#36425): it lays the record out by the object's
 * field groups and chooses its own size. A form opened by name, or shared by a
 * public link, gets a page of its own, never a dialog. So a stored
 * `modalSize: 'lg'` saved, served and changed nothing.
 *
 * Authoring refuses the key by its `retiredKey()` tombstone (`ui/view.zod.ts`).
 * Deleting is the whole edit, and it changes nothing a reader sees. The React
 * `ObjectForm` block keeps its own `modalSize` prop (`react-blocks.ts`
 * overlay) and the `object-form` PAGE BLOCK keeps it in
 * `ObjectFormPropsSchema`: its `formType: 'modal'` container reads it, so this
 * entry never walks page components.
 *
 * **Reach: every FORM payload**, as `form-view-drawer-keys-removed`:
 * {@link mapViewPayloads} (`form`, `formViews.*`, a form view item's `config`,
 * a flattened form overlay) and the assembled-manifest `viewItems` channel
 * ({@link ASSEMBLED_VIEW_ITEMS_KEY}); and a `forms[]` item (ADR-0159), whose
 * body keys are the form view's by reference, so the tombstone stands at that
 * door too. A list payload is never judged.
 *
 * The schema accepted the key through 18.6.0 and `PUT /meta/view` persists
 * form views, so a stored `view` row CAN carry it. **Retired from the load
 * path from day one**: a live author meets the parse's prescription, and this
 * entry serves stored-row rehydration, assembled artifacts and
 * `os migrate meta --from 18`. Idempotent by construction (`stripKeys`).
 *
 * Its D3 entry is `ui-form-view-modal-size-retired`.
 */
const formViewModalSizeRemoved: MetadataConversion = {
  id: 'form-view-modal-size-removed',
  toMajor: 19,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'view.form.modalSize / view.formViews.<key>.modalSize / form.modalSize',
  summary:
    'form view `modalSize` removed (no form view opens in a dialog: the console\'s New and Edit dialogs lay a '
    + 'record out by the object\'s field groups and choose their own size, and a form opened by name gets a '
    + 'page of its own, so nothing read the key from a form view). The key is deleted, which changes nothing '
    + 'a reader sees; the React `ObjectForm` block and the `object-form` page block keep their own '
    + '`modalSize` for the modal they open',
  apply(stack, emit) {
    const convertForm = (form: Dict, path: string): Dict => stripKeys(form, ['modalSize'], emit, path);
    const withViews = mapViewPayloads(stack, (payload, kind, path) =>
      kind === 'form' ? convertForm(payload, path) : payload);
    const withViewItems = mapCollection(withViews, ASSEMBLED_VIEW_ITEMS_KEY, (item, path) => {
      if (item.viewKind !== 'form') return item;
      if (isDict(item.config)) {
        const config = convertForm(item.config, `${path}.config`);
        return config === item.config ? item : { ...item, config };
      }
      // A flattened form overlay — the body IS the payload. A present but
      // malformed `config` is neither shape and is left for the parse.
      return item.config === undefined ? convertForm(item, path) : item;
    });
    // A `form` item's body sits at its top level (ADR-0159: no `config` wrapper).
    return mapCollection(withViewItems, 'forms', convertForm);
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'fms_task_desk',
          regions: [
            {
              name: 'main',
              components: [
                // The `object-form` page block keeps the key: its modal reads it.
                { type: 'object-form', properties: { objectName: 'fms_task', formType: 'modal', modalSize: 'lg' } },
              ],
            },
          ],
        },
      ],
      views: [
        {
          object: 'fms_task',
          // The key goes; the rest of the form rides through.
          form: { columns: 2, modalSize: 'full', sections: [{ label: 'Main', fields: ['title'] }] },
          formViews: {
            quick: { title: 'Quick', modalSize: 'lg' },
            // A form without the key rides through by reference.
            plain: { columns: 1 },
          },
        },
        // A form view item record: the payload is `config`.
        { name: 'fms_task.peek', object: 'fms_task', viewKind: 'form', config: { modalSize: 'sm' } },
        // A list payload is never judged.
        { name: 'fms_task.all', object: 'fms_task', viewKind: 'list', config: { type: 'grid', columns: ['title'] } },
      ],
      viewItems: [
        // An assembled flattened form overlay — the body IS the payload.
        { name: 'fms_task.side', object: 'fms_task', viewKind: 'form', modalSize: 'xl' },
      ],
      forms: [
        // A `form` item: the body is at the top level.
        { name: 'fms_task.intake', object: 'fms_task', modalSize: 'default', sections: [{ label: 'Intake', fields: ['title'] }] },
      ],
    },
    after: {
      pages: [
        {
          name: 'fms_task_desk',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'object-form', properties: { objectName: 'fms_task', formType: 'modal', modalSize: 'lg' } },
              ],
            },
          ],
        },
      ],
      views: [
        {
          object: 'fms_task',
          form: { columns: 2, sections: [{ label: 'Main', fields: ['title'] }] },
          formViews: {
            quick: { title: 'Quick' },
            plain: { columns: 1 },
          },
        },
        { name: 'fms_task.peek', object: 'fms_task', viewKind: 'form', config: {} },
        { name: 'fms_task.all', object: 'fms_task', viewKind: 'list', config: { type: 'grid', columns: ['title'] } },
      ],
      viewItems: [
        { name: 'fms_task.side', object: 'fms_task', viewKind: 'form' },
      ],
      forms: [
        { name: 'fms_task.intake', object: 'fms_task', sections: [{ label: 'Intake', fields: ['title'] }] },
      ],
    },
    // `form`, `quick`, the item record, the assembled overlay and the `form`
    // item: one each. The page block, `plain` and the list emit none.
    expectedNotices: 5,
  },
};

export { formViewModalSizeRemoved };
