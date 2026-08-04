---
---

CI-only: a failed `filter` job no longer skips all seven core gates while branch
protection reports green. Releases nothing.

`ci.yml`'s downstream jobs were guarded by `if: needs.filter.outputs.core ==
'true'`, which names no status function — so GitHub wrapped it in an implicit
`success()`. Any `filter` failure (checkout flake, a `dorny/paths-filter` fault,
the 10-minute timeout) skipped `test` / `temporal-conformance` / `dogfood` /
`dogfood-verify` / `build-core` / `build-docs` / `console-pin` at once, and a
skipped required check counts as a pass: zero tests ran, nothing went red, the
PR was mergeable. All seven now read `if: ${{ !cancelled() &&
needs.filter.outputs.<name> != 'false' }}` — skip only when the filter
EXPLICITLY said false — which is the same "when in doubt, run everything"
trade-off the `|| 'true'` on the filter's own outputs already made.

`test-gate` and `dogfood-gate` additionally take `filter` into `needs` and
refuse to accept a `skipped` leg when `filter` did not succeed, so the invariant
is asserted rather than merely arranged. `cancelled` keeps passing both gates
(#3668's run-lifecycle reasoning) and no other state changes behavior.

Third sighting of this GitHub semantic; the other two were `release.yml`'s
publish-integrity guard and its `docker` job (#4900).
