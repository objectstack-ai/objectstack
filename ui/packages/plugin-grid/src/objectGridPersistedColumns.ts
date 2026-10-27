/**
 * The column post-processing of `ObjectGrid` (`./ObjectGrid.tsx`): each
 * generated column enriched with its field type and inline-edit verdict, the
 * emit fold onto the declared column type, and the user's persisted widths and
 * order, moved out of the component verbatim (objectstack#25994, slice 8). A
 * plain function: it runs below the component's early returns.
 */

import { normalizeTableColumnType } from '@object-ui/types';
import { isMaskedGridColumn } from './maskedColumn';
import { isFieldInlineEditable } from './inline-edit-options';
import { resolveFieldAffordance, isExpandableFieldType } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import { type ObjectGridColumn, type ObjectGridColumnDraft, isChipFieldType } from './objectGridColumns';
import { useObjectGridColumnState } from './objectGridColumnState';
import type { useObjectGridGenerateColumns } from './objectGridGenerateColumns';

/**
 * The columns `ObjectGrid` draws, before the Actions column. `ObjectGrid` calls
 * it where these lines used to stand.
 */
export function resolveObjectGridPersistedColumns({
  generateColumns, objectFields, objectName, perms, objectTypesPending, columnState,
}: {
  generateColumns: ReturnType<typeof useObjectGridGenerateColumns>['generateColumns'];
  objectFields: Record<string, any> | undefined;
  objectName: string | undefined;
  perms: ReturnType<typeof usePermissions>;
  objectTypesPending: boolean;
  columnState: ReturnType<typeof useObjectGridColumnState>['columnState'];
}) {
  const columns: ObjectGridColumn[] = generateColumns().map((col): ObjectGridColumnDraft => {
    // Enrich each column with its field type so the data-table's type-aware
    // inline editor can pick the matching control (dropdown for select,
    // checkbox for boolean) the form uses, instead of a plain text box.
    // Additive: never overrides a type a path already set.
    //
    // ⭐ THE `options` KEY RETIRED HERE (objectui#6004). This pass also used to
    // write `next.options = translateOptions(…)`, and nothing read it. Measured
    // read sets, comments stripped: `data-table.tsx` reads no column-level
    // `options` at all — its select/boolean editors are not hand-rolled there,
    // they come from the host through `renderCellEditor`, and THIS component's
    // `renderCellEditor` (below) rebuilds the field from
    // `objectSchema.fields[ctx.column.accessorKey]` rather than from the column.
    // So the write had no reader on either side of the seam.
    //
    // Retiring it is behaviour-preserving because the value still has its own
    // road to every consumer that wants it — that check is part of the rule,
    // not an aside: cell renderers read translated options off the `fieldMeta`
    // built inside `generateColumns()`, and the inline editor reads them off
    // the object schema. Neither ever consulted `col.options`.
    // ⛔ THE `!col` GUARD IS KEPT ON PURPOSE — do not delete it as dead code.
    //
    // `ObjectGridColumnDraft` forbids null, so by the types this branch is
    // unreachable, and that is exactly the reasoning that would remove it. The
    // reason it stays is that this producer's type guarantee has been untrue in
    // practice, repeatedly: objectui#6004 measured FIVE separate `any` leaks
    // that defeated this boundary, one of them (`const generatedColumns:
    // any[]`) INSIDE `generateColumns()` itself, where it left a whole emit
    // path unchecked even after the return was annotated. Each was invisible
    // until someone measured it.
    //
    // So this is defence in depth BEHIND the typing, not a substitute for it —
    // the tombstones and the removed casts are the primary guard. Deleting this
    // line converts a tolerated null into a throw, which is how the protection
    // would be lost a second time for a perfectly good reason.
    if (!col || col.accessorKey === '_actions') return col;
    const fieldDef = objectFields?.[col.accessorKey];
    if (!fieldDef) return col;
    const next: ObjectGridColumnDraft = { ...col };
    if (next.type == null && fieldDef.type) next.type = fieldDef.type;
    // Read-only / computed / binary fields are not value-editable in place —
    // mark the column so the data-table never opens an editor (otherwise it
    // falls back to a plain text box for e.g. a Formula or File cell). Only
    // force `false`; leave editable unset otherwise so the grid-level flag wins.
    //
    // [objectui#12103] …and neither is a field THIS CALLER may not write: the
    // field question of the `listInlineEdit` row of the affordance-to-grant map,
    // the same `write` question an edit form asks (`fieldWriteGate`). A field
    // the permission set marks `editable: false`, or the owner field without
    // the transfer grant, keeps a read cell while the rest of the row edits;
    // before, its editor opened and the save answered 403. `inlineEditable`
    // above stays the object-level verdict for the whole grid — this only
    // narrows one column. With no `objectName`, or no provider mounted, nothing
    // is asked and the column is untouched.
    if (
      next.editable !== false &&
      (!isFieldInlineEditable(fieldDef) ||
        (!!objectName && !resolveFieldAffordance('listInlineEdit', perms, objectName, col.accessorKey)))
    ) {
      next.editable = false;
    }
    return next;
  })
    // ⭐ THE EMIT SEAM (`fc62bb490`, maintainer ruling 2026-08-25, Option B).
    //
    // Every column this component hands to `data-table` passes through here, so
    // it is the one place that can guarantee `TableColumn.type` only ever holds
    // a value that type DECLARES. Five paths above write `type`: the four
    // column literals inside `generateColumns()` and the `fieldDef.type`
    // enrichment in the map above — all of them forward an OBJECT SCHEMA's
    // field type verbatim, whose vocabulary is `@objectstack/spec`'s `FieldType`
    // (49 values, only 7 of them members of the declared union). That verbatim
    // forwarding is why the renderer had to read this key through an `as any`.
    //
    // ⛔ Deliberately a SEPARATE pass, not folded into the map above: that map
    // early-returns for `_actions` and for any column whose `accessorKey` has no
    // `fieldDef`, and a heuristic `inferColumnType()` type (`select`, `user`)
    // rides out on exactly those columns. Normalizing there would miss them.
    //
    // An out-of-union type drops the `type` KEY — never the column. See
    // `normalizeTableColumnType` for why absence beats folding onto `'text'`.
    //
    // This pass is also where the draft becomes the real thing: `type` is the
    // one member whose vocabulary differs between `ObjectGridColumnDraft` (producer
    // spelling) and `ObjectGridColumn` (what the slot declares), so the fold and the
    // type transition are the same step (objectui#6004).
    .map((col): ObjectGridColumn => {
      // ⛔ Kept on purpose, same reason as the `!col` guard in the enrichment
      // map above (objectui#6004) — unreachable by type, retained because this
      // producer's types have not held in practice. Destructuring a null below
      // would throw where the pre-#6004 code passed it through.
      if (!col) return col;
      const { type: producerType, ...draft } = col;
      // ⭐ THE MASKED FLAG (objectui#10583) — stamped HERE, before the fold,
      // because the fold is exactly what erases the answer: `password` and
      // `secret` are not `TableColumnType` members, so `normalizeTableColumnType`
      // drops them and `data-table` could never tell a masked column from a
      // text one. It also must not ask the question itself — it cannot import
      // `@object-ui/fields` — so this producer asks `isMaskedFieldType()` (via
      // `isMaskedGridColumn`) and the table obeys the flag: no Ctrl+C / Cmd+C
      // copy, no `title` tooltip, no column in its CSV export, no inline edit.
      //
      // Every path that writes `type` is covered for the same reason the fold
      // is: all four `generateColumns()` literals and the enrichment map above
      // pass through this pass. The object-declared type is read beside the
      // producer's for the narrow-only union — path A forwards a VIEW-authored
      // type ahead of the object's, and `type: 'text'` over a `secret` column
      // must keep the flag. Written only when true, so every unmasked column
      // reaches the table byte-identical to before.
      //
      // objectui#10657 — the third argument: while the object's field types
      // are unknown, a column with no type of its own is WITHHELD, and so
      // flagged. `generateColumns()` gave it no inferred type and a mask for a
      // cell; this is where every table path learns to withhold it as well.
      const masked = isMaskedGridColumn(producerType, objectFields?.[col.accessorKey]?.type, objectTypesPending);
      // objectui#12708 — THE CHIP FLAG, stamped here for the same reason as
      // the masked one: the fold below drops `select` and its kin (they are
      // not `TableColumnType` members), so `data-table` could not tell a chip
      // column from a text one. It floors a chip column at its widest drawn
      // chip. Written only when true, so every other column is unchanged.
      const chips = !masked && isChipFieldType(producerType ?? objectFields?.[col.accessorKey]?.type);
      // objectui#13377 — THE FOREIGN-KEY FLAG, for the same reason again: the
      // fold drops `lookup` / `master_detail` / `tree` / `user`, so `data-table`
      // could not tell that the raw value its cell `title` shows is the
      // referenced record's id. Read from the same type as the chip flag (the
      // authored one first), the one the cell is drawn by: a view that authors
      // `type: 'text'` over a lookup draws the id as text, and keeps the
      // tooltip. A masked column already carries none. Written only when true.
      const foreignKey = !masked && isExpandableFieldType({ type: producerType ?? objectFields?.[col.accessorKey]?.type });
      const rest = masked
        ? { ...draft, masked: true }
        : { ...draft, ...(chips ? { chips: true } : {}), ...(foreignKey ? { foreignKey: true } : {}) };
      if (producerType == null) return rest;
      const normalized = normalizeTableColumnType(producerType);
      if (normalized === undefined) return rest;
      return { ...rest, type: normalized };
    });

  // Apply persisted column order and widths
  let persistedColumns = [...columns];
  
  // Apply saved widths.
  //
  // ⭐ THE KEY IS `width` (objectui#6457). This stamp used to write `size`,
  // and `size` is a key nothing downstream consumes: `TableColumn`
  // (`@object-ui/types` `data-display.ts`) declares `width`, and `data-table`
  // resolves a column's width at all four of its sites as
  // `columnWidths[accessorKey] || col.width || autoSizedWidths[accessorKey]`
  // — zero column-level `size` reads. So a user's resize was written to
  // localStorage, read back into `columnState.widths`, stamped onto the column
  // here, and then dropped at the last hop; the width was never restored on the
  // ungrouped path.
  //
  // The grouped path is the control that identified `width` as the right fix
  // rather than teaching `data-table` a second key: `groupedColumnWidths` below
  // reads the SAME `columnState.widths` and stamps `width`, and it works.
  //
  // ⛔ Do not re-widen this callback to `(col: any)`. That cast is what let
  // the wrong key through a boundary which has DECLARED the right one since
  // objectui#6004 — `ObjectGridColumn` is `TableColumn & …`, so with the
  // callback typed, a stray `size` here is a compile error instead of a silent,
  // user-visible drop. Typed, this defect class cannot come back by hand.
  if (columnState.widths) {
    persistedColumns = persistedColumns.map((col): ObjectGridColumn => {
      const savedWidth = columnState.widths?.[col.accessorKey];
      if (savedWidth) {
        return { ...col, width: savedWidth };
      }
      return col;
    });
  }
  
  // Apply saved order
  if (columnState.order && columnState.order.length > 0) {
    const orderMap = new Map(columnState.order.map((key: string, i: number) => [key, i]));
    persistedColumns.sort((a: any, b: any) => {
      const orderA = orderMap.get(a.accessorKey) ?? Infinity;
      const orderB = orderMap.get(b.accessorKey) ?? Infinity;
      return orderA - orderB;
    });
  }

  return { persistedColumns };
}
