---
"@objectstack/driver-mongodb": patch
"@objectstack/driver-sqlite-wasm": patch
---

test(drivers): the filter-logic standard now covers the backend it was counted without (#4405)

`FILTER_LOGIC_CASES` (#3774) opens by calling itself the standard "the four
independent FilterCondition backends are each checked against". Five backends
exist. `driver-mongodb`'s `translateFilter` was missed, not excluded — an
independent implementation whose `$and`/`$or`/`$not` translation shares no line
of code with the SQL compiler or the in-memory matcher, and the only one whose
target language cannot spell the standard directly: MongoDB has no
document-level `$not` at all (the server answers `unknown top level operator:
$not`), so a negation has to leave as `$nor`, and a branch's own keys have to
stay in one document while `$and`/`$or` clauses are lifted beside them. That
route was never checked against the shared cases. Both DEBT rows the #4363 gate
recorded are now cleared, and `scripts/check-driver-conformance.mjs` reports
`ok` for every cell of the matrix.

**`driver-mongodb` runs the table twice, and the split is deliberate.**
`mongodb-filter-logic-translation.test.ts` drives every shared case through
`translateFilter` and evaluates the emitted MongoDB *document* over the shared
fixture — a pure function, no server, so it always runs. That matters here more
than anywhere: `mongodb-memory-server` downloads a ~123 MB binary from
fastdl.mongodb.org, and a defect only a downloadable binary can catch is a
defect nobody catches on a restricted network. Its in-process reader is strict
by construction — every shape it does not model throws instead of evaluating to
true, a document-level `$not` included — and its own discrimination is pinned by
cases that require a widened document to FAIL the case it widens, so "all green"
cannot mean "the reader says yes to everything".
`mongodb-filter-logic-conformance.test.ts` runs the same table against a real
mongod and answers the one question the first half cannot — does MongoDB agree?
— skipping cleanly (never silently) when the binary is unreachable.

**`driver-sqlite-wasm` runs the table through its own engine.** It inherits
`SqlDriver`'s filter compiler, so nothing is re-implemented; what the suite pins
is that a nested `(… AND …) OR (… AND …)` survives the custom sql.js dialect
that compiles, binds and marshals it — the same seam its temporal and pagination
suites cover for their clauses. Tracked as DEBT rather than EXEMPT because
"inherits, therefore fine" is the assumption those suites exist to disprove; the
suite is what disproves it.

**No divergence was found.** `translateFilter` answers all seventeen shared
cases correctly today, `$not`-inside-a-branch and nested `$and`-inside-`$or`
included, so no translation change ships here — what changes is that the next
edit to it cannot quietly widen a filter. Both suites were verified to be
discriminating rather than decorative by reintroducing the #3774 miscompile
(propagating `or` into a branch's own contents): 15 of the mongodb translation
suite's 26 tests fail, and 13 of the wasm suite's 18.

`packages/spec`'s `filter-logic-conformance.ts` header now says five and names
the fifth — a code comment; no schema, export or generated artifact moved.
