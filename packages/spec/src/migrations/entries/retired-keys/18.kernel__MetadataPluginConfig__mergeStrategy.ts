// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13135 — ADR-0049 enforce-or-remove (maintainer ruling 2026-08-29 on
// #12057, adopting retirement; re-charter #13135 executes the widened
// surface). `mergeStrategy` embedded the paper protocol's
// `MergeStrategyConfigSchema` (keep-custom / accept-incoming /
// three-way-merge) and was read by NOTHING: no 3-way merge engine ever
// existed, and package upgrades do not merge customizations — ADR-0126 §6
// wall 3 separates the packaged BASE (upgrades rewrite it) from the
// customer's recorded choices (never touched by an upgrade). The value
// schema leaves with its module (`kernel/metadata-customization.zod.ts`,
// `RETIRED_DEFS_BY_MAJOR[18]`). NOT the same surface as the inline
// three-value `mergeStrategy` vocabulary on `api/PackageUpgradeRequest` /
// `kernel/UpgradePackageRequest` — those are separately declared twins that
// never imported the module and are deliberately untouched here.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look
// (the #8586 precedent).
//
// Registered here but NOT in `src/conversions/registry.ts` — the
// `kernel/MetadataPluginConfig:additionalTypes` reasoning: a metadata-plugin
// config is not a stack collection member, so a MetadataConversion would be
// a transform with no seam that ever runs. The prescription reaches authors
// through the tombstone (`tsc` + the parse) and the D3 semantic entry
// `metadata-customization-protocol-retired`.
export const entry = 'kernel/MetadataPluginConfig:mergeStrategy';
