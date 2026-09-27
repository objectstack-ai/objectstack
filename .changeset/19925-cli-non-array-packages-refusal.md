---
'@objectstack/cli': minor
---

fix(cli): `os info` and `os lint` refuse a stack whose `packages` is present but not an array, instead of reading it as no packages (#19925)

Clause-②: no (narrowing)

**BREAKING for `os info` and `os lint` on a hand-written stack.** A config whose
`packages` is present but is not an array (`{}`, `0`, `'x'`) is now refused with
`INVALID_ARTIFACT_PACKAGES` (ADR-0112, `status: 422`) and exit code 1. These
commands used to read it as a stack with no packages. `os info` exited 0 and
reported every package-owned collection as empty. `os lint` exited 0 with
`passed: true`. Only two spellings reach these commands with such a value: a
config exported as a plain object, and `defineStack(…, { strict: false })`.
The default `defineStack` parse, `os validate` and `os build` already refused
it.

The accept set only shrinks back to what the declaration has always said.
`ObjectStackDefinitionSchema` declares `packages` as an array of package
entries. Ruling A on #15293 settled that a present non-array value is
malformed, not absent. The runtime, `@objectstack/core` and the plugin readers
already refused it. The CLI's stack-collection reader and its three
package-docs readers still answered "no packages". They now judge the value
through one helper, which hands a non-array to `resolveArtifactPackageOrder`.
So the refusal's code, status and sentence are core's own, and the CLI keeps no
second copy of the rule.

**What is not affected.** An absent `packages` reads exactly as before, and so
does a `packages` array. A malformed entry inside an array is still refused as
`INVALID_ARTIFACT_PACKAGE_ENTRY`. `os serve` and `os dev` refused this stack
before the change, because the runtime's manifest service raises the same
refusal at boot, and they still do.

**`packages: null` follows core's resolver.** Ruling `5805260775` on #19926
makes `null` malformed at every reader, and the resolver's `null` refusal is
landing separately (#19926, PR #20228). The CLI readers do not answer `null`
themselves; they hand it to `resolveArtifactPackageOrder` and return what it
answers. Today that is its absent answer, so `null` still reads as no
packages. Once the resolver refuses `null`, these commands refuse it too, with
no change to the CLI.

**If you are refused.** Omit `packages` for a single-package stack, or give it
an array of `{ manifest: … }` entries. The refusal says the same.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row. `objectstack migrate meta` has nothing to reach, because a non-array `packages` was never a legal spelling of anything, so no old form maps to a new one. The refusal itself carries the remedy. -->
