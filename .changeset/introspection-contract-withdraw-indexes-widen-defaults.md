---
"@objectstack/spec": patch
"@objectstack/driver-sql": patch
"@objectstack/objectql": patch
---

Withdraw the never-honored `IntrospectedTable.indexes` promise and widen two
introspection declarations to the measured emitted types (#11122, maintainer
ruling 2026-08-23, option B — 「其他同意你的意见」).

The spec's introspection contract (`schema-diff-service.ts`) declared
`indexes: IntrospectedIndex[]` as REQUIRED, yet no producer has ever emitted
it — a consumer typed against the promise read `undefined` with no compiler
complaint. It also declared `defaultValue?: string` while the in-tree SQL
driver passes `knex.columnInfo().defaultValue` through raw (measured on live
SQLite: `null` for a column with no default, dialect-quoted strings such as
`'abc'` otherwise; other producers report native values such as `true`).

- `IntrospectedTable.indexes` is now **optional**, and absence is meaningful:
  an absent key means the producer did not read indexes; an empty array is a
  positive claim the table HAS none. Producers that did not look must omit
  the key rather than emit `[]`. Wiring the index read into
  `introspectSchema()` is explicitly NOT part of this change.
- `IntrospectedColumn.defaultValue` is now `unknown` — consumers narrow
  before use instead of trusting a string promise no producer kept.
- The SQL layer's extra `maxLength` fact (driver-sql / objectql
  `IntrospectedColumn`, driver-sql `PhysicalColumn`) widens from `number` to
  `number | string` — SQLite reports the string `"255"` where other dialects
  report a number.

With the spec now telling the truth, the deliberate `Omit` workarounds in
`@objectstack/driver-sql` and `@objectstack/objectql` (which carved
`defaultValue` and `indexes` out of the spec types to keep the divergence
visible) are retired: both packages' introspection types now extend the spec
contract directly.

Consumers that read `table.indexes` must guard for absence (none exist
in-tree — the requirement was never honored, so today's readers would have
crashed on `undefined` anyway); consumers of `defaultValue` must narrow from
`unknown` before string operations.
