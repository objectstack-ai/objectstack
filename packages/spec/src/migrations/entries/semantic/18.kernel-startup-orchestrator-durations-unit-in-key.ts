// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'kernel-startup-orchestrator-durations-unit-in-key',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface: 'the three startup-orchestration durations whose name carried no unit: '
    + 'StartupOptions.timeout, PluginStartupResult.duration and '
    + 'StartupOrchestrationResult.totalDuration (kernel/startup-orchestrator.zod.ts)',
  replacement: 'timeoutMs, durationMs and totalDurationMs — rename each key; every value is '
    + 'unchanged, and so is the 30000 default on StartupOptions',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'These three are one entry because they are one boundary: a host passes StartupOptions '
    + 'in, and the orchestrator hands PluginStartupResult and StartupOrchestrationResult back '
    + 'from the same call. The file already contained its own counter-example — '
    + 'IStartupOrchestrator.startWithTimeout(plugin, context, timeoutMs) named its parameter '
    + 'timeoutMs while the options object beside it said timeout, so one contract carried both '
    + 'conventions and the suffixed one was already the honest half. totalDuration is the sum '
    + 'of the per-plugin durations, so the two had to move together or the aggregate would '
    + 'have been spelled unlike its parts. All three are retiredKey() tombstones; none of '
    + 'these shapes is strict, so a bare deletion would strip in silence. Why a semantic entry '
    + 'and not a D2 conversion: StartupOptions is a boot-time call argument and the two result '
    + 'shapes are emitted measurements, so none is ever a stack collection member or a stored '
    + 'sys_metadata row and the conversion chain has no seam that would see one — the same '
    + 'disposition HealthStatus.timestamp took on this very file '
    + '(epoch-instant-keys-renamed), and what ruling B prescribes for a runtime-emitted key. '
    + '#15678, #14478, ADR-0087.',
  acceptanceCriteria:
    'Host boot code calling orchestrateStartup(plugins, options) spells timeoutMs; every '
    + 'implementation that BUILDS a PluginStartupResult spells durationMs and every one that '
    + 'builds a StartupOrchestrationResult spells totalDurationMs. Authoring any old spelling '
    + 'fails to compile (input type `never`) and fails to parse with the rename prescription. '
    + 'Behaviour is unchanged in every case: an orchestrator given `timeoutMs: 5000` waits '
    + 'five seconds per plugin exactly as `timeout: 5000` did, an omitted key still defaults '
    + 'to 30000, and the non-negative bounds ride along with the renamed keys so a negative '
    + 'timeout or a negative duration is still refused. One thing this rename deliberately '
    + 'does NOT touch: packages/core/src/plugin-loader.ts declares its own local '
    + 'PluginStartupResult interface — a different type, carrying startTime rather than any '
    + 'duration key — which is not a reader of this schema and is unchanged.',
};
