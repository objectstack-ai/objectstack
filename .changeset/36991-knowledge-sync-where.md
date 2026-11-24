---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): record-change sync honours the source `where`, and a restored record re-enters the index

Clause-②: no
Metadata-protocol: none

An `object` knowledge source's `where` (for example `{ status: 'published' }`) was applied only by `reindexSource`. On a record change the sync built the document straight from the event payload, so a draft was indexed, a record that stopped matching stayed searchable with its old text, and a record restored from the recycle bin never came back into the index.

- **The database decides membership on the event path too.** For a created, updated or restored record, with a data engine bound, each source now re-reads the row under the system context with `where AND id`, one row. A row comes back: the document is built from that row, through the same field rules as a reindex (only the fields the source lists; credential-class and `internal` fields never). No row comes back: the record's document is deleted. A write result that omits a field no longer leaves the document short.
- **`data.record.restored` is synced** through the same path, so a restored record is searchable again only if it matches the source.
- **No data engine bound:** a source without `where` still builds from the event payload; a source with `where` is not synced, and the service says so once per source at `warn`.
- **One document at a time.** Syncs of the same document run one after another in the process, so two opposite events for one record end with the index agreeing with the database.
- The sync runs before the write's unit of work commits (it re-reads inside the same transaction); a rolled-back write leaves its document until the record's next event or a `reindexSource`. Bulk `data.records.*` events are still not synced. `content/docs/protocol/knowledge.mdx` states both.

Nothing to change in an app: the same `where` now holds on both paths.
