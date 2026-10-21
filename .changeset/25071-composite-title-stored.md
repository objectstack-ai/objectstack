---
'@objectstack/lint': patch
---

fix(lint): the record-title diagnostics no longer steer a composite title that must be queried into a formula field

Clause-②: no (wording only: no verdict, severity, code, key or export moves)

The `title-format-retired` and `title-unresolvable` messages and fix lines, the `object/missing-name-field` fix line, and the `os explain title-format-retired` text now say the same thing: a composite record title that an import, a sort or a search must match is a stored computed field, a non-formula field (such as a `text` field) that declares an `expression`, which the engine computes and stores on every write, designated as `nameField`. A `formula` field with `returnType: 'text'` stays a legal `nameField` for a title shown for display only: its value is computed on read and stored nowhere, so a sort by it is refused, search never reaches it, and an import cannot match a lookup cell against it.

No finding fires on a different object than before, and no severity changes. Only the text an author reads changes.
