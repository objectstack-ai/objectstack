---
'@objectstack/spec': patch
---

`ObjectSchema.imageField`'s description no longer says the renderer is pending: the record page header draws the picture

Clause-②: no

The console's record page header now reads `imageField`: it draws the named `image` / `avatar` field's value in the record chip beside the title, an `avatar` round and cropped, an `image` whole, and a record whose field is empty shows no picture. The `.describe()` text that `os validate`, the JSON Schema and the reference docs carry dropped its last sentence, "Pending renderer: the record chrome does not draw it yet.", and now says the header draws the picture rather than is to draw it.

Text only: no key, schema shape, refusal, error code or status moves. An `imageField` you already authored takes effect as it is, with nothing to re-author.
