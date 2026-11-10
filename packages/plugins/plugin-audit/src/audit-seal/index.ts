// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0154 — the audit ledger's tamper evidence: the pure core (canonical
 * form, commitments, seed salts, Merkle tree, signed bodies). Nothing here
 * reads or writes storage; the sealer and the verifier build on it.
 */

export { canonicalJson, canonicalJsonBytes, CanonicalJsonError } from './jcs.js';
export {
  AUDIT_SEAL_CANON_VERSION,
  canonicalDatetime,
  canonicalValue,
  CanonicalFormError,
  commitValue,
  inLeafOrder,
  leafHash,
  leafInput,
  rowIdOf,
  sealedColumnSet,
} from './canonical.js';
export type { ColumnSaltOf, SealedColumnSet, SealedFieldTypes } from './canonical.js';
export {
  AUDIT_AMENDMENT_OBJECT,
  AUDIT_CHECKPOINT_OBJECT,
  AUDIT_SEAL_SCOPE,
  AUDIT_SEAL_SECRET_HOLDERS,
  AUDIT_SEAL_SEED_BYTES,
  AUDIT_SIGNING_KEY_OBJECT,
  checkpointSeedContext,
  columnSalt,
  columnSaltsOf,
  decodeCheckpointSeed,
  encodeCheckpointSeed,
  generateCheckpointSeed,
  isAuditSealSecretCoordinate,
  signingKeyContext,
} from './seed.js';
export { merkleRoot, nodeHash } from './merkle.js';
export {
  amendmentBodyFromRow,
  amendmentRow,
  AUDIT_AMENDMENT_KINDS,
  AUDIT_CHECKPOINT_KINDS,
  chainKeyOf,
  checkpointBodyFromRow,
  checkpointDigest,
  checkpointRow,
  DEPLOYMENT_CHAIN_KEY,
  signedBodyBytes,
  SignedBodyError,
} from './signed-body.js';
export type {
  AmendmentSignedBody,
  AuditAmendmentKind,
  AuditCheckpointKind,
  CheckpointSignedBody,
  ExpiryAmendmentBody,
  RedactionAmendmentBody,
} from './signed-body.js';
