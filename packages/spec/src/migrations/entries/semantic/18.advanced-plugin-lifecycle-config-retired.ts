// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'advanced-plugin-lifecycle-config-retired',
  surface:
    'kernel.advancedPluginLifecycle (the authorable config surface of '
    + '`plugin-lifecycle-advanced.zod.ts` — 3 defs, 9 exported names: '
    + '`AdvancedPluginLifecycleConfigSchema` / `AdvancedPluginLifecycleConfig` '
    + '/ `AdvancedPluginLifecycleConfigParsed`, `GracefulDegradationSchema` / '
    + '`GracefulDegradation` / `GracefulDegradationParsed`, '
    + '`PluginUpdateStrategySchema` / `PluginUpdateStrategy` / '
    + '`PluginUpdateStrategyParsed`)',
  replacement:
    '(removed — there is no declarative replacement, because nothing ever read '
    + 'the declaration. The supported lifecycle surface is the HOST-DRIVEN '
    + 'library in `@objectstack/core`: construct `PluginHealthMonitor` and '
    + 'pass a `PluginHealthCheck` per plugin, construct `HotReloadManager` and '
    + 'pass a `HotReloadConfig` — the `content/docs/protocol/kernel/'
    + 'lifecycle.mdx` examples (#11811) are the supported usage, and those '
    + 'input vocabularies (`PluginHealthStatus` / `PluginHealthCheck` / '
    + '`PluginHealthReport`, `HotReloadConfig` with its embedded '
    + '`DistributedStateConfig`, `PluginStateSnapshot`) SURVIVE in the same '
    + 'module as library parameter types. Degradation and update-strategy '
    + 'vocabularies return only via the ENFORCE route of ADR-0049 through a '
    + 'new ADR — the executor first, the vocabulary second)',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-08-25 on #11825 '
    + '(route 2). The container aggregated six config groups — `health`, '
    + '`hotReload`, `degradation`, `updates`, `resources`, `observability` — '
    + 'and NO group had a runtime reader, re-measured per group at the '
    + 'retirement\'s base commit (8cdd696) with positive controls: the kernel '
    + 'never constructs `PluginHealthMonitor` or `HotReloadManager` (only '
    + 'their own unit tests and `core/examples/phase2-integration.ts` do, '
    + 'passing config DIRECTLY to the classes, never through this container); '
    + '`degradation` / `updates` / `resources` / `observability` keys have no '
    + 'implementation body at all (controls: `checkMethod` resolves to '
    + '`core/src/health-monitor.ts` and `debounceDelay` to '
    + '`core/src/hot-reload.ts`, proving the scan sees real readers; the '
    + 'bare-name collisions — plugin-ordering\'s `optionalDependencies`, '
    + 'auth-manager\'s private `degradedFeatures`, plugin-security-advanced\'s '
    + '`resourceLimits.maxCpu` read by `sandbox-runtime.ts` — are different '
    + 'surfaces, verified structurally). No manifest, stack collection or '
    + 'metadata-type binding ever embedded the container, so no authored '
    + 'document could carry it: an author declaring `health: {...}` or '
    + '`rollback: { automatic: true }` got a clean parse and NOTHING — the '
    + '#3950 shape at container scale, sharpened by production-safety '
    + 'vocabulary (auto-restart, zero-downtime rolling updates, automatic '
    + 'rollback) an AI author (ADR-0033) reads as proof the capability '
    + 'exists. With no carrier key and no authored document there is nothing '
    + 'to tombstone and no seam for a D2 conversion: route 3, the #4834 / '
    + '#8715 shape — RETIRED_DEFS_BY_MAJOR plus this entry ARE the '
    + 'declaration.',
  acceptanceCriteria:
    'No code imports any of the 9 retired names from `@objectstack/spec` or '
    + '`@objectstack/spec/kernel` — every one is TS2305 after upgrade, on '
    + 'every public entry (pinned by resolved symbol identity in '
    + '`kernel/plugin-lifecycle-advanced-retirement.test.ts`). No metadata '
    + 'document needs editing: the container was reachable from no '
    + 'metadata-type binding, stack collection or manifest embed, so no '
    + 'document could ever carry it. The host-driven library vocabularies '
    + 'survive unchanged on `./kernel` (`PluginHealthStatusSchema`, '
    + '`PluginHealthCheckSchema`, `PluginHealthReportSchema`, '
    + '`HotReloadConfigSchema`, `DistributedStateConfigSchema`, '
    + '`PluginStateSnapshotSchema` — same pin), and `PluginHealthMonitor` / '
    + '`HotReloadManager` stay exported from `@objectstack/core` with their '
    + 'tests green. ⚠️ Runtime behaviour is deliberately UNCHANGED: nothing '
    + 'ever read the container, so removing it removes no behaviour.',
};
