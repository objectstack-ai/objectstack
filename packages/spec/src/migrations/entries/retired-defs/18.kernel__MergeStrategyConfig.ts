// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13135 — ADR-0049 enforce-or-remove (maintainer ruling 2026-08-29 on
// #12057: retirement adopted, re-scope rejected; re-charter #13135 executes
// the widened surface). Part of the whole-module removal of
// `kernel/metadata-customization.zod.ts` — the paper three-layer
// customization protocol ADR-0126 §6 wall 4 supersedes on the record
// ("nothing may build against it"). Zero reachable consumers, re-verified
// at the retirement's base commit with positive controls (#12057 fork
// report): the only implementation was `packages/metadata`'s manager limb,
// served by no route and called only by its own unit tests; the real
// mechanisms are ADR-0005's org overlay and ADR-0126's packaged-metadata
// model. This def: the merge-strategy config (`keep-custom`/`accept-incoming`/`three-way-
// merge` + path rules), embedded by the retired authorable key
// `MetadataPluginConfig.mergeStrategy` (see `RETIRED_KEYS_BY_MAJOR[18]`).
// NOT the inline three-value `mergeStrategy` vocabulary on
// `api/PackageUpgradeRequest` / `kernel/UpgradePackageRequest` — separately
// declared twins, untouched.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look. No carrier key survives for
// these defs and no authored document embedded them, so no tombstone and no
// D2 conversion — this table plus the D3 semantic entry
// `metadata-customization-protocol-retired` ARE the declaration (the #8715
// route-3 shape).
export const entry = 'kernel/MergeStrategyConfig';
