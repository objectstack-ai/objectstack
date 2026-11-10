// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two seams of the audit ledger's tamper evidence — ADR-0154 D11.
 *
 * The sealer in `@objectstack/plugin-audit` seals a sealed object's rows into
 * per-organization checkpoints (ADR-0154 D1–D5) and signs every checkpoint and
 * amendment it writes. Two jobs around that are seams, so a deployment can move
 * them off the host (stage 2, `objectstack-ai/cloud`) without touching the
 * sealer:
 *
 *  - **signing** — {@link IAuditCheckpointSigner}, in the service slot
 *    {@link AUDIT_CHECKPOINT_SIGNER_SERVICE}. The open build ships the local
 *    signer (ADR-0154 D6: one deployment Ed25519 key whose private half is a
 *    `sys_secret` handle under scope `audit_seal`); stage 2 registers a
 *    KMS-held one.
 *  - **export** — {@link IAuditCheckpointSink}, in the service slot
 *    {@link AUDIT_CHECKPOINT_SINK_SERVICE}. The open build ships none; with none
 *    registered, checkpoints stay on the host.
 *
 * Why two seams, not one: signing happens before export and on every
 * checkpoint, while export may be batched, retried or absent. A signer on the
 * export path would make an unavailable sink stop sealing.
 */

/** The service slot a {@link IAuditCheckpointSigner} is registered under (ADR-0154 D11). */
export const AUDIT_CHECKPOINT_SIGNER_SERVICE = 'audit.checkpointSigner';

/** The service slot a {@link IAuditCheckpointSink} is registered under (ADR-0154 D11). */
export const AUDIT_CHECKPOINT_SINK_SERVICE = 'audit.checkpointSink';

/** One signature, and the key that made it. */
export interface AuditCheckpointSignature {
  /**
   * The id of the key that signed: its fingerprint, the lowercase hex SHA-256
   * of the raw public key. Returned WITH the signature, never asked for
   * separately, so a rotation between two calls cannot pair a signature with
   * the wrong key.
   */
  readonly keyId: string;
  /** The Ed25519 signature over the bytes given, base64. */
  readonly signature: string;
}

/**
 * Signs the canonical bytes of a checkpoint's or an amendment's signed body
 * (ADR-0154 D4, D6, D7, D8).
 *
 * Implementations MUST be safe to call concurrently.
 */
export interface IAuditCheckpointSigner {
  /** Sign `bytes` with the active key. Throws when no key can sign. */
  sign(bytes: Uint8Array): Promise<AuditCheckpointSignature>;

  /**
   * The public key (base64, raw 32 bytes) this signer vouches for under
   * `keyId`, or `null` when it vouches for none.
   *
   * This is the trust anchor `os audit verify`'s live check reads. ⛔ A public
   * key is never trusted because a row carries it: the local signer answers
   * only for a key whose wrapped private half opens under that key's own
   * fingerprint and derives exactly that public key (ADR-0154 D6); a KMS
   * signer answers with the public half its KMS serves for the key id.
   */
  trustedPublicKey(keyId: string): Promise<string | null>;
}

/** What a {@link IAuditCheckpointSink} is handed: one signed record. */
export interface AuditCheckpointSinkEntry {
  /** Which record this is. */
  readonly kind: 'checkpoint' | 'amendment';
  /**
   * The signed body exactly as signed — the object whose RFC 8785 (JCS)
   * serialization the signature covers. It carries no value, no salt and no
   * seed (ADR-0154 D2): only commitments, roots, digests and handle ids.
   */
  readonly body: Readonly<Record<string, unknown>>;
  /** The key that signed it. */
  readonly keyId: string;
  /** The signature, base64. */
  readonly signature: string;
}

/**
 * Takes signed checkpoints and amendments off the host (WORM storage, a SIEM).
 *
 * Handed each record once, after it is signed and stored. A failure is the
 * sink's own: the sealer logs it and carries on sealing — a sink that is down
 * never stops the chain from growing on the host. Re-delivery of what a failed
 * call missed is the sink's to arrange (it can re-read the stored records).
 */
export interface IAuditCheckpointSink {
  deliver(entry: AuditCheckpointSinkEntry): Promise<void>;
}
