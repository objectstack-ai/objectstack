// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Record Validator
 *
 * Validates an incoming insert/update payload against the canonical
 * `Field` metadata of an `ObjectSchema`. Implements ROADMAP §M10.4 —
 * "Zod-at-rest" — but does not require constructing a Zod schema:
 * we walk the field map directly, which is both faster and lets us
 * produce per-field error envelopes shaped for REST consumption.
 *
 * Rules applied (in order, stop at first error per field):
 *
 *  - `required`     missing/null/empty-string is rejected (insert only;
 *                   PATCH validates only fields actually supplied)
 *  - `maxLength` / `minLength`            (text/textarea/email/url/phone/password)
 *  - `min` / `max`                        (number/currency/percent/rating/slider)
 *  - format         email / url / phone   (lightweight RFC-aware regex)
 *  - select / multiselect: value must appear in `options`
 *  - boolean / toggle: must coerce to boolean
 *  - date / datetime: must be ISO-parsable
 *
 * System-injected fields (`id`, `created_at`, `created_by`,
 * `updated_at`, `updated_by`, and provenance-flagged `system`/`readonly`
 * columns such as an injected `organization_id`) are never validated
 * here — the engine and the audit plugin manage them.
 *
 * On failure, a `ValidationError` is thrown with `.fields[]` holding
 * one entry per offending field. REST translates this into a
 * `400 { code: 'VALIDATION_FAILED', message, fields }` envelope so
 * the UI can highlight the specific input.
 */

// Lifecycle columns the engine always owns and the client never supplies. These
// are skipped by NAME because they are not author-declared business fields.
// NOTE: `organization_id` / `tenant_id` are intentionally NOT here (#1592) — the
// engine-injected tenant column is marked `system: true` and skipped via
// provenance below, while a genuinely DECLARED required `organization_id`
// business field (e.g. `sys_team`, a `managedBy: 'better-auth'` table where the
// column is not injected) must get a normal required-check instead of silently
// passing NULL through to the driver.
const SKIP_FIELDS = new Set<string>([
  'id', 'created_at', 'created_by', 'updated_at', 'updated_by',
]);

// Linear-time email check. Domain labels exclude '.', so the quantifiers on
// either side of each '.' can't overlap — this avoids the polynomial
// backtracking (ReDoS) of the naive `[^\s@]+\.[^\s@]+` shape while still
// requiring a local part, an '@', and a dotted domain.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
// Permissive URL pattern: accept any scheme:// + non-empty body so that
// non-HTTP URIs used by drivers (libsql://, postgres://, mysql://, file://, s3://, …)
// pass field-level validation. Stricter per-field checks can be enforced
// via custom validators where needed.
const URL_RE = /^[a-z][a-z0-9+.\-]*:\/\/[^\s]+$/i;
const PHONE_RE = /^[+()\-\s\d.]{5,}$/;

export interface FieldValidationError {
  field: string;
  code:
    | 'required'
    | 'min_length'
    | 'max_length'
    | 'min_value'
    | 'max_value'
    | 'invalid_email'
    | 'invalid_url'
    | 'invalid_phone'
    | 'invalid_number'
    | 'invalid_boolean'
    | 'invalid_date'
    | 'invalid_time'
    | 'invalid_option'
    | 'invalid_type'
    // Object-level validation rules (ADR-0020, see rule-validator.ts)
    | 'invalid_transition'
    | 'invalid_initial_state'
    | 'rule_violation'
    | 'invalid_format'
    | 'invalid_json'
    | 'json_schema_violation';
  message: string;
  /** Allowed values for select/multiselect, when applicable. */
  options?: string[];
}

export class ValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly fields: FieldValidationError[];
  constructor(fields: FieldValidationError[]) {
    // The top-level message is what generic UI surfaces (toasts, CLI output)
    // display verbatim, so it must carry the HUMAN messages — most notably a
    // validation rule's author-written `message` (often localized), which used
    // to be buried in `fields[]` while the toast showed only
    // "Validation failed for 1 field(s): _record (rule_violation)".
    // Machine-readable field/code pairs remain available on `.fields`.
    super(
      fields
        .map((f) => (f.message?.trim() ? f.message : `${f.field} (${f.code})`))
        .join('; ') || 'Validation failed',
    );
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

type Mode = 'insert' | 'update';

interface FieldDef {
  name?: string;
  type: string;
  required?: boolean;
  readonly?: boolean;
  system?: boolean;
  multiple?: boolean;
  maxLength?: number;
  minLength?: number;
  min?: number;
  max?: number;
  options?: Array<{ value: string | number; label?: string } | string | number>;
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function optionValues(options: FieldDef['options']): string[] {
  if (!Array.isArray(options)) return [];
  return options.map((o) =>
    typeof o === 'object' && o !== null ? String((o as any).value) : String(o),
  );
}

/**
 * A field whose persisted value is an ARRAY of scalars: either an
 * inherently-multi type, or a single-value type flagged `multiple: true`.
 * Per the spec (field.zod.ts), `multiple` applies to select/lookup/file/image;
 * `radio` shares the select branch and `user` is stored identically to
 * `lookup` (FK column, `multiple` ⇒ JSON array) — the runtime expands
 * `Field.user` with `type: 'user'`, so it must be recognized here too.
 */
const MULTI_CAPABLE_TYPES = new Set(['select', 'radio', 'lookup', 'user', 'file', 'image']);

function isMultiValueField(def: FieldDef): boolean {
  const t = def.type;
  if (t === 'multiselect' || t === 'checkboxes' || t === 'tags') return true;
  return MULTI_CAPABLE_TYPES.has(t as string) && def.multiple === true;
}

/**
 * Coerce lone scalars into single-element arrays for multi-value fields,
 * IN PLACE, before validation (#2552). Legacy clients (e.g. pre-#2186
 * console bulk-edit) PATCH `{ labels: "frontend" }` at a multiselect —
 * without this the scalar used to be stored verbatim, silently corrupting
 * the column's shape for every consumer that expects an array.
 *
 * Only unambiguous scalars (string/number/boolean) are wrapped; anything
 * else (plain objects, nested garbage) is left untouched so that
 * `validateRecord` can reject it with `invalid_type`.
 */
export function normalizeMultiValueFields(
  objectSchema: { fields?: Record<string, FieldDef> } | undefined | null,
  data: Record<string, unknown> | undefined | null,
): void {
  if (!objectSchema?.fields || !data) return;
  for (const [name, value] of Object.entries(data)) {
    if (SKIP_FIELDS.has(name) || isMissing(value)) continue;
    const def = objectSchema.fields[name];
    if (!def || def.system || def.readonly || !isMultiValueField(def)) continue;
    if (Array.isArray(value)) continue;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      data[name] = [value];
    }
  }
}

/**
 * Coerce `boolean`-typed fields from their SQL storage form (integer `0`/`1`,
 * or the strings `'0'`/`'1'`/`'true'`/`'false'`) into real JS booleans, on a
 * SHALLOW COPY of `row`. SQLite/libsql have no native boolean, so a driver
 * returns `1` for a `true` column — which then leaks into CEL/flow conditions
 * where `record.is_escalated != true` becomes `1 != true` (always true, no
 * int↔bool coercion) and a re-entry guard never trips (2026-07-06 infinite
 * escalation loop). Returns the input unchanged when there is nothing to coerce.
 *
 * Only touches declared `boolean` fields; every other value is passed through.
 * Null/undefined are preserved (a nullable boolean stays null, not `false`).
 */
export function coerceBooleanFields<T extends Record<string, unknown>>(
  objectSchema: { fields?: Record<string, FieldDef> } | undefined | null,
  row: T | undefined | null,
): T {
  if (!objectSchema?.fields || !row || typeof row !== 'object') return row as T;
  let copy: Record<string, unknown> | undefined;
  for (const [name, def] of Object.entries(objectSchema.fields)) {
    if (!def || def.type !== 'boolean') continue;
    if (!(name in row)) continue;
    const v = (row as Record<string, unknown>)[name];
    if (v === null || v === undefined || typeof v === 'boolean') continue;
    let coerced: boolean;
    if (typeof v === 'number') coerced = v !== 0;
    else if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === '1' || s === 'true') coerced = true;
      else if (s === '0' || s === 'false' || s === '') coerced = false;
      else continue; // unrecognised — leave as-is
    } else continue;
    if (!copy) copy = { ...(row as Record<string, unknown>) };
    copy[name] = coerced;
  }
  return (copy ?? row) as T;
}

function validateOne(name: string, def: FieldDef, value: unknown): FieldValidationError | null {
  // ── required ────────────────────────────────────────────────────
  // `autonumber` is runtime-owned: the value is generated by the engine /
  // driver (the SQL driver assigns it from a persistent sequence AFTER this
  // validation runs), so a missing value is never a client error — see #1603.
  if (def.required && isMissing(value) && def.type !== 'autonumber') {
    return { field: name, code: 'required', message: `${name} is required` };
  }
  if (isMissing(value)) return null; // nothing else to check

  const t = def.type;

  // ── string types ────────────────────────────────────────────────
  if (t === 'text' || t === 'textarea' || t === 'email' || t === 'url' || t === 'phone' || t === 'password' || t === 'markdown' || t === 'html' || t === 'richtext' || t === 'code') {
    const s = typeof value === 'string' ? value : String(value);
    if (def.maxLength !== undefined && s.length > def.maxLength) {
      return { field: name, code: 'max_length', message: `${name} must be ≤ ${def.maxLength} characters (got ${s.length})` };
    }
    if (def.minLength !== undefined && s.length < def.minLength) {
      return { field: name, code: 'min_length', message: `${name} must be ≥ ${def.minLength} characters (got ${s.length})` };
    }
    if (t === 'email' && !EMAIL_RE.test(s)) {
      return { field: name, code: 'invalid_email', message: `${name} must be a valid email address` };
    }
    if (t === 'url' && !URL_RE.test(s)) {
      return { field: name, code: 'invalid_url', message: `${name} must be a valid URL (scheme://...)` };
    }
    if (t === 'phone' && !PHONE_RE.test(s)) {
      return { field: name, code: 'invalid_phone', message: `${name} must be a valid phone number` };
    }
    return null;
  }

  // ── number types ────────────────────────────────────────────────
  if (t === 'number' || t === 'currency' || t === 'percent' || t === 'rating' || t === 'slider') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
      return { field: name, code: 'invalid_number', message: `${name} must be a number` };
    }
    if (def.min !== undefined && n < def.min) {
      return { field: name, code: 'min_value', message: `${name} must be ≥ ${def.min}` };
    }
    if (def.max !== undefined && n > def.max) {
      return { field: name, code: 'max_value', message: `${name} must be ≤ ${def.max}` };
    }
    return null;
  }

  // ── boolean ────────────────────────────────────────────────────
  if (t === 'boolean' || t === 'toggle') {
    if (typeof value === 'boolean') return null;
    if (value === 0 || value === 1 || value === '0' || value === '1' || value === 'true' || value === 'false') return null;
    return { field: name, code: 'invalid_boolean', message: `${name} must be true or false` };
  }

  // ── date/datetime ───────────────────────────────────────────────
  if (t === 'date' || t === 'datetime') {
    if (value instanceof Date) return null;
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return null;
    return { field: name, code: 'invalid_date', message: `${name} must be a valid ${t} (ISO-8601)` };
  }

  // ── time (time-of-day) ──────────────────────────────────────────
  // A `Field.time` is a wall-clock time, NOT an instant — `Date.parse('14:30')`
  // is NaN, so reusing the date branch rejected every valid time. Accept
  // `HH:MM`, `HH:MM:SS`, optional fractional seconds and an optional Z/offset;
  // also accept a Date or a full ISO datetime (callers that send a timestamp
  // for a time field).
  if (t === 'time') {
    if (value instanceof Date) return null;
    if (typeof value === 'string') {
      const timeOfDay = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):?[0-5]\d)?$/;
      // Accept a valid time-of-day, OR a full datetime that carries a real date
      // component. NOT a bare `Date.parse` check — `Date.parse('14:60')` returns
      // a (bogus) number in Node, which would let malformed times through.
      const hasDate = /\d{4}-\d{2}-\d{2}/.test(value);
      if (timeOfDay.test(value.trim()) || (hasDate && !Number.isNaN(Date.parse(value)))) return null;
    }
    return { field: name, code: 'invalid_time', message: `${name} must be a valid time (HH:MM or HH:MM:SS)` };
  }

  // ── select / radio (single-value) ───────────────────────────────
  // A `select`/`radio` flagged `multiple: true` is a multiselect in
  // disguise — it falls through to the multi-value branch below (#2552;
  // previously an array here was stringified to "a,b" and wrongly
  // rejected as invalid_option, while a scalar slipped straight through).
  if ((t === 'select' || t === 'radio') && def.multiple !== true) {
    const allowed = optionValues(def.options);
    if (allowed.length > 0 && !allowed.includes(String(value))) {
      return { field: name, code: 'invalid_option', message: `${name} must be one of: ${allowed.join(', ')}`, options: allowed };
    }
    return null;
  }

  // ── multi-value fields: value must be an ARRAY ──────────────────
  // Scalars are wrapped upstream by `normalizeMultiValueFields`; whatever
  // still isn't an array here (objects, nested junk) is a shape error —
  // storing it verbatim corrupts the column for every array-consumer (#2552).
  if (isMultiValueField(def)) {
    if (!Array.isArray(value)) {
      return { field: name, code: 'invalid_type', message: `${name} must be an array of values` };
    }
    // Reference / attachment types carry IDs or storage keys, not options —
    // reference integrity is handled elsewhere.
    if (t === 'lookup' || t === 'user' || t === 'file' || t === 'image') return null;
    const allowed = optionValues(def.options);
    if (allowed.length === 0) return null; // free-form (tags without options)
    for (const v of value) {
      if (!allowed.includes(String(v))) {
        return { field: name, code: 'invalid_option', message: `${name}: "${v}" is not one of: ${allowed.join(', ')}`, options: allowed };
      }
    }
    return null;
  }

  // Other types (lookup, file, formula, json, location, etc.) — no
  // strict shape check at this layer; reference integrity is handled
  // elsewhere (lookup) and the rest are opaque payloads.
  return null;
}

/**
 * Validate a payload against a list of declared fields. `objectSchema`
 * comes from `ObjectQL.getRegistry().getObject(name)` and exposes a
 * `fields` map of `{ [fieldName]: FieldDef }`.
 *
 * Returns void on success; throws `ValidationError` on failure.
 */
export function validateRecord(
  objectSchema: { fields?: Record<string, FieldDef> } | undefined | null,
  data: Record<string, unknown> | undefined | null,
  mode: Mode,
): void {
  if (!objectSchema?.fields || !data) return;

  const errors: FieldValidationError[] = [];
  const fields = objectSchema.fields;

  if (mode === 'insert') {
    // Walk all declared fields — required check applies even when
    // the caller didn't supply the field at all.
    for (const [name, def] of Object.entries(fields)) {
      if (SKIP_FIELDS.has(name)) continue;
      if (def.system || def.readonly) continue;
      const err = validateOne(name, def, data[name]);
      if (err) errors.push(err);
    }
  } else {
    // Update — validate only supplied fields, skip required check.
    for (const [name, value] of Object.entries(data)) {
      if (SKIP_FIELDS.has(name)) continue;
      const def = fields[name];
      if (!def) continue;
      if (def.system || def.readonly) continue;
      // Clone def with required=false so PATCH-omitted-fields don't 400.
      const err = validateOne(name, { ...def, required: false }, value);
      if (err) errors.push(err);
    }
  }

  if (errors.length > 0) throw new ValidationError(errors);
}
