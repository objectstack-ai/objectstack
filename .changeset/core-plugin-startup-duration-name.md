---
"@objectstack/core": minor
---

Plugin startup elapsed time is now reported as `duration` — the name the spec contract for the same result already declares. `startTime`, which never held a start time, is deprecated and still populated.

`PluginStartupResult.startTime` (`packages/core/src/plugin-loader.ts`) has always been assigned `Date.now() - startTime`, an elapsed duration, on both the success and the failure path. The name therefore asserts the opposite of the value: a reader who correctly takes `startTime` for an instant and writes `Date.now() - result.startTime` gets an age near the epoch rather than a wait. That is the one failure mode a unit convention cannot rescue — an ambiguous name makes someone stop and check, this one lets them proceed confidently wrong.

This is not a naming preference but a divergence between what is declared and what is enforced. `packages/spec/src/kernel/startup-orchestrator.zod.ts` declares `duration: z.number().min(0)` — "Time taken to start the plugin in milliseconds" — for the very result this interface implements, so the contract was already correct and `packages/core` had drifted away from it. The right spelling is also twelve lines above the defect in the same file: `PluginLoadResult.loadTime` carries the identical `Date.now() - startTime` computation under a name that does not lie.

Three sites move, and every one of them is additive — nothing is removed, so no consumer has to change anything on this release:

- `PluginStartupResult` gains `duration?: number`. `startTime?: number` stays, still carrying the same value, marked `@deprecated` with a doc comment that states plainly it is elapsed milliseconds and not an instant.
- `ObjectKernel.getPluginStartupDurations()` is added; `getPluginMetrics()` becomes a `@deprecated` delegating alias returning the same map.
- The private `pluginStartTimes` map is renamed `pluginStartupDurations` (private; no reader outside `kernel.ts` in this repo or in the pinned `objectui` sibling).

Migration, where you want it: read `result.duration` where you read `result.startTime`, and `kernel.getPluginStartupDurations()` where you called `kernel.getPluginMetrics()`. The values are identical, so the change can be made at leisure; both old spellings keep working until they are removed.

ADR-0087 disposition: no migration-ledger entry, and none is required. Nothing is retired by this release — the old member and the old method both remain, populated and callable, which is ADR-0087's L1 outcome (the old shape keeps loading while the fleet moves) rather than a retirement. There is also nothing for `objectstack migrate meta` to rewrite: `packages/core/src/plugin-loader.ts#PluginStartupResult` is a runtime TypeScript interface with no Zod schema, no `packages/spec` declaration and no stored representation — the `PluginStartupResult` in `packages/spec/src/kernel/startup-orchestrator.zod.ts` is a separate, differently-shaped declaration that this change does not touch. When the deprecated spellings are removed, that removal is the change that carries the ledger disposition.
