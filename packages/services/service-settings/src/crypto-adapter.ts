// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';

/**
 * Pluggable adapter for at-rest encryption of `Specifier.encrypted: true`
 * values. The default {@link NoopCryptoAdapter} provides a transparent
 * base64 wrapping suitable for development and tests; production
 * deployments MUST inject a real KMS-backed adapter.
 *
 * encrypt/decrypt are async to leave room for KMS round-trips.
 */
export interface CryptoAdapter {
  /** Returns the ciphertext blob to store in `sys_setting.value_enc`. */
  encrypt(plaintext: string, ctx: { namespace: string; key: string }): Promise<string>;
  /** Returns the plaintext used by the resolver. */
  decrypt(ciphertext: string, ctx: { namespace: string; key: string }): Promise<string>;
  /**
   * Stable, short, non-reversible digest of a plaintext.
   *
   * Not read by the settings audit trail since #26465: `sys_setting_audit`
   * and `sys_platform_setting_audit` declare SHA-256 for `old_hash` /
   * `new_hash`, so the non-secret fingerprint is {@link settingAuditDigest}
   * whatever adapter is injected, and a secret is fingerprinted only by the
   * crypto provider's keyed digest. Kept on the interface so existing
   * adapters still satisfy it.
   */
  digest(plaintext: string): string;
  /**
   * Does `encrypt()` actually provide confidentiality (#8026)?
   *
   * DECLARED, never inferred: the write path cannot tell an AES envelope from
   * a base64 wrapper by looking at the output, so an adapter that does not
   * protect its input has to say so — and {@link NoopCryptoAdapter} does.
   * `false` makes the settings write path refuse to persist a declared-secret
   * value through this adapter, matching the engine's `Field.secret()`
   * posture (fail-closed, never store something reversible under a name that
   * reads as encryption).
   *
   * OPTIONAL and defaulting to "yes" on purpose: every adapter written before
   * this flag existed is a deliberately-injected real one (the base64 default
   * is the only implementation in this repo that is not), so absence must not
   * start refusing their writes. Opting IN to the refusal is a one-line
   * declaration; opting out of protection is not something silence should buy.
   */
  readonly confidential?: boolean;
}

/**
 * Development / test default. Base64-wraps the plaintext so the column
 * isn't a literal mirror but provides no real confidentiality.
 *
 * Operators are expected to override this via
 * `SettingsServicePluginOptions.crypto`.
 *
 * ## What this adapter can and cannot do since #8026
 *
 * It still DECODES: `decrypt()` is unchanged, so a deployment that already
 * has `b64:` rows can still read them (and migrate them). What it can no
 * longer do is take part in a WRITE: `SettingsService` refuses to persist a
 * declared-encrypted value when this is the only path available, because
 * `'b64:' + base64(x)` is encoding, not encryption — trivially reversible,
 * while producing a `value_enc` that looks protected to the next author and
 * to the next audit. The refusal restores parity with the engine's
 * `Field.secret()` path, which has always thrown rather than persist a secret
 * with no CryptoProvider registered.
 *
 * The class stays exported (public API) and the read half stays useful; a
 * subclass that supplies REAL encryption declares `confidential = true` and
 * is accepted by the write path like any other adapter.
 */
export class NoopCryptoAdapter implements CryptoAdapter {
  /**
   * #8026 — base64 is encoding, not encryption. This is the declaration the
   * write path reads before it agrees to store an `encryptedKeys` value.
   */
  readonly confidential: boolean = false;

  async encrypt(plaintext: string): Promise<string> {
    return 'b64:' + Buffer.from(plaintext, 'utf8').toString('base64');
  }
  async decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext.startsWith('b64:')) {
      // Tolerate legacy plaintext rows during the dev rollout.
      return ciphertext;
    }
    return Buffer.from(ciphertext.slice(4), 'base64').toString('utf8');
  }
  digest(plaintext: string): string {
    // FNV-1a 32-bit — short, stable, non-cryptographic. The settings audit
    // no longer records it (#26465, see `settingAuditDigest`).
    let h = 0x811c9dc5;
    for (let i = 0; i < plaintext.length; i++) {
      h ^= plaintext.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return 'fnv32:' + h.toString(16).padStart(8, '0');
  }
}

/**
 * The fingerprint the settings audit trail records for a NON-secret value
 * (#26465): `sha256:` followed by the hex SHA-256 of the value's canonical
 * JSON, which is the algorithm `old_hash` / `new_hash` declare on
 * `sys_setting_audit` and `sys_platform_setting_audit`.
 *
 * Computed here rather than through {@link CryptoAdapter.digest}, so an
 * injected adapter cannot change the column's format. The prefix keeps the
 * value self-describing beside the rows written before it (`fnv32:` from the
 * old adapter digest) and the keyed secret fingerprints (`hmac-sha256:`), so a
 * reader comparing two rows can tell a different algorithm from a different
 * value. Never used for a secret: an unkeyed hash of a short secret lets any
 * reader of the audit rows confirm a guess offline.
 */
export function settingAuditDigest(canonicalJson: string): string {
  return 'sha256:' + createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

/**
 * Is this adapter allowed to hold a declared-secret value at rest (#8026)?
 *
 * Two arms, in this order:
 *
 *  1. **The declaration wins.** `confidential === false` refuses, `true`
 *     accepts. That is how a subclass of {@link NoopCryptoAdapter} supplying
 *     real encryption opts back in, and how any future development-only
 *     adapter opts out without this function having to know its name.
 *  2. **Undeclared falls back to the class identity**, which catches an
 *     instance of this module's `NoopCryptoAdapter` whose flag was removed or
 *     overwritten. Anything else undeclared is assumed real — see the
 *     `confidential` doc for why silence must not refuse.
 */
export function providesConfidentiality(adapter: CryptoAdapter): boolean {
  if (typeof adapter.confidential === 'boolean') return adapter.confidential;
  return !(adapter instanceof NoopCryptoAdapter);
}
