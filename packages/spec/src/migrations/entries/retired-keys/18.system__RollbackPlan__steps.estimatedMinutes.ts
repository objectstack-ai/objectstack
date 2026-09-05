// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14477 — ADR-0049 enforce-or-remove (maintainer ruling 2026-09-02, ruled A:
// retire per family). One of the hour/minute/day-shaped deadline keys of the
// incident-response / training / change-management families: declared on the
// published authorable surface, read by NOTHING — the schemas are mounted by
// no stack key and registered as no metadata type, and the reader census over
// every package outside `packages/spec` (and objectui at the pinned sha)
// returned zero hits — so an author who wrote it held a deadline the platform
// never kept.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// Registered here but NOT in `src/conversions/registry.ts`, for the reason
// `kernel/MetadataPluginConfig:additionalTypes` gives: the conversion chain
// walks a normalized STACK and none of these schemas is a stack collection
// member, so a MetadataConversion would be a transform with no seam that ever
// runs. The prescription reaches authors through the tombstone (`tsc` + the
// parse) and the D3 semantic entry named below.
//
// A NESTED site: the authorable-surface ratchet walks top-level def
// properties only, so no `[RETIRED]` row exists for it and gate (b) of
// `build-schemas.ts` neither demands nor refuses this entry — it is here for
// the spec-changes / upgrade-guide projection, spelled the way
// `kernel/Manifest:contributes.actions` and
// `api/BatchEndpointsConfig:operations.upsertMany` are.
// D3 semantic entry: `change-management-duration-keys-retired`.
export const entry = 'system/RollbackPlan:steps.estimatedMinutes';
