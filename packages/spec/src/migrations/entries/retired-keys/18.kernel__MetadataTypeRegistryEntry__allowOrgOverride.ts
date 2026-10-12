// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0131 C5's spec half — ruling C on the C5 split (rename the key to say
// what it now means; no second key, and not the old name with a new meaning)
// and the maintainer's ruling on its mechanism (Q1 A: a tombstone, this
// entry and a D3 semantic entry; no D2 conversion). ADR-0131 D6 retired the
// per-organization overlay axis, so the registry flag that said "per-org" was
// renamed to `allowEnvironmentOverlay`: whether an environment may overlay an
// item of the type that a managed package ships, on write, on read and in
// Studio. The value is unchanged on every one of the 28 built-in entries.
//
// Tombstoned with `retiredKey()`: `MetadataTypeRegistryEntryBaseSchema` is a
// plain `z.object`, so a bare deletion would strip an authored old key in
// silence. No D2 conversion: no manifest, stack, plugin configuration or
// stored row can carry a type-registry entry — `contributes.kinds` is closed,
// `config.additionalTypes` is a tombstone, and the registry is the TypeScript
// literal `DEFAULT_METADATA_TYPE_REGISTRY` — so a conversion would be a
// transform with no seam that ever runs (the `additionalTypes` precedent).
// The prescription reaches authors through the tombstone (`tsc` + the parse)
// and the D3 semantic entry `metadata-type-registry-allow-org-override-renamed`,
// which also records the `GET /meta/types` wire field that moved with it.
export const entry = 'kernel/MetadataTypeRegistryEntry:allowOrgOverride';
