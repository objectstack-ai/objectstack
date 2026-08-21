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
 *  - operator object  a value carrying declared filter operators (`{ $in: […] }`)
 *                   is refused on every field whose declared value is a SCALAR
 *                   — a `where` clause pasted into the SET half of a write
 *                   (#5922).
 *  - `required`     ADR-0113 write contract: on INSERT a missing/null/empty
 *                   value is rejected; on UPDATE a SUPPLIED missing value is
 *                   rejected (a PATCH may not null out a required field) while
 *                   an omitted field never 400s — legacy null rows rest. On a
 *                   multi-value field `[]` is an empty value (#9476 — the
 *                   #9447 ruling: required means non-empty array).
 *  - `maxLength` / `minLength`            (text/textarea/email/url/phone/password)
 *  - `min` / `max`                        (number/currency/percent/rating/slider)
 *  - `scale`        more decimal places than declared → `max_scale` (#7501;
 *                   rejection, NEVER rounding — maintainer ruling 2026-08-11)
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

import {
  isMultiValueField as specIsMultiValueField,
  valueSchemaFor,
  isPlainRecord,
  ALL_OPERATORS,
  RETIRED_FILTER_OPERATORS,
  REFERENCE_VALUE_TYPES,
  FILE_REFERENCE_TYPES,
  STRUCTURED_JSON_TYPES,
} from '@objectstack/spec/data';
import type { FieldErrorCode } from '@objectstack/spec/api';
import {
  renderValidationMessage,
  objectFieldLabelKey,
  type ValidationMessageTranslator,
} from '@objectstack/spec/system';

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
// Permissive URL pattern for `url` fields. Four accepted shapes:
//   1. `scheme://…`  — any scheme + non-empty body, so non-HTTP URIs used by
//      drivers (libsql://, postgres://, mysql://, file://, s3://, …) pass.
//   2. root-relative / protocol-relative refs (`/path`, `//host/path`) — the
//      common same-origin asset form. This is what the platform's OWN storage
//      service returns for an uploaded file: the console avatar uploader
//      (@object-ui, createObjectStackUploadAdapter) PUTs the image to storage
//      and then writes `sys_user.image` (a Field.url) = `/api/v1/storage/files/
//      <id>`. Rejecting it made every avatar upload fail `invalid_url` and —
//      on the better-auth `update-user` path — surface as a raw HTTP 500.
//   3. `data:` URIs — base64-embedded images (the default object-URL upload
//      client's inline form).
//   4. `blob:` object-URLs.
// A bare scheme-less string with no leading `/` (e.g. "notaurl") is still
// rejected. Stricter per-field checks can be enforced via custom validators.
const URL_RE = /^(?:[a-z][a-z0-9+.\-]*:\/\/[^\s]+|\/[^\s]*|data:[^\s]+|blob:[^\s]+)$/i;
const PHONE_RE = /^[+()\-\s\d.]{5,}$/;

export interface FieldValidationError {
  field: string;
  /**
   * Which constraint the value violated — the spec's field-level catalog
   * (ADR-0114), not a union maintained here.
   *
   * This was a hand-listed literal union, which is the shape that drifts
   * silently: adding a validator case meant remembering to widen it, and a
   * consumer's `switch` over it went non-exhaustive in a package the change never
   * touched. The catalog is the single list, and `FieldErrorSchema.code` validates
   * against it on the way out.
   */
  code: FieldErrorCode;
  /** Rendered in the caller's locale (#3957) — see `renderValidationMessage`. */
  message: string;
  /**
   * The field's display name in the caller's locale — what `message` names it
   * by. `field` keeps the API name so a form can still focus the right input
   * (#3957).
   */
  label?: string;
  /**
   * The violated constraint as discrete values (`{ min: 0 }`,
   * `{ maxLength: 512, actual: 3000 }`), so a client can format its own text
   * instead of parsing `message`. Mirrors `FieldErrorSchema.constraint`.
   */
  constraint?: Record<string, unknown>;
  /** The offending value, where it is short and safe to echo (options, states). */
  value?: string | number | boolean;
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
  /**
   * Author-declared display label. The message templates name the field by
   * THIS, not by `name` — a user has never seen `penalty_amount`, and on a
   * localized app the declared label is already in their language (#3957).
   */
  label?: string;
  type: string;
  required?: boolean;
  readonly?: boolean;
  system?: boolean;
  multiple?: boolean;
  maxLength?: number;
  minLength?: number;
  min?: number;
  max?: number;
  /** Max decimal places for number types — enforced by rejection (#7501). */
  scale?: number;
  options?: Array<{ value: string | number; label?: string } | string | number>;
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * #9476 — the emptiness judgment the `required` check runs, def-aware where
 * `isMissing` is not. The #9447 maintainer ruling (2026-08-18) sets the
 * contract: `required` on a multi-value field means NON-EMPTY array — the
 * empty set is representable (it reads back as `[]`, never `null`), so an
 * explicit `[]` is an empty value exactly as `null` / `''` are.
 *
 * Judged only where the DECLARED value is a set (`isMultiValueField`,
 * ADR-0104 D1): a structured-JSON field's `[]` is a legitimate document, not
 * an emptied set, and every other type keeps the def-free `isMissing`
 * semantics. Only the two `required` read sites call this — a bare `[]` on a
 * non-required multi-value field still flows to the array-shape branch.
 */
function isEmptyForRequired(def: FieldDef, value: unknown): boolean {
  if (isMissing(value)) return true;
  return isMultiValueField(def) && Array.isArray(value) && value.length === 0;
}

/**
 * How many decimal places a finite number carries (#7501).
 *
 * Measured from the number's own canonical string form — `String(n)` — rather
 * than by multiply-and-round arithmetic, for two reasons:
 *
 *  - `n * 10 ** scale` overflows to `Infinity` for large magnitudes
 *    (`1e308` at `scale: 10`), turning an integral value into a false
 *    rejection; the string form never overflows.
 *  - the canonical string is exactly what JSON serialization produces, so the
 *    count judged here is the count the client's own payload showed. A float
 *    artifact like `0.1 + 0.2` really IS `0.30000000000000004` on the wire,
 *    and judging the canonical form reports it as the 17 decimal places the
 *    stored value would carry — the honest verdict under a rejection contract.
 *
 * Exponent forms are normalized: `1e-7` → 7 places, `1.5e-7` → 8,
 * `1.23e+21` → 0. Callers guard `Number.isFinite` first; a non-numeric string
 * (which `String` would render as `NaN`) falls out of the regex and counts 0.
 */
function decimalPlacesOf(n: number): number {
  const m = /^-?\d+(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(n));
  if (!m) return 0;
  const fractionDigits = m[1] ? m[1].length : 0;
  const exponent = m[2] ? Number(m[2]) : 0;
  return Math.max(0, fractionDigits - exponent);
}

/**
 * What the validator needs in order to speak the caller's language (#3957).
 *
 * Threaded in from `ExecutionContext.locale` — the field whose contract already
 * reads "Drives message catalogs and number/date formatting", resolved once per
 * request from the `localization` settings (ADR-0053 Phase 2). Nothing here is
 * required: with no context the messages render in `en` exactly as they did
 * before, so a programmatic / bare-kernel caller is unaffected.
 */
export interface ValidationMessageContext {
  /** BCP-47 locale of the principal performing the write. */
  locale?: string;
  /**
   * `II18nService.t`-compatible lookup, used for two things: a deployment's
   * `validation.field.*` message override, and the field's TRANSLATED label
   * (the declared `label` is only the source language).
   */
  translate?: ValidationMessageTranslator;
  /** Object name — needed to address the field's label in the bundle. */
  objectName?: string;
}

/**
 * The field's display name in the caller's locale: translation bundle →
 * declared `label` → API name. The API name is the last resort precisely
 * because surfacing it is the bug (#3957); it stays available to clients as
 * `FieldValidationError.field`.
 */
export function resolveFieldLabel(
  name: string,
  def: { label?: string } | undefined,
  ctx: ValidationMessageContext | undefined,
): string {
  if (ctx?.translate && ctx.objectName && ctx.locale) {
    const key = objectFieldLabelKey(ctx.objectName, name);
    try {
      const translated = ctx.translate(key, ctx.locale);
      // II18nService echoes the key back on a miss.
      if (typeof translated === 'string' && translated.length > 0 && translated !== key) {
        return translated;
      }
    } catch {
      // A misbehaving i18n service must not turn a 400 into a 500.
    }
  }
  const declared = def?.label?.trim();
  return declared && declared.length > 0 ? declared : name;
}

/**
 * Build one per-field error: the machine triple (`code` + `constraint` +
 * `field`) plus its rendering in the caller's locale.
 *
 * `messageKey` defaults to `code` and is only set explicitly where one wire code
 * needs more than one sentence (a multiselect's `invalid_option` names the
 * offending element; a `datetime` reads differently from a `date`). The catalog
 * is keyed by message, the wire by `code` — ADR-0114's vocabulary does not split
 * just because a sentence differs.
 *
 * Exported because the object-level rule evaluator (`rule-validator.ts`) emits
 * into the SAME envelope and must localize its built-in messages the same way —
 * two constructors would drift.
 */
export function buildFieldError(
  args: {
    field: string;
    code: FieldErrorCode;
    /** Field definition, for its declared `label`. */
    def?: { label?: string };
    /** Discrete constraint values — interpolated into the message AND shipped. */
    constraint?: Record<string, unknown>;
    /** The offending value, when short and safe to echo. */
    value?: string | number | boolean;
    /** Catalog key; defaults to `code`. */
    messageKey?: string;
    options?: string[];
  },
  ctx?: ValidationMessageContext,
): FieldValidationError {
  const label = resolveFieldLabel(args.field, args.def, ctx);
  const message = renderValidationMessage(
    {
      messageKey: args.messageKey ?? args.code,
      label,
      field: args.field,
      // `value` rides the same interpolation namespace as the constraint keys,
      // so a template can say `{{value}}` without a second parameter channel.
      params: { ...(args.constraint ?? {}), ...(args.value !== undefined ? { value: args.value } : {}) },
    },
    { locale: ctx?.locale, translate: ctx?.translate },
  );
  return {
    field: args.field,
    code: args.code,
    message,
    label,
    ...(args.constraint && Object.keys(args.constraint).length > 0 ? { constraint: args.constraint } : {}),
    ...(args.value !== undefined ? { value: args.value } : {}),
    ...(args.options ? { options: args.options } : {}),
  };
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
 * THE definition is the spec's (ADR-0104 D1) — previously a hand-copy here
 * and in rest/import-coerce that had to be kept in lock-step manually.
 */
function isMultiValueField(def: FieldDef): boolean {
  return specIsMultiValueField(def as { type: string; multiple?: boolean });
}

/**
 * [#5922] Filter-operator keys, as a lookup set — **derived from the spec's own
 * vocabulary, never restated here.**
 *
 * `ALL_OPERATORS` is `FILTER_OPERATORS` + `LOGICAL_OPERATORS`: the keys every
 * backend is expected to evaluate, plus the three combinators. The retired ones
 * (`$regex` / `$options`) are folded in from `RETIRED_FILTER_OPERATORS` because
 * this rule asks *"was a filter written here?"*, and a filter carrying a retired
 * spelling is still a filter — `plugin-auth`'s ObjectQL adapter emits `$regex`
 * today, so the shape is live, not historical.
 *
 * ## Why derived and not `key.startsWith('$')`
 *
 * The repo already carries five hand-rolled `keys.some(k => k.startsWith('$'))`
 * shape tests (`having-filter.ts`, `driver-memory`'s matcher and
 * `filter-refusal.ts`, `driver-mongodb`'s `mongodb-filter.ts`, `driver-turso`'s
 * `remote-transport.ts`). None of them is exported, and none is reachable from
 * this package without inverting the layering — `@objectstack/objectql` depends
 * on no driver. Writing a sixth `startsWith('$')` here is the accident #5659
 * names: one question, N private answers, and the day one of them changes only
 * some of them follow.
 *
 * So this consumes the **shared vocabulary** instead, which is exactly what the
 * two blessed consumers of `FILTER_OPERATORS` already do (`driver-memory`'s
 * `SUPPORTED_FIELD_OPERATORS` and `service-analytics`' coverage test — the
 * spec's own note calls deriving enforcement from it "the right design"). An
 * operator added to the protocol is refused here the same day it is declared,
 * with nothing to remember.
 *
 * The deliberate consequence: an **undeclared** `$`-spelling (`{ $inn: … }`) is
 * NOT matched. It is not a filter any backend can execute, so it is not this
 * rule's business — judging every plain object on a scalar field is the broader
 * question (#5922's option A), and answering it here by accident would be a
 * scope this ruling did not take.
 */
const FILTER_OPERATOR_KEYS: ReadonlySet<string> = new Set<string>([
  ...ALL_OPERATORS,
  ...Object.keys(RETIRED_FILTER_OPERATORS),
]);

/**
 * [#5922] The declared filter operators this value carries as own keys — empty
 * when the value is not an operator object at all.
 *
 * `isPlainRecord` (the spec's, shared with the authoring-key lint) is the
 * object test: a `Date`, an array, a class instance and a `null` are all
 * comparands or plain garbage, never a filter node.
 */
function filterOperatorKeysIn(value: unknown): string[] {
  if (!isPlainRecord(value) || value instanceof Date) return [];
  return Object.keys(value).filter((k) => FILTER_OPERATOR_KEYS.has(k));
}

/**
 * [#5922] May this field's declared value legitimately BE an object?
 *
 * Two classes, and only two: a multi-value field stores an ARRAY (and is
 * refused as `invalid_type_array` below when it is not one), and the
 * structured-JSON class (`json` / `composite` / `repeater` / `record` /
 * `location` / `address` / `vector`) stores an object BY DEFINITION — a `json`
 * column holding `{ "$in": ["a","b"] }` is a user's data, not a mis-written
 * filter, and this validator has no way to tell those apart nor any business
 * trying. Every other declared type stores a SCALAR, which is what makes the
 * operator-object rejection decidable at all.
 */
function valueMayBeAnObject(def: FieldDef): boolean {
  return isMultiValueField(def) || STRUCTURED_JSON_TYPES.has(def.type);
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

function validateOne(
  name: string,
  def: FieldDef,
  value: unknown,
  skipRequired = false,
  mediaStrict = false,
  ctx?: ValidationMessageContext,
  valueStrict = false,
  onAdmitted?: AdmittedValueShapeViolationSink,
): FieldValidationError | null {
  const fail = (
    code: FieldErrorCode,
    constraint?: Record<string, unknown>,
    messageKey?: string,
    options?: string[],
    value?: string | number | boolean,
  ) => buildFieldError({ field: name, code, def, constraint, messageKey, options, value }, ctx);

  // ── required ────────────────────────────────────────────────────
  // `autonumber` is runtime-owned: the value is generated by the engine /
  // driver (the SQL driver assigns it from a persistent sequence AFTER this
  // validation runs), so a missing value is never a client error — see #1603.
  if (!skipRequired && def.required && isEmptyForRequired(def, value) && def.type !== 'autonumber') {
    return fail('required');
  }
  if (isMissing(value)) return null; // nothing else to check

  const t = def.type;

  // ── [#5922] an operator object is a FILTER, never a scalar VALUE ─
  // `{ title: { $in: ['a','b'] } }` in a write payload is a `where` clause that
  // was pasted into the SET half. Before this check the two halves of the same
  // mistake had two fates chosen by the field's type: `number` said "n must be
  // a number" and never reached the driver, while `text` handed the operator
  // object to `driver.update` verbatim — the row then holds a serialized
  // `{"$in":["a","b"]}` (or whatever the driver makes of it) and the damage
  // surfaces far from its cause, as "this record's title turned into garbage".
  //
  // It runs BEFORE the per-type branches for two reasons. The near one: the
  // ADR-0104 reference / structured-JSON branch below WARNS and reports the
  // value to `onAdmittedValueShapeViolation` before returning null, and that
  // sink means *this deployment stored a non-conforming value* — recording it
  // for a write we are about to refuse would enter a counterexample against a
  // contract nothing actually broke (see `AdmittedValueShapeViolation`). The
  // far one: the branches that happen to refuse this shape today mostly do so
  // by ACCIDENT — `select`/`url`/`email`/`phone` only because
  // `String({ $in: [...] })` is `"[object Object]"`, which fails their regex or
  // their option list. An accident that fires on four types and not on the
  // other eleven is not a rule; this is.
  //
  // Reachability is external, not theoretical (#5922): flow's `update_record`
  // spreads authored fields straight into `data`
  // (`service-automation/src/builtin/crud-nodes.ts`), and a REST PATCH body is
  // the same shape. An AI-authored filter builder emitting into `fields`
  // instead of `filter` produces exactly this payload — PD #12's lenient
  // consumer is precisely where such an error would otherwise hide.
  if (!valueMayBeAnObject(def)) {
    const ops = filterOperatorKeysIn(value);
    if (ops.length > 0) {
      const plural = ops.length > 1 ? 'are filter operators' : 'is a filter operator';
      return fail(
        'invalid_type',
        {
          type: t,
          detail:
            `${ops.join(', ')} ${plural}, not a value — a filter belongs in the query ` +
            `'where', not in the write payload`,
        },
        // Same wire code and same catalog entry as the ADR-0104 shape refusal
        // one branch down: one sentence for "this value's SHAPE is wrong for
        // this field's declared type", already localized in all four bundles.
        // A fifth near-duplicate message key would be catalog drift, not
        // clarity — the key is keyed by SENTENCE, and this is that sentence.
        'invalid_value_shape',
      );
    }
  }

  // ── string types ────────────────────────────────────────────────
  if (t === 'text' || t === 'textarea' || t === 'email' || t === 'url' || t === 'phone' || t === 'password' || t === 'markdown' || t === 'html' || t === 'richtext' || t === 'code') {
    const s = typeof value === 'string' ? value : String(value);
    if (def.maxLength !== undefined && s.length > def.maxLength) {
      return fail('max_length', { maxLength: def.maxLength, actual: s.length });
    }
    if (def.minLength !== undefined && s.length < def.minLength) {
      return fail('min_length', { minLength: def.minLength, actual: s.length });
    }
    if (t === 'email' && !EMAIL_RE.test(s)) {
      return fail('invalid_email');
    }
    if (t === 'url' && !URL_RE.test(s)) {
      return fail('invalid_url');
    }
    if (t === 'phone' && !PHONE_RE.test(s)) {
      return fail('invalid_phone');
    }
    return null;
  }

  // ── number types ────────────────────────────────────────────────
  if (t === 'number' || t === 'currency' || t === 'percent' || t === 'rating' || t === 'slider') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
      return fail('invalid_number');
    }
    if (def.min !== undefined && n < def.min) {
      return fail('min_value', { min: def.min });
    }
    if (def.max !== undefined && n > def.max) {
      return fail('max_value', { max: def.max });
    }
    // ── `scale` — enforced by REJECTION, never rounding (#7501) ──
    // Maintainer ruling 2026-08-11: an over-scale value is refused the way an
    // out-of-range one is; silent rounding is silently altering data. Applies
    // to NEW writes only — already-stored values are read back untouched.
    // ⛔ The boundary, because this is the package's only other `.scale` reader
    // and therefore the tempting place to put a rounding (#10280): this branch
    // governs CALLER-SUPPLIED values, which are refusable because there is
    // somebody to refuse. A formula's output is PLATFORM-COMPUTED — nobody to
    // refuse — so its `scale` is applied by rounding at the producer, in
    // `applyFormulaPlan`. Rounding here instead would convert #7501's rejection
    // into the silent alteration the ruling forbids. Nothing was carved out of
    // #7501 to make that work: the type door below already excludes formula /
    // summary / autonumber outputs from this function's reach, so the formula
    // rounding fills a hole #7501 never covered.
    // Only a well-formed declaration (integer ≥ 0) is enforced: `scale: 2.5`
    // has no defined meaning, and inventing one here (floor? round?) would be
    // the consumer-side guessing PD #12 forbids — a malformed declaration
    // stays unenforced exactly as every declaration was before this branch.
    if (
      def.scale !== undefined &&
      Number.isInteger(def.scale) &&
      def.scale >= 0
    ) {
      const actual = decimalPlacesOf(n);
      if (actual > def.scale) {
        return fail('max_scale', { scale: def.scale, actual });
      }
    }
    return null;
  }

  // ── boolean ────────────────────────────────────────────────────
  if (t === 'boolean' || t === 'toggle') {
    if (typeof value === 'boolean') return null;
    if (value === 0 || value === 1 || value === '0' || value === '1' || value === 'true' || value === 'false') return null;
    return fail('invalid_boolean');
  }

  // ── date/datetime ───────────────────────────────────────────────
  if (t === 'date' || t === 'datetime') {
    if (value instanceof Date) return null;
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return null;
    // Same wire code, two sentences: "a valid date" vs "a valid datetime".
    return fail('invalid_date', { type: t }, t === 'datetime' ? 'invalid_datetime' : 'invalid_date');
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
    return fail('invalid_time');
  }

  // ── select / radio (single-value) ───────────────────────────────
  // A `select`/`radio` flagged `multiple: true` is a multiselect in
  // disguise — it falls through to the multi-value branch below (#2552;
  // previously an array here was stringified to "a,b" and wrongly
  // rejected as invalid_option, while a scalar slipped straight through).
  if ((t === 'select' || t === 'radio') && def.multiple !== true) {
    const allowed = optionValues(def.options);
    if (allowed.length > 0 && !allowed.includes(String(value))) {
      return fail('invalid_option', { allowed: allowed.join(', ') }, 'invalid_option', allowed);
    }
    return null;
  }

  // ── multi-value fields: value must be an ARRAY ──────────────────
  // Scalars are wrapped upstream by `normalizeMultiValueFields`; whatever
  // still isn't an array here (objects, nested junk) is a shape error —
  // storing it verbatim corrupts the column for every array-consumer (#2552).
  if (isMultiValueField(def)) {
    if (!Array.isArray(value)) {
      return fail('invalid_type', undefined, 'invalid_type_array');
    }
    // Reference / attachment types carry IDs or storage keys, not options —
    // reference integrity is handled elsewhere.
    if (t === 'lookup' || t === 'user' || t === 'file' || t === 'image') return null;
    const allowed = optionValues(def.options);
    if (allowed.length === 0) return null; // free-form (tags without options)
    for (const v of value) {
      if (!allowed.includes(String(v))) {
        return fail(
          'invalid_option',
          { allowed: allowed.join(', ') },
          'invalid_option_value',
          allowed,
          String(v),
        );
      }
    }
    return null;
  }

  // ── previously-opaque types: value-shape contract (ADR-0104 D1) ─────
  // Single-value references (id string), file-likes (a `sys_file` id), and
  // structured JSON payloads (location/address/composite/repeater/record/
  // vector) are checked against the spec's `valueSchemaFor`.
  //
  // Enforcement differs by class, because the EVIDENCE for enforcing differs
  // (#3617, splitting what #3438 originally packaged as one flip):
  //
  //  - **Media** (`file`/`image`/`avatar`/`video`/`audio`) enforces as soon as
  //    THIS DEPLOYMENT has completed and self-check-verified its
  //    file-as-reference migration. Its legacy values — inline blobs, bare
  //    URLs — are exactly what that migration converts, so a verified
  //    deployment has been SHOWN to have none left. `mediaStrict` carries that
  //    per-deployment fact in (the engine reads the `sys_migration` flag);
  //    ADR-0104 R7 external URLs are the deliberate exception the migration
  //    reports and never converts, so a deployment still holding them fails
  //    its self-check and stays lenient here.
  //  - **References and structured JSON** enforce on their OWN evidence: the
  //    `os migrate value-shapes` scan, which walks every stored value of these
  //    classes against this same schema and records
  //    `adr-0104-value-shapes` only at zero violations. They are NOT gated on
  //    the file migration's flag — that one asserts file values were migrated
  //    and reconciled, and says nothing about whether a `lookup` id or a
  //    `location` payload is well formed. Borrowing it would be an authority
  //    answering a question nobody asked it.
  //
  // Two flags rather than one, because they attest two different facts; a
  // deployment can legitimately have passed either without the other.
  if (REFERENCE_VALUE_TYPES.has(t) || FILE_REFERENCE_TYPES.has(t) || STRUCTURED_JSON_TYPES.has(t)) {
    const parsed = shapeSchemaFor(def).safeParse(value);
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message ?? 'invalid value shape';
      const isMedia = FILE_REFERENCE_TYPES.has(t);
      if (isMedia ? mediaStrictEffective(mediaStrict) : valueShapeStrictEffective(valueStrict)) {
        return fail('invalid_type', { type: t, detail }, 'invalid_value_shape');
      }
      // [#4769] The write is about to be ADMITTED: this deployment will hold a
      // value that the same contract, once enforced, rejects. Report it before
      // the log line, and unconditionally — `warnOnce` dedupes by field, and a
      // deployment's evidence must count every value, not every distinct field.
      // Whoever may attest this deployment's ADR-0104 posture reads this: a
      // boot cannot certify a contract it has itself just broken.
      if (onAdmitted) {
        try {
          onAdmitted({ gate: isMedia ? 'media' : 'value-shape', field: name, type: t, detail });
        } catch {
          // An evidence sink must never be the reason a write fails.
        }
      }
      // The warn-first path is a DEVELOPER log line, not an end-user message —
      // it names the API field and stays English so it greps the same in every
      // deployment's logs.
      const message = `${name} has an invalid ${t} value: ${detail}`;
      warnOnce(
        `${t}:${name}`,
        `[value-shape] ${message} — accepted for now (ADR-0104 warn-first; run \`os migrate ` +
          (isMedia ? 'files-to-references' : 'value-shapes') +
          ' --apply` to migrate this deployment and enforce)',
      );
    }
    return null;
  }

  // Remaining types (formula/summary/autonumber outputs, json/code payloads)
  // are explicitly open per the spec contract — see field-value.zod.ts.
  return null;
}

/**
 * All-class strict opt-in (ADR-0104). Turns on EVERY value class at once,
 * including ones whose per-deployment migration has not run here — so it is
 * the "I already know my data" lever, not the blessed route. The blessed route
 * is running the migration that produces the evidence.
 */
function VALUE_SHAPE_STRICT(): boolean {
  return typeof process !== 'undefined' && process.env?.OS_DATA_VALUE_SHAPE_STRICT_ENABLED === '1';
}

/**
 * Escape hatch: keep media value shapes lenient even on a deployment whose
 * migration verified. For an operator who hits an unforeseen rejection and
 * needs their app writing again before diagnosing.
 */
function LAX_MEDIA_VALUES(): boolean {
  return typeof process !== 'undefined' && process.env?.OS_ALLOW_LAX_MEDIA_VALUES === '1';
}

/**
 * The same escape hatch for the reference / structured-JSON classes, whose
 * evidence is the `adr-0104-value-shapes` scan rather than the file migration.
 * Deliberately a SECOND variable: the two gates open on different evidence, so
 * an operator backing out of one has said nothing about the other.
 */
function LAX_VALUE_SHAPES(): boolean {
  return typeof process !== 'undefined' && process.env?.OS_ALLOW_LAX_VALUE_SHAPES === '1';
}

/**
 * Does a media value-shape violation reject, for this deployment?
 *
 * Three inputs, and the precedence is chosen so a CONTRADICTORY configuration
 * lands on the safe side: the opt-out wins over the opt-in, because the cost
 * of wrongly staying lenient is a warning nobody reads, while the cost of
 * wrongly enforcing is a working app that stops writing.
 */
export function mediaStrictEffective(deploymentVerified: boolean): boolean {
  if (LAX_MEDIA_VALUES()) return false;
  if (VALUE_SHAPE_STRICT()) return true;
  return deploymentVerified;
}

/**
 * The reference / structured-JSON counterpart — identical precedence, its own
 * pair of inputs. A sibling function rather than one parameterised helper so
 * each gate names the evidence it opens on at its own call site; collapsing
 * them would save three lines and lose the distinction the ADR spent an
 * addendum drawing.
 */
export function valueShapeStrictEffective(deploymentVerified: boolean): boolean {
  if (LAX_VALUE_SHAPES()) return false;
  if (VALUE_SHAPE_STRICT()) return true;
  return deploymentVerified;
}

/**
 * Has an environment switch already settled the reference / structured-JSON
 * posture, so the boot advisory for the scan (#3438) would be untrue or
 * useless?
 *
 * `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1` means enforcement is already on for
 * every class, so a line announcing "warn mode is in effect" would be false.
 * `OS_ALLOW_LAX_VALUE_SHAPES=1` means the operator opted out deliberately —
 * running the scan would not change what they get, so pointing at it is noise.
 *
 * Exported rather than re-read in the engine for the same reason the scanner
 * imports `valueShapeViolation`: two readings of these variables drifting by
 * one clause is how a deployment gets told to run a migration that would not
 * change its posture, or gets told nothing while it still would.
 *
 * The predicate is exactly the pair {@link valueShapeStrictEffective} consults
 * ahead of the deployment flag — the announcement stays silent in precisely
 * the cases where the flag it reports on cannot decide the posture.
 */
export function valueShapePostureSetByEnv(): boolean {
  return LAX_VALUE_SHAPES() || VALUE_SHAPE_STRICT();
}

/**
 * The media counterpart, standing in the same relation to
 * {@link mediaStrictEffective}. A sibling rather than a parameter for the
 * reason the two `*StrictEffective` functions are siblings: each gate names
 * the switches it answers to at its own call site, and the two sets differ by
 * more than a name — `OS_DATA_VALUE_SHAPE_STRICT_ENABLED` opens both, while
 * each opt-out reaches only its own class.
 */
export function mediaPostureSetByEnv(): boolean {
  return LAX_MEDIA_VALUES() || VALUE_SHAPE_STRICT();
}

/**
 * Is `value` a violation of `def`'s declared stored shape — the SAME question
 * `validateOne` asks, exported so the `os migrate value-shapes` scanner counts
 * exactly what strict mode would reject and nothing else.
 *
 * The scanner must not re-derive this. Two implementations of "malformed"
 * drifting by one clause is how a deployment passes a scan and then has writes
 * rejected anyway — the migration would be attesting a fact the validator does
 * not recognise, which is precisely the borrowed-evidence failure the ADR's
 * addendum forbids one layer up.
 *
 * Returns the first parse issue's message, or `null` when the value conforms.
 * A value that is missing (per `isMissing`) is never a violation: absence is
 * the `required` check's business, not the shape contract's.
 */
export function valueShapeViolation(def: FieldDef, value: unknown): string | null {
  if (isMissing(value)) return null;
  const t = def.type;
  if (!REFERENCE_VALUE_TYPES.has(t) && !FILE_REFERENCE_TYPES.has(t) && !STRUCTURED_JSON_TYPES.has(t)) {
    return null;
  }
  const parsed = shapeSchemaFor(def).safeParse(value);
  if (parsed.success) return null;
  return parsed.error.issues[0]?.message ?? 'invalid value shape';
}

/**
 * Is this field one the value-shape scan covers, and one a client may write?
 * `system` / `readonly` / lifecycle columns are skipped for the same reason
 * `validateRecord` skips them — the engine owns them, so they are never
 * validated on a write and must never be counted as blocking a gate that
 * governs writes.
 */
export function isScannableValueShapeField(name: string, def: FieldDef | undefined): boolean {
  if (!def || SKIP_FIELDS.has(name) || def.system || def.readonly) return false;
  return REFERENCE_VALUE_TYPES.has(def.type) || STRUCTURED_JSON_TYPES.has(def.type);
}

const warnedShapes = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warnedShapes.has(key)) return;
  warnedShapes.add(key);
  console.warn(message);
}

/**
 * Per-field-definition cache of the spec's derived value schema. Building a
 * Zod schema is an order of magnitude costlier than parsing with it, so the
 * derivation runs once per field def (ADR-0104 performance budget). Keyed on
 * def identity — `validateRecord`'s update path passes the registry's own
 * field objects (no clones), so the map hits.
 */
const shapeSchemaCache = new WeakMap<FieldDef, ReturnType<typeof valueSchemaFor>>();
function shapeSchemaFor(def: FieldDef): ReturnType<typeof valueSchemaFor> {
  let schema = shapeSchemaCache.get(def);
  if (!schema) {
    schema = valueSchemaFor(def as { type: string; multiple?: boolean; options?: FieldDef['options'] }, 'stored');
    shapeSchemaCache.set(def, schema);
  }
  return schema;
}

/**
 * One ADR-0104 value-shape violation this deployment ADMITTED (#4769).
 *
 * "Admitted", not "found": the warn-first path let the value through, so the
 * store now holds it. That is a different fact from a rejection — a rejected
 * value never becomes part of this deployment's data and settles nothing about
 * it, while an admitted one is a standing counterexample to the very contract
 * the gate would later enforce.
 *
 * It exists because a NEGATIVE needs only one witness. Certifying a deployment
 * clean takes a complete scan (`os migrate …`); showing it is not clean takes
 * a single admitted value, which the write path has already computed with the
 * exact predicate strict mode uses. So this costs nothing and is exactly as
 * authoritative as the enforcement it anticipates.
 */
export interface AdmittedValueShapeViolation {
  /**
   * Which ADR-0104 gate this value would fail once enforced — the two classes
   * are attested by two different migrations, so a counterexample to one says
   * nothing about the other (see `FILE_REFERENCES_MIGRATION_ID` vs
   * `VALUE_SHAPES_MIGRATION_ID`).
   */
  gate: 'media' | 'value-shape';
  /** API field name the value was written to. */
  field: string;
  /** The declared field type, so a report can group by what went wrong. */
  type: string;
  /** The first parse issue — the prescription an author acts on. */
  detail: string;
}

/** Where {@link AdmittedValueShapeViolation}s are reported. Never throws into
 *  the write path: the caller wraps it. */
export type AdmittedValueShapeViolationSink = (violation: AdmittedValueShapeViolation) => void;

export interface ValidateRecordOptions {
  /**
   * Has THIS DEPLOYMENT completed and self-check-verified the ADR-0104
   * file-as-reference migration (#3617)? When true, a malformed media value
   * rejects instead of warning.
   *
   * Passed in rather than read here because the fact lives in the database
   * (`sys_migration`) while this validator is synchronous and per-write — the
   * engine reads it once and memoizes. Defaults to `false`: a caller that
   * cannot say stays lenient, so nothing starts rejecting writes merely
   * because the evidence was unavailable.
   */
  mediaValueShapeStrict?: boolean;

  /**
   * Has THIS DEPLOYMENT completed and self-check-verified the ADR-0104
   * non-media value-shape scan (`os migrate value-shapes`, #3438)? When true, a
   * malformed reference (`lookup` / `master_detail` / `user` / `tree`) or
   * structured-JSON (`location` / `address` / `composite` / `repeater` /
   * `record` / `vector`) value rejects instead of warning.
   *
   * Separate from {@link mediaValueShapeStrict} because the two facts are
   * attested by two different migrations and either can hold without the other.
   * Same default and same reason: a caller that cannot say stays lenient, so
   * nothing starts rejecting writes merely because the evidence was
   * unavailable.
   */
  valueShapeStrict?: boolean;

  /**
   * Locale + translation hooks for the human half of each error (#3957). Omit
   * and messages render in `en` against the declared labels — the pre-#3957
   * behavior for any caller that has no principal to read a locale from.
   */
  messages?: ValidationMessageContext;

  /**
   * Called for every value-shape violation this call ADMITS (#4769) — i.e. the
   * warn-first path, never the rejecting one. The engine passes a sink so the
   * deployment's own contradiction of an ADR-0104 contract is recorded where
   * the fresh-datastore attestation can see it, instead of being a log line
   * that only a human ever reads.
   *
   * Omitted by every caller that does not attest anything; the check costs one
   * truthiness test on a path that is already building an error message.
   */
  onAdmittedValueShapeViolation?: AdmittedValueShapeViolationSink;
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
  options: ValidateRecordOptions = {},
): void {
  if (!objectSchema?.fields || !data) return;

  const errors: FieldValidationError[] = [];
  const fields = objectSchema.fields;
  const mediaStrict = options.mediaValueShapeStrict === true;
  const valueStrict = options.valueShapeStrict === true;
  const messages = options.messages;
  const onAdmitted = options.onAdmittedValueShapeViolation;

  if (mode === 'insert') {
    // Walk all declared fields — required check applies even when
    // the caller didn't supply the field at all.
    for (const [name, def] of Object.entries(fields)) {
      if (SKIP_FIELDS.has(name)) continue;
      if (def.system || def.readonly) continue;
      const err = validateOne(name, def, data[name], false, mediaStrict, messages, valueStrict, onAdmitted);
      if (err) errors.push(err);
    }
  } else {
    // Update — validate only supplied fields; an OMITTED field never 400s.
    for (const [name, value] of Object.entries(data)) {
      if (SKIP_FIELDS.has(name)) continue;
      const def = fields[name];
      if (!def) continue;
      if (def.system || def.readonly) continue;
      // ADR-0113 non-regression: a PATCH may not null OUT a required field.
      // The key is in the payload (we are iterating it), so a missing value
      // is an explicit clear, not an omission — the write would take the
      // record from compliant to violating. Legacy null rows still rest: a
      // write that does not touch the field never reaches this check. (The
      // one over-approximation — explicit null onto an already-null legacy
      // row — is rejected too; that write was a no-op plus a false claim.)
      if (def.required && isEmptyForRequired(def, value) && def.type !== 'autonumber') {
        // Same catalog as every other built-in message (#3957) — one wire code
        // (`required`), a distinct sentence for the clear-out case.
        errors.push(buildFieldError(
          { field: name, code: 'required', def, messageKey: 'required_cleared' },
          messages,
        ));
        continue;
      }
      // skipRequired: PATCH-omitted fields must not 400. (No def clone — the
      // registry's own field object flows through so the ADR-0104 value-shape
      // schema cache, keyed on def identity, hits.)
      const err = validateOne(name, def, value, true, mediaStrict, messages, valueStrict, onAdmitted);
      if (err) errors.push(err);
    }
  }

  if (errors.length > 0) throw new ValidationError(errors);
}
