// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8586 — ADR-0049 enforce-or-remove (maintainer ruling 2026-08-14, ruled
// REMOVE). `additionalTypes` was declared, authorable, and documented on four
// docs pages as THE way a plugin registers a custom metadata type — and read
// by NOTHING: the only production writer of the manager's type registry is
// `setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY)`, called exactly once, and
// it replaces the array outright. Measured: declared count == live count
// (27 == 27). The #4212 `onInstall` silence trap one level down.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent).
//
// Registered here but NOT in `src/conversions/registry.ts`, for the reason
// `kernel/Manifest:loading` gives: the conversion chain walks a normalized
// STACK (`mapCollection(stack, 'objects' | 'views' | …)`) and
// `applyConversionsToStoredItem` maps a metadata type onto one of those
// collections. A metadata-plugin config is neither — there is no `plugins`
// entry in `PLURAL_TO_SINGULAR`, so it is not a stack collection member and a
// MetadataConversion here would be a transform with no seam that ever runs.
// The prescription reaches authors through the tombstone (`tsc` + the parse)
// and the D3 semantic entry `metadata-plugin-additional-types-retired`.
export const entry = 'kernel/MetadataPluginConfig:additionalTypes';
