/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * How an ACCEPTED `submitBehavior: { kind: 'redirect' }` destination is
 * actually travelled to — objectui#4989 **defect 4, mount-blindness**, the
 * reopened half of that card.
 *
 * `submitRedirect.ts` answers WHETHER a destination may be followed and WHAT
 * the resolved relative path is. This module answers WHO performs the
 * navigation, and it is a separate question because the right answer is not
 * this package's to pick: a rooted path such as `/thanks` handed to
 * `window.location.assign` resolves against the ORIGIN, so under a host mounted
 * at a sub-path (the framework CLI configures one for every embedded
 * deployment) a ruled in-app destination leaves the application. Only the host
 * knows its mount.
 *
 * ## The mechanism, and why it is this one
 *
 * Maintainer ruling, 2026-08-17: **optional injected navigation**. The host
 * offers its own router-aware, basename-aware navigate through
 * `HostNavigationContext` (`@object-ui/react`); this package uses it when it is
 * there and keeps today's `window.location.assign` when it is not. Two other
 * mechanisms were weighed and REJECTED in that ruling, recorded here so the
 * next reader does not re-derive them as improvements:
 *
 *   - **reading React Router's context when a router happens to be present** —
 *     implicit, and unavailable regardless: a React context is a module-instance
 *     object, so reading the host's requires importing `react-router` here.
 *     This package declares it in none of its four dependency fields, its Vite
 *     build externalises every bare specifier, and two real consumers
 *     (`apps/site`, `packages/plugin-view`) have no react-router to resolve —
 *     the published `dist` would break their builds. Declaring it as a normal
 *     dependency does not help either: that yields this package its OWN
 *     react-router instance, whose context object is not the host's, so the
 *     read answers null forever.
 *   - **a `react-router` peer requirement** — the honest version of the above,
 *     and it costs this package the property that it drops into ANY React
 *     application.
 *
 * ## Absent seam is not a degraded mode
 *
 * With no provider the behaviour is byte-for-byte what it was: one
 * `window.location.assign` of the resolved path after the declared delay. A
 * host with no router has no basename, so origin-rooted resolution is already
 * correct there — the seam changes what a MOUNTED host gets, and nothing else.
 *
 * ## What the host takes on by supplying it
 *
 * A host navigate is a client-side transition, so the destination must be a
 * path the host's router can match; an in-app path with no route renders the
 * host's not-found instead of a full page load. That is the host's routing
 * table to answer for, which is exactly why the choice is the host's. The
 * verdict is NOT relaxed for injected hosts: a destination the contract refuses
 * is refused identically either way (`submitRedirect.ts`), so a supplied
 * navigate can never become a laundering route for a value the authoring door
 * rejects.
 */

import { useEffect, useRef } from 'react';
import { useHostNavigation } from '@object-ui/react';

/**
 * An accepted destination plus the delay declared with it, captured at the
 * moment the write was accepted. Held in component state by each form so the
 * wait belongs to the mounted component (objectui#5033) — see the state's own
 * comment at each call site.
 */
export interface PendingSubmitRedirect {
  url: string;
  delayMs: number;
}

/**
 * Own the delayed leg of an accepted `redirect` submit behaviour: wait the
 * declared `delayMs`, then travel to `pending.url` through the host's navigate
 * if one was injected, else through `window.location.assign`.
 *
 * Unmounting cancels the wait, which is the property objectui#5033 bought and
 * this extraction preserves: the hook's effect is the same effect both forms
 * used to declare inline, now written once so the two cannot disagree about
 * either the wait or the seam.
 *
 * Pass `null` when nothing is pending.
 */
export function useSubmitRedirectNavigation(pending: PendingSubmitRedirect | null): void {
  const { navigate: hostNavigate } = useHostNavigation();

  // Latest-wins ref, so the injected function's IDENTITY is not a dependency of
  // the wait below. A host that rebuilds its callback each render (the ordinary
  // shape of an inline arrow in JSX) would otherwise re-run that effect on every
  // parent re-render, and its cleanup would restart the declared pause under the
  // submitter — the same "the wait must not be restartable mid-flight" property
  // the captured `delayMs` protects on the other side.
  const hostNavigateRef = useRef(hostNavigate);
  useEffect(() => {
    hostNavigateRef.current = hostNavigate;
  }, [hostNavigate]);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      // Read at fire time, not at arm time: a host that mounts its provider
      // asynchronously (auth/router settling) still gets its navigate used, and
      // a seam that goes away mid-wait falls back rather than calling a stale
      // closure.
      const navigate = hostNavigateRef.current;
      if (navigate) {
        navigate(pending.url);
        return;
      }
      window.location.assign(pending.url);
    }, pending.delayMs);
    return () => clearTimeout(timer);
  }, [pending]);
}
