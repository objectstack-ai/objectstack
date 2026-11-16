---
'@objectstack/core': minor
'@objectstack/spec': minor
---

fix(core): an unresolved `{ $record }` lookup-filter comparand is refused by name before any driver sees it

Clause-②: no
Metadata-protocol: semantic

A `lookupFilters` entry may read the record being edited as `{ $record: "field" }` or `{ $record: "lookup_field.field" }`; only the record picker of the form editing that record can replace it with a value. When one reaches a server unresolved as a field's comparand (the field's own value, or the value of an operator on that field), the engine's token pass (`resolveFilterTokens`) now refuses it with `INVALID_FILTER` / 400, and the message names the field, the `$record` path and its position, for example:

`A { "$record": "account.cb_market" } comparand on field "cb_market" at filter.cb_market reached the server unresolved, and is refused rather than compared.`

- Before: the eq shorthand `{ cb_market: { $record: "account.cb_market" } }` reached the driver, which refused it in its own words: driver-memory as an unsupported operator `"$record"`, driver-sql with the operator and field withheld. Both were already `INVALID_FILTER` / 400 (driver-mongodb refuses an unknown operator the same way), so on the built-in drivers no filter that answered rows now refuses: the pass judges only a field's comparand, never a value inside one (see Unchanged).
- Now: that shape is refused by name before any driver is asked, on every engine verb and in the analytics service, whether or not the filter also holds a string placeholder. On the engine's object path the other five operators (`{ valid_from: { $lte: { $record: "…" } } }`) and the eq shorthand on a date, datetime or time column are still refused one door earlier, in that door's own words, as before. The engine lowers a `[field, op, value]` array `where` before the pass, so there the array spelling is judged as its object form; the analytics service hands the pass its `where` unlowered, and the pass leaves a tuple to the doors that judged it before.
- Unchanged: a `{ $record }` deeper inside a comparand is a deep-equality literal (or a nested-relation condition) and passes through as before, in either spelling: the object form `{ attachment: { meta: { $record: "x" } } }`, which driver-memory still compares whole, and the tuple `['attachment', '=', { meta: { $record: "x" } }]`, whose third member is a comparand, never a filter node. Both come back from the pass by reference (pinned as CONTROLs on `resolveFilterTokens`).

The `value` and `lookupFilters` describes now say what holds on the server: an unresolved `{ $record }` is refused with `INVALID_FILTER`, never read as null, and, in `lookupFilters`, by name on the eq shorthand of a column other than a date, datetime or time column. Their picker sentences (a record form sends the referenced value; every other picker host leaves the entry out) are not changed by this entry.
