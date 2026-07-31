---
"@objectstack/formula": patch
"@objectstack/sdui-parser": patch
"@objectstack/connector-mcp": patch
"@objectstack/connector-openapi": patch
"@objectstack/connector-rest": patch
"@objectstack/connector-slack": patch
"@objectstack/embedder-openai": patch
"@objectstack/knowledge-memory": patch
"@objectstack/knowledge-ragflow": patch
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-pinyin-search": patch
"@objectstack/plugin-reports": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/service-cluster": patch
"@objectstack/service-cluster-redis": patch
"@objectstack/service-datasource": patch
"@objectstack/service-sms": patch
"@objectstack/trigger-api": patch
---

chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

These 20 packages declared no `files` field, so npm fell back to packing the
whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
listed **21 files** — 15 under `src/`, three of them unit tests
(`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
publish time rather than instead of it, so consumers were installing the
TypeScript sources and the test suite alongside the artifact they asked for.

Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
that already did. Nothing a consumer imports moves: every `main` / `types` /
`exports` target in all 20 already resolved inside `dist/`, which the new
`check:published-files` guard verifies rather than assumes. The visible change
is a smaller install and a smaller dependency-scanning surface — `npm pack` on
`@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

The other half of the fix is the gate. Half the packages declaring `files` and
half not was the #3786 shape — a hand-copied convention with nothing enforcing
it, where whoever forgets the line gets no signal at all. `check:published-files`
(new, wired into the always-required `lint` job) holds every non-private
workspace package to four invariants: `files` is **declared**; it is
**sufficient** (covers every entry point, so tightening a whitelist cannot ship
a package that fails to resolve); it is **minimal** (admits no test, test-harness
config or build script); and anything beyond `dist` + `README.md` is
**registered** with a reason, reconciled in both directions so a stale exemption
is an error rather than dead text. `@objectstack/spec` is the one package with
registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
`CHANGELOG.md` are product, not build input.

This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
from the docs-drift implementation test is sound only while no package publishes
`scripts/` as runtime code; that held, but it held because someone read all three
offenders by hand. It is now checked on every PR.
