---
'@objectstack/spec': patch
---

fix(spec): the `script.config.template` tombstone points at the `notify` node's own `template` key

Clause-②: no (prose only: no shape, key, default or accepted value moves)

The rejection an author sees for the retired `script.config.template` key said that stored templates live in the messaging service (`sys_notification_template`). That text predates the `notify` node's own `template` key. It now prescribes that key: name an email template (`email_template`) in a `notify` node's `template`, with `templateData` filling its placeholders, and the email and in-app inbox channels render it in each recipient's locale; otherwise the node carries inline `title`/`message`. It mentions `sys_notification_template` only as the rows the `email` and `sms` channels read, `email` only when the node names no template. The key stays rejected exactly as before, and the generated reference page carries the same text.
