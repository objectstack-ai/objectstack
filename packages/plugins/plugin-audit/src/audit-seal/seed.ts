// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHmac, randomBytes } from 'node:crypto';
import type { CryptoContext } from '@objectstack/spec/contracts';
import { canonicalJson } from './jcs.js';

/**
 * ADR-0154 D2 — salts come from one sealed seed per checkpoint, and the
 * coordinates under which the sealer's secrets are sealed.
 *
 * Each checkpoint draws a 32-byte random seed. The salt of column `c` of row
 * `id` of sealed object `o` is `HMAC-SHA-256(seed, o ‖ 0x00 ‖ id ‖ 0x00 ‖ c)`.
 * The seed is stored only sealed — `ICryptoProvider.encrypt` under scope
 * `audit_seal`, as a `sys_secret` row — and never leaves the deployment: not
 * in a checkpoint's body, not in an export, not in a proof bundle.
 *
 * Why a sealed seed, not `keyedDigest`: a keyed digest changes every output
 * when the key is replaced, so salts derived from it would make every sealed
 * window unverifiable at the first key rotation. An `encrypt` handle survives
 * rotation (`rotateKey` re-wraps it under the same id, which the `audit_seal`
 * scope makes a MUST).
 */

/** The seed length, in bytes. */
export const AUDIT_SEAL_SEED_BYTES = 32;

/** The crypto producer scope of every secret this module coordinates (ADR-0154 D2, D6). */
export const AUDIT_SEAL_SCOPE = 'audit_seal' as const;

/** The object whose rows hold the signing key's public half, and the `namespace` its private half is sealed under. */
export const AUDIT_SIGNING_KEY_OBJECT = 'sys_audit_signing_key';

/** The object whose rows are checkpoints. */
export const AUDIT_CHECKPOINT_OBJECT = 'sys_audit_checkpoint';

/** The object whose rows are amendments. */
export const AUDIT_AMENDMENT_OBJECT = 'sys_audit_amendment';

/**
 * The two columns that hold a `sys_secret` handle sealed under `audit_seal` —
 * the holders the `sys_secret` reference union reads for this producer, so
 * `os secret rewrap` re-wraps them and an orphan sweep never reads them as
 * unreferenced.
 */
export const AUDIT_SEAL_SECRET_HOLDERS = Object.freeze([
  Object.freeze({ object: AUDIT_CHECKPOINT_OBJECT, field: 'seed_handle' }),
  Object.freeze({ object: AUDIT_SIGNING_KEY_OBJECT, field: 'private_handle' }),
] as const);

/** A fresh checkpoint seed. */
export function generateCheckpointSeed(): Buffer {
  return randomBytes(AUDIT_SEAL_SEED_BYTES);
}

/** The text a seed is sealed as: base64 of its bytes. */
export function encodeCheckpointSeed(seed: Uint8Array): string {
  if (seed.length !== AUDIT_SEAL_SEED_BYTES) throw new Error(`a checkpoint seed is ${AUDIT_SEAL_SEED_BYTES} bytes, not ${seed.length}`);
  return Buffer.from(seed).toString('base64');
}

/** A seed back from the text it was sealed as. Refuses anything but 32 bytes of base64. */
export function decodeCheckpointSeed(text: string): Buffer {
  const seed = Buffer.from(text, 'base64');
  if (seed.length !== AUDIT_SEAL_SEED_BYTES || seed.toString('base64') !== text) {
    throw new Error('a sealed checkpoint seed did not open to 32 bytes of base64');
  }
  return seed;
}

/** The salt of column `column` of row `rowId` of `sealedObject`, under `seed` (D2). */
export function columnSalt(seed: Uint8Array, sealedObject: string, rowId: string, column: string): Buffer {
  const separator = Uint8Array.of(0x00);
  const message = Buffer.concat([
    Buffer.from(sealedObject, 'utf8'),
    separator,
    Buffer.from(rowId, 'utf8'),
    separator,
    Buffer.from(column, 'utf8'),
  ]);
  return createHmac('sha256', seed).update(message).digest();
}

/** A salt function over one checkpoint's seed, for `leafInput`. */
export function columnSaltsOf(seed: Uint8Array, sealedObject: string): (rowId: string, column: string) => Buffer {
  return (rowId, column) => columnSalt(seed, sealedObject, rowId, column);
}

/**
 * The context a checkpoint's seed is sealed under (D2): the sealed object as
 * the namespace, and as the key the JCS array `[organization id or null,
 * sequence]` — the checkpoint's coordinate, so a seed moved to another
 * checkpoint does not open.
 *
 * No `tenantId`: the ledger is deployment-level (ADR-0131 D7) and so are its
 * seeds. A provider that keys per tenant would otherwise tie whether a chain
 * can be verified to the life of one organization's key, and an organization's
 * chain must stay verifiable after the organization is deleted (D5).
 */
export function checkpointSeedContext(sealedObject: string, tenantId: string | null, sequence: number): CryptoContext {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('a checkpoint sequence is a non-negative integer');
  return { scope: AUDIT_SEAL_SCOPE, namespace: sealedObject, key: canonicalJson([tenantId, sequence]) };
}

/** The context the signing key's private half is sealed under (D6): its own fingerprint as the key. */
export function signingKeyContext(fingerprint: string): CryptoContext {
  return { scope: AUDIT_SEAL_SCOPE, namespace: AUDIT_SIGNING_KEY_OBJECT, key: fingerprint };
}

/**
 * Whether a `sys_secret` row's `(namespace, key)` is one this producer writes:
 * a signing key's private half, or a seed's checkpoint coordinate. Evidence,
 * read from the row alone, that `audit_seal` secrets exist even where their
 * holder objects are not registered.
 *
 * Total: it answers for any row and never throws. A key this producer cannot
 * have written (one whose canonical form does not exist, such as an array
 * holding an unpaired surrogate, which {@link checkpointSeedContext} refuses
 * to build) answers `false`.
 */
export function isAuditSealSecretCoordinate(namespace: unknown, key: unknown): boolean {
  if (namespace === AUDIT_SIGNING_KEY_OBJECT) return true;
  if (typeof key !== 'string' || !key.startsWith('[')) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return false;
  const [tenantId, sequence] = parsed;
  if (!(tenantId === null || typeof tenantId === 'string')) return false;
  if (!Number.isSafeInteger(sequence) || (sequence as number) < 0) return false;
  try {
    return canonicalJson(parsed) === key;
  } catch {
    return false; // no canonical form, so not a key checkpointSeedContext can have built
  }
}
