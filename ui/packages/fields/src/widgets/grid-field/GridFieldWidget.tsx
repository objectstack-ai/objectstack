import React, { useCallback, useRef } from 'react';
import { FieldWidgetComponentProps } from '../types.js';
import {
  cn,
  Button,
  Input,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Checkbox,
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import { Plus, Trash2, SlidersHorizontal, Maximize2, Copy, GripVertical, Info } from 'lucide-react';
import { formatDate, formatDateTime, resolveFieldRuleState, toDisplayDate } from '@object-ui/core';
import { useDisplayLocale, useLocalization, formatDisplayNumber } from '@object-ui/i18n';
import { currencySymbol } from '../../currency.js';
import { LookupField } from '../LookupField.js';
import type { LookupAutofillByField } from '../lookupAutofill.js';
import { FileCell } from '../FileField.js';
import { toDateInputValue, toDateTimeInputValue, fromDateTimeInputValue, isImpossibleStoredDay } from '../nativeDateValue.js';
import { useFieldTranslation } from '../useFieldTranslation.js';
import { toDomProps } from '../toDomProps.js';
import { PHONE_TOUCH_HEIGHT, PHONE_TOUCH_SQUARE } from '../touchTarget.js';
import { toHostGroupProps } from '../toHostGroupProps.js';
import { GRID_CELL_CONTROL_CLASS, GridDateCell, GridPanelCell, GridSelectCell, GrowingCellInput } from '../gridCellPanels.js';
import { MultiSelectField } from '../MultiSelectField.js';
import { TagsField } from '../TagsField.js';
import { UserField } from '../UserField.js';
import { RatingField } from '../RatingField.js';
import { useBooleanValueLabel } from '../booleanValueLabel.js';
import { isImeKey } from '../imeKey.js';
import { GRID_FIELD_RETIRED_KEYS, type GridFieldMetadata, type GridFieldRetiredKey } from '@object-ui/types';
// The grid's pure half: the column type, the computed-cell evaluator, the
// lookup-pick patch and the row marks. They live beside the public face in
// `../GridField.ts`, in the eager chunk, because `@object-ui/fields` exports
// them by name and they import nothing heavy (objectstack#36102).
import {
  computeRow,
  currencyOfColumn,
  currencyWidth,
  isUntouchedNewRow,
  lookupAutofillPatch,
  sumColumn,
  UNTOUCHED_NEW_ROW,
  type ColumnCurrencies,
  type ColumnHelp,
  type GridColumn,
} from '../GridField.js';

/**
 * GridField / LineItemsField — editable child-grid ("line items") widget.
 *
 * ## Where this module sits (objectstack#36102)
 *
 * This is the widget BODY, and it is reached only through `import()`: the
 * `GridField` / `LineItemsField` that `@object-ui/fields` exports by name are
 * the small lazy face in `../GridField.ts`, and the `grid` form-field loader
 * imports this file through that face's one loader. ⛔ Do not import it
 * statically from anything outside this directory and its tests: one static
 * importer in the eager graph puts these bytes back on every console page
 * load (`fields-grid` in `apps/console/vite.config.ts`, held to the module by
 * `PER_CHUNK_MEMBERSHIP_CARVE_OUTS` in `scripts/check-eager-closure-budget.mjs`).
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


type Row = Record<string, any>;

const isNumeric = (t?: string) => t === 'number' || t === 'currency';

/** A cell holding nothing: no value, an empty string, or an empty list (multi-select, tags, people). */
const isEmptyCell = (value: unknown) =>
  value == null || value === '' || (Array.isArray(value) && value.length === 0);

/** The star count of a `rating` column: its `max`, else `Field.rating`'s own 5 (objectstack#36043). */
const ratingMax = (c: GridColumn) => c.max ?? 5;

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
  // objectstack#36043 — the five cells that edit as in the main list.
  user: 168,
  multiselect: 168,
  tags: 168,
  boolean: 72,
  rating: 120,
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
 * The session-language words a cell's text is made of (objectui#12924), read
 * by the component from the packs and handed to {@link cellDisplayText}: the
 * count a cell holding several files states (`detail.fileCount`, the count
 * family `FileCellRenderer` states a file count with), the name a file whose
 * value carries none is shown by (`fields.file.fileFallback`, the name
 * `FileField` and `FileCellRenderer` give it), and a check cell's word for its
 * value. The first two used to be the English literals `N files` / `File`
 * here, on every locale.
 */
interface CellText {
  count: (count: number) => string;
  nameless: string;
  /** The session's word for a check cell's value (objectstack#36043). */
  booleanWord: (value: boolean) => string;
}

/** Read-only display text for a cell in list mode (select → option label,
 *  currency/number → formatted, date/datetime/time → localized, file → its
 *  name or a count of its files, empty → em dash). Lookups render separately.
 *  `currency` is the column's resolved currency, read only by the currency
 *  branch. The component binds `fileText` once, as its `displayText`. */
function cellDisplayText(c: GridColumn, value: any, locale: string, fileText: CellText, currency?: string): string {
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
  // A multi-select cell names each value by its option's label (objectstack#36043).
  if (c.type === 'multiselect' && Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value.map((v) => c.options?.find((o) => String(o.value) === String(v))?.label ?? String(v)).join(', ');
  }
  // A check cell reads as its option's word (the session's, from the derive),
  // else the session's word itself (objectstack#36043).
  if (c.type === 'boolean') {
    const on = value === true || BOOLEAN_READINGS.get(value) === true;
    return c.options?.find((o) => o.value === String(on))?.label ?? fileText.booleanWord(on);
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

/**
 * The cell values a `boolean` / `toggle` field's write is stored as, each with
 * the boolean it stands for: the readings the engine's write normalisation
 * (`BOOLEAN_READINGS` in `@objectstack/objectql`'s record validator) turns into
 * a boolean before it validates a row, compared the same way (SameValueZero).
 * Every other value is no reading, and is left as it is.
 */
const BOOLEAN_READINGS: ReadonlyMap<unknown, boolean> = new Map<unknown, boolean>([
  ['true', true],
  ['1', true],
  [1, true],
  ['false', false],
  ['0', false],
  [0, false],
]);

/**
 * A column over a `boolean` / `toggle` child field: the `select` column
 * `@object-ui/plugin-form` derives for one, whose two options store the
 * strings `'true'` / `'false'` (`optionsFor` in `deriveMasterDetail.ts`). A
 * grid column carries no field definition, so this option pair is what names
 * the field's type here.
 */
function isBooleanSelectColumn(c: GridColumn): boolean {
  if (c.type !== 'select' || !Array.isArray(c.options) || c.options.length !== 2) return false;
  const values = new Set(c.options.map((o) => o.value));
  return values.has('true') && values.has('false');
}

/**
 * The row a column's `readonlyWhen` / `requiredWhen` predicate reads as
 * `record`: the row, with each boolean column's cell read as the boolean it
 * stands for. The select cell writes the string `'true'` / `'false'` into the
 * row, so `record.won == true` compared a string and the cell marker showed
 * the wrong state, while the server — which stores and judges the boolean —
 * refused the row. Only the predicate's view changes: the cell still shows,
 * and the row still saves, what the select wrote.
 */
function ruleRecordOf(booleanColumns: readonly string[], row: Row | undefined): Record<string, unknown> {
  const base: Row = row || {};
  let out: Row | undefined;
  for (const name of booleanColumns) {
    const judged = BOOLEAN_READINGS.get(base[name]);
    if (judged !== undefined) (out ??= { ...base })[name] = judged;
  }
  return out ?? base;
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
export type GridFieldWidgetProps = FieldWidgetComponentProps<Row[]> & {
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
  /** The child object's declared `lookupAutofill` pairs, by lookup column
   *  name (`lookupAutofillByField` over the child's fields). A grid column
   *  carries no field definition, so the host that knows the child object
   *  hands them over. Supplied by MasterDetailForm and LineItemsPanel. */
  lookupAutofill?: LookupAutofillByField;
  /** The currency of each `currency` column whose host knows it
   *  ({@link ColumnCurrencies}): a grid column carries no field definition,
   *  so the master-detail host that holds the header and the child schema
   *  hands it over. A column it does not name is in the tenant currency. */
  columnCurrencies?: ColumnCurrencies;
  /** The values a new line starts with (objectstack#35816): the child
   *  object's static field defaults, by field name. A grid column carries no
   *  default (the spec's inline column refuses `defaultValue`), so the host
   *  that holds the child schema hands them over. Every new line takes them:
   *  "Add", Enter on the last line, and a line typed into the entry line an
   *  empty grid draws after the form refused it (`hostFailedEmpty`). A line
   *  already in the value keeps what it holds. Absent: a new line starts
   *  blank, as before. */
  newRowValues?: Row;
  /** When the host sets it, an empty required cell on a NEW line (one with
   *  no id) is flagged only while it is `true` (objectstack#35816): a line
   *  the user just added does not read red before the host has tried to save
   *  it, and does once a save was refused. A stored line is flagged as
   *  before. Absent: every line is flagged at once, as before. A line still
   *  marked {@link UNTOUCHED_NEW_ROW} is never flagged (objectstack#35940):
   *  the host skips it at save. */
  newRowRequiredShown?: boolean;
  /** The help text of each column's child field, by column name
   *  ({@link ColumnHelp}, objectstack#35804): drawn as an info button beside
   *  the column's header label. A grid column carries no field definition (the
   *  spec's inline column declares no help key), so the host that holds the
   *  child object's served definition hands it over through
   *  {@link columnHelpByField}. A column it does not name draws no button. */
  columnHelp?: ColumnHelp;
};

/**
 * The info button beside a column's header label (objectstack#35804): the
 * column's help on hover and on keyboard focus.
 *
 * The button sits inside the `<th>`, so its accessible name joins the column
 * header's, which a screen reader announces with every cell of the column
 * (objectstack#36004). The help is therefore NOT the button's name: the button
 * is named by a short Help word from the pack (`fields.grid.columnHelp`), and
 * the help is its DESCRIPTION, through `aria-describedby` on a `hidden` copy
 * beside it. A hidden node takes no part in the header's name from content,
 * and a description reads a node it references even when it is hidden, so a
 * screen reader hears "Help" and then the help on reaching the button, while
 * the column stays named by its label. The text is the host's, already in the
 * reader's language. Its own provider, so the grid draws it under any host.
 */
function ColumnHeaderHelp({ help }: { help: string | undefined }) {
  const { t } = useFieldTranslation();
  const descriptionId = React.useId();
  if (!help) return null;
  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('fields.grid.columnHelp', { defaultValue: 'Help' })}
              aria-describedby={descriptionId}
              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-sm align-middle text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid="line-items-column-help"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-normal text-xs font-normal">{help}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span id={descriptionId} hidden>
        {help}
      </span>
    </>
  );
}

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

/** The row without its {@link UNTOUCHED_NEW_ROW} mark: an edit makes it input. */
function touched(row: Row): Row {
  if (!isUntouchedNewRow(row)) return row;
  const { [UNTOUCHED_NEW_ROW]: _untouched, ...rest } = row as Row & { [UNTOUCHED_NEW_ROW]?: true };
  return rest;
}

/** A line the server already stores carries its id (`id`, `_id` or `recordId`). */
function rowHasId(row: Row): boolean {
  return [row.id, row._id, row.recordId].some((v) => v != null && v !== '');
}

/**
 * The `grid` field widget. A field whose metadata carries one of the retired
 * snake_case keys is refused by name ({@link RetiredGridFieldKeys}); any other
 * field draws the grid.
 */
export function GridFieldWidget(props: GridFieldWidgetProps) {
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
  lookupAutofill,
  columnCurrencies,
  newRowValues,
  newRowRequiredShown,
  columnHelp,
  ...props
}: GridFieldWidgetProps) {
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
  const booleanWord = useBooleanValueLabel();
  const fileText: CellText = {
    count: (count) => t('detail.fileCount', { count, defaultValue: '{{count}} files' }),
    nameless: t('fields.file.fileFallback', { defaultValue: 'File' }),
    booleanWord,
  };
  const displayText = (c: GridColumn, value: any, locale: string, cellCurrency?: string) =>
    cellDisplayText(c, value, locale, fileText, cellCurrency);
  /**
   * The read-only face of a cell that is not text (objectstack#36043): people
   * by name, a rating as its stars; `null` for every other cell, which reads
   * through `displayText`. Shared by the read-only table and list mode.
   */
  const readOnlyFace = (c: GridColumn, value: any): React.ReactNode | null => {
    if (isEmptyCell(value)) return null;
    if (c.type === 'user') {
      return <UserField value={value} onChange={() => {}} readonly field={{ type: 'user', multiple: c.multiple } as any} />;
    }
    if (c.type === 'rating') {
      return <RatingField value={Number(value)} onChange={() => {}} readonly field={{ type: 'rating', max: ratingMax(c) } as any} />;
    }
    return null;
  };
  const cellIdBase = React.useId();
  // The tenant default currency (ADR-0053) — the resolver's last step, and in
  // practice the currency of every `currency` column (objectui#10355, see
  // `columnCurrency`). It decides the stored width of a computed currency
  // cell (`computeRow`), the currency face `displayText` renders, and the
  // editable currency cell's symbol.
  const { currency: tenantCurrency } = useLocalization();
  // Per column: the host's answer for a column it resolved, else the above.
  const currencyOf = (c: GridColumn) => currencyOfColumn(c, tenantCurrency, columnCurrencies);

  // Per-cell CEL rule state (B2 in grids). A column with no readonlyWhen/
  // requiredWhen resolves to its static flags (cheap fast-path — no engine
  // call). Otherwise evaluate against the row (`record`) + header (`parent`),
  // the row's boolean cells read as booleans (`ruleRecordOf`). Every column,
  // shown or not, since a predicate may read any cell of the row.
  const booleanColumns = React.useMemo(
    () => allColumns.filter((c) => c.type === 'boolean' || isBooleanSelectColumn(c)).map((c) => c.name),
    [allColumns],
  );
  const cellRules = useCallback(
    (c: GridColumn, row: Row): { readonly: boolean; required: boolean } => {
      if (!c.readonlyWhen && !c.requiredWhen) {
        return { readonly: false, required: !!c.required };
      }
      const s = resolveFieldRuleState(
        { readonlyWhen: c.readonlyWhen, requiredWhen: c.requiredWhen },
        ruleRecordOf(booleanColumns, row),
        { required: !!c.required, readonly: false },
        undefined,
        contextRecord ? { parent: contextRecord } : undefined,
      );
      return { readonly: s.readonly, required: s.required };
    },
    [contextRecord, booleanColumns],
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
    // objectstack#35816 — a new line starts on the defaults the host knows,
    // so a required column with a default is filled, not flagged empty.
    return newRowValues ? { ...blank, ...newRowValues } : blank;
  }, [columns, newRowValues]);

  /**
   * Merge a field patch into a row. `rowIdx === rows.length` targets the
   * entry line an empty grid draws once the form refused it (`hasGhost`) —
   * editing it materialises a new real row. Computed columns are recomputed
   * for the touched row on every change.
   */
  const applyPatch = useCallback(
    (rowIdx: number, patch: Row) => {
      const isGhost = rowIdx >= rows.length;
      if (isGhost) {
        if (maxRows != null && rows.length >= maxRows) return;
        emit([...rows, computeRow(columns, { ...blankRow(), ...patch }, tenantCurrency, columnCurrencies)]);
        return;
      }
      emit(rows.map((r, i) => (i === rowIdx ? computeRow(columns, { ...touched(r), ...patch }, tenantCurrency, columnCurrencies) : r)), false);
    },
    [rows, columns, maxRows, blankRow, emit, tenantCurrency, columnCurrencies],
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
   *
   * The column's declared `lookupAutofill` pairs fill their targets too, under
   * the spec's overwrite rule. "An earlier pick filled it" is read from the
   * records picked in this grid, keyed by column and id: the record the cell
   * held before this pick, if this grid picked it, is the one whose `source`
   * values count as pick-filled. Keyed by the row's own lookup value rather
   * than its index, so adding, removing or reordering rows cannot misattribute it.
   */
  const pickedLookupRecords = useRef(new Map<string, Row>());
  const applyLookupSelection = useCallback(
    (rowIdx: number, col: GridColumn, record: any) => {
      const row = rows[rowIdx] ?? blankRow();
      const pickKey = (id: unknown) => `${col.name}\u0000${String(id)}`;
      const heldId = row[col.name];
      const previous = heldId == null || heldId === '' ? null : pickedLookupRecords.current.get(pickKey(heldId)) ?? null;
      const patch = lookupAutofillPatch(columns, col, record, { pairs: lookupAutofill?.[col.name], row, previous });
      if (record && typeof record === 'object' && patch[col.name] != null) {
        pickedLookupRecords.current.set(pickKey(patch[col.name]), record);
      }
      applyPatch(rowIdx, patch);
    },
    [columns, rows, blankRow, lookupAutofill, applyPatch],
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

  // Keyboard navigation across cells (spreadsheet-style): the table is a focus
  // grid. Enter / ArrowUp / ArrowDown move between rows in the same column;
  // Tab / Shift-Tab fall through to the browser's natural row-major order.
  // Cells carry data-cell="row-col" so we can target neighbours.
  //
  // objectstack#35507 — the grid no longer draws an empty entry line under
  // its lines, so the two keyboard paths that line carried are kept here: Add
  // moves focus into the line it appends (Tab reaches Add after the last
  // line), and Enter on the last line appends a line and moves to the same
  // column in it. The line exists only once the host hands it back in
  // `value`, so the focus waits for it (`pendingFocus`).
  const gridRef = useRef<HTMLTableElement>(null);
  const focusCell = useCallback((rowIdx: number, colIdx: number): boolean => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${rowIdx}-${colIdx}"]`);
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
    return true;
  }, []);
  /** The line and column to focus once the host hands an appended line back; `null` column = its first focusable cell. */
  const pendingFocus = useRef<{ rowIdx: number; colIdx: number | null } | null>(null);
  React.useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || rows.length <= pending.rowIdx) return;
    pendingFocus.current = null;
    if (pending.colIdx != null && focusCell(pending.rowIdx, pending.colIdx)) return;
    const first = gridRef.current?.querySelector<HTMLElement>(`[data-cell^="${pending.rowIdx}-"]`);
    if (first) {
      first.focus();
      if (first instanceof HTMLInputElement) first.select();
    }
  }, [rows.length, focusCell]);

  /** The Esc snapshot of the cell being visited; see the Esc block below. */
  const cellVisit = useRef<{ key: string; rowIdx: number; row: Row; count: number } | null>(null);

  const addRow = useCallback((focusColIdx: number | null = null) => {
    if (maxRows != null && rows.length >= maxRows) return;
    pendingFocus.current = { rowIdx: rows.length, colIdx: focusColIdx };
    cellVisit.current = null;
    // objectstack#35816 — a line Add starts on the host's defaults is marked
    // untouched until its first edit (`UNTOUCHED_NEW_ROW`).
    emit([...rows, newRowValues ? { ...blankRow(), [UNTOUCHED_NEW_ROW]: true } : blankRow()]);
  }, [rows, blankRow, maxRows, emit, newRowValues]);

  const onCellKeyDown = useCallback(
    (e: React.KeyboardEvent, rowIdx: number, colIdx: number) => {
      // objectstack#35996 — Enter and the arrows pressed while an input
      // method composes pick or move its candidate: the grid neither moves
      // nor appends a line on them.
      if (isImeKey(e)) return;
      if (e.key === 'Enter' && rowIdx === rows.length - 1 && allowAdd && !isList) {
        e.preventDefault();
        addRow(colIdx);
      } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        focusCell(rowIdx + 1, colIdx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (rowIdx > 0) focusCell(rowIdx - 1, colIdx);
      }
    },
    [focusCell, rows.length, allowAdd, isList, addRow],
  );

  /**
   * Esc in a cell takes back what this visit to the cell changed
   * (objectstack#36023): the line returns to what it held when the cell was
   * entered, its other cells included (a lookup pick's autofill), and the
   * untouched mark of a new line with it. The key stops at the grid, so a
   * form open in a dialog keeps its dialog and every other line: Esc in a
   * cell never closes it. A cell whose panel is open hands Esc to the panel,
   * which closes and writes nothing.
   *
   * Read on the window's capture phase, ahead of the dialog's own document
   * listener, which would close the dialog before any handler in the table
   * ran.
   *
   * The snapshot is held by line index, so a change to the lines themselves
   * (add, remove, duplicate, move) ends the visit: after it the same index
   * can draw another line, and putting the snapshot back would overwrite
   * that line with a removed or moved one. The line count is kept with the
   * snapshot as a second guard, for a host that replaces the lines itself.
   * (`cellVisit` is declared above `addRow`, which ends the visit too.)
   */
  const rowsRef = useRef(rows);
  const emitRef = useRef(emit);
  React.useLayoutEffect(() => {
    rowsRef.current = rows;
    emitRef.current = emit;
  });
  const cellKeyOf = (el: EventTarget | null): { key: string; rowIdx: number } | null => {
    const cell = el instanceof Element ? el.closest('[data-grid-cell]') : null;
    const key = cell?.getAttribute('data-grid-cell');
    if (!cell || !key || !gridRef.current?.contains(cell)) return null;
    return { key, rowIdx: Number(key.slice(0, key.indexOf(':'))) };
  };
  const onGridFocus = (e: React.FocusEvent) => {
    const at = cellKeyOf(e.target);
    if (!at || cellVisit.current?.key === at.key) return;
    const row = rowsRef.current[at.rowIdx];
    cellVisit.current = row ? { key: at.key, rowIdx: at.rowIdx, row, count: rowsRef.current.length } : null;
  };
  const onGridBlur = (e: React.FocusEvent) => {
    const to = e.relatedTarget as Element | null;
    // Into a cell's own panel (portaled out of the table) is still the visit.
    if (to && (gridRef.current?.contains(to) || to.closest('[data-radix-popper-content-wrapper]'))) return;
    cellVisit.current = null;
  };
  const editable = !readonly && !isList;
  React.useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isImeKey({ nativeEvent: e, keyCode: e.keyCode })) return;
      const at = cellKeyOf(e.target);
      if (!at) return;
      const cell = (e.target as Element).closest('[data-grid-cell]');
      if (cell?.querySelector('[aria-expanded="true"]')) return;
      e.stopPropagation();
      e.preventDefault();
      const visit = cellVisit.current;
      const current = rowsRef.current;
      if (!visit || visit.key !== at.key || visit.count !== current.length || current[visit.rowIdx] === visit.row) return;
      emitRef.current(current.map((r, i) => (i === visit.rowIdx ? visit.row : r)), false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editable]);

  const removeRow = useCallback(
    (rowIdx: number) => {
      if (rows.length <= minRows) return;
      cellVisit.current = null;
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
      // A copy is a line the user made, so it is not an untouched one.
      next.splice(rowIdx + 1, 0, touched({ ...copy }));
      cellVisit.current = null;
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
      cellVisit.current = null;
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
            <span className="rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary">
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
                  <ColumnHeaderHelp help={columnHelp?.[c.name]} />
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
                        readOnlyFace(c, row[c.name]) ?? displayText(c, row[c.name], displayLocale, currencyOf(c))
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
                <td className="px-3 py-2 text-right font-medium text-foreground tabular-nums">
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
  // objectstack#35507 — no empty entry line is drawn under the lines. It used
  // to be, always ("start-with-one + auto-append"), directly above the Add
  // button, which does the same job: it had no actions, produced no write, and
  // users read it as a broken line they could not delete. Both followed
  // `allowAdd`, so no grid loses its way to add a line; Add and Enter on the
  // last line carry its keyboard path (see `pendingFocus`). An empty grid says
  // so and names the Add button instead.
  //
  // One state still draws the entry line: a REQUIRED grid the form refused
  // while EMPTY (`hostFailedEmpty`, below). There the line is what the
  // failure is about: its required cells carry the field's failure to
  // assistive tech on the controls a user types into to fix it (objectui#3318),
  // and the Add button, the only other control, is an action, not what is
  // invalid. Typing into it materialises a real line, as before.
  const hostFailedEmpty = !!error && rows.length === 0;
  const hasGhost = !isList && allowAdd && hostFailedEmpty && (maxRows == null || maxRows > 0);
  const displayRows: Row[] = hasGhost ? [...rows, blankRow()] : rows;
  const addLabel = cfg.addLabel || t('fields.grid.addLine', { defaultValue: 'Add line' });

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
   *
   * Since objectstack#35507 that entry line is drawn ONLY in this state: an
   * empty grid that has not failed draws its empty-state hint instead.
   * (`hostFailedEmpty` itself is computed above, beside `hasGhost`.)
   */

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
      const face = readOnlyFace(c, val);
      if (face) return face;
      return (
        <span className={cn('px-2 text-sm text-foreground', isNumeric(c.type) && 'tabular-nums', (val == null || val === '') && 'text-muted-foreground')}>
          {displayText(c, val, displayLocale, currencyOf(c))}
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
          {displayText(c, val, displayLocale, currencyOf(c))}
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
    // objectstack#36023 — the option list opens under the cell, searchable,
    // and a pick writes the value; the cell keeps showing the label meanwhile.
    if (c.type === 'select') {
      return (
        <GridSelectCell
          options={(c.options || []).map((o) => ({ value: String(o.value), label: o.label }))}
          value={val}
          onPick={(v) => setCell(rowIdx, c, v)}
          disabled={locked}
          invalid={invalid}
          label={c.label || c.name}
          onNavKeyDown={(e) => onCellKeyDown(e, rowIdx, colIdx)}
          data-cell={`${rowIdx}-${colIdx}`}
        />
      );
    }
    // objectstack#36043 — multi-select, tags and people open the face the
    // main list's cell editor draws, in a panel under the cell; the cell keeps
    // drawing its value meanwhile.
    if (c.type === 'multiselect' || c.type === 'tags') {
      const held: string[] = Array.isArray(val) ? val.map(String) : isEmptyCell(val) ? [] : [String(val)];
      const Face = c.type === 'multiselect' ? MultiSelectField : TagsField;
      return (
        <GridPanelCell<string[]>
          value={held}
          onWrite={(next) => setCellValue(rowIdx, c.name, next)}
          display={
            <span className={cn('truncate', held.length === 0 && 'text-muted-foreground')}>
              {displayText(c, held, displayLocale)}
            </span>
          }
          disabled={locked}
          invalid={invalid}
          label={c.label || c.name}
          onNavKeyDown={(e) => onCellKeyDown(e, rowIdx, colIdx)}
          data-cell={`${rowIdx}-${colIdx}`}
          panelTestId={`line-items-${c.type}-panel`}
        >
          {({ draft, setDraft }) => (
            <Face
              inCell
              value={draft}
              onChange={(next: string[]) => setDraft(next)}
              field={{ name: c.name, type: c.type, options: c.options } as any}
            />
          )}
        </GridPanelCell>
      );
    }
    if (c.type === 'user') {
      const field = { name: c.name, type: 'user', label: c.label, multiple: c.multiple } as any;
      return (
        <GridPanelCell<any>
          value={val ?? null}
          onWrite={(next) => setCellValue(rowIdx, c.name, next)}
          display={readOnlyFace(c, val) ?? <span className="text-muted-foreground">—</span>}
          disabled={locked}
          invalid={invalid}
          label={c.label || c.name}
          onNavKeyDown={(e) => onCellKeyDown(e, rowIdx, colIdx)}
          data-cell={`${rowIdx}-${colIdx}`}
          panelTestId="line-items-user-panel"
        >
          {({ draft, setDraft, commit }) => (
            <UserField inCell value={draft} onChange={(next: any) => setDraft(next)} onCommit={commit} field={field} />
          )}
        </GridPanelCell>
      );
    }
    // A check cell is a checkbox: a click or Space toggles it (objectstack#36043).
    if (c.type === 'boolean') {
      return (
        <div className="flex h-8 items-center justify-center">
          <Checkbox
            data-cell={`${rowIdx}-${colIdx}`}
            aria-label={c.label || c.name}
            aria-invalid={invalid || undefined}
            checked={val === true || BOOLEAN_READINGS.get(val) === true}
            onCheckedChange={(checked) => setCellValue(rowIdx, c.name, checked === true)}
            onKeyDown={(e) => onCellKeyDown(e, rowIdx, colIdx)}
            disabled={locked}
          />
        </div>
      );
    }
    // A rating is set in place: a click on a star, or a digit key on the
    // cell (0 clears), as in the main list (objectstack#36023, #36043).
    if (c.type === 'rating') {
      const max = ratingMax(c);
      return (
        <div
          data-cell={`${rowIdx}-${colIdx}`}
          tabIndex={-1}
          aria-label={c.label || c.name}
          aria-invalid={invalid || undefined}
          className="flex h-8 items-center outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
          onKeyDown={(e) => {
            if (!locked && /^[0-9]$/.test(e.key) && Number(e.key) <= max) {
              e.preventDefault();
              setCellValue(rowIdx, c.name, e.key === '0' ? null : Number(e.key));
              return;
            }
            onCellKeyDown(e, rowIdx, colIdx);
          }}
        >
          <RatingField
            inCell
            value={isEmptyCell(val) ? 0 : Number(val)}
            onChange={(next: number) => setCellValue(rowIdx, c.name, next)}
            field={{ type: 'rating', max } as any}
            disabled={locked}
            error={invalid ? requiredCellText(c) : undefined}
          />
        </div>
      );
    }
    // The editable currency cell shows the SAME symbol its display face does
    // (objectui#10355) — `currencyAdornment`, never a default `¥`.
    const adornment = c.type === 'currency' ? currencyAdornment(c, currencyOf(c), displayLocale) : '';
    // A `date` or `datetime` cell holding a value written on a day that does
    // not exist (objectui#10474, objectui#10567): its control can paint that
    // only blank — the `date` control sanitises the verbatim day
    // `toDateInputValue` keeps, so it is handed `""` below, as the `datetime`
    // adapter already does — so the
    // control is marked invalid, its description naming the stored string.
    // Nothing is written until the user picks a new value — the same face
    // `DateField` / `DateTimeField` give it.
    const impossibleDay = (c.type === 'date' || c.type === 'datetime') && isImpossibleStoredDay(val);
    const noticeId = impossibleDay ? `${cellIdBase}-impossible-${rowIdx}-${colIdx}` : undefined;
    const impossibleText = impossibleDay
      ? t(c.type === 'date' ? 'fields.date.impossibleDay' : 'fields.dateTime.impossibleDay', { value: String(val) })
      : null;
    // objectstack#36023 — a date or date-time cell is still typed into, and
    // its calendar opens under the cell on arrival. The stored-day notice
    // reads at the top of that calendar, and stays the control's description
    // (out of sight in the cell, so the row keeps its height).
    if (c.type === 'date' || c.type === 'datetime') {
      return (
        <>
          <GridDateCell
            kind={c.type}
            data-cell={`${rowIdx}-${colIdx}`}
            aria-label={c.label || c.name}
            aria-invalid={invalid || impossibleDay || undefined}
            aria-describedby={noticeId}
            title={impossibleText ?? undefined}
            onKeyDown={(e) => onCellKeyDown(e, rowIdx, colIdx)}
            className={cn(GRID_CELL_CONTROL_CLASS, PHONE_TOUCH_HEIGHT)}
            nativeValue={c.type === 'date' ? (impossibleDay ? '' : toDateInputValue(val)) : toDateTimeInputValue(val)}
            onNativeChange={(next) => setCell(rowIdx, c, next)}
            notice={impossibleText}
            disabled={locked}
          />
          {impossibleDay && (
            <span id={noticeId} className="sr-only" data-testid={`line-items-impossible-day-${rowIdx}-${c.name}`}>
              {impossibleText}
            </span>
          )}
        </>
      );
    }
    // A text cell floats right over its neighbours while its text is longer
    // than the column (objectstack#36023); numbers and times keep their box.
    const CellInput = !c.type || c.type === 'text' ? GrowingCellInput : Input;
    return (
      <div className="relative">
        {adornment && (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{adornment}</span>
        )}
        <CellInput
          data-cell={`${rowIdx}-${colIdx}`}
          aria-invalid={invalid || undefined}
          onKeyDown={(e) => onCellKeyDown(e, rowIdx, colIdx)}
          className={cn(
            GRID_CELL_CONTROL_CLASS,
            PHONE_TOUCH_HEIGHT,
            adornment && 'pl-6',
            isNumeric(c.type) && 'text-right tabular-nums',
          )}
          type={c.type === 'time' ? 'time' : isNumeric(c.type) ? 'number' : 'text'}
          step={isNumeric(c.type) ? c.step ?? 'any' : undefined}
          aria-label={c.label || c.name}
          // `time` reads and writes `HH:mm[:ss]`, the stored shape, both ways;
          // the date types read through their adapters above (objectui#3566).
          value={val != null ? String(val) : ''}
          onChange={(e) => setCell(rowIdx, c, e.target.value)}
          disabled={locked}
        />
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
      <div className="border border-border rounded-lg overflow-x-auto" data-line-items-scroll="">
        <table ref={gridRef} className="w-full text-sm" onFocus={onGridFocus} onBlur={onGridBlur}>
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
                  <ColumnHeaderHelp help={columnHelp?.[c.name]} />
                </th>
              ))}
              {hasRowActions && <th style={{ width: actionColWidth }} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!isList && displayRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (hasRowActions ? 1 : 0) + 1}
                  className="px-3 py-6 text-center text-muted-foreground"
                  data-testid="line-items-empty"
                >
                  {allowAdd
                    ? t('fields.grid.noItemsAddHint', {
                        label: addLabel,
                        defaultValue: 'No items yet — click “{{label}}” to begin.',
                      })
                    : t('fields.grid.noItems', { defaultValue: 'No items' })}
                </td>
              </tr>
            ) : isList && rows.length === 0 ? (
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
                      // objectstack#35816 — a new line waits for the host's
                      // word before it reads red; a stored line does not.
                      // objectstack#35940 — a line Add started on its defaults
                      // and nobody edited never reads red: the save skips it
                      // and says so, so there is nothing in it to fix.
                      const newRowWaits =
                        (newRowRequiredShown === false && !isGhost && !rowHasId(row)) ||
                        isUntouchedNewRow(row);
                      const invalid =
                        (!isGhost || hostFailedEmpty) &&
                        !newRowWaits &&
                        !isList &&
                        required &&
                        !c.computed &&
                        isEmptyCell(row[c.name]);
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
                          data-grid-cell={`${rowIdx}:${c.name}`}
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
                              className={cn('h-8 w-8 text-muted-foreground hover:text-foreground', PHONE_TOUCH_SQUARE)}
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
                              className={cn('h-8 w-8 text-muted-foreground hover:text-foreground', PHONE_TOUCH_SQUARE)}
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
                              className={cn('h-8 w-8 text-muted-foreground hover:text-destructive', PHONE_TOUCH_SQUARE)}
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
                <td className="px-3 py-2 text-right font-medium text-foreground tabular-nums" data-testid="line-items-total">
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
          className={PHONE_TOUCH_HEIGHT}
          onClick={isList && onAdd ? onAdd : () => addRow()}
          disabled={maxRows != null && rows.length >= maxRows}
          data-testid="line-items-add"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {addLabel}
        </Button>
      )}
    </div>
  );
}
