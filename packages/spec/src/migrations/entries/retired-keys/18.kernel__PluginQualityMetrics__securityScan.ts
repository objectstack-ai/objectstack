// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15932 — ADR-0049 enforce-or-remove (director seat, decision batch #65,
// 2026-09-07, maintainer verbatim 「同意」). `PluginQualityMetrics.securityScan` is
// the scan-result family's sibling on the plugin registry entry, named by the
// ruling alongside it: a last-scan date, per-severity vulnerability counts and a
// `passed` boolean, read by no scanner, registry, installer or UI. The census put
// every reference in `packages/spec/src/kernel/plugin-registry.test.ts` — the
// spec's own self-test and nothing else.
//
// It is the sharper half of the family for an author: `scanResults` published a
// report, but `securityScan.passed` published a VERDICT, so a plugin could ship
// `passed: true` with nothing at all behind it and a consumer reading the
// registry entry had no way to tell that from a real result.
//
// Tombstoned with `retiredKey()`: `PluginQualityMetricsSchema` is a plain
// `z.object`, so a bare deletion would strip an authored block in silence
// (ADR-0104). The key carried NO default of its own — the defaults inside it
// (`critical`/`high`/`medium`/`low = 0`, `passed = false`) fired only for an
// author who wrote the block — so `acceptRetiredDefaultResidue` is not owed:
// there is no value a released toolchain materialized into an artifact whose
// author never typed the key.
//
// No D2 conversion: a plugin registry entry is a published package artifact, not
// a stack collection member or a stored `sys_metadata` row. The ledger channel is
// `plugin-security-scan-result-surface-retired`.
export const entry = 'kernel/PluginQualityMetrics:securityScan';
