---
"@objectstack/objectql": minor
"@objectstack/client": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/service-knowledge": patch
---

fix(objectql,client): `subscribeData` callbacks receive real `DataEvent`s — the producer now fulfils the declared contract (#4626)

`@objectstack/spec/api`'s `DataEvent` declares top-level `id` (uuid,
required), `type`, `object`, `recordId` (required), `changes?`, `before?`,
`after?`, `userId?`, `timestamp`. But the producer (the ObjectQL engine)
published a raw `RealtimeEventPayload` envelope with `{ recordId, after,
changes }` nested under `payload` and never generated `id`/`userId`, while the
client SDK force-cast that envelope into the callback (`callback(event as any
as DataEvent)`). Subscribers who wrote `event.recordId` / `event.changes` —
exactly what the types promised — compiled green and read `undefined` at
runtime. The data-side twin of #4602.

Producer now fulfils the contract:

- `ObjectQL.insert()` / `update()` / `delete()` build a true `DataEvent`
  (generated uuid `id`, flattened top-level fields, `userId` from the
  execution context when the write names an actor) and validate it with
  `DataEventSchema.parse` before publishing. The transport envelope is
  unchanged (`RealtimeEventPayload`, with `payload` carrying the complete
  `DataEvent`), so subscribers keep receiving `{ type, object, payload,
  timestamp }` on the wire.
- A batch insert publishes one event **per record** (as before), each with its
  own event id.
- **A multi-row write (`multi: true` → `updateMany` / `deleteMany`) now
  publishes nothing.** Those driver methods return only an affected count, so
  there is no record for a required `recordId` to name; the engine logs a
  warning naming the gap instead of publishing the previous fabrication
  (`recordId: ''`, `after: <affected count>`), which every schema-compliant
  consumer had to reject. **Consequence: webhooks and knowledge sync no longer
  fire for bulk writes** — they previously fired once with an unusable body. A
  real bulk event contract is tracked in #4639.

Consumers validate or read the fulfilled shape instead of guessing:

- `@objectstack/client`'s `subscribeData` (and therefore
  `@objectstack/client-react`'s `useDataSubscription` /
  `useDataSubscriptionCallback` / `useAutoRefresh`, which delegate to it)
  unwraps the envelope and runs `DataEventSchema.safeParse` at the boundary.
  An off-contract payload is rejected loudly (handler error, callback never
  invoked) — never coerced or passed through. The `as any as DataEvent`
  double-cast is gone, and the `recordId` option now filters on the fulfilled
  event.
- `@objectstack/plugin-webhooks`' auto-enqueuer reads the required
  `recordId` directly; its `recordId ?? id ?? after?.id ?? before?.id ??
  'unknown'` fallback chain is gone, and an off-contract event is dropped with
  a warning rather than delivered under the literal id `'unknown'`. Delivered
  webhook bodies now also carry the event's `id`/`type`/`userId`; the record
  itself stays nested under `after` and the envelope keys (`object`,
  `recordId`, `action`, `timestamp`) still win.
- `@objectstack/service-knowledge`'s event sync reads the record from `after`
  (create/update) and the id from `recordId` (delete) for `data.record.*`.
  It previously indexed the envelope itself as if it were the row, and never
  resolved an id for deletes.
