---
'@object-ui/components': patch
---

fix(components): a list row's Edit or Delete greyed by `userActions.*.disabledWhen` says why

Clause-②: no
Metadata-protocol: none

When an object's `userActions.edit.disabledWhen` (or `delete.disabledWhen`) held on a row, the data-table's row menu greyed Edit (or Delete) and said nothing about why. The item now gives the generic reason the record page gives for the same verdict ("Not available for this record", in every shipped language) as a visible second line under its label and as its accessible description; its accessible name stays the label. An item that is on, with no predicate or with a predicate that does not hold, gives no reason, as before.
