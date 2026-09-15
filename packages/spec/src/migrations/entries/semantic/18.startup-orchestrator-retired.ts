// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'startup-orchestrator-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the startup-ORCHESTRATION surface of kernel/startup-orchestrator.zod.ts and '
    + 'contracts/startup-orchestrator.ts — 3 emitted defs and 8 exported names: '
    + 'StartupOptionsSchema / StartupOptions / StartupOptionsParsed, '
    + 'HealthStatusSchema / HealthStatus, StartupOrchestrationResultSchema / '
    + 'StartupOrchestrationResult, and the IStartupOrchestrator interface '
    + '(orchestrateStartup / rollback / checkHealth / startWithTimeout). The '
    + 'startup RESULT survives, re-declared: PluginStartupResultSchema and '
    + 'PluginStartupResult stay on both entries',
  replacement:
    '(removed — there is no declarative replacement, because nothing ever '
    + 'implemented the interface or parsed the schemas. Plugin startup is the '
    + 'kernel own boot loop: ObjectKernel.start() calls startPluginWithTimeout() '
    + 'per plugin, which races that plugin start() against '
    + 'PluginMetadata.startupTimeout and, when KernelConfig.rollbackOnFailure is '
    + 'set, destroys the already-started plugins and rethrows the original error '
    + 'as the new error cause. So: instead of StartupOptions.timeoutMs declare '
    + 'startupTimeout on the plugin; instead of StartupOptions.rollbackOnFailure '
    + 'set rollbackOnFailure on the kernel config; instead of '
    + 'StartupOrchestrationResult.results read the per-plugin durations through '
    + 'ObjectKernel.getPluginStartupDurations(). StartupOptions.healthCheck and '
    + 'HealthStatus have NO replacement at all — no startup probe system exists, '
    + 'and one returns only through the enforce route of ADR-0049 with a new ADR, '
    + 'the probe first and the vocabulary second. StartupOptions.parallel and '
    + 'StartupOptions.context likewise: the kernel starts plugins sequentially '
    + 'and passes its own PluginContext)',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling on #16059 (director seat, '
    + 'decision batch #60, 2026-09-06). The module declared an orchestration '
    + 'design that never landed, and the spec and the kernel had already drifted '
    + 'into disagreement about the one shape that did: PluginStartupResultSchema '
    + 'described a plugin object, a required durationMs and a health member, '
    + 'while @objectstack/core shipped pluginName, an optional durationMs and '
    + 'timedOut. The ruling keeps a startup-result contract that describes what '
    + 'the kernel actually produces, and retires the rest. Re-measured on this '
    + 'card: zero implementers and zero consumers of the four retired surfaces in '
    + 'this repository and in the pinned objectui checkout, with lit same-corpus '
    + 'controls (defineStack, ManifestSchema); every remaining reference was a '
    + 'generated artifact or a released CHANGELOG.md. healthCheck and HealthStatus '
    + 'are the sharpest of the four: they name a per-plugin health probe the '
    + 'runtime has never had, which is the #3950 shape an AI author (ADR-0033) '
    + 'reads as proof the capability exists. With no authored document carrying '
    + 'any of the three defs there is no seam for a D2 conversion and no author to '
    + 'tombstone for: route 3, the #4834 / #11825 shape — RETIRED_DEFS_BY_MAJOR '
    + 'plus this entry ARE the declaration. The two keys of the SURVIVING result '
    + 'schema that leave (plugin, health) are tombstoned instead, and registered '
    + 'in RETIRED_KEYS_BY_MAJOR, because that def keeps emitting and its type is '
    + 'imported by @objectstack/core.',
  acceptanceCriteria:
    'No code imports any of the 8 retired names from @objectstack/spec, '
    + '@objectstack/spec/kernel or @objectstack/spec/contracts — every one is '
    + 'TS2305 after upgrade, pinned by resolved symbol identity in '
    + 'kernel/startup-orchestrator-retirement.test.ts. No metadata document needs '
    + 'editing: none of the three defs was reachable from a metadata-type '
    + 'binding, a stack collection or a manifest embed, so no authored document '
    + 'could ever carry one. PluginStartupResult SURVIVES on both entries with '
    + 'the shape the kernel ships — pluginName, success, optional durationMs, the '
    + 'deprecated startTime alias, the serializable error projection, timedOut — '
    + 'and @objectstack/core now imports that type instead of declaring a twin, '
    + 'so the drift cannot recur. Writing plugin or health on a PluginStartupResult '
    + 'is a tsc error and a parse error carrying the rename or the deletion. '
    + 'Runtime behaviour is deliberately UNCHANGED: nothing ever read the retired '
    + 'surfaces, and the kernel boot loop is untouched.',
};
