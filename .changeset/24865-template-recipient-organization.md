---
'@objectstack/service-messaging': patch
---

fix(service-messaging): a notification template is resolved in the recipient's organization

Clause-②: no

`sys_notification_template` is organization-owned (ADR-0131: organization ownership is total). The email and SMS channels now render the template row of the delivery's own organization: `NotificationTemplateStore.load(topic, channel, locale, organizationId)` keys its read by the organization the delivery names (`Notification.organizationId`, the organization the notification event row carries), the same way the preference resolver scopes its rows.

- **An organization with no row of its own** for a `(topic, channel, locale)` renders the notification's own title and body, the documented no-template fallback.
- **A call that names no organization** reads no row and answers `null`, so the channel renders that same fallback. Every delivery the messaging service fans out names its organization (the event row takes it from the producer or from the engine's system-write rule, and an emit with neither is refused), so this changes nothing a composed deployment renders. A direct caller of `NotificationTemplateStore.load` passes the recipient's organization as the fourth argument.
- **Unchanged:** the locale ladder (the recipient's locale, its language, then `en`), the `is_active` filter, how a row renders, and the best-effort answer on a failed lookup.
