---
'@object-ui/plugin-grid': patch
'@object-ui/fields': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

A list cell commit on an object with a `requiredWhen` field the list does not draw no longer reads the record first when the edited column cannot open the fill-in dialog. The pre-read (one `findOne` for the keys the row lacks) is now made only when the column is an operand of an askable field's `requiredWhen`, when such a predicate reads the clock, the acting user or the record as a whole, or when the askable field is also statically `required`. What the user sees is unchanged; commits to other columns save one request sooner. `@object-ui/fields` exports the judgment the grid asks, `requiredWhenPromptAsksOn(objectFields, changedKeys, { fillable })`.
