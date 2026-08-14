---
"@objectstack/objectql": patch
---

Refuse undeclared fields on insert at the schema, and keep bound values out of the write-path logs (#8682)

**A single mistyped field name in a client request no longer writes an entire row's values to disk.** A driver-level write fault is logged by prefixing the fully bound SQL statement — values inlined — to the database's own message, and the logger serializes both `message` and `stack`, so the statement was written twice at ERROR level. Confirmed with planted canaries: the row's values landed in the log alongside the organization id and the acting user id. The insert, update and delete loggers now write the database's own diagnostic — which still names the failing column and the object — with the statement and its bound values cut from both fields. The level, the message and the entry itself are unchanged: a driver fault nobody can debug would be a worse outcome than one logged too loudly.

**An undeclared field is now refused by the object's field map, before anything runs for a request that was already going to be refused.** Previously an unknown key was caught only at the very end, by the driver, after an id, an auto-number, a normalized name, owner/creator resolution, the column defaults and the app's `beforeInsert` hooks had all been produced for it. The auto-number was the durable damage: the refused request consumed a sequence value and left a permanent gap in a document number an end user reads. `insertMany` now culls such a row per row instead of letting it fail the whole batch.

The client-facing answer is deliberately unchanged — the same `400 INVALID_FIELD`, with the same message and the same `field` / `object` — and the rethrown error is untouched, so only what reaches the log has moved. Objects whose field map is absent or empty get no verdict at all, and `id` / `created_at` / `updated_at` stay accepted even when a declaration omits them, matching what the read path already tolerates; in every one of those cases the driver remains the backstop it has always been.
