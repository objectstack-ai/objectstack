---
'@objectstack/service-messaging': patch
---

feat(service-messaging): serve the notification topics and channels a preference or template can name

Clause-②: yes (widening) — a new read-only route, `GET /api/v1/messaging/preference-options`, mounted by `MessagingServicePlugin` on the kernel's HTTP server; nothing existing is narrowed or refused.
Metadata-protocol: none

The topic and channel of a notification preference stay free text, `*` is still stored as written, and nothing new is refused. What is new is a list the console can offer beside the text box, so an administrator picks a value instead of typing a machine name from memory.

- **The route.** `GET /api/v1/messaging/preference-options` answers `{ topics, channels }`. `topics` starts with `*` and lists the platform's fixed topics (`approval.requested`, `collab.mention`, …), the topics this environment's flow `notify` steps send under (`notify` for a step that names none), and the topics already stored on this organization's notifications, each once with every source that names it. `channels` starts with `*` and lists every channel the service knows, with `configured: false` on one whose service is not set up yet (email with no email service, …). Any signed-in member may read it, as on `/api/v1/notifications`; an anonymous caller is refused `401`, a held sign-in `403`, and a query parameter `400`. A topic stored in one organization is never listed for another.
- **The fields.** `sys_notification_preference.topic` and `sys_notification_template.topic` declare `widget: 'notification-topic'`, and `sys_notification_preference.channel` declares `widget: 'notification-channel'`, for the console's pick-or-type inputs; until the console registers them, the fields render as the same text boxes. The template's channel keeps its existing refusal.
- **The help.** The preference channel's help now names `push`, available once a push service is configured, in every language.
