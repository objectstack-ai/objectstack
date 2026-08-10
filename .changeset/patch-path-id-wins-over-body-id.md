---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a single-record update binds the row the CALLER named, not the row the body names (#6479)

`PATCH /data/:object/:id` decided which row to write **twice, differently**. The
protocol's `updateData` probed existence and validated `If-Match` /
`expectedVersion` against the path `:id`, built `{ where: { id: request.id } }`,
and then handed the request body to the engine verbatim — where the dispatch
reads the payload first, so a truthy scalar `data.id` outranks `where.id`.

So `PATCH /data/task/rec_1` with a body of `{"id":"rec_2","title":"x"}`:

- probed **rec_1** for existence (404 gate, #4435);
- version-checked **rec_1** against the caller's `If-Match`;
- **wrote rec_2**; and
- answered `{ id: "rec_1", record: <rec_2's readback> }` — a receipt whose two
  halves name different rows.

rec_2 was never probed and never version-checked, so the most common client
shape there is — GET a record, edit a field, PUT the whole body back — performed
a **silent cross-row write straight past its own optimistic-concurrency check**
whenever the body carried another row's id (a mis-clicked list row, a stale
refresh, a generated client that copied the wrong field).

`updateData` now merges the path id over the payload before dispatch
(`{ ...request.data, id: request.id }`) — the same shape the **bulk** ingress has
always used for this question (`ql.update(op.object, { ...data, id }, …)`), so the
two ingresses give one answer instead of two. The probed row, the OCC-checked
row, the written row and the receipt's `id`/`record` are now the same row: the
one in the URL.

Nothing else moves:

- **The engine is untouched.** ObjectQL's payload-first dispatch (#5748) and its
  by-id payload strip (#6435) are unchanged and still correct for a caller who
  hands ObjectQL a payload and nothing else; this was a gap at the REST/protocol
  ingress, which had already named the row.
- **No new rejection, no request-shape change.** A body `id` equal to the path
  id behaves exactly as before, and a differing one is now simply overridden
  rather than refused — `UpdateDataRequestSchema` still accepts the same bodies.
- **Non-record payloads pass through untouched** (`undefined`, `null`, an array),
  so the engine's own diagnostics for a malformed call still surface unchanged.

Callers that deliberately relied on the body's `id` redirecting a
single-record PATCH must address the intended row in the URL instead — the bulk
endpoint has never honoured a body id either.
