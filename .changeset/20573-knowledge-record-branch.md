---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): the realtime event bridge no longer keeps a `record.created` / `record.updated` / `record.deleted` branch, and its docs name the events ObjectQL really publishes (#20573)

No producer emits a bare `record.*` event: the ObjectQL engine publishes `data.record.created` / `data.record.updated` / `data.record.deleted` for a single-record write and `data.records.updated` / `data.records.deleted` for a predicate write (`multi: true`), and `@objectstack/spec` already dropped the bare names from `RealtimeEventType`. The `KnowledgeServicePlugin` subscription handler still carried a branch for them, with a `payload.record ?? payload` fallback for a shape nothing sends. That branch is removed. The `data.record.*` sync (record body from `after`, id from `recordId`) and the `data.records.*` stale-index warning are unchanged.

The `enableEventSync` option's TSDoc and the `handleRecordUpsert` / `handleRecordDelete` docs now name `data.record.created|updated|deleted` instead of `record.*`.

If a plugin of yours publishes a bare `record.created`, `record.updated` or `record.deleted` event through `IRealtimeService` and relied on the knowledge index following it, publish `data.record.created|updated|deleted` with the `DataEvent` payload instead (the record in `after`, its id in `recordId`).
