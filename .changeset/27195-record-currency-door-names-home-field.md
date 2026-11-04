---
'@objectstack/service-analytics': patch
---

fix(service-analytics): the refusal of an ungrouped aggregate over a record-currency amount names the home field as the remedy for a consolidated total (ADR-0144 D6)

Clause-②: yes (widening)
Metadata-protocol: none

- **Now.** A `sum`, `avg`, `min` or `max` over a `currencyMode: 'record'` amount that does not group by its code field is still refused `INVALID_FIELD` / 400 before anything is read, with the same code, status, member, field and object. Its message now names both remedies. For one total in the home currency, point the measure at the amount's home field: by name (`homeAmount.field`) when the amount declares `currencyConfig.homeAmount`, or the declaration to add when it does not. For one row per currency, add the dimension over the code field. Before, the message named only the grouping.
- **Unchanged.** A measure over the home field is no record-mode amount, so it is served unchanged: ungrouped, grouped by the code field, and as a `totals` grand total, labelled with the home currency.
- **The widening.** `AnalyticsServiceConfig.sourceFieldMeta` may answer one more optional key, `homeAmountField`: the amount's `currencyConfig.homeAmount.field`, beside a `currencyField` only. `AnalyticsServicePlugin` relays it. A host that does not answer it gets the message without the field's name.
