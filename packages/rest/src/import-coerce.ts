/**
 * Type-aware value *coercion* for the bulk-import route
 * (`POST /data/:object/import`).
 *
 * This is the inverse of `export-format.ts`. A spreadsheet / CSV cell arrives as
 * a raw string (or, for JSON payloads, an arbitrary primitive); the storage
 * layer, on the other hand, expects *storage* values — booleans as real
 * booleans, numbers as numbers, dates as ISO strings, select fields as their
 * option **code** (not the human label), and lookup / user fields as the
 * referenced record **id** (not its name). The engine deliberately does not
 * coerce for storage (see `record-validator.ts`, which coerces only to *check*
 * a value and then discards the coerced form), so import has to do it here.
 *
 * The accepted storage shapes below are dictated by what
 * `validateFieldValue` in `packages/objectql` will accept:
 *   - number / currency / percent / rating / slider → a finite `number`
 *   - boolean / toggle                              → a real `boolean`
 *   - date / datetime                               → an ISO-8601 string
 *   - time                                          → `HH:MM` / `HH:MM:SS`
 *   - select / radio                                → an option *value*
 *   - multiselect / checkboxes / tags               → an array of option values
 *   - lookup / master_detail / user / reference     → a record id (resolved async)
 *   - file / image                                  → a file id / url (as-is)
 *
 * Any of the last four whose field is flagged `multiple: true` (per the spec,
 * `multiple` applies to select / lookup / file / image; `radio`/`user` share
 * their branch) instead store an **array** — the cell is split on the export
 * separator and each token coerced individually. See `isMultiValueField`.
 *
 * Contract: when a field carries no usable metadata the value passes through
 * untouched, so an import stays byte-identical to the pre-coercion behaviour.
 */

import type { ExportFieldMeta } from './export-format.js';

/** Field types whose stored value points at another record (id). */
const REFERENCE_TYPES = new Set(['lookup', 'master_detail', 'user', 'reference', 'tree']);
/** Single-select option types (store one option value). */
const OPTION_TYPES = new Set(['select', 'radio']);
/** Multi-select option types (store an array of option values). */
const MULTI_OPTION_TYPES = new Set(['multiselect', 'checkboxes', 'tags']);
/** Numeric field types (store a finite number). */
const NUMBER_TYPES = new Set(['number', 'currency', 'percent', 'rating', 'slider']);
/** Boolean field types (store a real boolean). */
const BOOL_TYPES = new Set(['boolean', 'toggle']);
/** Attachment field types (store a file id / url, or an array when `multiple`). */
const FILE_TYPES = new Set(['file', 'image']);

/**
 * Single-value field types that become an ARRAY when flagged `multiple: true`.
 * Mirrors objectql `record-validator.ts` (`MULTI_CAPABLE_TYPES`): per the spec
 * (`field.zod.ts`), `multiple` applies to select / lookup / file / image;
 * `radio` shares the select branch and `user` is stored identically to `lookup`.
 * master_detail / reference / tree are NOT multi-capable, so a stray
 * `multiple: true` on them is ignored (they stay single — same as the engine).
 */
const MULTI_CAPABLE_TYPES = new Set(['select', 'radio', 'lookup', 'user', 'file', 'image']);

/**
 * Whether a field's stored value is an array — an inherently-multi type
 * (multiselect / checkboxes / tags) or a multi-capable type flagged
 * `multiple: true`. Kept in lock-step with the engine's `isMultiValueField`
 * so a coerced cell has the SAME shape the engine will accept on insert.
 */
function isMultiValueField(meta: ExportFieldMeta | undefined): boolean {
  const t = meta?.type;
  if (!t) return false;
  if (MULTI_OPTION_TYPES.has(t)) return true;
  return MULTI_CAPABLE_TYPES.has(t) && meta?.multiple === true;
}

/**
 * Structured outcome of a reference lookup. `id` set → a single record matched.
 * `ambiguous` → the display value matched more than one record, so linking any
 * one of them would be a guess the importer refuses to make. `matchedField`
 * names the field the match came from (for diagnostics). An empty object means
 * nothing matched. A bare `string | undefined` is still accepted from legacy
 * resolvers and normalised to this shape.
 */
export interface RefMatch {
  id?: string;
  ambiguous?: boolean;
  matchedField?: string;
}

/**
 * Resolve a reference field's display value (a name / email / id typed by the
 * user) to the referenced record's id. Return `undefined` / `{}` when nothing
 * matches (caller surfaces "not found"), a bare id string / `{ id }` on a unique
 * hit, or `{ ambiguous: true }` when several records share the value. Legacy
 * resolvers that return `string | undefined` keep working. Implementations are
 * expected to cache — the same name shows up on many rows.
 */
export type RefResolver = (
  referenceObject: string,
  displayValue: string,
  meta: ExportFieldMeta,
) => Promise<string | undefined | RefMatch>;

/** Normalise a resolver result (legacy string or structured) to a RefMatch. */
function normalizeRefMatch(result: string | undefined | RefMatch): RefMatch {
  if (result == null) return {};
  if (typeof result === 'string') return result ? { id: result } : {};
  return result;
}

export interface CoerceContext {
  /** Trim leading/trailing whitespace from string-ish cells (default true). */
  trimWhitespace?: boolean;
  /** Extra strings (besides `''`) treated as null, e.g. `['N/A', 'null']`. */
  nullValues?: string[];
  /**
   * When a select/multiselect cell matches no known option, keep the raw value
   * instead of failing. Note: the engine still validates option membership, so
   * this only helps when the option is (or will be) present in the schema.
   */
  createMissingOptions?: boolean;
  /** Async reference resolver (name/email/id → record id). Optional. */
  resolveRef?: RefResolver;
}

/** A per-field coercion failure, shaped like the engine's validation errors. */
export interface FieldCoerceError {
  field: string;
  code: string;
  message: string;
}

// ── blank / null handling ──────────────────────────────────────────

function isBlank(value: unknown, nullValues?: string[]): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return true;
    if (nullValues && nullValues.some((nv) => nv === value || nv === s)) return true;
  }
  return false;
}

// ── boolean ────────────────────────────────────────────────────────

const BOOL_TRUE = new Set(['true', 't', 'yes', 'y', '1', 'on', '是', '对', '✓', '√']);
const BOOL_FALSE = new Set(['false', 'f', 'no', 'n', '0', 'off', '否', '错', '✗', '×']);

/** Parse a spreadsheet cell into a boolean, or `undefined` if unrecognised. */
export function parseBooleanCell(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return undefined;
  }
  const s = String(raw).trim().toLowerCase();
  if (BOOL_TRUE.has(s)) return true;
  if (BOOL_FALSE.has(s)) return false;
  return undefined;
}

// ── numbers ────────────────────────────────────────────────────────

/**
 * Parse a numeric cell, tolerating the punctuation spreadsheets add: thousands
 * separators (`1,234`), a leading currency symbol (`$` `¥` `€` `£` `￥`), a
 * trailing percent sign (`25%` → `25`), and accounting-style parenthesised
 * negatives (`(1,234)` → `-1234`). Returns `undefined` when the residue is not
 * a finite number.
 */
export function parseNumberCell(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  let s = String(raw).trim();
  if (s === '') return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^[$¥€£￥]\s*/, '');   // leading currency symbol
  s = s.replace(/%$/, '').trim();       // trailing percent
  s = s.replace(/,/g, '');              // thousands separators
  if (s === '' || !/^[+-]?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

// ── dates ──────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * Coerce a cell into the string shape the engine accepts for a date-ish field:
 *   - `date`     → `YYYY-MM-DD`
 *   - `datetime` → full ISO-8601 (`toISOString`)
 *   - `time`     → `HH:MM` / `HH:MM:SS`
 * Returns `undefined` when the cell is not a recognisable date/time.
 *
 * Unambiguous `YYYY-MM-DD` / `YYYY/MM/DD` inputs are normalised directly to
 * avoid timezone drift; everything else falls back to `Date.parse` (which
 * covers ISO datetimes and locale-default `MM/DD/YYYY`).
 */
export function parseDateCell(raw: unknown, kind: 'date' | 'datetime' | 'time'): string | undefined {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return undefined;
    if (kind === 'datetime') return raw.toISOString();
    if (kind === 'date') return `${raw.getUTCFullYear()}-${pad2(raw.getUTCMonth() + 1)}-${pad2(raw.getUTCDate())}`;
    return `${pad2(raw.getUTCHours())}:${pad2(raw.getUTCMinutes())}:${pad2(raw.getUTCSeconds())}`;
  }
  const s = String(raw).trim();
  if (s === '') return undefined;

  if (kind === 'time') {
    if (TIME_OF_DAY.test(s)) return s.length === 5 ? `${s}:00` : s;
    // A full datetime for a time field: take its clock component.
    const t = new Date(s);
    if (!Number.isNaN(t.getTime())) return `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:${pad2(t.getUTCSeconds())}`;
    return undefined;
  }

  // Fast path: bare calendar date, no timezone games.
  const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    const y = Number(ymd[1]);
    const mo = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
    if (kind === 'date') return `${y}-${pad2(mo)}-${pad2(d)}`;
    return new Date(Date.UTC(y, mo - 1, d)).toISOString();
  }

  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (kind === 'date') {
    return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}`;
  }
  return parsed.toISOString();
}

// ── options (select / multiselect) ─────────────────────────────────

/**
 * Match a cell against a field's options, accepting **either** the option value
 * (code) or its human label (case-insensitive). Returns the canonical option
 * value to store, or `undefined` on no match.
 */
export function matchOption(
  raw: unknown,
  options?: Array<{ label?: string; value?: unknown }>,
): unknown | undefined {
  const s = String(raw).trim();
  if (!options || options.length === 0) return s; // no option list → accept as-is
  // Exact value match first (preserves the option's original value type).
  for (const o of options) {
    if (o && o.value !== undefined && String(o.value) === s) return o.value;
  }
  // Case-insensitive label match.
  const lower = s.toLowerCase();
  for (const o of options) {
    if (o && typeof o.label === 'string' && o.label.trim().toLowerCase() === lower) return o.value;
  }
  return undefined;
}

/** Split a multi-value cell on commas / semicolons / Chinese comma / newlines. */
export function splitMulti(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter((v) => v !== '');
  return String(raw)
    .split(/[,;、\n]/)
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

// ── per-field orchestration ────────────────────────────────────────

/**
 * Coerce one raw cell to its storage value using the field metadata. On success
 * returns `{ value }` (value may be `undefined`, meaning "drop this key"); on a
 * hard coercion failure returns `{ error }`.
 */
export async function coerceFieldValue(
  raw: unknown,
  meta: ExportFieldMeta | undefined,
  ctx: CoerceContext,
): Promise<{ value?: unknown } | { error: FieldCoerceError }> {
  const trim = ctx.trimWhitespace !== false;
  const field = meta?.name ?? '';

  // Blank → leave the field unset so schema defaults / existing values win.
  if (isBlank(raw, ctx.nullValues)) return { value: undefined };

  const t = meta?.type;
  if (!t) return { value: trim && typeof raw === 'string' ? raw.trim() : raw };

  if (BOOL_TYPES.has(t)) {
    const b = parseBooleanCell(raw);
    if (b === undefined) return { error: { field, code: 'invalid_boolean', message: `${field}: "${String(raw)}" is not a boolean` } };
    return { value: b };
  }

  if (NUMBER_TYPES.has(t)) {
    const n = parseNumberCell(raw);
    if (n === undefined) return { error: { field, code: 'invalid_number', message: `${field}: "${String(raw)}" is not a number` } };
    return { value: n };
  }

  if (t === 'date' || t === 'datetime' || t === 'time') {
    const d = parseDateCell(raw, t);
    if (d === undefined) return { error: { field, code: 'invalid_date', message: `${field}: "${String(raw)}" is not a valid ${t}` } };
    return { value: d };
  }

  // select / radio / multiselect / checkboxes / tags — match the cell against
  // the field's option list. Multi-valued when the type is inherently multi
  // (multiselect/…) OR a select/radio is flagged `multiple: true`; split then
  // and match each token, else match the whole cell as one option.
  if (OPTION_TYPES.has(t) || MULTI_OPTION_TYPES.has(t)) {
    if (isMultiValueField(meta)) {
      const parts = splitMulti(raw);
      const out: unknown[] = [];
      for (const part of parts) {
        const v = matchOption(part, meta?.options);
        if (v === undefined) {
          if (ctx.createMissingOptions) { out.push(part); continue; }
          return { error: { field, code: 'invalid_option', message: `${field}: "${part}" is not a known option` } };
        }
        out.push(v);
      }
      return { value: out };
    }
    const v = matchOption(raw, meta?.options);
    if (v === undefined) {
      if (ctx.createMissingOptions) return { value: String(raw).trim() };
      return { error: { field, code: 'invalid_option', message: `${field}: "${String(raw)}" is not a known option` } };
    }
    return { value: v };
  }

  if (REFERENCE_TYPES.has(t)) {
    // Multi-value reference (a `multiple: true` lookup / user): the cell holds
    // several display names joined by the export separator (`, ` / `;`). Split
    // first, then resolve each token; store an array of ids. Mirrors the
    // multi-option branch above and the export path's `formatReference` join.
    if (isMultiValueField(meta)) {
      const tokens = splitMulti(raw);
      // If we have no resolver / no target object, store the raw tokens and let
      // referential integrity be enforced downstream.
      if (!ctx.resolveRef || !meta.reference) return { value: tokens };
      const out: unknown[] = [];
      for (const token of tokens) {
        const m = normalizeRefMatch(await ctx.resolveRef(meta.reference, token, meta));
        if (m.ambiguous) {
          return { error: { field, code: 'reference_ambiguous', message: `${field}: "${token}" matches more than one ${meta.reference} — use a unique value or the record id` } };
        }
        if (m.id === undefined) {
          return { error: { field, code: 'reference_not_found', message: `${field}: no ${meta.reference} matches "${token}"` } };
        }
        out.push(m.id);
      }
      return { value: out };
    }
    const display = String(raw).trim();
    // If it already looks resolved (an id was pasted) or we have no resolver /
    // no target object, store the raw value and let referential integrity be
    // enforced downstream.
    if (!ctx.resolveRef || !meta?.reference) return { value: display };
    const match = normalizeRefMatch(await ctx.resolveRef(meta.reference, display, meta));
    if (match.ambiguous) {
      return { error: { field, code: 'reference_ambiguous', message: `${field}: "${display}" matches more than one ${meta.reference} — use a unique value or the record id` } };
    }
    if (match.id === undefined) {
      return { error: { field, code: 'reference_not_found', message: `${field}: no ${meta.reference} matches "${display}"` } };
    }
    return { value: match.id };
  }

  // Attachment fields (file / image): the value is a file id / url the importer
  // does not resolve. When `multiple: true` the cell holds several joined by the
  // export separator — split into an array so the stored shape matches what the
  // engine expects; a single-value attachment passes through untouched below.
  if (FILE_TYPES.has(t) && isMultiValueField(meta)) {
    return { value: splitMulti(raw) };
  }

  // Everything else (text, email, phone, json, html, single file, …): pass
  // through, trimming string cells so stray spreadsheet padding doesn't leak
  // into storage.
  return { value: trim && typeof raw === 'string' ? raw.trim() : raw };
}

// ── required-field pre-check ───────────────────────────────────────

/**
 * Engine-owned lifecycle columns the client never supplies. Mirrors
 * `record-validator.ts`'s `SKIP_FIELDS`, so the import's required pre-check and
 * the engine's insert-time required check agree on which fields the caller is
 * responsible for.
 */
const REQUIRED_CHECK_SKIP = new Set<string>([
  'id', 'created_at', 'created_by', 'updated_at', 'updated_by',
]);

function isBlankValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * The first required field a would-be CREATE leaves unsatisfied, or `null` when
 * every required field has either a mapped value or a schema default.
 *
 * This mirrors the engine's insert-time required check (objectql
 * `record-validator.ts` + `applyFieldDefaults`) so the import's dry run predicts
 * the SAME verdict the real insert produces: a required (⇒ NOT NULL) field with
 * no default and no value fails both. Without it, dry run only reports coercion
 * errors and green-lights a row that then dies on `NOT NULL constraint failed`.
 *
 * Matches the engine's exemptions exactly — `system`/`readonly` columns, the
 * runtime-generated `autonumber`, a field carrying a `defaultValue`, and the
 * engine-owned lifecycle columns are never required of the importer. Applies to
 * CREATE only; an UPDATE touches just the supplied fields, so callers gate on
 * "will create" before calling.
 */
export function firstMissingRequiredField(
  data: Record<string, unknown>,
  metaMap: Map<string, ExportFieldMeta>,
): string | null {
  for (const meta of metaMap.values()) {
    if (!meta.required) continue;
    if (meta.system || meta.readonly) continue;
    if (meta.hasDefault) continue;
    if (meta.type === 'autonumber') continue;
    if (REQUIRED_CHECK_SKIP.has(meta.name)) continue;
    if (isBlankValue(data[meta.name])) return meta.name;
  }
  return null;
}

/**
 * Coerce a whole raw row into a storage-ready record. Unknown columns (no
 * matching field metadata) pass through untouched so ad-hoc / schemaless
 * objects still import. Collects every field error rather than stopping at the
 * first, so a UI can show all problems in a row at once.
 */
export async function coerceRow(
  rawRow: Record<string, unknown>,
  metaMap: Map<string, ExportFieldMeta>,
  ctx: CoerceContext,
): Promise<{ data: Record<string, unknown>; errors: FieldCoerceError[] }> {
  const data: Record<string, unknown> = {};
  const errors: FieldCoerceError[] = [];
  for (const [key, raw] of Object.entries(rawRow)) {
    const meta = metaMap.get(key);
    const res = await coerceFieldValue(raw, meta ? meta : undefined, ctx);
    if ('error' in res) {
      // Attribute the error to the column even when metadata was missing.
      errors.push({ ...res.error, field: res.error.field || key });
      continue;
    }
    if (res.value !== undefined) data[key] = res.value;
  }
  return { data, errors };
}
