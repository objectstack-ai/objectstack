---
'@object-ui/fields': patch
'@object-ui/components': patch
'@object-ui/types': patch
'@object-ui/plugin-form': patch
'@objectstack/spec': patch
---

feat(fields): a lookup pick fills the fields its `lookupAutofill` declares, in the record form and in the line-item grid

Clause-②: yes (widening)
Metadata-protocol: none

`FieldSchema.lookupAutofill` (`[{ target, source, overwrite? }]` on a single-value `lookup` / `master_detail`) now has its reader. Picking a record writes each declared `target` of the record being edited from the picked record's `source` — a quote line's `unit_price` from the picked product's `list_price` — before save, where a server hook used to be the only filler.

- **The overwrite rule is the spec's.** Without `overwrite: true` a pick fills a target only while it is empty or still holds the value an earlier pick in the same form (or grid row) filled in; a value the user typed, or one the record already stored, stays. A pair declaring `overwrite: true` replaces the target on every pick. A `source` the picked record does not carry (a field the reader may not read is not served) writes nothing.
- **Record form.** `LookupField` applies the pairs on every single-value pick path: the dropdown, the keyboard, quick-create and the browse-all dialog. The form renderer hands it a new widget prop, `onAutofill(patch)`, which writes the targets as edits of the form (`setValue`, dirty), so the filled values are saved with the record.
- **Line-item grid.** `GridField` takes the child object's pairs through a new host prop, `lookupAutofill` (lookup field name → pairs, built with the new `lookupAutofillByField`), which `MasterDetailForm` and `LineItemsPanel` pass from the child schema they load. The column key `autofill` is unchanged and still governs only the same-named copy; a declared pair applies whatever it says and takes its target out of that copy, so one target has one writer per pick. A pick from the grid's browse-all dialog now reaches the grid once, with its record, so both copies run on that path too.
- **Types.** `LookupFieldMetadata.lookupAutofill` is declared by reference to the spec. New exports from `@object-ui/fields`: `declaredLookupAutofillPatch`, `lookupAutofillByField`, `LookupAutofillPair`, `LookupAutofillByField`; `lookupAutofillPatch` takes an optional fourth argument carrying the declared pairs.
- **Liveness.** The `lookupAutofill` row of `@objectstack/spec`'s field ledger moves from `planned` to `live`, citing these readers.

A master-detail collection whose relationship and every column are authored loads no child schema, so its grid fills only the same-named copy.
