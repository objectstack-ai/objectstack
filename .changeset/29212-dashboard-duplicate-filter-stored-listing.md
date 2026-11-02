---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta --stored` lists a stored dashboard that declares one global filter key twice

Clause-②: no
Metadata-protocol: none

- **Before.** `DashboardSchema` refuses a dashboard whose `globalFilters` repeats a filter key (its `name`, or its `field` when it has no `name`), and the dashboard save door answers 422 `INVALID_METADATA`. A dashboard already stored in that shape still loads with `_diagnostics` reading `valid: false`, but the v18 stored-row preview had no detector for it, so `os migrate meta --stored` named no such row before the upgrade.
- **Now.** The preview lists each stored dashboard that repeats a key, under the TODO id `ui-dashboard-global-filter-duplicate-name-refused` (the refusal's upgrade guide entry), at the second declaration's `name` (or `field`) — the site the parse refuses — naming the key and every index. The detector calls the refinement's own predicate, so a row is listed exactly when the parse refuses it. Nothing rewrites it: which definition keeps the key only the author knows.
- **Not changed.** What any door accepts or refuses. Distinct keys, and distinct names over one `field`, are not listed.
