/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useBootstrapStatus` — whether this deployment has an owner yet
 * (`GET /api/v1/auth/bootstrap-status` → `hasOwner`).
 *
 * Two readers, which is why it lives in this package (objectui#11705): the
 * console's `/setup` entry policy (`apps/console/src/components/setupEntry.ts`,
 * `decideSetupEntry`), and the sign-up decision `decideSignUpOffer`
 * (`./signUpOffer`), which the console's login and register pages and this
 * package's exported `DefaultLoginPage` / `DefaultRegisterPage` all call. Moved
 * here from `setupEntry.ts` unchanged.
 *
 * The probe base follows the convention the rest of this package uses for
 * same-origin REST calls: `VITE_SERVER_URL` (empty in same-origin production)
 * plus `/api/v1/auth`.
 */

import { useEffect, useState } from 'react';

const AUTH_BASE = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;

/**
 * Deployment bootstrap state. `fresh` is also what a FAILED probe reports —
 * same fall-open as the console's `SetupPage` `catch`: showing the first-run
 * wizard on an already-bootstrapped deployment is recoverable (the wizard
 * re-probes and bounces to login), whereas hiding it on a genuinely fresh one
 * is a dead end, because no account exists to log in with.
 */
export type BootstrapStatus = 'unknown' | 'fresh' | 'bootstrapped';

/**
 * Probe `hasOwner` once. `enabled` is load-bearing twice over for the
 * console's `/setup` policy: an already-authenticated visitor never pays for a
 * request whose answer that policy would ignore, AND it is what confines a
 * `fresh` verdict to session-less visits, which is what makes that verdict
 * durable. The answer is kept once received — losing `enabled` (as `signUp()`
 * does) cancels the in-flight probe, it does not reset the state.
 */
export function useBootstrapStatus(enabled: boolean): BootstrapStatus {
  const [status, setStatus] = useState<BootstrapStatus>('unknown');
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${AUTH_BASE}/bootstrap-status`, { credentials: 'include' });
        const data: { hasOwner?: boolean } = res.ok ? await res.json().catch(() => ({})) : {};
        if (!cancelled) setStatus(data.hasOwner === true ? 'bootstrapped' : 'fresh');
      } catch {
        // Fall open — see BootstrapStatus.
        if (!cancelled) setStatus('fresh');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return status;
}
