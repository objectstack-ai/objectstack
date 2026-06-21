// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';

/**
 * Role Schema (aka Business Unit / Org Unit)
 * Defines the organizational hierarchy (Reporting Structure).
 * 
 * COMPARISON:
 * - Salesforce: "Role" (Hierarchy for visibility rollup)
 * - Microsoft: "Business Unit" (Structural container for data)
 * - Kubernetes/AWS: "Role" usually refers to Permissions (we use PermissionSet for that)
 * 
 * ROLES IN OBJECTSTACK:
 * Used primarily for "Reporting Structure" - Managers see subordinates' data.
 * 
 * **NAMING CONVENTION:**
 * Role names MUST be lowercase snake_case to prevent security issues.
 * 
 * @example Good role names
 * - 'sales_manager'
 * - 'ceo'
 * - 'region_east_vp'
 * - 'engineering_lead'
 * 
 * @example Bad role names (will be rejected)
 * - 'SalesManager' (camelCase)
 * - 'CEO' (uppercase)
 * - 'Region East VP' (spaces and uppercase)
 */
import { lazySchema } from '../shared/lazy-schema';
export const RoleSchema = lazySchema(() => z.object({
  /** Identity */
  name: SnakeCaseIdentifierSchema.describe('Unique role name (lowercase snake_case)'),
  label: z.string().describe('Display label (e.g. VP of Sales)'),
  
  /** Hierarchy */
  parent: z.string().optional().describe('Parent Role ID (Reports To)'),
  
  /** Description */
  description: z.string().optional(),
}));

export type Role = z.infer<typeof RoleSchema>;
/** Authoring input for {@link Role} — defaulted fields are optional. */
export type RoleInput = z.input<typeof RoleSchema>;

/**
 * Type-safe factory for a role in the role hierarchy. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Role` literal.
 */
export function defineRole(config: z.input<typeof RoleSchema>): Role {
  return RoleSchema.parse(config);
}
