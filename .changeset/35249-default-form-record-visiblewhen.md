---
'@object-ui/app-shell': patch
---

fix(console): the record form draws a field whose `visibleWhen` holds for the record, on the default (fieldGroups) form too

Clause-②: no
Metadata-protocol: none

The console's record-form dialog and the full-page record form built their field list by evaluating each object field's `visibleWhen` once, with no record bound. A total predicate such as `has(record.stage) && record.stage == "closed_lost"` answers a clean false without a record, so the field was left out of the list before the form saw the record. A form laid out from the object's `fieldGroups` draws only listed fields, so a deal's Loss Reason never appeared on a lost deal, while an authored form view section with the same predicate drew it.

The field list now reads the static `hidden` alone. A field's `visibleWhen` is evaluated by the form, against the record (the stored row under the values being edited) and the signed-in user, and again as the user edits, so a field whose predicate turns true mid-edit now appears. `hidden: true` still keeps a field off the form whatever its predicate says, a predicate that cannot be evaluated still fails open, and the refused field-level `visible` is still not read.

Visible change: a field whose `visibleWhen` reads the record (or the user) is now drawn whenever its predicate holds for that record. On the full-page form this includes an authored section that names such a field, which the list used to drop. No props, exports, metadata keys or locale keys change.
