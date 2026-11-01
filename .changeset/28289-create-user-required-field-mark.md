---
'@object-ui/core': patch
'@object-ui/app-shell': patch
---

fix(console): Create User left without an email marks the Email input as required, in the user's language

Clause-②: no
Metadata-protocol: none

Create User with neither an email nor a phone number answers `400 VALIDATION_FAILED` with one `required` entry per input that would satisfy it on `error.fields`. The Console showed only the server's English sentence above the dialog's buttons and marked no input.

- **`@object-ui/core`**: `refusalFieldErrors`, the reader behind `ActionResult.fieldErrors`, now also reads a refusal's `error.fields` (the spec's `EnhancedApiErrorSchema.fields`), beside `error.details.fields` and the legacy inner `fields`. It is exported.
- **`@object-ui/app-shell`**: a refused `type: 'api'` action carries the refusal's field entries as `fieldErrors`, on the list and record pages alike. The action parameter dialog marks each `required` entry on the param it names, with its own translated "required" sentence and the param's label. When every entry is marked, the refusal box is not drawn. A refusal that names no field, or names one the dialog does not draw, keeps the box with the server's text.
