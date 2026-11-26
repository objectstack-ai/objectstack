---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a grid row's Edit or Delete greyed by `userActions.*.disabledWhen` says why

Clause-②: no
Metadata-protocol: none

When an object's `userActions.edit.disabledWhen` (or `delete.disabledWhen`) held on a row, the list grid's row menu greyed Edit (or Delete) and said nothing about why. The item now gives the generic reason the record page and the data-table row give for the same verdict ("Not available for this record", in every shipped language) as a visible second line under its label and as its accessible description; its accessible name stays the label. An item that is on, with no predicate or with a predicate that does not hold, gives no reason, as before; neither does an item greyed only while its record-grained permission verdict is still loading.
