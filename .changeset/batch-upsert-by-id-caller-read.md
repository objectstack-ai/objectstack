---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the by-id `upsert` of `batchData` chooses its arm by what the caller can read

Clause-②: no
Metadata-protocol: none

Security hardening of `POST /data/:object/batch` with `operation: 'upsert'` (the protocol's `batchData`). A row that carries an `id` now chooses between its update and create arms by what the calling principal can read, the rule the other by-id write doors already follow: a record the caller cannot read is treated as one that does not exist.

- **Unchanged:** a record the caller can read is updated, under the caller's own write permissions, exactly as before; a row without an `id` is created; atomic batches roll back on the first failing row; system and context-less calls fork as their reads run.
- **Changed:** any other `id` takes the create arm, so the row answers exactly as a `create` naming that `id` answers on the same door.
- **Your fix:** none. A client reconciling batch results reads each row's `errors[0].code` as before.
