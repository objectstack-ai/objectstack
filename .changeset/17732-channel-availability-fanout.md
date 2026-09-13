---
"@objectstack/service-messaging": minor
"@objectstack/platform-objects": minor
---

Notification fan-out asks a channel whether the tenant can send on it before writing anything, so a channel with no transport no longer produces `sys_notification_delivery` rows that exist only to dead-letter (#17732).

`MessagingChannel` gains one **optional** member, `isAvailable(ctx, { organizationId })`, answering `{ available: true }` or `{ available: false, reason }` from the closed vocabulary `CHANNEL_UNAVAILABLE_REASONS` (today: `transport_not_configured`). `emit()` consults it once per channel per emit — availability is a property of `(tenant × channel)`, not of a recipient — and a channel that answers unavailable gets no delivery row and no `send()` call on either the outbox (P1) or the inline (P0) path.

- **Optional means available.** A channel that does not implement the member is treated exactly as before. Every existing implementation, in this repo and in yours, keeps working unchanged with no edit; the same is true of a channel that is registered but unknown to this version. ⛔ There is no way to configure the opposite default.
- **The suppression is recorded, not swallowed.** `sys_notification` gains one key, `suppressed_channels` — `[{ channel, reason }]`, `NULL` when nothing was suppressed — written in the *same* insert that creates the event row, so the feature costs no additional write. `EmitResult` gains the matching `suppressed` array, so a caller is never handed a delivery count that silently omits a channel it asked for.
- **The `email` channel answers from the transport it was handed** — a service-registry lookup, no I/O, nothing cached. Mail configuration in this tree is the `mail` settings namespace at `scope: 'global'`, materialised into a single in-memory transport that the settings change bus hot-swaps, so there is no per-tenant row to read and a memoized answer would survive the settings save that fixed it. The query still takes the tenant context so a future tenant-scoped transport needs no interface change.
- **A probe that throws is treated as available** and logged at `warn`: a broken availability check degrades into today's behaviour, never into a silent notification outage.
- ⚠️ **Unchanged on purpose**: a channel named in `channels` that is not *registered* at all keeps its existing path — the inline fan-out reports it as a failed delivery, the outbox enqueues a row the dispatcher dead-letters. It has no implementation to ask, and widening this ruling to cover it is filed separately.
