// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AccountLoginRedirect — element used as `AuthGuard`'s fallback. On mount
 * it hard-navigates the browser to `/_account/login?redirect=<current>` so
 * the user lands back on the original Console URL after signing in.
 */

import { useEffect } from 'react';
import { gotoAccountLogin } from '../lib/auth-redirect';

export function AccountLoginRedirect({ redirect }: { redirect?: string } = {}) {
  useEffect(() => {
    gotoAccountLogin(redirect);
  }, [redirect]);
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
    </div>
  );
}
