---
'@objectstack/service-messaging': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/spec': patch
---

A dropped webhook subscription now leaves a durable record, and no operator action can turn that record into an unsigned delivery (#8069).

When the auto-enqueuer cannot decrypt a webhook's signing secret or its custom header map, it drops the subscription rather than delivering unsigned (#7799, #7986). Until now the drop left no `sys_http_delivery` row at all: every matching record change was discarded with nothing an operator reading the delivery table could find. `#8043` made that loud in the logs; it did not make it durable.

Each discarded event is now recorded as a `sys_http_delivery` row with `status: dead`, `attempts: 0`, and the cause and remedy in the existing `error` column — so it appears in the object's existing "Failures" view with no new lifecycle state and no migration.

The record is unsendable by construction, which is the half that matters:

- `redeliver()` refuses any terminal row with `attempts: 0`. Such a row was never sent, so re-sending it would be a **first** delivery — and a parked row carries no HMAC signature, because the secret that would have produced one is exactly what went missing. New error code `DELIVERY_NEVER_SENT` (409 on `POST /api/v1/webhooks/redeliver`).
- `redeliver()` also consults a producer-registered guard, so a webhook row whose `sys_webhook` subscription was deleted, or whose stored signing secret can no longer be recovered, is refused rather than replayed. A guard whose own lookup fails refuses too.
- The parked row never carries the authored header map, so a credential is not copied onto a row that will sit out the retention window without ever being sent.

Redelivery of a genuine dead-letter is unchanged: the same bytes, the same signature.
