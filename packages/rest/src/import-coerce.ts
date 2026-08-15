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

import { zonedWallClockToUtcMs, type WallClockParts } from '@objectstack/core';
import type { ExportFieldMeta } from './export-format.js';
import {
  SINGLE_OPTION_TYPES as OPTION_TYPES,
  MULTI_OPTION_TYPES,
  NUMERIC_VALUE_TYPES as NUMBER_TYPES,
  BOOLEAN_VALUE_TYPES as BOOL_TYPES,
  FILE_REFERENCE_TYPES as FILE_TYPES,
  isMultiValueField as specIsMultiValueField,
  IMPORT_BOOLEAN_TRUE_TOKENS,
  IMPORT_BOOLEAN_FALSE_TOKENS,
  IMPORT_REFERENCE_TYPES,
} from '@objectstack/spec/data';
import type { FieldErrorCode } from '@objectstack/spec/api';
import {
  renderValidationMessage,
  type ValidationMessageTranslator,
} from '@objectstack/spec/system';

/**
 * Field types whose stored value points at another record (id). The spec's
 * reference class (ADR-0104 D1) plus `reference` — a legacy external-object
 * alias that is not an authorable `FieldType` and so stays a local extra.
 */
// The spec now publishes the completed set (reference value types plus the
// legacy 'reference' spelling), so the `+ 'reference'` literal is retired on
// both ends (#4173).
const REFERENCE_TYPES = IMPORT_REFERENCE_TYPES;

/**
 * Whether a field's stored value is an array. Delegates to the spec's
 * `isMultiValueField` (ADR-0104 D1) — the shared definition the engine's
 * record-validator uses — so a coerced cell has the SAME shape the engine
 * will accept on insert.
 */
function isMultiValueField(meta: ExportFieldMeta | undefined): boolean {
  return meta?.type ? specIsMultiValueField(meta as { type: string; multiple?: boolean }) : false;
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
  /**
   * Locale of the importing principal (`ExecutionContext.locale`). Cell-coercion
   * failures land in the same row report as the engine's validation errors, so
   * they are localized from the same catalog (#3957). Absent → `en`.
   */
  locale?: string;
  /** `II18nService.t`-compatible lookup for message overrides (#3957). */
  translate?: ValidationMessageTranslator;
  /**
   * Business timezone of the importing principal (`ExecutionContext.timezone`,
   * the platform-default → global → tenant cascade). The clock an offset-free
   * datetime cell is read in (#8485) — see {@link parseDateCell}. Absent → the
   * cell is read as UTC, matching what the export writes when no zone resolves.
   */
  timezone?: string;
}

/** A per-field coercion failure, shaped like the engine's validation errors. */
export interface FieldCoerceError {
  field: string;
  /**
   * Which constraint the value violated — the spec's field-level catalog
   * (ADR-0114). Was a bare `string`, so a typo here reached the wire and the
   * "shaped like the engine's validation errors" claim above was a comment rather
   * than a type.
   */
  code: FieldErrorCode;
  message: string;
}

/**
 * Build a coercion failure whose message names the column by its (localized)
 * label and quotes the offending cell — never the API field name (#3957).
 *
 * `code` stays the machine identity the importer's row report and its tests key
 * off; `messageKey` selects the sentence from the shared catalog.
 */
function coerceError(
  meta: ExportFieldMeta | undefined,
  field: string,
  code: FieldErrorCode,
  messageKey: string,
  value: unknown,
  ctx: CoerceContext,
): { error: FieldCoerceError } {
  const label = meta?.label?.trim() || field;
  return {
    error: {
      field,
      code,
      message: renderValidationMessage(
        { messageKey, label, field, params: { value: String(value) } },
        { locale: ctx.locale, translate: ctx.translate },
      ),
    },
  };
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

// DERIVED from the spec's import-coercion vocabulary (#4173): objectui's
// Import Wizard preview re-checks these same tables client-side, so both ends
// reading one export is what keeps a cell flagged red here exactly when the
// server rejects it. The literals used to live in this file alone.
const BOOL_TRUE = IMPORT_BOOLEAN_TRUE_TOKENS;
const BOOL_FALSE = IMPORT_BOOLEAN_FALSE_TOKENS;

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
 * A date-time cell carrying **no offset**: `YYYY-MM-DD HH:mm[:ss[.sss]]`, `T`
 * or space separated, `/` accepted for `-` like the date fast path. Anchored at
 * both ends, so a trailing `Z` or `+08:00` does NOT match — that cell already
 * names an instant and is left to `Date.parse` (#8485 ruling: an explicit offset
 * keeps being honoured exactly as written).
 */
const NAIVE_DATE_TIME =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?:\.(\d{1,3})\d*)?$/;

/**
 * Read an offset-free cell as the wall clock it is, or `undefined` when the
 * shape does not match (caller falls through to `Date.parse`). Out-of-range
 * components are rejected here rather than silently rolled over by `Date.UTC`.
 */
function parseNaiveWallClock(s: string): WallClockParts | undefined {
  const m = NAIVE_DATE_TIME.exec(s);
  if (!m) return undefined;
  const parts: WallClockParts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
    millisecond: m[7] ? Number(m[7].padEnd(3, '0')) : 0,
  };
  if (parts.month < 1 || parts.month > 12) return undefined;
  if (parts.day < 1 || parts.day > 31) return undefined;
  if ((parts.hour ?? 0) > 23) return undefined;
  return parts;
}

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
 *
 * ## Which clock an offset-free cell is read in (#8485)
 *
 * A spreadsheet cell like `2026-08-01 06:00:00` carries no offset, so it is a
 * **wall clock**, not an instant — and `new Date(s)` resolves it against the
 * **process** `TZ`. That made the stored instant a property of the deployment
 * host: the same file, same tenant, same cell landed eight hours apart on two
 * hosts, decided by a setting nobody authoring the spreadsheet can see. Since
 * export renders `datetime` cells in the business timezone (#8373), the
 * advertised export → edit → re-import round trip was lossless only where the
 * host `TZ` happened to equal that zone.
 *
 * So a naive **datetime** cell is now read in `timezone` — the caller's
 * `ExecutionContext.timezone`, the same value the export renders in — through
 * `@objectstack/core`'s `zonedWallClockToUtcMs` (DST-safe via the platform tz
 * database, and the primitive the date-bucket drill path already used in its
 * date-only form). Three things deliberately do NOT change:
 *
 *  - **an offset-bearing cell** (`…Z`, `…+08:00`) already names one instant and
 *    is honoured exactly as written — `NAIVE_DATE_TIME` cannot match it;
 *  - **the date-only fast path** stays UTC (ECMAScript reads a date-only form as
 *    UTC, and a `date` is a timezone-naive calendar day under ADR-0053 — moving
 *    it would re-time every date-only import to fix nothing);
 *  - **no resolved timezone ⇒ UTC**, never the process clock. That is the
 *    fallback the export cell path takes when no zone resolves, so the round
 *    trip stays exact for deployments that configure none — and a process-`TZ`
 *    fallback would preserve the defect for exactly the deployments that cannot
 *    see it.
 *
 * For a naive cell landing in a `date` or `time` field the typed components are
 * taken verbatim (`2026-08-01 06:00:00` → `2026-08-01` / `06:00:00`), which is
 * both zone-free and host-`TZ`-free; previously those two branches also read the
 * cell through the process clock and could report the wrong calendar day.
 */
export function parseDateCell(
  raw: unknown,
  kind: 'date' | 'datetime' | 'time',
  timezone?: string,
): string | undefined {
  if (raw instanceof Date) {
    // Already an instant (a JSON/programmatic caller's `Date`) — no wall clock
    // to re-interpret, so no zone question to answer.
    if (Number.isNaN(raw.getTime())) return undefined;
    if (kind === 'datetime') return raw.toISOString();
    if (kind === 'date') return `${raw.getUTCFullYear()}-${pad2(raw.getUTCMonth() + 1)}-${pad2(raw.getUTCDate())}`;
    return `${pad2(raw.getUTCHours())}:${pad2(raw.getUTCMinutes())}:${pad2(raw.getUTCSeconds())}`;
  }
  const s = String(raw).trim();
  if (s === '') return undefined;

  const wall = parseNaiveWallClock(s);

  if (kind === 'time') {
    if (TIME_OF_DAY.test(s)) return s.length === 5 ? `${s}:00` : s;
    // A full datetime for a time field: take its clock component. Offset-free →
    // the clock as typed; offset-bearing → the instant's UTC clock, as before.
    if (wall) return `${pad2(wall.hour ?? 0)}:${pad2(wall.minute ?? 0)}:${pad2(wall.second ?? 0)}`;
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

  if (wall) {
    if (kind === 'date') return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
    const ms = zonedWallClockToUtcMs(wall, timezone);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
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
    if (b === undefined) return coerceError(meta, field, 'invalid_boolean', 'import_invalid_boolean', raw, ctx);
    return { value: b };
  }

  if (NUMBER_TYPES.has(t)) {
    const n = parseNumberCell(raw);
    if (n === undefined) return coerceError(meta, field, 'invalid_number', 'import_invalid_number', raw, ctx);
    return { value: n };
  }

  if (t === 'date' || t === 'datetime' || t === 'time') {
    // The business timezone an offset-free datetime cell is read in (#8485).
    const d = parseDateCell(raw, t, ctx.timezone);
    if (d === undefined) {
      // One code, three sentences — a `time` cell is not "not a valid date".
      const key = t === 'datetime' ? 'import_invalid_datetime' : t === 'time' ? 'import_invalid_time' : 'import_invalid_date';
      return coerceError(meta, field, 'invalid_date', key, raw, ctx);
    }
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
          return coerceError(meta, field, 'invalid_option', 'import_unknown_option', part, ctx);
        }
        out.push(v);
      }
      return { value: out };
    }
    const v = matchOption(raw, meta?.options);
    if (v === undefined) {
      if (ctx.createMissingOptions) return { value: String(raw).trim() };
      return coerceError(meta, field, 'invalid_option', 'import_unknown_option', raw, ctx);
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
          return coerceError(meta, field, 'reference_ambiguous', 'import_reference_ambiguous', token, ctx);
        }
        if (m.id === undefined) {
          return coerceError(meta, field, 'reference_not_found', 'import_reference_not_found', token, ctx);
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
      return coerceError(meta, field, 'reference_ambiguous', 'import_reference_ambiguous', display, ctx);
    }
    if (match.id === undefined) {
      return coerceError(meta, field, 'reference_not_found', 'import_reference_not_found', display, ctx);
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

// ── the retired pre-check mirror ───────────────────────────────────
//
// `firstMissingRequiredField` and `firstConstraintViolation` used to live here
// (framework#3956): hand-copied re-implementations of the engine's required
// check and its numeric-range / string-length rules, kept in step with
// `record-validator.ts` by hand so the import's dry run could PREDICT the
// verdict the real write produces.
//
// A copy cannot structurally keep up with the family it mirrors, and the gap
// was measured (#4633): a CSV cell aimed at a `Field.address` passed the dry
// run — `coerceFieldValue` routes structured value shapes through its
// pass-through catch-all, so no verdict was formed at all — and the write then
// rejected it with `VALIDATION_FAILED`. The same hole covered `format` checks,
// object-level `validations`, and the state machine.
//
// Ruling D (maintainer, 2026-08-06) retired the mirror rather than growing it:
// the dry run now ASKS for the verdict through `DataProtocol.validateData`
// (#6037), which runs the same `validateRecord` / `evaluateValidationRules`
// `insert()` runs, under the deployment's own ADR-0104 posture. See
// `import-runner.ts`'s dry-run branch. Every verdict these two produced is
// re-asserted through that route in `import-dryrun-parity.test.ts` — retiring
// the mirror must not silently retire its coverage.

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
