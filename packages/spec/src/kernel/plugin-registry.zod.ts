// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { PluginCapabilityManifestSchema } from './plugin-capability.zod';

/**
 * # Plugin Registry Protocol
 * 
 * Defines the schema for the plugin discovery and registry system.
 * This enables plugins from different vendors to be discovered, validated,
 * and composed together in the ObjectStack ecosystem.
 */

/**
 * Plugin Vendor Information
 */
import { lazySchema } from '../shared/lazy-schema';
export const PluginVendorSchema = lazySchema(() => z.object({
  /**
   * Vendor identifier (reverse domain notation)
   * Example: "com.acme", "org.apache", "com.objectstack"
   */
  id: z.string()
    .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/)
    .describe('Vendor identifier (reverse domain)'),
  
  /**
   * Vendor display name
   */
  name: z.string(),
  
  /**
   * Vendor website
   */
  website: z.string().url().optional(),
  
  /**
   * Contact email
   */
  email: z.string().email().optional(),
  
  /**
   * Verification status
   */
  verified: z.boolean().default(false).describe('Whether vendor is verified by ObjectStack'),
  
  /**
   * Trust level
   */
  trustLevel: z.enum(['official', 'verified', 'community', 'unverified']).default('unverified'),
}));

/**
 * Plugin Quality Metrics
 */
export const PluginQualityMetricsSchema = lazySchema(() => z.object({
  /**
   * Test coverage percentage
   */
  testCoverage: z.number().min(0).max(100).optional(),
  
  /**
   * Documentation score (0-100)
   */
  documentationScore: z.number().min(0).max(100).optional(),
  
  /**
   * Code quality score (0-100)
   */
  codeQuality: z.number().min(0).max(100).optional(),
  
  /**
   * Security scan status
   */
  securityScan: z.object({
    lastScanDate: z.string().datetime().optional(),
    vulnerabilities: z.object({
      critical: z.number().int().min(0).default(0),
      high: z.number().int().min(0).default(0),
      medium: z.number().int().min(0).default(0),
      low: z.number().int().min(0).default(0),
    }).optional(),
    passed: z.boolean().default(false),
  }).optional(),
  
  /**
   * Conformance test results
   */
  conformanceTests: z.array(z.object({
    protocolId: z.string().describe('Protocol being tested'),
    passed: z.boolean(),
    totalTests: z.number().int().min(0),
    passedTests: z.number().int().min(0),
    lastRunDate: z.string().datetime().optional(),
  })).optional(),
}));

/**
 * Plugin Usage Statistics
 */
export const PluginStatisticsSchema = lazySchema(() => z.object({
  /**
   * Total downloads
   */
  downloads: z.number().int().min(0).default(0),
  
  /**
   * Downloads in the last 30 days
   */
  downloadsLastMonth: z.number().int().min(0).default(0),
  
  /**
   * Number of active installations
   */
  activeInstallations: z.number().int().min(0).default(0),
  
  /**
   * User ratings
   */
  ratings: z.object({
    average: z.number().min(0).max(5).default(0),
    count: z.number().int().min(0).default(0),
    distribution: z.object({
      '5': z.number().int().min(0).default(0),
      '4': z.number().int().min(0).default(0),
      '3': z.number().int().min(0).default(0),
      '2': z.number().int().min(0).default(0),
      '1': z.number().int().min(0).default(0),
    }).optional(),
  }).optional(),
  
  /**
   * GitHub stars (if open source)
   */
  stars: z.number().int().min(0).optional(),
  
  /**
   * Number of dependent plugins
   */
  dependents: z.number().int().min(0).default(0),
}));

/**
 * Plugin Registry Entry
 * Complete metadata for a plugin in the registry.
 */
export const PluginRegistryEntrySchema = lazySchema(() => z.object({
  /**
   * Plugin identifier (must match manifest.id)
   */
  id: z.string()
    .regex(/^([a-z][a-z0-9]*\.)+[a-z][a-z0-9-]+$/)
    .describe('Plugin identifier (reverse domain notation)'),
  
  /**
   * Current version
   */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  
  /**
   * Plugin display name
   */
  name: z.string(),
  
  /**
   * Short description
   */
  description: z.string().optional(),
  
  /**
   * Detailed documentation/README
   */
  readme: z.string().optional(),
  
  /**
   * Plugin type/category
   */
  category: z.enum([
    'data',           // Data management, storage, databases
    'integration',    // External service integrations
    'ui',            // UI components and themes
    'analytics',     // Analytics and reporting
    'security',      // Security, auth, compliance
    'automation',    // Workflows and automation
    'ai',            // AI/ML capabilities
    'utility',       // General utilities
    'driver',        // Database/storage drivers
    'gateway',       // API gateways
    'adapter',       // Runtime adapters
  ]).optional(),
  
  /**
   * Tags for categorization
   */
  tags: z.array(z.string()).optional(),
  
  /**
   * Vendor information
   */
  vendor: PluginVendorSchema,
  
  /**
   * Capability manifest (what the plugin implements/provides)
   */
  capabilities: PluginCapabilityManifestSchema.optional(),
  
  /**
   * Compatibility information
   */
  compatibility: z.object({
    /**
     * Minimum ObjectStack version required
     */
    minObjectStackVersion: z.string().optional(),
    
    /**
     * Maximum ObjectStack version supported
     */
    maxObjectStackVersion: z.string().optional(),
    
    /**
     * Node.js version requirement
     */
    nodeVersion: z.string().optional(),
    
    /**
     * Supported platforms
     */
    platforms: z.array(z.enum(['linux', 'darwin', 'win32', 'browser'])).optional(),
  }).optional(),
  
  /**
   * Links and resources
   */
  links: z.object({
    homepage: z.string().url().optional(),
    repository: z.string().url().optional(),
    documentation: z.string().url().optional(),
    bugs: z.string().url().optional(),
    changelog: z.string().url().optional(),
  }).optional(),
  
  /**
   * Media assets
   */
  media: z.object({
    icon: z.string().url().optional(),
    logo: z.string().url().optional(),
    screenshots: z.array(z.string().url()).optional(),
    video: z.string().url().optional(),
  }).optional(),
  
  /**
   * Quality metrics
   */
  quality: PluginQualityMetricsSchema.optional(),
  
  /**
   * Usage statistics
   */
  statistics: PluginStatisticsSchema.optional(),
  
  /**
   * License information
   */
  license: z.string().optional().describe('SPDX license identifier'),
  
  /**
   * Pricing (if commercial)
   */
  pricing: z.object({
    model: z.enum(['free', 'freemium', 'paid', 'enterprise']),
    price: z.number().min(0).optional(),
    currency: z.string().default('USD').optional(),
    billingPeriod: z.enum(['one-time', 'monthly', 'yearly']).optional(),
  }).optional(),
  
  /**
   * Publication dates
   */
  publishedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  
  /**
   * Deprecation status
   */
  deprecated: z.boolean().default(false),
  deprecationMessage: z.string().optional(),
  replacedBy: z.string().optional().describe('Plugin ID that replaces this one'),
  
  /**
   * Feature flags
   */
  flags: z.object({
    experimental: z.boolean().default(false),
    beta: z.boolean().default(false),
    featured: z.boolean().default(false),
    verified: z.boolean().default(false),
  }).optional(),
}));

/**
 * Plugin Search Filters
 */
export const PluginSearchFiltersSchema = lazySchema(() => z.object({
  /**
   * Search query
   */
  query: z.string().optional(),
  
  /**
   * Filter by category
   */
  category: z.array(z.string()).optional(),
  
  /**
   * Filter by tags
   */
  tags: z.array(z.string()).optional(),
  
  /**
   * Filter by vendor trust level
   */
  trustLevel: z.array(z.enum(['official', 'verified', 'community', 'unverified'])).optional(),
  
  /**
   * Filter by protocols implemented
   */
  implementsProtocols: z.array(z.string()).optional(),
  
  /**
   * Filter by pricing model
   */
  pricingModel: z.array(z.enum(['free', 'freemium', 'paid', 'enterprise'])).optional(),
  
  /**
   * Minimum rating
   */
  minRating: z.number().min(0).max(5).optional(),
  
  /**
   * Sort options
   */
  sortBy: z.enum([
    'relevance',
    'downloads',
    'rating',
    'updated',
    'name',
  ]).optional(),
  
  /**
   * Sort order
   */
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
  
  /**
   * Pagination
   */
  page: z.number().int().min(1).default(1).optional(),
  limit: z.number().int().min(1).max(100).default(20).optional(),
}));

/**
 * Plugin Installation Configuration
 */
export const PluginInstallConfigSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier to install
   */
  pluginId: z.string(),
  
  /**
   * Version to install (supports semver ranges)
   */
  version: z.string().optional().describe('Defaults to latest'),
  
  /**
   * Plugin-specific configuration values
   */
  config: z.record(z.string(), z.unknown()).optional(),
  
  /**
   * Whether to auto-update
   */
  autoUpdate: z.boolean().default(false).optional(),
  
  /**
   * Installation options
   */
  options: z.object({
    /**
     * Skip dependency installation
     */
    skipDependencies: z.boolean().default(false).optional(),
    
    /**
     * Force reinstall
     */
    force: z.boolean().default(false).optional(),
    
    /**
     * Installation target
     */
    target: z.enum(['system', 'space', 'user']).default('space').optional(),
  }).optional(),
}));

// Export types
export type PluginVendor = z.infer<typeof PluginVendorSchema>;
/** Post-parse shape of {@link PluginVendor} — defaults applied, transforms run (ADR-0122). */
export type PluginVendorParsed = z.infer<typeof PluginVendorSchema>;
export type PluginVendorInput = z.input<typeof PluginVendorSchema>;
export type PluginQualityMetrics = z.infer<typeof PluginQualityMetricsSchema>;
/** Post-parse shape of {@link PluginQualityMetrics} — defaults applied, transforms run (ADR-0122). */
export type PluginQualityMetricsParsed = z.infer<typeof PluginQualityMetricsSchema>;
export type PluginQualityMetricsInput = z.input<typeof PluginQualityMetricsSchema>;
export type PluginStatistics = z.infer<typeof PluginStatisticsSchema>;
/** Post-parse shape of {@link PluginStatistics} — defaults applied, transforms run (ADR-0122). */
export type PluginStatisticsParsed = z.infer<typeof PluginStatisticsSchema>;
export type PluginStatisticsInput = z.input<typeof PluginStatisticsSchema>;
export type PluginRegistryEntry = z.infer<typeof PluginRegistryEntrySchema>;
/** Post-parse shape of {@link PluginRegistryEntry} — defaults applied, transforms run (ADR-0122). */
export type PluginRegistryEntryParsed = z.infer<typeof PluginRegistryEntrySchema>;
export type PluginRegistryEntryInput = z.input<typeof PluginRegistryEntrySchema>;
export type PluginSearchFilters = z.infer<typeof PluginSearchFiltersSchema>;
export type PluginSearchFiltersInput = z.input<typeof PluginSearchFiltersSchema>;
export type PluginInstallConfig = z.infer<typeof PluginInstallConfigSchema>;
export type PluginInstallConfigInput = z.input<typeof PluginInstallConfigSchema>;
