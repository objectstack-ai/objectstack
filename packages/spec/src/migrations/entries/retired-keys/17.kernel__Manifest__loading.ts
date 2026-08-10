// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #4914 — ADR-0049 enforce-or-remove on the plugin manifest's whole
// `loading` block (maintainer ruling 2026-08-04). ONE tombstoned key here,
// because `loading` was the single carrier: every schema underneath it
// (`PluginLoadingConfig` and the ten members it combined) leaves the
// published set as a whole-def removal and is registered in
// `RETIRED_DEFS_BY_MAJOR` below, not as ~27 individual key entries.
//
// Registered here but NOT in `src/conversions/registry.ts`, for the reason
// `automation/ActionDescriptor:isAsync` above gives: the conversion chain
// walks a normalized STACK (`mapCollection(stack, 'objects' | 'views' | …)`)
// and `applyConversionsToStoredItem` maps a metadata type onto one of those
// collections. A package manifest is neither — there is no `packages` /
// `plugins` entry in `PLURAL_TO_SINGULAR`, so a manifest is not a stack
// collection member and a stored manifest row passes that seam through
// unchanged. A MetadataConversion here would be a transform with no seam
// that ever runs. The prescription reaches authors instead through the
// tombstone at the one place a manifest is parsed with an author present
// (`os plugin build` → `ManifestSchema.safeParse`, which exits non-zero),
// and through the D3 semantic entry `plugin-manifest-loading-retired`.
export const entry = 'kernel/Manifest:loading';
