// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11825 — `kernel/PluginUpdateStrategy` left with
// `kernel/AdvancedPluginLifecycleConfig`: its ONLY consumer was the retired
// container's `updates` key (the #3950 rule — an exported value schema with
// no consumer reads as a capability). NO implementation body exists for any
// of its keys — `mode`, `autoUpdateConstraints`, `schedule`, `rollback`,
// `validation` were never read by anything in objectstack or objectui
// (measured with positive controls; `checkCompatibility` on
// `AppLifecycleService` is a different surface, verified structurally). The
// sharpest face: `rollback: { automatic: true, keepVersions: 3 }` promised
// zero-downtime rolling updates and automatic rollback-on-failure that
// nothing implements — production-safety vocabulary an author (very often an
// AI, ADR-0033) reads as proof the capability exists. The vocabulary returns
// only via the ENFORCE route of ADR-0049 through a new ADR — the
// implementation first. See `18.kernel__AdvancedPluginLifecycleConfig.ts`
// for the family record.
export const entry = 'kernel/PluginUpdateStrategy';
