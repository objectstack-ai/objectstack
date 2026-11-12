// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32366] The `packageId` a caller of the delete heal
 * (`restoreArtifactRegistryView`) passes when it does NOT KNOW the removed
 * row's binding, as distinct from `null`, a row it knows was package-less.
 *
 * The one such caller is a peer replica converging on a cluster signal that
 * names no package (`applyRemoteMetadataMutation`): the removed row's binding
 * went with it, and a writer that predates the signal's `packageId` (#32451,
 * ADR-0150 D4) does not say it. A signal that names the package hands the heal
 * that package (or `null`) instead, as the writer's own heal does. The heal
 * reads the baseline with no package for this caller, as for a package-less
 * row, but a refusal of that
 * read is a logged stop that keeps the registry entry. Only a row known to be
 * package-less has its bare-slot entry retired on a refusal (seat ruling
 * 6812637203 Q2): the peer cannot tell the removed row was that row.
 *
 * A module of its own, importing nothing, so every caller and the class
 * member's signature can name it without an import cycle.
 */
export const HEAL_BINDING_UNKNOWN: unique symbol = Symbol('heal-binding-unknown');

/** The heal's `packageId`: a package, `null` (package-less), or {@link HEAL_BINDING_UNKNOWN}. */
export type HealPackageBinding = string | null | typeof HEAL_BINDING_UNKNOWN;
