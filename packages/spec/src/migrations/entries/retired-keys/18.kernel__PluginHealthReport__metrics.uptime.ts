// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B. `PluginHealthReport.metrics.uptime`
// said "Plugin uptime in milliseconds" in prose and nothing else, while this
// same platform serves a SECONDS-valued `uptime` on `GET /health` (the protocol
// lifecycle page had to spend a paragraph telling the two apart). Renamed to
// `uptimeMs`; the value is unchanged. Tombstoned with `retiredKey()` inside the
// live `metrics` block — a tombstone whose siblings must keep parsing. No D2
// conversion: a health report is emitted by the monitor at runtime
// (`packages/core/src/health-monitor.ts`), never authored. See
// `kernel-plugin-health-report-durations-unit-in-key`.
export const entry = 'kernel/PluginHealthReport:metrics.uptime';
