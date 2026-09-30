---
'@objectstack/lint': patch
---

`field-no-consumers` no longer calls a field inert when an inline grid column names it

`os validate`, `os build` and `os lint` warned that a child object's field was inert ("no site of any kind names it") when the only thing naming it was an inline master-detail grid column, such as `{ name: 'quantity' }`. The warning told an author to delete a field the grid draws. A column's `name` is now read as a reference to the child object's field, on both carriers of the column:

- a relationship field's `inlineColumns`. The field sits on the child object and its `reference` names the parent, so the column names a field of the object that declares the relationship field. The grid is drawn only when that field sets `inlineEdit`. Without it, the columns draw nothing, and the field is reported `carrier-only` with the column listed as a site a removal must clean.
- a form view's `subforms[].columns`, on the view's `form` and on every `formViews` entry. The column names a field of the entry's `childObject`, not of the object the view is bound to.

`name` anywhere else is still a literal and never a field reference. The rule id, the `warning` severity and the finding's shape are unchanged. The message now also lists an inline grid column among the consumers, and an `inlineColumns` entry on a field without `inlineEdit` among the carriers.
