---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta --stored` lists a stored dashboard whose global filter is keyed `dateRange` beside a declared `dateRange`

Clause-②: no
Metadata-protocol: none

- **Before.** `DashboardSchema` refuses a dashboard that declares the built-in `dateRange` and also keys a `globalFilters` entry `dateRange` (its `name`, or its `field` when it has no `name`), and the dashboard save door answers 422 `INVALID_METADATA`. A dashboard already stored in that shape still loads with `_diagnostics` reading `valid: false`, but the v18 stored-row preview had no detector for it, so `os migrate meta --stored` named no such row before the upgrade.
- **Now.** The preview lists each such stored dashboard under the TODO id `ui-dashboard-global-filter-reserved-date-range-refused` (the refusal's upgrade guide entry), at the entry's `name` (or `field`), the site the parse refuses, with the refusal's own message. The detector calls the refinement's own predicate, so a row is listed exactly when the parse refuses it. Nothing rewrites it: whether the entry was meant to be the date range or a filter of its own, only the author knows. The upgrade guide entries of this refusal and of the duplicate-key refusal now say that `os migrate meta --stored` lists such a row.
- **Not changed.** What any door accepts or refuses. On a dashboard that does not declare `dateRange`, an entry keyed `dateRange` is not listed; nor is a named entry whose `field` is `dateRange`.
