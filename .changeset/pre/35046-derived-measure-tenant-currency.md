---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a derived dataset measure whose operands are all tenant-currency amounts carries the request's tenant currency

Clause-②: no
Metadata-protocol: none

A dataset `sum` over a `currency` field in `dynamic` mode (the default) already labels its result column with the request's tenant currency (`localization.currency`). A derived `sum` or `difference` over such measures did not: its column carried no `currency`, so it rendered as a bare number beside the plain sums it was built from (a project's actual cost as labor plus expense, for example). Its column now takes the tenant currency too, on `POST /analytics/dataset/query` and on the dataset draft preview alike.

A derived measure counts as an amount in the tenant's currency only when every operand is one: an amount aggregate (`sum`, `avg`, `min`, `max`) over a `dynamic` currency field with no `currency` of its own, or a derived `sum` / `difference` of such measures. Unchanged:

- A `ratio` or `product` of tenant amounts is no amount and stays bare.
- A derived measure that mixes a tenant amount with a `fixed` code, an explicit measure `currency`, a record-mode amount or a `count` stays bare, whichever operand comes first.
- A derived `sum` / `difference` over one `fixed` code still carries that code, and a derived measure's own `currency` still wins.
- With no tenant currency on the request, the column carries none, as the plain sum under it does.

No metadata key, accepted value or default changes; no compile-time guard moves.
