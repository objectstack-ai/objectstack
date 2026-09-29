---
'@objectstack/service-realtime': patch
---

docs(service-realtime): the README and `InMemoryRealtimeAdapter` examples name the events the ObjectQL engine actually publishes (#20288)

The usage example subscribed to and published `record.created`, and the security
posture section said the engine publishes `record.created` / `record.updated`.
The engine publishes `data.record.created` / `data.record.updated` /
`data.record.deleted` (and `data.records.updated` / `data.records.deleted` for a
predicate write), with the spec's `DataEvent` as the envelope's `payload` — the row
is `payload.after`, not the payload itself. Both examples now subscribe to
`data.record.created` and publish that shape. No code changes: the adapter matches
whatever event type a subscription names, exactly as before.
