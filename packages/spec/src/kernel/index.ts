// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export * from './cli-extension.zod';
export * from './cluster.zod';
export * from './context.zod';
export * from './dependency-resolution.zod';
// dev-plugin.zod (DevPluginConfigSchema / DevServiceOverrideSchema /
// DevFixtureConfigSchema / DevToolsConfigSchema / DevPluginPreset) was REMOVED
// per ADR-0049 enforce-or-remove (#4149): the whole family had zero consumers —
// @objectstack/plugin-dev reads its own DevPluginOptions and never imported it,
// no load path parsed it (`stack.devPlugins` takes ManifestSchema | string, not
// this config), and none of the declared surfaces (presets, fixtures, dev-tools
// dashboard, per-service strategies, simulated latency) were ever implemented.
// Its `strategy: 'stub'` vocabulary described the dev-stub design ADR-0115
// retired. The real dev assembly contract is plugin-dev's DevPluginOptions.
export * from './events.zod';
// feature.zod (FeatureFlagSchema / FeatureStrategy / FeatureFlag factory) was
// REMOVED per ADR-0056 D8: zero runtime consumers, and its only protocol home —
// the static ObjectStackCapabilities.system.features descriptor — was itself
// removed as dead (#3605). Live toggles are the `feature_flags` settings
// manifest (ADR-0007, env-overridable via OS_FEATURE_FLAGS_*) and the
// PUBLIC_AUTH_FEATURES registry (public-auth-features.ts) for auth gates.
export * from './manifest.zod';
export * from './metadata-customization.zod';
export * from './namespace-prefix';
export * from './platform-capabilities';
export * from './metadata-loader.zod';
export * from './metadata-plugin.zod';
export * from './metadata-protection.zod';
// The read path's OWN annotations (`_diagnostics`, `_draft`) — the underscore
// keys that, unlike the protection envelope above, must never survive back into
// a persisted body or a strict re-parse (#4326, cloud#971).
export * from './metadata-read-decorations';
export * from './metadata-type-schemas';
// Pre-parse unknown-key walker over EVERY metadata collection (#3786). Lives
// here, not in data/, because covering every type means importing every schema.
export * from './metadata-authoring-lint';
export * from './package-artifact.zod';
export * from './package-registry.zod';
export * from './package-upgrade.zod';
export * from './plugin-capability.zod';
export * from './plugin-lifecycle-advanced.zod';
export * from './plugin-loading.zod';
// plugin-loading.zod's CONFIGURATION half (PluginLoadingConfigSchema +
// PluginLoadingStrategySchema / PluginPreloadConfigSchema /
// PluginCodeSplittingSchema / PluginDynamicImportSchema /
// PluginInitializationSchema / PluginDependencyResolutionSchema /
// PluginHotReloadSchema / PluginCachingSchema / PluginSandboxingSchema /
// PluginPerformanceMonitoringSchema + every type alias) was REMOVED per ADR-0049
// enforce-or-remove (#4914), together with the `Manifest.loading` key that was
// its only carrier — that key is now a `retiredKey()` tombstone in
// `manifest.zod.ts`, because `ManifestSchema` is not `.strict()` and a plain
// deletion would strip it in silence.
//
// The block declared a full loading policy — lazy/eager strategy, preloading,
// code splitting, dynamic import, initialization, dependency resolution, hot
// reload, caching, sandboxing and performance budgets — and NOTHING read it. A
// bare-name scan of objectstack, cloud and objectui (each with a control probe)
// put every hit inside `packages/spec` itself. `manifest.loading.*` had zero
// readers in `packages/core`, `packages/runtime` and `packages/metadata`.
//
// `sandboxing` is why this outranked ordinary inert-key cleanup: it declared
// process/vm/iframe/web-worker isolation, IPC transports and an `allowedServices`
// ACL, so an AI author (ADR-0033) reading it concluded the platform sandboxes
// plugins, wrote the config, and got a clean parse and zero isolation. An inert
// security control is worse than an absent one because it is believed.
//
// Hot reload converges on ONE vocabulary (ruling §2): the surviving side is
// `HotReloadConfigSchema` in `plugin-lifecycle-advanced.zod.ts`, which is the one
// `HotReloadManager` (`packages/core/src/hot-reload.ts`) reads. It has an
// implementation body but no runtime composes it yet — kept as the starting
// point for a future enforce decision, which is deliberately NOT this change.
//
// What survives here is only the observational half (`PluginLoadingEventSchema`,
// `PluginLoadingStateSchema`).
// plugin-runtime.zod (DynamicLoadRequestSchema / DynamicUnloadRequestSchema /
// DynamicPluginResultSchema / PluginSourceSchema / DynamicPluginOperationSchema
// + every type alias) was REMOVED per ADR-0049 enforce-or-remove (#4834). The
// module declared the "Dynamic Loading" capability — runtime load / unload /
// reload of plugins without a kernel restart, with sandboxing, integrity hashes,
// drain strategies and dependent-cascade policy. No runtime in any repo
// (objectstack / cloud / objectui) ever received a DynamicLoadRequest, performed
// a load/unload, or produced a DynamicPluginResult: the operations the vocabulary
// names do not exist. Plugins are composed at boot (`defineStack` → the kernel's
// register/init/start sequence) and the set is fixed until the process restarts.
//
// The #3896 follow-up removed this module's discovery/sandbox config island and
// recorded the remaining five as a deliberate SUSPENSION ("operation contracts,
// not security promises; the enforce-or-remove call is a design decision") — a
// decision that then lived only in a changeset paragraph, with no issue carrying
// it. #4834 IS that decision, resolved REMOVE: a published request/result
// vocabulary with no server behind it is the #3950 shape at its most inviting to
// an AI author (ADR-0033), who reads `DynamicLoadRequestSchema` as proof the
// platform hot-loads plugins and builds a request that parses clean and is
// received by nobody.
//
// This SUPERSEDES the narrower #4657 retirement of
// `DynamicLoadRequest.activationEvents`: that key's `retiredKey()` tombstone is
// removed together with the shape that carried it, because "the whole request
// shape is gone" is strictly stronger than "this one key is gone" — an author
// who wrote `activationEvents` now deletes the entire `DynamicLoadRequest`
// value, not one key of it. The studio half of #4657
// (`StudioPluginManifest.activationEvents`) is untouched and still rejects the
// key with its own prescription.
//
// Runtime plugin loading, if it is ever built, returns via the enforce route of
// ADR-0049 through a new ADR — write the loader first, then declare exactly the
// operations it performs. The vocabulary it needs is unlikely to be this one.
export * from './plugin-security-advanced.zod';
export * from './plugin-structure.zod';
export * from './plugin-validator.zod';
export * from './plugin-versioning.zod';
export * from './protocol-version';
export * from './plugin.zod';
export * from './public-auth-features';
export * from './service-registry.zod';
export * from './startup-orchestrator.zod';
export * from './plugin-registry.zod';
export * from './plugin-security.zod';
export * from './execution-context.zod';
export * from './metadata-create-seeds';
export * from './functional-completeness';
