---
"@objectstack/plugin-security": patch
---

fix(security): `member_default` grants owner-scoped READ on the personal inbox (#7344)

The Account app's **Inbox → Notifications** entry was a dead end for every
non-admin. The app declares no `requiredPermissions`, so it is reachable by
design for every authenticated user, but the object behind that entry was named
by no shipped permission set — so the read came back `403 PERMISSION_DENIED`,
verbatim from the browser-measured run:

```
[Security] Access denied: operation 'find' on object 'sys_inbox_message'
is not permitted for positions [org_member, contributor, finance, everyone]
```

Two consequences were measured: the Notifications entry never rendered anything
for the audience the Account app exists for, and the console bell's notification
half was structurally **0** for any non-admin (a badge reading `2` was
`0 notifications + 2 pending approvals`).

`member_default` now NAMES both halves of the personal inbox, read-only:

| object | read | create | edit | delete | row scoping |
|:---|:---:|:---:|:---:|:---:|:---|
| `sys_inbox_message` | ✅ | ❌ | ❌ | ❌ | `sys_inbox_message_self` — `user_id == current_user.id` |
| `sys_notification_receipt` | ✅ | ❌ | ❌ | ❌ | `sys_notification_receipt_self` — `user_id == current_user.id` |

`sys_notification_receipt` is not an extra: read-state lives on the receipt, not
on the inbox row (ADR-0030), so the entry needs both to render.

**This is not a rollback of #5491.** The baseline stays explicit-allow — no
wildcard returns, and these are two NAMED objects in exactly the shape
`sys_user_preference` already uses there: an object grant plus a `_self` RLS
carve-out. Neither object declares `organization_id`, so Layer 0 is inert on
them (as it is on `sys_oauth_application`) and the `_self` policies ARE the row
scoping — without them the read bit would have been org-wide. A member reads
their own rows and only their own; an unidentified caller fails closed to
`RLS_DENY_FILTER` rather than open.

The grants are READ-only because nothing in the flow needs more: rows are
written by the always-on `inbox` messaging channel keyed on the recipient, and
mark-read is served by `POST /api/v1/notifications/read` rather than the generic
data API. `allowDelete`/`allowExport` stay false, so the set remains bindable to
the `everyone` anchor (ADR-0090 D5).

`sys_activity` is deliberately **not** included, per the maintainer ruling — it
is not a per-user-scoped shape, and it is a separate question if it ever
matters. It is pinned as an explicit negative in the tests.
