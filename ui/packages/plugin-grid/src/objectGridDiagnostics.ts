/**
 * The authored-input diagnostics of `ObjectGrid` (`./ObjectGrid.tsx`): the three
 * `console.warn` effects that report an unreadable `columns` entry, an unusable
 * `bulkActionDefs` member and a non-positive page size, moved out of that file
 * verbatim into a hook (objectstack#25994, slice 3).
 */

import { useEffect } from 'react';
import type { ObjectGridSchema } from '@object-ui/types';
import { describeUnresolvedColumns } from './columnSpellingDiagnostics';
import { describeUnusableBulkActionDefs } from './resolveBulkActions';
import { describeNonPositivePageSize } from './objectGridDefaults';

/**
 * Runs `ObjectGrid`'s authored-input diagnostics. It declares no state and
 * returns nothing. `ObjectGrid` calls it where the three effects used to stand,
 * so the order of the component's hooks does not change.
 */
export function useObjectGridDiagnostics(schema: ObjectGridSchema): void {
  // An authored column the renderer cannot read now says so, instead of just
  // not being there (objectui#5349 — the Q2 objectui#5068 deferred).
  //
  // #5068 made `ListColumnSchema`'s `field` / `label` the only spelling read
  // here, which is right; what it left behind was the receipt. A column
  // authored `{ accessorKey, header }` (or with no `field` at all) is dropped
  // by `resolvesToDataColumn` above, and until this effect landed the author
  // saw no error, no warning and no empty header — just a grid with its
  // row-number column and no data columns. Same defect shape #5068 exists to
  // fix, one level down: renderer and author disagree, author gets a success
  // receipt.
  //
  // Scope, deliberately narrow: this reads the `columns` INPUT and nothing
  // else. It never asks whether the grid found ROWS, because a grid legitimately
  // draws them from five different places (inline `data` array, `data.provider:
  // 'value'`, legacy `staticData`, `bind`, or a host that owns the fetch and
  // passes the window down as a `data` React prop). A predicate that consulted
  // those would eventually paint a configuration error over a working grid.
  // `hidden: true` is authored intent and is never reported.
  //
  // Channel: the same one `ObjectGrid` already uses for "you declared it, the
  // renderer dropped it" — a `useEffect` keyed on the schema slice and one
  // `console.warn` prefixed `[ObjectUI] ObjectGrid <topic>:` (see the export
  // format warning below) — rather than a second, differently-shaped one.
  const columnDiagnosticBlockType = (schema as { type?: unknown }).type;
  const columnDiagnosticLabel = schema.label ?? (schema as { title?: unknown }).title;
  useEffect(() => {
    const message = describeUnresolvedColumns(schema.columns, {
      blockType: columnDiagnosticBlockType,
      objectName: schema.objectName,
      label: columnDiagnosticLabel,
    });
    if (message) console.warn(message);
  }, [schema.columns, columnDiagnosticBlockType, schema.objectName, columnDiagnosticLabel]);

  // [objectui#8730] The same channel, for the sibling failure on
  // `bulkActionDefs`. A member that is not a usable def (a bare action name —
  // the OTHER key's vocabulary — or `null`, a number, `{}`, `{ name: '' }`) is
  // skipped by `resolveBulkActions`; before that guard it reached the bar and
  // `formatActionLabel(undefined)` threw during render, so the author's first
  // multi-row selection lost the whole selection bar.
  //
  // The skip alone would only relocate the failure into silence — which is what
  // the mirror direction already does (`bulkActions: [{ name: 'approve' }]`,
  // stepped over by the `typeof name !== 'string'` guard). Saying which member
  // was dropped, and that a bare name belongs in `bulkActions`, is what makes
  // this a diagnosis rather than a quieter version of the same defect. One
  // `console.warn` per authored array, keyed on it — NOT a second guard: the
  // predicate lives once, in `resolveBulkActions`, and this reads it.
  const bulkDefsDiagnosticSlice = (schema as { bulkActionDefs?: unknown }).bulkActionDefs;
  useEffect(() => {
    const message = describeUnusableBulkActionDefs(bulkDefsDiagnosticSlice, {
      blockType: columnDiagnosticBlockType,
      objectName: schema.objectName,
      label: columnDiagnosticLabel,
    });
    if (message) console.warn(message);
  }, [bulkDefsDiagnosticSlice, columnDiagnosticBlockType, schema.objectName, columnDiagnosticLabel]);

  // [objectui#9853] The same channel again, for a `pagination.pageSize` (or the
  // deprecated flat shorthand) that is not a positive integer. `resolvePageSize`
  // drops such a value at all three read points and uses the site's default; on
  // its own that is a quieter version of the defect, because substituting a
  // number the author never wrote is exactly what the flat site already did in
  // silence. This is the half that makes it a diagnosis.
  //
  // Keyed on the authored slice, so it is one warning per declaration and not
  // one per render. NOT a second guard — the predicate lives once, in
  // `isUsablePageSize`, and this reads it.
  const pageSizeDiagnosticObject = schema.pagination;
  const pageSizeDiagnosticFlat = schema.pageSize;
  useEffect(() => {
    const message = describeNonPositivePageSize(
      { pagination: pageSizeDiagnosticObject, pageSize: pageSizeDiagnosticFlat },
      { blockType: columnDiagnosticBlockType, objectName: schema.objectName },
    );
    if (message) console.warn(message);
  }, [pageSizeDiagnosticObject, pageSizeDiagnosticFlat, columnDiagnosticBlockType, schema.objectName]);
}
