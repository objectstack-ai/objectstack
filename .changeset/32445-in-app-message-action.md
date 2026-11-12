---
'@objectstack/service-messaging': patch
'@objectstack/platform-objects': patch
---

feat(messaging): an organization administrator can send an in-app message to everyone in their organization, or to the members they pick, from Setup

Clause-②: yes
Metadata-protocol: none

Setup → Diagnostics → Notification Events now carries a **Send In-App Message** action. The message goes through the platform's single notification ingress, lands in each recipient's notifications, and appears on that list as one event.

- **`@objectstack/service-messaging`: `POST /api/v1/messaging/in-app-messages`.** The body is `{ everyone, recipients, title, body, severity, link }`, and nothing else: either `everyone: true` or a `recipients` list of user ids, not both. The door requires the `setup.write` capability in the caller's current organization, refuses a request with no current organization, and never reads the organization from the body. `everyone` reaches every member of the caller's current organization and no one outside it; picked recipients must each be a member of it, and a request naming anyone else is refused by name with nothing sent. A picked id is always addressed as that one user, never read as an audience selector or an email address. `severity` is `info` (the default), `warning` or `critical`; `link` is a path on this site or an `http(s)` address. Each refusal says what to change and that nothing was sent. On success the answer is `{ notificationId, recipients, delivered, enqueued, failed }`, where `recipients` is how many people the message went to; a member whose notification preferences turn the topic (`org.announcement`) off is not sent it and not counted. `MessagingServicePlugin` mounts the door beside the notification-preference options door, on the same HTTP server.
- **`@objectstack/platform-objects`: the `send_in_app_message` action on `sys_notification`.** A list-toolbar `api` action aimed at that route, whose form is the door's body, one field per key. Its `requiredPermissions` is the door's own capability, `setup.write`, so the action is listed to exactly the callers the door admits: organization administrators and the platform administrator by default, and a custom permission set that grants `setup.write`. A plain member does not see it. Its labels are in the translation bundles.
