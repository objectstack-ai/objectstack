/**
 * objectstack#35702 — a view's `columns` with one column's footer calculation
 * set (`null` = None), as the list's footer menu saves it on the view. The
 * view's own columns are the base; a view that declares none takes the columns
 * the grid draws, so the saved view keeps drawing them. A field the view does
 * not list (a column the reader added) is appended. Every entry comes back in
 * the object form, the one that carries `summary`.
 */

import type { ListColumn } from '@object-ui/types';
import type { ColumnSummary } from '@objectstack/spec/ui';

export function columnsWithSummary(
  authored: ReadonlyArray<string | ListColumn> | undefined,
  field: string,
  summary: ColumnSummary | null,
  drawnFields: readonly string[],
): ListColumn[] {
  const base: ReadonlyArray<string | ListColumn> = authored && authored.length > 0 ? authored : drawnFields;
  let found = false;
  const columns = base.map((entry): ListColumn => {
    const column: ListColumn = typeof entry === 'string' ? { field: entry } : { ...entry };
    if (column.field !== field) return column;
    found = true;
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
  if (!found && summary !== null) columns.push({ field, summary });
  return columns;
}
