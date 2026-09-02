---
"@objectstack/plugin-auth": patch
"@objectstack/plugin-security": patch
"@objectstack/service-i18n": patch
---

fix(tooling): put three more package-root plugin manifests inside a tsc program (#14386)

`check:type-check-coverage`'s `isUncheckedSourceCandidate` skipped `depth === 0`
(the package root) unconditionally, so a package-root `.ts` file was invisible
to SOURCES_COVERED no matter what it contained — not reported, and not
tracked either. That is exactly why #13284's `driver-memory` /
`plugin-hono-server` manifests went unchecked for as long as they did:
`pnpm --filter <pkg> typecheck` exited 0 with a file no tsc program read, and
the coverage gate called the package COVERED at the same time.

This finds three more package-root manifest authoring sites the same hole
hid, all `objectstack.config.ts`: `plugin-auth`, `plugin-security` and
`service-i18n`. The gate now admits `depth === 0` only for a declared,
exact-name allowlist (`ROOT_SOURCE_FILES`, `objectstack.config.ts` its only
member) — not every root-level file, which stays the unresolved "104-file"
scope question this card explicitly declines to settle (comment
5504408509 on #14386) — and each of the three manifests now sits inside a
program its package's own `typecheck` script invokes: a widened `include` on
the existing sibling `noEmit` program for `plugin-auth`
(`tsconfig.examples.json`) and `plugin-security` (`tsconfig.scripts.json`),
and a new sibling `tsconfig.typecheck.json` for `service-i18n` (which had no
sibling to widen), following the `driver-memory` shape #13284 established.

All three type-check clean at zero recorded debt — no ledger entry is added.
