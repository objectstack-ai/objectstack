---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol): refuse a sort naming a `formula` field instead of dropping it silently (#6994)

The list path's SORT gate (`assertSortFieldsExist`) refuses a sort naming a field
the object does not have (#4226) and a dotted path that would have to cross into
a related record (#4256). It did **not** refuse a name that is a real,
non-dotted field of the object whose **type** materialises no column — a
`formula` field is in the object's field map, so it passed the unknown check,
and it carries no dot, so it passed the dotted check.

It then reached a driver that has no column for it. Re-measured on a real
`SqlDriver` (better-sqlite3, on-disk) driving a real `ObjectQL` engine with this
protocol on top, over five rows inserted `C A E B D` and a formula field
`sort_key` whose expression is `record.title`:

```
CONTROL   orderBy title asc     -> ["A","B","C","D","E"]   a real column really sorts
BASELINE  no sort               -> ["C","A","E","B","D"]   insertion order

FORMULA   orderBy sort_key asc  -> ["C","A","E","B","D"]   5 rows, 200
            its sort_key values -> ["C","A","E","B","D"]
FORMULA   orderBy sort_key desc -> ["C","A","E","B","D"]   byte-identical to asc

RAW SQL   order by sort_key     -> sqlite: no such column: sort_key
```

`asc` and `desc` coming back identical is what makes this a dropped sort rather
than a coincidence: `SqlDriver.createColumn` returns early for `formula` (it is
virtual — computed on read, after `driver.find` has already returned), sqlite
answers `no such column`, and the #3821 unknown-column backstop retries the
query **without** the `ORDER BY`. The response even carries the values it was
asked to order by, out of order, under a 200 — so it contradicts the request in
plain view and still reports success. `sort` + `top` is how a caller asks for
"the latest N", which this turned into an arbitrary N.

**Now:** `400 INVALID_SORT`, naming the field and its type, and prescribing the
same remedy in the same words as the dotted refusal (#6924) and the SEARCH axis
(#6673) — denormalise onto a **stored field, written when the source changes**.
Precedence on this axis is `unknown` > `dotted` > unmaterializable, so both
older verdicts answer exactly what they answered before.

**`summary` / `rollup` is not affected** and deliberately not in the refused
set: a summary field gets a real, maintained `float` column and genuinely sorts.
The spec's `COMPUTED_VALUE_TYPES` (`formula`/`summary`/`autonumber`) is the
WRITE contract and is the wrong set to gate a sort with — it would refuse two
types that work.

**Scope.** This is an ingress gate, so it covers what reaches `findData`: the
REST list route, `POST /data/:object/query`, the export route, and the RPC
dispatcher. An internal caller that reaches `engine.find()` directly (hooks,
flows, reports) still gets the silent drop — closing that half means deciding
whether the engine refuses or keeps its documented internal-caller tolerance,
which is a separate contract decision and is tracked separately.

If you were sorting a list by a formula field, that sort was never applied; the
call now fails loudly instead of returning rows in an arbitrary order.
