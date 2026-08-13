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
 *
 * [#8558] That last line was a statement of intent this file did not keep. Only
 * a THROWING resolver reached the caller's `catch`; a resolver that answered
 * `null` — or handed back a value that was not a flat string map — folded onto
 * the `undefined` this seam uses for "no headers stored", and the subscription
 * armed and delivered without them. {@link WebhookHeadersUnresolvableError} is
 * what makes the sentence true.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import {
  WEBHOOK_SECRET_REFUSAL_CODE,
  WEBHOOK_SECRET_REFUSAL_STATUS,
  isOpaqueSecretForm,
} from './webhook-secret.js';

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
 * [#8558] A header map IS stored on the row and did not come back as one.
 *
 * ## Why this is an error and not an `undefined`
 * `resolveWebhookHeaders` used to return `undefined` for two different facts —
 * *"the author configured this webhook with no custom headers"* and *"a map is
 * stored and did not come back"* — and its caller acts on the first reading,
 * which is the legitimate one. So the second silently became the first: the
 * subscription ARMED and every delivery went out missing the entire authored
 * header map, while `sys_webhook` kept reading `active: true` with
 * `headers_secret` masked, i.e. still reporting "custom headers are
 * configured". Measured end to end, what reached the receiver was a delivery
 * that SUCCEEDED, carrying a byte-correct `X-Objectstack-Signature`, with the
 * `Authorization` the author declared simply absent — and nothing logged.
 *
 * That the signature is VALID is what makes the direction so bad. It tells the
 * receiver the request is genuinely ours, so a receiver that authenticates by
 * signature has every reason to accept a request that no longer matches the
 * configuration its operator wrote. Against an endpoint that does not require
 * the header at all — a routing `X-Tenant-Id`, an `X-Environment: staging` —
 * the delivery is simply wrong and nobody finds out.
 *
 * Presence is decidable even when the value is not, and this is the one place
 * worth stating plainly because the field LOOKS like it should behave
 * differently: `headers_secret` is a map only in the plaintext. At the storage
 * layer it is an ordinary scalar `secret` column holding the serialized map, so
 * the generic read path returns the engine's mask for a set map and `null` for
 * an unset one — the same decidable signal `signing_secret` gives, for the same
 * reason. The "it is a map, not a scalar" worry does not survive measurement.
 *
 * Carries the ADR-0112 pair as fields so a consumer branches on `code`/`status`
 * rather than on message text — the same pair `attachHeaders`' drop report and
 * the signing seam's refusal already carry for the same class of cause.
 *
 * ## Why ONE error class for two conditions
 * A stored map reaches this seam and fails in two distinguishable ways: it
 * could not be RECOVERED (nothing came back), or it was recovered fine and is
 * not a usable header map. They deserve different remedies and get different
 * messages. They do not deserve different types: every consumer of this seam
 * branches on the ADR-0112 pair and the disposition, both identical — park the
 * subscription, record the discarded event, say it once. A second class with no
 * consumer would be a distinction the tree cannot act on.
 */
export class WebhookHeadersUnresolvableError extends Error {
  readonly code = WEBHOOK_SECRET_REFUSAL_CODE;
  readonly status = WEBHOOK_SECRET_REFUSAL_STATUS;
  constructor(message: string) {
    super(message);
    this.name = 'WebhookHeadersUnresolvableError';
  }
}

/** The remedy clause both refusals end with — one wording, stated once. */
const HEADERS_REMEDY =
  'Fix: re-save the webhook headers as a flat JSON object of string values so the column holds a '
  + 'fresh ref, or CLEAR the field to null if this webhook is meant to send no custom headers — an '
  + 'empty or unparseable header map is not the same thing as no header map, and only the second '
  + 'one means "send nothing extra".';

/**
 * Parse a recovered value into the map, or refuse.
 *
 * {@link parseStoredHeaders} answers `undefined` for every string that is not a
 * flat `Record` of strings, which is right for its own job and wrong as an
 * answer to *"what are this webhook's headers?"* once a value is known to be
 * stored. This is the narrow wrapper that turns the second reading into a
 * refusal, so the rule lives at the seam and no caller re-derives it.
 */
function requireHeaderMap(
  recovered: unknown,
  row: { id: string; [k: string]: unknown },
  where: string,
): WebhookHeaders {
  const parsed = parseStoredHeaders(recovered);
  if (parsed) return parsed;

  throw new WebhookHeadersUnresolvableError(
    `Webhook "${String(row.name ?? row.id)}" stores custom headers in ${where} that came back but are `
      + 'not a flat JSON object of string values, so there is no header map to send. A value IS stored '
      + '— the read path returns the engine mask for it — so this is NOT a webhook authored without '
      + 'headers, and delivering it without them would silently drop whatever the author put in that '
      + 'map, including an Authorization credential, on a delivery that is otherwise correctly signed '
      + 'and therefore looks genuine to the receiver (#7986, #8558). Causes, in the order worth '
      + 'checking: the value was typed into the Custom Headers field and is not valid JSON; it parses '
      + 'but is an array, an empty object, or has a non-string value ({"X-Count": 5}); or it is a '
      + `nested object where the wire format allows only strings. ${HEADERS_REMEDY}`,
  );
}

/**
 * Recover a row's custom headers. Returns `undefined` for EXACTLY one fact —
 * the row stores no headers — which is not an error: `headers` is optional on
 * the authoring envelope, and a webhook with no custom headers is a legitimate
 * authored configuration.
 *
 * Throws {@link WebhookHeadersUnresolvableError} when a map IS stored and does
 * not come back as one. Callers must treat that as "drop this subscription",
 * never as "deliver without them" — see `AutoEnqueuer.attachCredentials` for
 * why partial delivery is the invisible failure and a stopped subscription is
 * the visible one.
 *
 * ## [#8558] Why "did not come back" is not spelled `undefined`
 * This is the sibling of #8542 on `webhook-secret.ts`, and the measurement that
 * produced it found the header path is WIDER than the signing path rather than
 * symmetric to it. A signing secret is an opaque scalar: any non-empty answer
 * is a usable key, so only the empty string collapses. A header map's CONTENT
 * decides, so every one of these reaches this function as a stored-but-unusable
 * value, all confirmed against a real engine:
 *
 *  1. the `sys_webhook` row is deleted between the enqueuer's cache read and
 *     this dereference (`resolveSecretField` opens `if (!row) return null`);
 *  2. the column holds something that is not a `secret:` ref — reachable only
 *     through a write that BYPASSES the engine (a hand-edited column, a dump
 *     restored without its `sys_secret` rows, a seed script writing at driver
 *     level). The engine's own write path defends both obvious routes: an
 *     echoed mask is dropped and cleartext is re-encrypted;
 *  3. the ciphertext decrypts to the empty string;
 *  4. ⭐ the ciphertext decrypts to a perfectly readable string that is not a
 *     flat string map — `{}`, `[]`, `{"X-Count": 5}`, a nested object, or any
 *     typo. Reachable through the ORDINARY data API with no privileged access,
 *     and it is the WIDEST road here rather than an exotic one:
 *     `sys_webhook.headers_secret` is an admin-authorable field whose own
 *     description instructs the author to type a JSON object into it.
 *
 * In all four the row still advertises stored headers on every read path, so
 * returning `undefined` told the caller the opposite of what the row says.
 */
export async function resolveWebhookHeaders(
  engine: IDataEngine,
  row: { id: string; [k: string]: unknown },
  object: string,
): Promise<WebhookHeaders | undefined> {
  const stored = row[WEBHOOK_HEADERS_FIELD];
  // Unset / cleared. On the generic read path a set secret comes back as the
  // engine's mask (a non-empty string) and an unset one as `null`, so presence
  // is decidable here WITHOUT the value ever being readable. Everything below
  // this line therefore runs with "headers ARE stored" already established —
  // which is the knowledge the old `undefined` return threw away.
  if (stored == null || stored === '') return undefined;

  const resolver = engine as SecretResolvingEngine;
  if (typeof resolver.resolveSecretField !== 'function') {
    // An engine with no encrypted-field channel stored verbatim what the seeder
    // handed it, so the column IS the serialized map — reading it is correct,
    // not a fallback. It can still fail to parse, and that arm used to answer
    // `undefined` too; it is refused here for the same reason as everything
    // else on this seam.
    if (!isOpaqueSecretForm(stored)) {
      return requireHeaderMap(stored, row, `${object}.${WEBHOOK_HEADERS_FIELD}`);
    }
    throw new WebhookHeadersUnresolvableError(
      `Webhook "${String(row.name ?? row.id)}" stores encrypted custom headers, but this data engine `
        + 'does not implement resolveSecretField() — they cannot be recovered, so the subscription is '
        + 'dropped rather than delivered without the headers it was authored with (#7986).',
    );
  }
  const plain = await resolver.resolveSecretField(object, String(row.id), WEBHOOK_HEADERS_FIELD);
  if (plain == null || plain === '') {
    throw new WebhookHeadersUnresolvableError(
      `Webhook "${String(row.name ?? row.id)}" stores custom headers in `
        + `${object}.${WEBHOOK_HEADERS_FIELD} that resolved to nothing. A value IS stored — the read `
        + 'path returns the engine mask for it — so this is NOT a webhook authored without headers, '
        + 'and delivering it without them would silently drop whatever the author put in that map, '
        + 'including an Authorization credential, on a delivery that is otherwise correctly signed and '
        + 'therefore looks genuine to the receiver (#7986, #8558). Causes, in the order worth checking: '
        + 'the row was deleted while this refresh was reading it; the column holds something that is '
        + 'not a secret: ref (a hand-edited column, or a dump restored without its sys_secret rows); '
        + `or the stored value decrypts to an empty string. ${HEADERS_REMEDY}`,
    );
  }
  return requireHeaderMap(plain, row, `${object}.${WEBHOOK_HEADERS_FIELD}`);
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
