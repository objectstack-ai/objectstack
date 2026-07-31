---
"@objectstack/driver-sqlite-wasm": patch
---

test(drivers): the "held to by a gate" claim now has a gate behind it (#4363)

Three changesets — filter combinator semantics (#3774), temporal storage form
(ADR-0053), deterministic paged reads (objectui#3106 / #4363) — each introduced
a shared case-set in `@objectstack/spec/data` with some version of the claim
that a future driver "is held to this by a gate rather than by remembering it".

There was no gate. The case-sets are exports sitting in a package; nothing
obliged a driver to import them. Measured on `main`, the matrix had three holes:
`driver-sqlite-wasm` ran neither pagination case-set, and neither it nor
`driver-mongodb` ran the filter-logic one — including a hole in the very
case-set whose changeset made the claim.

`scripts/check-driver-conformance.mjs` (`pnpm check:driver-conformance`, wired
into lint.yml's required job) makes the hole the failure. Every
(driver × case-set) cell is covered — some file under the package's `src/`
imports *and drives* the case-set's marker export — or carries a measured
DEBT/EXEMPT entry, reconciled in both directions. A third direction, CLASSIFIED,
holds the other end: a new `*-conformance.ts` fixture nobody classified fails
the run rather than starting life uncovered, which is the direction that
actually rots (#4203). It caught an unclassified `TEMPORAL_TIME_CASES` on its
first run.

`driver-sqlite-wasm` gains the pagination suite the gate found missing. It
inherits `SqlDriver`'s ORDER BY construction, so nothing is re-implemented —
what the suite pins is that the clause survives a different *engine*: this
driver swaps knex's transport for a custom sql.js dialect that compiles,
executes and marshals every row through its own path, and a dialect that
reordered or dropped the trailing `ORDER BY id` would fail in no other suite.

The two filter-logic holes are ledgered as DEBT rather than fixed here, with
their reasons printed on every run and tracked in #4405. The mongodb row is the
substantive one: `translateFilter` is an independent FilterCondition backend —
the fifth, and the one #3774 never enrolled when it counted "the four".
