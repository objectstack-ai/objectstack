// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13135 — ADR-0049 enforce-or-remove (maintainer ruling 2026-08-29 on
// #12057, adopting retirement; re-charter #13135 executes the widened
// surface). `persistence.overlayWritable` gated exactly one method —
// `MetadataManager.saveOverlay()` — which belonged to the paper
// metadata-customization protocol removed whole in the same change: no route
// ever served the paper `…/overlay` endpoints, no UI called the method, and
// its only callers were `packages/metadata`'s own unit tests. With the limb
// gone the flag gates nothing. The base write gate `persistence.writable`
// stays; the real org-overlay writes (ADR-0005) ride the REST meta write
// doors' `manage_metadata` permission gate, not this flag.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look
// (the #8586 precedent).
//
// Registered here but NOT in `src/conversions/registry.ts` — the
// `kernel/MetadataPluginConfig:additionalTypes` reasoning: a
// metadata-manager config is not a stack collection member, so a
// MetadataConversion would be a transform with no seam that ever runs. The
// prescription reaches authors through the tombstone (`tsc` + the parse) and
// the D3 semantic entry `metadata-customization-protocol-retired`.
export const entry = 'kernel/MetadataManagerConfig:persistence.overlayWritable';
