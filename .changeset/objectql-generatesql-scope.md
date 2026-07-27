---
"@objectstack/service-analytics": patch
---

fix(analytics): show the read scope in ObjectQLStrategy's previewed SQL (#3654 residual 2)

`ObjectQLStrategy.generateSql` (the representative statement echoed to
`/analytics/sql` and dataset responses) rendered the query's own filters but NOT
the tenant/RLS read scope that `execute()` injects. The preview therefore
understated the real WHERE — an author debugging a widget saw fewer constraints
than the query actually ran with. It now renders the base object's read scope
too, parameterized, alongside the query filters.

For consistency, `generateSql` also applies the #3654 cross-object guard, so
`/analytics/sql` no longer previews a dotted-column statement for a cross-object
query that `execute()` refuses to run (the engine cannot join in an aggregate) —
it returns the same clear error instead.

Display-only: the previewed string is documentation, never the executed
statement, and carries no data (filter values stay `$n` placeholders). No change
when no read-scope provider is configured.
