---
'@objectstack/plugin-email': patch
---

fix(plugin-email): a malformed recipient address is the caller's `400 VALIDATION_FAILED`, not a `500` (#29152)

Clause-②: no
Metadata-protocol: none

- A malformed address in `to`, `cc`, `bcc` or `replyTo` (an empty `to` string and one bad member of a list included) is now refused by `normalizeMessage` as `VALIDATION_FAILED: invalid recipient address in FIELD: ADDRESS` (`invalid reply-to address` for `replyTo`). `POST /api/v1/email/send` already answers that prefix with `400 { code: 'VALIDATION_FAILED' }`, so a caller-correctable input no longer answers `500 EMAIL_SEND_FAILED`.
- An unsendable configured sender (`OS_EMAIL_FROM`, Settings → Mail → From address) keeps its plain `Invalid email address` error and stays a server-side fault: it is not the caller's to fix.
- A display name that is not a string (a JSON body can carry any value there) is refused the same way instead of failing as a `TypeError` (500).
- Unchanged: the refused send still writes its `sys_email` row at `failed`, and internal senders (template sends, auth mail, messaging) still see the send reject.
- Nothing to do: no metadata, protocol or configuration changes.
