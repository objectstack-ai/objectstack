---
'@objectstack/service-messaging': patch
---

fix(service-messaging)!: in-app inbox messages are written only by the notification system, so the generic data API and the console no longer create, edit or delete them

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped and no stored row is rewritten: a platform object's own declaration closes its generic write door. Existing inbox rows are kept and served as before. -->

**BREAKING** for any caller that wrote `sys_inbox_message` rows through the generic data API. `sys_inbox_message` now declares `managedBy: 'engine-owned'` and `enable.apiMethods: ['get', 'list']`, the pair `sys_notification`, `sys_notification_receipt`, `sys_notification_delivery` and `sys_http_delivery` already declare. ADR-0030's single ingress says no producer writes an inbox row directly; the console's generic New form did, and a row written that way carries no notification id, so it could never be marked read and stayed on the recipient's unread badge until it expired.

What moves:

- `POST`, `PATCH` and `DELETE` on `/api/v1/data/sys_inbox_message` answer `405 OBJECT_API_METHOD_NOT_ALLOWED` (they answered `201` / `200`). `GET` and list are unchanged: a member still reads their own messages, an administrator still inspects them.
- The console offers no New, Edit, Delete or Import on the inbox list, and a user-context engine write to the object is refused `403 PERMISSION_DENIED` by the security plugin's engine-owned write guard.
- **Moved answer: organization delete.** Inbox rows now outlive the organization they name, as the four sibling objects' rows already do. An organization that holds inbox messages is no longer refused `DELETE_RESTRICTED` for them; the rows are kept and keep naming the deleted organization until their 90-day expiry. Until then they are still served in the recipient's bell, because the inbox list is read by recipient, not by organization.

**Rows already written through the old door.** Such a row has no notification id, so it can never be marked read, and after this change a user can no longer delete it either: it stays on the recipient's unread badge until it expires (90 days). Before upgrading, delete the inbox rows that have no notification id over the data API (`DELETE /api/v1/data/sys_inbox_message/:id` for each row whose `notification_id` is empty); otherwise they stay unread until they expire.

The inbox channel, the only first-party writer, writes as the system and is unaffected; messages delivered by `emit()` are still marked read as before.

To send a user an in-app message, call `emit()` on the notification service (`MessagingService.emit({ topic, audience, payload })`); its inbox channel writes the row and its read receipt.

Also: the field help of `sys_inbox_message` (`notification_id`, `delivery_id`, and `actor_id`, relabelled "Triggered By"), and the notification-id and delivery-id help on `sys_notification_delivery` and `sys_notification_receipt`, now describe the field for an administrator instead of carrying developer notes, in every shipped locale.
