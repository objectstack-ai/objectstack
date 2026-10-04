// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Default inline-grid columns — the single source of WHICH child fields an
 * inline master-detail grid draws when its author listed no columns, and of
 * which fields its per-row expand form draws when its author listed none.
 *
 * Two carriers draw a grid of a child object's records inside the parent's
 * form, and both say "derived from the child object when omitted":
 *
 *   - a child relationship field that sets `inlineEdit`, with no
 *     `inlineColumns` (`FieldSchema.inlineColumns`);
 *   - a form view's `subforms[]` entry with no `columns`
 *     (`FormViewSchema.subforms`).
 *
 * The derivation used to live only in the renderer (objectui's
 * `deriveColumns`), so no author-time tool could ask what such a grid draws:
 * `field-no-consumers` reported every derived column's field as inert. This
 * module is that rule promoted to the protocol, the same move
 * `deriveFieldGroupLayout` made for `fieldGroups` (ADR-0085 §5): a pure,
 * dependency-free helper the renderer consumes and the lint credits from, so
 * the two cannot disagree about what a grid draws.
 *
 * ## The rule, reproduced exactly
 *
 * Measured against objectui `main` at `be5211522412`
 * (`packages/plugin-form/src/deriveMasterDetail.ts`, `deriveColumns` and its
 * `curateColumns`). Every child field, in the field map's own order, except:
 *
 *   - a name in {@link INLINE_GRID_SYSTEM_FIELDS} (identity, audit, tenancy and
 *     ownership columns) or {@link INLINE_GRID_SORT_FIELDS} (a line's sort
 *     position: the grid stamps it on drag-reorder instead);
 *   - the relationship field back to the parent, and any name in `exclude`;
 *   - a field flagged `system`, `readonly` or `hidden`;
 *   - a field whose `type` is in {@link INLINE_GRID_NON_EDITABLE_TYPES}.
 *
 * NOTHING is dropped by the column budget. Past `maxColumns` (default
 * {@link DEFAULT_MAX_INLINE_GRID_COLUMNS}) the overflow is marked
 * `defaultHidden`, which collapses it into the grid's column chooser: the
 * column is still drawn on demand. The visible set keeps the first name-like
 * column (else the first column) and every required column, then fills by the
 * cell type's usefulness, ties broken by field order.
 *
 * Some type names in the sets below are not `FieldType` members (`rollup`,
 * `auto_number`, `picklist`, …). They are the renderer's own legacy
 * tolerances, carried so the derivation agrees with it on every input — a
 * spec-valid field never carries them, so they change no answer for one.
 *
 * ## What it returns, and what it does not
 *
 * Each entry is an identity-only inline grid column — `{ name }`, plus
 * `defaultHidden: true` on the overflow — which is a valid `inlineColumns`
 * entry in its own right. The label, cell type, options, lookup target,
 * conditional rules and computed expression are NOT derived here: the
 * renderer hydrates them from the child field, exactly as it hydrates an
 * identity-only column an author wrote. So the derived list is precisely the
 * `inlineColumns` an author could have written to draw the same grid.
 *
 * ## The per-row expand form ({@link deriveInlineRowFormFields})
 *
 * Each row of the grid can open a full form for that row, and that form draws
 * more than the grid: it has room for the rich inputs a cell cannot hold. Its
 * fields are derived from the child object too, by a broader rule — measured
 * against objectui at the `.objectui-sha` pin `31971ff1e28f`
 * (`packages/plugin-form/src/deriveMasterDetail.ts`, `deriveFormFields`).
 * Every child field, in the field map's own order, except:
 *
 *   - a name in {@link INLINE_GRID_SYSTEM_FIELDS} or
 *     {@link INLINE_GRID_SORT_FIELDS} — the same two sets the grid skips;
 *   - the relationship field back to the parent, and any name in `exclude`;
 *   - a field flagged `system` or `hidden` — NOT `readonly`: the form shows a
 *     read-only value, where a cell would only waste the width;
 *   - a field whose `type` is in {@link INLINE_ROW_FORM_NON_INPUT_TYPES}, the
 *     computed types nobody types into. `richtext`, `json`, `markdown` and the
 *     other types a cell cannot edit stay in.
 *
 * Every type the form skips the grid skips too, so with the same
 * `relationshipField` and `exclude`, the derived grid's columns are always a
 * subset of the derived form's fields.
 *
 * The form is not always offered ({@link isInlineRowFormOffered}). Measured in
 * the same pin's `MasterDetailForm.tsx`, it is offered when it adds something:
 * always when the collection's form factor is `form` (the row form IS the
 * editor there), and otherwise only when the form has more fields than the
 * grid has columns. A thin grid whose columns already cover every field shows
 * no expand control.
 */

// The sort-position names live in their own module, reached by relative
// import only: the retired `object-master-detail-form` detail entry
// `sortField`'s prescription prints the same list (`ui/component.zod.ts`).
import { INLINE_GRID_SORT_FIELDS } from './inline-grid-sort-fields';

/** Default-visible column budget of a derived inline grid; the rest are `defaultHidden`. */
export const DEFAULT_MAX_INLINE_GRID_COLUMNS = 6;

/** One derived column: identity-only, as an author would write it in `inlineColumns`. */
export interface DerivedInlineGridColumn {
  /** The child field the column draws. */
  name: string;
  /** Present (and `true`) only on a column past the visible budget: collapsed into the column chooser, never dropped. */
  defaultHidden?: true;
}

type AnyRec = Record<string, unknown>;

/** Identity, audit, tenancy and ownership columns — never an editable line-item column. */
const INLINE_GRID_SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  'id', '_id', 'recordId',
  'created_at', 'updated_at', 'created_by', 'updated_by',
  'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
  'organization_id', 'tenant_id', 'space', 'owner',
]);

/** Field types a line-item cell cannot edit. File-family types are absent: they render an upload cell. */
const INLINE_GRID_NON_EDITABLE_TYPES: ReadonlySet<unknown> = new Set([
  'formula', 'summary', 'rollup', 'autonumber', 'auto_number',
  'json', 'object', 'grid', 'table',
  'location', 'vector', 'html', 'markdown', 'richtext',
]);

/** Field names that read as a record's primary column — kept visible first. */
const NAME_LIKE_FIELDS: readonly string[] = ['name', 'title', 'subject', 'label', 'full_name', 'display_name', 'code'];

/**
 * The cell a field type renders as, which is all the budget's fill order
 * needs. It mirrors the renderer's field-type → cell-type map; the cell
 * types are `InlineGridColumnSchema.type`'s members.
 */
function cellTypeOf(type: unknown): string {
  switch (type) {
    case 'number':
    case 'percent':
    case 'rating':
    case 'slider':
      return 'number';
    case 'currency':
      return 'currency';
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

/** Lower is kept first when filling the visible budget; a cell type absent here sorts last (5). */
const CELL_FILL_PRIORITY: Readonly<Record<string, number>> = {
  select: 0,
  currency: 1,
  number: 1,
  lookup: 2,
  date: 3,
  datetime: 3,
  time: 3,
  text: 4,
};

/** A field's own key, read the way the renderer reads `def?.key` off an untyped bag. */
function prop(def: unknown, key: string): unknown {
  return def === null || def === undefined ? undefined : (def as AnyRec)[key];
}

/** A field carrying an arithmetic `expression` (bare string, or a CEL envelope's `source`) is a computed column. */
function isComputed(def: unknown): boolean {
  const expression = prop(def, 'expression');
  const source = typeof expression === 'string' ? expression : prop(expression, 'source');
  return typeof source === 'string' && source.length > 0;
}

interface Candidate {
  name: string;
  priority: number;
  required: boolean;
}

/**
 * Derive the default columns of an inline master-detail grid from the child
 * object's definition (or any bare record shaped like one: `{ fields }` with
 * the field map the spec declares).
 *
 * `relationshipField` is the child's field back to the parent — excluded,
 * since the grid fills it in. `exclude` drops further names. `maxColumns` is
 * the visible budget; `0` (or less) marks no column hidden.
 *
 * Returns `[]` when the definition carries no field map.
 */
export function deriveInlineGridColumns(
  def: unknown,
  opts: { relationshipField?: string; exclude?: readonly string[]; maxColumns?: number } = {},
): DerivedInlineGridColumn[] {
  const fields = prop(def, 'fields');
  if (!fields || typeof fields !== 'object') return [];
  const exclude = new Set<string>([...(opts.exclude ?? []), ...(opts.relationshipField ? [opts.relationshipField] : [])]);

  const candidates: Candidate[] = [];
  for (const [name, field] of Object.entries(fields as AnyRec)) {
    if (INLINE_GRID_SYSTEM_FIELDS.has(name) || exclude.has(name) || INLINE_GRID_SORT_FIELDS.has(name)) continue;
    if (prop(field, 'system') || prop(field, 'readonly') || prop(field, 'hidden')) continue;
    if (INLINE_GRID_NON_EDITABLE_TYPES.has(prop(field, 'type'))) continue;
    candidates.push({
      name,
      priority: CELL_FILL_PRIORITY[cellTypeOf(prop(field, 'type'))] ?? 5,
      // A computed column is never user-entered, so never required.
      required: !!prop(field, 'required') && !isComputed(field),
    });
  }

  const max = opts.maxColumns ?? DEFAULT_MAX_INLINE_GRID_COLUMNS;
  if (max <= 0 || candidates.length <= max) return candidates.map(({ name }) => ({ name }));

  const visible = new Set<string>();
  const primary = candidates.find((c) => NAME_LIKE_FIELDS.includes(c.name)) ?? candidates[0];
  if (primary) visible.add(primary.name);
  for (const c of candidates) if (c.required) visible.add(c.name);
  const remaining = candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !visible.has(c.name))
    .sort((a, b) => a.c.priority - b.c.priority || a.i - b.i);
  for (const { c } of remaining) {
    if (visible.size >= max) break;
    visible.add(c.name);
  }
  return candidates.map(({ name }) => (visible.has(name) ? { name } : { name, defaultHidden: true }));
}

/**
 * Field types the per-row expand form leaves out: the computed, server-derived
 * values nobody types. Narrower than {@link INLINE_GRID_NON_EDITABLE_TYPES} —
 * the form has room for the rich inputs a cell cannot hold. As there, the
 * names that are not `FieldType` members are the renderer's legacy tolerances.
 */
const INLINE_ROW_FORM_NON_INPUT_TYPES: ReadonlySet<unknown> = new Set([
  'formula', 'summary', 'rollup', 'autonumber', 'auto_number',
]);

/**
 * Derive the fields of an inline master-detail grid's per-row expand form
 * from the child object's definition (or any bare record shaped like one:
 * `{ fields }` with the field map the spec declares). The rule is in the
 * module note; the renderer offers the form only when
 * {@link isInlineRowFormOffered} says so.
 *
 * `relationshipField` is the child's field back to the parent — excluded, as
 * in {@link deriveInlineGridColumns}. `exclude` drops further names.
 *
 * Returns `[]` when the definition carries no field map.
 */
export function deriveInlineRowFormFields(
  def: unknown,
  opts: { relationshipField?: string; exclude?: readonly string[] } = {},
): string[] {
  const fields = prop(def, 'fields');
  if (!fields || typeof fields !== 'object') return [];
  const exclude = new Set<string>([...(opts.exclude ?? []), ...(opts.relationshipField ? [opts.relationshipField] : [])]);

  const out: string[] = [];
  for (const [name, field] of Object.entries(fields as AnyRec)) {
    if (INLINE_GRID_SYSTEM_FIELDS.has(name) || exclude.has(name) || INLINE_GRID_SORT_FIELDS.has(name)) continue;
    if (prop(field, 'system') || prop(field, 'hidden')) continue;
    if (INLINE_ROW_FORM_NON_INPUT_TYPES.has(prop(field, 'type'))) continue;
    out.push(name);
  }
  return out;
}

/**
 * Whether an inline child collection offers its per-row expand form: always
 * when its form factor is `form`, else only when the form has more fields
 * than the grid has columns.
 *
 * `inlineMode` is the collection's RESOLVED form factor (`grid` / `form`), as
 * the renderer resolved it. `formFields` and `columns` are the lists the
 * collection draws, authored or derived; only their lengths are read.
 */
export function isInlineRowFormOffered(opts: {
  inlineMode?: 'grid' | 'form';
  formFields?: readonly unknown[];
  columns?: readonly unknown[];
}): boolean {
  return opts.inlineMode === 'form' || (opts.formFields?.length ?? 0) > (opts.columns?.length ?? 0);
}
