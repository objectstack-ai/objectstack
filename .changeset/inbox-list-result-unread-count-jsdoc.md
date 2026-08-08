---
"@objectstack/spec": patch
---

fix(spec): `InboxListResult.unreadCount` no longer documents the window count it stopped being (#6438)

`INotificationService` is a published contract — its JSDoc ships in the `.d.ts` and is
the sentence a TS SDK consumer reads in their editor. The `unreadCount` member said:

> Unread count over the returned window.

That recorded the implementation as it was *before* #6363. After #6363 (Option A,
maintainer ruling 2026-08-07; PR #6439, merged as `17d095413`) `service-messaging`
counts the **total** unread across the user's whole matching inbox, and the window
bounds `notifications[]` only. The wire declaration one directory over had already said
the same thing all along —
`ListNotificationsResponseSchema.unreadCount.describe('Total number of unread
notifications')` (`api/protocol.zod.ts`) — so one package carried two opposite sentences
about one field, with the implementation standing on the `.describe()` side and this
JSDoc the last statement of the retired semantics.

Left alone, it is the sentence that teaches the bug back. A consumer told the number is
"over the returned window" writes exactly the adaptation #6363 exists to delete: counting
`notifications` themselves, or clamping the badge to the page size. That holds double for
AI-written consumers, which are generated from this JSDoc and nothing else.

Both members are now documented, because after #6363 their bounds differ **on purpose**
and the interface had never written that difference down anywhere:

* `notifications` — the `limit`-bounded window, one page, implementations may clamp.
* `unreadCount` — the total across the whole matching inbox, explicitly NOT the window,
  with the "do not re-derive, do not clamp" consequence spelled out for consumers.

Text only. No schema, no value, no behavior: every input that validated before validates
byte-for-byte after, and the generated artifacts (`check:docs`, `check:authorable-surface`,
`check:skill-refs`, `check:api-surface`) are unchanged — the reference docs render from
Zod `.describe()` strings, none of which this touches.
