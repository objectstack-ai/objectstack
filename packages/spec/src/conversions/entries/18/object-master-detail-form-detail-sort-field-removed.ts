// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `object-master-detail-form-detail-sort-field-removed`
// conversion (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `objectMasterDetailFormDetailSortFieldRemoved` and lists it where it
// stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `object-master-detail-form`'s detail entry `sortField` leaves the contract
 * (protocol 18, #21589 — ADR-0049 enforce-or-remove; the spec half of
 * objectui#11070 round 9, the direction recorded on #21220's landing and
 * mirrored on objectui#11396 ③: tombstone plus ADR-0087).
 *
 * **A pure lossless delete.** The console stopped reading the authored
 * override at objectui `0a3e5409f`, and the `.objectui-sha` pin
 * (`89cad75d5570`) is past it: `MasterDetailDetailConfig` has no `sortField`
 * member (`plugin-form/src/MasterDetailForm.tsx:83`), and the field the line
 * grid stamps with each line's position is the one `deriveDetail` derives from
 * the child object (`deriveMasterDetail.ts:540`), handed to the grid as
 * `sort_field` (`:874`). An authored value changed nothing on that console, so
 * deleting it preserves observed behaviour exactly; the line order is kept by
 * the child object's own field, which the entry's tombstone names. The
 * tombstone refuses the key for a live author: `os validate`, `os build` and
 * `os lint` refuse it as an `error` with the prescription (the component-props
 * gate, `@objectstack/lint`; the load path keeps the open `properties` bag as
 * written).
 *
 * ⚠️ Scoped by component `type` and by POSITION — `properties.details[]` of an
 * `object-master-detail-form` — never by key name: `sortField` is an ordinary
 * name for an open-namespace component's own prop, and the fixture's
 * non-carrier control is such a component authoring the same shape. A
 * `details` entry that is not an object rides through untouched (the props
 * gate reports it; it is not this entry's to fix).
 *
 * Zero authored occurrences in this repo's corpora at the retirement — no
 * detail entry under `examples/`, `apps/`, `packages/`, `skills/` or
 * `content/docs/` writes the key (control: the sibling detail-entry key
 * `addLabel`, authored on the showcase project workspace's entry, same
 * instrument, origin/main 9a4182a752) — so this entry exists for stored
 * `sys_metadata` rows and for authors outside the repo, which the census could
 * not measure.
 */
const objectMasterDetailFormDetailSortFieldRemoved: MetadataConversion = {
  id: 'object-master-detail-form-detail-sort-field-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.6.0',
  surface: 'page.component.object-master-detail-form.details[].sortField',
  summary:
    "object-master-detail-form detail entry prop 'sortField' removed (the console reads no authored "
    + 'value: the line grid stamps the field it derives from the child object, so the key was '
    + "accepted and dropped; delete the key — the child object's own position field keeps the line order)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'object-master-detail-form') return component;
      const properties = component.properties;
      if (!isDict(properties) || !Array.isArray(properties.details)) return component;
      const details = properties.details as unknown[];
      let changed = false;
      const nextDetails = details.map((entry, i) => {
        if (!isDict(entry) || !('sortField' in entry)) return entry;
        changed = true;
        return stripKeys(entry, ['sortField'], emit, `${path}.properties.details[${i}]`);
      });
      if (!changed) return component;
      return { ...component, properties: { ...properties, details: nextDetails } };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'invoice_entry',
          regions: [
            {
              name: 'main',
              components: [
                // The carrier: a detail entry authoring the retired override,
                // beside an entry WITHOUT it, which rides through untouched.
                {
                  type: 'object-master-detail-form',
                  id: 'm1',
                  properties: {
                    objectName: 'crm_invoice',
                    details: [
                      { childObject: 'crm_invoice_line', title: 'Lines', sortField: 'line_no' },
                      { childObject: 'crm_invoice_payment', title: 'Payments' },
                    ],
                  },
                },
                // ⚠️ The same shape on a component that is NOT an
                // `object-master-detail-form` — its own prop, not this entry's
                // key. Untouched: the strip is scoped by component type.
                {
                  type: 'acme:line_editor',
                  id: 'x1',
                  properties: { details: [{ childObject: 'crm_invoice_line', sortField: 'position' }] },
                },
                // A block whose entries carry no `sortField`, and one with a
                // non-object entry: both ride through untouched, by reference.
                {
                  type: 'object-master-detail-form',
                  id: 'm2',
                  properties: { objectName: 'crm_order', details: [{ childObject: 'crm_order_line' }, 'crm_order_note'] },
                },
                // The nested position (#6775's lesson): a block inside a
                // card's `children` is still a component.
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-master-detail-form',
                        id: 'm3',
                        properties: {
                          objectName: 'crm_quote',
                          details: [{ childObject: 'crm_quote_line', sortField: 'position' }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape (#6776): the block authored into a slotted page.
        {
          name: 'invoice_entry_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-master-detail-form',
              id: 'm4',
              properties: {
                objectName: 'crm_invoice',
                details: [{ childObject: 'crm_invoice_line', sortField: 'sequence' }],
              },
            },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'invoice_entry',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-master-detail-form',
                  id: 'm1',
                  properties: {
                    objectName: 'crm_invoice',
                    details: [
                      { childObject: 'crm_invoice_line', title: 'Lines' },
                      { childObject: 'crm_invoice_payment', title: 'Payments' },
                    ],
                  },
                },
                {
                  type: 'acme:line_editor',
                  id: 'x1',
                  properties: { details: [{ childObject: 'crm_invoice_line', sortField: 'position' }] },
                },
                {
                  type: 'object-master-detail-form',
                  id: 'm2',
                  properties: { objectName: 'crm_order', details: [{ childObject: 'crm_order_line' }, 'crm_order_note'] },
                },
                {
                  type: 'page:card',
                  id: 'c1',
                  properties: {
                    children: [
                      {
                        type: 'object-master-detail-form',
                        id: 'm3',
                        properties: { objectName: 'crm_quote', details: [{ childObject: 'crm_quote_line' }] },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'invoice_entry_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: {
              type: 'object-master-detail-form',
              id: 'm4',
              properties: { objectName: 'crm_invoice', details: [{ childObject: 'crm_invoice_line' }] },
            },
          },
        },
      ],
    },
    // Three notices: the region-level entry, the nested one and the slotted
    // one. The open-namespace sibling and the entries without the key emit none.
    expectedNotices: 3,
  },
};

export { objectMasterDetailFormDetailSortFieldRemoved };
