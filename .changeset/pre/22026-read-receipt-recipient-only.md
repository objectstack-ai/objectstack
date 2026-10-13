---
'@objectstack/service-messaging': minor
---

fix(service-messaging)!: mark-read writes a read receipt only for a notification delivered to that user

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime narrowing on the inbox mark-read path, not a metadata change: no spec key, export, option, response field or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which ids produce a receipt row: an id never delivered to the caller now writes none and is not counted, while every delivered id behaves as before. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this path and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention: `MessagingService.markRead` — the method behind the notifications mark-read door, and behind `markReadAsCaller` — writes a `read` receipt only for a notification that was delivered to that user. A read receipt belongs to a recipient (ADR-0030 keys it by recipient).

- **Delivered** means a receipt keyed on that user already exists (it is flipped to `read` in place, as before), or the user's inbox holds a message for that notification. The inbox message is enough on its own, because the inbox channel's `delivered` receipt is best-effort.
- **Any other id** writes no receipt, is not counted in `readCount`, and its notification's organization is not read. The response shape `{ success, readCount }` is unchanged.
- **`markAllRead`** is unchanged: every id it sweeps comes from the user's own inbox.

What changes for you: nothing in what you write. A `readCount` lower than the number of ids sent means some of them were not notifications delivered to that user, and nothing was written for those.
