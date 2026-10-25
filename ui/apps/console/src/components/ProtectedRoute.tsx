// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Console's authenticated-route wrapper and its auth-redirect contract.
 *
 * Lifted out of `App.tsx` verbatim (objectui#2794) so routes declared in their
 * own modules — and tests that need to exercise the REAL redirect rather than a
 * transcription of it — can reach the same one. Both were module-private in
 * `App.tsx`, so the move adds a seam without widening any published surface,
 * and nothing about the behaviour changed.
 */

import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AuthGuard } from '@object-ui/auth';
import {
  ConnectedShell,
  RequireOrganization,
  LoadingFallback,
  RedirectWithSplash,
} from '@object-ui/app-shell';

/**
 * Where an unauthenticated visitor to a protected route goes.
 *
 * The `?redirect=` target is read off the ROUTER's location, never
 * `window.location` — the Console is mounted under a `<base href>` basename in
 * every embedded deployment, so a window-derived path would carry the `/_console`
 * mount into a value that `LoginPage` then re-prefixes with it (objectui#4168).
 */
export function LoginRedirect() {
  const location = useLocation();
  const redirect = location.pathname + location.search;
  const search = redirect && redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : '';
  // `RedirectWithSplash`, not a bare `<Navigate>` (objectui#6378): this element
  // replaces the `LoadingFallback` the SAME `AuthGuard` was rendering one state
  // earlier, and a bare redirect renders null — measured, that left the viewport
  // blank for 41 ms while `/login` rendered at transition priority.
  return <RedirectWithSplash to={`/login${search}`} replace />;
}

/**
 * ProtectedRoute — replaces app-shell's AuthenticatedRoute. Same composition
 * (AuthGuard + ConnectedShell + optional RequireOrganization) but redirects
 * unauthenticated visitors to the Console-hosted /login (preserving the
 * original Console path as `?redirect=…`).
 */
export function ProtectedRoute({
  children,
  requireOrganization = true,
}: {
  children: ReactNode;
  requireOrganization?: boolean;
}) {
  return (
    <AuthGuard fallback={<LoginRedirect />} loadingFallback={<LoadingFallback />}>
      <ConnectedShell>
        {requireOrganization ? <RequireOrganization>{children}</RequireOrganization> : children}
      </ConnectedShell>
    </AuthGuard>
  );
}
