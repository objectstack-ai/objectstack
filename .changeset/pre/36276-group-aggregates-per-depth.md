---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): with grouping on two or more levels, a sum over a `record`-mode quantity or amount is asked only at the levels grouped by its unit or currency field

Clause-②: no
Metadata-protocol: none

A grid grouped on several levels sends one group-header query per depth, and depth 1 groups by the first level only. Group aggregations were judged against all levels at once. So a list grouped by region, then `unit_code`, kept a `sum` / `avg` / `min` / `max` over a `record`-mode quantity in the depth-1 query, which groups by `region` alone. The engine refuses that query (`INVALID_FIELD`, 400, ADR-0158 U7 R1), and every group header of the view failed with it. A `record`-mode amount grouped by region, then `currency_code`, failed the same way (ADR-0144 D6).

Each depth's query now carries such an aggregate only when that query's own `groupBy` includes the measure's unit or currency field. Otherwise the aggregate is left out, as the whole-set summary leaves it out. In the example, the region bands show their counts and no sum, and the `unit_code` bands under them show their one-unit sums. Rows handed to the grid whole and grouped in the browser follow the same rule, so a region band no longer shows a sum that adds kilograms to pounds. Grids grouped by the unit or currency field at the first level are unchanged.
