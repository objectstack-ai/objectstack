---
'@objectstack/core': minor
'@objectstack/spec': minor
---

fix(core): an unresolved `{ $record }` lookup-filter comparand is refused by name before any driver sees it

Clause-②: no
Metadata-protocol: semantic

A `lookupFilters` entry may read the record being edited as `{ $record: "field" }` or `{ $record: "lookup_field.field" }`; only the record picker of the form editing that record can replace it with a value. When one reaches a server unresolved as a field's comparand (the field's own value, or the value of an operator on that field), the engine's token pass (`resolveFilterTokens`) now refuses it with `INVALID_FILTER` / 400, and the message names the field, the `$record` path and its position, for example:

`A { "$record": "account.cb_market" } comparand on field "cb_market" at filter.cb_market reached the server unresolved, and is refused rather than compared.`

- Before: the eq shorthand `{ cb_market: { $record: "account.cb_market" } }` reached the driver, which refused it in its own words: driver-memory as an unsupported operator `"$record"`, driver-sql with the operator and field withheld. Both were already `INVALID_FILTER` / 400 (driver-mongodb refuses an unknown operator the same way), so on the built-in drivers no filter that answered rows now refuses.
- Now: that shape is refused by name before any driver is asked, on every engine verb and in the analytics service, whether or not the filter also holds a string placeholder. On the engine's object path the other five operators (`{ valid_from: { $lte: { $record: "…" } } }`) and the eq shorthand on a date or datetime column are still refused one door earlier, in that door's own words, as before.
- Unchanged: a `{ $record }` deeper inside a comparand, such as `{ attachment: { meta: { $record: "x" } } }`, is a deep-equality literal (or a nested-relation condition) and passes through as before; driver-memory still compares it whole.

The `lookupFilters` describes now say what holds on every path: an unresolved `{ $record }` is refused with `INVALID_FILTER`, never read as null, and by name on the eq shorthand of a column that is not a date or datetime. The `[PLANNED — not enforced]` marker stays on the picker half, which does not resolve `{ $record }` or read `orEmpty` yet.
