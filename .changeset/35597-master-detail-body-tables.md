---
'@objectstack/spec': minor
'@object-ui/plugin-detail': minor
'@object-ui/app-shell': minor
---

feat(spec, ui): a master_detail child is a table in the record overview by default

Clause-②: yes (widening: a master_detail FK with no `relatedList` now reads as `'primary'`)
Metadata-protocol: semantic

A `master_detail` child used to be a side list unless it also declared `inlineEdit`. Now the relation type decides: a `master_detail` FK that declares no `relatedList` is a body table in the parent's record overview. `inlineEdit` is no longer needed for that; it stays what it was, the write side (whether the edit form inlines the child as line items).

- `relatedList: false` hides the list, `relatedList: true` keeps it a side list (a card in the related column, a tab on the tab row), `relatedList: 'primary'` is unchanged. A `lookup` FK with no `relatedList` stays a side list.
- `isBodyTableRelationship` is still the one judgement. The field-group placement check at `defineStack` and at the publish door follows it, so a field group may now name a plain `master_detail` child to position its table. Studio reads a plain `master_detail` FK as "primary" and writes an explicit `true` when you pick "Show".
- Placement: the body tables of a synthesized page are drawn in the overview's left column above the field sections (under the stage bar and key fields), in the parent's `relatedLists` order. A field group that names one still positions it. They never get a tab or a related-column card. The drawer uses the same page.
- An empty body table draws its column headers and one empty row holding the empty sentence and a New button.
- The table shows 10 rows by default (the page can set its own page size). "Show all N" expands it in place, and ↗ opens the child list filtered to the parent.
- Totals come from the server: the parent's `summary` field over the same child rows when there is one, otherwise a sum aggregate over every child row of this parent (the existing data query, no new endpoint). They are drawn in the table's summary row. The old "this page" sum of the shown rows is gone; a data source with no `aggregate` draws no total.
- A `master_detail` related list placed on an authored record page gets the same body-table treatment (the totals and the empty row).

To keep an existing `master_detail` child as a side list, write `relatedList: true` on its FK.
