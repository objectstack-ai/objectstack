// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11825 — kernel/plugin-lifecycle-advanced.zod.ts
// `AdvancedPluginLifecycleConfigSchema`, retired whole (ADR-0049
// enforce-or-remove; maintainer ruling 2026-08-25, route 2). The aggregating
// `{ health, hotReload, degradation, updates, resources, observability }`
// lifecycle-config container had ZERO runtime readers, re-measured per group
// at the retirement's base commit with positive controls: the kernel never
// parses, stores or forwards it; no manifest, stack collection or
// metadata-type binding embeds it (no authored document could carry it); and
// a scan of objectstack + objectui put every reference inside `packages/spec`
// itself. The classes with implementation bodies — `PluginHealthMonitor` and
// `HotReloadManager` in `@objectstack/core` — are KEPT as host-driven library
// (the #11811 lifecycle.mdx examples are the supported usage), and their
// input vocabularies (`PluginHealthCheck`, `PluginHealthStatus`,
// `PluginHealthReport`, `HotReloadConfig`, `DistributedStateConfig`,
// `PluginStateSnapshot`) survive in the same module; but neither class is
// composed by any runtime, and both take their config DIRECTLY — never
// through this container. An author declaring `health: {...}` or a rollback
// policy here got a clean parse and NOTHING — the #3950 shape at container
// scale. Route 3: no carrier key, no authored document for a D2 conversion to
// rewrite, so no tombstone and no conversion — this table plus the D3
// semantic entry `advanced-plugin-lifecycle-config-retired` ARE the
// declaration.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8586 / PR #8702 precedent).
export const entry = 'kernel/AdvancedPluginLifecycleConfig';
