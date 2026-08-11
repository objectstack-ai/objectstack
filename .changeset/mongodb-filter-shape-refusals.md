---
"@objectstack/driver-mongodb": patch
---

fix(driver-mongodb): refuse malformed `$between`, undeclared node-level `$`-keys and `{ field: {} }` (#5346, #5376)

`driver-mongodb` was the last backend still ANSWERING three filter shapes every
other backend refuses. All three failed the same way — the query ran, reported
nothing, and returned a row set nobody asked for. Measured through
`translateFilter` (a pure function whose output *is* the document MongoDB
receives):

```
{ score: { $between: 5 } }       =>  {"score":{}}
{ $where: 'return true' }        =>  {"$where":"return true"}
{ stage: {} }                    =>  {"stage":{}}
```

All three now refuse with `INVALID_FILTER` / 400 (ADR-0112), naming the position
(`filter.$or[1].score.$between`), through the same `unsupportedFilterError`
constructor this package's other filter refusals already used — no new envelope.

- **Malformed `$between`** — the emitter arm wrote both bounds inside
  `if (Array.isArray(value) && value.length === 2)` and had no `else`, so a
  malformed comparand dropped the whole range and normalised the field to `{}`.
  The twin, down to the missing `else`, of the arm #5328 fixed on
  `driver-memory`. The leading sentence is `driver-sql`'s verbatim — one
  condition, one wording (#5240).

- **An undeclared `$`-key in a NODE position** — the severe one. The translator's
  switch knows three combinators (`$and` / `$or` / `$not`); every other key took
  the FIELD path, and a key carrying no `$`-prefixed sub-keys fell to implicit
  equality and was written into the outgoing document verbatim, where **MongoDB
  executed it**. `$where` is server-side JavaScript; `$nor` is a real combinator
  the Filter Protocol never declared. The emitter's field-level `default:` arm
  has named exactly these spellings as its P0 reason for refusing them one level
  down for two releases — that gate was only ever installed at the field
  position. On the other backends the same input compiled to a column name and
  returned zero rows (#5348 / cloud#1077, since refused) or was already refused
  (#5324); only here was it evaluated.

- **`{ field: {} }`** — a field constrained by zero operators, ruled REFUSE on
  #5240 and gated on `driver-sql` / `driver-sqlite-wasm` / `driver-memory` /
  `formula` by #5327. This driver translated it to `{ field: {} }`, which MongoDB
  reads as "the field is deep-equal to the empty document" — not the FALSE the
  ruling declined to take, but a DIFFERENT filter that merely looks like FALSE
  until a document actually stores `{}` there.

Each gate sits on the validating walk (`classifyFilterKey`), beside the existing
`$null` (#5347) and `$icontains` (#6520) gates, rather than in the emitter — the
emitter is skipped wholesale when a boolean identity settles the enclosing node,
so a gate there would fire or not depending on a shape's SIBLINGS. Measured
before the fix: `{ $or: [ {}, { $where: 'x' } ] }`,
`{ $or: [ {}, { score: { $between: 5 } } ] }` and `{ $or: [ { a: {} }, {} ] }`
all translated to `{}` — match-all. The `$between` emitter arm additionally
keeps a local check as defense for its own invariant, the dual-gate pattern the
`$null` arm documents; both sites call one constructor with one path spelling.

Every filter that translated before still translates byte-identically: this adds
refusals in front of the verdict, it does not reclassify any surviving shape.
Authored filters using these shapes were already not doing what they appeared to
do, and now say so instead of answering silently.
