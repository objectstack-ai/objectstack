---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the highlights strip, the detail view and the record drawer no longer draw a field whose own `visibleWhen` is false for the record

Clause-②: no
Metadata-protocol: none

A field's object-level `visibleWhen` (`Field.visibleWhen`: "field is shown only when TRUE") now hides it on every record surface that draws fields, not only on the `record:details` body: the header highlights strip (`record:highlights`, and the strip a `detail-view` draws from `highlightFields`), the `detail-view` node's body and its header summary chips, and the record drawer that list, kanban, calendar, gantt and the other views open. Before, these surfaces drew such a field, label and value, on every record, so they disagreed with the edit form and the details body about the same record.

Every surface calls the one implementation the details body uses, so the verdict is the form's own (`resolveFieldRuleState`), over the record shown (bound as `record` and as `previous`) and the host predicate scope (`current_user`). A predicate that cannot be evaluated still shows the field and warns once, as on the form (ADR-0137 D3). The verdict is the saved record's: an inline edit reveals a gated field after save. Display only: the record API still returns the field.
