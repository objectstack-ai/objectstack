// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The installed manifests an engine's registry holds, as the customization
 * pair lookup reads them (`pairOf`, `isPairOf` and `appOf` in
 * `@objectstack/metadata-core`): the App of a package is read from what the
 * installed packages declare (ADR-0146 D3 as amended, ruling record
 * 6691022506), so every "which pair customizes this package?" question in this
 * package hands the lookup the registry it serves — ⛔ never a lookup of its
 * own, and never none.
 */

import {
    installedManifestsOf,
    type InstalledManifestLookup,
    type InstalledPackageSource,
} from '@objectstack/metadata-core';

/** The {@link InstalledManifestLookup} over `engine.registry` (nothing installed when the engine has none). */
export function installedManifestsOfEngine(engine: unknown): InstalledManifestLookup {
    return installedManifestsOf((engine as { registry?: InstalledPackageSource } | null | undefined)?.registry);
}
