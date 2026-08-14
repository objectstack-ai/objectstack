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
 *
 * Second contract, on the clock (#8373): a `datetime` cell renders in the
 * request's business timezone — the `timezone` the route's already-resolved
 * `ExecutionContext` carries — and falls back to UTC when there is none, which
 * is byte-identical to the pre-#8373 output. A `date` cell is a timezone-naive
 * calendar day and never reads it (ADR-0053). See {@link formatDate}.
 *
 * Third contract, same clock, OPPOSITE fallback (#8484): the download
 * filename's timestamp reads that same business timezone, so the name a
 * browser saves agrees with the rows inside the file. Its no-timezone fallback
 * is the PROCESS-LOCAL clock, not UTC — see {@link exportContentDisposition}
 * for why the two contracts deliberately differ, and {@link zonedWallClock}
 * for where that choice is left to each caller.
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
  /** Field holds multiple values (an array), e.g. a `multiple: true` lookup. */
  multiple?: boolean;
  // Every key above is a PRESENTATION key: each one is read to turn a storage
  // value into a readable cell (or a readable cell back into a storage value).
  //
  // ── retired: the eight constraint keys (#6536) ──────────────────────
  //
  // `required` / `system` / `readonly` / `hasDefault` / `min` / `max` /
  // `minLength` / `maxLength` used to sit here. They were added for the import
  // dry run's hand-copied pre-check mirror (`firstMissingRequiredField` /
  // `firstConstraintViolation`, framework#3956); #4633 ruling D retired that
  // mirror (PR #6532) — the dry run now asks the engine for its verdict through
  // `DataProtocol.validateData`, which reads the object's own schema. That left
  // all eight computed on every import and read by nothing, so ADR-0049
  // enforce-or-remove retires them rather than leaving a constraint vocabulary
  // standing next to the presentation one with no enforcer behind it.
  //
  // They were never a source of truth: `buildFieldMetaMap` derived each one
  // from the very `schema` its caller passed in, so a caller that wants a
  // field's constraints reads them off that schema (`fields[name].required`, …)
  // — the same place the engine reads them.
}

/**
 * Build the `Content-Disposition` header for an export download.
 *
 * The suggested filename is `<label>-<YYYYMMDD>-<HHMMSS>.<ext>` where the
 * label is the object's (locale-translated) display label — so a browser
 * saves e.g. `合同-20260714-153045.xlsx` instead of `contracts-2026-07-14.xlsx`.
 * Non-ASCII labels ride the RFC 5987/6266 `filename*` parameter; the plain
 * `filename` keeps an ASCII-safe fallback derived from the object API name
 * for clients that don't understand `filename*`.
 *
 * **The stamp's clock (#8484).** `timezone` is the request's business timezone
 * (`ExecutionContext.timezone`, the platform-default → global → tenant
 * cascade) — the SAME value the cells are rendered in. Before #8373 both the
 * name and the contents were wrong in different directions; #8373 moved the
 * contents onto the business zone and left this the last export surface on the
 * host clock, so a container at `TZ=UTC` serving an Asia/Shanghai tenant
 * downloaded `orders-20260731-220000.csv` whose first row read
 * `2026-08-01 06:00:00`. Reading one clock for both is the whole point.
 *
 * **⚠️ The no-timezone fallback is PROCESS-LOCAL, not UTC — deliberately the
 * opposite of {@link formatDate}'s.** Each fallback preserves ITS OWN surface's
 * historical output, and the two surfaces have different histories: the cells
 * were hardcoded to UTC, this filename has always used the process clock. UTC
 * here would look like the "safe default" and would in fact re-time the
 * filename of every deployment that sets a host `TZ` but resolves no business
 * timezone — a silent change to a user-visible name, for zero correctness gain.
 * A deployment that explicitly resolves `'UTC'` is a resolved zone, not a
 * missing one, and does get UTC.
 */
export function exportContentDisposition(
  objectName: string,
  label: string | undefined,
  ext: string,
  timezone?: string,
  now: Date = new Date(),
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const zoned = zonedWallClock(now, timezone);
  const stamp = zoned
    ? `${zoned.ymd.replace(/-/g, '')}-${zoned.hms.replace(/:/g, '')}`
    : `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const asciiBase = objectName.replace(/[^A-Za-z0-9_.-]/g, '_') || 'export';
  // Keep unicode letters (CJK labels) but drop filesystem-hostile characters.
  // eslint-disable-next-line no-control-regex
  const utf8Base = String(label ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .slice(0, 80) || asciiBase;
  const asciiName = `${asciiBase}-${stamp}.${ext}`;
  const utf8Name = `${utf8Base}-${stamp}.${ext}`;
  // RFC 5987 pct-encoding: encodeURIComponent leaves `'()*` unescaped but
  // they are not attr-chars, so escape them explicitly.
  const encoded = encodeURIComponent(utf8Name)
    .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
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
      multiple: f.multiple === true,
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

/**
 * `Intl.DateTimeFormat` instances keyed by IANA zone, with `null` memoizing a
 * zone the platform rejected. A 50k-row export formats one cell per datetime
 * column per row, so constructing a formatter per cell is the difference
 * between a stream and a stall; the key set is bounded by the deployment's
 * configured zones.
 */
const ZONED_FORMATTERS = new Map<string, Intl.DateTimeFormat | null>();

function zonedFormatter(timezone: string): Intl.DateTimeFormat | null {
  const cached = ZONED_FORMATTERS.get(timezone);
  if (cached !== undefined) return cached;
  let fmt: Intl.DateTimeFormat | null = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      // `h23` (not `hour12: false`) — midnight must read `00`, never `24`.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    fmt = null; // not a valid IANA zone → callers fall back to UTC
  }
  ZONED_FORMATTERS.set(timezone, fmt);
  return fmt;
}

/** The UTC wall clock of an instant — `YYYY-MM-DD` + `HH:mm:ss`. */
function utcWallClock(d: Date): { ymd: string; hms: string } {
  return {
    ymd: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    hms: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`,
  };
}

/**
 * The wall clock an instant shows in `timezone`, or **`null` when there is no
 * usable zone** — `timezone` absent, or not a zone this platform knows.
 *
 * Reads the calendar components from `Intl.DateTimeFormat().formatToParts()`
 * so DST transitions come from the platform's tz database rather than
 * hand-rolled offset arithmetic (the same primitive `@objectstack/core`'s
 * `calendarPartsInTz` and `@objectstack/spec`'s autonumber date tokens use).
 *
 * WHY THIS RETURNS `null` INSTEAD OF FALLING BACK: its two callers need
 * OPPOSITE fallbacks, and that difference is a contract rather than a detail.
 * The cell path ({@link formatDate}) falls back to UTC — its pre-#8373 output;
 * the filename stamp ({@link exportContentDisposition}) falls back to the
 * process-local clock — its own pre-#8484 output. Each preserves the history of
 * the surface it serves. Baking either one in here would silently re-time the
 * other surface for every deployment that resolves no business timezone, so the
 * choice is left at each call site where it can be read and pinned.
 *
 * `'UTC'` is a RESOLVED zone, not a missing one, so it yields UTC parts rather
 * than `null`: a deployment that configures UTC gets UTC on both surfaces
 * whatever the host `TZ` says.
 */
function zonedWallClock(d: Date, timezone?: string): { ymd: string; hms: string } | null {
  if (!timezone) return null;
  if (timezone === 'UTC') return utcWallClock(d);
  const fmt = zonedFormatter(timezone);
  if (!fmt) return null;
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  const y = get('year');
  const mo = get('month');
  const da = get('day');
  const h = get('hour');
  const mi = get('minute');
  const s = get('second');
  if (!(y && mo && da && h && mi && s)) return null;
  return { ymd: `${y}-${mo}-${da}`, hms: `${h}:${mi}:${s}` };
}

/**
 * The wall clock an instant shows in `timezone`, falling back to UTC whenever
 * `timezone` is absent, `'UTC'`, or not a zone this platform knows — the
 * pre-#8373 behaviour, kept as the backward-compatibility contract for
 * deployments that never set one. See {@link zonedWallClock} for why the
 * fallback lives here rather than inside it.
 */
function wallClock(d: Date, timezone?: string): { ymd: string; hms: string } {
  return zonedWallClock(d, timezone) ?? utcWallClock(d);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' || typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * `YYYY-MM-DD` (date) or `YYYY-MM-DD HH:mm:ss` (datetime).
 *
 * The two branches read DIFFERENT clocks, because ADR-0053 gives the two field
 * types different meanings:
 *
 * - **`datetime` is an instant**, rendered in a reference timezone — so it is
 *   rendered here in the caller's business timezone (`ExecutionContext.timezone`,
 *   the platform-default → global → tenant cascade), matching what the UI shows.
 *   Before #8373 this was hardcoded to UTC while the UI rendered the business
 *   zone, so an export of `2026-08-01 06:00 +08` read `2026-07-31 22:00` — a
 *   row that crossed a day boundary crossed a MONTH boundary with it, and a
 *   downstream monthly reconciliation stopped balancing. `getUTC*` ignores the
 *   process `TZ`, so there was no deployment-side workaround either.
 * - **`date` is a timezone-naive calendar day** — never re-projected into a
 *   zone. `@objectstack/driver-sql`'s `toDateOnly` is the single source of
 *   truth for what a `date` *is* (`YYYY-MM-DD`, a `Date` collapsed on its UTC
 *   calendar day) and the filter/write/read paths all agree with it. Passing a
 *   date-only value through a zone would shift `2026-08-01` to `2026-07-31` for
 *   every deployment west of UTC — inventing the very off-by-one-day defect
 *   ADR-0053 removed. So this branch is deliberately unchanged.
 *
 * `timezone` absent (or unknown to the platform) ⇒ UTC, i.e. exactly the
 * pre-#8373 output.
 */
function formatDate(value: unknown, withTime: boolean, timezone?: string): unknown {
  const d = toDate(value);
  if (!d) return value;
  if (!withTime) {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const { ymd, hms } = wallClock(d, timezone);
  return `${ymd} ${hms}`;
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

/**
 * Format one storage value into a display value using its field metadata.
 *
 * `timezone` is the request's business timezone (`ExecutionContext.timezone`).
 * It reaches only the `datetime` branch; absent, the cell renders in UTC —
 * see {@link formatDate} for why `date` never reads it at all.
 */
export function formatCellValue(
  value: unknown,
  meta?: ExportFieldMeta,
  timezone?: string,
): unknown {
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
  if (t === 'datetime') return formatDate(value, true, timezone);
  if (REFERENCE_TYPES.has(t)) return formatReference(value, meta.displayField);
  return value;
}

/**
 * Ordered display cells for one row — the CSV / XLSX column path.
 *
 * `timezone` is threaded straight through to {@link formatCellValue}; the
 * export route reads it off the `ExecutionContext` it already resolved.
 */
export function formatRowCells(
  row: Record<string, unknown>,
  fields: string[],
  metaMap: Map<string, ExportFieldMeta>,
  timezone?: string,
): unknown[] {
  return fields.map((f) => formatCellValue(row?.[f], metaMap.get(f), timezone));
}

/**
 * Format a row for JSON output: readable values for known fields, every other
 * key left untouched. Returns the original object reference when nothing needs
 * formatting so the stream stays byte-identical to the un-formatted path.
 */
export function formatRowForJson(
  row: Record<string, unknown>,
  metaMap: Map<string, ExportFieldMeta>,
  timezone?: string,
): Record<string, unknown> {
  if (metaMap.size === 0 || !row || typeof row !== 'object') return row;
  let copy: Record<string, unknown> | null = null;
  for (const key of Object.keys(row)) {
    const meta = metaMap.get(key);
    if (!meta) continue;
    const formatted = formatCellValue(row[key], meta, timezone);
    if (formatted !== row[key]) {
      if (!copy) copy = { ...row };
      copy[key] = formatted;
    }
  }
  return copy ?? row;
}
