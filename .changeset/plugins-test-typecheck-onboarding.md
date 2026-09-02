---
"@objectstack/embedder-openai": patch
"@objectstack/knowledge-memory": patch
"@objectstack/knowledge-ragflow": patch
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-audit": patch
"@objectstack/plugin-auth": patch
"@objectstack/plugin-dev": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/plugin-pinyin-search": patch
"@objectstack/plugin-reports": patch
"@objectstack/plugin-security": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-webhooks": patch
---

feat(tooling): onboard all 14 `packages/plugins/**` packages into `check:test-typecheck` (#14062)

Every plugin package now has a `tsconfig.test.json` compiled by the shared
`check:test-typecheck` gate, and its `typecheck` script names it. Before this,
the shrink-only `test-typecheck-debt.json` ratchet said **nothing** about a
third of the repo's runtime surface: 14 packages, 1 `tsconfig.test.json`
(`plugin-security`, wired directly to `tsc` rather than to the instrument), and
0 `check:test-typecheck` scripts.

Onboarded as a family by the director ruling of 2026-09-01 on #14062
(maintainer verbatim: 「同意」), which also carries the #5286 maintainer
authority the starting ledgers need. The smaller branch triage recommended —
declare the instrument's scope and re-site the two compile-time pins — was
recorded as considered and not taken: an instrument silent over a third of the
runtime surface is a hole readers generalise across, and that costs more than
fourteen tsconfigs.

**Measured, not assumed** (at `e80889095`, workspace closure built first). Four
packages carry residue and therefore a starting ledger — plugin-approvals 324
over 8 files, plugin-auth 94 over 10, plugin-sharing 3 over 2,
knowledge-ragflow 3 over 1. The other ten measure **zero** and deliberately get
no ledger file at all: the gate reads a missing ledger as `{ entries: {} }`, so
any error there is red immediately with no entry to be added to — strictly
stronger than a ledger holding nothing, and the call `plugin-security` had
already recorded for itself.

⛔ **This does not repair 345 type errors.** Per ruling item 3 it makes the
ratchet able to *see* them; paydown follows the ratchet's own shrink-only
discipline on its own cards. No test file is edited here.

Two corrections to the finding's own prose, both measured: the exclusion is
narrower than "no plugin package compiles its tests" — 9 of the 14 already
compiled their tests inside the `typecheck`-invoked build config, at zero
errors — and `exec-context-annotation.pin.ts` is a `.pin.ts`, which
`**/*.test.ts` never excluded, so its directives were already live. The pin
this change genuinely makes real is
`plugin-approvals/src/manager-org-screen-parity.contract.test.ts`, which no tsc
program had ever read.
