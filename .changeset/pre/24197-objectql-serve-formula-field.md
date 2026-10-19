---
'@objectstack/objectql': minor
---

feat(objectql): evaluate a formula field over a record in hand the way a read serves it, one hop through a reference included

A formula title over lookups (`record.book.title + ' · ' + record.reader.name`) is computed on every read since the formula read path reads one hop. A record no read returned, such as the state a hook fires on, had no way to get the same value: the synchronous `evaluateFormulaField` reads no hop, so it answered `null`.

- **`ScopedContext.serveFormulaField(objectName, record, field)`** evaluates one declared formula field over `record` with the read path's own evaluation, under that context: the one hop it reads through a reference (one batched read per reference field, through the reader's own permissions, on the context's transaction when it carries one), the `can()` permission map, and the fault report. A related record the reader may not read, a missing one and a second hop leave the field `null` with the read's reason, as a read does. `ObjectQL.serveFormulaField(objectName, record, field, context)` is the engine method behind it.
- **`resolveServedRecordTitle(schema, record, channel)`** is the async sibling of `resolveRecordTitle`: this record's title, with a formula title served on `channel` (a `ScopedContext`). `resolveRecordTitle` is unchanged and still reads no hop.
- **`servedRecordTitle(schema, row)`** reads the title a read already served off the row it returned, instead of re-deriving it.

What to do. Nothing. Code that names a record it holds in hand and wants the title a read shows calls `resolveServedRecordTitle` with the caller's `ScopedContext`.
