---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): leave a raw aggregate over a record-mode quantity out of the whole-set footer and the group headers

Clause-②: no
Metadata-protocol: none

The engine refuses a `sum` / `avg` / `min` / `max` over a `number` field declaring `unitConfig: { unitMode: 'record', unitField }` unless the query groups by `unitField` (ADR-0158 U7 R1): quantities in different units do not add. The grid now treats such a quantity the way it treats a `record`-mode currency amount (ADR-0144 D6), through one rule:

- The whole-set footer query of a paged list or grid leaves that column's aggregate out, so the other summarised columns keep their whole-set figures instead of all falling back to the current page's.
- The footer draws no `sum` / `avg` / `min` / `max` for that column, and its menu offers the count family only; the counts stand.
- A group-header aggregate over it stands only when the grid is grouped by its `unitField`.

A `fixed`-mode quantity and a `number` with no `unitConfig` total as before.
