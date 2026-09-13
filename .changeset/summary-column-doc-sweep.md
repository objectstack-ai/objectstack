---
'@objectstack/metadata-protocol': patch
---

Correct the `summary` column representation stated in the sort-hint TSDoc. Since #16318 an engine-maintained `summary` column is an exact `table.decimal` on tables created after that change and a `table.float` on tables created earlier; the shipped doc comment still said flatly that it is a `table.float`. Comment text only — the sort behaviour it describes is unchanged, and the column type was never what makes a `summary` field sortable (having a provisioned column is).
