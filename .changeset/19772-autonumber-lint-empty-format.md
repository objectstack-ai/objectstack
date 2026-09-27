---
"@objectstack/lint": patch
---

`os validate` and `os build` now check an `autonumber` field's `format` when its `autonumberFormat` is an empty string (#19772).

An empty `autonumberFormat` counts as not set: the platform numbers records with the field's `format` instead, and with `{0000}` when neither is set. The build-time check stopped at the empty `autonumberFormat` and looked no further, so a `format` naming a field the object does not have — `{ type: 'autonumber', autonumberFormat: '', format: '{nope}{000}' }` — passed `os validate` and `os build`, and then every record create failed with `Cannot generate autonumber … referenced field(s) [nope] are empty on the record`.

The check now reads the format the platform numbers records with. That field now fails the build with the same `autonumber-references-unknown-field` error it gets when `format` is written alone, and publishing the object at runtime is refused with the same error. The optional-field, self-reference and unrecognised-token checks follow the same format. A field that sets a non-empty `autonumberFormat`, sets only `format`, or sets neither is checked exactly as before.
