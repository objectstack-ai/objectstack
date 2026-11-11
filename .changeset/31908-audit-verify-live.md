---
'@objectstack/plugin-audit': patch
'@objectstack/cli': patch
---

feat(plugin-audit,cli): `os audit verify`, the live check of the sealed audit ledger

Clause-②: yes (widening) (a new command, new exports and a new stored checkpoint column; nothing main accepts is refused)
Metadata-protocol: none (no authorable key; `lifecycle.seal` is unchanged)

The live check of ADR-0154 D9. The proof bundle (`--out`, `--bundle`, `--trusted-key`) follows separately.

- **`@objectstack/cli`.** New command `os audit verify` (`--org`, repeatable; `--from` / `--to`; `--json`; `--database-url`). It boots read-only, opens the checkpoint seeds and the signing key through the crypto provider `os serve` seals with (it never mints a key), and reads the hot store and the declared `archive` datasource. Every row a checkpoint lists reads `unmodified`, `modified`, `missing`, `late`, `redacted` or `expired`. A row of a sealed window that no trusted checkpoint lists reads `late` and unsealed. It prints the fingerprints of the signing keys it trusted. Exit 0 when everything verifies (or nothing is sealed), 1 on any `modified`, `missing` or unsealed row or any chain fault, and 2 on a usage error, a failed boot, a crypto provider that cannot open what is sealed, an archive datasource a sealed object declares that the run did not connect, or a check that stopped partway.
- **`@objectstack/plugin-audit`.** New exports `verifyAuditLedger`, `AUDIT_ROW_VERDICTS` and the types `AuditVerifyReport` and `AuditRowVerdict`. A key is trusted only when its wrapped private half opens and derives its public half, the same rule the signer signs by. A checkpoint signed under any other key, or whose signature, stored leaf hashes or seed fails, holds nothing. Links are checked over each whole chain. The acceptance rules for redaction (D7) and expiry (D8) amendments are in place now; their writers come later. `sys_audit_checkpoint` gains a `leaf_hashes` column: each sealed row's leaf hash, in row-id order. It is unsigned, and is trusted only when it rebuilds the signed Merkle root, so each row is judged on its own. Checkpoints are written only by the sealer, and no host composes it with a crypto provider yet.
