---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the view-definition conflict report's remedy query now runs on PostgreSQL, not only SQLite (#6772)

`buildDuplicateProbeSql()` — the query `ensureViewDefinitionActiveIndex` ships
**inside** its `error`-level degradation report, as ADR-0120 D4's "name the
offending rows" — projected two bare columns while grouping by only their
`COALESCE` forms:

```sql
SELECT name, organization_id, owner, COUNT(*) AS duplicate_rows
FROM sys_view_definition WHERE state = 'active'
GROUP BY name, COALESCE(organization_id, '__global__'), COALESCE(owner, '')
HAVING COUNT(*) > 1
```

PostgreSQL requires every non-aggregated projection to appear **verbatim** in
`GROUP BY`; wrapped in an expression does not count. So the query an operator is
handed fails with

```text
ERROR:  column "sys_view_definition.organization_id" must appear in the GROUP BY
        clause or be used in an aggregate function
```

on one of exactly **two** dialects that can build the partial index the report is
explaining. The operator copy-pastes the remedy out of an error message and gets
a second error instead of the conflicting rows. SQLite accepts the bare form,
which is why the existing real-SQLite test stayed green and the defect shipped;
MySQL/MariaDB reaches the same string through the `unsupported` arm.

Each folded column is now projected through its own `COALESCE` under a bucket-key
alias — the shape `overlay-index.ts`'s `buildOverlayDuplicateProbeSql()` already
uses for the sibling migration (#6770):

```sql
SELECT name, COALESCE(organization_id, '__global__') AS organization_id_key,
       COALESCE(owner, '') AS owner_key, COUNT(*) AS duplicate_rows
FROM sys_view_definition WHERE state = 'active'
GROUP BY name, COALESCE(organization_id, '__global__'), COALESCE(owner, '')
HAVING COUNT(*) > 1
```

Every bare projection is now a bare `GROUP BY` term, so the query is legal on
both dialects. The projection and the `GROUP BY` are built from the same array,
so they cannot drift apart again. Nothing is lost by reading bucket keys instead
of stored values: neither sentinel can occur in real data, so
`organization_id_key = '__global__'` means `organization_id IS NULL` and
`owner_key = ''` means `owner IS NULL`.

The function's "Dialect-neutral: `COALESCE`, `GROUP BY` and `HAVING` are ANSI on
every engine this platform runs on" comment was true about the three constructs
and false about the query built from them; it now states the projection rule the
query has to satisfy, and why the real-SQLite test cannot see it.

No behaviour change to any index, write path or status: only the text of the
remedy query inside the two degradation reports.
