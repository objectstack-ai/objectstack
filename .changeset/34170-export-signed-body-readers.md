---
'@objectstack/plugin-audit': patch
---

feat(plugin-audit): export the readers that rebuild a stored checkpoint or amendment row into its signed body

Clause-②: yes
Metadata-protocol: none

`@objectstack/plugin-audit` now exports `checkpointBodyFromRow` and `amendmentBodyFromRow` from its package entry, with the two body types they answer, `CheckpointSignedBody` and `AmendmentSignedBody` (ADR-0154 D11).

A checkpoint sink (`audit.checkpointSink`) is handed each signed checkpoint and amendment once, and re-delivers what a failed call missed by re-reading the stored records. Read from a stored `sys_audit_checkpoint` or `sys_audit_amendment` row, these readers answer the body the sink was handed: its RFC 8785 serialization is the bytes the row's `signature` covers, so a sink outside the package can rebuild and re-send a record without copying the body's shape or its parsing. A malformed row is refused with an error whose `name` is `SignedBodyError` and whose message names the field.
