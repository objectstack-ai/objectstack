---
"create-objectstack": major
"@objectstack/spec": major
"@objectstack/cli": major
---

feat!: require Node.js 22 — promise the runtime we actually test (#3825)

Every published package declared `engines.node: ">=18.0.0"`. **Node 18 reached
end-of-life on 2025-04-30 and Node 20 on 2026-04-30**, so the compatibility
promise covered two runtimes nobody patches — and, after #3830 moved CI to Node
22, two runtimes nothing in this repo verifies.

That left the promise and the evidence with **no overlap at all**:

| | Node version |
|---|---|
| What CI validates every PR on | **22** |
| What `release.yml` publishes from | **22** |
| What every shipped Docker image runs (`docker/Dockerfile`, `blank` template, self-hosting docs) | **22** |
| What `engines.node` promised users | **>=18** |

`engines.node` is now `>=22.0.0` across all 50 manifests. This is the honest
floor: it is the only runtime the packages are built, tested and shipped on.

## Migration

**If you are on Node 22 or newer, nothing changes.** Node 24 (Active LTS since
2025-10-28) and Node 26 both satisfy the new range.

If you are on Node 18 or 20, upgrade to Node 22+. Both are past end-of-life and
receive no security patches:

```bash
nvm install 22 && nvm use 22
```

npm and pnpm surface an unsatisfied `engines` as an **`EBADENGINE` warning**, not
a hard failure, so an existing install will not break the moment you upgrade —
but the package is no longer tested on that runtime, and the failures are the
kind that do not announce themselves. #3812 is the worked example: a native
dependency whose `engines` required a newer Node loaded anyway on the older one
and then killed the test worker at the process level, with no JS error and a
summary that still said "passed".

If your CI pins Node, pin it to 22 as well — running your gates on a runtime
your dependencies no longer support is exactly the split this change closes.

## Also updated

The "Node 18+" prerequisite was restated in ten user-facing places
(`README.md`, `CONTRIBUTING.md`, the getting-started and deployment docs, the
todo example, and the `objectstack-platform` skill's `compatibility` field).
All now say 22. Changelogs and ADRs are historical records and were left alone.
