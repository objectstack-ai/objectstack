// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { type Dict, isDict } from '../shared.js';

/**
 * A relationship field's boolean `inlineEdit` leaves the contract (protocol
 * 18, #35926, ADR-0049 enforce-or-remove; the field-group ruling of #35889,
 * 「一律只看分组」).
 *
 * A field group of the PARENT decides whether the parent's form inlines a
 * child (`fieldGroups[].relatedList`); the relationship's `inlineEdit` only
 * picks the form factor of a placed child, `'grid'` or `'form'`. Every reader
 * of the key — the console's `attachInlineSubforms`, the form plugin's
 * `resolveInlineMode`, the `field-no-consumers` lint — passes anything but
 * those two as absent, so `true` and `false` both read exactly as no key: the
 * form factor picked from the child's shape.
 *
 * So a boolean strips as a pure lossless delete, whatever its value; `'grid'`
 * and `'form'` ride through untouched, which is what makes a second pass find
 * nothing. Only `objects[]` and `objectExtensions[]` field maps are walked,
 * the two places a field definition is authored. Retired from the load path:
 * a live author is refused at the parse with the prescription, while stored
 * rows, built artifacts and `os migrate meta --from 17` replay the delete.
 */
const fieldInlineEditBooleanRemoved: MetadataConversion = {
  id: 'field-inline-edit-boolean-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'object.fields.<name>.inlineEdit: true | false / objectExtensions[].fields.<name>.inlineEdit: true | false',
  summary:
    "relationship field 'inlineEdit' boolean removed (a field group of the parent decides whether its form "
    + "inlines the child, and true and false both read as an absent key, the form factor picked from the "
    + "child's shape; a boolean is deleted, 'grid' and 'form' are kept)",
  apply(stack, emit) {
    const convertCollection = (input: Dict, collection: string): Dict =>
      mapCollection(input, collection, (owner, path) => {
        const fields = owner.fields;
        if (!isDict(fields)) return owner;
        let changed = false;
        const nextFields: Dict = {};
        for (const [name, def] of Object.entries(fields)) {
          if (!isDict(def) || typeof def.inlineEdit !== 'boolean') {
            nextFields[name] = def;
            continue;
          }
          const { inlineEdit, ...rest } = def;
          emit({ from: String(inlineEdit), to: '(removed)', path: `${path}.fields.${name}.inlineEdit` });
          nextFields[name] = rest;
          changed = true;
        }
        return changed ? { ...owner, fields: nextFields } : owner;
      });
    return convertCollection(convertCollection(stack, 'objects'), 'objectExtensions');
  },
  fixture: {
    before: {
      objects: [
        {
          name: 'iebr_order',
          label: 'Order',
          fields: { name: { type: 'text', label: 'Name' } },
        },
        {
          name: 'iebr_order_line',
          label: 'Order Line',
          fields: {
            // `true` (the old "auto"): deleted.
            order: { type: 'master_detail', reference: 'iebr_order', inlineEdit: true },
            // A stated form factor rides through untouched.
            quote: { type: 'lookup', reference: 'iebr_quote', inlineEdit: 'grid' },
          },
        },
        {
          name: 'iebr_quote',
          label: 'Quote',
          fields: { name: { type: 'text', label: 'Name' } },
        },
      ],
      objectExtensions: [
        {
          extend: 'iebr_order_line',
          fields: {
            // `false` read as absent too: deleted.
            shipment: { type: 'lookup', reference: 'iebr_order', inlineEdit: false },
            // `'form'` rides through untouched.
            parent_line: { type: 'lookup', reference: 'iebr_order', inlineEdit: 'form' },
          },
        },
      ],
    },
    after: {
      objects: [
        {
          name: 'iebr_order',
          label: 'Order',
          fields: { name: { type: 'text', label: 'Name' } },
        },
        {
          name: 'iebr_order_line',
          label: 'Order Line',
          fields: {
            order: { type: 'master_detail', reference: 'iebr_order' },
            quote: { type: 'lookup', reference: 'iebr_quote', inlineEdit: 'grid' },
          },
        },
        {
          name: 'iebr_quote',
          label: 'Quote',
          fields: { name: { type: 'text', label: 'Name' } },
        },
      ],
      objectExtensions: [
        {
          extend: 'iebr_order_line',
          fields: {
            shipment: { type: 'lookup', reference: 'iebr_order' },
            parent_line: { type: 'lookup', reference: 'iebr_order', inlineEdit: 'form' },
          },
        },
      ],
    },
    // Two notices: one per boolean `inlineEdit` (the object's `true`, the
    // extension's `false`). The `'grid'` and `'form'` fields emit none.
    expectedNotices: 2,
  },
};

export { fieldInlineEditBooleanRemoved };
