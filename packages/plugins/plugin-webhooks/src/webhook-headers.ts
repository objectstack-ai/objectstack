// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7986] The persistence seam for a webhook's custom `headers` map — the
 * sibling passenger #7799 left behind on the blob it emptied.
 *
 * ## The defect
 * #7799 moved the signing secret out of `sys_webhook.definition_json` into an
 * encrypted column. It did not move `headers`, and `headers` is the ordinary
 * place an `Authorization: Bearer …` goes. Same column, same object with no
 * `enable` block at all (so the FULL default data API), same unbounded
 * retention — the only thing that differed was which key of the blob the card
 * happened to name. `GET /api/v1/data/sys_webhook` handed the header map back
 * to every persona that can read the object.
 *
 * That framing is the finding: the COLUMN was the problem and the secret was
 * only one of its passengers.
 *
 * ## Why the WHOLE map moves, and not just the credential-looking entries
 * A signing secret is one opaque value with one consumer. `headers` is an
 * open-ended `Record<string, string>` in which only some entries are
 * credentials — and **the platform cannot tell which**. Three ways to decide
 * were on the table; this is why the map moves whole:
 *
 *  - **Guess from the header NAME** (`authorization`, `x-api-key`, …). Rejected:
 *    it is fail-OPEN on precisely the names most likely to be a credential in
 *    practice — `X-Acme-Token`, `X-Vendor-Key` — and a heuristic that silently
 *    passes the one header that mattered is worse than no heuristic, because it
 *    reads as coverage. Every other credential decision in this repo fails
 *    closed; this one would not.
 *  - **Have the author DECLARE which are sensitive** (`secretHeaders: [...]`).
 *    That is a change to the authoring envelope (`webhook.zod.ts`), which is
 *    the spec seat's surface, not this one — and it would still leave the
 *    `source: 'flow'` half of the same exposure untouched, because a flow
 *    `http` node's headers are interpolated per run and never parsed through
 *    `WebhookSchema` at all. Escalated rather than attempted here (#7986).
 *  - **Move the whole map.** Fail-closed by construction, needs no authoring
 *    change, and the cost it is accused of — "it encrypts non-sensitive headers
 *    too" — is measured and small: `definition_json` is a raw JSON textarea
 *    pending a real builder (see `sys-webhook.object.ts`), so what an admin
 *    loses is the ability to READ back a `Content-Type` they typed, on a
 *    surface that was never the intended authoring UI.
 *
 * ## The seam
 * Identical in shape to `webhook-secret.ts`, deliberately — one mechanism, two
 * passengers, so a reader who has understood #7799 has already understood this:
 *
 *   authored `headers`  →  `sys_webhook.headers_secret` (`type: 'secret'`)
 *                       →  engine encrypts the SERIALIZED map → `sys_secret`
 *                       →  row keeps only an opaque `secret:<id>` ref
 *                       →  every read path returns the mask
 *
 *   `definition_json`   →  the same envelope MINUS `headers` (and MINUS
 *                          `secret`, as #7799 already established)
 *
 * The map is serialized because the encrypted channel carries a string. That is
 * an encoding detail and not a second format: {@link parseStoredHeaders} is the
 * only reader, and it treats anything that is not a flat string map as absent
 * rather than guessing.
 *
 * ## What this file deliberately does NOT do
 * - It does not invent a second cipher store, for the same layering reason
 *   `webhook-secret.ts` gives: the engine owns the `ICryptoProvider`, so the
 *   plugin writes cleartext INTO the `secret`-typed column exactly once and
 *   lets the engine's write path wrap it. The fail-closed posture comes free.
 * - It does not deliver partially. A row whose stored headers cannot be
 *   resolved DROPS the subscription rather than delivering it with the headers
 *   missing — see {@link resolveWebhookHeaders}.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { isOpaqueSecretForm } from './webhook-secret.js';

/** Column on `sys_webhook` holding the encrypted custom-header map. */
export const WEBHOOK_HEADERS_FIELD = 'headers_secret';

/** Engines that expose the privileged dereference (ObjectQL ≥ #7799). */
type SecretResolvingEngine = IDataEngine & {
  resolveSecretField?(object: string, recordId: string, field: string): Promise<string | null>;
};

/** A header map, as the authoring envelope declares it. */
export type WebhookHeaders = Record<string, string>;

/**
 * True when `value` is a flat `Record<string, string>` with at least one entry.
 *
 * Anything else — an array, a nested object, a map of numbers — is treated as
 * ABSENT rather than coerced. A header map is about to be written onto the
 * wire; a coerced `[object Object]` header value is a silently corrupted
 * request, and the authoring schema (`z.record(z.string(), z.string())`)
 * already rejects the shape at every declared door.
 */
function isHeaderMap(value: unknown): value is WebhookHeaders {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(([, v]) => typeof v === 'string');
}

/**
 * Split an authored envelope into the part that is safe to serialize into
 * `definition_json` and the header map that must go to the encrypted column.
 *
 * The map is REMOVED, not blanked, for the reason `splitWebhookSecret` gives
 * about the secret: leaving `"headers": {}` behind still teaches the next
 * reader that this blob is where headers live, and a later merge could refill
 * it.
 */
export function splitWebhookHeaders<T extends Record<string, unknown>>(
  wh: T,
): { envelope: Omit<T, 'headers'>; headers: WebhookHeaders | undefined } {
  const { headers, ...envelope } = wh as T & { headers?: unknown };
  return {
    envelope: envelope as Omit<T, 'headers'>,
    headers: isHeaderMap(headers) ? headers : undefined,
  };
}

/** Serialize a header map for the encrypted column (which carries a string). */
export function serializeHeaders(headers: WebhookHeaders): string {
  return JSON.stringify(headers);
}

/** Inverse of {@link serializeHeaders}. Non-conforming input reads as absent. */
export function parseStoredHeaders(stored: unknown): WebhookHeaders | undefined {
  if (typeof stored !== 'string' || stored.length === 0) return undefined;
  try {
    const parsed = JSON.parse(stored);
    return isHeaderMap(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a legacy cleartext header map out of a `definition_json` blob.
 *
 * Rows written before this change — and rows an admin hand-edited into the
 * textarea — still carry one. Returns `undefined` for anything else, including
 * unparseable JSON (a malformed blob is not a credential).
 */
export function readLegacyHeaders(definitionJson: unknown): WebhookHeaders | undefined {
  if (typeof definitionJson !== 'string' || definitionJson.length === 0) return undefined;
  try {
    const parsed = JSON.parse(definitionJson) as { headers?: unknown } | null;
    return isHeaderMap(parsed?.headers) ? parsed.headers : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Recover a row's custom headers. Returns `undefined` when the row stores none
 * — which is not an error: `headers` is optional on the authoring envelope.
 *
 * Throws when headers ARE stored but cannot be dereferenced. Callers must treat
 * that as "drop this subscription", never as "deliver without them" — see
 * `AutoEnqueuer.attachCredentials` for why partial delivery is the invisible
 * failure and a stopped subscription is the visible one.
 */
export async function resolveWebhookHeaders(
  engine: IDataEngine,
  row: { id: string; [k: string]: unknown },
  object: string,
): Promise<WebhookHeaders | undefined> {
  const stored = row[WEBHOOK_HEADERS_FIELD];
  // Unset / cleared. On the generic read path a set secret comes back as the
  // engine's mask (a non-empty string) and an unset one as `null`, so presence
  // is decidable here WITHOUT the value ever being readable.
  if (stored == null || stored === '') return undefined;

  const resolver = engine as SecretResolvingEngine;
  if (typeof resolver.resolveSecretField !== 'function') {
    // An engine with no encrypted-field channel stored verbatim what the seeder
    // handed it, so the column IS the serialized map — reading it is correct,
    // not a fallback. The refusal below is for the narrow case where the value
    // is one of objectql's opaque forms and there is no way to invert it.
    if (!isOpaqueSecretForm(stored)) return parseStoredHeaders(stored);
    throw new Error(
      `Webhook "${String(row.name ?? row.id)}" stores encrypted custom headers, but this data engine `
        + 'does not implement resolveSecretField() — they cannot be recovered, so the subscription is '
        + 'dropped rather than delivered without the headers it was authored with (#7986).',
    );
  }
  const plain = await resolver.resolveSecretField(object, String(row.id), WEBHOOK_HEADERS_FIELD);
  return parseStoredHeaders(plain);
}

/**
 * Decide what a RE-SEED should do with an existing row's `headers_secret`.
 *
 * Same discipline, and the same reason, as `secretPatch` in
 * `bootstrap-declared-webhooks.ts`: a `secret`-typed write always mints a fresh
 * `sys_secret` ciphertext row and the engine never deletes the superseded one,
 * so blindly restating the declared headers on every boot would leak one orphan
 * cipher row per webhook per restart.
 *
 *  - declared map differs from stored ⇒ write it (an edit in code propagates);
 *  - identical ⇒ omit the key entirely, leaving the existing ref untouched;
 *  - declared headers removed, row still holds some ⇒ write `null` to CLEAR
 *    (code remains the authority for package rows);
 *  - engine cannot dereference (older engine, or the compare threw) ⇒ fall back
 *    to writing the declared value. A correct request beats tidy storage.
 */
export async function headersPatch(
  engine: IDataEngine,
  declared: WebhookHeaders | undefined,
  row: { id: string; [k: string]: unknown },
  object: string,
): Promise<Record<string, unknown>> {
  const hasStored = row?.[WEBHOOK_HEADERS_FIELD] != null && row[WEBHOOK_HEADERS_FIELD] !== '';

  if (!declared) return hasStored ? { [WEBHOOK_HEADERS_FIELD]: null } : {};

  const serialized = serializeHeaders(declared);
  const resolver = engine as SecretResolvingEngine;
  if (!hasStored || typeof resolver.resolveSecretField !== 'function') {
    return { [WEBHOOK_HEADERS_FIELD]: serialized };
  }

  try {
    const current = await resolver.resolveSecretField(object, String(row.id), WEBHOOK_HEADERS_FIELD);
    // Compared as the CANONICAL serialization on both sides, not as raw
    // strings: the stored form was produced by this same function, so key order
    // is stable, and a re-parse guards against a hand-edited value that differs
    // only in whitespace re-encrypting on every boot.
    const stored = parseStoredHeaders(current);
    return stored && serializeHeaders(stored) === serialized
      ? {}
      : { [WEBHOOK_HEADERS_FIELD]: serialized };
  } catch {
    return { [WEBHOOK_HEADERS_FIELD]: serialized };
  }
}
