---
'@objectstack/skills': patch
---

docs(skills): the dashboards guide says how a record-currency amount behaves in a dataset measure

Clause-②: no
Metadata-protocol: none

⛔ Not released alone: this ships in the same release as the `currencyMode: 'record'` mode, its refusals and its per-row display (ADR-0144 D9, release R1).

- **`objectstack-ui/rules/dashboards.md`**: a measure over a `currencyMode: 'record'` amount refuses a measure `currency` and an ungrouped `sum` / `avg` / `min` / `max`. Grouped by the amount's code field, its result column carries `currencyField`, which names the per-row code column, and a `count` column never does.
