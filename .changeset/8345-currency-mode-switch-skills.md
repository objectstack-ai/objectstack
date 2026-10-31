---
'@objectstack/skills': patch
---

docs(skills): the field-types guide names the backfill for an amount switched to record mode; the dashboards guide says a record-mode amount aggregate is served only grouped by its code field

Clause-②: no
Metadata-protocol: none

- **`objectstack-data/rules/field-types.md`**: an amount field with stored rows that is switched to `currencyMode: 'record'` is backfilled with `os migrate record-currency-codes`. The derived-measure sentence moves out of this guide; it already sits in the dashboards guide, which the line now points to.
- **`objectstack-ui/rules/dashboards.md`**: a record-mode amount refuses `sum` / `avg` / `min` / `max` unless grouped by its code field. The old "ungrouped" read as if any grouping would do.
