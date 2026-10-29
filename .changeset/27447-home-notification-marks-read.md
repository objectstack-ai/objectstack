---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): opening a notification from Home's "My work → Notifications" card marks it read, as the bell does

Clause-②: no
Metadata-protocol: none

Clicking a notification in the top-bar bell marked it read and then opened its link. Clicking the same notification on the Home page's "My work → Notifications" card only opened the link: no `POST /api/v1/notifications/read` was sent, the server's `unreadCount` did not change, and the bell kept its badge after a reload.

Both places now use one open action, `openInboxNotification`. It marks the notification read first, then opens its link, or opens the inbox when the notification has no link. The Home card marks read through the bell's own write (`useInboxBell().markRead`), so it sends the same request, keyed by the notification's event id. Once the inbox feed re-reads, the Home card's unread count and the bell's badge drop.
