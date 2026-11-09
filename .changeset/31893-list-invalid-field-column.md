---
'@object-ui/plugin-list': patch
'@object-ui/data-objectstack': patch
'@object-ui/i18n': patch
---

fix(ui): a list refused with `400 INVALID_FIELD` names the field, and the column that asked for it

Clause-②: yes (widening) — `@object-ui/i18n` gains two `list.*` keys (`loadErrorUnknownColumnMessage`, `loadErrorUnknownFieldMessage`) in every locale pack; the adapter's raw `$expand`/`$search` error gains a `details` member. Nothing that worked before is refused.
Metadata-protocol: none

A list view whose query the server refuses with `400 INVALID_FIELD` used to show only "This view's query was rejected". The rejected panel now reads the refused field from the answer's structured `details.field` (never from its sentence):

- when the field is one of the view's columns, it names the column (its authored label, else the field name), the field and the object, and says an administrator needs to correct or remove the column;
- otherwise it names the field and keeps the filter remedy.

Every other 400, an `INVALID_FIELD` that names no field, and a refused search term keep the panel they had.

`ObjectStackAdapter.find`'s raw `$expand`/`$search` branch now keeps the answer body on `err.details`, as `@objectstack/client` does (`details`, else `error.details`, else the whole body). Before, a view with a lookup column took that branch and lost the field.
