---
'@object-ui/fields': patch
---

fix(fields): the required-fields fill-in dialog offers the options the change makes available

Clause-②: no
Metadata-protocol: none

When a change in place (a stage move on the record page, a list cell, an inline edit, a kanban drop) makes another field required, the fill-in dialog asks for it. A choice field there could show "No options available" and the change could not be saved. This happened when the field's options are each shown only for some values of the field the change writes. Example: every loss reason is shown only while the stage is "closed lost". Moving an opportunity to "closed lost" asked for a loss reason and offered none.

The dialog now judges each option's `visibleWhen` against the record as the write would leave it: the saved record, the change, and the values typed into the dialog so far. So the loss reasons appear, and an option that depends on another value typed into the dialog appears once that value is typed. Options that are not visible on that record stay hidden. The same record already decided which fields the dialog asks for, so the fields asked for do not change.

For hosts: each field `collectRequiredWhenPromptFields` returns now carries `record`, the record it was judged against. The dialog hands it, with the typed values, to every control as `dependentValues`. A row a host builds itself (a field a refusal names) reads the same record when the dialog has a field that carries one.

No metadata key, value or default changes.
