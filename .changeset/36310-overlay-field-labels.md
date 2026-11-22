---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record overlay names a field by its label in save refusals and conflict rows

Clause-②: no
Metadata-protocol: none

In the record overlay (`RecordDetailPanel`, the quick look of kanban, calendar, gantt and tree), a refused save and a conflict dialog's rows named a field by its machine name (`loss_reason`), because the overlay hands `InlineEditSaveBar` no `fieldLabelFor`. The bar now names a field by one rule wherever it names one — the refusal summary, the conflict rows and the fill-in dialog: the host's `fieldLabelFor` when it gives a label, otherwise the field's translated label from the record context's object, then its declared label, and only then its name. A field that declares no label still reads by its name, and the record page, which passes `fieldLabelFor`, reads as before.

A refusal that names a field the object declares with a label is now presented as that field's, labelled, even when the record does not carry the field, as on the record page.
