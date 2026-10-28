---
'@objectstack/spec': minor
'@objectstack/service-analytics': minor
---

feat(spec,service-analytics): analytics over a record-currency amount — grouped answers name a per-row currency, an ungrouped amount aggregate is refused, and two compile-time measure-currency guards (ADR-0144 D2, D6)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

A measure column over a `currencyMode: 'record'` amount now carries `fields[].currencyField` on a `queryDataset` answer: the name of the dimension column that groups by the amount's code field. Each row's currency is that row's value of it, and the column carries no `currency`. Before, a breakdown by currency labelled every group with one code.

- `AnalyticsResult.fields[].currencyField` (`@objectstack/spec/contracts`) and the same key on `AnalyticsResultResponseSchema` (`@objectstack/spec/api`).
- The cube door refuses a `sum`, `avg`, `min` or `max` over a record-mode amount whose query does not group by the code field, with `INVALID_FIELD` / 400 naming the measure, the field and its object. A `totals` grouping that drops the code, the grand total included, is refused the same way. `count` reads no amount and is served.

**BREAKING** (`@objectstack/service-analytics`): two compile-time refusals, `DATASET_INVALID` / 400, for dataset metadata that compiled before and printed a wrong label or a wrong number.

- A measure `currency` that contradicts its field: a code other than the `fixed` field's own, or any code over a record-mode amount. The column printed the field's amounts under the measure's code. A code equal to the `fixed` field's is still accepted, and a measure `currency` over a `dynamic` field is not judged.
- A derived measure whose monetary operands are in currencies that provably differ (two different codes, or a record-mode amount against anything but itself), for every op. The derived value combined bare numbers in two currencies and carried no currency at all. A count operand is not compared, so a revenue-per-deal ratio still compiles.

Each refusal names the measure and says what to delete or change. No in-tree dataset declares either shape.

<!-- adr-0087: not-required (no-migration-prescription) the two refusals reject a contradiction in a dataset's own measures at compile and name the fix in their message; there is no stored shape to convert and no key is removed -->

⛔ Not released alone: this ships in the same release as the record currency mode, its write refusals and the per-row display.
