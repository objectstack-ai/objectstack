---
'@objectstack/plugin-email': patch
---

fix(plugin-email): a non-string recipient display name answers the send door's 400, not 500

Clause-②: no
Metadata-protocol: none

`POST /api/v1/email/send` with a recipient such as `{ "address": "ok@example.com", "name": 42 }` in `to`, `cc`, `bcc` or `replyTo` (or as one entry of a `to` / `cc` / `bcc` list) now answers `400 VALIDATION_FAILED` with "invalid recipient address in `to`: the display name of ok@example.com must be a string" (`reply-to address` for `replyTo`). It used to answer `500 EMAIL_SEND_FAILED` with `a.name?.trim is not a function`.

The refusal itself was already right. The 500 came from the code that writes the `sys_email` rejection row after the refusal: it called `.trim()` on the caller's raw display name. That writer now reads the name as unknown input and leaves a non-string name out of the row (the row's `error` column names it), so the caller gets the 400 and the rejection is still recorded. A string name, an absent name and a `null` name behave as before.
