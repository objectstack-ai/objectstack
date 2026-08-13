---
"@objectstack/service-automation": patch
---

fix(service-automation): a durable `http` callout is `unmeasured`, not `acted` (#7882)

The `http` node's durable path (`config.durable: true`) enqueues onto the
messaging HTTP outbox and returned `metrics: { acted: 1 }` for the enqueue. But
`enqueueHttp()` hands back the id of a **`pending`** `sys_http_delivery` row —
the `HttpDispatcher` decides the real outcome afterwards, and that outcome
includes dead-lettering the callout on a non-retriable response or an exhausted
retry budget. So an operator reading the run summary could see `acted: 1` for a
callout the durable record shows as `dead`: the summary asserted an effect that
never happened.

The durable path now reports `unmeasuredEffect` instead. That is the platform's
existing word for "an effect happened but its outcome is not yet knowable" — the
same qualifier `connector_action` uses — and pointedly **not** a bare `acted: 0`,
which `connector.zod.ts` forbids because it would claim the run did nothing and
would trip the documented broken-sweep alert
(`selected > 0 AND acted = 0 AND unmeasured = 0`) on every healthy durable
callout. A pending delivery now suppresses that alert without asserting success,
and `unmeasured` is already surfaced by `formatRunSummaryLine` and by the
`unmeasured_count` column on `sys_automation_run`.

Same overstatement class as #7747 at the sibling `notify` node, but a smaller
fix. That one needed `EmitResult` split into `delivered` vs `enqueued` inside
`service-messaging`, because `MessagingService.emit()` hides two outcomes behind
one call — inline (P0) fan-out, which really does know the result, and the P1
outbox, which does not. `enqueueHttp()` has no such ambiguity: it returns a row
id and the row is unconditionally `pending`, and the two-path structure already
sits in the node itself. Nothing in `service-messaging` changed.

**Unchanged:** the step still succeeds — the flow did everything it can do
synchronously, and not blocking on the callout is the entire point of durable
mode — and its output is still `{ deliveryId, enqueued: true }`. The inline
request/response path keeps its measured counts: a mutating call the upstream
accepted is still `acted: 1`, a `GET` is still a real `acted: 0`, and a rejected
or timed-out mutating call was already `unmeasured`. This narrows what `acted`
may claim; it does not blanket every HTTP callout as unmeasurable.
