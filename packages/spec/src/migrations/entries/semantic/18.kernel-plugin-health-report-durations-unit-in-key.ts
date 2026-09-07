// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'kernel-plugin-health-report-durations-unit-in-key',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface: 'the two plugin health-report metrics whose name carried no unit: '
    + 'PluginHealthReport.metrics.uptime and PluginHealthReport.metrics.responseTime '
    + '(kernel/plugin-lifecycle-advanced.zod.ts)',
  replacement: 'uptimeMs and responseTimeMs — rename each key; both values are unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'uptime is the case this rule was written for, and this repo had already paid for it in '
    + 'documentation: the platform serves a SECONDS-valued uptime on GET /health and stores a '
    + 'MILLISECONDS-valued uptime on this report, so the protocol lifecycle page carried a '
    + 'standing paragraph whose whole job was telling the two apart ("metrics.uptime is in '
    + 'milliseconds, unlike the seconds-valued uptime of GET /health above"). A prose warning '
    + 'that has to exist is the symptom; the key name is where the fix belongs. responseTime '
    + 'moves with it because it is a sibling in the same metrics block and because the '
    + 'identical bare name means HOURS on '
    + 'PluginSecurityManifest.vulnerabilityDisclosure.responseTime, renamed by this same card. '
    + 'The other metrics keep their names, deliberately: memoryUsage is bytes, cpuUsage is a '
    + 'percentage, activeConnections is a count and errorRate is a rate — none is a duration, '
    + 'and this rule reaches durations only. Both are retiredKey() tombstones inside the live '
    + 'metrics block, whose siblings must keep parsing. Why a semantic entry and not a D2 '
    + 'conversion: a health report is EMITTED by the monitor each round '
    + '(packages/core/src/health-monitor.ts) and kept in memory — never authored into a '
    + 'metadata document, never a stored sys_metadata row — so the conversion chain has no '
    + 'seam that would see one, the same disposition HealthStatus.timestamp took '
    + '(epoch-instant-keys-renamed). #15678, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every producer of a PluginHealthReport spells uptimeMs and responseTimeMs — concretely '
    + 'packages/core/src/health-monitor.ts, the one production writer, whose metrics block now '
    + 'reads `uptimeMs: Date.now() - startTime`. Every consumer reading result.metrics?.uptime '
    + 'moves to result.metrics?.uptimeMs. Authoring either old spelling fails to compile '
    + '(input type `never`) and fails to parse with the rename prescription. Behaviour is '
    + 'unchanged: the value is still Date.now() - startTime in milliseconds, and a report that '
    + 'omits metrics entirely is still valid. ⚠️ Two identically-spelled keys NEARBY are not '
    + 'part of this and must not be renamed with it: the seconds-valued uptime of the '
    + 'GET /health response body, and the free-form HealthStatus.details record, which is a '
    + 'z.record whose contents this rule does not reach.',
};
