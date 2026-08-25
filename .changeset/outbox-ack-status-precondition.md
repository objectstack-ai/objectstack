---
'@objectstack/service-messaging': minor
---

`INotificationOutbox.ack()` enforces its declared precondition — the row must be claimed — in both implementations, and `attempts` moves only for a real dispatch attempt

`ack()` is the dispatcher's completion callback for a row it CLAIMED, and
neither implementation checked that. `MemoryNotificationOutbox.ack` looked the
row up by id and mutated it; `SqlNotificationOutbox.ack` read only `attempts`
by id. So `ack(id, { success: false, suppressed: true })` on an unclaimed
`pending` row succeeded, flipped the row to terminal `suppressed`, and
incremented `attempts` — which made `ack` read like the cancellation primitive
this interface deliberately does not have.

That was a trap in two directions. It **raced the dispatcher**: between a
caller's `list()` and its `ack()`, `claim()` could take the row — `claim` is
atomic by contract and `ack` was never part of that atom — so a suppression
could land on a delivery already on the wire, or a dispatcher's real outcome
could be overwritten by a caller that thought it was cancelling. And it
**corrupted `attempts`**: the counter feeds the retry schedule
(`classifyDeliveryAttempt(result, errorClass, row.attempts, …)`), so a row
"cancelled" this way arrived at its next real attempt with the backoff already
advanced by an attempt that never went out.

Both implementations now refuse an ack on a row that is not `in_flight`,
throwing `NotificationAckError` with this package's already-registered
ADR-0112 code `DELIVERY_NOT_ELIGIBLE` — the same refusal
`SqlHttpOutbox.redeliver` raises when its own compare-and-set misses. A refused
ack writes **nothing**: status, `attempts` and `error` are left exactly as they
were, so the row stays claimable and its backoff position stays honest. An id
matching no row remains a silent no-op — an absent row has no state to corrupt
and no claim to lose.

`SqlNotificationOutbox` does it as an **atomic conditional update** rather than
a read-then-write, because a read cannot hold a row still and a read-then-write
is the same defect wearing a different hat. The precondition is re-stated in
the write (`where: { id, status: 'in_flight' }`), which — per #11009 — must
ride the predicate path: on the by-id path the driver binds only the primary
key and the extra predicate is silently discarded. `attempts` is incremented
inside that condition and nowhere else, so the counter can only move for a row
that was genuinely claimed. A conditional write that matches nothing is
reported rather than passed off as success.

`NotificationDispatcher` absorbs exactly one refusal — `DELIVERY_NOT_ELIGIBLE`
— logs it and continues with the rest of the batch, because a send slower than
`claimTtlMs` legitimately loses its claim to the visibility-timeout reap, and
letting that unwind the partition loop would strand every still-valid row in
the batch `in_flight` until its own timeout expired. Any other error still
propagates.

The sibling HTTP outbox is deliberately untouched: `assertHttpRedeliverable`
depends on `IHttpOutbox.ack` incrementing `attempts` unconditionally, so that
`attempts === 0` on a terminal row still means "parked, never sent".
