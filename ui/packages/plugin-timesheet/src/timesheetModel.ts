/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The timesheet's pure model: the binding block read, the week arithmetic, the
 * pivot from detail records to rows × days, and the decision of what one cell
 * edit writes. No React, no adapter — `ObjectTimesheet.tsx` draws what this
 * module computes, and `__tests__/timesheetModel.test.ts` pins it.
 *
 * ## The pivot
 *
 * Each record lands in ONE row and ONE day column:
 *   - its row is the tuple of its `rowFields` values (a lookup's value is its
 *     id, whether the adapter returned the bare id or an expanded record);
 *   - its day is the calendar day its `dateField` value falls on, read in the
 *     viewer's own time zone for a date-time value.
 * A cell sums the `valueField` of every record that landed in it. A cell
 * holding more than one record is shown as that sum and is read-only: the grid
 * cannot tell which record a typed number belongs to.
 */

/** The `timesheet` binding block, as the renderer reads it. */
export interface TimesheetBinding {
  rowFields: string[];
  dateField: string;
  valueField: string;
}

/**
 * The binding a view's `timesheet` block declares, or `null` when the block is
 * missing or incomplete — the "Timesheet configuration required" screen. The
 * spec requires all three keys and one to three row fields; a stored block
 * that skipped validation is judged here the same way rather than drawn half.
 */
export function resolveTimesheetConfig(block: unknown): TimesheetBinding | null {
  if (!block || typeof block !== 'object') return null;
  const { rowFields, dateField, valueField } = block as Record<string, unknown>;
  if (!Array.isArray(rowFields) || rowFields.length < 1 || rowFields.length > 3) return null;
  if (!rowFields.every((f) => typeof f === 'string' && f.length > 0)) return null;
  if (typeof dateField !== 'string' || dateField.length === 0) return null;
  if (typeof valueField !== 'string' || valueField.length === 0) return null;
  return { rowFields: [...rowFields] as string[], dateField, valueField };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** A local calendar day as `YYYY-MM-DD`. */
export function toDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local midnight a `YYYY-MM-DD` key names. */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** `key` moved by `days` calendar days. */
export function addDays(key: string, days: number): string {
  const date = fromDayKey(key);
  date.setDate(date.getDate() + days);
  return toDayKey(date);
}

/**
 * The first day of the week holding `date`, where the week starts on
 * `firstDay` (`Date.prototype.getDay` numbering: 0 is Sunday).
 */
export function startOfWeek(date: Date, firstDay: number): string {
  const offset = (date.getDay() - firstDay + 7) % 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  return toDayKey(start);
}

/** The seven day keys of the week starting on `start`. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The day a stored `dateField` value falls on, or `null` when it names none.
 * A date-only string is that day exactly (no time zone shift); anything with a
 * time is read as an instant and placed on the viewer's local day.
 */
export function dayKeyOf(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : toDayKey(date);
}

/** A record's id, as the record doors key it. */
export function recordIdOf(record: Record<string, unknown>): string | undefined {
  const id = record.id ?? record._id;
  return id === undefined || id === null ? undefined : String(id);
}

/**
 * The value a row field contributes to a row's identity: an expanded lookup
 * record contributes its id, so a row keys the same whether the adapter
 * expanded the relation or returned the bare id.
 */
export function rowFieldKeyValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id ?? (value as Record<string, unknown>)._id;
    if (id !== undefined && id !== null) return id;
  }
  return value ?? null;
}

/** The identity of the row a set of row field values names. */
export function rowKeyOf(values: Record<string, unknown>, rowFields: readonly string[]): string {
  return JSON.stringify(rowFields.map((f) => rowFieldKeyValue(values[f])));
}

/** A number a `valueField` holds, or 0 for anything that is not one. */
export function numericValue(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** One day cell: the records that landed in it and the sum of their values. */
export interface TimesheetCell {
  records: Record<string, unknown>[];
  sum: number;
}

/** One row: its row field values, one cell per day, and the row total. */
export interface TimesheetRow {
  key: string;
  /** The row field values as the first record of the row carried them. */
  values: Record<string, unknown>;
  cells: Record<string, TimesheetCell>;
  total: number;
}

export interface TimesheetGrid {
  rows: TimesheetRow[];
  /** Sum per day key, over every row. */
  dayTotals: Record<string, number>;
  /** Sum over the whole week. */
  weekTotal: number;
}

function emptyRow(key: string, values: Record<string, unknown>, days: readonly string[]): TimesheetRow {
  const cells: Record<string, TimesheetCell> = {};
  for (const day of days) cells[day] = { records: [], sum: 0 };
  return { key, values, cells, total: 0 };
}

/**
 * Pivot `records` into the week's rows. Records whose day falls outside
 * `days` are left out. `extraRows` (rows the viewer added that hold no record
 * yet) are appended, in order, unless a record already made the same row.
 * Rows keep the order their first record arrived in, which is the order the
 * query sorted them.
 */
export function buildTimesheetRows(
  records: readonly Record<string, unknown>[],
  binding: TimesheetBinding,
  days: readonly string[],
  extraRows: readonly Record<string, unknown>[] = [],
): TimesheetGrid {
  const inWeek = new Set(days);
  const rows = new Map<string, TimesheetRow>();
  for (const record of records) {
    const day = dayKeyOf(record[binding.dateField]);
    if (!day || !inWeek.has(day)) continue;
    const key = rowKeyOf(record, binding.rowFields);
    let row = rows.get(key);
    if (!row) {
      const values: Record<string, unknown> = {};
      for (const f of binding.rowFields) values[f] = record[f];
      row = emptyRow(key, values, days);
      rows.set(key, row);
    }
    const amount = numericValue(record[binding.valueField]);
    row.cells[day].records.push(record);
    row.cells[day].sum += amount;
    row.total += amount;
  }
  for (const values of extraRows) {
    const key = rowKeyOf(values, binding.rowFields);
    if (!rows.has(key)) rows.set(key, emptyRow(key, values, days));
  }
  const dayTotals: Record<string, number> = {};
  for (const day of days) dayTotals[day] = 0;
  let weekTotal = 0;
  for (const row of rows.values()) {
    for (const day of days) dayTotals[day] += row.cells[day].sum;
    weekTotal += row.total;
  }
  return { rows: [...rows.values()], dayTotals, weekTotal };
}

/** The decimal and digit-group marks `locale` writes numbers with. */
function numberMarks(locale: string | undefined): { decimal: string; group: string } {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
    const group = parts.find((p) => p.type === 'group')?.value ?? ',';
    // A locale that writes its own decimal mark (Arabic's `٫`) gets the Latin
    // marks: a typed number there is ASCII, and its own digits never parse.
    if (decimal !== '.' && decimal !== ',') return { decimal: '.', group: ',' };
    return { decimal, group };
  } catch {
    return { decimal: '.', group: ',' };
  }
}

/**
 * What a typed cell value means: `null` clears the cell, a number sets it, and
 * `'invalid'` is text that is neither (the cell shows "Enter a number").
 *
 * Read in the display `locale`'s own marks (#34382): its decimal mark, at most
 * once, and its digit-group mark only between whole groups of three — so in
 * `en` `1,000` is a thousand and `1,5` is refused, and in `de` `1.000` is a
 * thousand and `1,5` is one and a half. A locale grouping with a space
 * (`fr`, `ru`) takes any space there. Any other mark, an exponent or a hex
 * prefix is refused rather than guessed at. The grid displays without
 * grouping in the same locale, so what it shows always reads back.
 */
export function parseCellInput(text: string, locale?: string): number | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const { decimal, group } = numberMarks(locale);
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const decimalAt = body.indexOf(decimal);
  if (decimalAt !== body.lastIndexOf(decimal)) return 'invalid';
  const whole = decimalAt < 0 ? body : body.slice(0, decimalAt);
  const fraction = decimalAt < 0 ? '' : body.slice(decimalAt + 1);
  if (!/^\d*$/.test(fraction)) return 'invalid';
  let digits = whole;
  if (!/^\d*$/.test(whole)) {
    const groups = whole.split(/\s/.test(group) ? /\s/ : group);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) return 'invalid';
    digits = groups.join('');
  }
  if (digits === '' && fraction === '') return 'invalid';
  const n = Number(`${negative ? '-' : ''}${digits || '0'}${fraction ? `.${fraction}` : ''}`);
  return Number.isFinite(n) ? n : 'invalid';
}

/**
 * The comparands that bound one displayed week on `dateField`: `[start, end)`.
 *
 * A date field stores calendar days, so the week's day keys bound it exactly. A
 * date-time field stores instants, and a bare `YYYY-MM-DD` comparand is read by
 * the data layer as UTC midnight, while every record is placed on the viewer's
 * LOCAL day (`dayKeyOf`). So a date-time week is bounded by the instants of
 * local midnight at its first day and the day after its last: the query and the
 * placement then agree in every time zone, and a record written at local noon
 * (`dateFieldValue`) is always inside the week it was typed in.
 */
export function weekQueryBounds(
  weekStart: string,
  weekEnd: string,
  dateFieldType?: string,
): [string, string] {
  if (dateFieldType !== 'datetime') return [weekStart, weekEnd];
  return [fromDayKey(weekStart).toISOString(), fromDayKey(weekEnd).toISOString()];
}

/**
 * The value a new record's `dateField` takes for `day`: the day key for a date
 * field, and the instant at local noon for a date-time field, so the record
 * reads back on the same day in every time zone within twelve hours of the
 * viewer's.
 */
export function dateFieldValue(day: string, dateFieldType?: string): string {
  if (dateFieldType !== 'datetime') return day;
  const noon = fromDayKey(day);
  noon.setHours(12);
  return noon.toISOString();
}

/** The record write one cell edit makes. */
export type CellWrite =
  | { kind: 'none' }
  | { kind: 'readonly' }
  | { kind: 'create'; data: Record<string, unknown> }
  | { kind: 'update'; id: string; data: Record<string, unknown> }
  | { kind: 'delete'; id: string };

/**
 * Decide the write that setting `cell` (in row `row`, on `day`) to `next`
 * makes. An empty cell typed into creates a record carrying the row field
 * values, the day and the value; a one-record cell is updated, or deleted when
 * cleared; a cell holding several records is never written.
 */
export function planCellWrite(
  binding: TimesheetBinding,
  row: Pick<TimesheetRow, 'values'>,
  day: string,
  cell: TimesheetCell,
  next: number | null,
  dateFieldType?: string,
): CellWrite {
  if (cell.records.length > 1) return { kind: 'readonly' };
  if (cell.records.length === 0) {
    if (next === null) return { kind: 'none' };
    const data: Record<string, unknown> = {};
    for (const f of binding.rowFields) data[f] = rowFieldKeyValue(row.values[f]);
    data[binding.dateField] = dateFieldValue(day, dateFieldType);
    data[binding.valueField] = next;
    return { kind: 'create', data };
  }
  const record = cell.records[0];
  const id = recordIdOf(record);
  if (id === undefined) return { kind: 'readonly' };
  if (next === null) return { kind: 'delete', id };
  if (next === numericValue(record[binding.valueField])) return { kind: 'none' };
  return { kind: 'update', id, data: { [binding.valueField]: next } };
}

/**
 * Which of a cell's three writes the caller may make. The view resolves each
 * from a row of the affordance-to-grant map (`resolveAffordance` in
 * `@object-ui/core`, objectui#12082); with no permission provider all three
 * read open.
 */
export interface CellWriteGrants {
  create: boolean;
  update: boolean;
  delete: boolean;
}

/**
 * Whether a cell offers an input: an empty cell when the caller may create, a
 * one-record cell when they may update or clear it, and a cell holding
 * several records never.
 */
export function cellEditable(cell: TimesheetCell, grants: CellWriteGrants): boolean {
  if (cell.records.length > 1) return false;
  if (cell.records.length === 0) return grants.create;
  return grants.update || grants.delete;
}

/** Whether the caller may make a planned write. A plan that writes nothing needs no grant. */
export function writeGranted(write: CellWrite, grants: CellWriteGrants): boolean {
  if (write.kind === 'create') return grants.create;
  if (write.kind === 'update') return grants.update;
  if (write.kind === 'delete') return grants.delete;
  return true;
}

/** Whether every row field holds a value — the add-row form's gate. */
export function rowValuesComplete(values: Record<string, unknown>, rowFields: readonly string[]): boolean {
  return rowFields.every((f) => {
    const v = values[f];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
}
