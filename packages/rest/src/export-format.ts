/**
 * Type-aware value formatting for the streaming data export route
 * (`GET /data/:object/export`).
 *
 * The raw rows returned by `findData` carry *storage* values: lookup / user
 * fields hold ids (or, when `$expand`-ed, nested records), select fields hold
 * option codes, booleans hold true/false, dates hold ISO strings. None of those
 * read well in a spreadsheet. These helpers turn each value into a human
 * readable cell using the object's field metadata.
 *
 * Contract: when no field metadata is available (schema lookup failed or carried
 * no fields) every helper is a pass-through, so the export stays byte-for-byte
 * identical to the un-formatted behaviour.
 */

export interface ExportFieldMeta {
  name: string;
  type?: string;
  label?: string;
  options?: Array<{ label?: string; value?: unknown; color?: string }>;
  /** Target object for lookup / master_detail / user fields. */
  reference?: string;
  /** Field on the referenced record to show as its label. */
  displayField?: string;
}

/** Field types whose stored value points at another record. */
const REFERENCE_TYPES = new Set(['lookup', 'master_detail', 'user', 'reference', 'tree']);

/** Field types whose stored value maps to a static option label. */
const OPTION_TYPES = new Set(['select', 'radio']);
const MULTI_OPTION_TYPES = new Set(['multiselect', 'checkboxes', 'tags']);

/**
 * Keys tried, in order, to derive a referenced record's display value when the
 * field carries no explicit `displayField`.
 */
const NAME_KEY_FALLBACKS = [
  'name', 'title', 'label', 'full_name', 'fullName', 'display_name', 'username', 'email',
];

/**
 * Build a field-name → metadata map from an object schema (best-effort).
 *
 * Accepts both shapes `fields` appears in across the stack: the runtime
 * `ObjectSchema.fields` is a `Record<fieldName, FieldDefinition>` object map
 * (the form served by the engine registry / `getMetaItem`), while some callers
 * and fixtures hand back a plain `FieldDefinition[]` array. A field's name is
 * taken from its own `name`, falling back to the map key.
 */
export function buildFieldMetaMap(schema: unknown): Map<string, ExportFieldMeta> {
  const map = new Map<string, ExportFieldMeta>();
  const fields = (schema as { fields?: unknown })?.fields;

  // Normalize either shape to a list of [name, definition] entries.
  let entries: Array<[string, any]>;
  if (Array.isArray(fields)) {
    entries = fields
      .filter((f) => f && typeof f === 'object')
      .map((f) => [typeof f.name === 'string' ? f.name : '', f] as [string, any]);
  } else if (fields && typeof fields === 'object') {
    entries = Object.entries(fields as Record<string, any>).map(
      ([key, def]) => [
        def && typeof def === 'object' && typeof def.name === 'string' ? def.name : key,
        def,
      ] as [string, any],
    );
  } else {
    return map;
  }

  for (const [name, f] of entries) {
    if (!name || !f || typeof f !== 'object') continue;
    map.set(name, {
      name,
      type: typeof f.type === 'string' ? f.type : undefined,
      label: typeof f.label === 'string' ? f.label : undefined,
      options: Array.isArray(f.options) ? f.options : undefined,
      reference: typeof f.reference === 'string' ? f.reference : undefined,
      displayField: typeof f.displayField === 'string' ? f.displayField : undefined,
    });
  }
  return map;
}

/**
 * Reference-typed field names that should be `$expand`-ed so their stored ids
 * resolve to the referenced record (and thus to a readable name).
 */
export function referenceFieldNames(metaMap: Map<string, ExportFieldMeta>): string[] {
  const out: string[] = [];
  for (const meta of metaMap.values()) {
    if (meta.type && REFERENCE_TYPES.has(meta.type) && meta.reference) out.push(meta.name);
  }
  return out;
}

/** Header label for a column: schema label when present, else the field name. */
export function headerLabel(field: string, metaMap: Map<string, ExportFieldMeta>): string {
  return metaMap.get(field)?.label || field;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' || typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** `YYYY-MM-DD` (date) or `YYYY-MM-DD HH:mm:ss` (datetime), in UTC. */
function formatDate(value: unknown, withTime: boolean): unknown {
  const d = toDate(value);
  if (!d) return value;
  const ymd = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  if (!withTime) return ymd;
  return `${ymd} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function optionLabel(value: unknown, options?: Array<{ label?: string; value?: unknown }>): unknown {
  if (!options) return value;
  const hit = options.find((o) => o && o.value === value);
  return hit?.label ?? value;
}

/**
 * Normalize a CSS-ish hex color to exceljs' 8-digit ARGB (`FFRRGGBB`, opaque).
 * Accepts `#RGB` / `#RRGGBB` with or without the leading `#`, any case.
 * Returns `undefined` for anything else (empty, named colors, rgb(), garbage)
 * so callers simply skip styling rather than emit an invalid workbook.
 */
export function toArgb(color: unknown): string | undefined {
  if (typeof color !== 'string') return undefined;
  const hex = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const [r, g, b] = hex;
    return `FF${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `FF${hex}`.toUpperCase();
  return undefined;
}

/**
 * Font color (exceljs ARGB) for one cell, driven by the matched select/radio
 * option's `color`. Returns `undefined` when the field is not option-typed, no
 * option matches, the option has no color, or the color is not a valid hex —
 * i.e. whenever the cell should stay unstyled.
 */
export function cellFontColor(value: unknown, meta?: ExportFieldMeta): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (!meta || !meta.type || !OPTION_TYPES.has(meta.type) || !meta.options) return undefined;
  const hit = meta.options.find((o) => o && o.value === value);
  return toArgb(hit?.color);
}

function displayFromRecord(rec: Record<string, unknown>, displayField?: string): string {
  if (displayField && rec[displayField] != null) return String(rec[displayField]);
  for (const k of NAME_KEY_FALLBACKS) {
    const v = rec[k];
    if (v != null && typeof v !== 'object') return String(v);
  }
  if (rec.id != null) return String(rec.id);
  try { return JSON.stringify(rec); } catch { return String(rec); }
}

function formatReference(value: unknown, displayField?: string): unknown {
  const one = (v: unknown): unknown =>
    v && typeof v === 'object' ? displayFromRecord(v as Record<string, unknown>, displayField) : v;
  if (Array.isArray(value)) return value.map(one).join(', ');
  return one(value);
}

/** Format one storage value into a display value using its field metadata. */
export function formatCellValue(value: unknown, meta?: ExportFieldMeta): unknown {
  if (value === null || value === undefined) return value;
  if (!meta || !meta.type) return value;
  const t = meta.type;
  if (t === 'boolean' || t === 'toggle') {
    if (value === true || value === 'true' || value === 1) return '是';
    if (value === false || value === 'false' || value === 0) return '否';
    return value;
  }
  if (OPTION_TYPES.has(t)) return optionLabel(value, meta.options);
  if (MULTI_OPTION_TYPES.has(t)) {
    const arr = Array.isArray(value) ? value : [value];
    return arr.map((v) => optionLabel(v, meta.options)).join(', ');
  }
  if (t === 'date') return formatDate(value, false);
  if (t === 'datetime') return formatDate(value, true);
  if (REFERENCE_TYPES.has(t)) return formatReference(value, meta.displayField);
  return value;
}

/** Ordered display cells for one row — the CSV / XLSX column path. */
export function formatRowCells(
  row: Record<string, unknown>,
  fields: string[],
  metaMap: Map<string, ExportFieldMeta>,
): unknown[] {
  return fields.map((f) => formatCellValue(row?.[f], metaMap.get(f)));
}

/**
 * Format a row for JSON output: readable values for known fields, every other
 * key left untouched. Returns the original object reference when nothing needs
 * formatting so the stream stays byte-identical to the un-formatted path.
 */
export function formatRowForJson(
  row: Record<string, unknown>,
  metaMap: Map<string, ExportFieldMeta>,
): Record<string, unknown> {
  if (metaMap.size === 0 || !row || typeof row !== 'object') return row;
  let copy: Record<string, unknown> | null = null;
  for (const key of Object.keys(row)) {
    const meta = metaMap.get(key);
    if (!meta) continue;
    const formatted = formatCellValue(row[key], meta);
    if (formatted !== row[key]) {
      if (!copy) copy = { ...row };
      copy[key] = formatted;
    }
  }
  return copy ?? row;
}
