// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15932 — ADR-0049 enforce-or-remove, decision batch #65.
// `PluginSecurityManifest.vulnerabilities` was an array of
// `KernelSecurityVulnerability` and is this retirement's FORCED CONSEQUENCE
// rather than a name the ruling listed: it was the last authorable referent of a
// def the ruling retires by name, so it cannot survive the def, and keeping the
// def alive only to carry it would be keeping the retired family alive under a
// second name. It is inert on its own terms too — nothing ever wrote the list and
// nothing ever read it, so declaring a known vulnerability against a plugin
// warned nobody and blocked no install.
//
// ⚠️ This is the ONE key outside the four names the #15932 dispatch fenced
// (`KernelSecurityScanResult`, `KernelSecurityVulnerability`,
// `PluginSecurityManifest.scanResults`, `PluginQualityMetrics.securityScan`), and
// it is reported as such on the card and in the landing PR rather than absorbed
// silently. It is not a neighbour retired by proximity — the fence's stated
// concern — it is a referent of a named retiree.
//
// Tombstoned with `retiredKey()` for the reason its `scanResults` sibling records
// (non-strict shape, ADR-0104 silent strip). No D2 conversion, same reasoning.
export const entry = 'kernel/PluginSecurityManifest:vulnerabilities';
