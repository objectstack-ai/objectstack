---
'@objectstack/platform-objects': patch
---

The `sys_email` field help for Headers (JSON) and Status no longer names the `IEmailService.send` service interface (#22093)

Clause-②: no

Studio shows these descriptions as field help in the object forms. They now say what the field holds and when it is set, in product words: Headers (JSON) holds the custom headers supplied with the message when it was sent, and Status is `queued` when the message is submitted for sending, before the first delivery attempt. Every other fact the help states is unchanged. The `en` bundle is regenerated from the source, and the `zh-CN`, `ja-JP` and `es-ES` translations of the two leaves are re-translated in place. Wording only: no field, option, key or type changes.
