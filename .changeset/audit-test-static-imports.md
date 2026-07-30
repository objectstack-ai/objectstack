---
"@objectstack/plugin-audit": patch
---

fix(plugin-audit): the localized-summary tests stop charging a cold module load to one test's timeout (#4186)

`audit-writers.test.ts` resolved `@objectstack/core` and its translation
bundle with `await import(...)` inside the first localized test's helper, so
that single test paid the whole cold-start cost — resolution plus vite
transform of a large barrel — while every later case ran warmed in ~1ms.

That cost is real work being billed to a per-test timeout budget. The file
already carried a `{ timeout: 20_000 }` override for exactly this reason (its
comment measured the cold start at ~5s on a 4-vCPU runner). Under a full-repo
`pnpm test`, where a dozen packages' vitest workers compete, the cold start
grew past that bound too and the case failed at 20s — reproducibly in CI-like
load, never in isolation, which is the worst shape a red test can have: it
tracks machine load rather than code.

Both imports are now static. The same work happens during collection, which no
single test's timeout is charged for, so the previously failing case runs in
1ms and the timeout override is gone — the default timeout is now an honest
bound, and a case that exceeds it is a real hang rather than a slow import.
