/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import type { PermissionAction } from '@object-ui/types';
import { usePermissions } from './usePermissions.js';

export interface PermissionGuardProps {
  /** Target object name */
  object: string;
  /** Required action */
  action: PermissionAction;
  /** Fallback behavior when denied */
  fallback?: 'hide' | 'disable' | 'custom';
  /** Custom fallback content */
  fallbackContent?: React.ReactNode;
  /** Children to render when permitted */
  children: React.ReactNode;
}

/**
 * Guard component that conditionally renders children based on permissions.
 * Hides, disables, or shows custom content when access is denied.
 */
export function PermissionGuard({
  object,
  action,
  fallback = 'hide',
  fallbackContent,
  children,
}: PermissionGuardProps) {
  const { can } = usePermissions();

  const isAllowed = can(object, action);

  if (isAllowed) {
    return <>{children}</>;
  }

  switch (fallback) {
    case 'hide':
      return null;
    case 'disable':
      return (
        <div style={{ opacity: 0.5, pointerEvents: 'none' }} aria-disabled="true">
          {children}
        </div>
      );
    case 'custom':
      return <>{fallbackContent ?? null}</>;
    default:
      return null;
  }
}
