---
'@objectstack/service-analytics': patch
---

Refuse a non-binding (vacating) read scope at the two remaining `getReadScope` merge sites: the `/analytics/sql` echo (`ObjectQLStrategy.generateSql`) and `NativeSQLStrategy.applyReadScope`. The `$not`-over-`$in: []` family compiled to a constant-TRUE predicate on those routes, so the echo rendered — and the native strategy actually executed — a whole-table `WHERE` for a scope the ObjectQL execution path already refused (#13640). All three faces now answer one verdict, in the same `READ_SCOPE_COMPILE_FAILED` / 500 envelope; the ruled `$in: []` zero-rows reduction, the live RLS empty-membership composite, and `compileScopedFilterToSql` itself (the ruled #13571 residue included) are unchanged.
