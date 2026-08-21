---
"@objectstack/cli": patch
---

`os doctor` no longer prints `✓ Test coverage` / `✓ Deprecations` about a tree it
never examined, and no longer warns `@objectstack/spec  Not built` about a
workspace that is not part of the tree (#10679).

`findMissingTests()` and `findDeprecatedUsages()` both walk
`<cwd>/packages/spec/src` — a path that exists in this monorepo and in no
application built with the framework. Both answered "that directory is not here"
with the same value they return for "I walked it and found nothing wrong" (an
empty array), so in a stock `create-objectstack -t blank` scaffold every run
printed, verbatim:

```
  ✓ Test coverage         All *.zod.ts files have matching tests
  ✓ Deprecations          No @deprecated tags found
```

about files doctor never opened. The command exits 0 either way, so "no problems
found" and "I never looked" were byte-identical to every downstream reader.

Doctor already refuses to do this one screen down: the ADR-0120 D5e advisory's
`✓ Unique scope` is withheld unless `ledgerReadingIsComplete()` says the ledger
half was read in full. These two checks escaped that discipline; this restores
it, in the same shape #5413 used for the ledger — whether the tree was examined
is now a fact in the return type rather than an absence, so the print site
cannot reach the `✓` from the unexamined arm. Where the tree is absent doctor
prints an informational, named-reason skip instead:

```
  ℹ Test coverage         Skipped — no packages/spec/src in this directory (monorepo-only check)
  ℹ Deprecations          Skipped — no packages/spec/src in this directory (monorepo-only check)
```

`--verbose` adds the resolved directory it looked for. The skip is deliberately
not a warning: nothing is wrong in an application that has no
`packages/spec/src`, and withholding a false `✓` must not manufacture a false
`⚠`.

The adjacent `⚠ @objectstack/spec  Not built` probe read `<cwd>/packages/spec/dist`
with no check that the workspace it names exists, so in an application it warned
about an absent package and prescribed `pnpm --filter @objectstack/spec build`, a
command that cannot succeed there. It is now gated on `packages/spec/package.json`
being present. Inside the monorepo the row is unchanged; outside it there is no
row, and an application's spec dependency stays covered by the `Dependencies`
check and by the spec-version-gap advisory.

Exit codes are untouched — 1 exactly when an error row exists, warnings never
flip it. One visible consequence: a stock scaffold with no other findings now
ends on `✅ Environment is healthy and ready for development!` instead of
`⚠️  Environment is functional but has some warnings`, because the warning it
used to carry was about a workspace that was never there.
