---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the Studio list-view panel configures the selection bar's actions (#30089)

Clause-②: no
Metadata-protocol: none

The list-view panel of an object's grid view gains a "Selection actions" section. It edits two keys the list view already declares, and no other:

- `bulkActions`: pick the object's actions by label, plus the built-in Delete (`delete`). Each runs once per selected record, promoted with the action's own label and params.
- `bulkActionDefs`: add, edit or remove a field update (`operation: 'update'`): a button label, the fields the dialog asks for (one required param per field, carrying a select's options and a lookup's object) and an optional confirmation. A def is written only once it has a label and a field and `BulkActionDefSchema` accepts it.

The section says what happens to the built-in Delete: shown while the view declares neither key, and kept once either is declared only when `bulkActions` names `delete`. A def of another kind (`delete`, an aggregate `custom` dispatch) is listed and can be removed; it is edited in metadata. An emptied key is removed, so a view that declares neither key saves as it was read. On an installed app's read-only view, the first edit goes through the same customization copy as every other setting of the panel. Strings are added in English and Chinese to the `studio` namespace of `@object-ui/i18n`.
