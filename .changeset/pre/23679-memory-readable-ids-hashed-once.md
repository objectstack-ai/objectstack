---
'@objectstack/driver-memory': patch
---

fix(driver-memory): a composed `ReadableIds` leaf hashes its readable ids once per query, not once per row, so a read under a large readable-parent set no longer costs rows × parents (ADR-0139 D3)

Clause-②: no

- **Before.** The driver rewrote a composed `ReadableIds` leaf into the ids of every readable parent row, with no cap, and handed mingo that list as a plain `$in`. mingo's `$in` rebuilds a hash map of its whole list for every document it tests. So a read over R child rows under N readable parents made R × N hash inserts: with 2,700 rows and 2,400 readable parents, one `find`, `count` or `aggregate` took about a second.
- **After.** The leaf's list lowers to a member test that hashes it once, when the query compiles. The same read takes milliseconds. This holds on every door that evaluates the leaf (`find`, `count`, `aggregate`, `distinct`, `updateMany`, `deleteMany`) and under `$and`, `$or` and `$not`.
- **Answers are unchanged.** The member test keeps every rule of mingo's `$in`: a nil value matches only a literal `null` member, an array value matches when any element is a member, objects compare by structure, and string values are tested against RegExp members.
- **Scope.** Every other `$in` is still mingo's own operator. Only the list the leaf was rewritten into takes the new test. The test's operator name cannot be written in a filter: the filter shape gate refuses it.
