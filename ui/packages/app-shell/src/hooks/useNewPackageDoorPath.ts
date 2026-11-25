// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a console door that creates a package leads: Setup → Packages with New
 * Package open for a holder of `setup.access` + `manage_platform_settings`, and
 * Studio's "All metadata" area for an author who may enter Studio but not open
 * that Setup page (objectstack#36908). The doors are Home's no-agent chip, the
 * `/ai` screen's 「New blank app」 and 「Add app」's 「New blank app」; they sit
 * outside Studio's entry gate, so they read the session's own capability
 * answer. See `newPackageDoorPath`.
 *
 * @module
 */

import { usePermissions } from '@object-ui/permissions';
import { newPackageDoorPath, SETUP_PACKAGES_CAPABILITIES } from '../views/studio-design/studioEntryPermissions.js';

export function useNewPackageDoorPath(): string {
  const { hasCapabilities } = usePermissions();
  return newPackageDoorPath(hasCapabilities([...SETUP_PACKAGES_CAPABILITIES]));
}
