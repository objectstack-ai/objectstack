---
'@objectstack/service-messaging': patch
---

fix(notifications): the `email` channel answers unavailable while the email service only has the log transport, so a notification is no longer recorded as delivered when no mail left the server

Clause-②: no
Metadata-protocol: none

- **What was wrong.** plugin-email registers the `email` service on every boot; with no `mail` settings saved its live transport is the log transport, which writes the message to the server log and to `sys_email` and sends nothing. The `email` channel treated "an email service is registered" as "available", so fan-out wrote a `sys_notification_delivery` row per recipient and the dispatcher marked it `success` while nobody was mailed.
- **What changes.** The channel now asks the service's own deliverability answer, `IEmailService.isConfigured()`, on every call. While it answers `false`, `isAvailable()` answers `{ available: false, reason: 'transport_not_configured' }`: fan-out writes no delivery row and records the suppression on `sys_notification.suppressed_channels`, exactly as it does with no email service at all. `send()` refuses a row that was already written with the same `transport_not_configured` reason, graded permanent, and never hands it to the service. No new reason and no new error code.
- **No restart needed.** The answer is read from the live transport, so saving a working provider under Setup → Email makes the channel available on the next notification, and switching back to the log transport makes it unavailable again.
- **Unchanged.** An email service that does not implement `isConfigured` (it is optional on the contract) keeps today's behaviour: the channel stays available and sends through it. `EmailSenderSurface` gains the optional `isConfigured?(): boolean` member, mirroring the contract.
