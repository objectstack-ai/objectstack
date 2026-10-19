---
'@objectstack/metadata-protocol': patch
---

Clause-②: no

perf(metadata-protocol): the by-name item read reads the item's stored active rows once, so a `GET /api/v1/data/:object` makes one `sys_metadata` read of the object instead of five

- **What changed.** `getMetaItem` (the read the API-exposure gate makes on every `/data` request) used to send its three active-row selections to the store one at a time: which package the item belongs to, the served row once per spelling of the type (`object`, then `objects`), and the rows its lock is chosen from, once per spelling. Now it reads the item's active rows once, for both spellings (`type IN ('object', 'objects')`), and each selection picks its rows from that one read with the same conditions it used to send the store. The item read's `version` reuses the package binding the read already selected.
- **Measured.** On Postgres behind a 50 ms round-trip proxy, the median `GET /api/v1/data/todo_task` (example todo app, signed-in admin) went from 551 ms with 5 `sys_metadata` statements to 340 ms with 1.
- **Unchanged.** The served item, its lock and `version`, and every refusal stay the same. Nothing is cached across calls, so a metadata write is seen by the next request. An object with a stored row still has one more read behind `version` (the repository's write-address head).
