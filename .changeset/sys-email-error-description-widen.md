---
"@objectstack/platform-objects": patch
---

fix(platform-objects): `sys_email.error` field help now covers pre-delivery rejections, not only transport failures

`sys_email.error` was declared as *"Transport error message when status=failed"*.
Since `EmailService.recordRejectedMessage` landed, the same column also carries
the reason a message was rejected by `normalizeMessage` **before** it reached a
transport (an unsendable `from`, no recipient, no subject, no body) — those rows
are written with `status: 'failed'` too, prefixed `rejected before delivery: `.

Nothing was misleading in the *data*: the row prefixes its own reason, so an
operator reading a failed row is never sent chasing an SMTP host for a message
that never reached one. What was stale was the field's declared `description`,
which Studio surfaces as the field's help text — it named only the transport
case, narrower than what the column has held since that change landed.

The description now reads: *"Why the message failed — a transport error, or the
validation that rejected it before delivery."* It stays true under both row
shapes and deliberately does not name the row's own `rejected before delivery:`
prefix, so it will not go stale again if that prefix's wording changes.
