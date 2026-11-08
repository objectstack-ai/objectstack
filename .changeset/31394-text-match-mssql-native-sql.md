---
'@objectstack/core': patch
'@objectstack/driver-sql': patch
'@objectstack/service-analytics': patch
---

fix(service-analytics): a dashboard's text filter on a SQL Server object matches the rows the list view matches; the text-match construct table moves to `@objectstack/core`

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/service-analytics`:** the native-SQL `where`, the read scope and the ObjectQL echo now compile `$contains` / `$notContains` / `$startsWith` / `$endsWith` / `$icontains` on SQL Server the way `@objectstack/driver-sql` does: the four case-exact operators compare under a binary collation, `$icontains` folds the 26 ASCII letters and nothing else, and a `[` in the comparand is matched literally. Before, a SQL Server object's text filter compiled to a plain `LIKE` under the database's case-insensitive default collation, so `$contains: 'acme'` also matched `ACME Corp`, `$icontains` also folded accented letters, and `$contains: '[1]'` matched any value holding a `1`. `AnalyticsServiceConfig.sqlDialect` now accepts `'mssql'` beside `'sqlite'`, `'postgres'` and `'mysql'`, and the plugin's bridge hands a SQL Server driver's dialect on instead of reading it as "no answer". Every other per-dialect behaviour of the package (duration measures, the multi-value empty test, JSON membership, the window clause, NULL placement, the aggregand policies) treats `'mssql'` exactly as it treated the unknown dialect before. Oracle is unchanged: it already matched the driver's rows.
- **`@objectstack/core`:** exports `dialectTextMatchSql` (with `TextMatchDialect`, `TextMatchShape`, `TextMatchEmitters`, `TextMatchRequest`), the per-dialect text-match constructs `driver-sql` and the analytics compilers now both emit through, plus `textMatchLikePattern`, `TEXT_MATCH_ESCAPE_CHARACTER`, `ASCII_UPPER_LETTERS` / `ASCII_LOWER_LETTERS`, `mssqlCaseExactSql`, `mssqlAsciiLowerSql` and `mysqlAsciiLowerBinarySql`. The column and each value are emitted through caller-supplied emitters, so each face keeps its own placeholders. The unknown dialect answers `null`; each face keeps its own fallback there.
- **`@objectstack/driver-sql`:** no behaviour change. Its `$contains` family and `$icontains` emit through the shared table; the SQL and bindings are identical to before.
