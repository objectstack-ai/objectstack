---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': minor
---

fix(metadata-protocol): deleting an object extension that re-declared a stored computed field fills the object's existing rows with the expression it hands back, as the save door does, and says so per field

Clause-②: yes (widening) — adds an optional `advisories` key to `DeleteMetaItemResponseSchema`
Metadata-protocol: added

`deleteMetaItem` (`DELETE /api/v1/meta/:type/:name`) removed the row and healed the registry, so the object served the definition beneath the removed one, but it ran no stored-expression fill. Deleting an own-package `object_extension` that re-declared a stored computed field (a non-`formula` field declaring `expression`) therefore left every existing row holding the value the removed expression computed, while the object now computed the owner's expression. Totals, filters and reports read those values with no error anywhere.

The delete now captures the object's stored computed fields before its registry heal and runs the same fill the save, publish, rollback and revert doors run: each stored computed field the removal makes compute something new is recomputed over the object's existing rows and reported per field on the answer's new optional `advisories` (`stored-expression-filled`, or `stored-expression-fill-incomplete` with what is left and the `os migrate stored-expressions` command that fills it). A draft discard fills nothing. The key is omitted when there is nothing to report, so a clean delete's answer is byte-identical to before. The delete itself never fails on its fill.
