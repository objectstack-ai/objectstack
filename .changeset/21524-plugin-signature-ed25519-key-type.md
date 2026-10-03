---
'@objectstack/core': minor
---

fix(core)!: the plugin artifact signature contract refuses any key that is not Ed25519, so its `ed25519` label now holds (#21524)

**BREAKING**: `signPayload` and `verifyPayload` (the plugin artifact signature contract in `@objectstack/core`) now refuse a key whose type is not Ed25519. Until now they accepted any asymmetric key. node's `sign(null, …)` and `verify(null, …)` follow the key they are handed, so an RSA, EC or Ed448 key signed under the `ed25519:KEYID:SIG` label and verified against its own public half. `os plugin sign --key` with an RSA private key exited 0, printed `Plugin signed`, and wrote an `ed25519:`-labelled sidecar over an RSA signature.

What is refused now:

- **`signPayload`** throws when the private key is not Ed25519. The error names the key type found (`rsa`, `ec`, `ed448`, and `secret` for a symmetric key).
- **`verifyPayload`** throws when the verifying key's type is not the algorithm the signature's label names. The label is checked against the key, not trusted, and the only label the contract parses is `ed25519`. The error names the key type found.
- **`verifyPublisherSignature`, `verifyPlatformSignature` and `verifyPluginArtifact`** verify through `verifyPayload`. So a publisher key registry entry or a platform key that is not Ed25519 makes them throw, or reject, with that same error. It is not folded into a `false` or an `ok: false` result, because a wrong key is the verifier's own configuration, not a verdict on the artifact.
- **`os plugin sign`** prints one `✗ Signing failed: signPayload: …` line naming the key type, exits 1, and writes no sidecar.

Each refusal is a plain `Error`, the error style the module already used.

**The fix:** sign with an Ed25519 key, generated with `openssl genpkey -algorithm ed25519` or `generateEd25519KeyPair()`. Configure Ed25519 public keys for the publisher key registry and the platform key. A signature made earlier with a non-Ed25519 key cannot be verified any more. Sign the artifact again with an Ed25519 key.

**Unchanged:** an Ed25519 key signs and verifies exactly as before, with the same deterministic signature bytes. That holds for a PEM string, a `KeyObject`, and the PEM buffer, DER and JWK inputs node also accepts. A malformed signature string, a signature that does not verify, and a key that cannot be read still answer `false`. The signature string format and every export are unchanged.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of non-Ed25519 signing and verifying keys by the plugin artifact signature functions in @objectstack/core. No authorable key, spelling, export or stored metadata shape moves: the change is which cryptographic keys signPayload and verifyPayload accept, and a key is an operational secret that no ledger entry or os migrate meta run can rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers the signature contract (not already-registered); and the changed exports are functions whose behaviour narrows, not an interface or type declaration (not runtime-interface-only or type-surface-only). -->
