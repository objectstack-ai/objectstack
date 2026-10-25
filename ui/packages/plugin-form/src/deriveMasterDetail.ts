/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Derive a master-detail child collection's grid columns + relationship FK from
 * object metadata, so a master-detail form can be configured with just the
 * child object name instead of a hand-authored columns block. Pure (no React /
 * no fetch) so it is unit-testable; the async schema fetch lives in the
 * component. The one side effect is an author diagnostic on the console —
 * `reportCurrencyColumnScale` (objectui#10783).
 */

import {
  DEFAULT_MAX_INLINE_GRID_COLUMNS,
  deriveInlineGridColumns,
  deriveInlineRowFormFields,
} from '@objectstack/spec/data';
import type { BooleanValueLabel, GridColumn } from '@object-ui/fields';

/**
 * Minimal shape of a MASTER-DETAIL CHILD object's schema, as returned by
 * `DataSource.getObjectSchema` — the `childSchema` parameter of every derive
 * function below (objectui#7324).
 *
 * Named for the child because that is the only thing it is ever used for, and
 * because `schemaDefaults.ts` holds a DIFFERENT shape under what used to be
 * the same name (`FieldDefaultsSchemaLike` now). The two are not
 * interchangeable: this one's field values are `any` — these functions read a
 * field's `type`, `label`, `options`, `hidden`, `reference` and more — while
 * the defaults one pins the four members that rule reads. Publishing both
 * under one name would have put a name on the package surface that already
 * meant something else two files over.
 *
 * NOT `@object-ui/types`' `ObjectSchemaMetadata`: that type requires `name`
 * and requires a `type` on every field, so the partial schemas these
 * functions are handed (and every fixture that exercises them) would stop
 * compiling. This is a deliberately structural parameter type — pass the
 * object document your data source serves.
 */
export interface ChildObjectSchemaLike {
  name?: string;
  fields?: Record<string, any>;
}

/** Field names that hold a line's sort position — the names `deriveDetail`
 *  picks the line's sort field from (the grid stamps it on drag-reorder). The
 *  grid columns and the row form leave these names out by the spec's own rule
 *  (`deriveInlineGridColumns`, `deriveInlineRowFormFields`). */
const SORT_FIELD_NAMES = new Set(['position', 'sort_order', 'sequence', 'line_no', 'line_number', 'sort']);

/** Map an ObjectQL field type to a LineItems grid column type. */
export function fieldTypeToColumnType(type: string | undefined): GridColumn['type'] {
  switch (type) {
    case 'number':
    case 'percent':
    case 'rating':
    case 'slider':
      return 'number';
    case 'currency':
      return 'currency';
    // Three distinct controls, NOT one (objectui#3569). Collapsing `datetime`
    // and `time` onto the `date` column type fed both into an
    // `<input type="date">`: the time component was invisible on read, and
    // because that control emits a bare `YYYY-MM-DD`, merely touching the day
    // wrote the time OUT of the record. The grid can only pick the right
    // control — and the right read-only formatting — if the type survives here.
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'time':
      return 'time';
    case 'select':
    case 'picklist':
    case 'radio':
    case 'boolean':
    case 'toggle':
      return 'select';
    case 'lookup':
    case 'master_detail':
      return 'lookup';
    case 'file':
    case 'image':
    case 'avatar':
      return 'file';
    default:
      return 'text';
  }
}

/** Image-flavoured field types whose picker should be restricted to images. */
const IMAGE_TYPES = new Set(['image', 'avatar']);

/** Carry a file field's upload constraints onto its grid column: `multiple`,
 *  the field's `accept` list, or an `image/*` restriction for image fields.
 *  Values already present on the column (author-supplied) are left untouched. */
function applyFileColumnProps(col: GridColumn, d: any): void {
  if (col.multiple == null && d?.multiple) col.multiple = true;
  if (col.accept == null) {
    if (Array.isArray(d?.accept) && d.accept.length > 0) col.accept = d.accept;
    else if (IMAGE_TYPES.has(d?.type)) col.accept = ['image/*'];
  }
}

/**
 * A select column's options, from its child field. A `boolean` / `toggle`
 * field has no options of its own, so it gets two, whose STORED values are
 * `'true'` / `'false'` and whose LABELS are the session's word for each value,
 * drawn by `booleanLabel` (objectui#12924).
 *
 * The labels used to be the literals `Yes` / `No`, so the line-items grid's
 * select and its read-only cells read English on every locale. They now come
 * from the one rule that names a boolean value as a word,
 * `useBooleanValueLabel` in `@object-ui/fields` (`common.yes` / `common.no`,
 * objectui#11689), which the caller holds and hands in: this module is pure,
 * so it has no translator of its own. ⛔ No default stands in for a missing
 * one; every derive function below REQUIRES it, so a caller cannot draw the
 * options in a language the session is not in.
 */
function optionsFor(def: any, booleanLabel: BooleanValueLabel): GridColumn['options'] | undefined {
  if (def?.type === 'boolean' || def?.type === 'toggle') {
    return [
      { label: booleanLabel(true), value: 'true' },
      { label: booleanLabel(false), value: 'false' },
    ];
  }
  const raw = def?.options;
  if (!Array.isArray(raw)) return undefined;
  return raw.map((o: any) =>
    typeof o === 'object' && o !== null
      ? { label: String(o.label ?? o.value), value: String(o.value) }
      : { label: String(o), value: String(o) },
  );
}

/**
 * Find the field on the child object that points back to the parent — the
 * master_detail/lookup field whose `reference` is the parent object. Prefer
 * `master_detail` over `lookup` when both exist.
 */
export function findRelationshipField(
  childSchema: ChildObjectSchemaLike | undefined,
  parentObjectName: string,
): string | undefined {
  const fields = childSchema?.fields;
  if (!fields || typeof fields !== 'object') return undefined;
  let lookupMatch: string | undefined;
  for (const [name, def] of Object.entries(fields)) {
    const d = def as any;
    if (d?.reference !== parentObjectName) continue;
    if (d?.type === 'master_detail') return name; // strongest match
    if (d?.type === 'lookup' && !lookupMatch) lookupMatch = name;
  }
  return lookupMatch;
}

/**
 * Derive editable grid columns from a child object's fields — the grid an
 * inline master-detail collection draws when its author listed no columns.
 *
 * WHICH columns, in what order, and which are `defaultHidden`, is
 * `@objectstack/spec`'s rule, `deriveInlineGridColumns` (objectui#11345): it
 * skips system / audit fields, sort-position fields, fields flagged `system`,
 * `readonly` or `hidden`, non-editable types, the back-reference FK to the
 * parent and any `exclude`d name, and keeps every other field. Past the
 * visible budget ({@link DEFAULT_MAX_INLINE_GRID_COLUMNS}, the spec's) the
 * overflow is flagged `defaultHidden` — collapsed into the grid's column
 * chooser, never dropped; required columns always stay visible. Pass
 * `maxColumns: 0` to flag none. The rule lives in the spec so that an
 * author-time tool (objectstack's `field-no-consumers` lint) credits exactly
 * the columns this grid draws, and the two cannot disagree.
 *
 * What each column carries — label, cell type, options, lookup target,
 * conditional rules, computed expression — is built here, from the child
 * field, by {@link deriveColumn}. `booleanLabel` is required: it draws the
 * option labels of a `boolean` / `toggle` child field in the session language
 * (see `optionsFor`, objectui#12924).
 */
export function deriveColumns(
  childSchema: ChildObjectSchemaLike | undefined,
  opts: { booleanLabel: BooleanValueLabel; relationshipField?: string; exclude?: string[]; maxColumns?: number },
): GridColumn[] {
  const fields = childSchema?.fields;
  if (!fields || typeof fields !== 'object') return [];
  const derived = deriveInlineGridColumns(childSchema, {
    relationshipField: opts.relationshipField,
    exclude: opts.exclude,
    maxColumns: opts.maxColumns ?? DEFAULT_MAX_INLINE_GRID_COLUMNS,
  });
  return derived.map(({ name, defaultHidden }) => {
    const col = deriveColumn(name, fields[name], opts.booleanLabel);
    return defaultHidden ? { ...col, defaultHidden } : col;
  });
}

/**
 * Build one derived grid column from its child field definition `d`. A falsy
 * `d` (the field map holds `null` / `undefined` / `0` / `''` / `false` under
 * that name) still builds a plain text column headed by the field name.
 */
function deriveColumn(name: string, d: any, booleanLabel: BooleanValueLabel): GridColumn {
  const col: GridColumn = {
    name,
    label: d?.label || name,
    type: fieldTypeToColumnType(d?.type),
    required: !!d?.required,
  };
  const options = optionsFor(d, booleanLabel);
  if (col.type === 'select' && options) col.options = options;
  if (col.type === 'lookup') {
    col.reference = d?.reference;
    // The display pointer is read in `@objectstack/spec`'s spelling,
    // `displayField` (objectui#11070 round 6). This read used to be
    // `display_field || reference_field` with no camel leg, so a spec-valid
    // def's `displayField` never reached the column. The `display_field` leg
    // is retired, with no alias: a def served through `ObjectStackAdapter`
    // reaches here with a stored `display_field` already stamped onto
    // `displayField` by the ingestion fold (objectui#7650 ruling A). An
    // external caller of this PUBLIC export that passes an unfolded
    // `childSchema` loses the snake value; the round's changeset states that
    // break. `reference_field` stays behind it: `FieldSchema` declares no
    // twin the fold could stamp it onto. The same read recurs in
    // `hydrateColumns` below.
    col.displayField = d?.displayField || d?.reference_field;
  }
  if (col.type === 'file') applyFileColumnProps(col, d);
  // Field-level CEL conditional rules (B2 in grids). Carried through verbatim
  // so the grid cell evaluates them per row (against the row + `parent`
  // header).
  if (d?.readonlyWhen) col.readonlyWhen = d.readonlyWhen;
  if (d?.requiredWhen) col.requiredWhen = d.requiredWhen;
  // A field carrying an arithmetic `expression` (e.g. amount = quantity *
  // unit_price) becomes a live read-only computed column. The expression may
  // be a bare string or the normalized CEL envelope `{ dialect, source }`.
  const expr = typeof d?.expression === 'string' ? d.expression : d?.expression?.source;
  if (expr && typeof expr === 'string') {
    col.computed = true;
    col.expr = expr;
    col.required = false; // computed → never user-entered, so never required
    if (typeof d?.scale === 'number') col.scale = d.scale;
  }
  return col;
}

/**
 * objectui#10783 — an authored `scale` on a column that renders as `currency`
 * is reported, because the grid does not read it.
 *
 * A currency amount's decimal places are its currency's: `GridField`'s
 * `currencyWidth` takes the resolved currency's ISO 4217 minor unit and never
 * the column's `scale` (ruling B on objectstack-ai/objectstack#19629, ruling 乙
 * on objectstack-ai/objectstack#19910). `@objectstack/spec` 17.5.0 refuses the
 * key on an `inlineColumns` entry that DECLARES `type: 'currency'`, and its own
 * docblock says the reach stops there: an identity-only entry
 * (`{ name: 'amount', scale: 2 }`) takes its type from the child field at
 * render time, here, so it still parses. `objectui validate` cannot see it
 * either: the `object-form` mirror judges a subform's `columns` with the spec's
 * own `InlineGridColumnSchema` (objectui#11266), and the child object's fields
 * are not in the document it judges. Only `defineStack` refuses it, at publish, by resolving
 * `name` against the child object's fields: on a relationship field's
 * `inlineColumns` and on a form view's `subforms[].columns`, and only when the
 * stack declares that child object (objectstack-ai/objectstack#20927). Nothing
 * in objectui does that, and this is the first place in objectui the child
 * field is known, so the report is made here — ⛔ never a silent drop.
 *
 * The declared arm is reported too. On a form view's `subforms[].columns` both
 * validators refuse a typed currency column carrying `scale`: the spec's
 * `FormViewSchema` holds each column to `InlineGridColumnSchema` from 17.6.0,
 * and the `object-form` mirror takes that schema by reference (objectui#11266).
 * Neither runs between a stored or code-built form view and this function, so
 * such a column can still arrive here, and it is reported rather than read in
 * silence.
 *
 * Once per column per page load (the `sectionFields.ts` convention): this runs
 * on every child-schema resolve. The first sentence is the spec's refusal with
 * the same subject; it is a warning, not a refusal, and the column still
 * renders at its currency's minor unit.
 */
const reportedCurrencyColumnScales = new Set<string>();
function reportCurrencyColumnScale(
  col: GridColumn,
  childObject: string | undefined,
  hydrated: boolean,
): void {
  if (col.scale === undefined) return;
  const of = childObject ? ` of '${childObject}'` : '';
  const key = `${childObject ?? ''}:${col.name}:${hydrated ? 'hydrated' : 'declared'}:${String(col.scale)}`;
  if (reportedCurrencyColumnScales.has(key)) return;
  reportedCurrencyColumnScales.add(key);
  const how = hydrated
    ? `takes type 'currency' from child field '${col.name}'${of}`
    : `declares type 'currency'${of}`;
  console.warn(
    `[object-ui] \`scale\` is not valid on a \`currency\` inline grid column — delete the key. ` +
      `Inline grid column '${col.name}' ${how}, so its \`scale: ${String(col.scale)}\` is not read: ` +
      `the currency's ISO 4217 minor unit (2 for USD, 0 for JPY, 3 for KWD) decides how the cell ` +
      `displays the amount and the width a computed amount is rounded to.`,
  );
}

/**
 * Fill in missing widget metadata on author-supplied grid columns from the
 * child object's field definitions. A view often lists columns as bare
 * `{ name, label }` (the common, ergonomic authoring form) — without a `type`
 * those cells fall back to a plain text `<Input>`, so a lookup, date, number or
 * picklist field silently renders as free text. This resolves each such
 * column's `type` (plus `options` / `reference` / computed `expr`) from the
 * schema, exactly as {@link deriveColumns} would, while preserving the author's
 * column set, order and labels. A column that already declares a `type` is left
 * untouched — the author's explicit choice always wins.
 *
 * A column that renders as `currency` and carries an authored `scale`, whether
 * its type is declared or hydrated, is reported by
 * {@link reportCurrencyColumnScale} (objectui#10783): the grid does not read
 * that key.
 *
 * `booleanLabel` is required for the same reason as on {@link deriveColumns}:
 * an untyped column over a `boolean` / `toggle` child field hydrates into a
 * select whose two option labels it draws (objectui#12924).
 */
export function hydrateColumns(
  columns: GridColumn[] | undefined,
  childSchema: ChildObjectSchemaLike | undefined,
  opts: { booleanLabel: BooleanValueLabel },
): GridColumn[] {
  const cols = columns ?? [];
  const fields = childSchema?.fields;
  if (!cols.length || !fields || typeof fields !== 'object') return cols;
  return cols.map((col) => {
    if (col.type) {
      if (col.type === 'currency') reportCurrencyColumnScale(col, childSchema?.name, false);
      return col; // explicit type — respect the author's choice
    }
    const d = (fields as any)[col.name];
    if (!d) return col; // unknown field — leave as-is (grid falls back to text)
    const type = fieldTypeToColumnType(d?.type);
    if (type === 'currency') reportCurrencyColumnScale(col, childSchema?.name, true);
    const next: GridColumn = { ...col, type };
    if (next.label == null) next.label = d?.label || col.name;
    if (next.required == null) next.required = !!d?.required;
    const options = optionsFor(d, opts.booleanLabel);
    if (type === 'select' && options && !next.options) next.options = options;
    if (type === 'lookup') {
      if (next.reference == null) next.reference = d?.reference;
      // The same read as `deriveColumns` above (objectui#11070 round 6).
      if (next.displayField == null) next.displayField = d?.displayField || d?.reference_field;
    }
    if (type === 'file') applyFileColumnProps(next, d);
    if (next.readonlyWhen == null && d?.readonlyWhen) next.readonlyWhen = d.readonlyWhen;
    if (next.requiredWhen == null && d?.requiredWhen) {
      next.requiredWhen = d.requiredWhen;
    }
    const expr = typeof d?.expression === 'string' ? d.expression : d?.expression?.source;
    if (!next.computed && expr && typeof expr === 'string') {
      next.computed = true;
      next.expr = expr;
      next.required = false; // computed → never user-entered, so never required
      if (typeof d?.scale === 'number') next.scale = d.scale;
    }
    return next;
  });
}

/**
 * Field names for a child's full "row form" (the per-row expand editor) — the
 * form an inline master-detail collection opens when its author listed no
 * `formFields`.
 *
 * WHICH fields, in what order, is `@objectstack/spec`'s rule,
 * `deriveInlineRowFormFields` (objectui#11428), the row-form twin of the
 * `deriveInlineGridColumns` rule {@link deriveColumns} reads: it skips system /
 * audit fields, sort-position fields, fields flagged `system` or `hidden`, the
 * computed types, the back-reference FK to the parent and any `exclude`d name,
 * and keeps every other field in the child's field order. So it is broader than
 * the grid: `readonly` fields and the rich types a grid cell omits (textarea,
 * richtext, json, file, …) stay, since the form has room for them. The rule
 * lives in the spec so that an author-time tool (objectstack's
 * `field-no-consumers` lint) credits exactly the fields this form draws.
 *
 * WHETHER a row offers the form at all is the spec's `isInlineRowFormOffered`,
 * which `MasterDetailForm` asks. How each named field renders is the form's own
 * per-field builder, over these names.
 */
export function deriveFormFields(
  childSchema: ChildObjectSchemaLike | undefined,
  opts: { relationshipField?: string; exclude?: string[] } = {},
): string[] {
  return deriveInlineRowFormFields(childSchema, {
    relationshipField: opts.relationshipField,
    exclude: opts.exclude,
  });
}

/** Inline-edit form factor. */
export type InlineMode = 'grid' | 'form';

/** Field types that read poorly in ANY grid cell — a SINGLE one on the child
 *  tips the smart default toward the per-row `form`. (`attachment` is absent by
 *  design: it is not a `@objectstack/spec` field type — the spec media types are
 *  file/image/avatar/video/audio — so the renderer does not model it, #2655.) */
const FORM_ONLY_TYPES = new Set([
  'textarea', 'richtext', 'html', 'markdown', 'rich-text',
  'json', 'location', 'address',
]);

/** File-family types that now render a compact upload cell in the grid (#2360).
 *  A LONE one no longer forces a per-row form — "attach a receipt per line"
 *  stays a grid. They still count toward the rich-field tally, so several piling
 *  up (a cramped row) tips to `form` via {@link RICH_FIELD_FORM_THRESHOLD}. */
const GRID_CAPABLE_RICH_TYPES = new Set(['file', 'image', 'avatar']);

/** Above this many editable business fields, the grid gets cramped → `form`. */
export const SMART_FORM_FIELD_THRESHOLD = 8;

/** When a child has at least this many rich fields (form-only + grid-capable
 *  file-family combined), the row is too busy for a grid → `form`. Set to 2 so a
 *  single file/image column stays a grid but a pile of them prefers the form. */
export const RICH_FIELD_FORM_THRESHOLD = 2;

/**
 * Resolve the inline-edit form factor for a child collection.
 *   - explicit `'grid'` / `'form'` win;
 *   - otherwise (`true` / undefined) pick by the child's shape: a `form` when it
 *     has a truly form-only field, several rich fields
 *     ({@link RICH_FIELD_FORM_THRESHOLD}), or more than
 *     {@link SMART_FORM_FIELD_THRESHOLD} editable business fields; else a `grid`.
 */
export function resolveInlineMode(
  childSchema: ChildObjectSchemaLike | undefined,
  inlineEdit: boolean | InlineMode | undefined,
  opts: { relationshipField?: string } = {},
): InlineMode {
  if (inlineEdit === 'grid' || inlineEdit === 'form') return inlineEdit;
  const fields = (childSchema?.fields ?? {}) as Record<string, any>;
  const names = deriveFormFields(childSchema, { relationshipField: opts.relationshipField });
  // A single truly-form-only field (textarea/richtext/json/…) tips to form.
  const hasFormOnly = names.some((n) => FORM_ONLY_TYPES.has(fields[n]?.type));
  if (hasFormOnly) return 'form';
  // File-family fields render in-grid now, so a lone one stays a grid; only a
  // cluster of rich fields (≥ RICH_FIELD_FORM_THRESHOLD) tips to form (#2654).
  const richCount = names.filter((n) => GRID_CAPABLE_RICH_TYPES.has(fields[n]?.type)).length;
  if (richCount >= RICH_FIELD_FORM_THRESHOLD) return 'form';
  if (names.length > SMART_FORM_FIELD_THRESHOLD) return 'form';
  return 'grid';
}

/** Field names that read as a per-line money total (summed into the footer). */
const AMOUNT_LIKE_FIELDS = ['amount', 'total', 'subtotal', 'line_total', 'line_amount', 'net_amount'];

/**
 * Choose which numeric column feeds the running total. The line total is, in
 * order of preference: a computed numeric column (e.g. amount = qty × price),
 * an `amount`/`total`-named numeric column, the last currency column, then the
 * last numeric column. Preferring the LAST currency over the first stops a
 * grid from accidentally summing `quantity` or `unit_price`.
 */
function pickAmountField(columns: GridColumn[]): string | undefined {
  const numeric = columns.filter((c) => c.type === 'number' || c.type === 'currency');
  if (numeric.length === 0) return undefined;
  const computed = numeric.find((c) => c.computed);
  if (computed) return computed.name;
  const named = numeric.find((c) => AMOUNT_LIKE_FIELDS.includes(c.name));
  if (named) return named.name;
  const lastCurrency = [...numeric].reverse().find((c) => c.type === 'currency');
  if (lastCurrency) return lastCurrency.name;
  return numeric[numeric.length - 1].name;
}

export interface DerivedDetail {
  childObject: string;
  relationshipField: string;
  columns: GridColumn[];
  /** Field names for the per-row expand form (broader than `columns`). */
  formFields: string[];
  /** Inline-edit form factor (grid = editable cells; form = list + per-row form). */
  mode: InlineMode;
  /** First numeric column, used as the running-total source when none is set. */
  amountField?: string;
  /** Child field holding the line sort position, if any — the grid stamps it on
   *  drag-reorder so order persists (excluded from the editable columns). */
  sortField?: string;
}

/**
 * Resolve a child collection's full config (FK + columns) from its object
 * schema. Throws when no relationship to the parent can be found. The caller
 * supplies any explicit overrides (relationshipField / columns / amountField),
 * which win over the derived values, and the required `booleanLabel`, which
 * is not an override: it draws a `boolean` / `toggle` column's two option
 * labels in the session language (objectui#12924, see {@link deriveColumns}).
 */
export function deriveDetail(
  childObject: string,
  childSchema: ChildObjectSchemaLike | undefined,
  parentObjectName: string,
  override: {
    booleanLabel: BooleanValueLabel;
    relationshipField?: string;
    columns?: GridColumn[];
    amountField?: string;
    inlineEdit?: boolean | InlineMode;
  },
): DerivedDetail {
  const relationshipField = override.relationshipField || findRelationshipField(childSchema, parentObjectName);
  if (!relationshipField) {
    throw new Error(
      `MasterDetailForm: could not find a lookup/master_detail field on "${childObject}" referencing "${parentObjectName}". ` +
      `Set relationshipField explicitly.`,
    );
  }
  const { booleanLabel } = override;
  const columns = override.columns?.length
    ? hydrateColumns(override.columns, childSchema, { booleanLabel })
    : deriveColumns(childSchema, { relationshipField, booleanLabel });
  const amountField = override.amountField || pickAmountField(columns);
  const formFields = deriveFormFields(childSchema, { relationshipField });
  // Resolve mode from the explicit override, else the relationship field's
  // `inlineEdit` value, else the smart default from the child's shape.
  const inlineEdit = override.inlineEdit ?? (childSchema?.fields as any)?.[relationshipField]?.inlineEdit;
  const mode = resolveInlineMode(childSchema, inlineEdit, { relationshipField });
  const sortField = Object.keys(childSchema?.fields ?? {}).find((n) => SORT_FIELD_NAMES.has(n));
  return { childObject, relationshipField, columns, formFields, mode, amountField, sortField };
}
