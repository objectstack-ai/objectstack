---
'@objectstack/service-knowledge': patch
'@objectstack/knowledge-turso': patch
'@objectstack/knowledge-pgvector': patch
---

feat(service-knowledge): a caller who may read few of a source's records is answered from them, wherever they rank

Clause-②: no
Metadata-protocol: none

A knowledge search re-checks every hit as the caller after ranking, and refills once at `topK × 20`. A caller who may read only a few of a source's rows (20 of 1,000, say) could find none of them within that cap and be answered nothing, though the store held their answer.

- **`@objectstack/service-knowledge`.** Before the first round, for a caller who is not the system identity, the service reads the ids of each source's records that caller may read: as the caller, under the source's `where`, ids only, at most 501. When there are 500 or fewer, the source is handed them as a `record` scope term, so its adapter ranks only those rows. A caller's own `scope` is intersected with them, never widened: a one-record scope stays one record. A scope with a parent (metadata) term, more than 500 readable records, a read that fails (logged at `warn`), or no readable record in scope, and the source is searched as before. Every hit is still re-checked one by one, the organization filter is unchanged, and the system identity's search is unchanged. The conformance harness's engine double (`@objectstack/service-knowledge/testing`) answers that read as the caller too.
- **`@objectstack/knowledge-turso`.** Each new generation's passage table carries an index on `source_record_id`, so a narrowed search reads only those records' passages. A generation made before gets it from its next build; nothing to run.
- **`@objectstack/knowledge-pgvector`.** Each passage table carries an index on `(source_id, generation, source_record_id)`. A table made before gets it on the first write after the upgrade (`CREATE INDEX IF NOT EXISTS`, which holds writes to that table while it builds).

Nothing to migrate.
