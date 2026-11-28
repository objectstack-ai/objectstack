// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The capability set Studio's entry gate read, for the Studio screens that
 * choose a destination by it (objectstack#36908).
 *
 * Every exit from Studio that names no package — bare `/studio` with nothing
 * remembered, the retired `/studio?new=package` bookmark, the package-not-found
 * state's way out — lands on Setup → Packages for a principal who may open
 * that page, and on the package-less scope (`~org`, its flows) for one who may
 * enter Studio and not that Setup page (`studioEntryFallbackPath`). That
 * fallback was the cross-package directory until it moved to Setup
 * (objectstack#37565), which such a principal may not open; it holds until the
 * package-less scope retires with the door that moves loose items into a
 * package (ADR-0084, amended 2026-11-26), when its next home is decided. The host
 * that gates `/studio` (the console's `RequireStudioAccess`) provides the set
 * it read; a screen outside that provider reads `undefined`, which holds
 * nothing, so it never sends anyone to a page they may not open.
 */

import * as React from 'react';
import { SETUP_NEW_PACKAGE_PATH, SETUP_PACKAGES_PATH } from '../metadata-admin/packageSource.js';
import { studioOrgScopePath } from './studioScope.js';

const StudioEntryPermissionsContext = React.createContext<readonly string[] | undefined>(undefined);

/** Provided by the host around a principal its Studio entry gate let in. */
export const StudioEntryPermissionsProvider = StudioEntryPermissionsContext.Provider;

/** The capability set the Studio entry gate read; `undefined` outside its provider. */
export function useStudioEntryPermissions(): readonly string[] | undefined {
  return React.useContext(StudioEntryPermissionsContext);
}

/**
 * The capabilities Setup → Packages is shown under: the Setup app's entry
 * (`setup.access`) and the menu item's gate (`manage_platform_settings`,
 * `nav_packages` in `setup-nav.contributions.ts`).
 */
export const SETUP_PACKAGES_CAPABILITIES = ['setup.access', 'manage_platform_settings'] as const;

/** `undefined` (no answer reported) holds nothing. */
export function holdsSetupPackages(systemPermissions: readonly string[] | undefined): boolean {
  const held = new Set(systemPermissions ?? []);
  return SETUP_PACKAGES_CAPABILITIES.every((c) => held.has(c));
}

/**
 * Where Studio's entry goes when no remembered package opens: Setup → Packages
 * for a holder of {@link SETUP_PACKAGES_CAPABILITIES}, else the package-less
 * scope (`~org`), which every principal who may enter Studio may open.
 * `undefined` (no answer reported) holds nothing.
 */
export function studioEntryFallbackPath(systemPermissions: readonly string[] | undefined): string {
  return holdsSetupPackages(systemPermissions)
    ? SETUP_PACKAGES_PATH
    : studioOrgScopePath();
}

/**
 * Where the retired `/studio?new=package` bookmark goes: Setup's New Package
 * for a holder of {@link SETUP_PACKAGES_CAPABILITIES}, else
 * {@link studioEntryFallbackPath}'s answer for that principal.
 */
export function studioNewPackageEntryPath(systemPermissions: readonly string[] | undefined): string {
  return holdsSetupPackages(systemPermissions) ? SETUP_NEW_PACKAGE_PATH : studioEntryFallbackPath(systemPermissions);
}

/**
 * Where a door that creates a package goes, outside Studio's entry gate
 * (Home's no-agent chip, the `/ai` screen, 「Add app」's 「New blank app」):
 * the same choice as {@link studioNewPackageEntryPath}, decided by whether
 * the caller holds {@link SETUP_PACKAGES_CAPABILITIES}. Those doors have no
 * entry-gate set to read; they ask the session's own capability answer
 * (`usePermissions().hasCapabilities`), which fails open on an unreported set
 * as the doors' own authoring gate does — the server still refuses Setup to a
 * non-holder (objectstack#36908).
 */
export function newPackageDoorPath(holdsSetupPackagesPair: boolean): string {
  return holdsSetupPackagesPair ? SETUP_NEW_PACKAGE_PATH : studioOrgScopePath();
}
