---
'@objectstack/spec': patch
'@objectstack/plugin-audit': patch
'@objectstack/cli': patch
---

feat(spec,plugin-audit,cli): the pure core of audit ledger tamper evidence, and the `audit-seal` secret family

Clause-②: yes (widening) (new exported contracts, a new crypto scope member and three platform objects; nothing main accepts is refused)
Metadata-protocol: none (platform objects and contracts; no authorable key in this slice)

The first slice of ADR-0154. Nothing seals yet: no object opts in, and the three new objects are not registered on any runtime in this release.

- **`@objectstack/spec`.** `CRYPTO_CONTEXT_SCOPES` gains `audit_seal`, the scope the audit sealer seals checkpoint seeds and its signing key's private half under. Under `audit_seal`, `ICryptoProvider.rotateKey` must return the handle's own id, because signed checkpoint bodies name their seed by that id. New contracts `IAuditCheckpointSigner` and `IAuditCheckpointSink` (`AUDIT_CHECKPOINT_SIGNER_SERVICE`, `AUDIT_CHECKPOINT_SINK_SERVICE`), the seams a host replaces to keep the signing key in its own KMS or to deliver checkpoints outside the database. `PLATFORM_PROVIDED_OBJECT_NAMES` gains the three objects below.
- **`@objectstack/plugin-audit`.** The pure core the sealer and the verifier share: RFC 8785 canonical JSON, the canonical form of a sealed row (one spelling per instant, salted commitments of value columns), seed salts, the RFC 6962 Merkle tree, and the signed bodies of checkpoints and amendments. The objects `sys_audit_checkpoint`, `sys_audit_amendment` and `sys_audit_signing_key` are defined, not yet registered (no runtime has their tables in this release), and the audit writer never records writes to them.
- **`@objectstack/cli`.** The `sys_secret` reference union reads a fourth family, `audit-seal`, so `os secret rewrap` re-wraps the sealer's secrets and `os secret orphans` never reads them as unreferenced. Where the holder objects are not registered, the family is complete and empty when no `sys_secret` row carries an audit-seal coordinate, and a gap otherwise. The rewrap report counts `audit_seal` alongside the other scopes, and the `os migrate organization-ownership` inventory lists the three new objects as deployment-level (no organization column to drop).
