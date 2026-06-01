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
 * `updated_at`, `updated_by`, `organization_id`) are never validated
 * here — the engine and the audit plugin manage them.
 *
 * On failure, a `ValidationError` is thrown with `.fields[]` holding
 * one entry per offending field. REST translates this into a
 * `400 { code: 'VALIDATION_FAILED', message, fields }` envelope so
 * the UI can highlight the specific input.
 */

const SKIP_FIELDS = new Set<string>([
  'id', 'created_at', 'created_by', 'updated_at', 'updated_by',
  'organization_id', 'tenant_id',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
    | 'invalid_option'
    // Object-level validation rules (ADR-0020, see rule-validator.ts)
    | 'invalid_transition'
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
    super(
      `Validation failed for ${fields.length} field(s): ` +
      fields.map((f) => `${f.field} (${f.code})`).join(', '),
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

function validateOne(name: string, def: FieldDef, value: unknown): FieldValidationError | null {
  // ── required ────────────────────────────────────────────────────
  if (def.required && isMissing(value)) {
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
  if (t === 'date' || t === 'datetime' || t === 'time') {
    if (value instanceof Date) return null;
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return null;
    return { field: name, code: 'invalid_date', message: `${name} must be a valid ${t} (ISO-8601)` };
  }

  // ── select / multiselect / radio ────────────────────────────────
  if (t === 'select' || t === 'radio') {
    const allowed = optionValues(def.options);
    if (allowed.length > 0 && !allowed.includes(String(value))) {
      return { field: name, code: 'invalid_option', message: `${name} must be one of: ${allowed.join(', ')}`, options: allowed };
    }
    return null;
  }
  if (t === 'multiselect' || t === 'checkboxes' || t === 'tags') {
    const allowed = optionValues(def.options);
    if (allowed.length === 0) return null;
    const arr = Array.isArray(value) ? value : [value];
    for (const v of arr) {
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
