---
'@objectstack/plugin-webhooks': patch
---

The webhook redeliver veto now refuses a delivery whose `sys_webhook` subscription is inactive. The `active` field declares that an inactive webhook is skipped by the dispatcher, and an operator's explicit replay is the dispatcher too, so the declaration now holds on both paths.

Clause-②: no

- FROM: the redeliver door (`POST /api/v1/webhooks/redeliver`, and the `webhooks` slot's `handleRedeliver`) replayed a finished delivery whose subscription had `active` switched off. The veto refused only a subscription that was gone, or whose signing secret could not be recovered.
- TO: the door answers `409 DELIVERY_NOT_ELIGIBLE` for that delivery and leaves the row as it is. The message names the webhook, says it is inactive, and names the remedy. The test is the dispatcher's own predicate, `active === true`, so a row whose `active` is null or absent is refused exactly as the dispatcher skips it. Every row the engine writes carries a boolean there: the field is required, with default `true`.
- Fix, for an operator who means to replay: re-activate the webhook, then redeliver.

The gone-subscription and unrecoverable-secret refusals are unchanged, in text and in order. The inactive check runs after the gone check and before the secret check, so an inactive webhook whose key is also unrecoverable is refused as inactive, the first remedy to try. No code, status, field or export changes.
