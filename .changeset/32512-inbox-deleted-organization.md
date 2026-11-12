---
'@objectstack/service-messaging': patch
---

fix(messaging): the inbox read API serves no message of a deleted organization

Clause-②: no
Metadata-protocol: none

An organization delete keeps its inbox messages (`sys_inbox_message` is engine-owned, so the rows live out their 90-day retention), and `GET /api/v1/notifications` went on listing them, counting them in `unreadCount`, and letting `POST /api/v1/notifications/read` and `/read/all` mark them. The inbox read API now leaves out every message whose organization no longer exists: it is not listed, not counted, and not marked read. A message that names no organization is served as before, and nothing is deleted. When the organization table cannot be read, the inbox is served as stored and the service logs one warning.
