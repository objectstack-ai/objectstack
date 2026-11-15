---
'@objectstack/spec': minor
---

feat(spec)!: a `lookupFilters` value may read the record being edited (`{ $record: "path" }`) and an entry may also match an empty column (`orEmpty: true`)

Clause-②: yes (narrowing) — widened: a lookup or master_detail field's `lookupFilters` entry gains the `orEmpty` key and a declared `{ $record: "path" }` value, and `@objectstack/spec/data` gains `LookupFilterRecordReferenceSchema` and `LookupFilterRecordReference`. Narrowed: an entry whose `value` is an object carrying `$record` in any other shape (a path of two or more hops or of names that are not snake_case, another key beside `$record`, or operator `in`, `notIn` or `contains`) parsed before, as any value did, and is now refused.
Metadata-protocol: narrowed
Skills-docs: follow-up owed — content/docs/data-modeling/relationships.mdx, content/docs/data-modeling/fields.mdx, skills/objectstack-data/rules/field-types.md — none of them teaches `{ $record }` or `orEmpty` yet, on purpose: the console picker does not resolve either in this release (both describes carry `[PLANNED — not enforced]`), so teaching them now would advertise a filter the picker does not apply; they move with the picker change.

<!-- adr-0087: registered lookup-filter-record-reference-shape-refused -->

**BREAKING** only for a `lookupFilters` entry whose `value` is an object carrying a `$record` key outside the declared shape. Such an entry never worked: the console picker sent the object to the server as written, and the server refused the query (`INVALID_FILTER` / 400), so the picker showed an error instead of candidates. It is now refused where the object is written, naming `fields.NAME.lookupFilters.N.value` (or `.value.$record`) and the rule. The semantic entry `lookup-filter-record-reference-shape-refused` carries the same notice into the upgrade guide and `os migrate meta`.

**The remedy.** Write `{ $record: "field" }` or `{ $record: "lookup_field.field" }` with no other key, under `eq`, `ne`, `gt`, `lt`, `gte` or `lte`. A value two hops away is not reachable from a picker filter: copy it onto the record being edited, or onto the record one hop away, as a field of its own, and reference that. For a date relative to today, write the `{today}` placeholder or `{ $now: true, addDays: N }` instead of an offset beside `$record`.

**What is declared.** A lookup picker can now be told to offer only the candidates that fit the record being edited, e.g. a quote's Price Book picker that offers only books valid on the quote's date and in the customer's market, or in none:

```ts
lookupFilters: [
  { field: 'is_active',  operator: 'eq',  value: true },
  { field: 'valid_from', operator: 'lte', value: { $record: 'date' }, orEmpty: true },
  { field: 'valid_to',   operator: 'gte', value: { $record: 'date' }, orEmpty: true },
  { field: 'cb_market',  operator: 'eq',  value: { $record: 'account.cb_market' }, orEmpty: true },
]
```

- `{ $record: "path" }` reads a field of the record being edited, or one lookup hop from it (`account.cb_market`). It is not `{ $field }`, which names a column of the candidate row. The picker sends the referenced value in its place, re-queries when a referenced field changes (those fields are implied; list one in `dependsOn` only to gate the picker until it is set), and leaves the entry out while the value is empty. A `{ $record }` that reaches a server unresolved is refused, never read as null. It pairs only with the six scalar comparisons.
- `orEmpty: true` also matches a candidate whose column is null ("valid from the quote date, or with no start date"). It pairs only with the six scalar comparisons.
- Today's date needs nothing new: `'{today}'` and `{ $now: true, addDays: N }` already work as a `lookupFilters` value, and the engine resolves both on every read.

⚠ Declared ahead of its reader: in this release the console picker resolves neither `{ $record }` nor `orEmpty`. An entry that uses `{ $record }` makes the picker's query fail with `INVALID_FILTER` until the picker change ships, and `orEmpty` is ignored. The picker narrows the choice only: a rule the save must enforce still belongs in a server-side hook.
