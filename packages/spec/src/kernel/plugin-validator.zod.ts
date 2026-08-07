// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Plugin Validator Protocol
 * 
 * Zod schemas for plugin validation data structures.
 * These schemas align with the IPluginValidator contract interface.
 * 
 * Following ObjectStack "Zod First" principle - all data structures
 * must have Zod schemas for runtime validation and JSON Schema generation.
 */

// ============================================================================
// Validation Result Schemas
// ============================================================================

/**
 * Validation Error Schema
 * Represents a single validation error
 * 
 * @example
 * {
 *   "field": "version",
 *   "message": "Invalid semver format",
 *   "code": "INVALID_VERSION"
 * }
 */
import { lazySchema } from '../shared/lazy-schema';
export const ValidationErrorSchema = lazySchema(() => z.object({
  /**
   * Field that failed validation
   */
  field: z.string().describe('Field name that failed validation'),
  
  /**
   * Human-readable error message
   */
  message: z.string().describe('Human-readable error message'),
  
  /**
   * Machine-readable error code (optional)
   */
  code: z.string().optional().describe('Machine-readable error code'),
}));

export type ValidationError = z.input<typeof ValidationErrorSchema>;

/**
 * Validation Warning Schema
 * Represents a non-fatal validation warning
 * 
 * @example
 * {
 *   "field": "description",
 *   "message": "Description is empty",
 *   "code": "MISSING_DESCRIPTION"
 * }
 */
export const ValidationWarningSchema = lazySchema(() => z.object({
  /**
   * Field with warning
   */
  field: z.string().describe('Field name with warning'),
  
  /**
   * Human-readable warning message
   */
  message: z.string().describe('Human-readable warning message'),
  
  /**
   * Machine-readable warning code (optional)
   */
  code: z.string().optional().describe('Machine-readable warning code'),
}));

export type ValidationWarning = z.input<typeof ValidationWarningSchema>;

/**
 * Validation Result Schema
 * Result of plugin validation operation
 * 
 * @example
 * {
 *   "valid": false,
 *   "errors": [{
 *     "field": "name",
 *     "message": "Plugin name is required",
 *     "code": "REQUIRED_FIELD"
 *   }],
 *   "warnings": [{
 *     "field": "description",
 *     "message": "Description is recommended",
 *     "code": "MISSING_DESCRIPTION"
 *   }]
 * }
 */
export const ValidationResultSchema = lazySchema(() => z.object({
  /**
   * Whether validation passed
   */
  valid: z.boolean().describe('Whether the plugin passed validation'),
  
  /**
   * Validation errors (if any)
   */
  errors: z.array(ValidationErrorSchema).optional().describe('Validation errors'),
  
  /**
   * Validation warnings (non-fatal issues)
   */
  warnings: z.array(ValidationWarningSchema).optional().describe('Validation warnings'),
}));

export type ValidationResult = z.input<typeof ValidationResultSchema>;

// ============================================================================
// Plugin Metadata Schema
// ============================================================================

/**
 * Plugin Schema
 * Metadata structure for a plugin
 * 
 * This aligns with and extends the existing PluginSchema from plugin.zod.ts
 * 
 * @example
 * {
 *   "name": "crm-plugin",
 *   "version": "1.0.0",
 *   "dependencies": ["core-plugin"]
 * }
 */
export const PluginMetadataSchema = lazySchema(() => z.object({
  /**
   * Unique plugin identifier (snake_case)
   */
  name: z.string().min(1).describe('Unique plugin identifier'),
  
  /**
   * Plugin version (semver)
   */
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional().describe('Semantic version (e.g., 1.0.0)'),
  
  /**
   * Plugin dependencies (array of plugin names)
   */
  dependencies: z.array(z.string()).optional().describe('Array of plugin names this plugin depends on (hard — a missing name fails the boot)'),

  /**
   * Soft dependencies — order-if-present (ADR-0116, #4131). The kernel
   * hoists composed names ahead exactly like `dependencies`, and silently
   * skips absent names instead of failing the boot. For plugins that
   * degrade gracefully without the dependency but must never initialize
   * before it when both are composed.
   */
  optionalDependencies: z.array(z.string()).optional().describe('Plugin names hoisted ahead when composed, skipped when absent (order-if-present, ADR-0116)'),

  /**
   * Services the plugin resolves synchronously during init() (ADR-0116).
   * The kernel validates the resolved order before Phase 1 — a required
   * service whose only declared provider initializes later is a named boot
   * error — and re-checks immediately before this plugin's init runs.
   */
  requiresServices: z.array(z.string()).optional().describe('Service names the plugin resolves synchronously during init(); validated by the kernel before Phase 1 (ADR-0116)'),

  /**
   * Services the plugin's init() UNCONDITIONALLY registers (ADR-0116).
   * Never declare a conditionally-registered service: the kernel would
   * blame orderings this plugin cannot satisfy.
   */
  providesServices: z.array(z.string()).optional().describe('Service names the plugin\'s init() unconditionally registers (ADR-0116)'),

  /**
   * Plugin signature for cryptographic verification (optional)
   */
  signature: z.string().optional().describe('Cryptographic signature for plugin verification'),
  
  /**
   * Additional plugin metadata
   */
}).passthrough().describe('Plugin metadata for validation'));

export type PluginMetadata = z.input<typeof PluginMetadataSchema>;
