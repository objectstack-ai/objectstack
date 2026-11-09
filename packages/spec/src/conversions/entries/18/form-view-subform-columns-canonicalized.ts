// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `form-view-subform-columns-canonicalized` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `formViewSubformColumnsCanonicalized` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, mapViewPayloads } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, isDict, respellInlineGridColumns } from '../shared.js';

/**
 * `subforms[].columns[].field` → `name` on every form view — the mechanical
 * half of the #20901 closure of the form-view carrier (protocol 18).
 *
 * `FormViewSchema.subforms[].columns` was `z.array(z.any())` through 17.5.0 and
 * now references `InlineGridColumnSchema`, whose alias table refuses `field`
 * with a prescription naming `name`. That is the break a relationship field's
 * `inlineColumns` took in #9227, and the respelling is the same one: it runs
 * through {@link respellInlineGridColumns}, shared with
 * {@link fieldColumnListsCanonicalized}. ADR-0087's pre-GA policy owes a
 * lossless break a `retiredFromLoadPath` chain step in the same release.
 *
 * **Its own entry, not a wider walk in `field-column-lists-canonicalized`,**
 * because `retiredAfter` is one fact per entry (ADR-0087, amended 2026-09-30):
 * that entry's carriers stopped accepting `field` after 17.0.0, and the census
 * pins that published value, while this carrier accepted it through 17.5.0. The
 * artifact-ingestion door opens its window per entry by `retiredAfter`, so under
 * the older stamp an artifact whose declared floor is 17.5.0 would meet the
 * refusal instead of this rewrite on a runtime still labelled 17.5.0.
 *
 * **Reach: every FORM payload.** {@link mapViewPayloads} reaches `form`,
 * `formViews.*`, a form view item's `config` and a flattened form overlay — the
 * stored-row seam wraps a `view` row as `{ views: [row] }` in any of those
 * spellings — and the assembled-manifest `viewItems` channel
 * ({@link ASSEMBLED_VIEW_ITEMS_KEY}) carries the last two. A list payload is
 * never judged. `FormViewSchema` is the only schema that declares `subforms`.
 *
 * `retiredFromLoadPath`: the parse refuses `field` with the prescription, so a
 * live author is taught rather than rewritten. The entry exists so stored rows
 * and assembled artifacts replay clean, and so `os migrate meta` lists the edit.
 * Idempotent by construction: the rewrite leaves no `field` on the entry.
 */
const formViewSubformColumnsCanonicalized: MetadataConversion = {
  id: 'form-view-subform-columns-canonicalized',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.5.0',
  surface: 'view.form.subforms[].columns[].field / view.formViews.<key>.subforms[].columns[].field',
  summary:
    "form-view subform grid column entries respelled 'field' → 'name', the grid's column identity "
    + '(the carrier accepted any value until it took the inline grid column contract; a '
    + "relationship field's inlineColumns get the same respelling from field-column-lists-canonicalized)",
  apply(stack, emit) {
    const respellSubforms = (form: Dict, path: string): Dict => {
      const subforms = form.subforms;
      if (!Array.isArray(subforms)) return form;
      let changed = false;
      const next = subforms.map((subform, j) => {
        if (!isDict(subform) || !Array.isArray(subform.columns)) return subform;
        const columns = respellInlineGridColumns(subform.columns, `${path}.subforms[${j}].columns`, emit);
        if (columns === subform.columns) return subform;
        changed = true;
        return { ...subform, columns };
      });
      return changed ? { ...form, subforms: next } : form;
    };
    const withViews = mapViewPayloads(stack, (payload, kind, path) =>
      kind === 'form' ? respellSubforms(payload, path) : payload);
    return mapCollection(withViews, ASSEMBLED_VIEW_ITEMS_KEY, (item, path) => {
      if (item.viewKind !== 'form') return item;
      if (isDict(item.config)) {
        const config = respellSubforms(item.config, `${path}.config`);
        return config === item.config ? item : { ...item, config };
      }
      // A flattened form overlay — the body IS the payload. A present but
      // malformed `config` is neither shape and is left for the parse.
      return item.config === undefined ? respellSubforms(item, path) : item;
    });
  },
  fixture: {
    before: {
      views: [
        {
          object: 'crm_invoice',
          // A container: the default form and a named form view.
          form: {
            type: 'simple',
            subforms: [{
              childObject: 'crm_invoice_line',
              columns: [
                // The `field` spelling, every other key kept.
                { field: 'product' },
                { field: 'quantity', label: 'Qty' },
                // Already name-keyed — untouched.
                { name: 'unit_price' },
                // Both keys — untouched: which column was meant is the
                // author's call, and the parse names both keys.
                { field: 'amount', name: 'total' },
              ],
            }],
          },
          formViews: {
            quick: { type: 'simple', subforms: [{ childObject: 'crm_invoice_line', columns: [{ field: 'product' }] }] },
          },
        },
      ],
      viewItems: [
        // An assembled form view item record, and a flattened form overlay.
        {
          name: 'crm_invoice.entry',
          object: 'crm_invoice',
          viewKind: 'form',
          config: { type: 'simple', subforms: [{ childObject: 'crm_invoice_line', columns: [{ field: 'product' }] }] },
        },
        {
          name: 'crm_invoice.edit',
          object: 'crm_invoice',
          viewKind: 'form',
          type: 'simple',
          subforms: [{ childObject: 'crm_invoice_line', columns: [{ field: 'product' }] }],
        },
      ],
    },
    after: {
      views: [
        {
          object: 'crm_invoice',
          form: {
            type: 'simple',
            subforms: [{
              childObject: 'crm_invoice_line',
              columns: [
                { name: 'product' },
                { name: 'quantity', label: 'Qty' },
                { name: 'unit_price' },
                { field: 'amount', name: 'total' },
              ],
            }],
          },
          formViews: {
            quick: { type: 'simple', subforms: [{ childObject: 'crm_invoice_line', columns: [{ name: 'product' }] }] },
          },
        },
      ],
      viewItems: [
        {
          name: 'crm_invoice.entry',
          object: 'crm_invoice',
          viewKind: 'form',
          config: { type: 'simple', subforms: [{ childObject: 'crm_invoice_line', columns: [{ name: 'product' }] }] },
        },
        {
          name: 'crm_invoice.edit',
          object: 'crm_invoice',
          viewKind: 'form',
          type: 'simple',
          subforms: [{ childObject: 'crm_invoice_line', columns: [{ name: 'product' }] }],
        },
      ],
    },
    // One per respelled column: two in the container's `form`, one in its named
    // form view, one in the assembled record and one in the assembled overlay.
    // The name-keyed and the two-key entries emit none.
    expectedNotices: 5,
  },
};

export { formViewSubformColumnsCanonicalized };
