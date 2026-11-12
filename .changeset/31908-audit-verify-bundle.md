---
'@objectstack/plugin-audit': patch
'@objectstack/cli': patch
---

feat(plugin-audit,cli): `os audit verify --out` / `--bundle`, the audit ledger's proof bundle checked offline

Clause-②: yes (widening) (new flags and new exports; nothing main accepts is refused, and a store read fault while opening a signing key now ends the run with exit 2 instead of reading as an untrusted key)
Metadata-protocol: none (no authorable key; `lifecycle.seal` is unchanged)

The proof bundle of ADR-0154 D9, the second half of `os audit verify`.

- **`@objectstack/cli`.** `os audit verify --out FILE` also writes the run's proof bundle (`objectstack.audit.proof-bundle.v1`), whatever the verdict. It holds the public halves of the trusted signing keys, every checkpoint and amendment in scope, and each judged row's leaf input, with value columns as salted commitments only. It holds no value, salt or seed, but its clear columns identify people, so it is an export of the ledger, handled as one and narrowed with `--org` / `--from` / `--to`; it is written with mode `0600`. `os audit verify --bundle FILE --trusted-key FINGERPRINT` (repeatable) re-judges such a bundle offline, with no boot, no database and no data key. A key the bundle carries is trusted only when it hashes to a fingerprint given. `--bundle` requires `--trusted-key` and takes no `--out`, `--database-url`, `--org`, `--from` or `--to`. `--trusted-key` applies to `--bundle` only. Each of these is a usage error (exit 2), as is a file that is not a proof bundle. Offline, exit 0 when everything verifies and 1 otherwise, as live.
- **`@objectstack/plugin-audit`.** New exports `verifyAuditProofBundle`, `AuditProofBundleError`, `AUDIT_PROOF_BUNDLE_FORMAT` and the type `AuditProofBundle`. `verifyAuditLedger` takes `onProofBundle` to receive the bundle. The offline check uses the same verdict machine as the live one: leaf inputs against leaf hashes and the signed root, links, signatures, and the D7 and D8 acceptance rules, with each expiry judged at the offline check's time. Opening a signing key (`trustedSigningKey`, the local signer's `trustedPublicKey`) now throws when the `sys_secret` row of its wrapped half cannot be read. A missing half, one that does not open, or one that derives another key still reads as untrusted.
