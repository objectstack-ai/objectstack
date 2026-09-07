---
"@objectstack/spec": patch
---

The environment artifact's `checksum` now states its own coverage boundary, and `grantedPermissions` states that it sits outside the digest by design.

Describe text only — no key, value schema or accept-set change on `EnvironmentArtifactSchema`, and the digest itself is computed and verified by the control plane, not here.

- **`checksum`** carried the shared `Sha256DigestSchema` describe ("SHA-256 digest (64 hex chars)"), which says what the value *is* and nothing about what it *covers*. It now has its own field-level describe: the SHA-256 digest of the canonical JSON serialization of the `metadata` block (stable key ordering), computed by the control plane when assembling the GET response — and coverage stops there, so no other key on the envelope is under the digest. The shared `Sha256DigestSchema` describe is unchanged, so every other digest field still inherits it.
- **`grantedPermissions`** gains one sentence group at the end of its describe: it sits beside `metadata`, outside the digest, and integrity of the granted consent set rests on the carrier — the artifact is environment-local and control-plane served (ADR-0003 / cloud ADR-0007) — an accepted boundary of this envelope rather than an oversight. Its five existing clauses (the manifest-`id` keying, the `sys_package_installation` source, the enforcer consumer, absent ≠ `{}`) are unchanged.
