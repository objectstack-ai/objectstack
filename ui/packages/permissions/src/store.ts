/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
  RoleDefinition,
  ObjectPermissionConfig,
  PermissionAction,
  PermissionCheckResult,
} from '@object-ui/types';
import { evaluatePermission } from './evaluator.js';

/**
 * Permission store for non-React contexts (e.g., API handlers, middleware).
 * Provides the same permission evaluation as the React hooks.
 */
export interface PermissionStore {
  /** Check if action is allowed */
  check: (object: string, action: PermissionAction, record?: Record<string, unknown>) => PermissionCheckResult;
  /** Update user roles */
  setUserRoles: (roles: string[]) => void;
  /** Update permissions configuration */
  setPermissions: (permissions: ObjectPermissionConfig[]) => void;
}

/**
 * Creates a permission store for non-React contexts.
 */
export function createPermissionStore(config: {
  roles: RoleDefinition[];
  permissions: ObjectPermissionConfig[];
  userRoles: string[];
  user?: { id: string; [key: string]: unknown };
}): PermissionStore {
  const { roles, user } = config;
  let { permissions, userRoles } = config;

  return {
    check: (object, action, record) =>
      evaluatePermission({
        roles,
        permissions,
        userRoles,
        user: user ? { ...user, roles: userRoles } : { id: '', roles: userRoles },
        object,
        action,
        record,
      }),
    setUserRoles: (newRoles) => {
      userRoles = newRoles;
    },
    setPermissions: (newPermissions) => {
      permissions = newPermissions;
    },
  };
}
