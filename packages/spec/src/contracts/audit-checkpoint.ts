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
 *    KMS-held one, which signs Ed25519 or ES256 (ADR-0154 D4, D6, amended).
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

/**
 * One signature, and the key that made it.
 *
 * Two algorithms, closed (ADR-0154 D4, D6, amended): **Ed25519** and **ES256**
 * (ECDSA on P-256 with SHA-256). Which one a signature is checked by is the
 * type of the key {@link IAuditCheckpointSigner.trustedPublicKey} answers for
 * `keyId` — never a field of the record, which carries none. Any other key
 * type, curve or encoding is no trusted key: what it signed verifies nothing.
 */
export interface AuditCheckpointSignature {
  /**
   * The id of the key that signed: its fingerprint, the lowercase hex SHA-256
   * of the public key's bytes exactly as `trustedPublicKey` answers them
   * (an Ed25519 key's raw 32 bytes; an ES256 key's DER SubjectPublicKeyInfo),
   * so the key's type is bound under the id. Returned WITH the signature,
   * never asked for separately, so a rotation between two calls cannot pair a
   * signature with the wrong key.
   */
  readonly keyId: string;
  /**
   * The signature over the bytes given, base64: Ed25519's 64 bytes, or for an
   * ES256 key `r || s`, 64 bytes (IEEE P1363, the JWS form). A signer whose
   * KMS returns a DER-encoded ECDSA signature converts it; DER never verifies.
   */
  readonly signature: string;
}

/**
 * Signs the canonical bytes of a checkpoint's or an amendment's signed body
 * (ADR-0154 D4, D6, D7, D8).
 *
 * Implementations MUST be safe to call concurrently.
 */
export interface IAuditCheckpointSigner {
  /**
   * Sign `bytes` with the active key. Throws when no key can sign.
   *
   * The caller's duty. A signed body names its signing key inside the bytes
   * (`signing_key_id`, ADR-0154 D4), and the active key is only known from
   * what this method returns. So the caller builds the body with the key id
   * it expects, signs it, and compares the returned
   * {@link AuditCheckpointSignature.keyId} with the key id in the bytes. When
   * the two differ (the key rotated between the build and the call), the
   * caller rebuilds the body with the returned key id and signs again; it
   * never stores a signature whose `keyId` differs from the one its bytes
   * name, because such a record never verifies.
   */
  sign(bytes: Uint8Array): Promise<AuditCheckpointSignature>;

  /**
   * The public key this signer vouches for under `keyId`, base64, or `null`
   * when it vouches for none. An Ed25519 key is its raw 32 bytes; an ES256 key
   * is the DER SubjectPublicKeyInfo of a P-256 key with its point
   * uncompressed. `keyId` must be the SHA-256 of exactly these bytes, or the
   * key is not trusted.
   *
   * This is the trust anchor `os audit verify`'s live check reads. ⛔ A public
   * key is never trusted because a row carries it: the local signer answers
   * only for a key whose wrapped private half opens under that key's own
   * fingerprint and derives exactly that public key (ADR-0154 D6); a KMS
   * signer answers with the public half its KMS serves for the key id.
   *
   * A host signer registered in place of the local one is the ONLY anchor:
   * the local derivation is not asked, so the history the local key signed
   * stays trusted only if the host signer pins it (ADR-0154 D6, amended).
   * Before the switch the operator runs `os audit verify --out`; its proof
   * bundle lists each trusted fingerprint with its public key. The host keeps
   * those keys off the host and answers for exactly those fingerprints,
   * beside its own key; a fingerprint it does not pin — a key row planted on
   * the host after the switch included — is untrusted.
   */
  trustedPublicKey(keyId: string): Promise<string | null>;
}

/** What a {@link IAuditCheckpointSink} is handed: one signed record. */
export interface AuditCheckpointSinkEntry {
  /** Which record this is. */
  readonly kind: 'checkpoint' | 'amendment';
  /**
   * The signed body exactly as signed — the object whose RFC 8785 (JCS)
   * serialization the signature covers.
   *
   * What a sink receives in it, member by member. A checkpoint's body:
   * `sealed_object`; `tenant_id`, the organization the chain is about
   * (`null` for the deployment chain); `sequence`; `kind` (`window` or
   * `late`); `window_start`, `window_end` and `sealed_through`, instants;
   * `leaf_count`; `row_ids`, the id of every sealed row; `root`, a Merkle
   * root; `previous_digest`; `columns`, the names of the sealed columns;
   * `canon_version`; `seed_handle`, a `sys_secret` handle id;
   * `fencing_token`; `sealed_at`; and `signing_key_id`. An amendment's body:
   * `sealed_object`, `tenant_id`, `kind` (`redaction` or `expiry`),
   * `amended_at` and `signing_key_id`; on a redaction `checkpoint_sequence`,
   * `row_id`, `column_name`, `sealed_commitment`, `rewritten_commitment`
   * (two commitments) and `rewritten_by`, the name of the migration that
   * rewrote the value; on an expiry `first_sequence`, `last_sequence`,
   * `covered_from`, `covered_to`, `last_removed_digest`, and `policy` with
   * its `policy_value`. None of these is a value of a sealed column, a salt,
   * a seed or key material (ADR-0154 D2), but the organization id and the
   * row ids identify an organization and its records, and a sink classifies
   * the body accordingly.
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
