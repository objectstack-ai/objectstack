---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): `reindexSource` reads and indexes an object source one page at a time

Clause-②: no
Metadata-protocol: none

`reindexSource` read the whole object in one `find` with no `limit` and pushed every document to the adapter in one `upsert`, so reindexing a large object could exhaust memory or exceed the adapter's request budget.

- **Paged by id.** The walk reads at most 100 rows per `find`, ordered by `id`, each page continuing after the last id of the one before (`where AND id > cursor`), and upserts each page in its own adapter call before reading the next. Every `find` now carries a `limit`, and no `upsert` holds more than one page. Each row goes through the same field rules as the record-change sync.
- **`limit` still caps the total** number of rows a reindex takes; the last page is shortened to it.
- **`dryRun` asks `count`** under the source's `where` instead of reading rows, and reports that count, capped by `limit`.
- **A failed page ends the run with `ok: false`** instead of a thrown error. The `message` names the page and the id it continued after; `discovered` and `indexed` count the pages done before it, which stay in the index. A page whose last row has no id, or an engine that does not honour the id condition, also ends the run with `ok: false` instead of looping.
- **One reindex per source at a time** in a process: a second `reindexSource` of the same source waits until the first has finished, so their pages never interleave. Different sources still reindex concurrently.
- Documents of rows that no longer exist or no longer match are still not removed by a reindex.

Nothing to change in an app. A caller that caught a thrown error from `reindexSource` should read `ok` and `message` on the result instead.
