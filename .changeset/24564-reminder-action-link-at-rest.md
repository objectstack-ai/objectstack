---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): a reminder's notification no longer carries one-tap approve / reject links, so no stored notification row holds a raw action token

Clause-②: no

- **What changed.** `remind()` still sends each concrete pending approver their own `approval.reminder` notification, with the same title, body and deep link to the request in the Approvals Inbox. It no longer mints ADR-0043 action tokens for that notification, and the payload it hands to `messaging` has no `actions` list. Messaging stores that payload, on the `sys_notification` event row and on each `sys_notification_delivery` row, so the links were kept in the database as usable links. ADR-0043's storage rule (`sys_approval_token` keeps SHA-256 digests only) exists so that the database holds none.
- **What a recipient sees.** Nothing changes. A reminder names no channel, so it is delivered to the in-app inbox, and the inbox row never carried the links.
- **Unchanged.** The action page (`GET` and `POST /api/v1/approvals/act`), `issueActionTokens`, `peekActionToken` and `redeemActionToken` behave exactly as before, and a redeemed token still decides as the approver it binds. The approval notification payload type no longer accepts links, and `issueActionTokens` now states that a raw token may travel only in a message that is sent and not kept.
- **Rows written before this fix.** A reminder sent by an earlier build stored its links. Each of those tokens stops working at its 72-hour expiry, or earlier: once it is used, once its request is decided or recalled, or once its slot is reassigned. The rows themselves age out under the notification tables' retention, 90 days at most.
