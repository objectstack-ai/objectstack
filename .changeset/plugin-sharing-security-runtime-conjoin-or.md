---
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-security": patch
"@objectstack/runtime": patch
---

test: twelve in-memory driver doubles in `plugin-sharing`, `plugin-security` and
`runtime` conjoin `$or`/`$and` with their sibling filters instead of short-circuiting
(part of #7620)

Twelve test files across three packages built an in-memory driver whose `WHERE`
matcher **returned early** on `$or` (and usually `$and`), discarding every sibling
equality key in the same object:

```ts
if (Array.isArray(filter.$or)) return filter.$or.some((f) => matches(row, f));
if (Array.isArray(filter.$and)) return filter.$and.every((f) => matches(row, f));
for (const [k, v] of Object.entries(filter)) { /* siblings, never reached */ }
```

A real driver ANDs them. So a query mixing an equality key with a top-level `$or`
would have been answered on the `$or` alone, handing back rows the sibling key
would have excluded — not a stricter or looser edge case, a different query, with
the suite staying green while testing it.

The fix is the ~2-line change already established by `packages/objectql`'s six
(#7846) and by several already-corrected siblings in these same two packages
(`bu-tree-recompute.test.ts`, `recipient-width.test.ts`, `sharing-rule.test.ts`,
`system-caller-inert-grant.test.ts`, `business-unit-graph.test.ts`): fold the
combinator check into a guard that only short-circuits on **failure**, so the
sibling-key loop still runs afterward.

**This lane's file enumeration differs from the issue body**, which is stale
(confirmed in-thread): `plugin-sharing/src/sharing-rule.test.ts` was already fixed
before this PR, and three files this PR fixes were never named in the issue at all
(`plugin-sharing/src/sharing-service.test.ts`,
`plugin-security/src/check-only-write-scope.test.ts`,
`plugin-security/src/select-only-write-visibility.test.ts` — found by re-grepping
`$or` across both packages' `src/*.test.ts` at this PR's base ref rather than
trusting the issue's list). Files corrected here:

- `packages/plugins/plugin-sharing/src/`: `authored-row-write-deferral.test.ts`,
  `boot-backfill.test.ts`, `bulk-recompute.test.ts`, `record-share-cascade.test.ts`,
  `sharing-service.test.ts`, `system-write-skip-notice.test.ts`
- `packages/plugins/plugin-security/src/`: `authored-row-write-verdict.test.ts`,
  `check-only-write-scope.test.ts`, `row-write-widener-composition.test.ts`,
  `select-only-write-visibility.test.ts`, `vama-write-path-convergence.test.ts`
- `packages/runtime/src/domains/`: `share-links-enforcement-context.test.ts`

**All twelve are dormant today — measured, not assumed**, via the same
`fs.appendFileSync` probe discipline #7846 used (a `console.log` probe was tried
first, returned nothing, and was correctly distrusted rather than read as "zero
calls"). Per-package results, with a positive control proving the probe would have
caught a live case:

- `plugin-sharing`'s six: **0 combinator calls out of ~1.52M matcher invocations**
  across the six suites (dominated by one bulk-recompute test's own scale; the
  other five totalled ~2,755). Positive control: instrumenting the already-fixed
  `sharing-rule.test.ts` with the identical probe, then reverting it, recorded 151
  `$or` and 3 `$and` calls in the same run — proof the zero above is a real
  absence, not a dead probe.
- `plugin-security`'s five: **not** all-zero like objectql/sharing — `$and`
  appears 23–71 times per file and `$or` appears twice in one file
  (`authored-row-write-verdict.test.ts`). But every single one of those calls
  carried the combinator as the **only** key in its filter object (`other: []`),
  so early-return and conjoin produce identical results in every case observed —
  dormant in the sense that decides this PR, for a different reason than
  objectql/sharing (never invoked, vs. invoked but never mixed with a sibling).
- `runtime`'s one file: 1 `$or` and 10 `$and` calls, same "combinator-only, no
  siblings" shape — dormant for the same reason as `plugin-security`.

No existing test outcome changes anywhere, and none should: `plugin-sharing`
(21 files / 569 tests), `plugin-security` (52 files / 1037 tests) and `runtime`
(151 files / 2317 tests) are green before and after, byte-identical assertions.

**Operator-support measurement, per the card's ask**: unlike the objectql six
(measured byte-for-byte identical operator support), these twelve are **not** a
single lowest common denominator. `plugin-sharing`'s matchers mostly support
`$in`, several add `$ne` or `$gte`/`$gt` (the tree/graph-shaped ones), and
`sharing-service.test.ts` supports only `$in`. `plugin-security`'s five and the
`runtime` one are the most uniform subset (`$in` only, identical shape). A shared
helper across all sixteen files repo-wide would have to be a strict superset or
force some suites to drop operators they use — a materially different tradeoff
than the objectql lane's "no lowest common denominator to flatten to" finding.

Deliberately **not** extracted into a shared helper here either, for the same
reason `packages/objectql`'s six gave: keeping each test double's substrate
self-contained so it can fail independently of any other suite's fixture file.
Where a cross-package helper would live, and whether the missing regression guard
is worth adding, are open questions for the PM now that all three lanes of #7620
have landed — not decided in this PR.
