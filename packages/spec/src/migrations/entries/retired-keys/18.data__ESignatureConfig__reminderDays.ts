// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14477 — ADR-0049 enforce-or-remove. The 2026-09-02 ruling (ruled A: retire
// per family) held the `ESignatureConfig` pair on one condition — a roadmapped
// e-signature consumer would have earned an `[EXPERIMENTAL — not enforced]` tag
// instead — and the maintainer answered it on 2026-09-05 (decision batch #40:
// no roadmap), so the ruling's own branch resolves to retirement. A day-shaped
// interval key on the published authorable surface (`data/ESignatureConfig`),
// read by NOTHING: no e-signature engine exists on the platform, no layer ever
// sent a reminder email, and the reader census over every package outside
// `packages/spec` (tests and changelogs excluded), over `examples/**` and
// `skills/**`, and over objectui at the pinned sha returned zero hits, with a
// lit control inside `packages/spec`. Its default of 7 days was materialized
// into every parsed configuration without ever being consulted.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// Registered here but NOT in `src/conversions/registry.ts`, for the reason
// `kernel/MetadataPluginConfig:additionalTypes` gives: `DocumentSchema` is not
// a stack collection member and `document` is no metadata type, so a
// MetadataConversion would be a transform with no seam that ever runs. The
// prescription reaches authors through the tombstone (`tsc` + the parse) and
// the D3 semantic entry named below.
// D3 semantic entry: `esignature-config-deadline-keys-retired`.
export const entry = 'data/ESignatureConfig:reminderDays';
