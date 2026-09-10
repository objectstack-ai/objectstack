---
"@objectstack/spec": minor
"@objectstack/driver-sql": minor
"@objectstack/driver-turso": minor
"@objectstack/driver-sqlite-wasm": minor
"@objectstack/service-analytics": minor
---

feat(driver-sql)!: a text operator over a column whose DECLARED type is temporal answers the type-gated no-match on every SQL face (#15683)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed. No `packages/spec` key changes its name, its type or its optionality, no stored shape moves, and every object definition and filter body parses byte-identically to before — so `objectstack migrate meta` has nothing to rewrite and this changeset carries no rewrite instructions. What changes is the ANSWER a published filter surface gives at request time: a text operator aimed at a `date` / `datetime` / `time` column returns the declared no-match instead of the ISO-substring match SQLite happened to give it. The remedy for a caller who was leaning on that match is a different FILTER — the range operators, which are data the caller holds rather than an authored artifact with a stored representation — and it is spelled in the banner below. The one spec change is the membership of an existing exported set (`NON_TEXT_STORED_VALUE_TYPES`), which adds no export and removes none. -->

**BREAKING** in the answer sense, on every SQL face, landing in the launch
window as `minor` under the lockstep convention this cluster's siblings use.

**The behaviour that GOES AWAY, by name: searching a date as a string.** On the
SQLite family — `driver-sql` on any SQLite connection, `driver-sqlite-wasm`, and
`driver-turso`'s local transport — a `Field.date` / `Field.datetime` /
`Field.time` column stores canonical ISO TEXT (ADR-0053), and a text operator
matched that text. `{ signed_on: { $contains: '2026' } }` returned every 2026
row; `{ made_at: { $startsWith: '2026-01' } }` returned that January's rows;
`{ shift_at: { $contains: ':30' } }` returned every half-past shift. **All three
now return nothing**, and their `$notContains` mirrors now return every valued
row. If you are relying on any of them, this is a row-set change and the
replacement is a range filter — spelled out below. The behaviour was never
declared by any contract row and it never worked outside SQLite: the same three
filters were a `DATABASE_ERROR` 500 on live Postgres.

Nothing that was refused becomes admitted, and no new error code is minted — the
refusal reused is the one `NON_TEXT_STORED_VALUE_TYPES` already carried for the
numeric and boolean classes.

Maintainer ruling, 2026-09-05 on #15683, quoted rather than paraphrased:
「a text operator over a column whose DECLARED type is temporal is type-gated
exactly like the numeric and boolean classes; the SQLite ISO-text match is not
a contract」.

## What was wrong — one filter, three answers across one driver family

`{ on_day: { $contains: '2026' } }` over a column declared `Field.date` holding
`2026-01-05`:

| face | before | mechanism |
|:--|:--|:--|
| `driver-sql` / `driver-sqlite-wasm` / `driver-turso` local (SQLite) | **the row** | the column stores canonical ISO TEXT (ADR-0053), so `GLOB '*2026*'` matched it |
| `driver-sql` on live PostgreSQL 16.13 | **`DATABASE_ERROR` 500** | `operator does not exist: date ~~ unknown` (SQLSTATE 42883) — the same for `timestamptz` and `time` |
| `driver-sql` on MySQL | **NOT MEASURED** | no server was provisionable; reads as coercion via `CAST(col AS BINARY) LIKE` |

Three answers to one filter, and no face declared which was canonical. The
SQLite answer was the accident of a storage form, not a capability: the same
query against Postgres was a 500.

## What it does now

The three temporal classes join `NON_TEXT_STORED_VALUE_TYPES`
(`@objectstack/spec`), the set the SQL compilers consult at compile time
because the stored value is not visible until run time. Every face that reads
it — `SqlDriver` (and everything that inherits its compiler),
`driver-turso`'s remote transport, `service-analytics`' three SQL lowerings —
compiles the positive operators (`$contains` / `$startsWith` / `$endsWith` /
`$icontains` / `$like` / `$ilike`) to the FALSE constant and `$notContains` to
the TRUE constant. Postgres's 500 becomes that declared answer; complementarity
holds; the constants compose with the existing NULL-safe rules and the `$not`
rewrite unchanged.

**The SQLite ISO-substring match is RETIRED.** A caller who was using it to ask
for "records in 2026" writes a range instead, which every dialect has always
answered the same way:

```ts
// before — matched only on the SQLite family, 500 on Postgres
{ on_day: { $contains: '2026' } }
// after — the prescription, identical on every backend
{ on_day: { $gte: '2026-01-01', $lt: '2027-01-01' } }
```

## Boundaries, so a reader does not over-read this

- **A MULTI-VALUED temporal field is untouched.** `multiple: true` stores a JSON
  TEXT array, where `$contains` is the MEMBERSHIP spelling #7398 left working on
  a JSON column — not a substring test. It keeps compiling exactly as before.
- **The value-keyed JS evaluators do not move, and they DIVERGE — measured, not
  caveated.** `driver-memory` canonicalises a declared temporal write to ISO
  TEXT (#4047), for a `Date` input and a string input alike, so a positive text
  operator MATCHES there — the exact complement of the answer this changeset
  declares. That divergence is filed as #17348 and pinned by name in that
  driver's conformance suite, alongside a correction: the two rows previously
  read as pinning the no-match answer pass because their comparand omits the
  milliseconds, not because anything type-gates. `formula` and `having` cannot
  key on the declaration at all — `matchesFilterCondition(record, filter)` takes
  a bare record ("this evaluator sees a bare record and has no schema to
  consult", its own docblock), and `having` filters AGGREGATED rows whose columns
  carry no field declaration. ⛔ So "on every face" is NOT delivered by this
  change, and this changeset does not claim it: the SQL family answers the
  declared rule, the JS faces do not yet.
- **`FILTER_TEXT_CASES` grows no temporal column**, deliberately. Every row there
  is keyed on the STORED value — which is why its non-string column is a number
  and not a date — so a temporal fixture would assert one stored form across all
  five drivers that import it, the stored-form guarantee the ruling refused
  option (b) for.
- **MySQL is NOT MEASURED**, not "passing": no server was provisionable, so its
  cell rests on the compiled-shape pin, which reads the constant a statement
  would carry without executing one.
