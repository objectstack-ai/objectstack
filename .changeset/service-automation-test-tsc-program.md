---
"@objectstack/service-automation": patch
---

fix(service-automation): put the test layer in front of tsc, and repair the TS2341 x3 it was hiding (#15048)

`packages/services/service-automation` had **no `typecheck` script at all** —
its scripts were `build` and `test` — so no tsc program anywhere read this
package (`turbo run typecheck` selects only packages that declare the task, so
it skipped this one silently). `tsup` transpiles with esbuild and `vitest`
runs through esbuild type-**stripping**; neither type-checks. The package's
own `tsconfig.json` does include the tests and always did, so the program that
would have read them already existed and was simply never invoked. This is
the `packages/services/**` sibling of `@objectstack/service-cluster`'s same
graduation (#14181 / PR #15032), reached by the same road in.

What that hid was three `TS2341`s, all in
`src/nested-region-parity.test.ts` (lines 95/151/180):

```
error TS2341: Property 'flows' is private and only accessible within class 'AutomationEngine'.
```

Three tests dot-read the private `AutomationEngine#flows` map directly
instead of going through the class's own public accessor,
`await engine.getFlow(name)` — already the idiom every other test file in
this package uses. The fix replaces the three private reads with that
existing public call (making the two synchronous test bodies `async` where
they were not already); no source signature was widened, no cast was added.

Wired by the route the `packages/plugins/**` family settled on in #14062 and
`service-cluster` carried into `packages/services/**` in #14181: a sibling
`tsconfig.test.json` that changes **module semantics only** (`esnext` /
`bundler` / `lib: ES2022`, matching how vitest actually executes these files)
with **strictness inherited and untouched**, named by a new `typecheck`
script through the shared `check:test-typecheck` gate. Measured before the
repair: 3 errors under build semantics (`tsc -p tsconfig.json`, which already
included the tests), 3 under the new config — the two readings agree, so this
package carried no config-tier pile, and all 3 were genuinely code-tier from
the start. After: 0 and 0, across a 555-file program covering all 103 of its
`src/**/*.test.ts`.

No `test-typecheck-debt.json` is added, and its **absence is the zero**: the
gate reads a missing ledger as `{ entries: {} }`, under which any error in any
file here is red immediately. The package's `DEBT` entry in
`scripts/check-type-check-coverage.mjs` (`errors: 3`) is deleted in this PR
rather than lowered — that is the graduation the ratchet's own invariant
requires, and it is why the errors were fixed rather than ledgered.

`scripts/check-type-source-resolution.mjs` also gains a registry entry for
this package: onboarding `tsconfig.test.json` moved the package's tsc program
set (per that gate's documented onboarding-limb terms), exposing 9 workspace
deps whose types resolve through `dist/` with no pre-existing program for them
to have been laundered through. `paths` was measured and rejected as the
alternative — it takes this package's test layer from 0 errors to 648, nearly
all billed to other packages' source.

No runtime code changes: `src/**` (excluding the one edited test file, whose
own assertions are unchanged — only how it reaches the flow moved) is
otherwise byte-identical, so no shipped behaviour moves. The `patch` level
reflects the published `package.json` gaining `typecheck` /
`check:test-typecheck` scripts and a `tsx` devDependency.
