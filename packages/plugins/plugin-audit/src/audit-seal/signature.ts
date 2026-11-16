// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

/**
 * ADR-0154 D4 and D6, as the maintainer ruled them for signers that cannot
 * sign Ed25519 (Azure Key Vault signs EC and RSA only): a checkpoint or an
 * amendment is signed with **Ed25519** or **ES256**, a closed pair, and the
 * algorithm is the trusted key's type. The record carries no algorithm field,
 * so nothing a row says can choose how its signature is checked.
 *
 * A trusted public key arrives as base64 (`IAuditCheckpointSigner
 * #trustedPublicKey`, a proof bundle's `keys`) in exactly one encoding per
 * type, and its key id is the SHA-256 of those bytes, so the key's type (for
 * ES256 its curve too) sits under the `signing_key_id` a signed body names:
 *
 *  - **Ed25519**: the raw 32-byte public key. Its fingerprint is what the
 *    local signer (D6) has always used; existing chains verify as before.
 *  - **ES256** (ECDSA on P-256 with SHA-256): the DER SubjectPublicKeyInfo of
 *    a P-256 key with its point uncompressed (91 bytes).
 *
 * Anything else — another curve (P-384, secp256k1), RSA, an Ed25519 key in
 * SPKI form, a compressed point, base64 that does not round-trip, a key whose
 * bytes do not hash to the id it was asked under — is no trusted key at all:
 * the check fails closed.
 *
 * An ES256 signature is `r || s`, 64 bytes (IEEE P1363), the JWS encoding of
 * the ES256 name (RFC 7518 §3.4) and what Azure Key Vault returns; a DER
 * signature (what AWS KMS and Vault transit return by default) is converted
 * by the signer before it is returned, and never verifies here.
 */

/** The signing algorithms a trusted key can name, closed. */
export type AuditSigningAlgorithm = 'Ed25519' | 'ES256';

/** A public key a trust anchor vouched for, parsed: its algorithm follows from its type. */
export interface AuditTrustedKey {
  readonly algorithm: AuditSigningAlgorithm;
  readonly key: KeyObject;
  /** The public key as the anchor answered it, base64. */
  readonly publicKey: string;
}

const ED25519_RAW_BYTES = 32;
const ES256_SIGNATURE_BYTES = 64;
const P256 = 'prime256v1';

/**
 * The key `publicKey` (base64) is, when it is a trusted key under `keyId`:
 * one of the two encodings above, and hashing to `keyId`. `null` otherwise.
 */
export function auditTrustedKeyOf(keyId: string, publicKey: string): AuditTrustedKey | null {
  const bytes = Buffer.from(publicKey, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== publicKey) return null;
  if (createHash('sha256').update(bytes).digest('hex') !== keyId) return null;
  try {
    if (bytes.length === ED25519_RAW_BYTES) {
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: bytes.toString('base64url') }, format: 'jwk' });
      return { algorithm: 'Ed25519', key, publicKey };
    }
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== P256) return null;
    // One encoding: the uncompressed-point SPKI, byte for byte. Rebuilt from the key's coordinates,
    // because a key imported with a compressed point exports compressed again.
    const canonical = createPublicKey({ key: key.export({ format: 'jwk' }), format: 'jwk' }).export({ format: 'der', type: 'spki' }) as Buffer;
    if (!canonical.equals(bytes)) return null;
    return { algorithm: 'ES256', key, publicKey };
  } catch {
    return null;
  }
}

/** Whether `signature` (base64) over `bytes` verifies under `trusted`, by the algorithm of its type. */
export function verifyAuditSignature(trusted: AuditTrustedKey, bytes: Uint8Array, signature: string): boolean {
  const raw = Buffer.from(signature, 'base64');
  try {
    if (trusted.algorithm === 'Ed25519') return verify(null, bytes, trusted.key, raw);
    if (raw.length !== ES256_SIGNATURE_BYTES) return false;
    return verify('sha256', bytes, { key: trusted.key, dsaEncoding: 'ieee-p1363' }, raw);
  } catch {
    return false;
  }
}
