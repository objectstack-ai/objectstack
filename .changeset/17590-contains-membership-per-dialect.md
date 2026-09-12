---
'@objectstack/driver-sql': minor
'@objectstack/spec': minor
---

`$contains` on a multi-valued / JSON column is a MEMBERSHIP test, compiled per dialect so SQLite, MySQL and PostgreSQL answer the same rows.

`$contains` is the membership spelling on a `multiple: true` field or a `JSON_COLUMN_TYPES` member — the one operator that kept working on a JSON column after the scalar-comparison family was refused there, and the spelling that refusal's own message prescribes. It was lowered like any other text operator, so each backend was asked about the SERIALIZATION rather than about the members, and the three answered three different things: SQLite matched a substring of the stored array text, MySQL coerced its `json` column for `LIKE` and matched the same substring, and PostgreSQL raised SQLSTATE 42883 (`operator does not exist: json ~~ text`) — a `DATABASE_ERROR` 500 for a filter the spec accepts.

`driver-sql` now compiles a real membership construct per dialect: `jsonb` containment on PostgreSQL, `JSON_CONTAINS` on MySQL, a `json_each` scan on SQLite. `$notContains` moves with it as its exact complement.

**Behaviour change on SQLite and MySQL, in the narrowing direction.** Where the substring reading matched ACROSS element boundaries it no longer does: `{ tags: { $contains: 'red' } }` stops answering a row whose only tag is `redwood`, and `{ nums: { $contains: '1' } }` stops answering a row holding `[10, 21]`. Those rows were wrong answers, not a contract — a filter that needs the old reading is asking for a substring search over a serialization and should be written against a scalar column. On PostgreSQL the same filters change from a 500 to the member rows.

Unchanged: `$contains` on a scalar string column is still the case-sensitive substring test, and the rest of the text family (`$startsWith`, `$endsWith`, `$icontains`, `$like`, `$ilike`) keeps the lowering it had on every column.

`packages/spec`'s `StringOperatorSchema` docblock — published source — now states the membership reading and records, per face, which runtimes answer it.
