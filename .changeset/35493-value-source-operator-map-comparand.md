---
'@object-ui/core': patch
---

fix(core)!: the value data source refuses a plain-object comparand under a `$` operator, as it already does under the AST operators

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the row set `ValueDataSource.find` answers for an object `$filter` whose comparand the spec's comparand door already refuses: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for `ValueDataSource` (the in-memory `provider: 'value'` data source) given an object `$filter` whose comparand is a plain object with no `$` key, such as `{ owner: { $ne: { id: 'u1' } } }`.

- FROM: under a `$` operator such an object was compared as a value, by reference or as the text `[object Object]`. `$ne`, `$notContains` and `$nin` with the object as a list member answered every row; `$gt` / `$gte` / `$lt` / `$lte` answered the rows whose value sorts past `[object Object]`; `$eq`, `$in`, `$between`, `$contains`, `$startsWith` and `$endsWith` answered no row, with nothing logged. The AST dialect (`['owner', 'nin', [{ id: 'u1' }]]`) also answered every row for a plain-object list member.
- TO: both dialects refuse it with one sentence, for every operator of the spec's `FILTER_OPERATORS` except the three flag operators (`$null`, `$exists`, `$empty`), and for each member of an `$in` / `$nin` / `$between` list. The rows are excluded and the reason is logged once: `filter condition on field 'owner' carries the non-operator key 'id'; the in-memory matcher does not descend into a nested relation constraint`. The spec's comparand door (`normalizeFilterComparandTypes`) refuses the same comparand with `INVALID_FILTER`, so a server-backed source already refused this filter.
- A class instance given as a field's whole condition, such as `{ created: someMomentDate }`, is now read as a value, not as an operator map. It is refused in the filter converter's words (`The filter on field 'created' carries a Moment instance (…) in comparand position`, the class name and the value's text), where before each of its own keys was refused as a nested relation. The row set is the same: no row.

**Not moved.** A scalar, a `Date`, a `{ $field }` reference and a class instance under an operator (a moment or luxon date, a decimal object under `$gt`, compared through its `valueOf`) are still compared. `$empty` keeps its own boolean-flag refusal, and a key outside `FILTER_OPERATORS` keeps the refusal it had.

The fix for a caller: a filter on a related record's field is not executed by the in-memory source. Filter on a scalar column of the row itself, or compare with a scalar, a `Date` or a `{ $field }` reference.
