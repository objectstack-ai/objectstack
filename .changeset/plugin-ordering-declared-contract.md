---
"@objectstack/core": minor
"@objectstack/spec": minor
"@objectstack/runtime": minor
"@objectstack/objectql": patch
"@objectstack/metadata": patch
---

feat(core,runtime): plugin ordering is a declared, kernel-enforced contract (ADR-0116, #4131)

`kernel.use()` registration order was never a contract — the kernel resolves
init/start order from the plugin dependency graph — but a plugin that needed a
service at init *when its provider is composed* while also booting *without*
the provider had no way to declare that. `AppPlugin` was the standing example:
it grabs `manifest`/`objectql` synchronously in `init()`, declared nothing
(a hard dependency would break empty-env / metadata-only / mock-engine
kernels), and so its correctness rode on which array slot each caller put it
in. That convention failed the same way twice (`DefaultDatasourcePlugin`'s
first cut; then #4085, disguised for months as "crashes when the artifact is
missing").

The kernel `Plugin` contract gains three additive fields, enforced by both
`ObjectKernel` and `LiteKernel` through one shared implementation
(`plugin-order.ts` — the previously duplicated topological sort is unified
there):

- **`optionalDependencies: string[]`** — order-if-present: hoisted ahead
  exactly like `dependencies` when composed (real topology edges, including
  cycle detection), silently skipped when absent.
- **`requiresServices: string[]`** — services resolved synchronously during
  `init()` with no fallback. Validated **before Phase 1**: a required service
  whose only declared provider initializes later fails the boot with an error
  naming both plugins, both slots, and the fix — before any init side
  effects. Re-checked immediately before the plugin's own init, where a still-
  missing service becomes a named composition error exactly where the old
  bare `Service not found` crash fired.
- **`providesServices: string[]`** — services a plugin's `init()`
  unconditionally registers; powers the validation and the diagnostics.

Plugins that declare nothing get the diagnosis too: a `getService` miss
during Phase 1 now appends which plugin was initializing and — when a
composed plugin declares the service — who provides it and how to declare the
ordering. The `Service '<name>' not found` prefix and the factory-backed
`is async - use await` message are unchanged.

First adopters: `AppPlugin` declares
`optionalDependencies: ['com.objectstack.engine.objectql']` +
`requiresServices: ['manifest']` (cleared on the empty-env no-op path), so
the #4085 composition — AppPlugin registered before the engine — now boots
correctly in every slot; `ObjectQLPlugin` declares
`providesServices: ['objectql', 'data', 'manifest', 'lifecycle']` and
`MetadataPlugin` declares `providesServices: ['metadata']`.

Everything is additive — plugins that declare nothing keep their exact
ordering semantics; no existing declaration changes meaning.
