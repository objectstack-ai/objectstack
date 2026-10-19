---
'@objectstack/spec': patch
---

`record:related_list`'s `parentDataSource` is described as rendered

Clause-②: no (describe and TSDoc text only: `RecordRelatedListProps` accepts exactly what it accepted before, and every refusal keeps its issue `code` and `path`)

- The `parentDataSource` describe no longer opens with `[PLANNED — not yet rendered]`. The console renders the key: a related list reads its parent record from the binding, the first row by its `sort`, and draws a notice in its place when no row answers, never an empty list. Without the key, the record page's record is the parent, as before. The rest of the describe is unchanged.
- The key's TSDoc names the console's read points in place of the planned note, and no longer calls the `api` data source unrendered.
