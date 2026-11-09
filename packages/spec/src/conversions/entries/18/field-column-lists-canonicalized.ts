// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `field-column-lists-canonicalized` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `fieldColumnListsCanonicalized` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { type Dict, isDict, respellInlineGridColumns } from '../shared.js';

/**
 * `field.inlineColumns[]` / `field.relatedListColumns[]` — the mechanical half
 * of the #9227 strict-element narrowing (protocol 18).
 *
 * Both keys were `z.array(z.any())`: every column object validated, so a
 * mis-keyed column published clean and surfaced only in the browser as blank
 * cells (the objectui#3951 failure, reachable from the authoring side). The
 * schemas are now closed:
 *
 *   - `inlineColumns` entries are the strict, `name`-keyed
 *     `InlineGridColumnSchema` — `name` is the grid's column identity since
 *     objectui#3951 retired the `field` spelling from the widget, with
 *     deliberately no tolerant alias in the renderer. The conversion respells
 *     `{ field: 'x' }` (the pre-#3951 authored form — the shape the showcase
 *     invoice carried) as `{ name: 'x' }`, preserving every other key. An
 *     entry already carrying `name` is left alone — rewriting a live key on
 *     the strength of a stale one would guess; the parse refuses the mixed
 *     shape loudly instead.
 *   - `relatedListColumns` entries are child FIELD-NAME STRINGS. The
 *     conversion folds an object entry to its identity string
 *     (`field` → `name` → `fieldName`, objectui's `columnIdentity` order) and
 *     drops the decoration keys: re-measured at the `.objectui-sha` pin
 *     `67dadd602a3a`, an object entry's display keys span two vocabularies
 *     (`columnIdentity` is canonical-`field`, the data-table accessor reads
 *     `accessorKey` only — objectui#6963 retired the `name` alias),
 *     so no object spelling renders reliably — the derived-from-schema string
 *     is the one form that always has. An object with no resolvable identity
 *     is left for the parse to refuse; a conversion must not invent data.
 */
const fieldColumnListsCanonicalized: MetadataConversion = {
  id: 'field-column-lists-canonicalized',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.0.0',
  surface: 'field.inlineColumns[].field / field.relatedListColumns[] object entries',
  summary:
    "inline-grid column entries respelled 'field' → 'name' (the declared spelling wins, and the grid "
    + "renderer now reads 'name' too) and related-list column objects folded to their child "
    + 'field-name string (both lists were z.any(), so a mis-keyed column published clean and '
    + 'rendered blank cells; inline columns now take a strict name-keyed shape and related-list '
    + 'columns plain field names, so a mis-keyed column is refused at publish)',
  apply(stack, emit) {
    const convertFieldDef = (def: Dict, path: string): Dict => {
      let next: Dict = def;
      const inline = def.inlineColumns;
      if (Array.isArray(inline)) {
        const cols = respellInlineGridColumns(inline, `${path}.inlineColumns`, emit);
        if (cols !== inline) next = { ...next, inlineColumns: cols };
      }
      const related = def.relatedListColumns;
      if (Array.isArray(related)) {
        let changed = false;
        const cols = related.map((entry, i) => {
          if (!isDict(entry)) return entry;
          const identity = [entry.field, entry.name, entry.fieldName].find(
            (v): v is string => typeof v === 'string' && v.length > 0,
          );
          if (!identity) return entry; // nothing to fold to — the parse refuses it loudly
          emit({ from: 'object entry', to: identity, path: `${path}.relatedListColumns[${i}]` });
          changed = true;
          return identity;
        });
        if (changed) next = { ...next, relatedListColumns: cols };
      }
      return next;
    };
    const convertCollection = (input: Dict, collection: string): Dict =>
      mapCollection(input, collection, (owner, path) => {
        const fields = owner.fields;
        if (!isDict(fields)) return owner;
        let changed = false;
        const nextFields: Dict = {};
        for (const [name, def] of Object.entries(fields)) {
          if (!isDict(def)) {
            nextFields[name] = def;
            continue;
          }
          const converted = convertFieldDef(def, `${path}.fields.${name}`);
          nextFields[name] = converted;
          if (converted !== def) changed = true;
        }
        return changed ? { ...owner, fields: nextFields } : owner;
      });
    return convertCollection(convertCollection(stack, 'objects'), 'objectExtensions');
  },
  fixture: {
    before: {
      objects: [{
        name: 'showcase_invoice_line',
        label: 'Invoice Line',
        fields: {
          invoice: {
            type: 'master_detail',
            reference: 'showcase_invoice',
            inlineEdit: 'grid',
            inlineColumns: [
              // The pre-#3951 authored form (the showcase invoice's real shape).
              { field: 'product' },
              { field: 'quantity', label: 'Qty' },
              // Already name-keyed — untouched.
              { name: 'unit_price' },
            ],
          },
          project: {
            type: 'lookup',
            reference: 'showcase_project',
            relatedListColumns: [
              // Object entries fold to their identity string, whichever legacy
              // spelling carries it; string entries are untouched.
              { field: 'status', label: 'Status' },
              { name: 'amount' },
              'issued_on',
            ],
          },
        },
      }],
    },
    after: {
      objects: [{
        name: 'showcase_invoice_line',
        label: 'Invoice Line',
        fields: {
          invoice: {
            type: 'master_detail',
            reference: 'showcase_invoice',
            inlineEdit: 'grid',
            inlineColumns: [
              { name: 'product' },
              { name: 'quantity', label: 'Qty' },
              { name: 'unit_price' },
            ],
          },
          project: {
            type: 'lookup',
            reference: 'showcase_project',
            relatedListColumns: ['status', 'amount', 'issued_on'],
          },
        },
      }],
    },
    // 2 inline respells + 2 related-list folds.
    expectedNotices: 4,
  },
};

export { fieldColumnListsCanonicalized };
