/**
 * objectstack#35702 — a view's `columns` with one column's footer calculation
 * set (`null` = None), as the list's footer menu saves it on the view. Only the
 * calculation moves: the view's own columns are kept, in their order, each in
 * the object form (`columns` is all names or all objects, never a mix, and only
 * the object form carries `summary`). A column the view does not declare — a column the reader
 * added for themselves, or any column of a view that declares none — is not
 * the view's to change (L1 7048239634): the answer is `null` and nothing is
 * saved, which is why the menu is offered on the declared columns only
 * ({@link declaredColumnFields}).
 */

import type { ListColumn } from '@object-ui/types';
import type { ColumnSummary } from '@objectstack/spec/ui';

type AuthoredColumns = ReadonlyArray<string | ListColumn> | undefined;

/** The fields of the columns a view declares, in its order. */
export function declaredColumnFields(authored: AuthoredColumns): string[] {
  return (authored ?? [])
    .map((entry) => (typeof entry === 'string' ? entry : entry?.field))
    .filter((field): field is string => typeof field === 'string' && field.length > 0);
}

export function columnsWithSummary(
  authored: AuthoredColumns,
  field: string,
  summary: ColumnSummary | null,
): ListColumn[] | null {
  if (!declaredColumnFields(authored).includes(field)) return null;
  return (authored ?? []).map((entry): ListColumn => {
    const column: ListColumn = typeof entry === 'string' ? { field: entry } : { ...entry };
    if (column.field !== field) return column;
    if (summary === null) {
      delete column.summary;
      return column;
    }
    // The object form keeps its `field` override; only the calculation moves.
    column.summary = typeof column.summary === 'object' && column.summary !== null
      ? { ...column.summary, type: summary }
      : summary;
    return column;
  });
}
