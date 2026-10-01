// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Default inline-grid columns — the single source of WHICH child fields an
 * inline master-detail grid draws when its author listed no columns.
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
 */

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

/** Field names that hold a line's sort position: the grid stamps them on drag-reorder. */
const INLINE_GRID_SORT_FIELDS: ReadonlySet<string> = new Set([
  'position', 'sort_order', 'sequence', 'line_no', 'line_number', 'sort',
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
