/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { useAuth } from './useAuth.js';

export interface AuthGuardProps {
  /** Content to render when user is not authenticated */
  fallback?: React.ReactNode;
  /**
   * Required position/role names — the user must hold at least one.
   *
   * Matched against `user.positions`, the one published spelling (framework
   * ADR-0090 D3), falling back to the single `user.role` scalar only when the
   * session carries no `positions` key at all (synthetic guest / legacy
   * identities). The retired `roles` spelling is not read.
   */
  requiredRoles?: string[];
  /** Required permissions (user must have all) */
  requiredPermissions?: string[];
  /** Content to render when loading */
  loadingFallback?: React.ReactNode;
  /** Children to render when authenticated */
  children: React.ReactNode;
}

/**
 * Route guard component that conditionally renders children
 * based on authentication and authorization state.
 *
 * @example
 * ```tsx
 * <AuthGuard fallback={<Navigate to="/login" />}>
 *   <ProtectedPage />
 * </AuthGuard>
 *
 * <AuthGuard requiredRoles={['admin']} fallback={<AccessDenied />}>
 *   <AdminPanel />
 * </AuthGuard>
 * ```
 */
export function AuthGuard({
  fallback = null,
  requiredRoles,
  loadingFallback,
  children,
}: AuthGuardProps) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <>{loadingFallback ?? null}</>;
  }

  if (!isAuthenticated) {
    return <>{fallback}</>;
  }

  // Check role requirements.
  //
  // `positions` is the ONE published spelling (framework ADR-0090 D3 renamed
  // `roles` → `positions` with no deprecation window; maintainer ruling on
  // objectui#5424). When the session carries the key — protocol 17 always
  // emits it — it is the whole answer, empty included: falling back to the
  // coarse `user.role` scalar when the server said "no positions" would be
  // exactly the over-admission this gate used to have (`role: 'admin'`
  // passing a gate meant for an `admin` position). The scalar fallback exists
  // for identities that lack the key entirely: the guest user the provider
  // seeds when auth is disabled, and pre-positions deployments. The retired
  // `roles` spelling is deliberately NOT read — resurrecting it as a fallback
  // dialect is what ADR-0090 D3 forbids
  // (`__tests__/authGuardPositions-5424.test.tsx` pins the refusal).
  if (requiredRoles && requiredRoles.length > 0 && user) {
    const userRoles = user.positions ?? (user.role ? [user.role] : []);
    const hasRole = requiredRoles.some((role) => userRoles.includes(role));
    if (!hasRole) {
      return <>{fallback}</>;
    }
  }

  return <>{children}</>;
}
