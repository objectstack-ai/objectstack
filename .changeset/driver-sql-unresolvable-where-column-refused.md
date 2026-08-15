---
"@objectstack/driver-sql": minor
"@objectstack/spec": minor
---

fix(driver-sql): one unresolvable WHERE column, one answer — `find()` and `count()` both refuse with `INVALID_FILTER` / 400 naming the column (#8790)

**BREAKING** accept-set narrowing on a GA public data API, shipped as `minor`
under the lockstep launch-window convention. The migration prescription is
registered under protocol major 18, where `os migrate meta` users will look.

<!-- adr-0087: registered driver-sql-unresolvable-where-column-refused -->

## The defect

One predicate had two answers. `SqlDriver.findRows()` carries the #3821
unknown-column recovery ladder, and every rung of it is built from
`buildBase()`, which **always re-applies `query.where`**. So the ladder can drop
a projection and can drop an ORDER BY, but it can never drop the clause that
actually failed when the unresolvable column is in the WHERE — both rungs raise
the same error and the method fell to `return []`. `SqlDriver.count()` runs a
separate statement and has no ladder at all, so the identical predicate threw.

Measured on a real `SqlDriver` over better-sqlite3, one table, one seeded row:

```
where { 'title.x': 'y' }
  find()   ->  0 rows, NO ERROR
  count()  ->  THREW  code=SQLITE_ERROR  status=undefined
               select count(*) as `count` from `task` where `title`.`x` = 'y'
                 - no such column: title.x

CONTROL  where { title: 'Design' }
  find()   ->  1 row
  count()  ->  1
```

A list view calls both halves, so one query produced an empty page from the rows
half and a 500-shaped failure from the total half. A caller reading only the rows
got a silent empty page that says "no records exist" for what was really "your
predicate never ran" — the single most AI-legible failure to get wrong, since an
agent reads "no matching records" and writes its next query on that belief.

The thrown half was no better: the dialect's own `code`, no `status` (so an
unclassified 5xx at the REST boundary rather than a caller mistake), and the
statement's **bound literals inlined in the message** — the same predicate-text
disclosure shape #7929 redacted elsewhere.

## The fix

Ruled 2026-08-15 on #8790: **refuse both halves** with `INVALID_FILTER` / 400,
naming the column. That envelope is not minted here — it is what every sibling
refusal on this path already answers, required on both SQL drivers by
`cross-field-conformance-cases.ts` and pinned by
`sql-driver-boolean-identity.test.ts` and
`sql-driver-cross-field-conformance.test.ts`. What closes is a
declared-vs-enforced gap, not a new posture.

The caller-visible message names the column and the object and nothing else. The
dialect's own message — the compiled statement, bound literals and all — goes to
the **server log** instead, so the operator keeps the debugging aid that
`count()`'s raw throw used to provide without it reaching the caller.

**The #3821 ladder keeps both of its recoveries.** Only the WHERE-failure
terminal `return []` became a refusal, and the asymmetry is the ruling rather
than an oversight: "rows matter more than their order" is an argument about how
rows are *presented*, and it does not transfer to a predicate. A dropped sort is
a correct answer in an unhelpful order; a dropped WHERE is records the caller
explicitly excluded. Recover-both was rejected for exactly that reason.

## Reach, stated rather than assumed

The refusal fires on the wordings the ladder has always recognised — SQLite
(`no such column: x`) and Postgres (`column "x" does not exist`). MySQL spells
the condition `Unknown column 'x' in 'where clause'`, which neither arm matches,
so on MySQL an unresolvable column still travels out as the raw dialect error.
That gap is pinned as a fact in the new suite and filed separately: widening the
predicate would also hand MySQL the #3821 projection and ORDER-BY recoveries it
has never had, which is an accept-set change in the opposite direction from this
one.

## Who is affected

Callers that reach the driver with a filter key the table has no column for. The
ingress doors already refuse this where they can judge — `assertFilterFieldsExist`
(`@objectstack/metadata-protocol`) answers `INVALID_FIELD` / 400 for everything
reaching `findData`, with the sentence this refusal now echoes verbatim: *a
filter on a field that does not exist can only match zero records, so the query
was refused instead of answered with an empty list*. What changes is the
backstop underneath them: a registry the door could not read, and a dotted key
judged on its head segment only.
