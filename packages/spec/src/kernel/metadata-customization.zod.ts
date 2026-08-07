// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Metadata Customization Layer Protocol
 * 
 * Defines the overlay system for managing user customizations on top of
 * package-delivered metadata. This protocol solves the critical challenge
 * of separating "vendor-managed" metadata from "customer-customized" metadata,
 * enabling safe package upgrades without losing user changes.
 * 
 * ## Architecture Alignment
 * - **Salesforce**: Managed vs Unmanaged metadata components
 * - **ServiceNow**: Update Sets with collision detection
 * - **WordPress**: Parent/child theme overlay model
 * - **Kubernetes**: Strategic merge patch for resource customization
 * 
 * ## Three-Layer Model
 * ```
 * ┌─────────────────────────────────┐
 * │  User Layer (scope: user)       │  ← Personal overrides (per-user)
 * ├─────────────────────────────────┤
 * │  Platform Layer (scope: platform)│  ← Admin customizations (per-tenant)
 * ├─────────────────────────────────┤
 * │  System Layer (scope: system)   │  ← Package-delivered metadata (read-only)
 * └─────────────────────────────────┘
 * ```
 * 
 * ## Merge Resolution Order
 * Effective metadata = System ← merge(Platform) ← merge(User)
 * Each layer only stores the delta (changed fields), not the full definition.
 */

// ==========================================
// Customization Tracking
// ==========================================

/**
 * Customization Origin
 * Identifies who created the customization.
 */
import { lazySchema } from '../shared/lazy-schema';
export const CustomizationOriginSchema = lazySchema(() => z.enum([
  'package',   // Delivered by a plugin package (system layer, read-only)
  'admin',     // Created/modified by platform admin via UI
  'user',      // Created/modified by end user via UI
  'migration', // Created during data migration
  'api',       // Created via API
]));

/**
 * Field-Level Change Tracking
 * Records exactly which fields were modified by the customer.
 */
export const FieldChangeSchema = lazySchema(() => z.object({
  /** JSON path to the changed field (e.g. "fields.status.label") */
  path: z.string().describe('JSON path to the changed field'),

  /** Original value from the package (for diff/rollback) */
  originalValue: z.unknown().optional().describe('Original value from the package'),

  /** Current customized value */
  currentValue: z.unknown().describe('Current customized value'),

  /** Who made this change */
  changedBy: z.string().optional().describe('User or admin who made this change'),

  /** When this change was made */
  changedAt: z.string().datetime().optional().describe('Timestamp of the change'),
}));

/**
 * Metadata Overlay Schema
 * 
 * Represents a customization layer on top of package-delivered metadata.
 * Each overlay stores only the delta (changed fields) relative to the base definition.
 * 
 * During package upgrades, the system performs a 3-way merge:
 * 1. Old package version (base)
 * 2. New package version (theirs)
 * 3. Customer customizations (ours)
 * 
 * **Note on `baseName`:** customization records reference metadata by its
 * Fully Qualified Name (FQN, `{namespace}__{shortName}`). FQN is used here
 * because customizations cross package boundaries and need to disambiguate
 * objects with the same short name from different packages. This is one of
 * the few internal contexts where FQN is appropriate — user-facing code and
 * AI-generated examples should always use short names instead.
 *
 * @example
 * ```yaml
 * # Package delivers: object "account" with field "status" label "Status"
 * # Admin changes label to "Account Status"
 * # Overlay record:
 * baseType: object
 * baseName: account
 * packageId: com.acme.crm
 * packageVersion: "1.0.0"
 * changes:
 *   - path: "fields.status.label"
 *     originalValue: "Status"
 *     currentValue: "Account Status"
 * ```
 */
export const MetadataOverlaySchema = lazySchema(() => z.object({
  /** Primary key */
  id: z.string().describe('Overlay record ID (UUID)'),

  /** The metadata type being customized (e.g. "object", "view", "flow") */
  baseType: z.string().describe('Metadata type being customized'),

  /** The metadata name being customized (e.g. "account") */
  baseName: z.string().describe('Metadata name being customized'),

  /** Package that owns the base metadata (null for platform-created metadata) */
  packageId: z.string().optional().describe('Package ID that delivered the base metadata'),

  /** Package version when the customization was made (for upgrade diffing) */
  packageVersion: z.string().optional().describe('Package version when overlay was created'),

  /** Customization scope */
  scope: z.enum(['platform', 'user']).default('platform')
    .describe('Customization scope (platform=admin, user=personal)'),

  /** Tenant ID for multi-tenant isolation */
  tenantId: z.string().optional().describe('Tenant identifier'),

  /** Owner user ID (for user-scope overlays) */
  owner: z.string().optional().describe('Owner user ID for user-scope overlays'),

  /**
   * The overlay payload.
   * Contains only the changed fields, using JSON Merge Patch semantics (RFC 7396).
   * - To modify a field: include the field with its new value
   * - To delete a field: set its value to null
   * - Omitted fields remain unchanged from base
   */
  patch: z.record(z.string(), z.unknown()).describe('JSON Merge Patch payload (changed fields only)'),

  /**
   * Detailed change tracking for each modified field.
   * Enables field-level conflict detection during upgrades.
   */
  changes: z.array(FieldChangeSchema).optional()
    .describe('Field-level change tracking for conflict detection'),

  /** Whether this overlay is currently active */
  active: z.boolean().default(true).describe('Whether this overlay is active'),

  /** Audit timestamps */
  createdAt: z.string().datetime().optional(),
  createdBy: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
  updatedBy: z.string().optional(),
}));

// ==========================================
// Merge & Conflict Resolution
// ==========================================

/**
 * Merge Conflict
 * Represents a conflict between package update and customer customization.
 */
export const MergeConflictSchema = lazySchema(() => z.object({
  /** JSON path to the conflicting field */
  path: z.string().describe('JSON path to the conflicting field'),

  /** Value in the old package version */
  baseValue: z.unknown().describe('Value in the old package version'),

  /** Value in the new package version */
  incomingValue: z.unknown().describe('Value in the new package version'),

  /** Customer's customized value */
  customValue: z.unknown().describe('Customer customized value'),

  /** Suggested resolution strategy */
  suggestedResolution: z.enum([
    'keep-custom',   // Keep customer's customization
    'accept-incoming', // Accept package update
    'manual',        // Requires manual resolution
  ]).describe('Suggested resolution strategy'),

  /** Reason for the suggested resolution */
  reason: z.string().optional().describe('Explanation for the suggested resolution'),
}));

/**
 * Merge Strategy Configuration
 * Controls how metadata merging behaves during package upgrades.
 */
export const MergeStrategyConfigSchema = lazySchema(() => z.object({
  /** Default strategy when no field-level rule matches */
  defaultStrategy: z.enum([
    'keep-custom',     // Preserve all customer customizations (safe)
    'accept-incoming', // Accept all package updates (overwrite)
    'three-way-merge', // Intelligent 3-way merge with conflict detection
  ]).default('three-way-merge').describe('Default merge strategy'),

  /** 
   * Field paths that should always accept incoming package updates.
   * Use for fields that the package vendor considers "owned" and should not be customized.
   * @example ["fields.*.type", "triggers.*"]
   */
  alwaysAcceptIncoming: z.array(z.string()).optional()
    .describe('Field paths that always accept package updates'),

  /**
   * Field paths where customer customizations always win.
   * Use for UI-facing fields like labels, descriptions, help text.
   * @example ["fields.*.label", "fields.*.helpText", "description"]
   */
  alwaysKeepCustom: z.array(z.string()).optional()
    .describe('Field paths where customer customizations always win'),

  /** Whether to automatically resolve non-conflicting changes */
  autoResolveNonConflicting: z.boolean().default(true)
    .describe('Auto-resolve changes that do not conflict'),
}));

/**
 * Merge Result
 * Result of a 3-way merge operation during package upgrade.
 */
export const MergeResultSchema = lazySchema(() => z.object({
  /** Whether the merge completed successfully (no unresolved conflicts) */
  success: z.boolean().describe('Whether merge completed without unresolved conflicts'),

  /** The merged metadata payload */
  mergedMetadata: z.record(z.string(), z.unknown()).optional()
    .describe('Merged metadata result'),

  /** Updated overlay with remaining customizations */
  updatedOverlay: z.record(z.string(), z.unknown()).optional()
    .describe('Updated overlay after merge'),

  /** List of conflicts that require manual resolution */
  conflicts: z.array(MergeConflictSchema).optional()
    .describe('Unresolved merge conflicts'),

  /** Summary of automatically resolved changes */
  autoResolved: z.array(z.object({
    path: z.string(),
    resolution: z.string(),
    description: z.string().optional(),
  })).optional().describe('Summary of auto-resolved changes'),

  /** Statistics */
  stats: z.object({
    totalFields: z.number().int().min(0).describe('Total fields evaluated'),
    unchanged: z.number().int().min(0).describe('Fields with no changes'),
    autoResolved: z.number().int().min(0).describe('Fields auto-resolved'),
    conflicts: z.number().int().min(0).describe('Fields with conflicts'),
  }).optional(),
}));

// ==========================================
// Customization Management
// ==========================================

/**
 * Customizable Metadata Policy
 * Defines what parts of a metadata item can be customized by admins/users.
 * Package vendors use this to control customization boundaries.
 */
export const CustomizationPolicySchema = lazySchema(() => z.object({
  /** Metadata type this policy applies to */
  metadataType: z.string().describe('Metadata type (e.g. "object", "view")'),

  /** Whether customization is allowed at all for this type */
  allowCustomization: z.boolean().default(true),

  /**
   * Field paths that are locked (cannot be customized).
   * @example ["name", "type", "fields.*.type"]
   */
  lockedFields: z.array(z.string()).optional()
    .describe('Field paths that cannot be customized'),

  /**
   * Field paths that are customizable.
   * If specified, only these fields can be customized (whitelist mode).
   * @example ["label", "description", "fields.*.label", "fields.*.helpText"]
   */
  customizableFields: z.array(z.string()).optional()
    .describe('Field paths that can be customized (whitelist)'),

  /**
   * Whether users can add new fields to package objects.
   * When true, admins can extend package objects with custom fields.
   */
  allowAddFields: z.boolean().default(true)
    .describe('Whether admins can add new fields to package objects'),

  /**
   * Whether users can delete package-delivered fields.
   * Typically false — fields can only be hidden, not deleted.
   */
  allowDeleteFields: z.boolean().default(false)
    .describe('Whether admins can delete package-delivered fields'),
}));

// ==========================================
// Export Types
// ==========================================

export type CustomizationOrigin = z.infer<typeof CustomizationOriginSchema>;
export type FieldChange = z.infer<typeof FieldChangeSchema>;
export type MetadataOverlay = z.infer<typeof MetadataOverlaySchema>;
/** Post-parse shape of {@link MetadataOverlay} — defaults applied, transforms run (ADR-0122). */
export type MetadataOverlayParsed = z.infer<typeof MetadataOverlaySchema>;
export type MergeConflict = z.infer<typeof MergeConflictSchema>;
export type MergeStrategyConfig = z.infer<typeof MergeStrategyConfigSchema>;
/** Post-parse shape of {@link MergeStrategyConfig} — defaults applied, transforms run (ADR-0122). */
export type MergeStrategyConfigParsed = z.infer<typeof MergeStrategyConfigSchema>;
export type MergeResult = z.infer<typeof MergeResultSchema>;
export type CustomizationPolicy = z.infer<typeof CustomizationPolicySchema>;
/** Post-parse shape of {@link CustomizationPolicy} — defaults applied, transforms run (ADR-0122). */
export type CustomizationPolicyParsed = z.infer<typeof CustomizationPolicySchema>;
