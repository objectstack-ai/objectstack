---
---

ci: validate on the runtime we publish from — pin every workflow to Node 22 (#3825)

CI ran two Node versions at once, and nobody had decided that. All 12 PR gates —
Build Core, Test Core, TypeScript Type Check, Dogfood, ESLint, spec liveness,
dep validation — were on **Node 20**, which reached EOL on **2026-04-30**, while
`release.yml`, `publish-smoke.yml`, `scaffold-e2e.yml` and `showcase-smoke.yml`
were on **22**. So code was verified on one runtime and shipped from another,
and the runtime guarding every merge no longer received security patches.

The split was drift, not policy. `release.yml` carried the receipt in a comment
— *"22 (not 20 like the other workflows)"* — because a downstream clone pinned
`engines.node >=22` and pnpm aborted on 20. One workflow got bumped to clear one
error; the other twelve stayed behind, and nothing in CI could see the gap.

It surfaced only by accident in #3812: a test imported `better-sqlite3@13`,
whose `engines` say `>=22`. `engines` is a declaration, not enforcement, so it
loaded on Node 20 and then killed the vitest worker with a **process-level
abort** — no JS error, so the suite reported `Test Files 22 passed (23)` while
**17 cases silently never ran**. A green check that had quietly stopped running
the tests.

All 18 `setup-node` steps now run Node 22, matching what release already used.

**`.nvmrc` is now the single source of truth.** It pins contributors' local
runtime via `nvm use` — previously there was no pin at all, so a contributor on
Node 24 could not reproduce a Node 20 gate failure — and `check:node-version`
(new, wired into the unfiltered, always-required `lint` job) holds every
workflow to it. A version pin is otherwise 18 independent string literals, which
is why this drifted invisibly for so long; bumping Node is now a one-line edit
to `.nvmrc` plus whatever the guard reports. The guard also fails a `setup-node`
step that pins *nothing*, which would silently inherit the runner default.

Nothing about the published packages changes: `engines.node` stays `>=18.0.0`
across all 49 of them. That is a promise to users about what ships, independent
of what CI validates on, and tightening it is a breaking change — left for its
own decision rather than folded in here.
