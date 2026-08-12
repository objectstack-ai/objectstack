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

/** Strip `secret` from a serialized envelope, preserving every other key. */
export function stripSecretFromDefinition(definitionJson: string): string {
  const parsed = JSON.parse(definitionJson) as Record<string, unknown>;
  const { envelope } = splitWebhookSecret(parsed);
  return JSON.stringify(envelope);
}

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
 * Recover a row's signing key. Returns `undefined` when the row has no stored
 * key — which is not an error: `secret` is optional on the authoring envelope,
 * and an unsigned webhook is a legitimate (authored) configuration.
 *
 * Throws when a key IS stored but cannot be dereferenced. Callers must treat
 * that as "drop this subscription", never as "deliver unsigned".
 */
export async function resolveWebhookSecret(
  engine: IDataEngine,
  row: { id: string; [k: string]: unknown },
  object: string = WEBHOOK_OBJECT,
): Promise<string | undefined> {
  const stored = row[WEBHOOK_SECRET_FIELD];
  // Unset / cleared. On the generic read path a set secret comes back as the
  // engine's mask (a non-empty string) and an unset one as `null`, so presence
  // is decidable here WITHOUT the value ever being readable.
  if (stored == null || stored === '') return undefined;

  const resolver = engine as SecretResolvingEngine;
  if (typeof resolver.resolveSecretField !== 'function') {
    // An engine with no encrypted-field channel stored verbatim what the seeder
    // handed it, so the column IS the key — reading it is correct, not a
    // fallback. The refusal below is for the narrow case where the value is one
    // of objectql's opaque forms and there is no way to invert it.
    if (!isOpaqueSecretForm(stored)) return String(stored);
    throw new Error(
      `Webhook "${String(row.name ?? row.id)}" stores an encrypted signing secret, but this data `
        + 'engine does not implement resolveSecretField() — the key cannot be recovered, so the '
        + 'subscription is dropped rather than delivered unsigned (#7799).',
    );
  }
  const plain = await resolver.resolveSecretField(object, String(row.id), WEBHOOK_SECRET_FIELD);
  return typeof plain === 'string' && plain.length > 0 ? plain : undefined;
}
