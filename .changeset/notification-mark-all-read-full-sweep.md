---
"@objectstack/service-messaging": patch
---

fix(services): `markAllRead` clears the WHOLE inbox, not one 200-row window (#6436)

`POST /api/v1/notifications/read/all` is published as "mark **every**
currently-unread inbox message as read". It swept
`listInbox(userId, { read: false, limit: 200 })` — one page of the LIST, and
`200` is that list's hard cap — so it cleared at most 200 receipts per call.

Measured over the real stack (sqlite-wasm + ObjectQL + service-messaging + hono
+ dispatcher), one user, 260 unread:

| request | before | after |
|:---|---:|---:|
| `POST /notifications/read/all` | `readCount: 200` | `readCount: 260` |
| `GET /notifications` (same user, next) | `unreadCount: 60` | `unreadCount: 0` |

**#6363 did not cause this — it removed the cover.** While `unreadCount` was
itself window-scoped the shortfall was self-consistent and invisible: clear 200,
poll, see a window with nothing unread in it, badge 0. Now that the badge is a
true total, the same request pair states the contradiction out loud, which also
raises the severity — a user presses "mark all read" and the badge stays lit.

**A second, sharper face of the same defect, fixed with it.** That window was
`created_at desc` over ALL rows, with the `read` filter applied in memory AFTER
the truncation. An inbox whose newest 200 were already read therefore handed the
sweep an EMPTY id list and marked **nothing at all**, however much older unread
sat behind it. That is also why "loop the pages until one comes back empty" is
not the fix: it exits on exactly that empty first page.

**What it does now.** It reads the unread SET rather than a page of the list, in
a FIXED two reads whatever the inbox size — the same one-column, unwindowed
projection of `sys_inbox_message` that #6363's `countUnreadTotal` already issues
to answer the badge, joined against the receipt spine `listInbox` already reads
unbounded. No loop and no page count to bound; nothing is asked of the data
layer that the bell's poll does not already ask on every saturated page. The
write stays one receipt per unread notification — that is the receipt model
itself (ADR-0030) — and `markRead`'s check-then-act upsert, its unique-conflict
convergence and its "no receipt row yet" insert are untouched.

`readCount` now reports the number of **distinct notifications this call flipped
to `read`** (it reported "the unread ones inside the newest 200 rows"). Two
consequences: a notification materialized by several inbox rows counts once, and
an inbox row carrying no `notification_id` is skipped rather than counted —
read-state is keyed by the event id, so the receipt the old code wrote for those
(keyed by the inbox ROW id) was one the join could never read back.

Unchanged: the list window (default 50, cap 200, newest first), `unreadCount`,
`markRead`, and an inbox smaller than the old window — which does the same
writes it always did, and no extra ones.
