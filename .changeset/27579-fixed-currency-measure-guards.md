---
'@objectstack/service-analytics': minor
---

fix(service-analytics): a dataset refuses a measure `currency` that contradicts its field's `fixed` code, and a derived measure across two different `fixed` codes (ADR-0144 open item 12)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

**BREAKING** (`@objectstack/service-analytics`): two compile-time refusals, `DATASET_INVALID` / 400, for dataset metadata that compiled before and printed a wrong label or a wrong number. Both reach boot registration, `queryDataset` and the Studio draft preview, which compile through the one `compileDataset` call.

- A measure `currency` whose code differs from the aggregated field's `fixed` code. The column printed the field's amounts under the measure's code, such as euros labelled `USD`. The message names the fix: delete the measure's `currency`, and the column takes the field's code. A measure `currency` that restates the `fixed` code is still accepted.
- A derived measure, for every op, whose monetary operands resolve to two different `fixed` codes, directly or through a derived `sum` / `difference` built on them. The value combined bare numbers in two currencies and carried no currency at all. The message names the fix: derive it from measures in one currency, or drop the operand in the other. A `count` operand is not compared, so an amount per invoice still compiles.

Not judged, unchanged: a `fixed` code against the tenant currency, which is not known at compile; a measure `currency` over a `dynamic` field. The record-mode arms of both guards are unchanged.

No in-tree dataset declares either shape. A deployed tenant's stored datasets cannot be surveyed from the repository: a stored dataset with either shape now refuses at registration and at query, and its message names the edit.

<!-- adr-0087: not-required (no-migration-prescription) the two refusals reject a contradiction in a dataset's own measures at compile and name the fix in their message; there is no stored shape to convert and no key is removed -->
