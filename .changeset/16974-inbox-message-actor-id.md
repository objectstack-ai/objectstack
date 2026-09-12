---
"@objectstack/service-messaging": minor
---

`sys_inbox_message` rows now carry **`actor_id`** — who caused the notification — and the actor travels there end to end from the `emit()` that raised the event.

Until now an inbox row could not answer "did I cause this?". The actor stopped one layer upstream on `sys_notification.actor_id`, and the shipped default permission sets grant a member no read on `sys_notification`, so the value was behind an FK hop into an object the reader cannot open. Consumers implementing the standard "do not notify me of my own action" rule had nothing to compare, and the visible failure was the notification that says *you* just did the thing you just did.

The path, one leg per seam, no new read anywhere:

- **`Notification.actorId?: string`** (`channel.ts`) — the per-recipient unit every channel implementation consumes gains an optional member, with the same semantics as `sys_notification.actor_id`.
- **`emit()`** projects `EmitInput.actorId` onto that unit on the P0 inline path, and **`enqueueDeliveries`** snapshots it into the delivery row's payload on the P1 outbox path — beside the rendered title/body, under the rule the enqueue path already states in its own comment: an event edited after enqueue cannot rewrite an in-flight send. `DeliveryPayload.actorId?: string` is declared rather than left to that type's index signature.
- **The dispatcher** reads it back off that snapshot in `processRow`. It deliberately does **not** re-read `sys_notification`, which would cost one read per delivery and break the snapshot rule.
- **The inbox channel** writes `actor_id: n.actorId ?? null`, and `sys_inbox_message` declares `actor_id` as a `sys_user` lookup.

**A digest row keeps `actor_id` null by construction.** A collapsed group has no single actor, so asserting "you caused this" over a message that also carries other people's events would be wrong; `processDigestGroup` sets no actor and the object's own description says so.

**Existing rows read `actor_id` null**, which a consumer's `row.actor_id === currentUserId` evaluates as "not mine" — the pre-change behaviour for rows written before this release. Nothing is backfilled: the value was never captured on those rows, so any backfill would be invented.
