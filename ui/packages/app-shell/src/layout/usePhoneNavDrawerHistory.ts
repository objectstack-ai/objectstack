/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * usePhoneNavDrawerHistory: on a phone, Back closes the open nav drawer and
 * stays on the page (objectstack#29131).
 *
 * The drawer is state Back should respect (`ui/AGENTS.md` #8), so while it is
 * open it owns one history entry, pushed through the router with the same
 * path, search and hash and the {@link NAV_DRAWER_OPEN_STATE} flag in its
 * state. There is no popstate guard: `BrowserRouter` offers no hook to veto a
 * POP (the reason `chrome/unsavedEdits.ts` gives), so a guard would have to
 * re-push after the router had already moved.
 *
 * Invariants, all while the sidebar renders as the mobile drawer:
 *
 * - Opening the drawer pushes the entry; nothing is pushed when the current
 *   entry already carries the flag.
 * - Arriving on an entry without the flag while the drawer is open closes the
 *   drawer (Back, or a navigation from inside the drawer), and so does any
 *   history move off the flagged entry, even one the router never commits.
 * - Every other close (Escape, an outside tap, the trigger, the edge swipe's
 *   counterpart) pops the entry, so Back never stops on a no-op.
 * - A link chosen inside the drawer replaces the flagged entry, so Back from
 *   the new page goes to the page the drawer was opened on. A link to the
 *   page already shown pops the entry instead.
 * - A flagged entry this document did not push (a reload keeps
 *   `history.state`) is replaced by one without the flag, and the drawer stays
 *   closed. Returning to one it did push (Forward) reopens the drawer.
 *
 * With `isMobile` false the hook writes no history at all.
 *
 * Must be called inside a SidebarProvider and a router.
 * @module
 */

import { useEffect, useRef } from 'react';
import { useHref, useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import { useSidebar } from '@object-ui/components';
import { NAV_DRAWER_OPEN_STATE } from '../urlParams.js';

/** The primitive's mobile drawer (`Sidebar` renders its Sheet content with these attributes). */
const PHONE_DRAWER_SELECTOR = '[data-sidebar="sidebar"][data-mobile="true"]';

/** Router keys of the flagged entries this document pushed. */
const flaggedHere = new Set<string>();

function isFlagged(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as Record<string, unknown>)[NAV_DRAWER_OPEN_STATE] === true;
}

function stateObject(state: unknown): Record<string, unknown> {
  return state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
}

function withoutFlag(state: unknown): Record<string, unknown> | null {
  const { [NAV_DRAWER_OPEN_STATE]: _flag, ...rest } = stateObject(state);
  return Object.keys(rest).length > 0 ? rest : null;
}

function samePlace(location: Pick<Location, 'pathname' | 'search' | 'hash'>) {
  return { pathname: location.pathname, search: location.search, hash: location.hash };
}

/** A plain left click with no modifier, the only kind the router handles itself. */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}

export function usePhoneNavDrawerHistory(): void {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const rootHref = useHref('/');
  const basename = rootHref.endsWith('/') ? rootHref.slice(0, -1) : rootHref;
  const flagged = isFlagged(location.state);

  // Whether the router's current entry carries the flag. Updated ahead of the
  // navigations this hook starts: `BrowserRouter` commits a location in a
  // transition, so a close that lands in the same event as the navigation
  // (the drawer's "All apps" link closes the drawer itself) renders before
  // the new location does.
  const entryFlagged = useRef(flagged);
  const locationRef = useRef(location);
  const handledKey = useRef<string | null>(null);
  const lastOpen = useRef(openMobile);

  // The location side: Back closes, a stale flag is dropped, Forward reopens.
  useEffect(() => {
    if (!isMobile || handledKey.current === location.key) return;
    handledKey.current = location.key;
    locationRef.current = location;
    entryFlagged.current = flagged;
    if (!flagged) {
      if (openMobile) setOpenMobile(false);
      return;
    }
    if (navigationType !== 'POP') {
      flaggedHere.add(location.key);
      return;
    }
    if (!flaggedHere.has(location.key)) {
      entryFlagged.current = false;
      navigate(samePlace(location), { replace: true, state: withoutFlag(location.state) });
      return;
    }
    if (!openMobile) setOpenMobile(true);
  }, [isMobile, location, flagged, navigationType, openMobile, setOpenMobile, navigate]);

  // The drawer side: an open pushes the entry, any other close pops it.
  useEffect(() => {
    if (lastOpen.current === openMobile) return;
    lastOpen.current = openMobile;
    if (!isMobile) return;
    if (openMobile) {
      if (entryFlagged.current) return;
      entryFlagged.current = true;
      const here = locationRef.current;
      navigate(samePlace(here), { state: { ...stateObject(here.state), [NAV_DRAWER_OPEN_STATE]: true } });
      return;
    }
    if (entryFlagged.current) {
      entryFlagged.current = false;
      navigate(-1);
    }
  }, [isMobile, openMobile, navigate]);

  // While the drawer is open on its flagged entry: any history move leaves
  // that entry, and a link chosen inside the drawer replaces it.
  useEffect(() => {
    if (!isMobile || !openMobile) return;
    // `BrowserRouter` commits the push and a Back pressed before the push
    // committed as one transition, so the router reports no location change
    // at all; the document's own popstate still says the entry was left.
    const onPopState = () => {
      if (!entryFlagged.current) return;
      entryFlagged.current = false;
      setOpenMobile(false);
    };
    // A capture listener on the document runs before the router's own click
    // handler, and `Link` skips its navigation for a click whose default is
    // prevented.
    const onClick = (event: MouseEvent) => {
      if (!entryFlagged.current || event.defaultPrevented || !isPlainClick(event)) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || !anchor.closest(PHONE_DRAWER_SELECTOR)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      let pathname = url.pathname;
      if (basename) {
        if (pathname !== basename && !pathname.startsWith(`${basename}/`)) return;
        pathname = pathname.slice(basename.length) || '/';
      }
      event.preventDefault();
      entryFlagged.current = false;
      const here = locationRef.current;
      if (pathname === here.pathname && url.search === here.search && url.hash === here.hash) {
        navigate(-1);
        return;
      }
      navigate({ pathname, search: url.search, hash: url.hash }, { replace: true });
    };
    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick, true);
    };
  }, [isMobile, openMobile, basename, navigate, setOpenMobile]);
}
