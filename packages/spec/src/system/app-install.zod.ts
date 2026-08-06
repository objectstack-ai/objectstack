// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * App Installation Protocol
 *
 * Defines the schemas for installing marketplace apps into tenant databases.
 * An "app install" injects metadata (objects, views, flows) + schema sync
 * into a tenant's isolated database.
 *
 * Install pipeline:
 * 1. Check compatibility (kernel version, existing objects, conflicts)
 * 2. Validate app manifest
 * 3. Apply schema changes (via deploy pipeline)
 * 4. Seed initial data
 * 5. Register app in tenant's metadata registry
 */

// ==========================================================================
// 1. App Manifest
// ==========================================================================

/**
 * App Manifest — describes an installable app package.
 */
import { lazySchema } from '../shared/lazy-schema';
export const AppManifestSchema = lazySchema(() => z.object({
  /** Unique app identifier (snake_case) */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('App identifier (snake_case)'),

  /** Display label for the app */
  label: z.string().min(1).describe('App display label'),

  /** App version (semver) */
  version: z.string().min(1).describe('App version (semver)'),

  /** App description */
  description: z.string().optional().describe('App description'),

  /** Minimum kernel version required */
  minKernelVersion: z.string().optional().describe('Minimum required kernel version'),

  /** Object definitions provided by this app */
  objects: z.array(z.string()).default([]).describe('Object names provided'),

  /** View definitions provided */
  views: z.array(z.string()).default([]).describe('View names provided'),

  /** Flow definitions provided */
  flows: z.array(z.string()).default([]).describe('Flow names provided'),

  /** Whether seed data is included */
  hasSeedData: z.boolean().default(false).describe('Whether app includes seed data'),

  /** Seed data records to populate on install */
  seedData: z.array(z.record(z.string(), z.unknown())).default([]).describe('Seed data records'),

  /** App dependencies (other apps that must be installed first) */
  dependencies: z.array(z.string()).default([]).describe('Required app dependencies'),
}).describe('App manifest for marketplace installation'));

export type AppManifest = z.infer<typeof AppManifestSchema>;
/** Post-parse shape of {@link AppManifest} — defaults applied, transforms run (ADR-0122). */
export type AppManifestParsed = z.infer<typeof AppManifestSchema>;

// ==========================================================================
// 2. Compatibility Check
// ==========================================================================

/**
 * App Compatibility Check Result.
 */
export const AppCompatibilityCheckSchema = lazySchema(() => z.object({
  /** Whether the app is compatible with the current environment */
  compatible: z.boolean().describe('Whether the app is compatible'),

  /** Compatibility issues found */
  issues: z.array(z.object({
    /** Issue severity */
    severity: z.enum(['error', 'warning']).describe('Issue severity'),
    /** Issue description */
    message: z.string().describe('Issue description'),
    /** Issue category */
    category: z.enum([
      'kernel_version',    // Kernel version mismatch
      'object_conflict',   // Object name already exists
      'dependency_missing', // Required dependency not installed
      'quota_exceeded',    // Tenant quota would be exceeded
    ]).describe('Issue category'),
  })).default([]).describe('Compatibility issues'),
}).describe('App compatibility check result'));

export type AppCompatibilityCheck = z.infer<typeof AppCompatibilityCheckSchema>;
/** Post-parse shape of {@link AppCompatibilityCheck} — defaults applied, transforms run (ADR-0122). */
export type AppCompatibilityCheckParsed = z.infer<typeof AppCompatibilityCheckSchema>;

// ==========================================================================
// 3. Install Request & Result
// ==========================================================================

/**
 * App Install Request.
 */
export const AppInstallRequestSchema = lazySchema(() => z.object({
  /** Target tenant ID */
  tenantId: z.string().min(1).describe('Target tenant ID'),

  /** App identifier to install */
  appId: z.string().min(1).describe('App identifier'),

  /** Optional configuration overrides */
  configOverrides: z.record(z.string(), z.unknown()).optional().describe('Configuration overrides'),

  /** Whether to skip seed data */
  skipSeedData: z.boolean().default(false).describe('Skip seed data population'),
}).describe('App install request'));

export type AppInstallRequest = z.infer<typeof AppInstallRequestSchema>;
/** Post-parse shape of {@link AppInstallRequest} — defaults applied, transforms run (ADR-0122). */
export type AppInstallRequestParsed = z.infer<typeof AppInstallRequestSchema>;

/**
 * App Install Result.
 */
export const AppInstallResultSchema = lazySchema(() => z.object({
  /** Whether the installation succeeded */
  success: z.boolean().describe('Whether installation succeeded'),

  /** App identifier that was installed */
  appId: z.string().describe('Installed app identifier'),

  /** App version installed */
  version: z.string().describe('Installed app version'),

  /** Objects created or updated */
  installedObjects: z.array(z.string()).default([]).describe('Objects created/updated'),

  /** Tables created in the database */
  createdTables: z.array(z.string()).default([]).describe('Database tables created'),

  /** Number of seed records inserted */
  seededRecords: z.number().int().min(0).default(0).describe('Seed records inserted'),

  /** Installation duration in milliseconds */
  durationMs: z.number().int().min(0).optional().describe('Installation duration'),

  /** Error message if installation failed */
  error: z.string().optional().describe('Error message on failure'),
}).describe('App install result'));

export type AppInstallResult = z.infer<typeof AppInstallResultSchema>;
/** Post-parse shape of {@link AppInstallResult} — defaults applied, transforms run (ADR-0122). */
export type AppInstallResultParsed = z.infer<typeof AppInstallResultSchema>;
