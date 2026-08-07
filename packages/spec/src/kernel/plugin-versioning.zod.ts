// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

/**
 * # Plugin Versioning and Compatibility Protocol
 * 
 * Defines comprehensive versioning, compatibility checking, and dependency
 * resolution mechanisms for the plugin ecosystem.
 * 
 * Based on semantic versioning (SemVer) with extensions for:
 * - Compatibility matrices
 * - Breaking change detection
 * - Migration paths
 * - Multi-version support
 */

/**
 * Semantic Version Schema
 * Standard SemVer format with optional pre-release and build metadata
 */
import { lazySchema } from '../shared/lazy-schema';
export const SemanticVersionSchema = lazySchema(() => z.object({
  major: z.number().int().min(0).describe('Major version (breaking changes)'),
  minor: z.number().int().min(0).describe('Minor version (backward compatible features)'),
  patch: z.number().int().min(0).describe('Patch version (backward compatible fixes)'),
  preRelease: z.string().optional().describe('Pre-release identifier (alpha, beta, rc.1)'),
  build: z.string().optional().describe('Build metadata'),
}).describe('Semantic version number'));

/**
 * Version Constraint Schema
 * Defines version requirements using SemVer ranges
 */
export const VersionConstraintSchema = lazySchema(() => z.union([
  z.string().regex(/^[\d.]+$/).describe('Exact version: `1.2.3`'),
  z.string().regex(/^\^[\d.]+$/).describe('Compatible with: `^1.2.3` (`>=1.2.3 <2.0.0`)'),
  z.string().regex(/^~[\d.]+$/).describe('Approximately: `~1.2.3` (`>=1.2.3 <1.3.0`)'),
  z.string().regex(/^>=[\d.]+$/).describe('Greater than or equal: `>=1.2.3`'),
  z.string().regex(/^>[\d.]+$/).describe('Greater than: `>1.2.3`'),
  z.string().regex(/^<=[\d.]+$/).describe('Less than or equal: `<=1.2.3`'),
  z.string().regex(/^<[\d.]+$/).describe('Less than: `<1.2.3`'),
  z.string().regex(/^[\d.]+ - [\d.]+$/).describe('Range: `1.2.3 - 2.3.4`'),
  z.literal('*').describe('Any version'),
  z.literal('latest').describe('Latest stable version'),
]));

/**
 * Compatibility Level
 * Describes the level of compatibility between versions
 */
export const CompatibilityLevelSchema = lazySchema(() => z.enum([
  'fully-compatible',      // 100% compatible, drop-in replacement
  'backward-compatible',   // Backward compatible, new features added
  'deprecated-compatible', // Compatible but uses deprecated features
  'breaking-changes',      // Breaking changes, migration required
  'incompatible',         // Completely incompatible
]).describe('Compatibility level between versions'));

/**
 * Breaking Change
 * Documents a breaking change in a version
 */
export const BreakingChangeSchema = lazySchema(() => z.object({
  /**
   * Version where the change was introduced
   */
  introducedIn: z.string().describe('Version that introduced this breaking change'),
  
  /**
   * Type of breaking change
   */
  type: z.enum([
    'api-removed',          // API removed
    'api-renamed',          // API renamed
    'api-signature-changed', // Function signature changed
    'behavior-changed',     // Behavior changed
    'dependency-changed',   // Dependency requirement changed
    'configuration-changed', // Configuration schema changed
    'protocol-changed',     // Protocol implementation changed
  ]),
  
  /**
   * What was changed
   */
  description: z.string(),
  
  /**
   * Migration guide
   */
  migrationGuide: z.string().optional().describe('How to migrate from old to new'),
  
  /**
   * Deprecated in version
   */
  deprecatedIn: z.string().optional().describe('Version where old API was deprecated'),
  
  /**
   * Will be removed in version
   */
  removedIn: z.string().optional().describe('Version where old API will be removed'),
  
  /**
   * Automated migration available
   */
  automatedMigration: z.boolean().default(false)
    .describe('Whether automated migration tool is available'),
  
  /**
   * Impact severity
   */
  severity: z.enum(['critical', 'major', 'minor']).describe('Impact severity'),
}));

/**
 * Deprecation Notice
 * Information about deprecated features
 */
export const DeprecationNoticeSchema = lazySchema(() => z.object({
  /**
   * Feature or API being deprecated
   */
  feature: z.string().describe('Deprecated feature identifier'),
  
  /**
   * Version when deprecated
   */
  deprecatedIn: z.string(),
  
  /**
   * Planned removal version
   */
  removeIn: z.string().optional(),
  
  /**
   * Reason for deprecation
   */
  reason: z.string(),
  
  /**
   * Recommended alternative
   */
  alternative: z.string().optional().describe('What to use instead'),
  
  /**
   * Migration path
   */
  migrationPath: z.string().optional().describe('How to migrate to alternative'),
}));

/**
 * Compatibility Matrix Entry
 * Maps compatibility between different plugin versions
 */
export const CompatibilityMatrixEntrySchema = lazySchema(() => z.object({
  /**
   * Source version
   */
  from: z.string().describe('Version being upgraded from'),
  
  /**
   * Target version
   */
  to: z.string().describe('Version being upgraded to'),
  
  /**
   * Compatibility level
   */
  compatibility: CompatibilityLevelSchema,
  
  /**
   * Breaking changes list
   */
  breakingChanges: z.array(BreakingChangeSchema).optional(),
  
  /**
   * Migration required
   */
  migrationRequired: z.boolean().default(false),
  
  /**
   * Migration complexity
   */
  migrationComplexity: z.enum(['trivial', 'simple', 'moderate', 'complex', 'major']).optional(),
  
  /**
   * Estimated migration time in hours
   */
  estimatedMigrationTime: z.number().optional(),
  
  /**
   * Migration script available
   */
  migrationScript: z.string().optional().describe('Path to migration script'),
  
  /**
   * Test coverage for migration
   */
  testCoverage: z.number().min(0).max(100).optional()
    .describe('Percentage of migration covered by tests'),
}));

/**
 * Plugin Compatibility Matrix
 * Complete compatibility information for a plugin
 */
export const PluginCompatibilityMatrixSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier
   */
  pluginId: z.string(),
  
  /**
   * Current version
   */
  currentVersion: z.string(),
  
  /**
   * Compatibility entries
   */
  compatibilityMatrix: z.array(CompatibilityMatrixEntrySchema),
  
  /**
   * Supported versions
   */
  supportedVersions: z.array(z.object({
    version: z.string(),
    supported: z.boolean(),
    endOfLife: z.string().datetime().optional().describe('End of support date'),
    securitySupport: z.boolean().default(false).describe('Still receives security updates'),
  })),
  
  /**
   * Minimum compatible version
   */
  minimumCompatibleVersion: z.string().optional()
    .describe('Oldest version that can be directly upgraded'),
}));

/**
 * Dependency Conflict
 * Represents a conflict in plugin dependencies at the kernel level.
 * Models plugin-to-plugin dependency conflicts with typed conflict categories.
 * 
 * @see hub/plugin-security.zod.ts DependencyConflictSchema for hub-level package version conflicts
 *      which focuses on marketplace registry resolution.
 */
export const DependencyConflictSchema = lazySchema(() => z.object({
  /**
   * Type of conflict
   */
  type: z.enum([
    'version-mismatch',      // Different versions required
    'missing-dependency',    // Required dependency not found
    'circular-dependency',   // Circular dependency detected
    'incompatible-versions', // Incompatible versions required by different plugins
    'conflicting-interfaces', // Plugins implement conflicting interfaces
  ]),
  
  /**
   * Plugins involved in conflict
   */
  plugins: z.array(z.object({
    pluginId: z.string(),
    version: z.string(),
    requirement: z.string().optional().describe('What this plugin requires'),
  })),
  
  /**
   * Conflict description
   */
  description: z.string(),
  
  /**
   * Possible resolutions
   */
  resolutions: z.array(z.object({
    strategy: z.enum([
      'upgrade',       // Upgrade one or more plugins
      'downgrade',     // Downgrade one or more plugins
      'replace',       // Replace with alternative plugin
      'disable',       // Disable conflicting plugin
      'manual',        // Manual intervention required
    ]),
    description: z.string(),
    automaticResolution: z.boolean().default(false),
    riskLevel: z.enum(['low', 'medium', 'high']),
  })).optional(),
  
  /**
   * Severity of conflict
   */
  severity: z.enum(['critical', 'error', 'warning', 'info']),
}));

/**
 * Dependency Resolution Result
 * Result of dependency resolution process
 */
export const PluginDependencyResolutionResultSchema = lazySchema(() => z.object({
  /**
   * Resolution successful
   */
  success: z.boolean(),
  
  /**
   * Resolved plugin versions
   */
  resolved: z.array(z.object({
    pluginId: z.string(),
    version: z.string(),
    resolvedVersion: z.string(),
  })).optional(),
  
  /**
   * Conflicts found
   */
  conflicts: z.array(DependencyConflictSchema).optional(),
  
  /**
   * Warnings
   */
  warnings: z.array(z.string()).optional(),
  
  /**
   * Installation order (topologically sorted)
   */
  installationOrder: z.array(z.string()).optional()
    .describe('Plugin IDs in order they should be installed'),
  
  /**
   * Dependency graph
   */
  dependencyGraph: z.record(z.string(), z.array(z.string())).optional()
    .describe('Map of plugin ID to its dependencies'),
}));

/**
 * Multi-Version Support Configuration
 * Allows running multiple versions of a plugin simultaneously
 */
export const MultiVersionSupportSchema = lazySchema(() => z.object({
  /**
   * Enable multi-version support
   */
  enabled: z.boolean().default(false),
  
  /**
   * Maximum concurrent versions
   */
  maxConcurrentVersions: z.number().int().min(1).default(2)
    .describe('How many versions can run at the same time'),
  
  /**
   * Version selection strategy
   */
  selectionStrategy: z.enum([
    'latest',        // Always use latest version
    'stable',        // Use latest stable version
    'compatible',    // Use version compatible with dependencies
    'pinned',        // Use pinned version
    'canary',        // Use canary/preview version
    'custom',        // Custom selection logic
  ]).default('latest'),
  
  /**
   * Version routing rules
   */
  routing: z.array(z.object({
    condition: ExpressionInputSchema.describe('Routing predicate (CEL).'),
    version: z.string().describe('Version to use when condition matches'),
    priority: z.number().int().default(100).describe('Rule priority'),
  })).optional(),
  
  /**
   * Gradual rollout configuration
   */
  rollout: z.object({
    enabled: z.boolean().default(false),
    strategy: z.enum(['percentage', 'blue-green', 'canary']),
    percentage: z.number().min(0).max(100).optional()
      .describe('Percentage of traffic to new version'),
    duration: z.number().int().optional()
      .describe('Rollout duration in milliseconds'),
  }).optional(),
}));

/**
 * Plugin Version Metadata
 * Complete version information for a plugin
 */
export const PluginVersionMetadataSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier
   */
  pluginId: z.string(),
  
  /**
   * Version number
   */
  version: SemanticVersionSchema,
  
  /**
   * Version string (computed)
   */
  versionString: z.string().describe('Full version string (e.g., 1.2.3-beta.1+build.123)'),
  
  /**
   * Release date
   */
  releaseDate: z.string().datetime(),
  
  /**
   * Release notes
   */
  releaseNotes: z.string().optional(),
  
  /**
   * Breaking changes
   */
  breakingChanges: z.array(BreakingChangeSchema).optional(),
  
  /**
   * Deprecations
   */
  deprecations: z.array(DeprecationNoticeSchema).optional(),
  
  /**
   * Compatibility matrix
   */
  compatibilityMatrix: z.array(CompatibilityMatrixEntrySchema).optional(),
  
  /**
   * Security vulnerabilities fixed
   */
  securityFixes: z.array(z.object({
    cve: z.string().optional().describe('CVE identifier'),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    description: z.string(),
    fixedIn: z.string().describe('Version where vulnerability was fixed'),
  })).optional(),
  
  /**
   * Download statistics
   */
  statistics: z.object({
    downloads: z.number().int().min(0).optional(),
    installations: z.number().int().min(0).optional(),
    ratings: z.number().min(0).max(5).optional(),
  }).optional(),
  
  /**
   * Support status
   */
  support: z.object({
    status: z.enum(['active', 'maintenance', 'deprecated', 'eol']),
    endOfLife: z.string().datetime().optional(),
    securitySupport: z.boolean().default(true),
  }),
}));

// Export types
export type SemanticVersion = z.input<typeof SemanticVersionSchema>;
export type VersionConstraint = z.input<typeof VersionConstraintSchema>;
export type CompatibilityLevel = z.input<typeof CompatibilityLevelSchema>;
export type BreakingChange = z.input<typeof BreakingChangeSchema>;
/** Post-parse shape of {@link BreakingChange} — defaults applied, transforms run (ADR-0122). */
export type BreakingChangeParsed = z.infer<typeof BreakingChangeSchema>;
export type DeprecationNotice = z.input<typeof DeprecationNoticeSchema>;
export type CompatibilityMatrixEntry = z.input<typeof CompatibilityMatrixEntrySchema>;
/** Post-parse shape of {@link CompatibilityMatrixEntry} — defaults applied, transforms run (ADR-0122). */
export type CompatibilityMatrixEntryParsed = z.infer<typeof CompatibilityMatrixEntrySchema>;
export type PluginCompatibilityMatrix = z.input<typeof PluginCompatibilityMatrixSchema>;
/** Post-parse shape of {@link PluginCompatibilityMatrix} — defaults applied, transforms run (ADR-0122). */
export type PluginCompatibilityMatrixParsed = z.infer<typeof PluginCompatibilityMatrixSchema>;
export type DependencyConflict = z.input<typeof DependencyConflictSchema>;
/** Post-parse shape of {@link DependencyConflict} — defaults applied, transforms run (ADR-0122). */
export type DependencyConflictParsed = z.infer<typeof DependencyConflictSchema>;
export type PluginDependencyResolutionResult = z.input<typeof PluginDependencyResolutionResultSchema>;
/** Post-parse shape of {@link PluginDependencyResolutionResult} — defaults applied, transforms run (ADR-0122). */
export type PluginDependencyResolutionResultParsed = z.infer<typeof PluginDependencyResolutionResultSchema>;
export type MultiVersionSupport = z.input<typeof MultiVersionSupportSchema>;
/** Post-parse shape of {@link MultiVersionSupport} — defaults applied, transforms run (ADR-0122). */
export type MultiVersionSupportParsed = z.infer<typeof MultiVersionSupportSchema>;
export type PluginVersionMetadata = z.input<typeof PluginVersionMetadataSchema>;
/** Post-parse shape of {@link PluginVersionMetadata} — defaults applied, transforms run (ADR-0122). */
export type PluginVersionMetadataParsed = z.infer<typeof PluginVersionMetadataSchema>;
