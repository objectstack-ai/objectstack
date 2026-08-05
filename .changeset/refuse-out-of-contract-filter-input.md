---
"@objectstack/driver-sql": patch
"@objectstack/driver-memory": patch
"@objectstack/driver-mongodb": patch
---

fix(driver-sql,driver-memory,driver-mongodb): refuse out-of-contract filter input at the door instead of answering it differently per backend (#5347, #5348)

Two shapes the Filter Protocol never declared were reaching the drivers, and
every driver ANSWERED them — with a different answer. Both are now refused with
`INVALID_FILTER` / 400, in the ADR-0112 envelope every sibling filter refusal
already speaks.

## `$null` with a non-boolean comparand — a behaviour change you can observe

`FieldOperatorsSchema` declares `$null: z.boolean()`. A non-boolean was read by
default branches hung on opposite sides, so one filter meant opposite things per
backend. Measured against one row with `stage: 'won'` (id 1) and one with
`stage: null` (id 2), on `{ stage: { $null: 'yes' } }`:

| backend | read as | rows |
|---|---|---|
| driver-sql, driver-sqlite-wasm, Turso local | IS NULL (anything but `false`) | `["2"]` |
| driver-memory query path, driver-mongodb | IS NOT NULL (anything but `true`) | `["1"]` |
| driver-memory reference matcher | no constraint at all | `["1","2"]` |

**What changes for you:** a caller that today gets rows back for
`{ field: { $null: <non-boolean> } }` now gets a `400 INVALID_FILTER` naming the
operator, the field and the position. That includes calls working by truthy /
falsy coincidence — and the sharpest case is the STRING `"false"`, which is
truthy: it compiled to IS NULL on SQL and IS NOT NULL on the JS backends, i.e.
the opposite of what its author wrote it to mean, on at least one of them
whichever they meant. A JSON round-trip or generated metadata produces it
readily.

**The fix:** write the boolean. `{ field: { $null: true } }` for "has no value",
`{ field: { $null: false } }` for "has a value". Both are unchanged, on all four
backends, and so is every other operator. `$exists` is deliberately NOT tightened
here — it diverges on its own axis (what "exists" means for a null-valued key)
and is tracked separately.

## An undeclared `$op` in a document position — silent empty set becomes a 400

`FilterConditionSchema` declares exactly three `$`-keys at a node
(`$and` / `$or` / `$not`); every other key is a field name. `driver-sql`
compiled the rest as COLUMNS, so `{ $where: '…' }`, `{ $nor: […] }`,
`{ $expr: … }` produced a predicate that matched nothing and reported nothing —
a caller could not tell "no rows matched" from "the filter never compiled". The
FIELD position had refused the same class of input since v16, so one driver gave
two answers depending on depth.

**What changes for you:** those filters now raise `400 INVALID_FILTER` instead of
returning `[]`. `driver-memory` already refused them; this brings `driver-sql`
(and `driver-sqlite-wasm`, which inherits it) into line. The three declared
combinators, their boolean identities (`$and: []` is TRUE, `$or: []` is FALSE)
and every legal filter compile byte-identically.

Both refusals are raised on the driver's validating walk rather than in its SQL
emitter, so a malformed node is refused regardless of whether a sibling
disjunct would have short-circuited the compile.
