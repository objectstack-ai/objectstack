---
'@object-ui/core': patch
---

fix(core)!: the value data source refuses a plain-object comparand with no `$` key, empty or not, in both filter dialects

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the row set `ValueDataSource.find` answers, in its object and its AST dialect, for a filter whose comparand the spec's doors already refuse: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for `ValueDataSource` (the in-memory `provider: 'value'` data source) given a filter whose comparand is a plain object (prototype `Object.prototype` or `null`) with no `$` key, NON-EMPTY such as `{ owner: { $ne: { id: 'u1' } } }` or EMPTY such as `{ owner: { $ne: {} } }`, as the whole comparand or as a member of an `$in` / `$nin` / `$between` list, in either dialect.

- FROM: such an object was compared as a value, by reference or as the text `[object Object]`.
  - Whole comparand: `$ne` and `$notContains` answered every row; `$gt` / `$gte` answered the rows whose value sorts after `[object Object]` and `$lt` / `$lte` the rows sorting before it; `$eq`, `$in`, `$nin`, `$between`, `$contains`, `$startsWith` and `$endsWith` answered no row, with nothing logged.
  - List member: `$nin` answered every row; `$in` answered the rows its other members matched; `$between` read the object as the text `[object Object]` and answered the rows in the text range up to its other endpoint (`[{ id: 'u1' }, 'zzz']` answers a `'zeta'` row).
  - The AST dialect answered the same for a list member (`['owner', 'nin', [{ id: 'u1' }]]` every row, `in` and `between` likewise), and for an empty object as the whole comparand (`['owner', '!=', {}]` every row).
- TO: both dialects refuse it, for every operator of the spec's `FILTER_OPERATORS` except the three flag operators (`$null`, `$exists`, `$empty`). The rows are excluded and the reason is logged once. A non-empty object gets `filter condition on field 'owner' carries the non-operator key 'id'; the in-memory matcher does not descend into a nested relation constraint`; an empty one, which has no key to name, gets `filter comparand on field 'owner' is an empty object ({}), which is neither a comparison value nor a nested relation constraint`. A server-backed source already refused these filters with `INVALID_FILTER`: the spec's comparand door (`normalizeFilterComparandTypes`) refuses the object as a scalar operator's comparand and as a list member, and `assertListComparandShapes` refuses a whole object under a list operator.
- A class instance given as a field's whole condition, such as `{ created: someMomentDate }`, is now read as a value, not as an operator map. The whole filter is refused up front in the filter converter's words (`The filter on field 'created' carries a Moment instance (…) in comparand position`, the class name and the value's text), as the zero-key condition `{ created: {} }` is and as the server refuses it. Before, each of its own keys was refused as a nested relation per row, so on its own it answered no row, but inside `$or` the other branches still answered: `{ $or: [{ owner: 'Alpha' }, { created: someMomentDate }] }` answered the `'Alpha'` rows, and now answers none.

**Not moved.** A scalar, a `Date`, a `{ $field }` reference and a class instance under an operator (a moment or luxon date, a decimal object under `$gt`, compared through its `valueOf`) are still compared. `{ owner: {} }` as a field's WHOLE condition keeps the converter's empty-operator-map refusal. `$empty` keeps its own boolean-flag refusal, `$null` / `$exists` still read their flag's truthiness, and a key outside `FILTER_OPERATORS` keeps the refusal it had.

The fix for a caller: a filter on a related record's field is not executed by the in-memory source. Filter on a scalar column of the row itself, or compare with a scalar, a `Date` or a `{ $field }` reference.
