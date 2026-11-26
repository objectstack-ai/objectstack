---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): record-change sync honours the source `where`, and a restored record re-enters the index

Clause-②: no
Metadata-protocol: none

An `object` knowledge source's `where` (for example `{ status: 'published' }`) was applied only by `reindexSource`. On a record change the sync built the document straight from the event payload, so a draft was indexed, a record that stopped matching stayed searchable with its old text, and a record restored from the recycle bin never came back into the index.

- **The database decides membership on the event path too.** For a created, updated or restored record, with a data engine bound, each source now re-reads the row under the system context with `where AND id`, one row. A row comes back: the document is built from that row, through the same field rules as a reindex (the fields the source lists and the record `title`, never a credential-class or `internal` field). No row comes back: the record's document is deleted. A write result that omits a field no longer leaves the document short.
- **`data.record.restored` is synced** through the same path, so a restored record is searchable again only if it matches the source.
- **No data engine bound:** a source without `where` still builds from the event payload; a source with `where` is not synced, and the service says so once per source at `warn`.
- **One document at a time.** Syncs of the same document run one after another in the process, so two opposite events for one record end with the index agreeing with the database. A write's sync can wait behind an earlier in-flight sync of the same document.
- The sync runs before the write's unit of work commits (it re-reads inside the same transaction). A rolled-back write leaves the index wrong until the record's next event or a `reindexSource`, in one of two ways: if the uncommitted row matched, the document stays built from a row that never committed; if it did not match, the document was deleted, so the committed row, which may still match, is missing from the index. Bulk `data.records.*` events are still not synced. `content/docs/protocol/knowledge.mdx` states both.

Nothing to change in an app: the same `where` now holds on both paths.
