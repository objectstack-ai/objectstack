// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Deploy Bundle Protocol
 *
 * Defines the schemas for metadata-driven deployment:
 * Schema Push → Zod Validate → Diff → DDL Sync → Register
 *
 * This eliminates traditional CI/CD pipelines for schema changes.
 * A "deploy" is a bundle of metadata (objects, views, flows, permissions)
 * that is validated, diffed against the current state, and applied
 * as DDL migrations directly to the tenant database.
 *
 * Target: 2-5 second deploys vs. 2-15 minute traditional Docker/CI/CD.
 */

// ==========================================================================
// 1. Deploy Status
// ==========================================================================

/**
 * Deployment lifecycle status.
 */
import { lazySchema } from '../shared/lazy-schema';
export const DeployStatusEnum = z.enum([
  'validating',   // Zod schema validation in progress
  'diffing',      // Comparing desired state vs current state
  'migrating',    // Executing DDL statements
  'registering',  // Updating metadata registry
  'ready',        // Deployment complete and live
  'failed',       // Deployment failed at some stage
  'rolling_back', // Rollback in progress
]).describe('Deployment lifecycle status');

export type DeployStatus = z.input<typeof DeployStatusEnum>;

// ==========================================================================
// 2. Deploy Diff
// ==========================================================================

/**
 * Schema change descriptor for a single entity (object/field).
 */
export const SchemaChangeSchema = lazySchema(() => z.object({
  /** Type of entity being changed */
  entityType: z.enum(['object', 'field', 'index', 'view', 'flow', 'permission']).describe('Entity type'),

  /** Name of the entity */
  entityName: z.string().min(1).describe('Entity name'),

  /** Parent entity name (e.g., object name for a field change) */
  parentEntity: z.string().optional().describe('Parent entity name'),

  /** Type of change */
  changeType: z.enum(['added', 'modified', 'removed']).describe('Change type'),

  /** Previous value (for modified/removed) */
  oldValue: z.unknown().optional().describe('Previous value'),

  /** New value (for added/modified) */
  newValue: z.unknown().optional().describe('New value'),
}).describe('Individual schema change'));

export type SchemaChange = z.input<typeof SchemaChangeSchema>;

/**
 * Deploy Diff — what changed between current and desired state.
 */
export const DeployDiffSchema = lazySchema(() => z.object({
  /** List of all schema changes */
  changes: z.array(SchemaChangeSchema).default([]).describe('List of schema changes'),

  /** Summary counts */
  summary: z.object({
    added: z.number().int().min(0).default(0).describe('Number of added entities'),
    modified: z.number().int().min(0).default(0).describe('Number of modified entities'),
    removed: z.number().int().min(0).default(0).describe('Number of removed entities'),
  }).describe('Change summary counts'),

  /** Whether the diff contains breaking changes (e.g., column removal) */
  hasBreakingChanges: z.boolean().default(false).describe('Whether diff contains breaking changes'),
}).describe('Schema diff between current and desired state'));

export type DeployDiff = z.input<typeof DeployDiffSchema>;
/** Post-parse shape of {@link DeployDiff} — defaults applied, transforms run (ADR-0122). */
export type DeployDiffParsed = z.infer<typeof DeployDiffSchema>;

// ==========================================================================
// 3. Migration Plan
// ==========================================================================

/**
 * A single DDL migration statement.
 */
export const MigrationStatementSchema = lazySchema(() => z.object({
  /** SQL DDL statement to execute */
  sql: z.string().min(1).describe('SQL DDL statement'),

  /** Whether this statement is reversible */
  reversible: z.boolean().default(true).describe('Whether the statement can be reversed'),

  /** Reverse SQL statement (for rollback) */
  rollbackSql: z.string().optional().describe('Reverse SQL for rollback'),

  /** Execution order (lower = earlier) */
  order: z.number().int().min(0).describe('Execution order'),
}).describe('Single DDL migration statement'));

export type MigrationStatement = z.input<typeof MigrationStatementSchema>;
/** Post-parse shape of {@link MigrationStatement} — defaults applied, transforms run (ADR-0122). */
export type MigrationStatementParsed = z.infer<typeof MigrationStatementSchema>;

/**
 * Migration Plan — ordered list of DDL statements to execute.
 */
export const MigrationPlanSchema = lazySchema(() => z.object({
  /** Ordered list of migration statements */
  statements: z.array(MigrationStatementSchema).default([]).describe('Ordered DDL statements'),

  /** SQL dialect the statements are written for */
  dialect: z.string().min(1).describe('Target SQL dialect'),

  /** Whether the entire plan is reversible */
  reversible: z.boolean().default(true).describe('Whether the plan can be fully rolled back'),

  /** Estimated execution time in milliseconds */
  estimatedDurationMs: z.number().int().min(0).optional().describe('Estimated execution time'),
}).describe('Ordered migration plan'));

export type MigrationPlan = z.input<typeof MigrationPlanSchema>;
/** Post-parse shape of {@link MigrationPlan} — defaults applied, transforms run (ADR-0122). */
export type MigrationPlanParsed = z.infer<typeof MigrationPlanSchema>;

// ==========================================================================
// 4. Deploy Validation
// ==========================================================================

/**
 * Validation issue found during bundle validation.
 */
export const DeployValidationIssueSchema = lazySchema(() => z.object({
  /** Severity of the issue */
  severity: z.enum(['error', 'warning', 'info']).describe('Issue severity'),

  /** Entity path where the issue was found */
  path: z.string().describe('Entity path (e.g., objects.project_task.fields.name)'),

  /** Human-readable issue description */
  message: z.string().describe('Issue description'),

  /** Zod error code if applicable */
  code: z.string().optional().describe('Validation error code'),
}).describe('Validation issue'));

export type DeployValidationIssue = z.input<typeof DeployValidationIssueSchema>;

/**
 * Zod validation result for the entire deploy bundle.
 */
export const DeployValidationResultSchema = lazySchema(() => z.object({
  /** Whether the bundle passed validation */
  valid: z.boolean().describe('Whether the bundle is valid'),

  /** List of validation issues */
  issues: z.array(DeployValidationIssueSchema).default([]).describe('Validation issues'),

  /** Number of errors */
  errorCount: z.number().int().min(0).default(0).describe('Number of errors'),

  /** Number of warnings */
  warningCount: z.number().int().min(0).default(0).describe('Number of warnings'),
}).describe('Bundle validation result'));

export type DeployValidationResult = z.input<typeof DeployValidationResultSchema>;
/** Post-parse shape of {@link DeployValidationResult} — defaults applied, transforms run (ADR-0122). */
export type DeployValidationResultParsed = z.infer<typeof DeployValidationResultSchema>;

// ==========================================================================
// 5. Deploy Bundle & Manifest
// ==========================================================================

/**
 * Deploy Manifest — metadata about the deployment.
 */
export const DeployManifestSchema = lazySchema(() => z.object({
  /** Deployment version (semver) */
  version: z.string().min(1).describe('Deployment version'),

  /** SHA256 checksum of the bundle contents */
  checksum: z.string().optional().describe('SHA256 checksum'),

  /** Object definitions included in this deployment */
  objects: z.array(z.string()).default([]).describe('Object names included'),

  /** View definitions included */
  views: z.array(z.string()).default([]).describe('View names included'),

  /** Flow definitions included */
  flows: z.array(z.string()).default([]).describe('Flow names included'),

  /** Permission definitions included */
  permissions: z.array(z.string()).default([]).describe('Permission names included'),

  /** Timestamp of bundle creation (ISO 8601) */
  createdAt: z.string().datetime().optional().describe('Bundle creation time'),
}).describe('Deployment manifest'));

export type DeployManifest = z.input<typeof DeployManifestSchema>;
/** Post-parse shape of {@link DeployManifest} — defaults applied, transforms run (ADR-0122). */
export type DeployManifestParsed = z.infer<typeof DeployManifestSchema>;

/**
 * Deploy Bundle — container for all metadata being deployed.
 * This is the primary input to the deploy pipeline.
 */
export const DeployBundleSchema = lazySchema(() => z.object({
  /** Bundle manifest with version and contents list */
  manifest: DeployManifestSchema,

  /** Object definitions (JSON-serialized ObjectStack objects) */
  objects: z.array(z.record(z.string(), z.unknown())).default([]).describe('Object definitions'),

  /** View definitions */
  views: z.array(z.record(z.string(), z.unknown())).default([]).describe('View definitions'),

  /** Flow definitions */
  flows: z.array(z.record(z.string(), z.unknown())).default([]).describe('Flow definitions'),

  /** Permission definitions */
  permissions: z.array(z.record(z.string(), z.unknown())).default([]).describe('Permission definitions'),

  /** Seed data records to populate after schema migration */
  seedData: z.array(z.record(z.string(), z.unknown())).default([]).describe('Seed data records'),
}).describe('Deploy bundle containing all metadata for deployment'));

export type DeployBundle = z.input<typeof DeployBundleSchema>;
/** Post-parse shape of {@link DeployBundle} — defaults applied, transforms run (ADR-0122). */
export type DeployBundleParsed = z.infer<typeof DeployBundleSchema>;
