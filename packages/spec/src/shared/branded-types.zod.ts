// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema, SystemIdentifierSchema } from './identifiers.zod';

/**
 * Branded Types for ObjectStack Identifiers
 *
 * Branded types provide compile-time safety by preventing accidental mixing
 * of different identifier kinds. For example, you cannot pass an ObjectName
 * where a FieldName is expected, even though both are strings at runtime.
 *
 * @example
 * <!-- os:check -->
 * ```ts
 * import { ObjectNameSchema, FieldNameSchema } from '@objectstack/spec/shared';
 *
 * const objName = ObjectNameSchema.parse('project_task');   // ObjectName
 * const fieldName = FieldNameSchema.parse('task_name');     // FieldName
 *
 * // TypeScript will catch this at compile time:
 * // const fn: FieldName = objName; // Error!
 * ```
 */

/**
 * ObjectName — Branded type for business object names.
 *
 * Must be snake_case (no dots). Used for table/collection names.
 *
 * @example 'project_task', 'crm_account', 'user_profile'
 */
import { lazySchema } from './lazy-schema';
export const ObjectNameSchema = lazySchema(() => SnakeCaseIdentifierSchema
  .brand<'ObjectName'>()
  .describe('Branded object name (snake_case, no dots)'));

export type ObjectName = z.input<typeof ObjectNameSchema>;
/** Post-parse shape of {@link ObjectName} — defaults applied, transforms run (ADR-0122). */
export type ObjectNameParsed = z.infer<typeof ObjectNameSchema>;

/**
 * FieldName — Branded type for field (column) names.
 *
 * Must be snake_case (no dots). Used for column/property names within objects.
 *
 * @example 'first_name', 'created_at', 'total_amount'
 */
export const FieldNameSchema = lazySchema(() => SnakeCaseIdentifierSchema
  .brand<'FieldName'>()
  .describe('Branded field name (snake_case, no dots)'));

export type FieldName = z.input<typeof FieldNameSchema>;
/** Post-parse shape of {@link FieldName} — defaults applied, transforms run (ADR-0122). */
export type FieldNameParsed = z.infer<typeof FieldNameSchema>;

/**
 * ViewName — Branded type for view identifiers.
 *
 * Must be a valid system identifier (lowercase, may contain dots for namespacing).
 *
 * @example 'all_tasks', 'my_open_deals', 'contact.recent'
 */
export const ViewNameSchema = lazySchema(() => SystemIdentifierSchema
  .brand<'ViewName'>()
  .describe('Branded view name (system identifier)'));

export type ViewName = z.input<typeof ViewNameSchema>;
/** Post-parse shape of {@link ViewName} — defaults applied, transforms run (ADR-0122). */
export type ViewNameParsed = z.infer<typeof ViewNameSchema>;

/**
 * AppName — Branded type for application identifiers.
 *
 * Must be a valid system identifier.
 *
 * @example 'crm', 'helpdesk', 'project_management'
 */
export const AppNameSchema = lazySchema(() => SystemIdentifierSchema
  .brand<'AppName'>()
  .describe('Branded app name (system identifier)'));

export type AppName = z.input<typeof AppNameSchema>;
/** Post-parse shape of {@link AppName} — defaults applied, transforms run (ADR-0122). */
export type AppNameParsed = z.infer<typeof AppNameSchema>;

/**
 * FlowName — Branded type for flow identifiers.
 *
 * Must be a valid system identifier.
 *
 * @example 'approval_flow', 'onboarding_wizard', 'lead_qualification'
 */
export const FlowNameSchema = lazySchema(() => SystemIdentifierSchema
  .brand<'FlowName'>()
  .describe('Branded flow name (system identifier)'));

export type FlowName = z.input<typeof FlowNameSchema>;
/** Post-parse shape of {@link FlowName} — defaults applied, transforms run (ADR-0122). */
export type FlowNameParsed = z.infer<typeof FlowNameSchema>;

/**
 * RoleName — Branded type for role identifiers.
 *
 * Must be a valid system identifier.
 *
 * @example 'admin', 'sales_manager', 'read_only'
 */
export const RoleNameSchema = lazySchema(() => SystemIdentifierSchema
  .brand<'RoleName'>()
  .describe('Branded role name (system identifier)'));

export type RoleName = z.input<typeof RoleNameSchema>;
/** Post-parse shape of {@link RoleName} — defaults applied, transforms run (ADR-0122). */
export type RoleNameParsed = z.infer<typeof RoleNameSchema>;
