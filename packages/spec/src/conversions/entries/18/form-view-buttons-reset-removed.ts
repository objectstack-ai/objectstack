// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `form-view-buttons-reset-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `formViewButtonsResetRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, mapViewPayloads } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * `buttons.reset` leaves the form view (protocol 18, #27153 — ADR-0049
 * enforce-or-remove, ruled retire on the card): six console form button bars
 * draw `submit` and `cancel`, none drew a reset button, and `reset.label` had
 * no reader. The one fold that read `reset.show` mapped it onto ObjectForm's
 * clear-after-save flag, so the key never did what it said.
 *
 * Authoring refuses the key by its `retiredKey()` tombstone inside the
 * `buttons` block (`ui/view.zod.ts`); `submit` and `cancel` beside it are
 * untouched. Deleting is the whole edit. A `buttons` block left empty stays an
 * empty block, which parses and draws the default buttons.
 *
 * **Reach: every FORM payload**, as
 * {@link formViewPresentationTypesRemoved}: {@link mapViewPayloads}
 * (`form`, `formViews.*`, a form view item's `config`, a flattened form
 * overlay) and the assembled-manifest `viewItems` channel
 * ({@link ASSEMBLED_VIEW_ITEMS_KEY}). A list payload is never judged.
 *
 * The block accepted `reset` through 18.2.0 and `PUT /meta/view` persists form
 * views, so a stored `view` row CAN carry it. **Retired from the load path from
 * day one**: a live author meets the parse's prescription, and this entry
 * serves stored-row rehydration, assembled artifacts and `os migrate meta`.
 * Idempotent by construction (`stripKeys`).
 *
 * Behaviour after the edit: `reset.show: true` used to clear the form after
 * each save (the ObjectForm fold that ObjectView and the record form page
 * render). A converted row no longer clears after a save. This entry does NOT
 * map the key onto `submitBehavior`, because whether the author wanted the
 * clear is not decidable from the row; the D3 entry
 * `ui-form-view-buttons-reset-retired` carries that, and names
 * `submitBehavior: { kind: 'continue' }` for an author who did.
 */
const formViewButtonsResetRemoved: MetadataConversion = {
  id: 'form-view-buttons-reset-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface: 'view.form.buttons.reset / view.formViews.<key>.buttons.reset',
  summary:
    'form view `buttons.reset` removed (no form drew a reset button and its label had no reader; a form has '
    + '`submit` and `cancel` only). The key is deleted; `submit` and `cancel` are unchanged. A form whose '
    + '`reset.show: true` cleared it after a save no longer clears; `submitBehavior: { kind: \'continue\' }` '
    + 'declares that',
  apply(stack, emit) {
    const convertForm = (form: Dict, path: string): Dict => {
      const buttons = form.buttons;
      if (!isDict(buttons)) return form;
      const stripped = stripKeys(buttons, ['reset'], emit, `${path}.buttons`);
      return stripped === buttons ? form : { ...form, buttons: stripped };
    };
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
      views: [
        {
          object: 'fvr_ticket',
          // `submit` and `cancel` ride through; only `reset` goes.
          form: { buttons: { submit: { label: 'Send' }, cancel: { show: false }, reset: { show: true, label: 'Clear' } } },
          formViews: {
            // A block holding only `reset` is left as an empty block.
            quick: { buttons: { reset: { show: false } } },
            // A form without `reset` rides through by reference.
            plain: { buttons: { submit: { show: true } } },
          },
        },
        // A form view item record: the payload is `config`.
        { name: 'fvr_ticket.peek', object: 'fvr_ticket', viewKind: 'form', config: { buttons: { reset: { label: 'Undo' } } } },
        // A list payload is never judged.
        { name: 'fvr_ticket.all', object: 'fvr_ticket', viewKind: 'list', config: { type: 'grid', columns: ['subject'] } },
      ],
      viewItems: [
        // An assembled flattened form overlay — the body IS the payload.
        { name: 'fvr_ticket.side', object: 'fvr_ticket', viewKind: 'form', buttons: { reset: { show: true } } },
      ],
    },
    after: {
      views: [
        {
          object: 'fvr_ticket',
          form: { buttons: { submit: { label: 'Send' }, cancel: { show: false } } },
          formViews: {
            quick: { buttons: {} },
            plain: { buttons: { submit: { show: true } } },
          },
        },
        { name: 'fvr_ticket.peek', object: 'fvr_ticket', viewKind: 'form', config: { buttons: {} } },
        { name: 'fvr_ticket.all', object: 'fvr_ticket', viewKind: 'list', config: { type: 'grid', columns: ['subject'] } },
      ],
      viewItems: [
        { name: 'fvr_ticket.side', object: 'fvr_ticket', viewKind: 'form', buttons: {} },
      ],
    },
    // `form`, `quick`, the item record and the assembled overlay: one each.
    expectedNotices: 4,
  },
};

export { formViewButtonsResetRemoved };
