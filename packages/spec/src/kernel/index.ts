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
export * from './plugin-runtime.zod';
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
