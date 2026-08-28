// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #12497 — the RESPONSE-side face of `security/ObjectPermission:allowPurge`
// (see that entry for the full rationale: ADR-0049 enforce-or-remove,
// maintainer ruling 2026-08-26 accepting #1883's recommendation B; the key
// returns with the M2 lifecycle initiative). `EffectiveObjectPermissionSchema`
// extends the same closed base shape (`.extend({ apiOperations }).strip()`,
// both faces behind the #12840 residue stage since 2026-08-28) — the clone
// shares the authoring shape's per-property schema instances, so the
// `retiredKey()` tombstone rides into the effective surface and this def's
// walked shape carries the same `[RETIRED]` row, while the retired default
// (`false`) an older published-toolchain server still emits on the wire is
// accepted as inert residue and stripped. Registered so the aging clock
// (#5898) has an exact-key entry for BOTH rows the tombstone produces. The
// effective surface is server-resolved, never authored, so no D2 conversion
// clause targets it — the authoring-side strip in
// `permission-allow-restore-purge-removed` is the only source rewrite that
// exists to do.
export const entry = 'security/EffectiveObjectPermission:allowPurge';
