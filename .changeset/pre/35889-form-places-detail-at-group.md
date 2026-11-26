---
'@object-ui/plugin-form': patch
'@object-ui/components': patch
'@objectstack/spec': patch
---

fix(ui): the entry form draws a group-placed master-detail table at its field group

Clause-②: no
Metadata-protocol: none

A master-detail child that a field group of the parent places (`fieldGroups[].relatedList`) is now drawn at that group in the parent's create and edit forms, where the record page draws it, instead of below all of the record's fields:

- A form laid out from the parent's field groups draws the table after the sections of the groups declared before the placing group and before the ones declared after it.
- The form's section bar stops at the table too, between the sections around it.
- A tabbed form gives it a tab of its own at that position, labelled with the group's label. A wizard master-detail form is drawn as the simple form, as before, and places it the same way.
- A form whose sections name no field group, and a child no group places (a form view's own `subforms`), keep the table below the record's fields, as before.

The table is the same one: its rows still save with the record in one batch, an expanded row's editor opens beside it, and the document totals stay at the foot of the form. No metadata changes.
