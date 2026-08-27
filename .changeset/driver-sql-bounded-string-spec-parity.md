---
'@objectstack/driver-sql': patch
---

chore(driver-sql): pin the varchar-sizing type switch against the spec's `BOUNDED_STRING_FIELD_TYPES`, so the two lists cannot drift apart silently (#12017)

`packages/spec` decides which field types may DECLARE a `maxLength`
(`BOUNDED_STRING_FIELD_TYPES`, which `FieldSchema` and objectql's
record-validator both read since #11989/#11875). `driver-sql`'s
`varcharColumnChars` / `createColumn` switch decides which types get a column
SIZED from that declaration. The two are related by reasoning and nothing
asserted the relationship — so a type admitted into the spec's set without a
matching hand edit to the driver's switch falls to the catch-all
`table.string(name)` at knex's varchar(255): the author declares
`maxLength: 2000`, the platform formally accepts the declaration, and the
column refuses at 255. That is #11431's defect re-entering through a different
door. #12119 is the proof it is reachable — admitting `signature`/`qrcode`
required a hand edit to this switch that nothing would have caught if it had
been forgotten.

⛔ No divergence existed: the lists were measured and agree. This adds the
missing guard, and changes no runtime code.

The pin asserts set EQUALITY over the spec's `FieldType` vocabulary — the types
the switch sizes from a declared `maxLength` are exactly the types the spec
permits to declare one — and identifies each type's branch by probing the
driver's own dispatch, so no copy of either list is added. `'string'` is pinned
separately as the switch's untyped default (`field?.type || 'string'`, knex's
builder name, not a spec `FieldType`), which is why the equality is scoped to
the declared vocabulary.

Grade: `patch`, argued rather than defaulted. Not `minor` — no new public API,
no widened accept-set, no behaviour change of any kind; the emitted DDL is
identical. Not `skip-changeset` either, though this PR ships only a test: the
package's published CONTRACT (a bounded-string field gets a column that honours
its declared bound) becomes a checked invariant here, and the CHANGELOG line is
the record a future reader needs when the guard goes red.
