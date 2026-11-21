---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@object-ui/app-shell': minor
'@object-ui/plugin-detail': minor
'@objectstack/platform-objects': minor
---

feat(spec, ui): a master_detail child is a tab by default; a field group puts it in the overview and the form

Clause-②: yes (widening: `@objectstack/spec/data` exports `isGroupPlaceableRelationship`, `fieldGroupsPlaceRelationship` and the `BodyTableContext` type, and `isBodyTableRelationship` takes an optional second argument)
Metadata-protocol: semantic

A `master_detail` FK that declares no `relatedList` used to put its child list into the parent record's overview as a table (since #35597). Now it is a tab of the record page with its count, like any other related list, `inlineEdit` or not. It goes into the overview only where a field group of the PARENT names it (`fieldGroups[].relatedList`).

- Placed by a group, the child's table is drawn at that group's position in the overview, the parent's create and edit forms inline it, and the record page's Edit saves the record fields and the rows in one save. Its tab stays on the tab row too, with its count, while the parent declares no `relatedLists`: a declared `relatedLists` decides the tabs, so there the tab shows only if an entry names the child.
- `relatedList: 'primary'` on the FK is unchanged on the record page: a body table with no group, and no tab of its own whether or not a group positions it. Its forms follow ruling B like every other child: a field group naming it inlines it in the parent's create and edit forms, `inlineEdit` or not, and with no group naming it the forms do not inline it, even with `inlineEdit`. `relatedList: true` keeps a tab that no group may place, and `false` hides the list.
- A field group may name exactly what it could name before: a plain `master_detail` child or a `'primary'` one. `isGroupPlaceableRelationship` is that test; `isBodyTableRelationship(field, { placedByGroup })` is still the one body-table judgement.
- `inlineEdit` on the FK no longer inlines a child in the parent's form by itself (maintainer ruling B: only the field group decides). It now only picks the form factor of a child a group places: `'grid'`, `'form'`, or `true` / absent for the shape-picked default. A child with `inlineEdit` that no group names is a tab and is not in the form.
- `os lint`: `relationship/line-items-inline-edit` now suggests a field group on the parent (with its required `label`) instead of `inlineEdit: true`, and only for a FK a group may place; `relationship/association-inline-edit` and `relationship/inline-edit-needs-bulk` judge the children a parent group places; the field-consumer rule credits a child's inline grid columns only when a parent group places it.
- The showcase invoice and expense report, and the CRM opportunity, gain a field group naming their lines, so their forms and record pages keep the line table.
- In the entry form a placed table sits at its group's place too: between the sections of the groups around it, or in a tab of its own (labelled with the group) in a tabbed form. A form whose sections name no field group keeps it below the record's fields.
- Studio's field-group picker offers the same children as before. The relationship field inspector reads a plain `master_detail` FK as "Show", and "Show" leaves the key absent so a group can still place it.

To keep a master-detail child's table in the overview and its rows in the form (including a child that set `inlineEdit`), add a field group to the parent that names it, in the place the table should sit:

```ts
fieldGroups: [
  { key: 'basic', label: 'Basic information' },
  { key: 'lines', label: 'Lines', relatedList: 'order_line' }, // or 'order_line.order' for one FK
  { key: 'terms', label: 'Terms' },
],
```

Such a group holds no fields. Or write `relatedList: 'primary'` on the child's FK to keep it in the overview with no group. A group may name only a list it can place: for an `inlineEdit` child on a `lookup` FK, or on a FK declaring `relatedList: true`, also write `relatedList: 'primary'` on the FK (a `master_detail` FK may instead drop `relatedList: true`). A form view that declares its own subforms still inlines what it declares.
