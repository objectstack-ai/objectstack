/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The compact posture of a list block (objectui#12703): what `ListView` draws
 * in place of its toolbar, its grid and its record-count bar when the page
 * region it sits in is narrower than half the page.
 *
 * A short list, not a small grid: a header with the list's title and its
 * record count, then one row per record whose first line is the view's first
 * visible column and whose muted second line is its second. No toolbar, no
 * view tabs, no row-number column, no pager — those belong to the object
 * list, and a rail beside `main` has no room for them.
 *
 * Values render through the shared cell renderers (`getCellRenderer`), so a
 * date, a picklist label or a related record reads the way the grid and the
 * gallery draw it. ⛔ No second formatter lives here.
 *
 * Under the rows, a "View all" link to the rest (objectui#12703 part 2): drawn
 * only when the block hands a destination through
 * {@link CompactListDestinationContext}, which it builds from the host's
 * `listHref` / `openList`. A host without that seam draws no link.
 *
 * Also the CAPPED posture's rows (objectstack#26613), the one a list block
 * takes in a region half the page or wider: {@link ListViewCappedRows}, a
 * short table of the view's first {@link CAPPED_LIST_MAX_COLUMNS} columns over
 * the first rows, ending with 「View all N →」 to the same destination.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { getRecordDisplayName, isEmptyValue, columnIdentity, isDeadlineSettled } from '@object-ui/core';
import { usePredicateScope } from '@object-ui/react';
import { getCellRenderer, resolveCellRendererType } from '@object-ui/fields';
import { useDisplayLocale, useObjectTranslation, useSafeFieldLabel } from '@object-ui/i18n';
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';

/**
 * Where the compact list's "View all" link goes: a document href and the SPA
 * open that reaches the same place. The page block builds it from the host's
 * `listHref` / `openList` (`RelatedRecordActionsValue`) and the object and saved
 * view it is bound to; `null` (the default) draws no link.
 *
 * A context rather than a `ListView` prop because the destination is the
 * block's, not the list's: only the page block knows its binding, and the
 * object list page, which never draws the compact posture, has none.
 * Package-internal, like this module.
 */
export interface CompactListDestination {
  href: string;
  /** SPA navigation to `href`; absent, the anchor navigates on its own. */
  open?: () => void;
}

export const CompactListDestinationContext = React.createContext<CompactListDestination | null>(null);

/**
 * The compact and capped lists' footer: a real link to the rest of the list.
 * With a `count` (the capped list, objectstack#26613) it says how many records
 * the link opens, 「View all N」; without one, "View all".
 */
export function ListViewCompactFooter({ destination, count }: { destination: CompactListDestination; count?: number | null }) {
  const { t } = useObjectTranslation();
  return (
    <div className="border-t px-3 py-2 shrink-0" data-testid="list-compact-footer">
      <a
        href={destination.href}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4',
          'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        data-testid="list-compact-view-all"
        onClick={(e) => {
          // Modifier and non-primary clicks belong to the browser (a new tab, a
          // new window): that is why the destination is a real href.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          if (!destination.open) return;
          e.preventDefault();
          destination.open();
        }}
      >
        {count != null ? t('list.viewAllCount', { count }) : t('list.viewAll')}
        <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}

/** The two columns a compact row draws: the view's first two visible ones. */
export function compactRowColumns(fields: readonly unknown[]): { primary?: string; secondary?: string } {
  const names = fields
    .map((f) => columnIdentity(f))
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  return { primary: names[0], secondary: names[1] };
}

export interface ListViewCompactHeaderProps {
  title?: string;
  /** The record count to show, or `null` while it is not known. */
  count: number | null;
  /** The count as a sentence, the badge's accessible name (`list.recordCount`). */
  countLabel?: string;
}

/** The compact list's header: its title and its record count. */
export function ListViewCompactHeader({ title, count, countLabel }: ListViewCompactHeaderProps) {
  if (!title && count == null) return null;
  return (
    <div
      className="flex items-center justify-between gap-2 border-b px-3 py-2 shrink-0"
      data-testid="list-compact-header"
    >
      <span className="min-w-0 truncate text-sm font-medium text-foreground" data-testid="list-compact-title">
        {title}
      </span>
      {count != null && (
        <span
          className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
          data-testid="list-compact-count"
          aria-label={countLabel}
          title={countLabel}
        >
          {count}
        </span>
      )}
    </div>
  );
}

export interface ListViewCompactRowsProps {
  rows: readonly Record<string, unknown>[];
  /** The view's visible columns, in order (`ListView`'s `effectiveFields`). */
  fields: readonly unknown[];
  objectName?: string;
  /** The object's metadata, for the field types the cells format by. */
  objectDef?: { fields?: Record<string, Record<string, unknown>> } | null;
  onRowClick?: (record: Record<string, unknown>) => void;
}

/**
 * Field labels and value cells as the shared cell renderers draw them, for
 * the compact and the capped rows. Values go through `getCellRenderer`, so a
 * date, a picklist label or a related record reads the way the grid draws it.
 */
function useListCells(objectName: string | undefined, objectDef: ListViewCompactRowsProps['objectDef']) {
  const { fieldLabel, fieldOptionLabel } = useSafeFieldLabel();
  // The host predicate scope a row's declared deadline is judged in (objectui#11815).
  const predicateScope = usePredicateScope();

  // The field as the shared cell renderers take it: the object's definition,
  // its label and option labels through the i18n dictionary.
  const fieldFor = (name: string): Record<string, unknown> => {
    const def = objectDef?.fields?.[name] ?? {};
    const field: Record<string, unknown> = { ...def, name };
    if (objectName) {
      field.label = fieldLabel(objectName, name, String(def.label ?? name));
      if (Array.isArray(def.options)) {
        field.options = (def.options as unknown[]).map((opt) => {
          const o = (opt && typeof opt === 'object' ? opt : { value: opt }) as Record<string, unknown>;
          const value = String(o.value ?? '');
          return { ...o, value, label: fieldOptionLabel(objectName, name, value, String(o.label ?? value)) };
        });
      }
    }
    return field;
  };

  const cell = (record: Record<string, unknown>, name: string): React.ReactNode => {
    const value = record[name];
    if (isEmptyValue(value)) return null;
    const field = fieldFor(name);
    const Cell = getCellRenderer(resolveCellRendererType(field as never));
    const deadlineSettled = isDeadlineSettled(objectDef?.fields?.[name], record, { scope: predicateScope, fields: objectDef?.fields });
    return <Cell value={value} field={field as never} deadlineSettled={deadlineSettled} />;
  };

  return { fieldFor, cell };
}

/** The compact list's rows: the first visible column over the second, muted. */
export function ListViewCompactRows({ rows, fields, objectName, objectDef, onRowClick }: ListViewCompactRowsProps) {
  const { primary, secondary } = compactRowColumns(fields);
  const destination = React.useContext(CompactListDestinationContext);
  const { cell } = useListCells(objectName, objectDef);

  return (
    <>
      <ul className="divide-y" data-testid="list-compact-rows">
        {rows.map((record, i) => {
          const id = (record.id ?? record._id ?? i) as string | number;
          // No columns declared: the record's display name, as the gallery's
          // card heading reads it, and no second line.
          const first = primary ? cell(record, primary) : null;
          const firstContent = first ?? getRecordDisplayName(objectDef, record);
          const second = secondary ? cell(record, secondary) : null;
          return (
            <li key={String(id)} data-testid="list-compact-row">
              <button
                type="button"
                className={cn(
                  'flex w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left',
                  'hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
                )}
                onClick={(e) => {
                  // A link inside a cell (an email, a URL) is its own click.
                  if ((e.target as HTMLElement).closest('a')) return;
                  onRowClick?.(record);
                }}
              >
                <span className="w-full min-w-0 truncate text-sm text-foreground" data-testid="list-compact-primary">
                  {firstContent}
                </span>
                {second != null && (
                  <span
                    className="w-full min-w-0 truncate text-xs text-muted-foreground [&_*]:!text-xs"
                    data-testid="list-compact-secondary"
                  >
                    {second}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {destination && <ListViewCompactFooter destination={destination} />}
    </>
  );
}

/**
 * How many rows a capped list draws when its block states no `limit`
 * (objectstack#26613). A block caps at its `dataSource.limit`, which lands on
 * `pagination.pageSize` through the element binding, and at this otherwise.
 */
export const CAPPED_LIST_DEFAULT_LIMIT = 5;

/** How many of the view's columns a capped list draws; the rest are dropped, not scrolled. */
export const CAPPED_LIST_MAX_COLUMNS = 4;

/** The capped list's columns: the view's first {@link CAPPED_LIST_MAX_COLUMNS} visible ones. */
export function cappedListColumns(fields: readonly unknown[]): Array<{ name: string; entry: unknown }> {
  const columns: Array<{ name: string; entry: unknown }> = [];
  for (const entry of fields) {
    const name = columnIdentity(entry);
    if (typeof name !== 'string' || name.length === 0) continue;
    columns.push({ name, entry });
    if (columns.length === CAPPED_LIST_MAX_COLUMNS) break;
  }
  return columns;
}

export interface ListViewCappedRowsProps extends ListViewCompactRowsProps {
  /** The records the list's query matched, for 「View all N」; `null` while not known. */
  total: number | null;
}

/**
 * The CAPPED posture's rows (objectstack#26613): what a list block in a page
 * region half the page or wider draws in place of the object list's grid. A
 * short table of the view's first four columns over the rows this component
 * fetched (the window is the cap), then the link to the rest, 「View all N →」.
 * No row-number column, no selection, no pager, and no horizontal scroll: the
 * table is fixed to the block's width and each cell truncates.
 *
 * The first cell of each row is a button, so a keyboard reaches the record the
 * row opens; a click anywhere else on the row opens it too.
 */
export function ListViewCappedRows({ rows, fields, objectName, objectDef, total, onRowClick }: ListViewCappedRowsProps) {
  const columns = cappedListColumns(fields);
  const destination = React.useContext(CompactListDestinationContext);
  const displayLocale = useDisplayLocale();
  const { fieldFor, cell } = useListCells(objectName, objectDef);

  // A column entry's own label wins over the field's, as the grid's header reads it.
  const headerFor = ({ name, entry }: { name: string; entry: unknown }): string => {
    const own = entry && typeof entry === 'object' ? (entry as { label?: unknown }).label : undefined;
    const resolved = own != null ? resolveInlineI18nLabel(own as never, displayLocale) : undefined;
    return typeof resolved === 'string' && resolved.length > 0 ? resolved : String(fieldFor(name).label ?? name);
  };

  const open = (record: Record<string, unknown>, target: EventTarget) => {
    // A link inside a cell (an email, a URL) is its own click.
    if ((target as HTMLElement).closest('a')) return;
    onRowClick?.(record);
  };

  return (
    <>
      <table className="w-full table-fixed border-collapse text-sm" data-testid="list-capped-table">
        {columns.length > 0 && (
          <thead>
            <tr className="border-b">
              {columns.map((column) => (
                <th
                  key={column.name}
                  scope="col"
                  className="truncate px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                  data-testid="list-capped-header"
                >
                  {headerFor(column)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="divide-y">
          {rows.map((record, i) => {
            const id = (record.id ?? record._id ?? i) as string | number;
            // No columns declared: one column, the record's display name, as
            // the compact row reads it.
            const cells = columns.length > 0
              ? columns.map(({ name }) => cell(record, name))
              : [null];
            return (
              <tr
                key={String(id)}
                className="cursor-pointer hover:bg-muted/50"
                data-testid="list-capped-row"
                onClick={(e) => open(record, e.target)}
              >
                {cells.map((content, c) => (
                  <td key={columns[c]?.name ?? c} className="truncate px-3 py-2 align-middle">
                    {c === 0 ? (
                      <button
                        type="button"
                        className="w-full min-w-0 truncate text-left text-foreground focus-visible:underline focus-visible:outline-none"
                        onClick={(e) => {
                          // The row's own click opens it; this one only stops a second open.
                          e.stopPropagation();
                          open(record, e.target);
                        }}
                      >
                        {content ?? getRecordDisplayName(objectDef, record)}
                      </button>
                    ) : (
                      content
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {destination && <ListViewCompactFooter destination={destination} count={total} />}
    </>
  );
}
