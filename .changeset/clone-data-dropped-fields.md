---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/client': minor
---

`cloneData` reports `droppedFields` like every other create face: `CloneDataResponseSchema` (`@objectstack/spec/api`) gains an optional `droppedFields` member of the same shape as `CreateDataResponseSchema`'s, and the `POST /data/:object/:id/clone` 201 body carries it whenever the engine stripped a static `readonly` column from the clone.

A clone IS a create, and it is the one create shape that can carry a read-only column without the caller typing it: the source row is copied whole (`approval_status: 'approved'` included), `overrides` are applied on top, and the copy is inserted. Since the create-side strip moved into `engine.insert` that column has been stripped and logged at `warn` — but the 201 body said nothing, so a caller that cloned an approved record and read `record.approval_status: 'draft'` back had no field in the response telling it why, while `createData`, `createManyData`, `insertManyData` and every `batchData` row that created already answered on the wire. Maintainer ruling 2026-09-08 (option 1 on #15703): report it, the same way.

- **`@objectstack/spec`** — `CloneDataResponseSchema.droppedFields`: `DroppedFieldsEvent[]`, optional, omit-when-empty — present ONLY when ≥1 field was dropped, and the clone still succeeded without them (status unchanged). The schema is declared AS PRODUCED, so the member and the producer land in one change. Additive: a client that reads only `object` / `id` / `sourceId` / `record` sees no difference.
- **`@objectstack/metadata-protocol`** — `cloneData` passes the engine the same `onFieldsDropped` listener `createData` wires and spreads the collected events onto its return as `droppedFields`. The strip itself is unchanged and still the engine's (`isSystem`-gated, `defaultValue` re-derived); what is new is that a copied-in or overridden readonly key is now named in the body instead of only in the server log.
- **`@objectstack/client`** — `CloneDataResult` (the declared mirror of `CloneDataResponseSchema`, the return type of `client.data.clone`) gains the same optional `droppedFields?: DroppedFieldsEvent[]`, so a TypeScript caller reads the member without a cast; its docblock no longer states that the clone producer emits no write-observability event.

Body only, deliberately: the clone route relays the producer verbatim and sets no `X-ObjectStack-Dropped-Fields` header (the single-record `POST /data/:object` and `PATCH /data/:object/:id` mounts do); the schema's `.describe()` says so rather than promising a header the route does not send.
