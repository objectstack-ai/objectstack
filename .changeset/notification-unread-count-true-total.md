---
"@objectstack/service-messaging": patch
---

fix(services): `unreadCount` counts the TOTAL unread, not the returned window (#6363)

`ListNotificationsResponseSchema.unreadCount` is published into the API
reference as **"Total number of unread notifications"** — a `.describe()`, so it
is the documentation shipped to every consumer of
`GET /api/v1/notifications`. It was counted inside `rows.map(...)` in
`MessagingService.listInbox`, i.e. over the rows that `limit` had already
truncated, so the badge saturated at the window size forever.

Measured on a real stack (sqlite-wasm + ObjectQL + service-messaging + hono +
dispatcher) with 60 unread messages:

| request | `notifications[]` | `unreadCount` (before) | `unreadCount` (after) |
|:---|---:|---:|---:|
| no `limit` | 50 | **50** | **60** |
| `?limit=10` | 10 | **10** | **60** |

The declaration was right and the implementation was wrong, so the
implementation moved (maintainer ruling, 2026-08-07). Every consumer that
renders `unreadCount` as a bell badge now gets the number it asked for; nothing
had to learn an implementation detail to read the field correctly.

**The list itself is unchanged.** `notifications[]` is still the window —
`limit` rows, default 50, hard cap 200, newest first. The two bounds were
conflated, not shared.

Read-state lives on `sys_notification_receipt`, not on the inbox row
(ADR-0030), so the total is a reverse join rather than a `count()`. It is
computed only when the window came back **saturated** (`rows.length === limit`)
— a short window is already the whole matching set, so the common inbox costs
exactly what it cost before. When the window does saturate, the extra work is
one projection read of a single column (`notification_id`) under the same
`where`, no `orderBy` and no `limit`: the same order as the receipt scan
`listInbox` already performs unconditionally, and exact under a `type` filter
and for rows carrying no `notification_id`.

Two related behaviours are unchanged and now pinned: a `read` filter narrows
the list and never the badge (asking for the read half does not mean zero
unread), and a `type` filter narrows both (the count answers the query that was
asked).
