// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * <SettingsMapField> — the control a `map` specifier gets (objectstack#31391):
 * a table of keyed rows, one key column and the declared value columns.
 *
 * The contract it draws is `SpecifierSchema`'s `map` member (objectstack#30208,
 * ADR-0007 as amended): `keyColumn` is the key column's header, `columns` the
 * value columns in display order, each of kind `duration` or
 * `positive_integer`. The keys a map admits are NOT declared: the namespace read
 * serves them as the specifier's `options`, from a runtime option source (the
 * objects that declare a lifecycle class other than `record`; for
 * `lifecycle.quota_defaults`, those classes).
 *
 * Stored value: with one value column `Record<key, value>`
 * (`{ "sys_audit_log": 1000000 }`); with several `Record<key, { [column.name]:
 * value }>` (`{ "sys_job_run": { "maxAge": "1y" } }`), an empty cell left out
 * of its entry.
 *
 * Design notes:
 *  - Rows live in a LOCAL draft with stable ids, as `FlowKeyValueField` keeps
 *    them, so a key change never remounts its row. Every edit is handed to the
 *    page at once as the object the rows store; the draft is rebuilt from
 *    `value` only when the page hands back something else (a reset, a discard,
 *    the re-read after a save).
 *  - A row is added by PICKING ITS KEY: the add control is a picker over the
 *    served keys no row uses yet. So no row is ever keyless, and Save never
 *    drops a half-made row without saying so.
 *  - A key one row uses is not offered to another. A stored key the served
 *    `options` no longer hold stays on its row, marked "not offered", so the
 *    save door's `invalid_option` refusal is explained before Save. With no
 *    `options` served at all the door admits every key (the option source was
 *    unreachable), so nothing is marked then.
 *  - Cells are kept as stored and sent as typed: a `duration` is the literal
 *    `<whole number><h|d|w|y>` (`'90d'`), a `positive_integer` a number, never
 *    text. A cell the server would refuse is still sent, so the refusal names
 *    it; the control does not quietly repair or drop it.
 *  - Removing the last row sends `null`, a clear: the key falls back to its
 *    default, never to a stored `{}`.
 *  - A refusal's `constraint.entry` / `constraint.column` (the save door's
 *    `FieldError`) arrive as `errorAt`: the row named by `entry` is marked, and
 *    so is the cell named by `column`, or the row's key picker when the miss is
 *    the key or the entry itself. The sentence stays the row's error line.
 *
 * @module
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import {
  Badge,
  Button,
  Combobox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@object-ui/components';
import { pickLocalized, useObjectTranslation } from '@object-ui/i18n';
import type { Specifier, SpecifierMapColumn } from './types';

/** Where a map refusal points: the entry, and the column when it is a cell. */
export interface MapRefusalAt {
  entry: string;
  column?: string;
}

/** The duration units the server's `LIFECYCLE_DURATION_REGEX` admits, in order. */
const DURATION_UNITS = ['h', 'd', 'w', 'y'] as const;
type DurationUnit = (typeof DURATION_UNITS)[number];

/** The unit a new duration cell starts with. */
const DEFAULT_DURATION_UNIT: DurationUnit = 'd';

const UNIT_LABEL_KEYS: Record<DurationUnit, string> = {
  h: 'console.settingsView.mapUnitHours',
  d: 'console.settingsView.mapUnitDays',
  w: 'console.settingsView.mapUnitWeeks',
  y: 'console.settingsView.mapUnitYears',
};

/** One row of the local draft: a stable id, its key, and its entry as stored. */
interface MapRow {
  id: string;
  key: string;
  /**
   * The entry exactly as stored or as last edited: the cell itself with one
   * column, an object of cells with several. Kept as is, so a row nobody
   * touches is sent back byte for byte, unknown properties included, and the
   * server judges it as it judged it before.
   */
  entry: unknown;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `map-row-${rowSeq}`;
}

/** The rows a stored value holds, in its own order. Anything but an object holds none. */
function readRows(value: unknown): MapRow[] {
  if (!isPlainRecord(value)) return [];
  return Object.entries(value).map(([key, entry]) => ({ id: nextRowId(), key, entry }));
}

/**
 * The value the rows store: the object of entries in row order, or `null` when
 * there is no row. A single-column row with an empty cell stores `null` for
 * its key, which the save door refuses on that row, rather than vanishing.
 */
function rowsToValue(rows: readonly MapRow[]): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = row.entry === undefined ? null : row.entry;
  return out;
}

/** The identity the resync compares: insertion order is the row order, so it counts. */
function valueIdentity(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** A cell of a row's entry, for the column given. */
function cellOf(entry: unknown, column: SpecifierMapColumn, single: boolean): unknown {
  if (single) return entry;
  return isPlainRecord(entry) ? entry[column.name] : undefined;
}

/** The entry with one cell replaced; `undefined` leaves the cell out. */
function withCell(entry: unknown, column: SpecifierMapColumn, single: boolean, cell: unknown): unknown {
  if (single) return cell;
  const next: Record<string, unknown> = isPlainRecord(entry) ? { ...entry } : {};
  if (cell === undefined) delete next[column.name];
  else next[column.name] = cell;
  return next;
}

/**
 * A stored duration cell, split for the two inputs. A literal the server's
 * grammar reads splits into its whole number and its unit; any other text is
 * shown as it is in the number box with no unit chosen, so a malformed stored
 * value is visible rather than blanked.
 */
function splitDuration(cell: unknown): { amount: string; unit: DurationUnit | undefined } {
  if (cell === null || cell === undefined) return { amount: '', unit: undefined };
  const text = String(cell);
  const unit = text.slice(-1) as DurationUnit;
  if (DURATION_UNITS.includes(unit)) return { amount: text.slice(0, -1), unit };
  return { amount: text, unit: undefined };
}

interface CellProps {
  column: SpecifierMapColumn;
  columnLabel: string;
  cell: unknown;
  disabled?: boolean;
  invalid: boolean;
  describedBy?: string;
  onCell: (cell: unknown) => void;
}

/** A `duration` cell: a whole number and a unit, stored as the literal (`'90d'`). */
function DurationCell({ columnLabel, cell, disabled, invalid, describedBy, onCell }: CellProps) {
  const { t } = useObjectTranslation();
  const { amount, unit } = splitDuration(cell);
  const shownUnit = unit ?? DEFAULT_DURATION_UNIT;
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={amount}
        disabled={disabled}
        aria-label={columnLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedBy : undefined}
        className="w-24"
        onChange={(e) => {
          const typed = e.target.value;
          onCell(typed === '' ? undefined : `${typed}${shownUnit}`);
        }}
      />
      <Select
        value={unit}
        disabled={disabled}
        onValueChange={(next) => {
          // A unit chosen before a number is typed waits for the number.
          if (amount !== '') onCell(`${amount}${next}`);
        }}
      >
        <SelectTrigger
          className="w-28"
          aria-label={t('console.settingsView.mapUnitLabel', { column: columnLabel })}
        >
          <SelectValue placeholder={t(UNIT_LABEL_KEYS[DEFAULT_DURATION_UNIT])} />
        </SelectTrigger>
        <SelectContent>
          {DURATION_UNITS.map((u) => (
            <SelectItem key={u} value={u}>
              {t(UNIT_LABEL_KEYS[u])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A `positive_integer` cell: a whole number above 0, sent as a number. */
function PositiveIntegerCell({ columnLabel, cell, disabled, invalid, describedBy, onCell }: CellProps) {
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      value={cell === null || cell === undefined ? '' : String(cell)}
      disabled={disabled}
      aria-label={columnLabel}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? describedBy : undefined}
      className="w-36"
      onChange={(e) => {
        const typed = e.target.value;
        onCell(typed === '' ? undefined : Number(typed));
      }}
    />
  );
}

export interface SettingsMapFieldProps {
  spec: Specifier;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  /** The id of the row's label, which names this group. */
  labelId: string;
  /** An option's shown name, translated through the namespace's option slot. */
  optionLabel: (option: NonNullable<Specifier['options']>[number]) => string;
  /** The save door's pointer into the value, from the last refused save. */
  errorAt?: MapRefusalAt;
  /** Set by the row's wrapper: the error line and note this control is described by. */
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function SettingsMapField({
  spec,
  value,
  onChange,
  disabled,
  labelId,
  optionLabel,
  errorAt,
  'aria-describedby': describedBy,
}: SettingsMapFieldProps) {
  const { t, language } = useObjectTranslation();
  const columns = spec.columns ?? [];
  const single = columns.length === 1;
  const served = (spec.options ?? []).map((opt) => ({ value: String(opt.value), label: optionLabel(opt) }));
  const servedKeys = new Set(served.map((o) => o.value));

  // The local draft, rebuilt from `value` when the page hands back a value
  // these rows did not produce (React's adjust-state-during-render pattern).
  const incoming = valueIdentity(value);
  const [draft, setDraft] = useState(() => ({ seen: incoming, rows: readRows(value) }));
  let rows = draft.rows;
  if (draft.seen !== incoming) {
    rows = readRows(value);
    setDraft({ seen: incoming, rows });
  }

  const commit = (next: MapRow[]) => {
    const out = rowsToValue(next);
    setDraft({ seen: valueIdentity(out), rows: next });
    onChange(out);
  };

  const usedKeys = new Set(rows.map((r) => r.key));
  const unused = served.filter((o) => !usedKeys.has(o.value));
  const keyHeader = pickLocalized(spec.keyColumn?.label, language);
  const columnLabels = columns.map((c) => pickLocalized(c.label, language));
  const searchText = t('console.settingsView.mapSearchKey');
  const emptyText = t('common.noResults');

  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <Table aria-describedby={errorAt ? undefined : describedBy}>
        <TableHeader>
          <TableRow>
            <TableHead>{keyHeader}</TableHead>
            {columns.map((c, i) => (
              <TableHead key={c.name} title={c.description}>
                {columnLabels[i]}
              </TableHead>
            ))}
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length + 2} className="text-sm text-muted-foreground">
                {t('console.settingsView.mapNoRows')}
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((row) => {
            const marked = errorAt?.entry === row.key;
            const markedColumn = marked && errorAt?.column && columns.some((c) => c.name === errorAt.column)
              ? errorAt.column
              : undefined;
            const keyMarked = marked && markedColumn === undefined;
            const notOffered = served.length > 0 && !servedKeys.has(row.key);
            const ownOption = served.find((o) => o.value === row.key) ?? { value: row.key, label: row.key };
            const keyOptions = [ownOption, ...unused];
            const rowName = ownOption.label;
            return (
              <TableRow
                key={row.id}
                data-map-entry={row.key}
                data-invalid={marked ? 'true' : undefined}
                className={cn(marked && 'bg-destructive/5')}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Combobox
                      options={keyOptions}
                      value={row.key}
                      disabled={disabled}
                      searchPlaceholder={searchText}
                      emptyText={emptyText}
                      aria-invalid={keyMarked || undefined}
                      aria-describedby={keyMarked ? describedBy : undefined}
                      className={cn('w-56', keyMarked && 'border-destructive')}
                      onValueChange={(next) => {
                        // Picking the row's own key again deselects it; a row
                        // keeps its key until another is picked.
                        if (!next || next === row.key) return;
                        commit(rows.map((r) => (r.id === row.id ? { ...r, key: next } : r)));
                      }}
                    />
                    {notOffered ? (
                      <Badge
                        variant="outline"
                        className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
                        title={t('console.settingsView.mapKeyNotOfferedHint')}
                        data-testid="settings-map-not-offered"
                      >
                        {t('console.settingsView.mapKeyNotOffered')}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                {columns.map((column, i) => {
                  const cellProps: CellProps = {
                    column,
                    columnLabel: columnLabels[i],
                    cell: cellOf(row.entry, column, single),
                    disabled,
                    invalid: markedColumn === column.name,
                    describedBy,
                    onCell: (cell) =>
                      commit(
                        rows.map((r) => (r.id === row.id ? { ...r, entry: withCell(r.entry, column, single, cell) } : r)),
                      ),
                  };
                  return (
                    <TableCell key={column.name}>
                      {column.kind === 'duration' ? <DurationCell {...cellProps} /> : <PositiveIntegerCell {...cellProps} />}
                    </TableCell>
                  );
                })}
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={t('console.settingsView.mapRemoveRow', { key: rowName })}
                    onClick={() => commit(rows.filter((r) => r.id !== row.id))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Combobox
        options={unused}
        value=""
        disabled={disabled || unused.length === 0}
        placeholder={t('console.settingsView.mapAddRow')}
        searchPlaceholder={searchText}
        emptyText={emptyText}
        className="w-56"
        onValueChange={(key) => {
          if (!key || usedKeys.has(key)) return;
          commit([...rows, { id: nextRowId(), key, entry: single ? undefined : {} }]);
        }}
      />
    </div>
  );
}
