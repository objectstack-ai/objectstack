---
"@objectstack/service-messaging": patch
"@objectstack/service-automation": patch
---

fix(services): a notify flow-run summary no longer reports a delivery the delivery record dead-lettered (#7747)

Boot a stack without the `push` channel registered, fire a flow whose `notify`
node targets `['push']`, and the two records an operator can read **contradicted
each other**: `sys_notification_delivery` held `status: 'dead'`,
`error: "channel 'push' not registered"`, while the flow-run summary said
`status: 'success', acted: 1`. Nothing was delivered, and the surface built to
answer "did this sweep actually do anything" (#4354) said it had.

The seam is `EmitResult.delivered`. With the durable outbox in play (ADR-0030
P1), `emit()` returns as soon as the `(recipient × channel)` rows are enqueued —
the dispatcher sends and decides the outcome afterwards — but `delivered`
counted those *enqueued* rows anyway, under a name that says they arrived. The
`notify` node then fed that number straight into `acted`, so a count minted
before any send attempt survived unrevised through the dead-letter. It was never
a "stale by a moment" number either: nothing ever revisits it.

- `EmitResult` now separates the two. `delivered` means a channel **accepted**
  the delivery — a terminal, observed outcome, which only the inline (P0)
  fan-out can report. New `enqueued` carries the outbox path's accepted rows:
  durable, unsent, outcome pending on `sys_notification_delivery`.
- The `notify` node counts only what was delivered toward `acted`. When
  deliveries are merely enqueued it reports `unmeasuredEffect` instead — the
  qualifier a `connector_action` already uses for an effect the platform cannot
  count, and deliberately **not** a bare `acted: 0`, which would claim the run
  did nothing. The broken-sweep alert is
  `selected > 0 AND acted = 0 AND unmeasured = 0`, so a pending delivery
  suppresses the alert without asserting success. The node's output gains
  `enqueued` alongside `delivered` and `notificationId`.

The run still reports `success`: the flow did everything it can do
synchronously, and failing it would let a channel registered a moment later
retroactively break the flow. Notify does not block a flow on a downstream
channel, so "delivered" is not a claim it is ever in a position to make — what
changes is that it no longer makes it. Inline (P0) fan-out is untouched: it has
the channel's answer by the time `emit()` returns, so `acted` stays a real
measurement there, including the measured zero for an unregistered channel.
