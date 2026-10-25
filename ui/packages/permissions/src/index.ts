/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/permissions
 * 
 * RBAC permission system for Object UI providing:
 * - PermissionProvider context for React apps
 * - usePermissions hook for checking access
 * - PermissionGuard component for conditional rendering
 * - Permission evaluation engine
 * - Field-level and row-level permission support
 * 
 * @packageDocumentation
 */

export { PermissionProvider, type PermissionProviderProps } from './PermissionProvider.js';
export { MePermissionsProvider, type MePermissionsProviderProps, type MePermissionsResponse } from './MePermissionsProvider.js';
export { ServerReadScope, type ServerReadScopeProps } from './ServerReadScope.js';
export { usePermissions } from './usePermissions.js';
export { useFieldPermissions } from './useFieldPermissions.js';
export { PermissionGuard, type PermissionGuardProps } from './PermissionGuard.js';
export { evaluatePermission } from './evaluator.js';
export { createPermissionStore, type PermissionStore } from './store.js';

// Re-export types for convenience
export type {
  PermissionAction,
  PermissionEffect,
  RoleDefinition,
  FieldLevelPermission,
  RowLevelPermission,
  PermissionCondition,
  ObjectPermissionConfig,
  SharingRuleConfig,
  PermissionCheckResult,
  PermissionContext,
  // `PermissionGuardConfig` RETIRED by objectui#8024 — see the RETIRED note
  // in `@object-ui/types`' `permissions.ts`. Author a guard against
  // `PermissionGuardProps`, exported beside `PermissionGuard` above.
} from '@object-ui/types';
