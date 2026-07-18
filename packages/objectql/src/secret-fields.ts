// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Credential-field channels — helpers for the `secret` and `password` FieldTypes.
 *
 * A `secret` field (DB password, API key, token) is **reversible**: the engine
 * encrypts it on write via the registered `ICryptoProvider`, persists the
 * ciphertext as a `sys_secret` row, and stores only an opaque *ref* on the
 * business row. On read the ref is masked, never the plaintext. This mirrors
 * the Settings subsystem (`sys_setting.value_enc → sys_secret.id`), generalized
 * to object fields.
 *
 * A `password` field on a **generic** (non-`better-auth`) object is **plaintext
 * at rest** but **masked on read** — the engine stores the value verbatim (no
 * encryption, no `sys_secret` row) yet returns {@link SECRET_MASK} through the
 * normal query path, so cleartext never leaves the engine. This closes #2036,
 * where a `password` field round-tripped plaintext. See ADR-0100. The two types
 * share only the read mask ({@link collectMaskedReadFields}); their write paths
 * differ (secret encrypts, password is left untouched).
 *
 * The auth subsystem's own credentials are a third, separate channel: better-auth
 * one-way hashes them into identity tables (`sys_account.password`, a hashed
 * `text` column) off the generic CRUD path. Objects it owns carry
 * `managedBy: 'better-auth'` and are exempt from password masking so login reads
 * still see the stored hash.
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

/**
 * Collect the names of fields that must be masked to {@link SECRET_MASK} on the
 * generic read path: every `secret` field, plus every `password` field — the
 * latter only when the object is **not** `managedBy: 'better-auth'`.
 *
 * The better-auth exemption is deliberate: the auth subsystem reads its identity
 * rows through the engine's find/findOne, and masking a credential column there
 * would break login. Today no identity object even declares a `password`-typed
 * field (`sys_account.password` is a hashed `text` column), but the guard keeps
 * masking safe if that ever changes. See ADR-0100.
 *
 * Returns an empty array when the schema has no fields or no maskable fields, so
 * callers can fast-path on `length === 0`.
 */
export function collectMaskedReadFields(schema: ServiceObject | undefined | null): string[] {
  const fields = (schema as any)?.fields as Record<string, { type?: string }> | undefined;
  if (!fields) return [];
  const isBetterAuth = (schema as any)?.managedBy === 'better-auth';
  const out: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (!def) continue;
    if (def.type === 'secret') out.push(name);
    else if (def.type === 'password' && !isBetterAuth) out.push(name);
  }
  return out;
}

/**
 * Collect the names of every credential-bearing field on an object — `secret`
 * OR `password` — **unconditionally**, ignoring `managedBy`.
 *
 * This differs from {@link collectMaskedReadFields} on purpose. Read-masking
 * exempts `password` on `managedBy: 'better-auth'` objects so login reads still
 * see the stored value; but *aggregating* a credential field must never be
 * allowed, even on a better-auth object — a GROUP BY / MIN / MAX over a password
 * column is an inference oracle regardless of who owns the table. So the
 * aggregate-rejection gate keys off this stricter, exemption-free collector,
 * keeping the two concerns independent (they must not drift). See ADR-0100 / #3171.
 *
 * Returns an empty array when the schema has no fields or no credential fields,
 * so callers can fast-path on `length === 0`.
 */
export function collectCredentialFields(schema: ServiceObject | undefined | null): string[] {
  const fields = (schema as any)?.fields as Record<string, { type?: string }> | undefined;
  if (!fields) return [];
  const out: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (def && (def.type === 'secret' || def.type === 'password')) out.push(name);
  }
  return out;
}
