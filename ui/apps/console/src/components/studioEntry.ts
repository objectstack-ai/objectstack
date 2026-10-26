// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/studio/*` ENTRY policy — may this principal enter the Studio builder at all?
 *
 * `SetupRoute` / `setupEntry` split the same way: the policy and the reason it
 * is shaped like this live here, `StudioRoute.tsx` is only the mapping from
 * verdict to element.
 *
 * ## What this exists to close
 *
 * The framework serves the Console as a static bundle behind an unconditional
 * SPA fallback (`createConsoleStaticPlugin` registers a `/_console/*` catch-all
 * and answers `index.html` for anything not on disk), so every path under
 * `/_console/` is one and the same response and THIS app decides what renders.
 * On a hosted-SaaS shape the Studio nav tile is deliberately absent and every
 * metadata write is refused — yet typing `/_console/studio/` rendered the full
 * pillar builder (Data / Automations / Interfaces / Access, Publish and Save
 * draft visible) to a plain tenant principal, who was walked through the entire
 * "new package" form and only refused at submit (`POST /api/v1/packages` → 403).
 * The lockdown criterion for that shape is two-part — UI entry hidden AND API
 * refused. The backend half is green; what shipped on this side was a WRITE-level
 * gate (a "Read-only" badge, which is really about package writability) sitting
 * where an ENTRY-level one belongs.
 *
 * ## The signal
 *
 * `studio.access` is a declared platform capability — *"Enter the Studio
 * metadata-design surfaces"*, scope `platform`. The wording is entry, not write.
 * A tenant org owner does not hold it BY DESIGN (it is one of the framework's
 * `PLATFORM_ADMIN_ONLY_CAPABILITIES`; `organization_admin` gets
 * `manage_org_users` / `setup.access` / `setup.write` and no more). It reaches
 * the browser already, in `systemPermissions[]` from
 * `GET /api/v1/auth/me/permissions` — the endpoint this app's four
 * `useCapabilityGate` surfaces already read. Nothing new is served or computed
 * here; only the LAYER the answer is applied at changes.
 *
 * ## ⛔ The fail direction is INVERTED from every other capability gate here
 *
 * `useCapabilityGate` and `PermissionContextValue.hasCapabilities` both fail
 * OPEN on an unknown answer, and that is right for them: the bad outcome there
 * is a holder losing a button while the server still refuses the write.
 *
 * A ROUTE gate has the opposite stake — the bad outcome is a NON-holder seeing
 * the builder, which is the measured defect. So this decides on a LOADED answer
 * and treats everything else as "not permitted":
 *
 *  - **pending** (fetch in flight, including its transient retries) → the
 *    console's loading splash. "Not yet loaded" is never read as permission;
 *    the builder is not mounted for a single frame.
 *  - **loaded, array reported** → strict membership. A REPORTED EMPTY array is
 *    a real answer ("holds nothing") and gates closed, per the same doctrine
 *    `MePermissionsProvider` states.
 *  - **loaded, `systemPermissions` ABSENT** → denied. This is the one place the
 *    verdict diverges from `hasCapabilities`, deliberately, and the reason is
 *    that "absent" is not the museum piece it looks like. The framework's own
 *    endpoint has two live paths that answer `200` with no `systemPermissions`
 *    at all: the anonymous reply (`{ authenticated: false }`) and — the
 *    load-bearing one — the resolver's `catch`, which answers
 *    `{ authenticated: true, userId, objects: {}, fields: {} }` when permission
 *    resolution THREW (`current-user-endpoints.ts:866`, read at framework
 *    `76deca2`). Failing open there hands the builder to a non-holder on the
 *    exact deployment whose permission layer just failed. An entry question with
 *    no answer is not a grant; the operator sees a recoverable bounce to home and
 *    a reload lets them back in.
 *  - **failed outright** (a non-transient status, or the retries exhausted) →
 *    the console's error splash with its Retry affordance. Never the builder.
 *
 * ## Why this does NOT mount `MePermissionsProvider`
 *
 * That provider is the app's normal reader for this endpoint and its
 * loading/error posture is exactly the one wanted here — but it installs a
 * `PermCtx`, and today the `/studio/*` routes sit OUTSIDE the only mount of it
 * (`AppContent`, which covers `/apps/:appName/*`). The Studio builder renders
 * `@object-ui/plugin-form` / `plugin-view` / `plugin-list`, all of which consume
 * that context — `checkField` alone fails CLOSED for an object the payload does
 * not mention on an authenticated session. Wrapping the builder in it would
 * change what the builder renders FOR A HOLDER, and an entry gate must not
 * change the surface it guards. So this reads the endpoint directly and installs
 * no context; the guarded subtree renders byte-for-byte as it does today.
 *
 * The retry primitives are shared with `MePermissionsProvider` and
 * `LocalizationFetchProvider` (`@object-ui/types`), which is what they are for:
 * one definition of "transient", one policy per caller. This caller's policy is
 * the fail-closed one — it holds `pending` across the waits, because a cold
 * environment kernel answering `503` + `Retry-After` while it warms is a normal
 * part of a cold start and must not read as a denial for a genuine operator.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAuthenticatedFetch } from '@object-ui/auth';
import type { MePermissionsResponse } from '@object-ui/permissions';
import {
  HttpFetchError,
  backoffMs,
  isTransientFailure,
  retryAfterFrom,
  sleep,
} from '@object-ui/types';

/**
 * [ADR-0066] The declared platform capability that answers "may this principal
 * enter Studio". Entry, not write — the writes are the server's to refuse, and
 * it does (`/api/v1/meta/*` → 403), which is the other half of the criterion and
 * is not relaxed by anything here.
 */
export const STUDIO_ENTRY_CAPABILITY = 'studio.access';

/** Attempts and backoff base, matched to `MePermissionsProvider`'s fail-closed posture. */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * The resolved answer to "may this principal enter Studio", or the absence of one.
 *
 * `loaded` carries the RAW signal — `undefined` is preserved rather than
 * collapsed to `[]`, because the two are different facts and only the caller's
 * posture decides what each one means (objectui#4656 made that distinction
 * load-bearing). Here both deny; see the header for why they still must not be
 * merged at the source.
 */
export type StudioEntryState =
  | { status: 'pending' }
  | { status: 'loaded'; systemPermissions: string[] | undefined }
  | { status: 'failed'; error: Error; retry: () => void };

/**
 * The whole policy, as one pure predicate: does this REPORTED capability set
 * admit its holder to Studio?
 *
 * `undefined` (no answer reported) is `false` — see the header. Callers must not
 * re-derive an "absent means yes" heuristic locally; that is precisely the
 * fail-open shape this card exists to remove.
 */
export function holdsStudioAccess(systemPermissions: string[] | undefined): boolean {
  if (!Array.isArray(systemPermissions)) return false;
  return systemPermissions.includes(STUDIO_ENTRY_CAPABILITY);
}

function defaultEndpoint(): string {
  return `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth/me/permissions`;
}

/**
 * Read the current principal's capability set for the entry decision.
 *
 * `endpoint` / `fetcher` are injectable so a test can drive the three states
 * without stubbing a global; production passes neither.
 *
 * The default fetcher is the AUTHENTICATED one (`#2926 ④`): with the plain
 * cookie-only `fetch`, a token-only session (localStorage, no better-auth
 * cookie) resolves as anonymous, and an anonymous reply carries no
 * `systemPermissions` — which on this gate's posture would bounce a genuine
 * operator to home.
 */
export function useStudioEntry(options?: {
  endpoint?: string;
  fetcher?: typeof fetch;
}): StudioEntryState {
  const endpoint = options?.endpoint ?? defaultEndpoint();
  const provided = options?.fetcher;
  const fetcher = useMemo(
    () => provided ?? (createAuthenticatedFetch() as typeof fetch),
    [provided],
  );

  const [state, setState] = useState<StudioEntryState>({ status: 'pending' });
  const [attemptNonce, setAttemptNonce] = useState(0);

  /** Stable, so it can ride inside the `failed` state without re-triggering the effect. */
  const retry = useCallback(() => {
    setState({ status: 'pending' });
    setAttemptNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await fetcher(endpoint, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          });
          if (!res.ok) {
            throw new HttpFetchError(
              res.status,
              retryAfterFrom(res),
              `Permissions endpoint returned ${res.status}`,
            );
          }
          const json = (await res.json()) as MePermissionsResponse;
          if (cancelled) return;
          const reported = json?.systemPermissions;
          setState({
            status: 'loaded',
            systemPermissions: Array.isArray(reported) ? reported : undefined,
          });
          return;
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          // A real answer about this caller (401/403/404/500) will not change on
          // a retry, and neither will the last attempt. `pending` is held across
          // the waits on purpose — the fail-closed posture stays in force while
          // a cold kernel warms, so the recovery is invisible instead of reading
          // as a denial.
          if (!isTransientFailure(err) || attempt === MAX_RETRIES) {
            if (cancelled) return;
            setState({ status: 'failed', error: err, retry });
            return;
          }
          const stated = err instanceof HttpFetchError ? err.retryAfterMs : undefined;
          await sleep(backoffMs(attempt, BASE_DELAY_MS, stated));
          if (cancelled) return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint, fetcher, attemptNonce, retry]);

  return state;
}
