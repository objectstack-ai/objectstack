---
'@objectstack/objectql': patch
'@objectstack/formula': patch
'@objectstack/spec': patch
---

feat(objectql): a record-currency amount is refused without its code, refused in an ungrouped raw aggregate, and refused under a summary roll-up

Clause-②: no
Metadata-protocol: none

- **A `record`-mode amount is stored with its currency code (ADR-0144 D8 rule 4).** An insert or update that would store a value in a `currency` field declaring `currencyConfig: { currencyMode: 'record', currencyField }` while that code field is blank (absent, `null` or white space) is refused `ERR_CURRENCY_CODE_REQUIRED` / 400, with `field` naming the code field and `amountField` the amount. The server never fills a currency in. On an update, only a write that carries the amount or its code is judged, against the stored row with the payload laid over it, so an edit of another field never meets it. The code is registered under `@objectstack/objectql` in the ADR-0112 error-code ledger.
- **A raw aggregate over a `record`-mode amount groups by its code field (ADR-0144 D6).** `sum`, `avg`, `min` and `max` over such a field through `engine.aggregate` are refused `INVALID_FIELD` / 400 unless `groupBy` names the code field; grouped, each currency totals on its own. `count` and `count_distinct` are not judged. Before, USD 100 and EUR 100 summed to 200 under one label.
- **A `summary` roll-up over a `record`-mode amount is refused at registration (ADR-0144 D6).** `sum` / `avg` / `min` / `max` of such a child field is refused `INVALID_METADATA` / 422 (`RecordCurrencySummaryRefusedError`) at whichever object's registration completes the pair. Before, child rows of USD 100 and JPY 15000 rolled up to 15100. Use `count`, or roll up a stored home-currency amount.
- **`inferFormulaReturn` carries a record currency (`@objectstack/formula`).** A formula over a `record`-mode amount now declares `returnType: 'currency'` with `currencyConfig: { currencyMode: 'record', currencyField }`, the code field its sources name, instead of a tenant-default (`dynamic`) amount. Two record-mode amounts naming different code fields, or a record-mode amount meeting a `fixed` or `dynamic` one, are not one currency and are not stamped as money.
- **Nothing to migrate.** `currencyMode: 'record'` is new; no field declared before it meets any of these refusals.
