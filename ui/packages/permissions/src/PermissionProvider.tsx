/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import type {
  RoleDefinition,
  ObjectPermissionConfig,
  PermissionAction,
  PermissionCheckResult,
  FieldLevelPermission,
} from '@object-ui/types';
import { PermCtx, type PermissionContextValue } from './PermissionContext.js';
import { evaluatePermission } from './evaluator.js';
import { createDiscardProofCache } from './discardProofCache.js';

export interface PermissionProviderProps {
  /** Role definitions */
  roles: RoleDefinition[];
  /** Object permission configurations */
  permissions: ObjectPermissionConfig[];
  /** Current user's role names */
  userRoles: string[];
  /** Current user context */
  user?: { id: string; [key: string]: unknown };
  /** Children */
  children: React.ReactNode;
}

/**
 * [objectui#6813] One cache per cached thing, each keyed on exactly the inputs
 * that thing is derived from — the same sets the `useCallback`/`useMemo`
 * dependency arrays named before, so nothing churns more often than it did.
 * What changes is that React can no longer discard them: a discard used to
 * hand `PermCtx.Provider` a NEW value with every permission it carries
 * unchanged, which moves the key `usePermissions()` caches on (objectui#6724)
 * and re-runs every consumer effect downstream. See `discardProofCache.ts` for
 * why this is a module-level `WeakMap` and not a `useMemo` or a `useRef`.
 */
const CHECK = createDiscardProofCache<PermissionContextValue['check']>();
const CHECK_FIELD = createDiscardProofCache<PermissionContextValue['checkField']>();
const GET_FIELD_PERMISSIONS = createDiscardProofCache<PermissionContextValue['getFieldPermissions']>();
const GET_ROW_FILTER = createDiscardProofCache<PermissionContextValue['getRowFilter']>();
const VALUE = createDiscardProofCache<PermissionContextValue>();

/**
 * Stands in for an absent `user` prop, which is optional and therefore cannot
 * key a `WeakMap` on its own. One module-level object, so "no user" is a
 * stable identity rather than a hole in the key tuple.
 */
const NO_USER: object = { user: 'absent' };

/**
 * [objectstack#3391] Role-based provider does not model the server's effective API
 * operation set — return undefined so consumers keep current behavior.
 *
 * [objectui#6813] Module-level rather than a literal rebuilt inside the value
 * factory: three consumers name this function in a dependency array
 * (`RecordDetailView`, `ObjectDataPage`, `ObjectView`), and a constant that
 * answers `undefined` for every object has nothing per-provider to close over.
 */
const NO_API_OPERATIONS: PermissionContextValue['getObjectApiOperations'] = () => undefined;

/**
 * This role-based provider has no backend answer to give — it never fetches
 * /me/permissions — so ADR-0066 system capabilities are simply unreported here
 * (`systemPermissions: undefined` below, not `[]`; objectui#4656). A literal
 * `[]` would claim "reported, holds nothing", which this provider cannot back
 * up. `hasCapabilities` stays fail-open to match. The console uses
 * MePermissionsProvider, which wires the real systemPermissions from
 * /me/permissions.
 */
const ALL_CAPABILITIES: PermissionContextValue['hasCapabilities'] = () => true;

export function PermissionProvider({
  roles,
  permissions,
  userRoles,
  user,
  children,
}: PermissionProviderProps) {
  const userKey = user ?? NO_USER;

  const check = CHECK([roles, permissions, userRoles, userKey], () =>
    (object: string, action: PermissionAction, record?: Record<string, unknown>): PermissionCheckResult => {
      return evaluatePermission({
        roles,
        permissions,
        userRoles,
        user: user ? { ...user, roles: userRoles } : { id: '', roles: userRoles },
        object,
        action,
        record,
      });
    },
  );

  const checkField = CHECK_FIELD([permissions, userRoles], () =>
    (object: string, field: string, action: 'read' | 'write' | 'create'): boolean => {
      const objectConfig = permissions.find((p) => p.object === object);
      if (!objectConfig) return true; // No config means no restrictions

      // A role's field permission has one write bit, `write`, and no
      // per-operation split: setting a field on a new record (`create`) reads
      // it exactly as changing it on an existing one does, and a field the
      // config does not mention keeps this provider's default allow for both.

      // Same guard as `evaluator.ts` (objectui#4812): a config that omits the
      // required `roles` must deny or fall through, never throw. Here the
      // fall-through lands on this function's own documented default (allow),
      // which is unchanged — the guard removes the crash, not the semantics.
      for (const role of userRoles) {
        const roleConfig = objectConfig.roles?.[role];
        if (roleConfig?.fieldPermissions) {
          const fieldPerm = roleConfig.fieldPermissions.find((fp) => fp.field === field);
          if (fieldPerm) {
            return action === 'read' ? fieldPerm.read !== false : fieldPerm.write !== false;
          }
        }
      }

      // Check defaults
      if (objectConfig.fieldDefaults) {
        const defaultPerm = objectConfig.fieldDefaults.find((fp) => fp.field === field);
        if (defaultPerm) {
          return action === 'read' ? defaultPerm.read !== false : defaultPerm.write !== false;
        }
      }

      return true; // Default allow
    },
  );

  const getFieldPermissions = GET_FIELD_PERMISSIONS([permissions, userRoles], () =>
    (object: string): FieldLevelPermission[] => {
      const objectConfig = permissions.find((p) => p.object === object);
      if (!objectConfig) return [];

      const fieldPerms: FieldLevelPermission[] = [];
      for (const role of userRoles) {
        // Missing `roles` reports no restrictions rather than throwing
        // (objectui#4812).
        const roleConfig = objectConfig.roles?.[role];
        if (roleConfig?.fieldPermissions) {
          fieldPerms.push(...roleConfig.fieldPermissions);
        }
      }
      return fieldPerms;
    },
  );

  const getRowFilter = GET_ROW_FILTER([permissions, userRoles], () =>
    (object: string): string | undefined => {
      const objectConfig = permissions.find((p) => p.object === object);
      if (!objectConfig) return undefined;

      for (const role of userRoles) {
        // Missing `roles` reports no row filter rather than throwing
        // (objectui#4812).
        const roleConfig = objectConfig.roles?.[role];
        if (roleConfig?.rowPermissions?.length) {
          return roleConfig.rowPermissions[0].filter;
        }
      }
      return undefined;
    },
  );

  // Keyed on the union of what the members above are keyed on, so this value
  // is rebuilt exactly when one of them is and never captures a stale member.
  const value = VALUE([roles, permissions, userRoles, userKey], () => ({
    check,
    checkField,
    getFieldPermissions,
    getRowFilter,
    getObjectApiOperations: NO_API_OPERATIONS,
    roles: userRoles,
    // [objectui#5683] Role-based provider never learns who the user IS —
    // unreported (`null`), so create-form current_user seeding stays
    // server-side under this provider.
    userId: null,
    // [objectui#4656] Unreported, not a reported-empty grant — see
    // `ALL_CAPABILITIES` above for the full reasoning.
    systemPermissions: undefined,
    hasCapabilities: ALL_CAPABILITIES,
    // [objectui#4421] No `/auth/me/permissions` payload: this provider resolves
    // roles from config, so `current_user.can(object, verb)` has no map to be
    // answered from here and refuses loudly rather than guessing.
    effectiveObjects: undefined,
    isLoaded: true,
  }));

  return <PermCtx.Provider value={value}>{children}</PermCtx.Provider>;
}
