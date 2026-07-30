// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * # Field Validation Error — the write path's per-field error contract
 *
 * What the record validator (`objectql/src/validation/record-validator.ts`)
 * emits for each offending field, and what REST ships verbatim inside
 * `400 { code: 'VALIDATION_FAILED', fields: [...] }`.
 *
 * ## Why this is a protocol, not an implementation detail
 *
 * The `message` used to be the ONLY machine-usable thing in the envelope: a
 * hardcoded English template with the API field name concatenated into it
 * (`penalty_amount must be ≥ 0`). A client that wanted to render its own text
 * had to parse the sentence to recover the bound, and a Chinese-locale user saw
 * an English string naming a column they have never seen (#3957).
 *
 * So the envelope carries THREE separable things, and every consumer picks the
 * layer it can use:
 *
 *  - `code`   — the machine identity of the violated constraint. Stable wire
 *               vocabulary; never localized, never reworded.
 *  - `params` — the constraint's discrete values (`{ min: 0 }`,
 *               `{ maxLength: 512, actual: 3000 }`). A client can format its
 *               own sentence without parsing `message`.
 *  - `label` + `message` — the human layer, already resolved in the caller's
 *               locale by the server (see `system/validation-message.ts`).
 *
 * `message` remains populated for every error so a generic toast / CLI / log
 * line stays useful with zero client work; it is a RENDERING of
 * `(code, params, label)`, not the source of truth.
 */

/**
 * Machine identity of a violated field constraint.
 *
 * This is the wire vocabulary — it is matched by clients (`err.fields.some(f =>
 * f.code === 'required')`) and must stay stable. Do not localize, rename, or
 * repurpose an entry; add a new one instead.
 *
 * The first block is emitted by the field-level validator (declared `Field`
 * metadata: `required`, `min`/`max`, `maxLength`, format, options, value
 * shape). The second is emitted by the object-level rule evaluator (ADR-0020
 * `ValidationRule`s), where an author-written `message` normally wins.
 */
export const FieldValidationCode = z.enum([
  // ── field-level constraints (Field metadata) ──
  'required',
  'min_length',
  'max_length',
  'min_value',
  'max_value',
  'invalid_email',
  'invalid_url',
  'invalid_phone',
  'invalid_number',
  'invalid_boolean',
  'invalid_date',
  'invalid_time',
  'invalid_option',
  'invalid_type',
  // ── object-level validation rules (ADR-0020, rule-validator.ts) ──
  'invalid_transition',
  'invalid_initial_state',
  'rule_violation',
  'invalid_format',
  'invalid_json',
  'json_schema_violation',
]);

export type FieldValidationCode = z.infer<typeof FieldValidationCode>;

/**
 * The violated constraint's discrete values, so a client can format its own
 * message instead of parsing `message` (#3957 option 2).
 *
 * Every key is optional and only the ones the specific `code` implies are
 * populated — `min_value` carries `min`, `max_length` carries `maxLength` plus
 * the offending `actual` length. Interpolated into the message templates in
 * `system/validation-message.ts` under the SAME names, so a translation
 * override can reference `{{min}}` / `{{actual}}` directly.
 */
export const FieldValidationParamsSchema = lazySchema(() => z.object({
  /** `min_value` — the declared `Field.min`. */
  min: z.number().optional(),
  /** `max_value` — the declared `Field.max`. */
  max: z.number().optional(),
  /** `min_length` — the declared `Field.minLength`. */
  minLength: z.number().optional(),
  /** `max_length` — the declared `Field.maxLength`. */
  maxLength: z.number().optional(),
  /**
   * The offending measurement of the supplied value — the string's length for
   * the length codes. (The value ITSELF is deliberately not echoed for the
   * length codes: it can be a 3000-character blob or hold sensitive input.)
   */
  actual: z.number().optional(),
  /** The offending value, for codes where it is short and safe to echo (options, states). */
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  /** Allowed values, comma-joined for display (`options` carries the array form). */
  allowed: z.string().optional(),
  /** The field's declared `type`, for the type-shaped codes (`invalid_type`, dates). */
  type: z.string().optional(),
  /** Value-shape detail from the spec's derived schema (`invalid_type`, ADR-0104). */
  detail: z.string().optional(),
  /** `invalid_transition` — the state being left / entered. */
  from: z.union([z.string(), z.number()]).optional(),
  to: z.union([z.string(), z.number()]).optional(),
}).catchall(z.unknown()));

export type FieldValidationParams = z.infer<typeof FieldValidationParamsSchema>;

/**
 * One offending field in a `VALIDATION_FAILED` envelope.
 *
 * `field` is the API name (what the client PATCHed and what a form must
 * highlight); `label` is the same field's display name in the caller's locale
 * (what a human reads). They are BOTH present because they answer different
 * questions — a UI needs the API name to focus the input and the label to write
 * the sentence, and collapsing them is exactly how `penalty_amount must be ≥ 0`
 * reached end users.
 */
export const FieldValidationErrorSchema = lazySchema(() => z.object({
  field: z.string().describe('API field name (snake_case) — what the client supplied'),
  code: FieldValidationCode.describe('Machine identity of the violated constraint'),
  message: z.string().describe('Human-readable message, rendered in the caller’s locale'),
  label: z.string().optional().describe('Field display label in the caller’s locale'),
  params: FieldValidationParamsSchema.optional().describe('Discrete constraint values for client-side formatting'),
  options: z.array(z.string()).optional().describe('Allowed values for select/multiselect'),
}));

export type FieldValidationError = z.infer<typeof FieldValidationErrorSchema>;
