---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a dataset `count` that names an amount field is no amount: the cross-currency guard no longer compares it, and its result column carries no currency

Clause-②: yes (widening)
Metadata-protocol: none

A `count` counts rows, not money, also when it names a field (`{ aggregate: 'count', field: 'amount' }` counts the records with an amount). Two readers still treated such a count as an amount in the field's currency:

- **The compile-time currency guard.** A derived measure over an amount and such a count was refused `DATASET_INVALID` / 400 as "amounts in different currencies": for example `ratio(usd_total, priced_invoices)`, an average amount per priced invoice, when the counted field is a record-currency amount or fixed to another code. It now compiles. Only an amount aggregate (`sum`, `avg`, `min`, `max`) resolves a currency for the guard, so a `count` is never compared, whatever field it names or `currency` it declares. Unchanged: a derived measure over two amounts in different `fixed` codes, or a record-currency amount and another currency, is still refused, and a measure `currency` that contradicts its field's `fixed` code is still refused on a `count` too.
- **The result column.** A `count` over a `fixed`-currency or tenant-currency amount carried that currency on its column (`fields[].currency`), so a dashboard tile counting priced invoices printed `€3` instead of `3`. The column now carries no currency; a `sum` / `avg` / `min` / `max` over the same field keeps it, and a measure that declares its own `currency` keeps it as before.
