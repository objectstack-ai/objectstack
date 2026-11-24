/**
 * objectstack#35702 — `columns` with one column's footer calculation set
 * (`null` = None). Only the calculation moves: the columns are kept, in their
 * order, each in the object form (`columns` is all names or all objects, never
 * a mix, and only the object form carries `summary`). A field that is not one
 * of `columns` has no column to carry it: the answer is `null`.
 *
 * objectstack#36194 — a pick is a part of the list's DRAFT
 * ({@link DraftColumnSummaries}), laid over the columns the list draws and over
 * the body a save stores ({@link columnsWithSummaries}). The menu is offered on
 * the columns that body carries ({@link declaredColumnFields} of the columns
 * the list draws, the reader's added ones included).
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

/**
 * objectstack#36194 — the footer calculations a list's DRAFT holds (column →
 * calculation, `null` = None), as they are kept beside the draft's other parts.
 */
export type DraftColumnSummaries = Readonly<Record<string, ColumnSummary | null>>;

/** The calculation a column entry declares, by type (`summary` is a type or `{ type, … }`), else `null`. */
export function columnSummaryOf(authored: AuthoredColumns, field: string): ColumnSummary | null {
  for (const entry of authored ?? []) {
    if (typeof entry === 'string' || entry?.field !== field) continue;
    const summary = (entry as { summary?: unknown }).summary;
    if (typeof summary === 'string') return summary as ColumnSummary;
    if (summary && typeof summary === 'object' && typeof (summary as { type?: unknown }).type === 'string') {
      return (summary as { type: ColumnSummary }).type;
    }
    return null;
  }
  return null;
}

/**
 * objectstack#36194 — `columns` with the draft's calculations laid over them,
 * each moved as {@link columnsWithSummary} moves one: the list draws them at
 * once, and a save stores them in the body it builds. A calculation on a field
 * that is not one of `columns` is dropped (the body has no column to carry
 * it). With nothing to lay, `columns` comes back as it came, the same array.
 */
export function columnsWithSummaries<T extends AuthoredColumns>(
  columns: T,
  summaries: DraftColumnSummaries | undefined,
): T | ListColumn[] {
  if (!summaries || !columns) return columns;
  let laid: AuthoredColumns | ListColumn[] = columns;
  for (const [field, summary] of Object.entries(summaries)) {
    const next = columnsWithSummary(laid, field, summary);
    if (next) laid = next;
  }
  return laid as T | ListColumn[];
}
