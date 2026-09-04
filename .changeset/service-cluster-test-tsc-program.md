---
"@objectstack/service-cluster": patch
---

fix(service-cluster): put the test layer in front of tsc, and repair the TS2322 it was hiding (#14181)

`packages/services/service-cluster` had **no `typecheck` script at all** — its
scripts were `build` and `test` — so no tsc program anywhere read this package.
Turbo/CI typecheck lanes skipped it silently, because a zero-matching filter run
exits 0. `tsup` transpiles with esbuild and `vitest` runs through esbuild
type-**stripping**; neither type-checks. The package's own `tsconfig.json` does
include the tests and always did, so the program that would have read them
already existed and was simply never invoked.

What that hid was in the worst possible file. `src/memory/memory.contract.test.ts`
is the package's **contract witness** — type conformance to the `IPubSub` /
`ILock` / `IKV` / `ICounter` contracts is the entire point of its existence — and
it did not compile:

```
src/memory/memory.contract.test.ts(26,46): error TS2322:
  Type 'number' is not assignable to type 'void | Promise<void>'.
```

`cluster.pubsub.subscribe('e', (m) => received.push(m.payload))` passes a concise
arrow body as a `PubSubHandler`, whose contract return type is
`void | Promise<void>`. The body returns `Array.prototype.push`'s `number`, and
TypeScript's void-return assignability relaxation does **not** forgive it,
because the target is a UNION rather than a bare `void`. It is repaired with a
block body — the handler is side-effect-only by contract, and the returned length
was an accident of arrow syntax, never intent. The identical shape is what
`@objectstack/metadata` graduated on (20 of them, `(evt) => arr.push(evt)` in a
watcher slot).

⛔ The spec contract is untouched: `PubSubHandler` returning `void | Promise<void>`
is correct and deliberate (the union is what lets a driver `await` an async
handler). The defect was in the test, so the test is where it is fixed — no
consumer-side widening, no source signature change.

Wired by the route the `packages/plugins/**` family settled on in #14062: a
sibling `tsconfig.test.json` that changes **module semantics only** (`esnext` /
`bundler` / `lib: ES2022`, matching how vitest actually executes these files)
with **strictness inherited and untouched**, named by a new `typecheck` script
through the shared `check:test-typecheck` gate. Measured before the repair: 1
error under build semantics, 1 under the new config — the two readings agree, so
this package carried no config-tier pile. After: 0 and 0, across a 410-file
program covering all 7 of its `src/**/*.test.ts`.

No `test-typecheck-debt.json` is added, and its **absence is the zero**: the gate
reads a missing ledger as `{ entries: {} }`, under which any error in any file
here is red immediately. The package's `DEBT` entry in
`scripts/check-type-check-coverage.mjs` (`errors: 1`) is deleted in this PR
rather than lowered — that is the graduation the ratchet's own invariant
requires, and it is why the error was fixed rather than ledgered.

No runtime code changes: `src/**` (excluding tests) is byte-identical, so no
shipped behaviour moves. The `patch` level reflects the published `package.json`
gaining `typecheck` / `check:test-typecheck` scripts and a `tsx` devDependency.
