---
'@objectstack/spec': minor
'@objectstack/driver-memory': minor
'@objectstack/service-analytics': patch
---

feat(spec)!: `$empty` joins `FILTER_OPERATORS`, and the view operators `is_empty` / `is_not_empty` lower to it (#20446)

A stored 「is empty」 / 「is not empty」 — `['field', 'is_empty', …]`, `isempty`, `is_not_empty`, `isnotempty`, in a view rule, a sharing rule or any filter array — now lowers to `{ field: { $empty: true | false } }` instead of `$null`. `$empty` is answered by the field's DECLARED type: a text-like field is empty when it is null or `''`, a multi-value field (multiselect, checkboxes, tags, or a select / radio / lookup / user / file / image with `multiple: true`) when it is null or `[]`, and every other type only when it is null. So an 「is empty」 rule on a text field now also finds `''`, and on a multi-value field also finds `[]`, which the `$null` lowering missed. `is_not_empty` is its exact complement. `$empty` is in `FILTER_OPERATORS` (and `ALL_OPERATORS`) now, and `canonicalAstOperator` folds the empty pair onto `is_empty` / `is_not_empty` rather than onto `is_null` / `is_not_null`. On `@objectstack/driver-memory`, a QueryAST comparison node (`{ type: 'comparison', operator: 'is_empty' }`) is answered by the same declared-type arm.

**BREAKING**: two things accepted before are refused now, each loudly and with its fix.

- **A `{ $empty: … }` object written as a field value** (a `where` pasted into an insert or update payload) is refused with `VALIDATION_FAILED` (`invalid_type`, "$empty is a filter operator, not a value"). Before, a text-like field stored it as data.
  FROM `update('task', { title: { $empty: true } })` → TO write the value itself (`{ title: '' }`, `{ title: null }`); a filter belongs in `where`.
- **`is_empty` / `is_not_empty` where no face holds the column's declared type** is refused with `INVALID_FILTER` / 400 (`READ_SCOPE_COMPILE_FAILED` / 500 on an analytics read scope). The `$null` lowering answered these. The compositions:
  - the built-in `id`, which no object declares. FROM `['id', 'is_empty', true]` → TO `['id', 'is_null', true]` / `is_not_null`;
  - a federated (external) object on a driver that does not implement `registerExternalObject` (driver-memory, driver-mongodb). The boot already reports such an object as NOT bound to its remote table, naming it, and its reads answered from a table named after the object. FROM `is_empty` on such an object → TO bind it on a driver that implements federation (driver-sql and its heirs, driver-turso);
  - an `AnalyticsService` constructed without `sourceFieldMeta`. FROM such a host → TO pass `sourceFieldMeta` (the package README shows it), or filter with `is_null` / `is_not_null`;
  - a multi-value column on a SQL dialect `driver-sql` does not model (a knex client other than SQLite, PostgreSQL or MySQL). FROM `['tags', 'is_empty', true]` there → TO `['tags', 'is_null', true]` / `is_not_null`.

Stored sharing rules and views that use 「is empty」 are not rewritten; they are re-read under the new meaning. Production rules that use 「is empty」 on a text or multi-value field were not measured; each finds more rows (the `''` / `[]` ones) from this release.

Clause-②: yes (narrowing)

<!-- adr-0087: registered filter-is-empty-lowers-to-empty-operator -->
