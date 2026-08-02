---
"@objectstack/metadata": patch
"@objectstack/client": patch
"@objectstack/spec": minor
---

fix(metadata,client): `subscribeMetadata` callbacks receive real `MetadataEvent`s — the producer now fulfils the declared contract (#4602)

`@objectstack/spec/api`'s `MetadataEvent` declares top-level `id` (uuid,
required), `metadataType`, `name`, `definition?`, `userId?` — and after
#4587's convergence it is the **only** declared contract for realtime
metadata-change events. But the producer (`MetadataManager`) published a raw
`RealtimeEventPayload` envelope with everything nested under `payload` and no
`id`/`userId`, while the client SDK force-cast that envelope into the callback
(`callback(event as any as MetadataEvent)`). Subscribers who wrote
`event.name` / `event.metadataType` — exactly what the types promised —
compiled green and read `undefined` at runtime.

Producer now fulfils the contract:

- `MetadataManager.register()` / `unregister()` build a true `MetadataEvent`
  (generated uuid `id`, flattened top-level fields, `userId` when the write
  declares an actor) and validate it with `MetadataEventSchema.parse` before
  publishing. The transport envelope is unchanged (`RealtimeEventPayload`,
  with `payload` carrying the complete `MetadataEvent`).
- A `register()` **overwrite now publishes `metadata.{type}.updated`** instead
  of a second `.created`, mirroring the existing `added`/`changed` watcher
  split. Previously `.updated` was declared with no producer at all.
- `MetadataEventType` is a closed enum: metadata types outside it (e.g.
  `translation`) have no declared realtime event, so nothing is published for
  them (debug-logged) instead of emitting an event every schema-compliant
  consumer must reject.

Consumer validates instead of casting:

- `@objectstack/client`'s `subscribeMetadata` (and therefore
  `@objectstack/client-react`'s metadata hooks, which delegate to it) unwraps
  the envelope and runs `MetadataEventSchema.safeParse` at the boundary. An
  off-contract payload is rejected loudly (handler error, callback never
  invoked) — never coerced or passed through. The `as any as MetadataEvent`
  double-cast is gone.

New seam: `MetadataWriteOptions.userId` (`@objectstack/spec/contracts`) lets
write paths that know the acting user carry it into the published event's
`userId`. Existing callers are unaffected — the field is optional and absence
means "no human actor".
