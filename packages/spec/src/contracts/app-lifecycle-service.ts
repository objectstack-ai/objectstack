// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IAppLifecycleService - App Marketplace Installation Contract
 *
 * Defines the interface for installing, upgrading, and uninstalling
 * marketplace apps into tenant databases.
 *
 * An app installation:
 * 1. Checks compatibility with the tenant environment
 * 2. Applies schema changes (creates tables, indexes)
 * 3. Seeds initial data
 * 4. Registers metadata (objects, views, flows) in the tenant registry
 */

import type { AppManifest, AppCompatibilityCheckParsed, AppInstallResult } from '../system/app-install.zod.js';

// ==========================================================================
// Service Interface
// ==========================================================================

export interface IAppLifecycleService {
  /**
   * Check whether an app is compatible with a tenant's environment.
   * Validates kernel version, existing objects, dependencies, and quotas.
   *
   * @param tenantId - Target tenant
   * @param manifest - App manifest to check
   * @returns Compatibility check result
   */
  checkCompatibility(tenantId: string, manifest: AppManifest): Promise<AppCompatibilityCheckParsed>;

  /**
   * Install an app into a tenant's database.
   * Applies schema changes, seeds data, and registers metadata.
   *
   * @param tenantId - Target tenant
   * @param manifest - App manifest
   * @param config - Optional configuration overrides
   * @returns Installation result
   */
  installApp(tenantId: string, manifest: AppManifest, config?: Record<string, unknown>): Promise<AppInstallResult>;

  /**
   * Uninstall an app from a tenant's database.
   * Removes metadata registrations. Optionally drops tables.
   *
   * @param tenantId - Target tenant
   * @param appId - App to uninstall
   * @param dropTables - Whether to drop database tables (default: false)
   * @returns Whether the uninstallation succeeded
   */
  uninstallApp(tenantId: string, appId: string, dropTables?: boolean): Promise<{ success: boolean }>;

  /**
   * Upgrade an installed app to a new version.
   * Applies schema migrations and updates metadata.
   *
   * @param tenantId - Target tenant
   * @param manifest - New version app manifest
   * @returns Installation result for the upgrade
   */
  upgradeApp(tenantId: string, manifest: AppManifest): Promise<AppInstallResult>;
}
