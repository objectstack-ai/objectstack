---
'@objectstack/service-messaging': patch
---

fix(messaging): the inbox read API serves no message of a deleted organization

Clause-②: no
Metadata-protocol: none

An organization delete keeps its inbox messages (`sys_inbox_message` is engine-owned, so the rows live out their 90-day retention), and `GET /api/v1/notifications` went on listing them and counting them in `unreadCount`. The inbox list now leaves out every message whose organization no longer exists, and `unreadCount` no longer counts them. A message that names no organization is served as before, nothing is deleted, and `POST /api/v1/notifications/read` and `/read/all` still mark such a message read. When the organization table cannot be read, the inbox is served as stored and the service logs one warning. Not narrowed: the generic data API read of `sys_inbox_message` on a posture without an organization wall (`single`); on walled postures (`isolated`, `group`) the wall already hides a deleted organization's rows there.
