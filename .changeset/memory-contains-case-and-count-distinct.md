---
'@objectstack/driver-memory': patch
---

driver-memory: the `$contains` family is case-SENSITIVE, and `count_distinct` answers a number

Two user-visible answers change on the in-memory driver. Both bring it onto the
answer the SQL family, MongoDB and the protocol already give, so a filter or an
aggregate now means the same thing whether your tests run on this double or your
production runs a real database.

**`$contains` / `$notContains` / `$startsWith` / `$endsWith` no longer fold
case.** They matched with a case-insensitive regex on the query path and on the
analytics face — over the whole Unicode range, wider even than the ASCII
boundary `$icontains` is held to — so `{ name: { $contains: 'acme' } }` returned
`ACME Corp` here and did not on any other backend. This driver's reference
matcher (`match()`) was already case-exact, so the two folding faces have moved
onto the answer the third one always gave. The comparand stays literal: `%`,
`_` and `.` were never wildcards here and still are not.

**This is a ROW-SET change.** If you relied on the fold, write `$icontains` —
the operator that spells it, implemented on every backend since #6520 and
folding ASCII case only.

**`count_distinct` answers.** `MemoryDriver.computeAggregate` had no arm for it,
so an aggregation the Query Protocol declares resolved with `{ alias: null }` —
no error, no log, no refusal. It now counts distinct NON-NULL values, matching
`COUNT(DISTINCT col)`. The analytics face was wrong in its own way and is fixed
beside it: it collected the distinct values and never sized them, so a
`count_distinct` measure came back as the raw array of values under a field its
own response metadata types as `number`.

Both are held to `@objectstack/spec/data`'s shared case-sets from now on
(`FILTER_TEXT_CASES`, `AGGREGATION_CASES`), executed in process against every
face of the package.
