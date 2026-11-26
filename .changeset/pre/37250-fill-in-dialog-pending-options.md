---
'@object-ui/fields': patch
---

fix(fields): the required-fields fill-in dialog hands its controls the record the change would leave

Clause-②: yes (widening)
Metadata-protocol: none

A change made in place (a stage move on the record page, a list cell, an inline edit, a kanban drop) can make another field required. The fill-in dialog then asks for that field. The dialog handed its controls no record, so every control that reads the record judged it on an empty one. Any option `visibleWhen` that read a record field was judged without that field. A condition guarded by `has(record.x)` was false, so the option was hidden. A condition without that guard could not be evaluated, and the option was offered whatever the condition said. A choice field whose options were all hidden showed "No options available", and the change could not be saved. Example: each loss reason is shown only while the stage is "closed lost", so moving an opportunity to "closed lost" asked for a loss reason and offered none. Every option list gated by `dependsOn`, and every dependent lookup, stayed on its "select the parent first" gate.

The dialog now hands every control the record as the write would leave it: the saved record, with the change and the values typed into the dialog so far applied on top. What reads that record now resolves on it:

- option visibility;
- `dependsOn` gates on option lists and lookups;
- dependent-lookup filters;
- the currency of a money field that takes its currency from the record or from a parent record.

Each option is now shown or hidden by its condition on the record the write would leave. If the condition is true on that record, the option is shown. If it is false, the option is hidden. This includes an option the dialog used to offer only because its condition could not be evaluated on an empty record. For example, an unguarded `record.stage == "closed_lost"` used to be offered whatever the stage. It is now hidden when the stage stays "negotiation". So in an app whose option conditions do not guard with `has()`, the dialog can offer fewer options than before. A condition that still cannot be evaluated on that record is still offered, for example one that names a field the record does not carry. An option that depends on another value typed into the dialog appears once that value is typed. Which fields the dialog asks for was already decided on this record and does not change.

Widening: the exported `RequiredWhenPromptField` type gains one optional member, `record?: Record<string, unknown>`. That is the record the field was judged against. `collectRequiredWhenPromptFields` sets it on every field it returns, and `RequiredFieldsDialogField` inherits it. The dialog passes it, with the typed values, to every control as `dependentValues`. A row a host builds itself (a field a refusal names) carries no `record`. It reads the record of another field shown in the dialog. When no shown field carries one, it reads only the typed values.

No metadata key, value or default changes.
