---
'@objectstack/core': minor
'@objectstack/spec': minor
---

fix(core): an unresolved `{ $record }` lookup-filter comparand is refused by name before any driver sees it

Clause-②: no
Metadata-protocol: semantic

A `lookupFilters` entry may read the record being edited as `{ $record: "field" }` or `{ $record: "lookup_field.field" }`; only the record picker of the form editing that record can replace it with a value. When one reaches a server unresolved, the engine's token pass (`resolveFilterTokens`) now refuses it with `INVALID_FILTER` / 400, and the message names the field, the `$record` path and its position, for example:

`A { "$record": "account.cb_market" } comparand on field "cb_market" at filter.cb_market reached the server unresolved, and is refused rather than compared.`

- Before: the eq shorthand `{ cb_market: { $record: "account.cb_market" } }` reached the driver, which refused it in its own words: driver-memory as an unsupported operator `"$record"`, driver-sql with the operator and field withheld. Both were already `INVALID_FILTER` / 400 (driver-mongodb refuses an unknown operator the same way), so on the built-in drivers no filter that answered rows now refuses.
- Now: every read and write filter the engine resolves, and every analytics filter, is refused in the one sentence above, whether or not it also holds a string placeholder. The operator form `{ cb_market: { $eq: { $record: "…" } } }` is still refused one door earlier on the engine's object path, by the comparand-type door, as before.

The `lookupFilters` describes now state the server half as enforced; the `[PLANNED — not enforced]` marker stays on the picker half, which does not resolve `{ $record }` or read `orEmpty` yet.
