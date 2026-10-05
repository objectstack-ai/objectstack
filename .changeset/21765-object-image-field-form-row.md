---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

Studio's object form offers `imageField`, the record's picture, as a text row beside `nameField`

Clause-②: no

The object form in the metadata form registry now has an `imageField` row, a plain text input placed beside `nameField`. Until now the only way to set the record picture from Studio was the Source tab's raw JSON. The help text says what the parse accepts: a field of this object whose type is `image` or `avatar`. Left empty, the object has no record picture and no placeholder is drawn. The row brings no picker and no validator of its own. A name that is not an `image` / `avatar` field of the object is refused when the object is saved, by the same parse rule as before.

`@objectstack/platform-objects` ships the row's label and help text in its metadata-form translation catalogs, translated for `zh-CN`, `ja-JP` and `es-ES`.

No schema key, accept set, refusal, error code or status changes, and you have nothing to re-author.
