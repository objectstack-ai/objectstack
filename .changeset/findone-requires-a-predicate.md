---
"@objectstack/objectql": major
"@objectstack/spec": patch
"@objectstack/driver-mongodb": patch
"@objectstack/driver-sql": patch
---

fix(objectql,driver-mongodb)!: `findOne` must say which record it wants, and executes every option it declares (#4419)

`findOne` reads a single row, which makes its predicate the only thing between
the caller and *an arbitrary record*. When the predicate is missing the result is
not `null` — it is the object's **first row**: a real, plausible-looking record
with nothing to do with the request, which the `if (!row)` check every call site
already has cannot catch, and which then propagates into whatever is computed
next. Reported downstream: line items defaulting their price from the first
product in the catalog rather than the selected one, and "is this deal already
closed?" answered against an unrelated record while the write that followed
correctly targeted the intended id. A throw would have been caught in
development; a `null` would have been caught by the null-check. A valid-looking
wrong record defeats both.

**Breaking — `findOne` now refuses a query that selects nothing in particular.**

FROM → TO:

| Was | Now write | Meaning |
|---|---|---|
| `findOne(o)`, `findOne(o, {})`, `findOne(o, { where: {} })` | `findOne(o, { where: … })` | the record matching this predicate |
| | `findOne(o, { search: 'Acme' })` | the record this search finds |
| | `findOne(o, { orderBy: [{ field: 'created_at', order: 'desc' }] })` | the FIRST record in this order — the newest |
| | `find(o, { limit: 1 })` | any row will genuinely do, said at the call site |

One-line fix: add the `where` you meant, or `orderBy` if you meant "the newest
one", or switch to `find(o, { limit: 1 })` if any row will do. The error names
all four. `find` and `count` are unchanged — returning or counting every row is
an honest answer; only `findOne`'s implicit "just one of them" turns a missing
predicate into a confidently wrong record. The guard reads the CALLER's
predicate, before RLS/sharing middleware injects its own: a tenant filter
narrows which rows are visible, it does not make "whichever comes first"
something the caller asked for.

**Two silent drops that produced the same wrong record are fixed with it.**

- **`findOne({ search })` applies the search.** The ADR-0061 `search` →
  cross-field `$contains` expansion lived inline in `find` and nowhere else,
  while `find` and `findOne` are checked against the SAME legal-key set — so
  `search` passed the gate, rode onto the AST, and reached a driver. No driver
  reads `ast.search`. The read therefore ran with no predicate at all and
  `limit: 1` did the rest. The expansion is now one method both call.
- **`MongoDBDriver.findOne` applies `orderBy`, `fields` and `offset`.** It
  translated `query.where` and dropped the rest, so `findOne({ orderBy })` did
  not return the newest record — it returned whichever document the scan reached
  first. `find` and `_findStream` in the same driver had always handled all
  three. This one matters beyond Mongo: the guard above tells an unpredicated
  caller to reach for `orderBy`, and an escape hatch one backend ignores is not
  an escape hatch. No ordering is IMPOSED when the caller supplies none — both
  drivers keep that carve-out (#4363), and `SqlDriver`'s comment about Mongo
  "never sorting" is corrected, since it cited the dropped parameter as
  agreement.

**And a gate so the class does not come back.** A drift pin walks
`ENGINE_OPTION_KEY_SETS.findOne` and requires each declared key to have an
observable effect — on the AST the driver receives, on the driver options, or in
an explicit "not executed, and here is why" entry (only `limit`, which the
contract's `limit: 1` overrides). `search` sat declared-but-unexecuted through
two rounds of hardening because nothing asked that question.

Together with #4346 (`filter` → `where` folds on every entry point) and #4400
(unknown option keys throw), a read parameter the engine does not execute now
fails at the call site instead of quietly changing the answer.
