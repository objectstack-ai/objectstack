---
'@objectstack/service-messaging': patch
---

fix(service-messaging): the durable fan-out refuses a channel nobody registered instead of writing a delivery row for it

`MessagingService.emit()` on the reliable-delivery (outbox) path wrote one
`sys_notification_delivery` row per recipient for a channel the composition had
never registered, and the dispatcher dead-lettered every one of them on attempt
one. The inline path had always refused this case; only the durable path wrote
the rows, so a deployment whose flows notify on `['inbox','email']` without an
email plugin accumulated guaranteed-dead rows in the hot delivery table.

The durable path now reports the same failed delivery outcome the inline path
reports — `ok: false`, `error: "channel '<id>' not registered"`, counted in
`EmitResult.failed` — and writes no row. The refusal is logged once per channel
per emit with the number of rows it refused, not once per recipient.

The refusal is deliberately **not** recorded in
`sys_notification.suppressed_channels`: that key answers "why can this tenant not
send on this channel", and an unregistered channel is a composition fact,
identical for every tenant in the process. The event row's column set is
unchanged.
