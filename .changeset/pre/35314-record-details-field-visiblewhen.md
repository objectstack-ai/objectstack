---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a record page no longer draws a field whose own `visibleWhen` is false for the record

Clause-②: no
Metadata-protocol: none

`record:details` now honours a field's object-level `visibleWhen` (`Field.visibleWhen`: "field is shown only when TRUE") on every field it draws, the way the edit form does. The synthesized default record page used to draw such a field, label and value, on every record, so the page and the form disagreed about the same record. It applies to every body `record:details` draws: a `{ group }` reference, an enumerated section (the default page's ungrouped bucket, its split for an object with no `fieldGroups`, or an authored page's section) and a flat `fields` list.

The verdict is the form's own: the same evaluator call (`resolveFieldRuleState`), over the record the page shows (bound as `record` and as `previous`) and the host predicate scope (`current_user`). A field predicate that cannot be evaluated still shows the field and warns once in the console, as on the form (ADR-0137 D3). That is the opposite of a field GROUP's `visibleWhen`, which hides the group on a fault. A section whose every field is hidden this way draws no heading. Display only: the record API still returns the field.
