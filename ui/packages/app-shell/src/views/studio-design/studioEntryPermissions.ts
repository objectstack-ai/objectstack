// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The capability set Studio's entry gate read, for the Studio screens that
 * choose a destination by it (objectstack#36908).
 *
 * Every exit from Studio that names no package — bare `/studio` with nothing
 * remembered, the retired `/studio?new=package` bookmark, the package-not-found
 * state's way out — lands on Setup → Packages for a principal who may open
 * that page, and on the "All metadata" area across packages for one who may
 * enter Studio and not that Setup page (`studioEntryFallbackPath`). The host
 * that gates `/studio` (the console's `RequireStudioAccess`) provides the set
 * it read; a screen outside that provider reads `undefined`, which holds
 * nothing, so it never sends anyone to a page they may not open.
 */

import * as React from 'react';

const StudioEntryPermissionsContext = React.createContext<readonly string[] | undefined>(undefined);

/** Provided by the host around a principal its Studio entry gate let in. */
export const StudioEntryPermissionsProvider = StudioEntryPermissionsContext.Provider;

/** The capability set the Studio entry gate read; `undefined` outside its provider. */
export function useStudioEntryPermissions(): readonly string[] | undefined {
  return React.useContext(StudioEntryPermissionsContext);
}
