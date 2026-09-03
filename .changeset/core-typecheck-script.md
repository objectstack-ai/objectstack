---
"@objectstack/core": patch
---

feat(tooling): `@objectstack/core` declares a `typecheck` script, and its test and examples layers enter the ratchet (#14613)

`packages/core/package.json` declared exactly `build`, `test` and `test:watch`.
Around twenty sibling packages declare `typecheck`, and `turbo run typecheck`
selects only packages that declare the task — so the lint workflow's typecheck
job had no way to reach this package, and `pnpm --filter @objectstack/core
typecheck` failed with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` for anyone who tried
it. The package's types ship anyway: `build` emits a 233 KB `dist/index.d.ts`,
and rest, runtime, mcp, services and plugins all import it.

The state was tracked but not runnable. `check:type-check-coverage` carried
`@objectstack/core` as a DEBT entry of 98 and had already re-measured it once
(91 to 98), so nothing was invisible — but a ledger only the gate can read is
not something a contributor working in the package can run, which is how a
dispatched task came to assume the script existed.

**Measured at `84b8190ae`, dependency closure built first.** The undivided
program (`tsc --noEmit -p tsconfig.json`, exactly as the DEBT entry measured it)
reports 98 errors across 12 files, and every one of the 12 is a `.test.ts`. The
same program restricted to the 63 non-test source files reports **zero**. So the
build layer graduated as it stood, and the 98 did not have to be repaired before
the script could exist.

**94 of the 98 were the check, not the code.** The repair is the split this
repo already runs for `spec`, `rest`, `objectql` and `client`: `tsconfig.json`
stays the build config and excludes the test layer; a new `tsconfig.test.json`
compiles that layer under the module semantics vitest actually executes it with
(`module: esnext`, `moduleResolution: bundler`), which retires 22 x TS2835, the
TS2347 beside them and the share of 71 x TS7006 they cascade into — an import
that does not resolve makes every symbol it names `any`. **No test file was
edited.** Strictness is inherited and untouched. The residue is 4 errors over 4
files, held per file and per signature in `test-typecheck-debt.json`, EXACT and
shrink-only.

**The `examples/` half was found by the new script, not by the card.** Declaring
`typecheck` flips the package from COVERED-BY-LEDGER to COVERED-BY-SCRIPT, and
`check:type-check-coverage`'s SOURCES_COVERED invariant immediately reported
`packages/core/examples` — 2 non-test source files in no tsc program at all.
Neither had ever compiled: `kernel-features-example.ts` imported `../index.js`
(above the package root, never existed) and `phase2-integration.ts` imported
`@objectstack/core`, i.e. this package self-referencing by a name it declares in
no dependency block. Collapsing that cascade exposed rather than removed errors,
12 to 29, all of them real and none of them new: 20 reads of `ObjectKernel`'s
**private** `logger`; four members of the security scan result that do not exist
(`passed`, `score`, `summary.critical`, `summary.high`, where the type carries
`status` and per-severity counts); and two config literals passing the unparsed
shapes where `PluginHealthMonitor.registerPlugin` and
`HotReloadManager.registerPlugin` are declared over the `Parsed` ones. That last
pair is retirement drift — this file was edited by two retirements (restart keys,
`watchPatterns`) while no tsc program could check the result. Every correction is
pinned to this package's own signatures; `packages/spec` was not touched.

`packages/core` therefore leaves the DEBT ledger: the coverage gate now reads
70/79 packages type-checked with 9 ledgered, where it read 68/78 with 10.
