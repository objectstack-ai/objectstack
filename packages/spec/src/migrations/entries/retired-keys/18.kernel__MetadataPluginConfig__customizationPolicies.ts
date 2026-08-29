// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13135 — ADR-0049 enforce-or-remove (maintainer ruling 2026-08-29 on
// #12057, adopting retirement; re-charter #13135 executes the widened
// surface). `customizationPolicies` embedded the paper metadata-customization
// protocol's `CustomizationPolicySchema` (lockedFields / customizableFields
// whitelists) and was read by NOTHING: no code ever consulted a policy before
// accepting or refusing a customization, and the protocol it configured —
// the three-layer overlay of `kernel/metadata-customization.zod.ts`, removed
// whole in the same change (see `RETIRED_DEFS_BY_MAJOR[18]`) — was itself
// unreachable from any served surface. ADR-0126 §6 wall 4 supersedes the
// protocol on the record ("nothing may build against it"). What a
// customization may touch is governed by ADR-0005's org overlay
// (`allowOrgOverride`) and ADR-0126's packaged-metadata model.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8586 precedent).
//
// Registered here but NOT in `src/conversions/registry.ts`, for the reason
// the sibling `kernel/MetadataPluginConfig:additionalTypes` entry gives: the
// conversion chain walks a normalized STACK and
// `applyConversionsToStoredItem` maps a metadata type onto one of its
// collections. A metadata-plugin config is neither — there is no `plugins`
// entry in `PLURAL_TO_SINGULAR`, so a MetadataConversion here would be a
// transform with no seam that ever runs. The prescription reaches authors
// through the tombstone (`tsc` + the parse) and the D3 semantic entry
// `metadata-customization-protocol-retired`.
export const entry = 'kernel/MetadataPluginConfig:customizationPolicies';
