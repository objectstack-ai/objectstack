// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `useLauncherApps` — the apps a launcher surface offers, as the SERVER filters
 * them for this user (objectstack#26838).
 *
 * `GET /api/v1/meta/app` serves every app the caller may open, routing
 * included: a permission set's `tabPermissions: { <app>: 'hidden' }` does not
 * withhold an app there, and must not — a hidden app keeps opening from a
 * direct URL (UI visibility, not access control). The hide is applied in one
 * place, `GET /api/v1/me/apps`, which merges the caller's sets (most visible
 * wins) and drops the hidden ones. Home read the first list and drew a tile
 * for an app the member's set hides; the app switcher and the `app:launcher`
 * page block read the same list and offered it too.
 *
 * So every launcher surface narrows its `/meta/app` list through this hook,
 * and the hook through ONE read of `/me/apps` per user, held by
 * {@link LauncherAppsProvider}. Three surfaces, one answer: they cannot
 * disagree about which app is offered.
 *
 * What the answer narrows, and what it leaves:
 *
 * - The list keeps `/meta/app`'s entries — their labels, icons, package ids
 *   and publish state are that route's. `/me/apps` contributes NAMES only.
 * - An app the answer was never asked about is not hidden by it. The provider
 *   records the active app names it asked with; an app that arrives later (an
 *   install, a publish) passes until the re-read it triggers lands, rather
 *   than vanishing from the launcher it was just installed into.
 * - No provider mounted, a `404` (no security plugin serves the route), or a
 *   failed read: nothing narrows, and the surface shows the `/meta/app` list
 *   as it always did. That is the server's own posture — `/me/apps` fails open
 *   without the security plugin — and the same "cosmetic, never fail-closed"
 *   one the console's other personal reads take. A failure other than `404`
 *   says so once on the console.
 * - `pending` is true only while the FIRST read is out. Home waits on it, so a
 *   hidden tile is never drawn and then taken away; a re-read keeps serving
 *   the answer it replaces.
 *
 * `default_off` is not read here: it is not a hide.
 *
 * @module
 */

import * as React from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createAuthenticatedFetch, useAuth } from '@object-ui/auth';
import { useMetadata } from '../providers/MetadataProvider.js';
import { filterActiveApps } from '../utils/appRoute.js';
import { resolveRuntimeApiBase } from './storageUsageEndpoint.js';

type LauncherAppLike = { name?: unknown } & Record<string, unknown>;

/** One `/me/apps` answer, and the app names it speaks for. */
interface LauncherAnswer {
  /** The app names `/me/apps` listed. */
  served: ReadonlySet<string>;
  /** The active `/meta/app` names when the read went out. */
  asked: ReadonlySet<string>;
}

type LauncherAppsState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'ready'; answer: LauncherAnswer }
  | { status: 'unavailable' };

const LauncherAppsContext = createContext<LauncherAppsState | null>(null);

/** The provider's state, and the user it belongs to. */
interface HeldAnswer {
  owner: string | null;
  state: LauncherAppsState;
}

const NOTHING_HELD: HeldAnswer = { owner: null, state: { status: 'idle' } };

/** A non-2xx answer, kept apart so `404` (route not served) reads as absence. */
class LauncherAppsReadError extends Error {
  constructor(readonly httpStatus: number) {
    super(`GET /me/apps returned ${httpStatus}`);
    this.name = 'LauncherAppsReadError';
  }
}

async function readServedAppNames(url: string, doFetch: typeof fetch): Promise<Set<string>> {
  const res = await doFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) throw new LauncherAppsReadError(res.status);
  const body = (await res.json()) as { apps?: unknown } | null;
  if (!Array.isArray(body?.apps)) throw new Error('GET /me/apps answered without an `apps` array');
  const names = new Set<string>();
  for (const app of body.apps as Array<{ name?: unknown } | null>) {
    if (typeof app?.name === 'string') names.add(app.name);
  }
  return names;
}

function activeAppNames(apps: readonly LauncherAppLike[] | null | undefined): string[] {
  const names = new Set<string>();
  for (const app of filterActiveApps(apps)) {
    if (typeof app?.name === 'string') names.add(app.name);
  }
  return [...names].sort();
}

export interface LauncherAppsProviderProps {
  children?: React.ReactNode;
  /** Defaults to `{VITE_SERVER_URL}/api/v1/me/apps`. */
  endpoint?: string;
  /**
   * Defaults to a fresh `createAuthenticatedFetch()` per read: the console's
   * `/api/v1/*` lane carries a Bearer token and no session cookie.
   */
  fetcher?: typeof fetch;
}

/**
 * Holds the signed-in user's `/me/apps` answer for every launcher surface
 * below it. Mount it once, where Home and the apps share an ancestor — the
 * console mounts it beside the `/auth/me/permissions` provider.
 *
 * Reads when there is a user and an app list to narrow, and again when the
 * app list gains a name the held answer was not asked about.
 */
export function LauncherAppsProvider({ children, endpoint, fetcher }: LauncherAppsProviderProps) {
  const { user } = useAuth();
  const { apps, loading } = useMetadata();
  const owner = user?.id != null ? String(user.id) : null;
  // The effect keys on the names' VALUE, never on the list's identity.
  const namesKey = JSON.stringify(activeAppNames(apps as LauncherAppLike[] | undefined));

  const [held, setHeld] = useState<HeldAnswer>(NOTHING_HELD);
  // The effect's reading of the current answer, without keying on it.
  const heldRef = useRef<HeldAnswer>(NOTHING_HELD);
  // Owners whose server answered `404`: the route is not served, so the same
  // question is not asked again for them.
  const notServed = useRef(new Set<string>());

  useEffect(() => {
    const names = JSON.parse(namesKey) as string[];
    const publish = (next: HeldAnswer) => {
      heldRef.current = next;
      setHeld(next);
    };
    if (!owner || loading || names.length === 0 || notServed.current.has(owner)) return;
    const current = heldRef.current.owner === owner ? heldRef.current.state : null;
    const answer = current?.status === 'ready' ? current.answer : null;
    if (answer && names.every((name) => answer.asked.has(name))) return;

    let cancelled = false;
    const asked = new Set(names);
    if (!current || current.status === 'idle') publish({ owner, state: { status: 'pending' } });
    const url = endpoint ?? `${resolveRuntimeApiBase()}/me/apps`;
    readServedAppNames(url, fetcher ?? createAuthenticatedFetch())
      .then((served) => {
        if (cancelled) return;
        publish({ owner, state: { status: 'ready', answer: { served, asked } } });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof LauncherAppsReadError && err.httpStatus === 404) {
          notServed.current.add(owner);
        } else {
          console.warn(
            '[app-shell] Could not read the apps your permission sets show (`GET /me/apps`); ' +
              'the launcher lists every app you can open instead:',
            err,
          );
        }
        // A failed re-read keeps the answer it would have replaced.
        publish({ owner, state: answer ? { status: 'ready', answer } : { status: 'unavailable' } });
      });
    return () => {
      cancelled = true;
    };
  }, [owner, loading, namesKey, endpoint, fetcher]);

  const state: LauncherAppsState = held.owner === owner ? held.state : { status: 'idle' };
  return <LauncherAppsContext.Provider value={state}>{children}</LauncherAppsContext.Provider>;
}

export interface LauncherApps<T> {
  /** The apps to offer: `filterActiveApps(apps)`, narrowed by `/me/apps`. */
  apps: T[];
  /** The first `/me/apps` read is still out; nothing is narrowed yet. */
  pending: boolean;
}

/**
 * The apps a launcher surface offers: `filterActiveApps(apps)`, minus every
 * app the user's `/me/apps` answer was asked about and did not list. Outside
 * a {@link LauncherAppsProvider}, or when the read is absent or failed, that
 * is `filterActiveApps(apps)` unchanged.
 */
export function useLauncherApps<T extends LauncherAppLike>(
  apps: readonly T[] | null | undefined,
): LauncherApps<T> {
  const state = useContext(LauncherAppsContext);
  const openable = filterActiveApps(apps);
  if (state?.status !== 'ready') return { apps: openable, pending: state?.status === 'pending' };
  const { served, asked } = state.answer;
  return {
    apps: openable.filter((app) => {
      const name = app?.name;
      return typeof name !== 'string' || served.has(name) || !asked.has(name);
    }),
    pending: false,
  };
}
