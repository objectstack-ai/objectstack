// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Secret-field channel — helpers for the `secret` FieldType.
 *
 * A `secret` field (DB password, API key, token) is **reversible**: the engine
 * encrypts it on write via the registered `ICryptoProvider`, persists the
 * ciphertext as a `sys_secret` row, and stores only an opaque *ref* on the
 * business row. On read the ref is masked, never the plaintext. This mirrors
 * the Settings subsystem (`sys_setting.value_enc → sys_secret.id`), generalized
 * to object fields.
 *
 * Contrast with `password` — a one-way hash owned by the auth subsystem, never
 * decrypted. The two never share a code path.
 */

import type { ServiceObject } from '@objectstack/spec/data';

/**
 * Prefix marking a persisted field value as a `sys_secret` handle ref rather
 * than cleartext. Chosen to be unambiguous and human-greppable in a DB dump,
 * while making it obvious that the column holds no plaintext.
 */
export const SECRET_REF_PREFIX = 'secret:';

/**
 * Value returned in place of a secret field on a normal read. Indicates
 * "a secret is set" without leaking the handle id or the plaintext. A field
 * with no stored secret resolves to `null` instead.
 */
export const SECRET_MASK = '••••••••';

/** Wrap a `sys_secret` handle id as the opaque ref persisted on the row. */
export function makeSecretRef(handleId: string): string {
  return `${SECRET_REF_PREFIX}${handleId}`;
}

/** True when `value` is a secret ref previously produced by {@link makeSecretRef}. */
export function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SECRET_REF_PREFIX);
}

/** Extract the `sys_secret` handle id from a ref, or `null` when not a ref. */
export function parseSecretRef(value: unknown): string | null {
  return isSecretRef(value) ? (value as string).slice(SECRET_REF_PREFIX.length) : null;
}

/**
 * Collect the names of `secret`-typed fields declared on an object schema.
 * Returns an empty array when the schema has no fields or no secret fields —
 * callers can fast-path on `length === 0` to skip all crypto work.
 */
export function collectSecretFields(schema: ServiceObject | undefined | null): string[] {
  const fields = (schema as any)?.fields as Record<string, { type?: string }> | undefined;
  if (!fields) return [];
  const out: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (def && def.type === 'secret') out.push(name);
  }
  return out;
}
