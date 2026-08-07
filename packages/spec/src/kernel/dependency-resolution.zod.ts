// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Dependency Resolution Protocol
 *
 * Defines schemas for runtime dependency resolution when installing,
 * upgrading, or managing packages. Provides a standardized way to
 * express dependency conflicts, resolution results, and installation order.
 *
 * ## Architecture Alignment
 * - **npm**: Dependency tree resolution with conflict detection
 * - **Helm**: Dependency management with version constraints
 * - **Salesforce**: Package dependency validation at install time
 *
 * ## Resolution Flow
 * ```
 * 1. Parse manifest.dependencies (SemVer ranges)
 * 2. Check installed packages registry
 * 3. Resolve each dependency → satisfied | needs_install | needs_upgrade | conflict
 * 4. Detect circular dependencies
 * 5. Compute topological install order
 * 6. Return resolution result with required actions
 * ```
 */

// ==========================================
// Dependency Resolution Status
// ==========================================

/**
 * Resolution status for a single dependency.
 */
import { lazySchema } from '../shared/lazy-schema';
export const DependencyStatusEnum = z.enum([
  'satisfied',      // Already installed and version compatible
  'needs_install',  // Not installed, needs to be installed
  'needs_upgrade',  // Installed but version incompatible, needs upgrade
  'conflict',       // Conflicts with another package's dependency
]).describe('Resolution status for a dependency');

export type DependencyStatus = z.input<typeof DependencyStatusEnum>;

// ==========================================
// Resolved Dependency
// ==========================================

/**
 * Single dependency resolution result.
 * Describes the state of one dependency after resolution.
 */
export const ResolvedDependencySchema = lazySchema(() => z.object({
  /** Package identifier of the dependency */
  packageId: z.string().describe('Dependency package identifier'),

  /** SemVer range required by the parent package */
  requiredRange: z.string().describe('SemVer range required (e.g. "^2.0.0")'),

  /** Actual version resolved (if available) */
  resolvedVersion: z.string().optional()
    .describe('Actual version resolved from registry'),

  /** Currently installed version (if any) */
  installedVersion: z.string().optional()
    .describe('Currently installed version'),

  /** Resolution status */
  status: DependencyStatusEnum.describe('Resolution status'),

  /** Conflict details (when status is "conflict") */
  conflictReason: z.string().optional()
    .describe('Explanation of the conflict'),
}).describe('Resolution result for a single dependency'));

export type ResolvedDependency = z.input<typeof ResolvedDependencySchema>;

// ==========================================
// Required Action
// ==========================================

/**
 * An action required before installation can proceed.
 */
export const RequiredActionSchema = lazySchema(() => z.object({
  /** Type of action required */
  type: z.enum(['install', 'upgrade', 'confirm_conflict'])
    .describe('Type of action required'),

  /** Target package identifier */
  packageId: z.string().describe('Target package identifier'),

  /** Human-readable description of the action */
  description: z.string().describe('Human-readable action description'),
}).describe('Action required before installation can proceed'));

export type RequiredAction = z.input<typeof RequiredActionSchema>;

// ==========================================
// Dependency Resolution Result
// ==========================================

/**
 * Complete dependency resolution result.
 * Aggregates all dependency statuses and computes installation feasibility.
 */
export const DependencyResolutionResultSchema = lazySchema(() => z.object({
  /** All dependencies and their resolution results */
  dependencies: z.array(ResolvedDependencySchema)
    .describe('Resolution result for each dependency'),

  /** Whether installation can proceed without conflicts */
  canProceed: z.boolean()
    .describe('Whether installation can proceed'),

  /** Actions that require user confirmation or system execution */
  requiredActions: z.array(RequiredActionSchema)
    .describe('Actions required before proceeding'),

  /** Topologically sorted package IDs for installation order */
  installOrder: z.array(z.string())
    .describe('Topologically sorted package IDs for installation'),

  /** Detected circular dependency chains */
  circularDependencies: z.array(z.array(z.string())).optional()
    .describe('Circular dependency chains detected (e.g. [["A", "B", "A"]])'),
}).describe('Complete dependency resolution result'));

export type DependencyResolutionResult = z.input<typeof DependencyResolutionResultSchema>;
