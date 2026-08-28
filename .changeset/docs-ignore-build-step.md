---
"@objectstack/docs": patch
---

build(docs): stop rebuilding the docs site on every push to `main` (#12743)

Every push to `main` rebuilt the documentation site, and almost none of them
changed what it renders. Measured over one week across the team:

| project | production builds | build-minutes | avg |
|---|---|---|---|
| **objectstack (docs)** | **228** | **2835 (98.6%)** | **12.4 min** |
| objectui | 123 | 36 | 0.3 min |
| hotcrm | 42 | 5 | 0.1 min |

The team runs `concurrentBuilds: 1`, so an 18-second `objectui` build queued
behind a 12–46 minute docs build; the queue reached **92 deployments, the oldest
34 hours old**. At 4 vCPU those docs builds cost roughly **$171/month** against a
$20 included allowance, and 168 of the 228 were failures, so most of it bought
nothing.

`apps/docs/vercel.json` now declares an `ignoreCommand` (which overrides the
dashboard's Ignored Build Step, moving the rule into version control where it is
reviewable and revertible). `scripts/vercel-ignore-docs.sh` decides:

1. non-production → skip (unchanged from the rule it replaces)
2. `content/**` or `apps/docs/**` changed → build
3. otherwise → ask turbo whether the docs dependency graph is affected
4. anything indeterminate → **build**

**Step 2 is not redundant with step 3, and dropping it would silently stop
publishing documentation.** `turbo --filter=<pkg>...[range]` computes affected
packages *by package directory*, and this repo's MDX lives at the repo root in
`content/`, outside the `apps/docs` boundary. `turbo.json` does list
`"$TURBO_ROOT$/content/**"` under `@objectstack/docs#build`'s `inputs`, but
`inputs` only feeds the cache hash — it does not widen the affected-package
calculation. Verified on `main`: commit `1265f12b` touches only
`content/docs/api/client-sdk.mdx`, and a dependency-graph check alone answers
SKIP for it.

The asymmetry in step 4 is the point. A wrong "build" costs a few build-minutes;
a wrong "skip" leaves the site quietly stale with no error anywhere. So a missing
`VERCEL_GIT_PREVIOUS_SHA`, a shallow clone that cannot reach it, an unparseable
turbo verdict, and a non-0/1 exit from turbo all build.

Deliberately not `npx turbo-ignore`, which #12698 suggested: it is deprecated
upstream ("Use `turbo query affected` instead") and derives its own comparison
range, falling back to `[HEAD^]` when it cannot read Vercel's git environment —
silently answering a different question than the one asked. The range is named
explicitly here instead.

`scripts/vercel-ignore-docs.selftest.sh` pins all six cases against real commits
from this repo's history, including the `content/**` one.
