// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7799] The persistence seam for a webhook's HMAC signing secret.
 *
 * ## The defect
 * `bootstrapDeclaredWebhooks` used to persist the whole validated `Webhook`
 * envelope — `secret` included — as `definition_json: JSON.stringify(wh)`, and
 * `AutoEnqueuer.parseRow` read `defn.secret` straight back out to sign
 * deliveries. `definition_json` is an ordinary textarea on an admin-authorable
 * object with no restrictive `enable.apiMethods`, so an ordinary
 * `GET /api/v1/data/sys_webhook` returned the key to every persona that can read
 * the object. That key is the receiver's ONLY proof a delivery came from us.
 *
 * #7722 removed the same secret's per-attempt copies from `sys_http_delivery`;
 * this is the remaining cleartext location, and unlike the delivery table it is
 * not bounded by a retention window.
 *
 * ## The seam
 * Nothing about the AUTHORING envelope changes — authors still write
 * `secret: '…'` on `defineWebhook()`, and `webhook.zod.ts` is untouched. What
 * changes is where the value LANDS:
 *
 *   authored `secret`  →  `sys_webhook.signing_secret` (`type: 'secret'`)
 *                      →  engine encrypts → `sys_secret` ciphertext row
 *                      →  row keeps only an opaque `secret:<id>` ref
 *                      →  every read path returns the mask
 *
 *   `definition_json`  →  the same envelope MINUS `secret`
 *
 * and the enqueuer recovers the plaintext server-side, at cache-refresh time,
 * through `engine.resolveSecretField()` — the privileged, driver-level
 * dereference added alongside this change, because the encrypted channel masks
 * its own ref on every supported read path and a server-side consumer
 * previously had no way to get at it.
 *
 * ## Two things this file deliberately does NOT do
 * - It does not invent a second cipher store. The engine owns the
 *   `ICryptoProvider` (the host injects it via `setCryptoProvider`, and it is
 *   not a kernel service), so the plugin cannot encrypt on its own — it writes
 *   cleartext INTO the `secret`-typed column exactly once and lets the engine's
 *   own write path do the wrapping. That also inherits the engine's fail-closed
 *   posture for free: no provider ⇒ the write throws ⇒ we skip the webhook
 *   loudly, rather than silently re-opening the hole in a new column.
 * - It does not guess. When a row HAS a stored secret the enqueuer cannot
 *   resolve, the subscription is dropped rather than delivered unsigned — an
 *   undelivered webhook is visible and safe, an unsigned one is invisible and
 *   is precisely the failure this issue is about.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';

/** Column on `sys_webhook` holding the encrypted signing key. */
export const WEBHOOK_SECRET_FIELD = 'signing_secret';

/** Object whose rows carry it. Kept here so seeder/enqueuer/sweep agree. */
export const WEBHOOK_OBJECT = 'sys_webhook';

/**
 * Error code + status carried by the refusal this seam can raise, per ADR-0112:
 * a consumer branches on `code`, not on message text. `INTERNAL_ERROR`/500 is
 * the standard-catalog member for "the server is misconfigured and cannot honour
 * this safely" — no CryptoProvider is wired, so there is nowhere to put the key
 * that is not cleartext.
 */
export const WEBHOOK_SECRET_REFUSAL_CODE = 'INTERNAL_ERROR';
export const WEBHOOK_SECRET_REFUSAL_STATUS = 500;

/**
 * True when `err` is the engine's fail-closed refusal to persist a `secret`
 * field — no CryptoProvider registered, or no reachable `sys_secret` store.
 * Matched on the engine's own wording because that path throws a bare `Error`;
 * a false negative only costs a less specific log line, never cleartext.
 */
export function isSecretProtectionFailure(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '');
  return /Cannot persist secret field/i.test(msg);
}

/**
 * [#8542] A signing secret IS stored on the row and could not be recovered.
 *
 * ## Why this is an error and not a `undefined`
 * `resolveWebhookSecret` used to return `undefined` for two different facts —
 * *"the author configured this webhook unsigned"* and *"a key is stored but
 * nothing came back"* — and its caller acts on the first reading, which is the
 * legitimate one. So the second silently became the first: the subscription
 * ARMED and every delivery went out unauthenticated while `sys_webhook` kept
 * reading `active: true`. Nothing logged, nothing dropped. That is the #7799
 * signing invariant failing OPEN, and the direction is the whole defect — the
 * two adjacent failure modes (a throwing resolver, an engine with no encrypted
 * channel) both fail CLOSED and loud.
 *
 * Presence is decidable even when the value is not: the generic read path
 * returns the engine's mask for a set secret and `null` for an unset one, so
 * the caller already knows a value is stored before it asks for the plaintext.
 * Raising here rather than at each caller is what makes the rule one rule —
 * `AutoEnqueuer.attachSecret` needs no new branch, because a stored-but-
 * unresolvable key now arrives exactly the way a throwing resolver already did.
 *
 * Carries the ADR-0112 pair as fields so a consumer branches on `code`/`status`
 * rather than on message text. Same pair the seeder's refusal already reports
 * for the same underlying cause.
 */
export class WebhookSecretUnresolvableError extends Error {
  readonly code = WEBHOOK_SECRET_REFUSAL_CODE;
  readonly status = WEBHOOK_SECRET_REFUSAL_STATUS;
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSecretUnresolvableError';
  }
}

/**
 * True when `err` is this seam's refusal to hand back a key it could not
 * recover — as opposed to any other failure, which means "we could not even
 * check" and must not be softened into a verdict.
 *
 * The distinction has one consumer today: the redeliver guard, whose contract
 * is a returned refusal REASON rather than a throw (#8069). Everything on the
 * enqueue path just lets it propagate into the `catch` that already parks the
 * subscription.
 */
export function isWebhookSecretUnresolvable(
  err: unknown,
): err is WebhookSecretUnresolvableError {
  return err instanceof WebhookSecretUnresolvableError;
}

/**
 * Split an authored envelope into the part that is safe to serialize into
 * `definition_json` and the key that must go to the encrypted column.
 *
 * The key is REMOVED, not blanked: leaving `"secret": ""` behind would still
 * teach the next reader that this blob is where the key lives, and a later
 * merge could refill it.
 */
export function splitWebhookSecret<T extends Record<string, unknown>>(
  wh: T,
): { envelope: Omit<T, 'secret'>; secret: string | undefined } {
  const { secret, ...envelope } = wh as T & { secret?: unknown };
  const value = typeof secret === 'string' && secret.length > 0 ? secret : undefined;
  return { envelope: envelope as Omit<T, 'secret'>, secret: value };
}

/**
 * Read a legacy cleartext secret out of a `definition_json` blob.
 *
 * Rows written before #7799 — and rows an admin hand-edited into the textarea —
 * still carry one. Returns `undefined` for anything else, including unparseable
 * JSON (a malformed blob is not a credential).
 */
export function readLegacySecret(definitionJson: unknown): string | undefined {
  if (typeof definitionJson !== 'string' || definitionJson.length === 0) return undefined;
  try {
    const parsed = JSON.parse(definitionJson);
    const secret = (parsed as { secret?: unknown } | null)?.secret;
    return typeof secret === 'string' && secret.length > 0 ? secret : undefined;
  } catch {
    return undefined;
  }
}

// `stripSecretFromDefinition` lived here until #7986. Its single caller — the
// boot sweep — now has to remove BOTH credential passengers from the blob, and
// doing that as two independent parse/serialize round-trips would let the two
// removals disagree about what the blob contained. The sweep owns one
// `stripCredentialsFromDefinition` instead, built from `splitWebhookSecret` +
// `splitWebhookHeaders` over a single parse.

/**
 * objectql's two wire forms for the encrypted channel, restated here ONLY as a
 * "this value is not the key" guard.
 *
 * This package deliberately takes no dependency on `@objectstack/objectql` (it
 * declares the messaging surface structurally for the same reason), so the
 * constants cannot be imported — and a signing key is the one place where
 * guessing is unacceptable: sign with the mask and every receiver rejects every
 * delivery, silently, forever. `webhook-secret-at-rest.test.ts` pins both
 * against objectql's own exports so a rename there reddens here.
 */
const OBJECTQL_SECRET_MASK = '••••••••';
const OBJECTQL_SECRET_REF_PREFIX = 'secret:';

/** True when a column value is objectql's mask or ref — opaque, never the key. */
export function isOpaqueSecretForm(value: unknown): boolean {
  return (
    typeof value === 'string'
    && (value === OBJECTQL_SECRET_MASK || value.startsWith(OBJECTQL_SECRET_REF_PREFIX))
  );
}

/** Test-only accessors for the pin above. */
export const __objectqlSecretWireForms = {
  mask: OBJECTQL_SECRET_MASK,
  refPrefix: OBJECTQL_SECRET_REF_PREFIX,
} as const;

/** Engines that expose the privileged dereference (ObjectQL ≥ #7799). */
type SecretResolvingEngine = IDataEngine & {
  resolveSecretField?(object: string, recordId: string, field: string): Promise<string | null>;
  onCryptoProviderChange?(listener: () => void): () => void;
};

/** True when this engine can dereference an encrypted field. */
export function canResolveSecrets(engine: IDataEngine | undefined): boolean {
  return typeof (engine as SecretResolvingEngine | undefined)?.resolveSecretField === 'function';
}

/**
 * [#8022] Subscribe to the engine's crypto-provider registration. Returns an
 * unsubscribe function, or `undefined` when the engine has no such channel.
 *
 * ## Why this exists
 * Resolving a stored key stays fail-closed (#7799) — that is not what this
 * changes. What it changes is how long a fail-closed READ is allowed to stand
 * when the reason for it is about to disappear. "No CryptoProvider" is not only
 * a misconfiguration: on every host it is also a *transient boot state*, because
 * plugins run inside `kernel:ready` and the composition root injects the
 * provider only after `runtime.start()` returns. So the enqueuer's FIRST cache
 * build reliably precedes the capability it needs, drops every secret-bearing
 * subscription (correctly, on what it could see), and — before this — stayed
 * dropped until the next periodic refresh 60s later.
 *
 * Feature-detected rather than required, exactly like `resolveSecretField`
 * above, because this package deliberately takes no dependency on
 * `@objectstack/objectql`. An engine without the channel keeps the previous
 * behaviour — the periodic refresh remains the backstop — rather than failing
 * to start.
 */
export function onCryptoProviderChange(
  engine: IDataEngine | undefined,
  listener: () => void,
): (() => void) | undefined {
  const observable = engine as SecretResolvingEngine | undefined;
  if (typeof observable?.onCryptoProviderChange !== 'function') return undefined;
  return observable.onCryptoProviderChange(listener);
}

/**
 * Recover a row's signing key. Returns `undefined` for EXACTLY one fact — the
 * row has no stored key — which is not an error: `secret` is optional on the
 * authoring envelope, and an unsigned webhook is a legitimate authored choice.
 *
 * Throws {@link WebhookSecretUnresolvableError} when a key IS stored and does
 * not come back. Callers must treat that as "drop this subscription", never as
 * "deliver unsigned".
 *
 * ## [#8542] Why "did not come back" is not spelled `undefined`
 * The dereference has three measured ways to answer `null` while a value is
 * genuinely stored, all of them reaching this function identically:
 *
 *  1. the `sys_webhook` row is deleted between the enqueuer's cache read and
 *     this dereference (`resolveSecretField` opens `if (!row) return null`);
 *  2. the column holds something that is not a `secret:` ref — measured as
 *     reachable only through a write that BYPASSES the engine (a hand-edited
 *     column, a dump restored without its `sys_secret` rows, a seed script
 *     writing at driver level). The engine's own write path defends both
 *     obvious routes: an echoed mask is dropped and cleartext is re-encrypted;
 *  3. the ciphertext decrypts to the empty string — reachable through the
 *     ORDINARY data API, which accepts `signing_secret: ''`, mints a real
 *     `sys_secret` row for it, and leaves the column holding a perfectly valid
 *     ref that reads back as the mask.
 *
 * In all three the row still advertises a stored secret on every read path, so
 * returning `undefined` told the caller the opposite of what the row says.
 */
export async function resolveWebhookSecret(
  engine: IDataEngine,
  row: { id: string; [k: string]: unknown },
  object: string = WEBHOOK_OBJECT,
): Promise<string | undefined> {
  const stored = row[WEBHOOK_SECRET_FIELD];
  // Unset / cleared. On the generic read path a set secret comes back as the
  // engine's mask (a non-empty string) and an unset one as `null`, so presence
  // is decidable here WITHOUT the value ever being readable. Everything below
  // this line therefore runs with "a secret IS stored" already established —
  // which is the knowledge the old `undefined` return threw away.
  if (stored == null || stored === '') return undefined;

  const resolver = engine as SecretResolvingEngine;
  if (typeof resolver.resolveSecretField !== 'function') {
    // An engine with no encrypted-field channel stored verbatim what the seeder
    // handed it, so the column IS the key — reading it is correct, not a
    // fallback. The refusal below is for the narrow case where the value is one
    // of objectql's opaque forms and there is no way to invert it.
    if (!isOpaqueSecretForm(stored)) return String(stored);
    throw new WebhookSecretUnresolvableError(
      `Webhook "${String(row.name ?? row.id)}" stores an encrypted signing secret, but this data `
        + 'engine does not implement resolveSecretField() — the key cannot be recovered, so the '
        + 'subscription is dropped rather than delivered unsigned (#7799).',
    );
  }
  const plain = await resolver.resolveSecretField(object, String(row.id), WEBHOOK_SECRET_FIELD);
  if (typeof plain === 'string' && plain.length > 0) return plain;

  throw new WebhookSecretUnresolvableError(
    `Webhook "${String(row.name ?? row.id)}" stores a signing secret in `
      + `${object}.${WEBHOOK_SECRET_FIELD} that resolved to nothing. A value IS stored — the read `
      + 'path returns the engine mask for it — so this is NOT an unsigned webhook, and delivering '
      + 'it unsigned would strip the receiver of its only proof of origin (#7799, #8542). Causes, '
      + 'in the order worth checking: the row was deleted while this refresh was reading it; the '
      + 'column holds something that is not a secret: ref (a hand-edited column, or a dump restored '
      + 'without its sys_secret rows); or the stored value decrypts to an empty string. Fix: re-save '
      + 'the webhook secret so the column holds a fresh ref, or CLEAR the field to null if this '
      + 'webhook is meant to be unsigned — an empty secret is not the same thing as no secret.',
  );
}
