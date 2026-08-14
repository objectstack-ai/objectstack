---
"@objectstack/driver-sql": patch
---

test(driver-sql): attribute each `legacyUniqueReplacements` guard to exactly one case (#8557)

**`patch`, and deliberately not `none`.** This adds no runtime code and changes
no behaviour — every assertion is green on `main` before the change. The bump is
the floor rather than a skipped changeset because the file it protects is
release-relevant: what lands is the pin that makes a future single-guard
deletion visible, and the release notes for the version that first carries it
are the place a maintainer looks to learn the pin exists. A `minor` would claim
a capability; `none` would leave the protection undocumented at the only moment
anyone reads for it.

The declared-index replacement arm's guards were **individually unpinned**:
measured on #8468, deleting the ADR-0120 S6 name-identity guard, or admitting a
declared bare `unique: true` through the scope filter, left the entire suite
green — including the two tests whose names say they cover exactly those cases.
The protection was real but collective, so no test attributed it to a line, and
a refactor could remove any single guard and be told nothing.

`schema-drift.legacy-unique-guard-attribution.test.ts` adds that attribution.
The existing object-level suites are untouched — they are broader than any one
guard, which is why they could not do this job.

- **Nine guards are individually attributable.** One input per guard,
  constructed so only that guard can reject it, each paired with a **twin** —
  the same input with the single property that guard reads changed, which must
  produce exactly one replacement. The twin is the reachability witness: without
  it a case would still pass while some earlier guard swallowed the input, which
  is the failure mode being fixed, one level up. Measured: deleting any one of
  the nine turns **exactly one** test red, and its name says which line went.
- **Five guards cannot be attributed at all**, because another guard rejects a
  superset of their inputs — deleting one is behaviour-preserving for every
  possible argument, so a test claiming to pin it would be lying. For those,
  what is pinned is the **fact the domination rests on**, so the day it breaks
  and the guard becomes load-bearing alone, something goes red.

Behind the dominated S6 guard are the hand-written organization composites on
`sys_team`, `sys_business_unit` and `sys_member` — three shipped platform
objects on a spelling valid indefinitely. Those composites are now pinned
directly, in both the shipped bare-`true` spelling and the respelled
`'organization'` form.

The bare-spelling case is the test-side half of a pair whose first half already
shipped: #8463 (PR #8512) put the same divergence into prose on
`isOrganizationScopedUnique`'s JSDoc, in this same file, with no test attributing
it. Routing the declared branch through the field predicate remains the rejected
option 1 of #8323 (maintainer ruling 2026-08-13), and is now refused by a test
rather than only by a comment.
