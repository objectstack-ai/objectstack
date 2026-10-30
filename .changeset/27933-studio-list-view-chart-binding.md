---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the list-view panel edits a chart view's dataset binding

Clause-②: no
Metadata-protocol: none

In Studio › Interfaces, the list-view panel of a chart view now has a "Chart data" section. It lists the datasets built on the view's object by label, then the chosen dataset's measures and dimensions by label, and each pick saves to the view's `chart` block (`dataset`, `values`, `dimensions`) as the other settings do. The chart type can be changed there too, among the types the spec lists. Before, a chart view's binding could only be set once, in the Create View dialog.

Picking another dataset keeps only the measures and dimensions that dataset also declares; the others are dropped, since a name the dataset does not declare binds nothing. With no measure left, the edit is held, as an unset required setting is, until one is picked. A stored name the bound dataset does not declare is marked so it can be removed. If the datasets cannot be read, the stored binding is shown as saved with the reason. An object with no dataset says so and offers no picker.

The Create View dialog and the new section read the object's datasets through one shared hook (`useObjectDatasetBinding`); the dialog's behaviour is unchanged.
