import React, { useCallback, useRef } from 'react';
import { FieldWidgetComponentProps } from './types.js';
import {
  cn,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Checkbox,
  Label,
} from '@object-ui/components';
import { Plus, Trash2, SlidersHorizontal, Maximize2, Copy, GripVertical } from 'lucide-react';
import { formatDate, formatDateTime, resolveFieldRuleState, toDisplayDate } from '@object-ui/core';
import { useDisplayLocale, useLocalization, formatDisplayNumber } from '@object-ui/i18n';
import { resolveFieldCurrency, currencyFractionDigits, currencySymbol } from '../currency.js';
import { LookupField } from './LookupField.js';
import { FileCell } from './FileField.js';
import { toDateInputValue, toDateTimeInputValue, fromDateTimeInputValue, isImpossibleStoredDay } from './nativeDateValue.js';
import { useFieldTranslation } from './useFieldTranslation.js';
import { toDomProps } from './toDomProps.js';
import { toHostGroupProps } from './toHostGroupProps.js';
import type { InlineGridColumn } from '@objectstack/spec/data';
import { GRID_FIELD_RETIRED_KEYS, type GridFieldMetadata, type GridFieldRetiredKey } from '@object-ui/types';

/**
 * GridField / LineItemsField — editable child-grid ("line items") widget.
 *
 * ## Where the host's label and help text land, and why (objectui#4857)
 *
 * This widget forwarded nothing a host handed it, so the field's visible label
 * pointed `for` at an id no element carried and the help text had zero
 * consumers. Measured on `origin/main` at `e71c854ce`, a real form, editable
 * state, `description` set:
 *
 * ```
 * bare (no columns)   for=DANGLING hostIdEl=NONE consumers=0  focusables=[button]
 * columns + one row   for=DANGLING hostIdEl=NONE consumers=0  focusables=[drag,
 *                       input(Item), input(Qty), button(Duplicate row),
 *                       button(Remove row), input(Item), input(Qty), button(Add)]
 * ```
 *
 * The bare row's single focusable is the auxiliary "Add line" BUTTON — labelable,
 * but routing the host id (and so the label's `for`) onto it would make the
 * field's label NAME the add-row action and make a click on the label insert a
 * row. Every realistic config is a composite: many cell inputs, each with its
 * own `aria-label`, under one container. So this widget declares
 * `labelling: 'group'` (see `FIELD_WIDGET_LABELLING` in `../index`) — the
 * objectui#3961 composite shape, like `address` — and the CONTAINER consumes the
 * host's keys:
 *
 *  - editable / list mode: the root div takes the DOM pass-through minus `name`
 *    (DOM-legal on form controls only — the objectui#3291 leak) and minus
 *    `aria-invalid` (control-channel state; this grid reports validity per CELL,
 *    with its own inline marks), answering `role="group"` only when a host
 *    actually named it — `CheckboxesField`'s split, key for key.
 *
 *    That strip STANDS (objectui#3318 upheld it rather than overturning it):
 *    the container is not a control, so the host's state is not re-routed onto
 *    it. What #3318 added is the other half the strip implied but nobody had
 *    built — the host's failure now DRIVES the per-cell channel this comment
 *    already claimed as the reporting path. See `hostFailedEmpty`.
 *  - readonly: the table replaces the inputs entirely, so that surface takes the
 *    name AND the description via `toHostGroupProps` — `'instead-of-the-inputs'`.
 *
 * A controlled component: `value` is an array of row objects, `onChange`
 * receives the next array. It renders one editable cell per configured
 * column, supports add / delete row, and shows a running total of a numeric
 * column. This is the renderer for the `field:grid` widget and the cell
 * engine behind the master-detail subform (see ADR-0001).
 *
 * Column config: `@objectstack/spec`'s inline grid column, by reference —
 * see {@link GridColumn}.
 *
 * Field-level config: the keys `GridFieldMetadata` (`@object-ui/types`)
 * declares, each read under that one spelling (objectui#11070 round 8), and
 * no other key: `sortField`, the last key read before any face declared it,
 * is declared there too (objectui#11070 round 9). objectui#11610 renamed all
 * eight from snake_case to camelCase; a field still carrying a snake_case
 * spelling is refused by name instead of drawn (`RetiredGridFieldKeys`).
 */

/**
 * One grid column — `@objectstack/spec`'s inline grid column
 * (`InlineGridColumn`, the element of `FieldSchema.inlineColumns`), BY
 * REFERENCE (objectui#11070). The spec declares that shape as the strict
 * mirror of this widget's column, so the widget's type IS the spec's: one
 * declaration, the same one `GridFieldMetadata.columns` and
 * `FormField.columns` (`@object-ui/types`) carry. This widget reads each
 * column by exactly the spec's keys — every key below is one the spec
 * declares, and there is no second spelling of any of them.
 *
 * How the widget reads the keys (the spec's own descriptions say what each
 * MEANS; these are the renderer's notes):
 *
 *  - `name` — the key a column reads and writes on each row object. There is
 *    deliberately no tolerant alias bridging the spelling objectui#3951
 *    retired to this one: a single spelling, enforced at the producer —
 *    AGENTS.md #0.1 (the spec refuses the retired spelling by name).
 *    (Wording note: do not restate that rule as an alternation expression over
 *    the two key names. `column-identity.ratchet.test.ts` (objectui#3104) scans
 *    these files line by line and cannot tell prose from code, so spelling the
 *    shape out here registers as a new dual read and fails the gate.)
 *  - `type` — the cell control and its read/write adapter. `date` /
 *    `datetime` / `time` are three DISTINCT controls, not one
 *    (objectui#3569): `<input type="date">` hands back a bare `YYYY-MM-DD` on
 *    change, so collapsing `datetime` onto it silently DELETED the time
 *    component from the record.
 *  - `prefix` — a symbol shown in a `currency` cell IN PLACE OF the resolved
 *    currency's own symbol. When absent, the cell shows the symbol of the
 *    currency it resolves (objectui#10355); there is no default symbol.
 *  - `defaultHidden` — collapsed into the column chooser, not dropped
 *    (`deriveColumns` sets it beyond the default-visible budget). Required
 *    columns are never default-hidden.
 *  - `computed` + `expr` — a read-only column recomputed live from sibling
 *    cells by this file's own safe arithmetic evaluator (`+ - * / %`,
 *    parentheses, numeric literals, `record.qty` or bare `qty`), and written
 *    back into the row so it persists and any running total reflects it.
 *  - `scale` — decimal places for a computed `number` result. ⛔ Not read on
 *    a `currency` column (objectui#10783): the resolved currency's ISO 4217
 *    minor unit decides both the stored and the shown width
 *    (`currencyWidth`), and the spec refuses `scale` on a column declaring
 *    `type: 'currency'`. A column that takes `currency` from its child field
 *    at render time is reported by `hydrateColumns` in
 *    `@object-ui/plugin-form` instead of being read in silence.
 *  - `autofill` — for a `lookup` column: picking a record copies its fields
 *    into sibling columns of the same name. On unless set `false`.
 *  - `readonlyWhen` / `requiredWhen` — CEL predicates evaluated per row
 *    against the row as `record` plus the header as `parent`. Client-side UX;
 *    a predicate that faults fails open.
 */
export type GridColumn = InlineGridColumn;

type Row = Record<string, any>;

const isNumeric = (t?: string) => t === 'number' || t === 'currency';

/** Comfortable minimum widths per column type so cells never get crushed; the
 *  grid scrolls horizontally instead. Authors can still pin a `width`. */
const MIN_WIDTH_BY_TYPE: Record<string, number> = {
  text: 160,
  select: 132,
  lookup: 168,
  number: 104,
  currency: 116,
  date: 150,
  // `<input type="datetime-local">` renders a day AND a wall clock, so it needs
  // materially more room than a date cell before the browser starts eliding.
  datetime: 200,
  time: 116,
  file: 168,
};
const minWidthFor = (c: GridColumn): number => c.width ?? MIN_WIDTH_BY_TYPE[c.type ?? 'text'] ?? 132;

/**
 * Per-column sizing. Text columns flex to absorb slack (so the description
 * never gets crushed), while numeric / select / date / lookup columns get a
 * fixed sensible width — the role-based sizing every enterprise line grid uses
 * (Qty stays narrow, Description stays wide). Authors can still pin `width`.
 */
function widthStyle(c: GridColumn): React.CSSProperties {
  if (c.width) return { width: c.width, minWidth: c.width };
  if ((c.type ?? 'text') === 'text') return { minWidth: 180 }; // flex, no fixed width
  const w = MIN_WIDTH_BY_TYPE[c.type ?? 'text'] ?? 132;
  return { width: w, minWidth: w };
}

// ── Safe arithmetic evaluator for computed columns ──────────────────────────
// A tiny recursive-descent parser over `+ - * / %`, parentheses, numeric
// literals and field references (`record.qty` or bare `qty`). Deliberately NOT
// eval()/Function() — only arithmetic, no code execution. Returns a finite
// number, or null when the expression is unparseable or any referenced cell is
// blank/non-numeric (so a computed amount reads "—" until its inputs exist).
type Tok = { t: 'num' | 'id' | 'op' | 'lp' | 'rp'; v: string };

function tokenize(s: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i + 1;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++;
      toks.push({ t: 'num', v: s.slice(i, j) }); i = j; continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_.]/.test(s[j])) j++;
      toks.push({ t: 'id', v: s.slice(i, j) }); i = j; continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%') { toks.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(') { toks.push({ t: 'lp', v: c }); i++; continue; }
    if (c === ')') { toks.push({ t: 'rp', v: c }); i++; continue; }
    return null; // unsupported character → bail (treat as non-computable)
  }
  return toks;
}

/** Resolve an identifier (`record.quantity` / `quantity`) to a numeric cell. */
function resolveRef(id: string, row: Row): number | null {
  const field = id.startsWith('record.') ? id.slice('record.'.length) : id;
  const raw = row?.[field];
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Evaluate an arithmetic `expr` against `row`. null when blank/unparseable. */
export function evalArith(expr: string, row: Row): number | null {
  const toks = tokenize(expr);
  if (!toks || toks.length === 0) return null;
  let pos = 0;
  let bad = false;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function factor(): number {
    const tk = peek();
    if (!tk) { bad = true; return NaN; }
    if (tk.t === 'op' && tk.v === '-') { next(); return -factor(); }
    if (tk.t === 'op' && tk.v === '+') { next(); return factor(); }
    if (tk.t === 'num') { next(); return Number(tk.v); }
    if (tk.t === 'id') { next(); const v = resolveRef(tk.v, row); if (v === null) { bad = true; return NaN; } return v; }
    if (tk.t === 'lp') {
      next();
      const v = expression();
      const close = next();
      if (!close || close.t !== 'rp') bad = true;
      return v;
    }
    bad = true; return NaN;
  }
  function term(): number {
    let v = factor();
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = next().v;
      const r = factor();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function expression(): number {
    let v = term();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const result = expression();
  if (bad || pos !== toks.length || !Number.isFinite(result)) return null;
  return result;
}

/**
 * Recompute every {@link GridColumn.computed} cell in `row` from its sibling
 * inputs, returning a new row. Called after each edit so computed columns and
 * the running total stay live, and so the computed value persists in the batch.
 */
/**
 * Build the row patch for a lookup-cell selection: set the FK column to the
 * chosen record's id, and (unless the column opts out with `autofill: false`)
 * copy any of the record's fields whose names match a sibling column — the
 * catalog-typeahead behaviour (pick a product → its unit_price/description fill
 * in). Skips the lookup column itself and computed columns. Pure + exported so
 * it is unit-testable independent of the picker UI.
 */
export function lookupAutofillPatch(columns: GridColumn[], col: GridColumn, record: any): Row {
  const patch: Row = { [col.name]: record?.value ?? record?.id ?? record?._id };
  if (col.autofill !== false && record && typeof record === 'object') {
    for (const other of columns) {
      if (other.name === col.name || other.computed || other.type === 'lookup') continue;
      const v = record[other.name];
      if (v !== undefined && v !== null && v !== '') patch[other.name] = v;
    }
  }
  return patch;
}

/**
 * The currency a `currency` column is denominated in (objectui#10355).
 *
 * Read through `resolveFieldCurrency` — the one precedence every currency face
 * shares (field `currency` → `currencyConfig.defaultCurrency` → a legacy
 * `defaultCurrency` → the tenant default) — ⛔ never a second copy of it.
 *
 * The field-level legs are handed nothing, deliberately: a grid column
 * declares none of those keys — not `GridColumn`, which is the spec's strict
 * `InlineGridColumnSchema` element by reference, and that schema refuses
 * them — and the column derivation in `@object-ui/plugin-form`
 * copies none of them from the child field. Reading them off the column would
 * add a renderer read that no authored metadata can reach. So the precedence
 * lands on the tenant default, and `undefined` when none is configured: the
 * caller then invents no currency, exactly as `CurrencyCellRenderer` does.
 */
function columnCurrency(tenantCurrency: string | undefined): string | undefined {
  return resolveFieldCurrency(undefined, tenantCurrency);
}

/**
 * The fraction width of a `currency` column (objectui#10355) — the ONE
 * decision behind both its stored computed value and its display.
 *
 * 1. The resolved currency's ISO 4217 minor unit (0 for JPY, 2 for USD, 3 for
 *    KWD), from `currencyFractionDigits`, the helper every currency face
 *    already uses. It replaced the old default of a literal `2`, under which a
 *    yen amount was stored with cents it does not have and a dinar amount lost
 *    its third digit (KWD 3 × 1.2345 stored `3.7`): a currency's decimal places
 *    are the currency's (ruling 乙 on objectstack-ai/objectstack#19910).
 * 2. Otherwise `undefined`: with no minor unit to round to, nothing is
 *    invented.
 *
 * ⛔ The column's own `scale` is not an input (objectui#10783). This read it
 * first, so an authored `scale` beat the minor unit. `@objectstack/spec` 17.5.0
 * refuses that key on a column declaring `type: 'currency'`, with the remedy
 * that the minor unit decides, so a spec-valid typed column never carries one.
 * A column that declares no `type` and hydrates to `currency` still can; its
 * `scale` is reported where the child field is known (`hydrateColumns` in
 * `@object-ui/plugin-form`), not read here.
 */
function currencyWidth(currency: string | undefined): number | undefined {
  return currency ? currencyFractionDigits(currency) : undefined;
}

/**
 * The fraction width a computed cell's STORED value is rounded to.
 *
 * - `currency` — {@link currencyWidth}; with no resolved currency the value is
 *   stored as computed. The column's `scale` is not read (objectui#10783).
 * - every other type — the column's declared `scale`, unrounded when absent
 *   (unchanged).
 *
 * No clamp to the engine's `toFixed` ceiling: the objectui#10071 one retired at
 * the objectui#9808 SUNSET (objectui#11073), since `@objectstack/spec` 17.5.0
 * refuses a `scale` above 100 at the declaration.
 */
function storedFractionScale(c: GridColumn, tenantCurrency: string | undefined): number | undefined {
  if (c.type !== 'currency') return c.scale;
  return currencyWidth(columnCurrency(tenantCurrency));
}

/**
 * @param tenantCurrency the tenant's default currency (`useLocalization()`),
 *   the resolver's last step for a `currency` column — see
 *   {@link storedFractionScale}.
 */
export function computeRow(columns: GridColumn[], row: Row, tenantCurrency?: string): Row {
  const computedCols = columns.filter((c) => c.computed && c.expr);
  if (computedCols.length === 0) return row;
  const next = { ...row };
  for (const c of computedCols) {
    const v = evalArith(c.expr!, next);
    if (v === null) { next[c.name] = null; continue; }
    const scale = storedFractionScale(c, tenantCurrency);
    next[c.name] = scale != null ? Number(v.toFixed(scale)) : v;
  }
  return next;
}

/** True for the three temporal column types, which all need a formatter on the
 *  read-only surfaces rather than the raw stored string (objectui#3569). */
const isTemporal = (t?: string) => t === 'date' || t === 'datetime' || t === 'time';

/**
 * Read-only display text for a temporal cell (objectui#3569).
 *
 * The stored shapes differ per type and so must the rendering — which is only
 * decidable now that `datetime`/`time` are no longer collapsed onto `date`:
 *
 * - `date` — a calendar day. Its VERBATIM `YYYY-MM-DD` (`toDateInputValue`
 *   keeps a stored string's leading day as written) goes through the
 *   shared parse step `toDisplayDate`, which builds local midnight of that day,
 *   never the UTC midnight `new Date('2026-06-17')` would give, so the 17th
 *   stays the 17th west of Greenwich. It used to build that `Date` here, by
 *   hand, with `new Date(y, m - 1, d)`, which rolls `2026-02-30` into March
 *   2nd: the step's refusal of a nonexistent day (objectui#10026) never
 *   reached this cell (objectui#10301).
 * - `datetime` — an instant, rendered on `formatDateTime`'s `'compact'` face:
 *   local day + local time, the same basis `toDateTimeInputValue` uses for the
 *   editor, so the two never disagree about a real instant. ⚠️ It no longer
 *   matches `DateTimeField`'s readonly rendering, and that is the RULING on
 *   objectui#8209 rather than a drift: both sites went to the one home
 *   `formatDateTime`, each on the face of its register — a dense grid cell is
 *   `'compact'`, a readonly form / detail field is the verbose default.
 * - `time` — a zone-less wall clock (`HH:mm[:ss]`); it is already display-ready.
 *
 * An unparseable value falls through to its raw string rather than rendering
 * "Invalid Date" — showing the user what is actually stored beats hiding it.
 * On both the `date` and `datetime` arms "unparseable" is whatever
 * `toDisplayDate` refuses, a day its month does not have included, so this
 * cell shows `2026-02-30` as stored instead of a real day nobody wrote.
 *
 * `locale` is threaded rather than left to `Intl`'s default (objectui#4468):
 * the default is the MACHINE's locale, which has nothing to do with the
 * session, so a Chinese form rendered `6/17/2026` in its line items.
 */
function temporalText(type: string | undefined, value: any, locale: string): string {
  const raw = String(value);
  if (type === 'time') return raw;
  if (type === 'date') {
    const ymd = toDateInputValue(value);
    if (!ymd) return raw;
    const day = toDisplayDate(ymd);
    if (Number.isNaN(day.getTime())) return raw;
    // `formatDate`'s DEFAULT style — the one home for the `date` display
    // convention (objectui#8194, following the maintainer's ruling A behind
    // `c15d7eca6`). This branch used to call `toLocaleDateString(locale)`
    // with NO options bag, i.e. `Intl`'s numeric default (`7/4/2026`), so a
    // sub-grid cell and a `date` field cell on the same screen rendered the
    // same value two ways — the split ruling A settled, one surface over.
    // Current-year values lose the year here now (`Jul 4`); past- and
    // future-year values are byte-identical.
    //
    // The two guards above still own the unparseable case, so this branch
    // never reaches `formatDate`'s `—`: an unreadable stored value keeps
    // showing what is actually stored (objectui#3569). `day` is handed over
    // as a `Date`, which the shared function uses verbatim.
    return formatDate(day, undefined, { locale });
  }
  // Validity is the shared parse step's answer, so a date-time written on a
  // nonexistent day is refused here too (objectui#10301). The formatter still
  // takes the engine's `new Date(raw)`: this arm renders an INSTANT, exactly as
  // `DateTimeCellRenderer` does with the same split.
  if (Number.isNaN(toDisplayDate(value instanceof Date ? value : raw).getTime())) return raw;
  const dt = value instanceof Date ? value : new Date(raw);
  // `formatDateTime`'s `'compact'` face — the one home for the `datetime`
  // display convention (objectui#7443), on the face the maintainer ruled for
  // THIS register on objectui#8209. A sub-grid cell sits beside `datetime`
  // cells, and `DateTimeCellRenderer`'s own default face is `'compact'`, so
  // that is the register's face here. This branch used to compose
  // `toLocaleDateString(locale)` and `toLocaleTimeString(locale)` with NO
  // options bag, which put seconds in a dense cell that the `datetime` cell
  // one component over never showed.
  //
  // ⛔ The style is a LITERAL, not an authored read, and that departs from the
  // call shape the ruling wrote (`field.format ?? 'compact'`). It has to:
  // `temporalText` is handed a column `type`, and the `GridColumn` its caller
  // holds — the spec's inline grid column, by reference — declares no
  // `format` key at all, so there is nothing here to reuse the way
  // `DateTimeCellRenderer` reuses `DateTimeFieldMetadata.format`. Spelling the
  // read anyway would mean DECLARING that key, which the same ruling forbids
  // in the same breath ("reuse, not a new declaration"). The ruled FACE is
  // delivered; only the read that would have selected it is absent, because
  // the vocabulary it would read does not exist on this surface.
  //
  // The `Number.isNaN` guard above still owns the unparseable case, so this
  // branch never reaches `formatDateTime`'s `—`: an unreadable stored value
  // keeps showing what is actually stored (objectui#3569), exactly as the
  // `date` branch's guards do.
  return formatDateTime(dt, { style: 'compact', locale });
}

/**
 * The symbol a `currency` cell shows: the column's authored `prefix`, else the
 * resolved currency's own symbol through `currencySymbol` (the one channel
 * `CurrencyField` uses too), else nothing. ⛔ No default symbol
 * (objectui#10355): both currency faces of this grid used to fall back to a
 * literal `¥`, so a USD tenant's line items read `¥1,234.57`.
 */
function currencyAdornment(c: GridColumn, currency: string | undefined, locale: string): string {
  if (c.prefix) return c.prefix;
  return currency ? currencySymbol(currency, locale) : '';
}

/**
 * Display text for a finite amount in a `currency` cell (objectui#10355).
 *
 * The width is {@link currencyWidth} — the same decision that rounds the
 * stored value — so a yen amount shows no decimals and a dinar amount three,
 * whatever `scale` the column carries (objectui#10783). With no resolved
 * currency there is no width to take, and the amount keeps the plain locale
 * format this branch always had.
 *
 * With no authored `prefix`, the amount is `Intl`'s own currency format, so
 * the symbol sits where the locale puts it (`¥3,704`, `3.704 ¥` in de-DE). An
 * authored `prefix` replaces the symbol, not the width.
 */
function currencyText(c: GridColumn, n: number, currency: string | undefined, locale: string): string {
  const digits = currencyWidth(currency);
  const width = digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  if (c.prefix || !currency) {
    return `${currencyAdornment(c, currency, locale)}${formatDisplayNumber(n, { locale, ...width })}`;
  }
  try {
    return formatDisplayNumber(n, { locale, currency, ...width });
  } catch {
    // A malformed currency code: `Intl` refuses it. Show the code beside the
    // amount rather than take the cell down — `formatCurrency`'s fallback.
    return `${currency} ${n.toFixed(digits)}`;
  }
}

/**
 * The session-language words a file cell's text is made of (objectui#12924),
 * read by the component from the packs and handed to {@link cellDisplayText}:
 * the count a cell holding several files states (`detail.fileCount`, the count
 * family `FileCellRenderer` states a file count with), and the name a file
 * whose value carries none is shown by (`fields.file.fileFallback`, the name
 * `FileField` and `FileCellRenderer` give it). Both used to be the English
 * literals `N files` / `File` here, on every locale.
 */
interface FileCellText {
  count: (count: number) => string;
  nameless: string;
}

/** Read-only display text for a cell in list mode (select → option label,
 *  currency/number → formatted, date/datetime/time → localized, file → its
 *  name or a count of its files, empty → em dash). Lookups render separately.
 *  `currency` is the column's resolved currency, read only by the currency
 *  branch. The component binds `fileText` once, as its `displayText`. */
function cellDisplayText(c: GridColumn, value: any, locale: string, fileText: FileCellText, currency?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (isTemporal(c.type)) return temporalText(c.type, value, locale);
  if (c.type === 'file') {
    const files = Array.isArray(value) ? value : [value];
    if (files.length === 0) return '—';
    if (files.length > 1) return fileText.count(files.length);
    const f = files[0];
    return typeof f === 'string' ? f : f?.name || f?.original_name || fileText.nameless;
  }
  if (c.type === 'select' && Array.isArray(c.options)) {
    const opt = c.options.find((o) => String(o.value) === String(value));
    return opt ? opt.label : String(value);
  }
  if (isNumeric(c.type)) {
    const n = Number(value);
    // The numeric branch formats in the SAME declared locale the temporal
    // branch above is handed. It used to drop it, so one grid row read a date
    // in the session's convention beside an amount grouped and decimal-marked
    // the machine's way (objectui#9909).
    if (Number.isFinite(n)) return c.type === 'currency' ? currencyText(c, n, currency, locale) : n.toLocaleString(locale);
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function coerce(type: string | undefined, raw: string): any {
  if (isNumeric(type)) {
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  // `<input type="datetime-local">` hands back a ZONE-LESS local wall clock;
  // storing that verbatim would put the write on a different basis from the
  // read (`toDateTimeInputValue`), so a user in UTC+8 who picked 08:33 would
  // store 08:33Z and see 16:33 back. The pair must be used as a pair — this is
  // the same contract `DateTimeField` follows (objectui#3127 / #3569).
  // `date` and `time` need no conversion: their controls already emit exactly
  // the stored shape (`YYYY-MM-DD`, `HH:mm`).
  if (type === 'datetime') return fromDateTimeInputValue(raw);
  return raw;
}

/** Sum a numeric column across rows (ignoring blanks/NaN). */
export function sumColumn(rows: Row[], field: string): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((acc, r) => {
    const v = Number(r?.[field]);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}

type GridFieldProps = FieldWidgetComponentProps<Row[]> & {
  /** When provided, each row shows an "expand" button that opens the row in a
   *  full form (the host — e.g. MasterDetailForm — renders the drawer/modal and
   *  writes the edited values back). Lets a "fat" child be edited in a real form
   *  while the grid stays a quick at-a-glance editor. */
  onRowExpand?: (rowIndex: number) => void;
  /** 'grid' (default) = editable cells; 'list' = read-only rows whose primary
   *  action is per-row edit (via `onRowExpand`) and whose Add opens a new row
   *  in the full form (via `onAdd`). The form-factor for "fat" children. */
  displayMode?: 'grid' | 'list';
  /** In 'list' mode, "Add" calls this (host opens the full form for a new row)
   *  instead of inserting a blank inline row. */
  onAdd?: () => void;
  /** The header/parent record, bound as `parent` when evaluating a column's
   *  `readonlyWhen` / `requiredWhen` CEL predicate — so a line cell can react to
   *  the header (`parent.status == 'paid'`). Supplied by MasterDetailForm. */
  contextRecord?: Record<string, unknown>;
};

/**
 * The retired snake_case field-level keys a grid field's metadata carries, in
 * {@link GRID_FIELD_RETIRED_KEYS} order (objectui#11610). A key holding
 * `undefined` is not counted: no JSON document can carry one, and the TS and
 * zod faces accept it too, so all three faces draw the line in one place.
 */
function retiredGridFieldKeysOf(field: unknown): GridFieldRetiredKey[] {
  if (field == null || typeof field !== 'object') return [];
  const carrier = field as Record<string, unknown>;
  return (Object.keys(GRID_FIELD_RETIRED_KEYS) as GridFieldRetiredKey[]).filter(
    (key) => carrier[key] !== undefined,
  );
}

/**
 * The prescription a grid field carrying retired keys answers with: names the
 * field when it has a name, then each retired key beside the camelCase key to
 * write. One sentence, read by the alert and by the console line.
 */
function retiredGridFieldKeysMessage(fieldName: unknown, keys: readonly GridFieldRetiredKey[]): string {
  const which = typeof fieldName === 'string' && fieldName ? `Grid field \`${fieldName}\`` : 'This grid field';
  const renames = keys.map((key) => `\`${key}\` → \`${GRID_FIELD_RETIRED_KEYS[key]}\``).join(', ');
  return (
    `[object-ui] ${which} carries retired snake_case key(s): ${renames}. ` +
    "The grid's field-level keys are camelCase since objectui#11610 and it reads no snake_case spelling, " +
    'so the grid is not drawn until each key is renamed; the values stay the same.'
  );
}

/**
 * Messages already logged this session, so a refused grid inside a rendered
 * list logs once, not once per mount (the `reportRetiredFieldType` discipline).
 */
const reportedRetiredGridFieldKeys = new Set<string>();

/**
 * The widget-path face of the objectui#11610 retirement: what a grid field
 * carrying a retired snake_case key renders INSTEAD of the grid. The shape is
 * `RetiredFieldTombstone`'s (`../index`), this package's settled answer to an
 * entry the renderer cannot honour: an inline alert naming the keys and the
 * replacements, plus a `console.error` with the same text. Nothing is thrown,
 * so the rest of the form still draws, and nothing is silently dropped: a grid
 * drawn without the author's `allow_add: false` would look like it worked.
 * The rows are untouched, since the alert never calls `onChange`.
 */
function RetiredGridFieldKeys({ message, keys }: { message: string; keys: readonly GridFieldRetiredKey[] }) {
  React.useEffect(() => {
    if (reportedRetiredGridFieldKeys.has(message)) return;
    reportedRetiredGridFieldKeys.add(message);
    console.error(message);
  }, [message]);
  return (
    <div
      role="alert"
      data-testid="grid-field-retired-keys"
      data-retired-keys={keys.join(' ')}
      className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

/**
 * The `grid` field widget. A field whose metadata carries one of the retired
 * snake_case keys is refused by name ({@link RetiredGridFieldKeys}); any other
 * field draws the grid.
 */
export function GridField(props: GridFieldProps) {
  const retired = retiredGridFieldKeysOf(props.field);
  if (retired.length > 0) {
    const message = retiredGridFieldKeysMessage((props.field as { name?: unknown } | undefined)?.name, retired);
    return <RetiredGridFieldKeys message={message} keys={retired} />;
  }
  return <GridFieldBody {...props} />;
}

function GridFieldBody({
  value,
  onChange,
  field,
  readonly,
  disabled,
  className,
  error,
  onRowExpand,
  displayMode,
  onAdd,
  ...props
}: GridFieldProps) {
  // The field-level keys, read as `GridFieldMetadata` declares them and as
  // nothing else, so a read of a key the type does not declare is a compile
  // error here rather than a second, unpublished contract (objectui#11070
  // rounds 8 and 9).
  const cfg = (field || {}) as Partial<GridFieldMetadata>;
  const allColumns: GridColumn[] = cfg.columns || [];
  const rows: Row[] = Array.isArray(value) ? value : [];
  const contextRecord = props.contextRecord;
  // The one locale channel every field renderer resolves through: tenant
  // regional default → active UI language → 'en' (objectui#4468). Read here
  // and passed down, since `displayText` is a pure helper.
  const displayLocale = useDisplayLocale();
  // The editable `date` / `datetime` cell's notice for a stored nonexistent
  // day (objectui#10474, objectui#10567) — the sentences `DateField` and
  // `DateTimeField` show for it too. Since objectui#11131 also the grid's own
  // default chrome: the Add button and the two empty states, English literals
  // until then. Each `defaultValue` is the `en` pack's value (held to it by
  // `pnpm check:i18n-keys`), which is what a provider-less host renders.
  // Since objectui#11145 the rest of the chrome too: the column chooser, the
  // footer total, the computed cell's tooltip and the row actions.
  const { t } = useFieldTranslation();
  // One key per row action, read by both its `aria-label` and its `title`
  // (objectui#11145). The two used to disagree for two of them (`Open row` /
  // `Open full form`, `Duplicate row` / `Duplicate line`); the accessible
  // name is the text kept.
  const dragLabel = t('view.dragToReorder', { defaultValue: 'Drag to reorder' });
  const openRowLabel = t('fields.grid.openRow', { defaultValue: 'Open row' });
  const duplicateRowLabel = t('fields.grid.duplicateRow', { defaultValue: 'Duplicate row' });
  const removeRowLabel = t('fields.grid.removeRow', { defaultValue: 'Remove row' });
  const totalLabel = t('form.masterDetail.total', { defaultValue: 'Total' });
  // A required, empty cell's text (objectui#11160): the plain cell's `title`,
  // and the `error` the lookup and file cells take. One expression for all
  // three, reading the pack's `validation.required` with the column's label
  // in `{{field}}`: the sentence the form renderer shows for a required field.
  const requiredCellText = (c: GridColumn) =>
    t('validation.required', { field: c.label || c.name, defaultValue: '{{field}} is required' });
  // A file cell's text in the session language (objectui#12924): the count of
  // several files and the name of a nameless one. Bound into `displayText`
  // here, so every cell that draws its text through it — the list-mode cell,
  // the computed cell and the read-only table — takes the same words.
  const fileText: FileCellText = {
    count: (count) => t('detail.fileCount', { count, defaultValue: '{{count}} files' }),
    nameless: t('fields.file.fileFallback', { defaultValue: 'File' }),
  };
  const displayText = (c: GridColumn, value: any, locale: string, cellCurrency?: string) =>
    cellDisplayText(c, value, locale, fileText, cellCurrency);
  const cellIdBase = React.useId();
  // The tenant default currency (ADR-0053) — the resolver's last step, and in
  // practice the currency of every `currency` column (objectui#10355, see
  // `columnCurrency`). It decides the stored width of a computed currency
  // cell (`computeRow`), the currency face `displayText` renders, and the
  // editable currency cell's symbol.
  const { currency: tenantCurrency } = useLocalization();
  const currency = columnCurrency(tenantCurrency);

  // Per-cell CEL rule state (B2 in grids). A column with no readonlyWhen/
  // requiredWhen resolves to its static flags (cheap fast-path — no engine
  // call). Otherwise evaluate against the row (`record`) + header (`parent`).
  const cellRules = useCallback(
    (c: GridColumn, row: Row): { readonly: boolean; required: boolean } => {
      if (!c.readonlyWhen && !c.requiredWhen) {
        return { readonly: false, required: !!c.required };
      }
      const s = resolveFieldRuleState(
        { readonlyWhen: c.readonlyWhen, requiredWhen: c.requiredWhen },
        (row || {}) as Record<string, unknown>,
        { required: !!c.required, readonly: false },
        undefined,
        contextRecord ? { parent: contextRecord } : undefined,
      );
      return { readonly: s.readonly, required: s.required };
    },
    [contextRecord],
  );
  // List mode: rows are read-only at-a-glance; editing happens in the full form.
  const isList = displayMode === 'list' && !readonly;

  // Column visibility — a curated default-visible set with the rest revealable
  // via the column chooser (mainstream "personalize columns" pattern). Required
  // columns are always visible; nothing is ever silently dropped.
  const [extraShown, setExtraShown] = React.useState<Set<string>>(() => new Set());
  const optionalColumns = allColumns.filter((c) => c.defaultHidden && !c.required);
  const columns: GridColumn[] = allColumns.filter(
    (c) => !c.defaultHidden || c.required || extraShown.has(c.name),
  );
  const toggleColumn = useCallback((fieldName: string) => {
    setExtraShown((prev) => {
      const next = new Set(prev);
      if (next.has(fieldName)) next.delete(fieldName);
      else next.add(fieldName);
      return next;
    });
  }, []);

  const allowAdd = cfg.allowAdd !== false && !readonly && !disabled;
  const allowDelete = cfg.allowDelete !== false && !readonly && !disabled;
  // A duplicate IS an add, so it is offered exactly when adding is. There is
  // no key of its own: `allow_duplicate` was read here while no face declared
  // it and round 8's census of both repositories found no producer of it, so
  // it was retired under ADR-0049 (objectui#11070 round 8), keeping the
  // behaviour its default gave.
  const allowDuplicate = allowAdd;
  // Per-row "expand to full form" (mainstream hybrid: quick grid + rich form).
  const showExpand = typeof onRowExpand === 'function' && !readonly;
  // Enterprise line grids (NetSuite/SAP/Salesforce) show a line-number column,
  // always: the `show_line_numbers` switch was retired with `allow_duplicate`,
  // for the same reason (objectui#11070 round 8).
  const minRows: number = cfg.minRows ?? 0;
  const maxRows: number | undefined = cfg.maxRows;
  // The CHILD column summed into the footer: the spec's `amountField` (an
  // `inlineAmountField` / `subforms[].amountField`), which both adapters in
  // `@object-ui/plugin-form` write here. ⚠️ Same name as the spec's
  // `totalField` on those surfaces, which is the PARENT field that receives
  // the rollup on save; the grid's key names the child column. One spelling:
  // the `amount_field` / `amountField` reads beside it are retired, round 8's
  // census having found no producer of either (objectui#11070 round 8).
  const totalField: string | undefined = cfg.totalField;
  // When set, the row's order is persisted by stamping `row[sortField] = index`
  // on every change that adds, removes or moves a row — so drag-reorder
  // survives a reload (the app adds a numeric position field and lists sort by
  // it). Without it, reorder is order-of-entry. A cell edit moves no row, so it
  // leaves every row's position as it was read (objectui#12286): renumbering
  // there wrote a position onto lines the user never touched whenever the
  // stored positions were not already 0, 1, 2, … in the order drawn (tied,
  // empty, or gapped).
  // Declared on `GridFieldMetadata`; its producer is `deriveDetail`
  // (`@object-ui/plugin-form`, through `MasterDetailForm`), which picks the
  // child object's `position` / `sort_order` / … field (objectui#11070 round 9).
  const sortField: string | undefined = cfg.sortField;
  // Drag-to-reorder is on for editable grids (off in read-only / list mode),
  // and `allowReorder: false` turns it off: the key `GridFieldMetadata`
  // declares. The undeclared `reorderable` this used to read is retired
  // (objectui#11070 round 8).
  const allowReorder = cfg.allowReorder !== false && !readonly && !disabled;

  /** Hand the next rows out; `renumber: false` is a cell edit, which moves no row. */
  const emit = useCallback(
    (next: Row[], renumber = true) => {
      onChange?.(sortField && renumber ? next.map((r, i) => ({ ...r, [sortField]: i })) : next);
    },
    [onChange, sortField],
  );

  const blankRow = useCallback((): Row => {
    const blank: Row = {};
    for (const c of columns) blank[c.name] = null;
    return blank;
  }, [columns]);

  /**
   * Merge a field patch into a row. `rowIdx === rows.length` targets the
   * trailing "ghost" row (always-present empty line) — editing it materialises
   * a new real row, so the user never has to click "Add line" to keep entering.
   * Computed columns are recomputed for the touched row on every change.
   */
  const applyPatch = useCallback(
    (rowIdx: number, patch: Row) => {
      const isGhost = rowIdx >= rows.length;
      if (isGhost) {
        if (maxRows != null && rows.length >= maxRows) return;
        emit([...rows, computeRow(columns, { ...blankRow(), ...patch }, tenantCurrency)]);
        return;
      }
      emit(rows.map((r, i) => (i === rowIdx ? computeRow(columns, { ...r, ...patch }, tenantCurrency) : r)), false);
    },
    [rows, columns, maxRows, blankRow, emit, tenantCurrency],
  );

  const applyCell = useCallback(
    (rowIdx: number, columnName: string, value: any) => applyPatch(rowIdx, { [columnName]: value }),
    [applyPatch],
  );

  /**
   * A lookup cell selection — set the FK id and auto-fill any sibling cells
   * whose column name matches a field on the chosen record (and isn't itself a
   * lookup/computed column). The catalog-typeahead behaviour every invoicing
   * tool has: pick a product → its unit_price / description drop into the row.
   * Opt out per column with `autofill: false`.
   */
  const applyLookupSelection = useCallback(
    (rowIdx: number, col: GridColumn, record: any) => {
      applyPatch(rowIdx, lookupAutofillPatch(columns, col, record));
    },
    [columns, applyPatch],
  );

  /** Set a cell to an already-typed value (lookup ids, etc.) without coercion. */
  const setCellValue = useCallback(
    (rowIdx: number, columnName: string, value: any) => applyCell(rowIdx, columnName, value),
    [applyCell],
  );

  const setCell = useCallback(
    (rowIdx: number, col: GridColumn, raw: string) => {
      applyCell(rowIdx, col.name, coerce(col.type, raw));
    },
    [applyCell],
  );

  const addRow = useCallback(() => {
    if (maxRows != null && rows.length >= maxRows) return;
    emit([...rows, blankRow()]);
  }, [rows, blankRow, maxRows, emit]);

  // Keyboard navigation across cells (spreadsheet-style): the table is a focus
  // grid. Enter / ArrowUp / ArrowDown move between rows in the same column;
  // Tab / Shift-Tab fall through to the browser's natural row-major order
  // (and into the ever-present ghost row, so tabbing past the last cell starts
  // a new line). Cells carry data-cell="row-col" so we can target neighbours.
  const gridRef = useRef<HTMLTableElement>(null);
  const focusCell = useCallback((rowIdx: number, colIdx: number) => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${rowIdx}-${colIdx}"]`);
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
    }
  }, []);
  const onCellKeyDown = useCallback(
    (e: React.KeyboardEvent, rowIdx: number, colIdx: number) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        focusCell(rowIdx + 1, colIdx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (rowIdx > 0) focusCell(rowIdx - 1, colIdx);
      }
    },
    [focusCell],
  );

  const removeRow = useCallback(
    (rowIdx: number) => {
      if (rows.length <= minRows) return;
      emit(rows.filter((_, i) => i !== rowIdx));
    },
    [rows, minRows, emit],
  );

  /** Duplicate a row (id stripped so the copy persists as a new record),
   *  inserted directly below the original — handy for near-identical lines. */
  const duplicateRow = useCallback(
    (rowIdx: number) => {
      if (maxRows != null && rows.length >= maxRows) return;
      const src = rows[rowIdx];
      if (!src) return;
      const { id: _i, _id: _i2, recordId: _i3, ...copy } = src as any;
      const next = [...rows];
      next.splice(rowIdx + 1, 0, { ...copy });
      emit(next);
    },
    [rows, maxRows, emit],
  );

  /** Move a row from one position to another (drag-to-reorder). */
  const moveRow = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
      const next = [...rows];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      emit(next);
    },
    [rows, emit],
  );
  const dragIndex = useRef<number | null>(null);

  const hasRowActions = showExpand || allowDelete || allowDuplicate;
  const actionColWidth = ((showExpand ? 1 : 0) + (allowDuplicate ? 1 : 0) + (allowDelete ? 1 : 0)) * 34 + 12;

  const showTotal = !!totalField;
  const total = showTotal ? sumColumn(rows, totalField!) : 0;
  // Align the running total under the column it sums (not blindly under the
  // last column). The label sits right-aligned immediately to its left.
  const totalColIndex = showTotal ? Math.max(0, columns.findIndex((c) => c.name === totalField)) : -1;

  // Column chooser — reveal/hide the optional (default-hidden) columns. Only
  // rendered when there are optional columns to manage.
  const columnChooser = optionalColumns.length > 0 ? (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          data-testid="line-items-columns"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t('table.columns', { defaultValue: 'Columns' })}
          {extraShown.size > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
              +{extraShown.size}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
          {t('fields.grid.optionalColumns', { defaultValue: 'Optional columns' })}
        </div>
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {optionalColumns.map((c) => {
            const id = `col-toggle-${c.name}`;
            return (
              <Label
                key={c.name}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm font-normal hover:bg-muted"
              >
                <Checkbox
                  id={id}
                  checked={extraShown.has(c.name)}
                  onCheckedChange={() => toggleColumn(c.name)}
                />
                <span className="truncate">{c.label || c.name}</span>
              </Label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  ) : null;

  // ── Read-only / view rendering ────────────────────────────────────────────
  if (readonly) {
    return (
      <div
        // No input of the field's own renders here, so this surface is the only
        // candidate for the host's name AND description (objectui#4857; the
        // objectui#3990/#4005 route). Standalone rendering hands down none of
        // the keys, so nothing is emitted and the markup is unchanged.
        {...toHostGroupProps(props, 'instead-of-the-inputs')}
        className={cn('space-y-2', className)}
      >
        {columnChooser && <div className="flex justify-end">{columnChooser}</div>}
        <div className="border border-border rounded-lg overflow-x-auto" data-testid="line-items-readonly">
        <table className="w-full text-sm">
          <thead className="bg-muted border-b border-border">
            <tr>
              <th className="w-10 px-2 py-2 text-right text-xs font-medium text-muted-foreground">#</th>
              {columns.map((c) => (
                <th
                  key={c.name}
                  style={{ minWidth: minWidthFor(c) }}
                  className={cn(
                    'px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap',
                    isNumeric(c.type) ? 'text-right' : 'text-left',
                  )}
                >
                  {c.label || c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  {t('fields.grid.noItems', { defaultValue: 'No items' })}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  <td className="px-2 py-2 text-right text-muted-foreground tabular-nums">{rowIdx + 1}</td>
                  {columns.map((c) => (
                    <td
                      key={c.name}
                      className={cn('px-3 py-2 text-foreground', isNumeric(c.type) && 'text-right tabular-nums')}
                    >
                      {c.type === 'lookup' && row[c.name] != null && row[c.name] !== '' ? (
                        <LookupField
                          value={row[c.name]}
                          onChange={() => {}}
                          readonly
                          field={{ reference: c.reference, displayField: c.displayField, idField: c.idField } as any}
                        />
                      ) : (
                        // Every other cell reads through `displayText`, as the
                        // list-mode cell does. `String(value)` put the stored
                        // shape on screen: a raw ISO for a temporal column
                        // (objectui#3569), a select's stored value instead of
                        // its option label, and an amount ungrouped and in no
                        // locale (objectui#12915).
                        displayText(c, row[c.name], displayLocale, currency)
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {showTotal && (
            <tfoot className="border-t border-border bg-muted/40">
              <tr>
                <td
                  colSpan={1 + totalColIndex}
                  className="px-3 py-2 text-right text-xs font-medium text-muted-foreground"
                >
                  {totalLabel}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-foreground tabular-nums">
                  {total.toLocaleString(displayLocale)}
                </td>
                {columns.length - totalColIndex - 1 > 0 && (
                  <td colSpan={columns.length - totalColIndex - 1} />
                )}
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>
    );
  }

  // ── Editable rendering ──────────────────────────────────────────────────────
  // A trailing "ghost" empty row is always present in grid mode (start-with-one
  // + auto-append): editing it materialises a real row, so the user keeps
  // entering lines without clicking "Add". Index-based keys keep the input
  // mounted across materialisation, so focus/caret survive the transition.
  const hasGhost = !isList && allowAdd && (maxRows == null || rows.length < maxRows);
  const displayRows: Row[] = hasGhost ? [...rows, blankRow()] : rows;

  /**
   * FORM-level failure driving the per-CELL channel (objectui#3318).
   *
   * This widget reports validity per cell, and the container deliberately does
   * NOT take the host's `aria-invalid` (objectui#4857 — it is control-channel
   * state and the container is not a control). That left one real gap: a
   * REQUIRED grid submitted while still EMPTY fails at the form level, renders
   * its "is required" message, and marked nothing — every row was a ghost, and
   * ghosts were skipped, so assistive tech was told nothing at all. A sighted
   * user saw the red message; a screen-reader user saw no field state.
   *
   * So when the host reports a failure on an empty grid, the ghost row — the
   * entry line the user would actually type into to fix it — stops being
   * skipped and its required cells flag like any other. Deliberately narrow:
   * a POPULATED grid already marks its own empty required cells inline, so
   * this changes nothing there, and an empty grid that has NOT failed stays
   * unmarked (no premature alarm before validation runs).
   */
  const hostFailedEmpty = !!error && rows.length === 0;

  /** Cell content: read-only display (list mode / computed columns) or an
   *  editable borderless control (spreadsheet feel).
   *
   *  `invalid` is the cell's validity, and it lands on the CONTROL this
   *  renders — the focusable element a keyboard user edits and the only one
   *  assistive tech reads a control state from (objectui#3318). The read-only
   *  branches below ignore it: list-mode and computed cells cannot be invalid
   *  (the caller's `invalid` is false for both), and a text span is exactly
   *  the wrapper the sweep forbids marking. */
  const renderCellInput = (
    c: GridColumn,
    colIdx: number,
    rowIdx: number,
    row: Row,
    invalid = false,
  ) => {
    const val = row?.[c.name];
    // A readonlyWhen-TRUE cell is locked: treat like the form-wide `disabled`.
    const locked = disabled || cellRules(c, row).readonly;
    // List (form-factor) mode → read-only at-a-glance display.
    if (isList) {
      if (c.type === 'lookup' && val != null && val !== '') {
        return (
          <LookupField value={val} onChange={() => {}} readonly
            field={{ reference: c.reference, displayField: c.displayField, idField: c.idField } as any} />
        );
      }
      return (
        <span className={cn('px-2 text-sm text-foreground', isNumeric(c.type) && 'tabular-nums', (val == null || val === '') && 'text-muted-foreground')}>
          {displayText(c, val, displayLocale, currency)}
        </span>
      );
    }
    // Computed column → read-only, recomputed live, formatted.
    if (c.computed) {
      return (
        <span
          className={cn('block px-2 text-sm tabular-nums', isNumeric(c.type) ? 'text-right' : 'text-left', (val == null || val === '') ? 'text-muted-foreground' : 'text-foreground')}
          title={t('fields.grid.computed', { defaultValue: 'Computed' })}
          data-computed={c.name}
        >
          {displayText(c, val, displayLocale, currency)}
        </span>
      );
    }
    if (c.type === 'lookup') {
      return (
        <LookupField
          value={val}
          onChange={(v: any) => setCellValue(rowIdx, c.name, v)}
          onSelectRecord={(rec: any) => applyLookupSelection(rowIdx, c, rec)}
          compact
          field={{ reference: c.reference, displayField: c.displayField, idField: c.idField, multiple: c.multiple, options: c.options, placeholder: '—' } as any}
          disabled={locked}
          // The published `error` slot, not a hand-rolled attribute: LookupField
          // already puts `aria-invalid` on its own focusable trigger from it.
          error={invalid ? requiredCellText(c) : undefined}
        />
      );
    }
    // File / image column → a real upload control in the cell (objectui#2360),
    // not a text input: chips for uploaded files + a compact picker button.
    if (c.type === 'file') {
      return (
        <FileCell
          value={val}
          onChange={(v: any) => setCellValue(rowIdx, c.name, v)}
          multiple={c.multiple}
          accept={Array.isArray(c.accept) && c.accept.length > 0 ? c.accept.join(',') : undefined}
          disabled={locked}
          aria-label={c.label || c.name}
          data-cell={`${rowIdx}-${colIdx}`}
          // The published `error` slot, not a hand-rolled attribute — same
          // wiring as the lookup branch above: FileCell puts `aria-invalid` on
          // its own focusable picker button from it (objectui#5431, closing
          // the one cell type #3318 left out).
          error={invalid ? requiredCellText(c) : undefined}
        />
      );
    }
    if (c.type === 'select') {
      return (
        <Select value={val != null ? String(val) : ''} onValueChange={(v) => setCell(rowIdx, c, v)} disabled={locked}>
          <SelectTrigger
            className="h-8 rounded-none border-0 bg-transparent px-2 shadow-none focus:ring-1 focus:ring-ring/60"
            aria-label={c.label || c.name}
            aria-invalid={invalid || undefined}
          >
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {(c.options || []).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    // The editable currency cell shows the SAME symbol its display face does
    // (objectui#10355) — `currencyAdornment`, never a default `¥`.
    const adornment = c.type === 'currency' ? currencyAdornment(c, currency, displayLocale) : '';
    // A `date` or `datetime` cell holding a value written on a day that does
    // not exist (objectui#10474, objectui#10567): its control can paint that
    // only blank — the `date` control sanitises the verbatim day
    // `toDateInputValue` keeps, so it is handed `""` below, as the `datetime`
    // adapter already does — so the stored string is named under it and the
    // control is marked invalid. Nothing is written until the user picks a new
    // value — the same face `DateField` / `DateTimeField` give it.
    const impossibleDay = (c.type === 'date' || c.type === 'datetime') && isImpossibleStoredDay(val);
    const noticeId = impossibleDay ? `${cellIdBase}-impossible-${rowIdx}-${colIdx}` : undefined;
    return (
      <div className="relative">
        {adornment && (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{adornment}</span>
        )}
        <Input
          data-cell={`${rowIdx}-${colIdx}`}
          aria-invalid={invalid || impossibleDay || undefined}
          aria-describedby={noticeId}
          onKeyDown={(e) => onCellKeyDown(e, rowIdx, colIdx)}
          className={cn(
            'h-8 rounded-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-1 focus-visible:ring-ring/60',
            adornment && 'pl-6',
            isNumeric(c.type) && 'text-right tabular-nums',
          )}
          type={
            c.type === 'date'
              ? 'date'
              : c.type === 'datetime'
                ? 'datetime-local'
                : c.type === 'time'
                  ? 'time'
                  : isNumeric(c.type)
                    ? 'number'
                    : 'text'
          }
          step={isNumeric(c.type) ? c.step ?? 'any' : undefined}
          aria-label={c.label || c.name}
          // A temporal cell holding the API's ISO shape (`2026-06-17T14:30:00.000Z`)
          // is SILENTLY rejected by the native control — the attribute lands in
          // the DOM but `input.value` reads back `''` and the cell paints empty
          // (objectui#3566, the sub-grid face of #3127). So each type reads
          // through its own adapter:
          //   date     → `YYYY-MM-DD`; the control writes that shape back
          //              verbatim, so no paired conversion on `onChange`.
          //   datetime → `YYYY-MM-DDTHH:mm` local; PAIRED with
          //              `fromDateTimeInputValue` in `coerce` so read and write
          //              share one basis (objectui#3569).
          //   time     → `HH:mm[:ss]` is already the stored shape, both ways.
          value={
            c.type === 'date'
              ? (impossibleDay ? '' : toDateInputValue(val))
              : c.type === 'datetime'
                ? toDateTimeInputValue(val)
                : val != null
                  ? String(val)
                  : ''
          }
          onChange={(e) => setCell(rowIdx, c, e.target.value)}
          disabled={locked}
        />
        {impossibleDay && (
          <p id={noticeId} className="px-2 pb-1 text-xs text-destructive" data-testid={`line-items-impossible-day-${rowIdx}-${c.name}`}>
            {t(c.type === 'date' ? 'fields.date.impossibleDay' : 'fields.dateTime.impossibleDay', { value: String(val) })}
          </p>
        )}
      </div>
    );
  };

  // DOM pass-through (objectui#4857): the container carries the form renderer's
  // id / aria-labelledby / aria-describedby, but NOT its `name` (DOM-legal on
  // form controls only — the objectui#3291 leak) and NOT its `aria-invalid`
  // (control-channel state; this grid reports validity per CELL with its own
  // inline marks). `CheckboxesField`'s split, key for key.
  const {
    'aria-invalid': _hostAriaInvalid,
    name: _domName,
    ...groupDomProps
  } = toDomProps(props);
  // The container answers `role="group"` only when a host actually NAMED it by
  // IDREF (objectui#3961) — standalone rendering (a bare SDUI node) hands down
  // no `aria-labelledby`, emits no role, and keeps its markup unchanged.
  const isLabelledGroup = groupDomProps['aria-labelledby'] != null;

  return (
    <div
      {...groupDomProps}
      role={isLabelledGroup ? 'group' : undefined}
      className={cn('space-y-2', className)}
      data-testid="line-items"
    >
      {columnChooser && <div className="flex justify-end">{columnChooser}</div>}
      <div className="border border-border rounded-lg overflow-x-auto">
        <table ref={gridRef} className="w-full text-sm">
          <thead className="bg-muted/60 border-b border-border">
            <tr>
              <th className={cn('px-2 py-2 text-right text-xs font-medium text-muted-foreground', allowReorder ? 'w-14' : 'w-10')}>#</th>
              {columns.map((c) => (
                <th
                  key={c.name}
                  className={cn(
                    'px-2 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap',
                    isNumeric(c.type) ? 'text-right' : 'text-left',
                  )}
                  style={widthStyle(c)}
                >
                  {c.label || c.name}
                  {c.required && !c.computed && <span className="text-destructive"> *</span>}
                </th>
              ))}
              {hasRowActions && <th style={{ width: actionColWidth }} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isList && rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (hasRowActions ? 1 : 0) + 1}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  {t('fields.grid.noItemsAddHint', {
                    label: cfg.addLabel || t('detail.add', { defaultValue: 'Add' }),
                    defaultValue: 'No items yet — click “{{label}}” to begin.',
                  })}
                </td>
              </tr>
            ) : (
              displayRows.map((row, rowIdx) => {
                const isGhost = hasGhost && rowIdx === rows.length;
                const reorderable = allowReorder && !isGhost && !isList;
                return (
                  <tr
                    key={rowIdx}
                    className={cn('group', !isGhost && 'hover:bg-muted/30')}
                    {...(allowReorder && !isGhost
                      ? {
                          onDragOver: (e: React.DragEvent) => { if (dragIndex.current != null) e.preventDefault(); },
                          onDrop: (e: React.DragEvent) => {
                            e.preventDefault();
                            if (dragIndex.current != null) { moveRow(dragIndex.current, rowIdx); dragIndex.current = null; }
                          },
                        }
                      : {})}
                  >
                    <td className="px-1 py-1 text-right align-middle text-xs text-muted-foreground tabular-nums">
                      <span className="inline-flex items-center justify-end gap-0.5">
                        {reorderable && (
                          <span
                            draggable
                            onDragStart={() => { dragIndex.current = rowIdx; }}
                            onDragEnd={() => { dragIndex.current = null; }}
                            className="cursor-grab text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
                            title={dragLabel}
                            aria-label={dragLabel}
                            data-testid={`line-items-drag-${rowIdx}`}
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </span>
                        )}
                        <span className={cn(isGhost && 'opacity-30')}>{rowIdx + 1}</span>
                      </span>
                    </td>
                    {columns.map((c, colIdx) => {
                      // Inline validation: a required, non-computed cell that's
                      // empty flags red in place. The "required" verdict honors
                      // a column's `requiredWhen` CEL rule (B2), evaluated
                      // against the row + parent header.
                      //
                      // The ghost row joins in only when the FORM said this
                      // grid failed while empty (objectui#3318) — see
                      // `hostFailedEmpty`.
                      const required = cellRules(c, row).required;
                      const invalid =
                        (!isGhost || hostFailedEmpty) &&
                        !isList &&
                        required &&
                        !c.computed &&
                        (row[c.name] == null || row[c.name] === '');
                      return (
                        <td
                          key={c.name}
                          // NOTE: `aria-invalid` belongs on the cell's CONTROL,
                          // not here. A `td` is not focusable, and assistive
                          // tech reads a control's validity from the control —
                          // marking the wrapper is the move the registry sweep
                          // exists to forbid (objectui#3318 / #5223). The td
                          // keeps the VISUAL ring and the test hook; the state
                          // travels with `invalid` into `renderCellInput`.
                          title={invalid ? requiredCellText(c) : undefined}
                          data-testid={invalid ? `line-items-invalid-${rowIdx}-${c.name}` : undefined}
                          className={cn(
                            'border-r border-border/40 px-1 py-0.5 align-middle last:border-r-0',
                            isList && 'px-2 py-1.5',
                            invalid && 'bg-destructive/5 ring-1 ring-inset ring-destructive/50',
                          )}
                        >
                          {renderCellInput(c, colIdx, rowIdx, row, invalid)}
                        </td>
                      );
                    })}
                    {hasRowActions && (
                      <td className="px-1 py-0.5 align-middle whitespace-nowrap">
                        <div className="flex items-center justify-center gap-0.5">
                          {!isGhost && showExpand && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              aria-label={openRowLabel}
                              title={openRowLabel}
                              data-testid={`line-items-expand-${rowIdx}`}
                              onClick={() => onRowExpand!(rowIdx)}
                            >
                              <Maximize2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!isGhost && allowDuplicate && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              // Always visible (not hover-revealed): row actions must be
                              // discoverable and reachable on touch/coarse-pointer devices,
                              // which have no hover. The action column width is reserved
                              // regardless, so this adds no layout shift.
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              aria-label={duplicateRowLabel}
                              title={duplicateRowLabel}
                              data-testid={`line-items-duplicate-${rowIdx}`}
                              onClick={() => duplicateRow(rowIdx)}
                              disabled={disabled || (maxRows != null && rows.length >= maxRows)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!isGhost && allowDelete && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              // Always visible — see the duplicate button above.
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              aria-label={removeRowLabel}
                              data-testid={`line-items-remove-${rowIdx}`}
                              onClick={() => removeRow(rowIdx)}
                              disabled={disabled || rows.length <= minRows}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          {showTotal && (
            <tfoot className="border-t border-border bg-muted/40">
              <tr>
                <td
                  colSpan={1 + totalColIndex}
                  className="px-3 py-2 text-right text-xs font-medium text-muted-foreground"
                >
                  {totalLabel}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-foreground tabular-nums" data-testid="line-items-total">
                  {total.toLocaleString(displayLocale)}
                </td>
                {(columns.length - totalColIndex - 1 + (hasRowActions ? 1 : 0)) > 0 && (
                  <td colSpan={columns.length - totalColIndex - 1 + (hasRowActions ? 1 : 0)} />
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {allowAdd && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={isList && onAdd ? onAdd : addRow}
          disabled={maxRows != null && rows.length >= maxRows}
          data-testid="line-items-add"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {cfg.addLabel || t('fields.grid.addLine', { defaultValue: 'Add line' })}
        </Button>
      )}
    </div>
  );
}

/** Semantic alias — the master-detail subform's child grid. */
export const LineItemsField = GridField;
