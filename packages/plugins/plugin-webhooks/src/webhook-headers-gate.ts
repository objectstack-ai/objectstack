// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8566] The WRITE DOOR for `sys_webhook.headers_secret`'s plaintext shape.
 *
 * ## The defect this closes
 * `headers_secret` is a `Field.secret()` whose plaintext is not an opaque blob:
 * it is a serialized header map with a required shape — a flat JSON object of
 * string values — and {@link parseStoredHeaders} is its only reader. Nothing
 * validated that shape on the way in. The ordinary data API accepted any
 * string, the engine encrypted it like any other secret, minted a real
 * `sys_secret` row, and left the column holding a perfectly valid `secret:` ref
 * that reads back as the mask with `active: true`. Measured on a real engine
 * through `engine.update()` — no privileged access — every one of these was
 * accepted and is a value the plugin can never use: `{}`, `[]`,
 * `{"X-Count": 5}`, a nested object, and `{X-Team: crm}` (a typo).
 *
 * ## What this is NOT
 * ⛔ Not an exposure fix, and it must not be graded as one. #8558/#8565 already
 * closed the consumer half: a webhook whose stored header map does not come
 * back as a flat string map PARKS the subscription and reports at `error`
 * rather than delivering header-less with a valid signature. Nothing leaks and
 * nothing is silently lost today.
 *
 * What remains — and all this file changes — is **when the author finds out**.
 * Today: at the next matching record change, an unbounded time after the
 * mistake and in a completely different surface from the one where it was made.
 * With this gate: at the write door, where the author is still standing. The
 * field is directly admin-authorable and its own description instructs the
 * author to type a JSON object into it, which makes a typo the EXPECTED failure
 * rather than an exotic one.
 *
 * ## Why a hook, and why THIS hook
 * Maintainer ruling 2026-08-13 (option 2). Validating at the plugin's own write
 * paths (`bootstrapDeclaredWebhooks` / `headersPatch` / the migration sweep)
 * was rejected as insufficient: a direct `PATCH /api/v1/data/sys_webhook` never
 * goes through any of them, and that is the measured trigger. An engine hook
 * covers every door at once — the generic data API, the Setup UI, scripts, the
 * console — and the plugin's own write paths inherit it automatically, so there
 * is deliberately NO second check on them.
 *
 * Same rationale, and the same shape, as {@link bindWebhookProvenanceStamp}
 * next door: one engine hook rather than N door-side checks.
 *
 * ## ⭐ Order is the whole mechanism: this MUST run before `encryptSecretFields`
 * The engine encrypts a `secret` field on the way to the driver; one step later
 * the plaintext is gone and the column holds an opaque ref. A validator that
 * ran after it would have nothing left to validate. `beforeInsert` /
 * `beforeUpdate` hooks are dispatched BEFORE that encryption on every write
 * path (measured in `packages/objectql/src/engine.ts`: insert triggers its
 * hooks and then encrypts; both the by-id and the multi update arms do the
 * same), which is what makes this seam the right one and not merely a
 * convenient one. `webhook-headers-gate.test.ts` pins the ordering against the
 * real engine rather than trusting this paragraph.
 *
 * ## The four values this gate deliberately lets through
 * Each is someone else's verdict, and duplicating any of them here would create
 * a second owner for a rule that already has one:
 *
 *  1. **the key is absent** — "leave the stored value unchanged";
 *  2. **`null` / `undefined`** — the CLEAR spelling, which the engine honours
 *     and which the refusal message below points authors at;
 *  3. **`""`** — governed by #8559's ruling and refused by the engine's own
 *     `encryptSecretFields` a few lines later, with a message that already
 *     names `null` as the way to clear. ⚠️ The dispatch note said this gate
 *     "can assume it never sees `\"\"`"; measured, that is inverted — this hook
 *     runs FIRST, so it does see it and must pass it through untouched for
 *     #8559's seam to answer. Refusing it here would duplicate that ruling and
 *     put two different messages on one door;
 *  4. **the engine's opaque wire forms** ({@link isOpaqueSecretForm}) — the
 *     read mask and a `secret:` ref. The mask is the echoed-read-mask case the
 *     ruling calls out by name: a caller that GETs a row and PATCHes it back
 *     unchanged sends the mask, and the engine drops that key as "unchanged".
 *     Refusing it would break every round-trip through the Setup form, which is
 *     the single most ordinary write this object receives. A ref is the same
 *     story one layer down (the engine leaves an already-encrypted ref alone).
 *
 * ## Why the verdict is `parseStoredHeaders`, not a second shape rule
 * The door refuses EXACTLY what the consumer cannot use, because it asks the
 * consumer's own question: the value is normalized the way the engine will
 * normalize it, then handed to {@link parseStoredHeaders} — the same function
 * the enqueuer reads stored headers with. A hand-written second predicate here
 * could drift from that one, and a door that refuses a value the consumer would
 * have accepted (or accepts one it cannot use) is worse than no door. One rule,
 * one definition.
 *
 * ## ⛔ The refusal never echoes the value
 * This column carries credentials — an `Authorization: Bearer …` is the header
 * the field's own description uses as its example. A validation message that
 * quoted the rejected input would print that token into logs and HTTP error
 * bodies, i.e. re-open in the diagnostic exactly the exposure #7986 moved this
 * field onto the encrypted channel to close. So the diagnostic names TYPES and
 * KEYS only — header names are not credentials, their values are — and never a
 * value.
 *
 * ## Promotion path (⛔ not built here)
 * A general capability on the `secret` channel — letting any `secret`-typed
 * field declare a plaintext validator — is the principled generalization and is
 * recorded as the shape this becomes the moment a SECOND shaped-plaintext
 * `secret` field exists. It is deliberately not built for one consumer
 * (maintainer ruling 2026-08-13, item 3; startup scope). Whoever hits that
 * second field files against this precedent.
 */

import {
  HEADERS_REMEDY,
  WEBHOOK_HEADERS_FIELD,
  parseStoredHeaders,
} from './webhook-headers.js';
import { WEBHOOK_OBJECT, isOpaqueSecretForm } from './webhook-secret.js';

/**
 * ADR-0112 envelope for this refusal. `VALIDATION_ERROR`/400 is the standard
 * catalog member for "the payload is not acceptable" — the SAME pair #8559's
 * `EmptyCredentialWriteError` carries at the same door for the same class of
 * verdict, so a client branching on `code`/`status` handles both malformed
 * credential writes identically. A standard-catalog code needs no ledger entry.
 */
export const WEBHOOK_HEADERS_SHAPE_REFUSAL_CODE = 'VALIDATION_ERROR';
export const WEBHOOK_HEADERS_SHAPE_REFUSAL_STATUS = 400;

/**
 * The shape the field's own description asks for, quoted in the refusal so the
 * error and the authoring surface cannot drift into two different specs.
 * Kept verbatim from `sys-webhook.object.ts`'s `headers_secret` description.
 */
const DECLARED_SHAPE =
  'Custom HTTP headers sent with each delivery, as a JSON object '
  + '({"Authorization": "Bearer ..."})';

/**
 * [#8566] Refusal to persist a `headers_secret` plaintext that is not a flat
 * JSON object of string values.
 *
 * Carries the ADR-0112 pair plus the LOCATION (`object`/`field`) as fields, so
 * a consumer branches on `code`/`status` rather than on message text — the same
 * discipline {@link WebhookHeadersUnresolvableError} follows on the read side
 * of this seam, and `EmptyCredentialWriteError` follows on the write side.
 */
export class WebhookHeadersShapeError extends Error {
  readonly code = WEBHOOK_HEADERS_SHAPE_REFUSAL_CODE;
  readonly status = WEBHOOK_HEADERS_SHAPE_REFUSAL_STATUS;
  readonly object: string;
  readonly field: string;

  constructor(object: string, field: string, diagnosis: string) {
    super(
      `Custom headers refused for "${object}.${field}": ${diagnosis}. The required shape is a FLAT `
        + 'JSON object of string values, which is what the field itself asks for — its description '
        + `reads: "${DECLARED_SHAPE}". This is checked at the write door because one step later `
        + 'there is nothing left to check: the engine encrypts this value into sys_secret and every '
        + 'read path returns only the mask, so a stored value that can never be used is '
        + 'indistinguishable from one that works until the next delivery tries to send it — at '
        + 'which point the subscription parks and the report arrives an unbounded time later, in a '
        + `different surface from the one it was typed into (#7986, #8558, #8566). ${HEADERS_REMEDY}`,
    );
    this.name = 'WebhookHeadersShapeError';
    this.object = object;
    this.field = field;
  }
}

/**
 * Describe a parsed value's SHAPE for the diagnostic — types and keys only,
 * never values (see the file header's note on why this message must not echo
 * the input). Header names are safe to name and are the single most useful
 * thing a typo-hunting author can be told.
 */
function describeParsed(parsed: unknown): string {
  if (parsed === null) return 'null';
  if (Array.isArray(parsed)) return 'a JSON array';
  if (typeof parsed !== 'object') return `a JSON ${typeof parsed}`;

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) {
    return 'an EMPTY JSON object, which is not the same thing as "send no custom headers"';
  }
  const bad = entries.filter(([, v]) => typeof v !== 'string');
  if (bad.length > 0) {
    const named = bad
      .map(([k, v]) => `${JSON.stringify(k)} (${Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v})`)
      .join(', ');
    return (
      `a JSON object, but the wire carries only strings and ${bad.length === 1 ? 'this value is' : 'these values are'} `
      + `not a string: ${named}`
    );
  }
  // Unreachable while `parseStoredHeaders` accepts exactly non-empty flat
  // string maps; kept truthful rather than asserting a shape we did not check.
  return 'a JSON object the header seam does not accept';
}

/** Describe the raw payload value, resolving the string/JSON layer first. */
function describeRejected(value: unknown): string {
  if (typeof value === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return (
        'the value is a string that is not valid JSON at all — check for unquoted keys or values '
        + '({X-Team: crm}), single quotes instead of double, or a trailing comma'
      );
    }
    return `the value parses as JSON but is ${describeParsed(parsed)}`;
  }
  return `the value is ${describeParsed(value)}`;
}

/**
 * The verdict, as a pure function of the write payload — exported so the gate
 * can be reasoned about and tested without booting an engine, and so any future
 * caller uses the same one rule rather than restating it.
 *
 * Mutates nothing and returns nothing: it either passes or throws
 * {@link WebhookHeadersShapeError}.
 */
export function assertWritableWebhookHeaders(
  data: Record<string, unknown> | null | undefined,
  object: string = WEBHOOK_OBJECT,
  field: string = WEBHOOK_HEADERS_FIELD,
): void {
  if (!data || typeof data !== 'object') return;
  if (!Object.prototype.hasOwnProperty.call(data, field)) return; // omitted ⇒ unchanged

  const value = data[field];
  if (value === null || typeof value === 'undefined') return; // the CLEAR spelling
  if (value === '') return; // #8559's seam owns this — see the file header
  if (isOpaqueSecretForm(value)) return; // echoed read-mask, or an existing ref

  // Normalize EXACTLY as the engine is about to: a string is taken as the
  // serialized map it claims to be, and anything else is JSON.stringify'd —
  // which is what `encryptSecretFields` does with a non-string secret value, so
  // an authored object that really is a flat string map keeps working (it
  // serializes to precisely the form the consumer reads back).
  let serialized: string;
  if (typeof value === 'string') {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(value) as string;
    } catch {
      // Circular / unserializable: the engine would store "[object Object]"-
      // class garbage or throw deeper in. Refuse it here, where the message can
      // say something useful.
      throw new WebhookHeadersShapeError(
        object,
        field,
        'the value cannot be serialized to JSON at all (it contains a circular reference)',
      );
    }
    // `JSON.stringify` answers `undefined` for a function or a symbol.
    if (typeof serialized !== 'string') {
      throw new WebhookHeadersShapeError(object, field, `the value is a ${typeof value}`);
    }
  }

  // The consumer's own question, asked at the door (see the file header).
  if (parseStoredHeaders(serialized)) return;

  throw new WebhookHeadersShapeError(object, field, describeRejected(value));
}

/** Minimal engine surface this binding needs — mirrors `webhook-provenance.ts`. */
interface MinimalEngine {
  registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void;
  unregisterHooksByPackage(packageId: string): number;
}

interface MinimalLogger {
  info?: (msg: string, meta?: Record<string, any>) => void;
}

export const WEBHOOK_HEADERS_GATE_PACKAGE = 'plugin-webhooks:headers-shape-gate';

/**
 * Priority 50 — ahead of the provenance stamp's 150 (lower runs first), so a
 * refused write is refused before anything else spends work on it. The stamp
 * issues a `find` against `sys_webhook` on every non-system update; there is no
 * reason to pay for it on a payload that is about to be rejected. Nothing about
 * correctness depends on the two hooks' relative order — only on both running
 * before `encryptSecretFields`, which every `before*` hook does.
 */
const GATE_PRIORITY = 50;

/**
 * Bind the shape gate to both write events on `sys_webhook`.
 *
 * ## Deliberately NOT exempt for `isSystem`
 * The provenance stamp next door skips system writes because it is detecting an
 * ADMIN edit; this is a validity verdict on a payload, and a malformed header
 * map is exactly as unusable when a seeder writes it. Ruling item 2 says the
 * plugin's own write paths inherit this validation through the hook, which is
 * only true if system writes are covered. They pass by construction —
 * `bootstrapDeclaredWebhooks` and the migration sweep both write
 * `serializeHeaders(...)` of an already `isHeaderMap`-filtered map — so
 * covering them costs nothing and closes the door for a future write path that
 * is less careful.
 *
 * Registered in CODE rather than from metadata, which also means
 * `session.skipAutomations` (an import run with automations unchecked) cannot
 * suppress it: the engine only skips metadata-bound entries. A validation door
 * that an import could switch off would not be a door.
 */
export function bindWebhookHeadersShapeGate(engine: MinimalEngine, logger?: MinimalLogger): void {
  if (typeof engine?.registerHook !== 'function') return;

  const handler = (ctx: any) => {
    assertWritableWebhookHeaders(ctx?.input?.data as Record<string, unknown> | undefined);
  };

  for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
    engine.registerHook(event, handler, {
      object: WEBHOOK_OBJECT,
      packageId: WEBHOOK_HEADERS_GATE_PACKAGE,
      priority: GATE_PRIORITY,
    });
  }

  logger?.info?.('[webhook] headers_secret shape gate bound (refuses non-flat-string-map plaintext)');
}

/** Remove the gate — mirrors `unbindWebhookProvenanceStamp`, for `dispose()`. */
export function unbindWebhookHeadersShapeGate(engine: MinimalEngine): void {
  if (typeof engine?.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(WEBHOOK_HEADERS_GATE_PACKAGE);
  }
}
