// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B. `PluginHealthReport.metrics.responseTime`
// said "Average response time in ms" in prose and nothing else. Renamed to
// `responseTimeMs`; the value is unchanged. Tombstoned with `retiredKey()`.
// ⚠️ Not to be confused with `PluginSecurityManifest.vulnerabilityDisclosure.responseTime`,
// the identically-named key this same card renames to `responseTimeHours` —
// same bare name, different unit, which is the confusion ruling B removes. No
// D2 conversion; `kernel-plugin-health-report-durations-unit-in-key` carries
// the prescription.
export const entry = 'kernel/PluginHealthReport:metrics.responseTime';
