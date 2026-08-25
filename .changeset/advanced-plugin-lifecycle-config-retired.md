---
"@objectstack/spec": minor
---

feat(spec): retire the authorable `AdvancedPluginLifecycleConfig` surface; the lifecycle classes stay as a host-driven library (#11825, ADR-0049)

<!-- adr-0087: registered advanced-plugin-lifecycle-config-retired -->

**BREAKING** export removal, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the prescription is registered
under protocol major 18 — `RETIRED_DEFS_BY_MAJOR[18]` + the D3 semantic entry
`advanced-plugin-lifecycle-config-retired` — where `os migrate meta` users
will look).

`AdvancedPluginLifecycleConfigSchema` aggregated six lifecycle config groups —
`health`, `hotReload`, `degradation`, `updates`, `resources`,
`observability` — and NO group had a runtime reader, re-measured per group at
the retirement's base commit with positive controls: the kernel never
constructs `PluginHealthMonitor` or `HotReloadManager` (only their own unit
tests and `core/examples/phase2-integration.ts` do, passing config DIRECTLY
to the classes, never through this container); the `degradation` / `updates`
/ `resources` / `observability` keys have no implementation body at all; and
no manifest, stack collection or metadata-type binding ever embedded the
container, so no authored document could carry it. An author declaring
`health: {...}` or `rollback: { automatic: true }` got a clean parse and
NOTHING — the #3950 shape at container scale, sharpened by production-safety
vocabulary (auto-restart, zero-downtime rolling updates, automatic rollback)
an AI author reads as proof the capability exists.

FROM → TO:

- `AdvancedPluginLifecycleConfigSchema` / `AdvancedPluginLifecycleConfig` /
  `AdvancedPluginLifecycleConfigParsed` → *(removed — no replacement
  container)*. The supported lifecycle surface is the host-driven library in
  `@objectstack/core`: construct `PluginHealthMonitor` and pass a
  `PluginHealthCheck`, construct `HotReloadManager` and pass a
  `HotReloadConfig` (the `content/docs/protocol/kernel/lifecycle.mdx`
  examples, #11811, are the supported usage).
- `GracefulDegradationSchema` / `GracefulDegradation` /
  `GracefulDegradationParsed` and `PluginUpdateStrategySchema` /
  `PluginUpdateStrategy` / `PluginUpdateStrategyParsed` → *(removed)* — value
  schemas whose only consumer was the retired container; no implementation
  body exists for any of their keys. They return only via the ENFORCE route
  of ADR-0049 through a new ADR — the executor first, the vocabulary second.

One-line fix: delete the config object (it configured nothing); if you drive
the library classes yourself, keep passing `PluginHealthCheck` /
`HotReloadConfig` directly — those vocabularies survive unchanged.

The retirement kit:

- whole-def deletion (route 3 — no carrier key, no authored document, so no
  tombstone and no D2 conversion; the #8715 `identity/ApiKey` shape):
  `kernel/AdvancedPluginLifecycleConfig`, `kernel/GracefulDegradation`,
  `kernel/PluginUpdateStrategy` in `RETIRED_DEFS_BY_MAJOR[18]`, plus the D3
  semantic entry `advanced-plugin-lifecycle-config-retired`
- pin test (`kernel/plugin-lifecycle-advanced-retirement.test.ts`): zero
  holders for all 9 retired names on every public entry, survivors pinned
  (`PluginHealthStatus` / `PluginHealthCheck` / `PluginHealthReport`,
  `HotReloadConfig` + `DistributedStateConfig`, `PluginStateSnapshot` — the
  kept host-driven library vocabularies)
- zero authored occurrences in objectstack or objectui (measured at
  dispatch, re-verified per group), so no in-repo source changes ride along;
  `@objectstack/core` classes and tests are untouched and stay green
