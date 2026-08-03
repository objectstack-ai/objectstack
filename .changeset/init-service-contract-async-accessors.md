---
---

chore(devx): `check:init-service-contract` now sees every service accessor, not just `getService` (#4835)

Releases nothing — the change is confined to `scripts/check-init-service-contract.mjs`.

The #4471 / ADR-0116 guard asks one question: does a plugin resolve, during
`init()`, a service another workspace plugin provides, without declaring the
ordering? It asked that question of exactly one accessor:

```js
if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'getService') {
```

The kernel has three. `getServiceAsync` (`ObjectKernel`, `packages/core/src/kernel.ts`)
and `getServiceScoped` (`PluginContext`, `packages/core/src/types.ts`) both resolve
a named service out of the same registry — `getServiceScoped`'s kernel body is the
same `pluginLoader.getService(name, scopeId)` call `getServiceAsync` makes. The
ordering hazard is a property of the registry, not of a method name, and ADR-0116's
`dependencies` / `optionalDependencies` / `requiresServices` apply to all three
identically. The guard saw one.

**#4772 is what went through the gap.** Pre-fix `AuthPlugin.init()`
(`f2eb85007^`) resolved the workspace-provided `cache` service with
`await (ctx as { getServiceAsync?: … }).getServiceAsync?.('cache')` while
declaring `requiresServices = ['data', 'manifest']` and depending only on
objectql — textbook undeclared init-time consumption, and precisely the verdict
this guard exists to print. It never constructed the edge. The cost: `undefined`
frozen into the better-auth config on a 21ms ordering margin, rate-limit counters
that never reached the shared store, and ADR-0069 D2 advertising a capability the
runtime did not deliver.

The vocabulary is now a named set (`SERVICE_LOOKUP_CALLEES`) with membership
argued per accessor, and the file pre-filter derives from it rather than hardcoding
a substring that only happens to cover today's three names. `hasService` is
deliberately **out**: `ObjectKernel.hasAnyService` is private and
`PluginLoader.hasService` is only reachable from a loader instance the kernel never
hands a plugin, so adding it would flag unrelated objects while covering no real
edge. `getServices()` (no service-name argument) and `replaceService` (a mutation,
different remedy) are out for their own stated reasons.

Two things follow from a widened vocabulary:

- **`--list` stopped lying.** Every edge printed its call site as `getService('X')`
  regardless of which accessor made it. Each edge now records its accessor and both
  `--list` and the failure message quote it as written.
- **The self-test proves both directions.** A guard only ever observed green is
  indistinguishable from a guard that matches nothing (#4690, #4804). Cases 13-19
  include the #4772 pre-fix shape verbatim — optional call, cast `ctx`, best-effort
  `try/catch` — and assert it is caught, that the message names the plugin, the
  provider and the call's line, and that `start()` and declared coverage still pass.
  Narrowing the set back to `['getService']` turns case 13 red.

The repo audit stays green: today's `getServiceAsync` call sites
(`rest/src/rest-server.ts`, `runtime/src/http-dispatcher.ts`,
`runtime/src/dispatcher-plugin.ts`) are all on request-time paths, in no plugin's
`init()`. This closes a latent hole, it does not report an existing one.
