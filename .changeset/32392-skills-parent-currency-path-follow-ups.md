---
'@objectstack/skills': patch
---

docs(skills): the dashboards rule says a parent-path record-currency amount admits no grouping, and the data evals measure the parent-path `currencyField`

Clause-②: no
Metadata-protocol: none

`objectstack-ui`'s dashboards rule said a `currencyMode: 'record'` amount refuses `sum` / `avg` / `min` / `max` "unless grouped by its code field". For a `master_detail` child amount whose `currencyField` is the parent path (`'invoice.currency_code'`), no grouping is admitted: the engine's aggregate door refuses it whatever it groups by, and the analytics cube door never matches a dimension to a dotted code field. A dashboard author who grouped by the path was refused. The rule now says so in one parenthesis, points to `objectstack-data` → Field Types → Currency for the declaration, and names the two single-currency shapes to measure instead: the amount's `homeAmount` field or the parent's `summary`. To pay for it, two clauses whose home is the package source are deleted from the same comment: what a result column carries (`AnalyticsResult.fields` in `@objectstack/spec/contracts`) and the "not judged" list of the measure-currency check. `objectstack-data`'s `objects-fields-relationships` evals gain a case for an invoice whose line amounts follow the invoice's currency, with the `lookup` path refused. No schema or runtime change.
