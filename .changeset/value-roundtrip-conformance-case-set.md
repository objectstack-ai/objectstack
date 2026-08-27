---
"@objectstack/spec": patch
---

test(spec,drivers): add the `VALUE_ROUNDTRIP` conformance case-set — "what you wrote is what you read back", enforced per driver per dialect (#12393)

The driver-conformance census was green at 9 of 9 dialect-scored cells after
#12136 promoted `MATRIXED`, and **none of its nine case-sets was about value
storage**. All nine ask *which rows come back*; none asks *what is in them*. So
that green was not weak evidence about a round-trip defect — it was no evidence
at all, and it would have stayed green forever with the defect in place. That is
why this family kept arriving one card at a time: #12380 (SQLite's `Field.json`
codec was not injective), #11535 (a multi-value field read back as the string
`'["x","y"]'`), #11782 (MySQL answering `1`/`0` for a declared boolean), #10995
(PG json values bound without `JSON.stringify`).

`VALUE_ROUNDTRIP_CASES` closes it as a class rather than as a tenth instance. It
is 41 cases over five declared value classes — `json`, `multiple: true`,
`string`, `number`, `boolean` — and every value in it is one some driver was
**measured** to change, or a control that stayed faithful in the same
measurement. Assertions pin **type as well as value**: the before-state of every
card above was a wrong type carrying a right-looking value, which survives
`toEqual`-style coercion and every truthiness check. `VALUE_ROUNDTRIP_COLLISION_PAIRS`
adds the injectivity half a per-value check cannot see — a string and the native
value whose encoding it resembles must stay distinguishable.

Enrolled through the census's existing machinery rather than as a bespoke suite,
which is the whole argument for this route: `CLASSIFIED` obliges the new fixture
to be named in `CASE_SETS`, `CONSUMED` obliges every driver to run it, and
`MATRIXED` obliges `driver-sql`'s cell to be answered on **every dialect it
speaks** rather than on SQLite alone — the coverage shape that let #12380 survive
in the first place. The census now reads **50 covered cells across 5 drivers ×
10 case-sets, 10 of 10 dialect-scored cells matrix-routed, 0 DEBT, 0 exempt**.

**No shipped behaviour and no public surface changes.** This is `@objectstack/spec`'s
`data` export gaining one conformance fixture, six new test files, and one
`CASE_SETS` row in the census script. No Zod schema, no runtime, no driver
source, no API. Graded `patch` for that reason: the package's published surface
grows by a test fixture that only conformance suites consume, and nothing an
existing consumer resolves changes shape.

The one non-test change is a **test-double fidelity fix** the new case-set
surfaced: `driver-turso`'s `makeLibsqlSqliteStub` did not model `@libsql/client`'s
client-side boolean → `1`/`0` conversion, so a declared `boolean` written through
the REMOTE transport could not be bound at all. Verified against the dependency's
own source rather than the transport's comment; the transport is correct and
unchanged.
