// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/setup` — one URL, two surfaces (objectui#2794).
 *
 * The policy, and why the verdict is latched, live in `./setupEntry`. This file
 * is only the mapping from verdict to element:
 *
 *  - a deployment with no owner yet → the first-run bootstrap wizard, exactly
 *    as before this card;
 *  - every other deployment → the stable platform-administration deep link. It
 *    goes through `ProtectedRoute`, so an unauthenticated visitor gets this
 *    host's ONE auth-redirect contract (`/login?redirect=%2Fsetup`, built by
 *    `LoginRedirect` from the ROUTER's location) and lands back here after
 *    signing in. `requireOrganization={false}` for the same reason `/` uses it:
 *    this route only redirects, so the org gate belongs to the destination.
 */

import { SetupRedirect, LoadingFallback } from '@object-ui/app-shell';

import { ProtectedRoute } from './ProtectedRoute';
import { useSetupEntryMode } from './setupEntry';
import { SetupPage } from '../pages/auth/SetupPage';

export function SetupRoute() {
  const mode = useSetupEntryMode();
  if (mode === 'pending') return <LoadingFallback />;
  if (mode === 'first-run') return <SetupPage />;
  return (
    <ProtectedRoute requireOrganization={false}>
      <SetupRedirect />
    </ProtectedRoute>
  );
}
