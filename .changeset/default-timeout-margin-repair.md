---
"@objectstack/types": patch
"@objectstack/dogfood": patch
---

fix(tests): give two default-vitest-timeout cases real margin instead of a bare default (#9311)

Two cases only passed `pnpm test` when they were not competing for CPU — the
same defect class as the already-closed precedents #3662, #4186, #4485,
#5421, #6329: a test running under vitest's **default** `testTimeout` /
`hookTimeout` with no margin for anything heavier than an idle box.

**`packages/types/src/node.test.ts`** — `"falls back to the importing
package's own resolution when the host does not declare"` is the only case
in the file that performs a real dynamic `import()` of `@objectstack/spec` (a
multi-megabyte package); every sibling in the same `describe` block resolves
a small on-disk fixture or fails fast, all under 10ms. Measured on this box:
~0.9-1.1s unloaded, already observed failing at 5061ms against the 5000ms
default under nothing heavier than `turbo run test --concurrency=2` (#9311's
own isolation runs). Gave that one case an explicit 30s `testTimeout` — the
same order of magnitude the repo already uses for subprocess/real-load cases
(`#3662` precedent) — and left every sub-10ms sibling alone.

**`packages/qa/dogfood/test/semantic-roles.dogfood.test.ts`** — its
`beforeAll` boots the full showcase stack (ObjectQL + ~45 plugins) through
`@objectstack/verify`'s `bootStack`, which does not fit vitest's 10s
`hookTimeout` default with any margin at all: observed failing at 10027ms
against the 10000ms budget, and this file's own isolated run measured 18.3s
(vitest `Duration`) / 19.5s wall clock for the whole file even with the box
otherwise idle. Gave the hook an explicit 180s timeout, matching this
package's own existing house pattern for the identical
`bootStack(showcaseStack, …)` call
(`admin-identity-audit-trail.dogfood.test.ts`'s `beforeAll(…, 180_000)`)
rather than inventing a new number for the same operation.

**No behaviour change** — both suites already pass; this only gives the two
timeout-sensitive cases room to finish on a loaded box. The repo's full test
suite is confirmed green at low concurrency (#9311), so this is margin
repair, not a product fix. `turbo.json`'s default concurrency is out of scope
for this change (a maintainer-level default, per #9311's own filing).
