---
'@objectstack/core': patch
---

fix(core): an import lookup cell refused by the row's own scope names the scoping column

Clause-②: no
Metadata-protocol: none

An import lookup cell is resolved within the record the same row names for it: the lookup's `dependsOn` column, or the master a detail target belongs to. When the value matched a record only under another parent, the refusal read `Contract: no record matches "CTR-0006"`, and an importer who searched for CTR-0006 found it.

After a scoped lookup matches nothing, the import now asks the same lookup once more without the scope, as the same importing user. When that finds the value, the refusal names the scoping column and what the row wrote there: `Contract: no record matches "CTR-0006" (Account = "Acme")`. A value that matches no record at all keeps `Contract: no record matches "CTR-0006"`. Single-value and multi-value lookup cells read the same.

The reason stays `reference_not_found` and the code stays `import_reference_not_found`. The added part is built from the column label, the cell and punctuation, so it reads the same in every locale. The second lookup runs as the importing user, so it finds only records that user can already read, and the message says nothing about the record it found.
