// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/setup` entry policy — which of the route's TWO meanings applies
 * (objectui#2794).
 *
 * ## The collision this resolves
 *
 * `/setup` was already taken, by the first-run owner-bootstrap wizard
 * (`pages/auth/SetupPage`, ported from the retired Account SPA). That page is
 * public and meaningful only while the deployment has no owner; it bounces
 * every other visitor away — a signed-in one with `window.location.assign('/')`,
 * which `RootLandingRedirect` then resolves to `/home` on any multi-app
 * deployment. THAT is the "深链被重定向回 home" the card measured: the redirect
 * was not a missing route, it was the wizard evicting an authenticated visitor.
 *
 * So `/setup` needs a discriminator rather than a second URL. The honest one is
 * the one the wizard itself already uses — whether this deployment has an owner
 * (`GET /api/v1/auth/bootstrap-status` → `hasOwner`) — because that is exactly
 * the condition under which the wizard is the right page. It is also monotonic:
 * a deployment crosses it once, forever.
 *
 * ## Why a live session short-circuits the probe
 *
 * `hasOwner: false` cannot be true while somebody is signed in, so an
 * authenticated visitor is decided without waiting for (or trusting) the probe.
 * That keeps the common case off the network round-trip, and it keeps a FAILED
 * probe — which falls open to "fresh", the wizard, matching `SetupPage`'s own
 * `catch` — from re-creating the very bounce-to-home this card is about.
 *
 * ## Why a `fresh` verdict outranks everything, including the session
 *
 * `signUp()` flips the session to authenticated while the wizard is still
 * running (it renames the bootstrap organization after the account exists). If
 * the route re-decided on that flip it would unmount the wizard mid-submission
 * and kill the in-flight rename — the exact failure `SetupPage`'s own
 * "not mid-submission" guard was written for.
 *
 * No latch is needed to prevent that, because the probe is GATED on being
 * unauthenticated: `fresh` can only ever be produced by a probe that ran while
 * nobody was signed in, and `useBootstrapStatus` keeps its answer for the life
 * of the mount. So `fresh` is already durable, and reading it first is what
 * makes the verdict immune to the session flip. The same gate is why the two
 * inputs never contradict each other in practice — see the reachability note on
 * {@link decideSetupEntry}.
 */

import { useAuth } from '@object-ui/auth';
// The `hasOwner` probe and its state type live in `@object-ui/app-shell`
// (objectui#11705): the sign-up decision there reads the same probe, for the
// console's login and register pages and the package's exported default ones.
// `BootstrapStatus` documents why a FAILED probe reads `fresh`.
import { useBootstrapStatus, type BootstrapStatus } from '@object-ui/app-shell';

/** Which surface `/setup` resolves to. */
export type SetupEntryMode =
  /** Inputs not settled yet — render the loading fallback, decide nothing. */
  | 'pending'
  /** No owner yet: `/setup` is the owner-bootstrap wizard. */
  | 'first-run'
  /** Normal deployment: `/setup` is the platform-administration deep link. */
  | 'settings';

/** The auth facts this decision reads. */
export interface SetupEntryAuth {
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * The pure decision. Order matters and is the whole policy:
 *   1. `fresh` wins outright — it can only come from a probe that ran while
 *      unauthenticated, so it survives `signUp()`'s session flip (see the file
 *      header) and the wizard is never unmounted from under itself;
 *   2. nothing else is decided while auth is still settling;
 *   3. a live session PROVES an owner exists → the settings deep link, without
 *      waiting on the bootstrap probe at all;
 *   4. otherwise the probe decides, and only once it has an answer.
 *
 * REACHABILITY: `useBootstrapStatus` is gated on `!isLoading && !isAuthenticated`,
 * so `status` is always `unknown` while auth is loading and for any visitor who
 * arrived with a session. Combinations outside that are unreachable through the
 * hook and are not what the ordering above is tuned for.
 */
export function decideSetupEntry(
  status: BootstrapStatus,
  auth: SetupEntryAuth,
): SetupEntryMode {
  if (status === 'fresh') return 'first-run';
  if (auth.isLoading) return 'pending';
  if (auth.isAuthenticated) return 'settings';
  if (status === 'unknown') return 'pending';
  return 'settings';
}

/**
 * The verdict for this mount. `useBootstrapStatus` probes `hasOwner` once;
 * its `enabled` is load-bearing twice over here: an already-authenticated
 * visitor never pays for a request whose answer {@link decideSetupEntry} would
 * ignore, AND it is what confines a `fresh` verdict to session-less visits,
 * which is what makes that verdict durable. The answer is kept once received —
 * losing `enabled` (as `signUp()` does) cancels the in-flight probe, it does
 * not reset the state.
 */
export function useSetupEntryMode(): SetupEntryMode {
  const { isAuthenticated, isLoading } = useAuth();
  const status = useBootstrapStatus(!isLoading && !isAuthenticated);
  return decideSetupEntry(status, { isAuthenticated, isLoading });
}
