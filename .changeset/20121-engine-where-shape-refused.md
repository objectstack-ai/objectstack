---
'@objectstack/objectql': minor
---

fix(objectql)!: an engine `where` that is not a filter — a string, a number, a `Map`, a boolean, a `Date` — is refused with `INVALID_FILTER` / 400 before any driver call, and a `multi: true` update or delete no longer rewrites or removes every row for it (#20121)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored or stored moves: `packages/spec` is untouched, the flow record nodes already type their `filter` as a record (a string is refused at node parse), and the REST normalizer already answers a non-filter `?filter=` with this same code, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. What is refused is an in-process call whose `where` was already off the declared type; a string such as `'amount > 100'` has no defined meaning to rewrite mechanically, so the repair is the caller's own filter. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers an engine input shape (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING** — an accept-set narrowing on the engine's `where`, shipped as `minor`
under the launch-window convention (`check-changeset-no-major` refuses `major`
until GA; breaking-ness is carried by this banner and the ADR-0087 disposition
above, not by the level).

**What changed.** `find`, `findOne`, `count`, `aggregate`, `update` and `delete`
on the engine now refuse a `where` that is neither absent, a filter object nor a
filter array. The refusal is thrown before a driver is asked for anything, as
`INVALID_FILTER` with `status` and `httpStatus` 400, and its message reads
"`<verb>('<object>')`: 'where' must be a filter object or condition array,
received …. It was not applied, …" — the REST normalizer's words for the same
input. The refusal for an array that is not a filter (`[1, 2, 3]`, an infix
join) keeps its message and now carries the same `INVALID_FILTER` / 400
envelope; it used to have no `code` and no `status`.

**What it replaces.** A value with no filter keys fell through every check on
the seam and the driver ignored it. Measured on `driver-memory` and
`SqlDriver` (better-sqlite3) with four rows:

- `find` / `count` / `aggregate` answered for every row, as if no `where` had
  been given; `findOne` answered the first row (for a `Map`, its no-predicate
  guard refused the call, with no `code`).
- `update(…, { where, multi: true })` rewrote all four rows, and
  `delete({ where, multi: true })` deleted all four. That held without
  `SecurityPlugin`, and with it under a system context. For a caller scoped by
  row-level security, the security middleware wrapped the value into its `$and`,
  where the driver refused it (`INVALID_FILTER`) and nothing was written.
- Such a `where` also stepped past the unscoped-write guard that a hook opts
  into with `dispatchUnscopedMultiWrite`, because that guard treats only an
  absent or `null` `where` as unscoped.

**Unchanged.** An absent `where`, `null`, `{}` and `[]` still mean "no
filter". A filter object is accepted whatever its prototype, so an
`Object.create(null)` object or an instance of your own class carrying the filter
on its own keys filters exactly as before. A well-formed filter array is lowered
as before. The REST door already answered a non-filter `?filter=` with
`INVALID_FILTER` / 400 and is not touched.

**Fix.** Pass the predicate you meant as a filter object, for example
`{ amount: { $gt: 100 } }`, or as a filter array (`[['amount', '>', 100]]`), and
leave `where` out when you mean every row. If the value came from somewhere
untyped, the refusal names what arrived (`received string "amount > 100"`,
`received Map`), and an un-awaited promise shows up as `received Promise`.
