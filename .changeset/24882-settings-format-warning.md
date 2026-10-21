---
'@objectstack/service-settings': patch
---

feat(service-settings): a settings value that misses the format its `email`, `url`, `phone` or `color` type declares is now reported in the server log; the save is still accepted (#24882)

Clause-②: no (warning only: every save and every `OS_*` override accepted before is still accepted, with the same value stored or served, the same status and the same errors)

ADR-0007 declares a format for four specifier types: `email`, `url` and `phone` take "format validation", and `color` takes a hex string. Until now nothing judged that format. `PUT /api/settings/branding` stored a Logo URL of `not a url` and answered 200, and an `OS_*` override was served unchecked.

Both doors now judge the format through one shared check, and report a miss instead of refusing it:

- **Save.** When a save is accepted and a key it touches holds a value that misses its type's format, the service logs one `warn` line for that key. The line names the setting, the type, the expected format and the value's length.
- **Environment override.** An in-force `OS_*` override whose value misses the format draws one `warn` line, at boot or on the first read. The line names the variable, the setting, the type and the expected format. The override stays in force, is served with source `env`, and still locks the key.
- **The value is never printed** in either line, for any key.

The formats are the platform's existing grammars for the same words:

- `email`: an address with a dotted domain, the grammar the mail transport sends with.
- `url`: `scheme://…`, a root-relative `/path`, a `data:` URI or a `blob:` URL. An http(s)-only grammar would flag a relative logo path that the branding reader serves.
- `phone`: digits, spaces and `+ ( ) - .`, at least five characters.
- `color`: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.

Empty values and non-string values are not judged. Surrounding whitespace is ignored, because the readers trim it before use.

**Unchanged.** Status codes, response bodies, stored values, the `FieldError`s a refused save carries, and which overrides are in force. Under the standing rule 「甲」, refusing these values waits for the next major version.
