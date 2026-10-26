// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Column-IO helpers for the View column configurator.
 *
 * A View variant's `columns` array holds entries in one of two canonical
 * shapes, and these helpers read a column's identity in those spellings ONLY:
 *   • `string`                — bare field name (kanban-style)
 *   • `{ field, label, ... }` — ObjectStack canonical shape
 *
 * The legacy/imported TanStack spelling `{ accessorKey, header, ... }` is NOT
 * an identity these helpers understand. `ListColumn` refuses both keys by name
 * (`unrecognized_keys`), so a column carrying them has no field key and no
 * label as far as the spec is concerned; reading them here would present a
 * spec-refused spelling as a valid column identity — the same consumer-side
 * tolerance alias `ObjectGrid` retired in objectui#5068, and that
 * {@link ViewColumnInspector} retired one file over in objectui#5344. This is
 * the editor-side half of that retirement (objectui#5725): the inspector's
 * identity controls and the column list rendered beside them in the SAME panel
 * now agree about what a column is called.
 *
 * These helpers still read every shape without mutating it, and build new
 * entries that respect a variant's all-strings invariant so round-trips stay
 * lossless — the WRITE path is untouched, so no stored document is rewritten.
 */

export interface VariantInfo {
  key: string;
  schema: Record<string, unknown>;
  columns: unknown[];
  allStrings: boolean;
}

/**
 * Human label for a column entry, read in the canonical spelling ONLY.
 *
 * `o.header` and `o.accessorKey` are deliberately not consulted. The retired
 * chain was not merely tolerant, it was INVERTED: `header` was preferred over
 * `field`, so a canonical column that also carried a stray `header` key
 * displayed the undeclared alias INSTEAD of its own declared identity. A
 * declared identity must outrank an undeclared one under every reading.
 *
 * A column the canonical keys cannot name falls through to the positional
 * label `col N`, which is what the row shows and what the author clicks — the
 * list never renders nameless. That label is the designer's own word, so a
 * caller that renders it passes `positional`, the designer row read in its
 * locale (objectui#10862); this module stays free of the string tables.
 */
export function colLabel(
  c: unknown,
  i: number,
  positional: (n: number) => string = (n) => `col ${n}`,
): string {
  if (typeof c === 'string') return c || positional(i + 1);
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    return String(o.label ?? o.field ?? positional(i + 1));
  }
  return positional(i + 1);
}

/**
 * Bound field name for a column entry, if any — canonical `field` only.
 *
 * This one backs more than a label: it feeds {@link usedFieldNames}, which is
 * what the Add-field picker consults to mark a field as already taken. Reading
 * `accessorKey` here let a spec-refused column reserve a field name the author
 * is entitled to add, so the picker reported "Added" for a field no accepted
 * column actually binds.
 */
export function colFieldName(c: unknown): string | undefined {
  if (typeof c === 'string') return c || undefined;
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    const v = o.field;
    return typeof v === 'string' && v ? v : undefined;
  }
  return undefined;
}

/** Set of field names already used as columns in a variant. */
export function usedFieldNames(columns: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const c of columns) {
    const f = colFieldName(c);
    if (f) out.add(f);
  }
  return out;
}

/**
 * Build a fresh column entry for `fieldName`. Honors the variant's
 * all-strings invariant: string variants get a bare field name, object
 * variants get `{ field, label }`.
 */
export function makeColumn(
  allStrings: boolean,
  fieldName: string,
  label?: string,
): unknown {
  if (allStrings) return fieldName;
  const col: Record<string, unknown> = { field: fieldName };
  if (label && label !== fieldName) col.label = label;
  return col;
}

/**
 * Remap a selected column index after a remove at `removedIndex`.
 * Returns the new index, or `null` when the selected column itself was
 * removed (caller should clear the selection).
 */
export function remapIndexAfterRemove(
  selectedIndex: number,
  removedIndex: number,
): number | null {
  if (selectedIndex === removedIndex) return null;
  if (selectedIndex > removedIndex) return selectedIndex - 1;
  return selectedIndex;
}

/**
 * Remap a selected column index after a move from `from` to `to`.
 * Mirrors `moveArray` semantics (remove-then-insert on the same list).
 */
export function remapIndexAfterMove(
  selectedIndex: number,
  from: number,
  to: number,
): number {
  if (selectedIndex === from) return to;
  // The moved item left `from` and was inserted at `to`; indices between
  // shift by one in the appropriate direction.
  let idx = selectedIndex;
  if (from < idx) idx -= 1;
  if (to <= idx) idx += 1;
  return idx;
}
