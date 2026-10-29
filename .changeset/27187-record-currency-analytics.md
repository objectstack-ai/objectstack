---
'@objectstack/spec': minor
'@objectstack/service-analytics': minor
---

feat(spec,service-analytics): analytics over a record-currency amount — grouped answers name a per-row currency, an ungrouped amount aggregate is refused, and two compile-time guards on record-mode measures (ADR-0144 D2, D6)

Clause-②: yes (widening)
Metadata-protocol: added

A measure column over a `currencyMode: 'record'` amount now carries `fields[].currencyField` on a `queryDataset` answer: the name of the dimension column that groups by the amount's code field. Each row's currency is that row's value of it, and the column carries no `currency`. Before, a breakdown by currency labelled every group with one code.

- `AnalyticsResult.fields[].currencyField` (`@objectstack/spec/contracts`) and the same key on `AnalyticsResultResponseSchema` (`@objectstack/spec/api`).
- The cube door refuses a `sum`, `avg`, `min` or `max` over a record-mode amount whose query does not group by the code field, with `INVALID_FIELD` / 400 naming the measure, the field and its object. It judges every path: a dataset or registered cube, an ad-hoc `query` over the object (`amount_sum`), and a draft preview. A `totals` grouping that drops the code, the grand total included, is refused the same way. `count` reads no amount and is served, and its column carries neither currency key.

Two compile-time refusals, `DATASET_INVALID` / 400, on the record mode alone, so nothing that compiled before is refused:

- a measure `currency` over a record-mode amount, whose currency is per row, including on a derived measure that resolves to one;
- a derived measure that combines a record-mode amount with an operand in another currency (another code field, a `fixed` code, an explicit code or the tenant's), for every op. A count operand is not compared, so an amount-per-invoice ratio still compiles.

The same two shapes over `fixed` fields only are not judged here; ADR-0144 open item 12 refuses them on a card of its own after this release.

⛔ Not released alone: this ships in the same release as the record currency mode, its write refusals and the per-row display.
