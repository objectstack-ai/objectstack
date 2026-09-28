---
'@objectstack/service-analytics': minor
---

fix(service-analytics): both analytics filter faces answer `$empty` by the field's declared type (#20445)

Clause-②: yes (widening)

`$empty: true | false` is declared by `@objectstack/spec` (`FieldOperatorsSchema`) with a per-type meaning: a text-like field is empty when it is null or `''`, a multi-value field (multiselect, checkboxes, tags, or a select / radio / lookup / user / file / image with `multiple: true`) when it is null or `[]`, and every other type only when it is null. `$empty: false` is the exact complement. Both of this package's filter faces now answer it by that table, through the spec's one expansion (`expandEmptyOperator`), instead of refusing it:

- **The analytics `where`** (`/analytics/query`, `/analytics/sql`, dataset filters): `NativeSQLStrategy` and the `ObjectQLStrategy` SQL echo compile the field's declared row; the ObjectQL execute path hands `{ $empty }` to the data engine, which answers it once the engine's own arm lands (until then the engine refuses it, `INVALID_FILTER` / 400, as it does today).
- **Row-level read scopes** compiled to SQL (`compileScopedFilterToSql`): same rows, in the read-scope envelope.

A multi-value field's empty list is tested with a JSON function per SQL dialect (`json_array_length` on SQLite, a `jsonb` comparison on Postgres, `JSON_LENGTH` on MySQL).

**Refused, never guessed** — `INVALID_FILTER` / 400 on the `where` face, `READ_SCOPE_COMPILE_FAILED` / 500 on a read scope — when the host cannot name the field's declared type (no `sourceFieldMeta` wired, or no such field), when a multi-value field's datasource dialect is unknown, and when the flag is not a boolean (`$empty: 'true'` is refused like a non-boolean `$null`).

Host API (two new optional members, hence `minor`): `AnalyticsServiceConfig.sourceFieldMeta` may now answer `multiple` beside `type`, and `AnalyticsServicePlugin` relays it from the field definition; `compileScopedFilterToSql` takes an optional `declaredValueShape` option. A host whose `sourceFieldMeta` answers `type` but not `multiple` has every multi-capable field it declared `multiple: true` (select / radio / lookup / user / file / image) read as single-valued, which is the null-only row. On such a field a read scope's `$empty: false` then admits rows holding `[]`, and `$empty: true` misses them. Relay the field's `multiple` from its definition to get the list row.

`$empty` stays staged: it is not in `FILTER_OPERATORS`, and the view operators `is_empty` / `is_not_empty` still lower to `$null`.
