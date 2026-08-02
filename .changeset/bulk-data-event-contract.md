---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/client": minor
"@objectstack/plugin-webhooks": minor
"@objectstack/service-knowledge": patch
---

feat(spec,objectql,client,plugin-webhooks): predicate writes get an honest bulk event contract (#4639)

A `multi: true` update/delete reaches `IDataDriver.updateMany` / `deleteMany`,
which are contracted to resolve an affected row COUNT and nothing else. That
satisfies neither `DataEvent.recordId` (required) nor `before` / `after` /
`changes`, so before #4626 the engine fabricated a per-record event with
`recordId: ''` and `after: <count>` — an event every schema-compliant consumer
must reject, and one the webhook enqueuer's `?? 'unknown'` fallback turned into
a real delivery naming an unidentifiable record. #4626 removed the fabrication
and published nothing instead: honest, but it left webhooks, knowledge sync and
`subscribeData` silent for every predicate write.

Bulk writes now get their **own** contract rather than impersonating a
per-record one or going dark:

- **New `BulkDataEvent`** (`@objectstack/spec/api`): `data.records.updated` /
  `data.records.deleted` — note the plural — carrying `id`, `type`, `object`,
  `matched`, `userId?`, `timestamp`. Deliberately a separate schema from
  `DataEvent`, not a widened one: a consumer that receives
  `data.records.updated` knows from the type alone that no `recordId` is
  coming, instead of discovering an empty string at runtime.
- **Engine** publishes it from the `multi: true` branches of `update()` /
  `delete()`, validated with `BulkDataEventSchema.parse` before publish. A
  predicate that matched **zero** rows publishes nothing (no data changed — this
  is what keeps an idle background sweep from becoming an hourly "0 records"
  delivery), and a driver that resolves a non-count publishes nothing and warns
  rather than asserting a number it cannot verify. Per-record writes are
  untouched, including a scalar `where.id` with `multi: true`, which is still a
  single-record target and still emits `data.record.deleted`.
- **Webhooks**: two new opt-in triggers, `bulk_update` and `bulk_delete`
  (`WebhookTriggerType`, and the `sys_webhook.triggers` multi-select). They are
  **not** extra sources for `create` / `update` / `delete`: the delivered body
  has no `recordId` and no record, so routing it to existing per-record
  subscribers would hand them a payload missing every field they read — the
  same class of breakage as the old `recordId: ''`, from the other direction. A
  webhook that wants both subscribes to both. Bulk deliveries dedup on the
  producer's event uuid, since two sweeps in the same millisecond are genuinely
  different events that a timestamp-based key would collapse.
- **Client SDK**: new `client.events.subscribeBulkData(object, cb)`, with the
  same loud boundary validation as `subscribeData`. Kept a separate method for
  the same reason — delivering a `BulkDataEvent` to a `(event: DataEvent) =>
  void` callback would recreate exactly the "typed field, `undefined` at
  runtime" defect #4626 removed. `subscribeData`'s own guard was also tightened
  from `data.` to `data.record.`, so an aggregate event is ignored rather than
  rejected as off-contract.
- **Knowledge sync** now says out loud that a predicate write leaves its index
  stale. A knowledge index is a per-record projection and `matched: 40` names no
  record, so no event shape could drive it — the durable fix is reconciliation,
  tracked in #4672.

The event carries no `where` predicate. The only one available at publish time
is the middleware-composed AST, whose filter embeds the security layer's
injected row scoping (RLS, sharing) — publishing it would ship tenant scoping
internals to whatever external URL a webhook points at.

Also pays off a measurement debt from #4655, which claimed the write-path cost
of event publishing had been measured but never published the numbers:
`packages/objectql/src/engine-data-events.bench.ts` measures it. Against an
in-memory driver, publishing costs ~7–9µs per event (insert 0.021ms vs 0.012ms,
single-id update 0.013ms vs 0.007ms). A bulk write pays that **once** regardless
of how many rows matched (0.040ms vs 0.034ms over a 100-row match set), so its
relative cost shrinks as the match set grows.
