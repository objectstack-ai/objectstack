---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an optimistic-concurrency conflict reports only what the caller may read

Clause-②: no

`updateData` and `deleteData` judge a caller's version token (`If-Match`, or the body/query `expectedVersion`) on the row their existence probe reads with a system context. On a mismatch they used to answer `409 CONCURRENT_UPDATE` with that system-read row as `currentRecord`, before the caller's row- and field-level security had run.

Now a mismatch re-reads the row under the caller's own context, and only then answers:

- **A row the caller cannot read:** `404 RECORD_NOT_FOUND`, the same answer the same request without a version token gets. It carries no `currentVersion` and no `currentRecord`.
- **A row the caller can read:** `409 CONCURRENT_UPDATE` as before, with `currentRecord` read as the caller reads it, so a field hidden from the caller is absent from it. `currentVersion` is unchanged.

A request whose token matches, or that sends none, is unchanged and issues no extra read. Every door that renders the protocol's answer (`RestServer`, the runtime dispatcher's `/data` domain and the Hono hosts) gets the narrowed answer.
