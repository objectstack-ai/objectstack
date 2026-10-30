---
'@objectstack/service-analytics': minor
---

fix(service-analytics): a dataset refuses a derived measure `currency` that contradicts the one `fixed` code its operands resolve to

Clause-②: no (narrowing) — not a widening; a dataset that compiled before is refused now
Metadata-protocol: narrowed

**BREAKING** (`@objectstack/service-analytics`): one more compile-time refusal, `DATASET_INVALID` / 400, for dataset metadata that compiled before and printed a wrong label. It reaches boot registration, `queryDataset` and the Studio draft preview, which compile through the one `compileDataset` call.

- A derived `sum` / `difference` whose monetary operands all resolve to one `fixed` code, directly or through a derived measure built on them, and which declares its own `currency` with another code. The column printed the operands' amounts under the declared code, such as `{ derived: { op: 'sum', of: ['eur_a', 'eur_b'] }, currency: 'USD' }` over two EUR-fixed measures printing euros labelled `USD`. The message names the dataset, the measure, its operands and their code, and the fix: delete the measure's `currency` (the column takes the operands' code), or restate that code.
- A derived measure `currency` that restates the operands' `fixed` code is still accepted.

Not judged, unchanged: a derived measure whose operands resolve to no one `fixed` code (a `fixed` amount with a tenant-currency one, a `ratio` or `product`), and the record-mode and mixed-code refusals of both guards.

No in-tree dataset declares this shape. A deployed tenant's stored dataset with it now refuses at registration and at query, and its message names the edit.

<!-- adr-0087: not-required (no-migration-prescription) the refusal rejects a contradiction in a dataset's own measures at compile and names the fix in its message; there is no stored shape to convert and no key is removed -->
