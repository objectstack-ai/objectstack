---
'@object-ui/core': patch
---

fix(core)!: a non-boolean `$null` / `$exists` flag is refused in the filter converter and the value data source, and so are the object comparands the value data source cannot compare

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is what convertFiltersToAST lowers and what ValueDataSource.find answers for filters the spec already refuses (a non-boolean $null / $exists flag, a plain object of another realm, a class instance under an equality, membership or text operator) or that this in-memory face cannot evaluate (a { $now, addDays } anchor): no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for `convertFiltersToAST` and `ValueDataSource` (the in-memory `provider: 'value'` data source), for four filter shapes.

1. **A `$null` / `$exists` flag that is not a boolean**, such as `{ owner: { $null: 'no' } }`, `{ owner: { $exists: 1 } }` or `{ owner: { $null: { id: 'u1' } } }`.
   - FROM: the flag was read for its truthiness. `convertFiltersToAST` lowered `{ owner: { $null: 'no' } }` to `['owner', 'is_null', true]` and `{ owner: { $exists: 'no' } }` to `['owner', 'is_not_null', true]`, so a server-backed source answered the null-ness rows and its own door never saw the flag; the value data source answered the same rows (`'no'`, `1` and an object read as `true`; `0` and `null` as `false`).
   - TO: both refuse it, as they already refused a non-boolean `$empty` flag. The converter throws `FilterOperatorError` (`INVALID_FILTER` / 400) with `The '$null' filter operator on field 'owner' takes a boolean flag (true or false); received "no"`, and the value data source excludes every row and logs `filter operator '$null' on field 'owner' takes a boolean flag (true or false); received "no"`. `true` and `false` lower and match exactly as before. The spec's `FilterConditionSchema` and every query face already refused these flags.
   - The AST null-ness operators (`is_null`, `is_not_null` and their spellings) carry no flag and are not moved: direction comes from the operator name and the value slot is not read, as the spec's `parseFilterAST` reads it.
2. **A plain object of another realm** (an iframe, a `vm` context), whose prototype is that realm's `Object.prototype`.
   - FROM: `convertFiltersToAST` read it as an operator map, so `{ age: foreignObject }` with `$gte: 18` lowered to `['age', '>=', 18]` and one with no `$` key lowered to the nested-relation node `['owner', '=', foreignObject]`, which the value data source compared by reference (`=` no row, `!=` every row).
   - TO: it is a comparand, as the spec's filter walk and the engine's `isNoOperatorObject` read it: the converter refuses it as the field's whole condition (`The filter on field 'age' carries a plain object from another realm in comparand position…`), and the value data source refuses it in comparand position under every operator (`filter comparand on field 'owner' is a plain object from another realm, which is neither a comparison value nor filter structure here`). The server refused it already.
3. **A plain object with a `$` key that is not a `{ $field }` reference**, in comparand position on the value data source, the spec's `{ $now, addDays }` date anchor among them, such as `{ due: { $lt: { $now: true, addDays: 7 } } }`.
   - FROM: compared as a value: by reference, or as the text `[object Object]` (so `$lt` answered the rows sorting before that text, and `$ne` / `$nin` every row).
   - TO: refused under every operator that reads a comparand, whole or as a list member, in both dialects. The anchor gets `filter comparand on field 'due' is a { $now, addDays } date anchor, which the in-memory matcher does not resolve…`: the platform resolves it in the compared column's temporal form, and this source has no field types to read a form from, the reason it already refuses a `{ $field, addDays }` offset. Any other one gets `filter comparand on field 'owner' is an object carrying the key '$foo', which is neither a comparison value nor a { $field } reference`, the comparand the spec's door refuses. `convertFiltersToAST` still lowers the anchor verbatim for a server-backed source, which resolves it.
4. **A class instance** (a moment or luxon date, a decimal object, a `RegExp`, a `Map`) as the comparand of an equality, membership or text operator on the value data source: `$eq`, `$ne`, an `$in` / `$nin` member, `$contains`, `$notContains`, `$startsWith`, `$endsWith`, and their AST spellings.
   - FROM: compared by reference or as its text: `$eq` and `$in` answered no row, `$ne`, `$nin` and `$notContains` every row.
   - TO: refused, in both dialects, with `filter comparand on field 'age' is a Amount instance, which the in-memory matcher compares only by order…`. The spec's comparand door refuses it at these operators.
   - Not moved: under `$gt` / `$gte` / `$lt` / `$lte` / `$between` it is still compared through its `valueOf`, and `$icontains` keeps its own text-comparand refusal.

**Not moved.** A scalar, a `Date` and a `{ $field }` reference are compared as before; `$empty` keeps its boolean-flag refusal, with the converter's sentence now built by the same helper as `$null` / `$exists`; a `null`-prototype object of this realm is still an operator map.

The fix for a caller: write the flag as the boolean itself (`{ owner: { $null: true } }`, `{ owner: { $exists: false } }`); compare with a scalar, a `Date` or a `{ $field }` reference; filter a relative date on a server-backed source, or compare a value source with a concrete `Date` or ISO string; and convert a class-instance comparand to its primitive (`moment.toDate()`, `decimal.toNumber()`) before filtering.

**Corrections to earlier notes** (the nested-relation drill note for `@object-ui/core`):

- Its FROM said an ordering operator compared a plain-object comparand with the text `[object Object]`. That holds for an object whose prototype is `Object.prototype`. A `null`-prototype object has no `toString` or `valueOf`, so under `>`, `>=`, `<`, `<=` and `not_contains` the comparison threw `TypeError: Cannot convert object to primitive value` and `find` rejected, before that change.
- Its sentence "`=` matched no row before" leaves out one row: `=` compared by reference, so a row holding the caller's own object, stored through `create` or `update`, which copy shallowly, matched.
