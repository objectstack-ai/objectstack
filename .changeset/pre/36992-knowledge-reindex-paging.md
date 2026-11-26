---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): `reindexSource` reads and indexes an object source one page at a time

Clause-②: no
Metadata-protocol: none

`reindexSource` read the whole object in one `find` with no `limit` and pushed every document to the adapter in one `upsert`, so reindexing a large object could exhaust memory or exceed the adapter's request budget.

- **Paged by id.** The walk reads at most 100 rows per `find`, ordered by `id`, each page continuing after the last id of the one before (`where AND id > cursor`), and upserts each page in its own adapter call before reading the next. Every `find` now carries a `limit`, and no `upsert` holds more than one page. Each row goes through the same field rules as the record-change sync. Only an empty page ends the walk: a page that comes back short (an `afterFind` hook may drop rows) is followed by the next one.
- **`limit` still caps the total** number of rows a reindex takes; the last page is shortened to it. A fractional `limit` is rounded down; a negative or non-finite one is refused with `ok: false` and nothing is read.
- **`dryRun` asks `count`** under the source's `where` instead of reading rows, and reports that count, capped by `limit`.
- **A failed page ends the run with `ok: false`** instead of a thrown error. The `message` names the page and the id it continued after; `discovered` and `indexed` count the pages done before it, which stay in the index. A page whose last row has no id, or an engine that does not honour the id condition, also ends the run with `ok: false` instead of looping.
- **Reindexes of one source wait for each other** in a process: a second `reindexSource` of the same source starts only after the first has finished, so the two never interleave. Different sources still reindex concurrently. Record-change syncs do not wait for a reindex: a record updated or deleted between a page's read and that page's upsert is written back from the older read, and a deleted record's document then stays until the index purge (#37096).
- A reindex removes no documents: those of records that no longer exist or no longer match stay until the index purge (#37096). The bulk-write warning and `content/docs/protocol/knowledge.mdx` now say so instead of recommending a reindex to repair a predicate delete.

Nothing to change in an app. A caller that caught a thrown error from `reindexSource` should read `ok` and `message` on the result instead.
