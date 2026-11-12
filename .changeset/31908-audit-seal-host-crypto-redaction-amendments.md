---
'@objectstack/plugin-audit': patch
'@objectstack/cli': patch
---

feat(plugin-audit, cli): `os serve` hands the audit sealer its crypto provider; one-shot commands start no sealer; a sealed row is amended before a migration rewrites it, or refused (ADR-0154 D3, D7)

Clause-②: yes (widening)
Metadata-protocol: none

Part of the audit ledger's tamper evidence (ADR-0154). No object is sealed by default yet; this release wires the host and the redaction amendments that a sealed `sys_audit_log` will need.

- **`os serve` passes the audit sealer its crypto provider.** The `AuditPlugin` that `os serve` composes, and one that `requires: ['audit']` mounts, now get the same crypto provider `os serve` seals every `sys_secret` row with. Before, no shipped host passed one, so an object that declared `lifecycle.seal` was never sealed and the fix the sealer's error names could not be applied. `AuditPluginOptions.cryptoProvider` also takes a function, read once when the sealer starts. An app that puts its own `AuditPlugin` in `plugins` still passes its own `cryptoProvider`.
- **One-shot commands start no sealer.** `AuditPluginOptions.armSealer: false` keeps the sealer off. `os audit verify` and every `os migrate …` boot that composes plugin-audit pass it. A read-only check no longer reports on sealing on its own output, and never writes a checkpoint.
- **Redaction amendments (D7).** `sys_audit_amendment` is now registered and provisioned. `os migrate audit-metadata-bodies`, `audit-mail-bodies` and `audit-key-material` compose the crypto provider `os serve` seals with. Before they rewrite a row that a checkpoint seals, they write a signed redaction amendment, on the hot store and the archive datasource alike. `os audit verify` then reads that row `redacted`. A row no checkpoint lists yet is rewritten as before.
- **A sealed row that cannot be amended is refused.** That is a run with no crypto provider or a signer that cannot sign, a row that no longer matches its checkpoint, or a rewrite of a column sealed in clear. The row is left as it is and counted in the report's new `refused` count (also per table in `byObject`). The run exits `1`. The dry run decides the same way and writes nothing.
- **`os migrate audit-metadata-bodies` keeps each row's `updated_at`**, as the two sibling rewrites already did. Redacting a copy is not an edit of the ledger row, and on a sealed row a moved `updated_at` would read `modified`.
