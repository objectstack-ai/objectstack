---
'@objectstack/metadata-protocol': patch
---

harden(data): an update by id answers the same refusal whether or not the id exists, as delete does

Clause-②: no
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches what a by-id update answers for an id that names no record (a `git grep` of `skills/` for `RECORD_NOT_FOUND` names only the approvals record lock), so no skill line changes. The Update Record section of `content/docs/protocol/kernel/http-protocol.mdx` states the order.

The by-id update doors now judge the update before they look the record up — the order the by-id delete door already has.

- **What changes.** A caller the update is refused to — no edit permission on the object, or an external data source that refuses writes — now gets that refusal (`403 PERMISSION_DENIED`, `403 EXTERNAL_WRITE_FORBIDDEN`) for an id that names no record too, where it got `404 RECORD_NOT_FOUND`. This holds on `PATCH /api/v1/data/:object/:id`, on each row of `POST /api/v1/data/:object/updateMany` and of `POST /api/v1/data/:object/batch` with `operation: "update"`, and on every door that updates through them (the runtime dispatcher's `/data`, the `/mcp` HTTP tools, declarative update actions).
- **What does not change.** A caller who may update the object still gets `404 RECORD_NOT_FOUND` for an id that names no record, and for a record its row-level access hides. Successful updates, the `405` for an operation the object does not expose, optimistic concurrency (`If-Match` / `expectedVersion`), upsert and system-context writes answer as before.
- **Embedders calling the protocol directly.** `updateData`, `updateManyData` and `batchData`'s `update` operation no longer read the record before calling `engine.update`. They ask whether it exists only after the engine resolves a `null` readback, so an engine that resolves `null` for an id that names no record still gets `404 RECORD_NOT_FOUND`, and an update that moved its record out of the caller's row scope still answers `200` with `record: null`.
