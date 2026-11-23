---
'@objectstack/spec': minor
'@objectstack/cli': patch
'@objectstack/platform-objects': patch
---

feat(spec)!: retire the boolean arm of a relationship field's `inlineEdit` — `true` and `false` both read as the key left out

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-data/rules/relationships.md

<!-- adr-0087: registered field-inline-edit-boolean-removed, field-inline-edit-boolean-retired -->

**BREAKING** accept-set narrowing on `FieldSchema.inlineEdit` (`@objectstack/spec/data`), the inline form factor of a `lookup` or `master_detail` field. Since the field-group placement, a field group of the parent (`fieldGroups[].relatedList`) decides whether the parent's create and edit forms inline a child, and `inlineEdit` only picks the form factor of a placed child. Every reader of the key passes anything but `'grid'` and `'form'` as absent, so `true` (documented as "auto") and `false` both did exactly what leaving the key out does: the form factor is picked from the child's shape.

| FROM | TO |
|:--|:--|
| `inlineEdit: true` on a `lookup` / `master_detail` field | delete the key (the form factor is still picked from the child's shape), or write `'grid'` / `'form'` |
| `inlineEdit: false` on a `lookup` / `master_detail` field | delete the key |
| a child meant to be entered in the parent's form | name it in a field group of the parent: `fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: '<child object>' }]` |

The one-line fix: delete a boolean `inlineEdit` wherever it is written; `os migrate meta --from 17 --write` deletes it from object sources. Writing one after upgrade fails `tsc` (the input type is `'grid' | 'form'`) and fails the parse with that prescription. `'grid'` and `'form'` parse unchanged. The view-level `inlineEdit` (a list view's in-cell editing switch) is a different key and is unchanged.

The retirement kit:

- **`@objectstack/spec`**: `FieldSchema.inlineEdit` is `z.enum(['grid', 'form'])`, and a boolean meets the prescription from the enum's own error map. The D2 conversion `field-inline-edit-boolean-removed` (lossless, retired from the load path) deletes a boolean `inlineEdit` from `objects[]` and `objectExtensions[]` field maps on every data-at-rest seam (stored rows, built artifacts, `os migrate meta`); the D3 entry `field-inline-edit-boolean-retired` names what the upgrade still owes: whether the child should be placed by a field group of the parent. The liveness ledger keeps the key `live` for the two surviving values, with the narrowing recorded.
- **Field form** (`@objectstack/spec` `field.form.ts`, labels in `@objectstack/platform-objects`): with the boolean arm gone a select spells every value, so the field designer now offers `inlineEdit` as a `Grid` / `Form` select on `lookup` and `master_detail` fields; left unset, the form factor is picked from the child's shape. Before, the form left the key out because no widget could spell a boolean-or-string union.
- **`@objectstack/cli`**: the golden metadata-eval corpus places its line items with a field group of the parent instead of `inlineEdit: true`.
