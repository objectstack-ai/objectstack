// A `.ts` file, JSX-free: the widget body that used to be `GridField.tsx` moved
// to `./grid-field/GridFieldWidget.tsx`, and every import of `./GridField.js`
// still lands here (objectstack#36102).
import React from 'react';
import type { InlineGridColumn } from '@objectstack/spec/data';
import { resolveFieldCurrency, currencyFractionDigits } from '../currency.js';
import {
  crossCurrencyRefusal,
  planDeclaredLookupAutofill,
  type AutofillCurrencyContext,
  type LookupAutofillPair,
  type LookupAutofillPlan,
  type WithheldAutofill,
} from './lookupAutofill.js';
import { fieldHelpText } from '../fieldHelpText.js';
// Type-only: erased at build, so it adds no edge to the bundle graph. The one
// RUNTIME edge to the widget body is the `import()` in `loadGridFieldWidget`.
import type { GridFieldWidgetProps } from './grid-field/GridFieldWidget.js';

/**
 * GridField / LineItemsField — the public face of the line-item grid, and its
 * pure half.
 *
 * ## Why the widget body is in another file (objectstack#36102)
 *
 * The grid's body (`./grid-field/GridFieldWidget.tsx`, the cells, the column
 * chooser, the row drag, the in-cell panels' host) is the largest field widget
 * in this package, and a record form with line items is the only page that
 * draws it. It used to sit on the console's EAGER `ui-components` line anyway:
 * the package entry imported it lazily for the `grid` field type AND exported
 * it by name, and the package declares `"sideEffects": true`, so the named
 * export was a static edge from the entry that no bundler may drop. This
 * module is what the entry exports instead, so both names keep their meaning
 * and their props:
 *
 *  - `GridField` / `LineItemsField` here render the body through ONE loader,
 *    {@link loadGridFieldWidget}. A mount after the body has loaded renders it
 *    directly, in the same render, with no boundary in between; only a mount
 *    that finds it still loading shows {@link GridFieldLoading} until it
 *    arrives. Each mount decides once, so a row the user is editing is never
 *    remounted by the load finishing.
 *  - {@link preloadGridField} starts that load early. The record forms that
 *    draw line items (`@object-ui/plugin-form`) call it when they mount, and
 *    the two that derive a grid's columns from the child object's schema
 *    (`MasterDetailForm`, `RecordBodyTableEditor`) also wait for it together
 *    with that schema, so their grid never mounts on the placeholder.
 *  - The pure helpers below stay in this file, in the eager chunk, because the
 *    entry exports them by name and they import nothing heavy.
 *
 * ⛔ Never import `./grid-field/GridFieldWidget.js` statically from outside
 * that directory (its tests excepted): a static edge from the eager graph
 * undoes the split, and the console build's chunk-membership check
 * (`PER_CHUNK_MEMBERSHIP_CARVE_OUTS`) is what reports it.
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
 *    a `currency` column (objectui#10783): the resolved currency's CLDR
 *    fraction digits decide both the stored and the shown width
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
 *
 * `declared` carries the child field's `lookupAutofill` pairs, the row being
 * edited and the record the cell held from an earlier pick in this grid. Each
 * pair writes its target under the spec's overwrite rule
 * (`declaredLookupAutofillPatch`), whatever the column's `autofill` says, and
 * a declared target is taken out of the same-named copy, so one target never
 * has two writers on one pick.
 *
 * `currency` is the pick's cross-currency rule (`crossCurrencyRefusal`): a
 * value it refuses is left out of the patch, the same-named copy and the
 * declared pairs alike, and listed under `withheld` so the grid says why the
 * cell stayed empty. Without it every value copies as before.
 */
export function planLookupAutofill(
  columns: GridColumn[],
  col: GridColumn,
  record: any,
  declared?: { pairs?: readonly LookupAutofillPair[]; row?: Row; previous?: Row | null },
  currency?: AutofillCurrencyContext,
): LookupAutofillPlan {
  const patch: Row = { [col.name]: record?.value ?? record?.id ?? record?._id };
  const withheld: WithheldAutofill[] = [];
  const declaredTargets = new Set((declared?.pairs ?? []).map((p) => p.target));
  if (col.autofill !== false && record && typeof record === 'object') {
    for (const other of columns) {
      if (other.name === col.name || other.computed || other.type === 'lookup') continue;
      if (declaredTargets.has(other.name)) continue;
      const v = record[other.name];
      if (v === undefined || v === null || v === '') continue;
      const refusal = currency
        ? crossCurrencyRefusal(currency.sourceCurrency(other.name, v), currency.targetCurrency(other.name), currency.home)
        : undefined;
      if (refusal) withheld.push({ target: other.name, source: other.name, amount: Number(v), ...refusal });
      else patch[other.name] = v;
    }
  }
  const pairs = planDeclaredLookupAutofill(declared?.pairs, record, declared?.row, declared?.previous, currency);
  return { patch: { ...patch, ...pairs.patch }, withheld: [...withheld, ...pairs.withheld] };
}

/** {@link planLookupAutofill}'s writes alone. */
export function lookupAutofillPatch(
  columns: GridColumn[],
  col: GridColumn,
  record: any,
  declared?: { pairs?: readonly LookupAutofillPair[]; row?: Row; previous?: Row | null },
  currency?: AutofillCurrencyContext,
): Row {
  return planLookupAutofill(columns, col, record, declared, currency).patch;
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
 * 1. The resolved currency's CLDR fraction digits (0 for JPY, 2 for USD, 3 for
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
export function currencyWidth(currency: string | undefined): number | undefined {
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
function storedFractionScale(
  c: GridColumn,
  tenantCurrency: string | undefined,
  columnCurrencies?: ColumnCurrencies,
): number | undefined {
  if (c.type !== 'currency') return c.scale;
  return currencyWidth(currencyOfColumn(c, tenantCurrency, columnCurrencies));
}

/**
 * The currencies a host resolved for some of its `currency` columns, by column
 * name: a line amount that follows its header's currency through the
 * `master_detail` (ADR-0144 D2 as amended) is in the header's code, which only
 * the host holding the header record and the child schema can say. A name
 * mapped to `undefined` is a column with no known currency (the header holds
 * no code yet): it shows no symbol, never the tenant's.
 */
export type ColumnCurrencies = Readonly<Record<string, string | undefined>>;

/** `c`'s currency: the host's answer for it when it gave one, else {@link columnCurrency}. */
export function currencyOfColumn(
  c: GridColumn,
  tenantCurrency: string | undefined,
  columnCurrencies: ColumnCurrencies | undefined,
): string | undefined {
  return columnCurrencies && Object.prototype.hasOwnProperty.call(columnCurrencies, c.name)
    ? columnCurrencies[c.name]
    : columnCurrency(tenantCurrency);
}

/**
 * @param tenantCurrency the tenant's default currency (`useLocalization()`),
 *   the resolver's last step for a `currency` column — see
 *   {@link storedFractionScale}.
 */
export function computeRow(columns: GridColumn[], row: Row, tenantCurrency?: string, columnCurrencies?: ColumnCurrencies): Row {
  const computedCols = columns.filter((c) => c.computed && c.expr);
  if (computedCols.length === 0) return row;
  const next = { ...row };
  for (const c of computedCols) {
    const v = evalArith(c.expr!, next);
    if (v === null) { next[c.name] = null; continue; }
    const scale = storedFractionScale(c, tenantCurrency, columnCurrencies);
    next[c.name] = scale != null ? Number(v.toFixed(scale)) : v;
  }
  return next;
}

/** Sum a numeric column across rows (ignoring blanks/NaN). */
export function sumColumn(rows: Row[], field: string): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((acc, r) => {
    const v = Number(r?.[field]);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}

/**
 * The help text of a grid's columns, by column name (objectstack#35804).
 * Each value is what the record form draws under the same field.
 */
export type ColumnHelp = Readonly<Record<string, string>>;

/**
 * The {@link ColumnHelp} of a child object's fields: each field's help read
 * through {@link fieldHelpText}, the ONE read the record form's help line uses
 * (objectui#12213), so a grid header and the form show the same text. Hand it
 * the child object's definition as the server serves it, the one the record
 * form reads: another package's `objectExtensions.fieldPatches` are already
 * applied there, and the help is in the reader's language. A field with no
 * help is left out.
 */
export function columnHelpByField(fields: Readonly<Record<string, unknown>> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [name, def] of Object.entries(fields)) {
    if (!def || typeof def !== 'object') continue;
    const help = fieldHelpText(def as Parameters<typeof fieldHelpText>[0]);
    if (help) out[name] = help;
  }
  return out;
}

/**
 * objectstack#35816 — marks a line that `Add` started on the host's
 * `newRowValues` and that nobody has edited since. Such a line holds only its
 * defaults, and a host may skip it at save like a blank one; any edit to the
 * line takes the mark off, so a value the user typed counts as input even when
 * it equals the default. A symbol key: `Object.keys`/`Object.entries` and
 * `JSON.stringify` (so every write payload) skip it, while the spread copies a
 * host or a renumbering makes keep it. Set only when the host passes
 * `newRowValues`, so a host that passes none sees rows exactly as before.
 */
export const UNTOUCHED_NEW_ROW: unique symbol = Symbol.for('@object-ui/fields.untouchedNewRow');

/** True for a line `Add` started on its defaults and nobody has edited ({@link UNTOUCHED_NEW_ROW}). */
export function isUntouchedNewRow(row: unknown): boolean {
  return row != null && typeof row === 'object' && (row as Record<symbol, unknown>)[UNTOUCHED_NEW_ROW] === true;
}

type GridFieldWidgetModule = typeof import('./grid-field/GridFieldWidget.js');

/** The loaded body, once {@link loadGridFieldWidget} has resolved. */
let gridFieldWidgetModule: GridFieldWidgetModule | undefined;
let gridFieldWidgetLoad: Promise<GridFieldWidgetModule> | undefined;

/**
 * The ONE loader of the grid's body: the face below and {@link
 * preloadGridField} go through it (and the `grid` form-field loader in
 * `../index.tsx` reaches it through the face), so the body is requested once
 * and a mount after any of them has resolved renders without a boundary. A
 * failed load is forgotten, so the next caller asks again rather than
 * inheriting the failure.
 */
export function loadGridFieldWidget(): Promise<GridFieldWidgetModule> {
  gridFieldWidgetLoad ??= import('./grid-field/GridFieldWidget.js').then(
    (loaded) => {
      gridFieldWidgetModule = loaded;
      return loaded;
    },
    (error: unknown) => {
      gridFieldWidgetLoad = undefined;
      throw error;
    },
  );
  return gridFieldWidgetLoad;
}

/**
 * Start loading the line-item grid's body ahead of its first render. Call it
 * where a form that may draw line items mounts; idempotent. The promise
 * settles once the body has loaded, so a caller that must render in the same
 * tick (a test at module scope) can await it. ⛔ It never rejects, so a caller
 * may drop it: a failed preload is reported by the grid's own render, which
 * asks again and hands a second failure to the nearest error boundary, where
 * it can be seen.
 */
export function preloadGridField(): Promise<void> {
  return loadGridFieldWidget().then(
    () => undefined,
    () => undefined,
  );
}

/**
 * What a grid mounted before its body arrived shows meanwhile: a box of the
 * grid's header height, marked busy, so the form does not jump when the table
 * replaces it.
 */
function GridFieldLoading(): React.ReactElement {
  return React.createElement('div', {
    className: 'min-h-10 w-full rounded-md border border-dashed',
    'aria-busy': 'true',
    'data-testid': 'grid-field-loading',
  });
}

/**
 * The `grid` field widget and the master-detail subform's child grid. Same
 * props as the body, see `GridFieldWidgetProps`.
 */
export function GridField(props: GridFieldWidgetProps): React.ReactElement {
  // Decided once per mount: switching from the loading face to the direct
  // render when the load finishes would remount the body and drop the focused
  // cell.
  const [loadedAtMount] = React.useState(() => gridFieldWidgetModule);
  if (loadedAtMount) {
    const { GridFieldWidget } = loadedAtMount;
    return React.createElement(GridFieldWidget, props);
  }
  return React.createElement(GridFieldOnceLoaded, props);
}

type GridFieldLoadOutcome =
  | { readonly loaded: GridFieldWidgetModule }
  | { readonly failed: unknown };

/**
 * A grid mounted before its body arrived: {@link GridFieldLoading} until the
 * body loads, then the body. Each COMMITTED mount asks the loader once, from an
 * effect, and a failed load is thrown from the next render to the nearest
 * error boundary. Not `React.lazy`: a lazy component keeps its first outcome
 * for good, a rejection included, so a later mount would rethrow that failure
 * until the page is reloaded. A render React discards before it commits runs
 * no effect, so it requests nothing, and the loader forgets a failure, so the
 * next mount (an error boundary's reset, a reopened form) loads again.
 */
function GridFieldOnceLoaded(props: GridFieldWidgetProps): React.ReactElement {
  const [outcome, setOutcome] = React.useState<GridFieldLoadOutcome | undefined>(undefined);
  React.useEffect(() => {
    let mounted = true;
    loadGridFieldWidget().then(
      (loaded) => {
        if (mounted) setOutcome({ loaded });
      },
      (failed: unknown) => {
        if (mounted) setOutcome({ failed });
      },
    );
    return () => {
      mounted = false;
    };
  }, []);
  if (!outcome) return React.createElement(GridFieldLoading);
  if ('failed' in outcome) throw outcome.failed;
  return React.createElement(outcome.loaded.GridFieldWidget, props);
}

/** Semantic alias — the master-detail subform's child grid. */
export const LineItemsField = GridField;
