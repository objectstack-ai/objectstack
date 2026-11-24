---
'@objectstack/plugin-audit': patch
---

feat(plugin-audit): export the readers that rebuild a stored checkpoint or amendment row into its signed body

Clause-②: yes
Metadata-protocol: none

`@objectstack/plugin-audit` now exports `checkpointBodyFromRow` and `amendmentBodyFromRow` from its package entry, with the two body types they answer, `CheckpointSignedBody` and `AmendmentSignedBody` (ADR-0154 D11).

A checkpoint sink (`audit.checkpointSink`) is handed each signed checkpoint and amendment once, and re-delivers what a failed call missed by re-reading the stored records. Read from an unaltered stored `sys_audit_checkpoint` or `sys_audit_amendment` row, these readers answer the body the sink was handed: its RFC 8785 serialization is the bytes the row's `signature` covers, so a sink outside the package can rebuild and re-send a record without copying the body's shape or its parsing. A malformed row is refused with an error whose `name` is `SignedBodyError` and whose message names the field.

The readers validate and normalize; they never verify the signature. A row whose signed columns were rewritten reads back into a body that fails verification (a rewrite of an unsigned column, `id`, `chain_key` or a checkpoint's `leaf_hashes`, reads back into the same body, and a malformed one is refused with a `SignedBodyError`). A row rewritten and re-signed under a key planted on the host fails under a key the sink trusts itself. A row rewritten and re-signed by whoever holds the genuine signing key verifies, and only the copies already off the host can catch it: a later checkpoint's signed `previous_digest` no longer matches a rewritten checkpoint, while no later record carries an amendment's digest at all. So a sink verifies the row's `signature` over the rebuilt body, under a key it trusts itself, before it treats the row as delivered.

A sink assembles the entry it re-delivers itself: `kind` is `checkpoint` or `amendment`, from the table it read; `keyId` is `body.signing_key_id`; and `signature` is the row's `signature` column. The signed bytes are the body's RFC 8785 (JCS) serialization, which the sink computes with its own serializer: this package does not export one.
