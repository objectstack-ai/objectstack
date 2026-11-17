---
'@objectstack/plugin-audit': patch
'@objectstack/spec': patch
---

feat(plugin-audit): an audit checkpoint signer can sign ES256 beside Ed25519, and a host signer that takes over pins the local keys

Clause-②: yes (widening)
Metadata-protocol: none

A host `audit.checkpointSigner` whose KMS cannot sign Ed25519 (Azure Key Vault signs EC and RSA keys only) can now sign **ES256** (ECDSA on P-256 with SHA-256). The live check of `os audit verify`, the redaction amendment writer and the offline check of a proof bundle (`--bundle --trusted-key`) all verify it (ADR-0154 D4 and D6, amended).

- **The trusted key's type decides the algorithm.** A record carries no algorithm field. The public key a signer's `trustedPublicKey` answers is either an Ed25519 key's raw 32 bytes (unchanged) or an ES256 key's DER SubjectPublicKeyInfo, P-256, point uncompressed. The key id is the lowercase hex SHA-256 of exactly those bytes.
- **An ES256 signature is `r || s`, 64 bytes** (IEEE P1363, the JWS form). A signer whose KMS returns DER (AWS KMS, Vault transit by default) converts it before returning. A DER signature does not verify.
- **Fails closed.** Any other key type, curve or encoding is untrusted: P-384, RSA, a compressed point, an Ed25519 key in SPKI form. So is a key whose bytes do not hash to the id it was asked under. What such a key signed reads `untrusted_key`. The id check applies to every anchor. The local signer already answers only keys that hash to their id, so no Ed25519 chain changes.
- **Unchanged:** Ed25519 key ids, the local signer (Ed25519) and the proof bundle format (`objectstack.audit.proof-bundle.v1`). Every chain sealed before this release verifies as before. An older CLI reads an ES256 key in a bundle as untrusted.

**Switching to a host signer.** A registered host signer is the only trust anchor: the local key's derivation is not asked. Before the switch, run `os audit verify --out FILE`. The bundle's `keys` lists each trusted fingerprint with its public key. The host signer's `trustedPublicKey` must answer for exactly those fingerprints beside its own key. If it does, every checkpoint the local key signed stays trusted. If it does not, they all read `untrusted_key`. The `IAuditCheckpointSigner` docblocks in `@objectstack/spec/contracts` state both rules.
