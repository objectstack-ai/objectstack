---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/core': patch
'@objectstack/lint': patch
'@objectstack/service-analytics': patch
'@object-ui/fields': patch
---

docs: stale prose on summary currency, the temporal-comparand door and analytics filters now says what the code does

Clause-②: no
Metadata-protocol: none

No accepted value, key or answer moves. Two refusal messages change their words:

- A `currencyMode: 'dynamic'` summary over a child `currency` field that is neither `dynamic` nor a well-formed `record` / `fixed` (a stored `fixed` field with no `defaultCurrency`, or a `currencyMode` outside the three) is still refused, and the refusal now names what the child lacks: "is a 'currency' field in `fixed` mode with no `defaultCurrency` code (the currency it is fixed to is missing)", or "is a 'currency' field whose `currencyMode` 'X' is none of `dynamic`, `fixed` and `record`". Before, it said only "is a 'currency' field, not a `currency` field in `dynamic` mode".
- The temporal-comparand door's refusal of a comparand no temporal rule reads (`'not-a-date'`, the preset name `'last_30_days'`) now ends "As written it would reach the driver and be compared as text: it may select every row, none or the wrong ones (or raise a database error), an answer indistinguishable from a real one." Before, it said the comparison would "compare false for EVERY row", which was wrong for `$lt` and others that selected every row, for a partial day such as `'2026-06'` that selected a subset, and on PostgreSQL, which raised a database error. Its `having` twin says the same of the groups it would keep, where it said "no group or every group, a 200".

The upgrade-guide entry `summary-dynamic-currency-rollup-home-amount-judged-as-served` now states the admitted set as both doors enforce it: a `dynamic` summary may roll up any child `currency` field in `dynamic` mode, a stored home amount included. Source comments and published docblocks that said every `{placeholder}` is stepped around by the temporal door now state the per-kind rule: a date macro is stepped around and judged by its year once resolved, a period key and a context token are judged as written, and an unknown or record-context token is left to the resolver.
