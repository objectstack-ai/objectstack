// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * consoleSidebarRail — when the console sidebar folds to its icon rail on its
 * own, and the reader's override (objectstack#27593).
 *
 * On a window too narrow for the record split beside an expanded sidebar the
 * sidebar mounts as the icon rail, and a click on the rail (or the app bar's
 * trigger, or ⌘B) expands it OVER the content instead of beside it. A reader
 * who keeps it open ({@link CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE}) gets the
 * wide-window behaviour at every width above the phone breakpoint, where the
 * primitive's drawer takes over.
 *
 * `useResponsiveSidebar` folds and unfolds the sidebar as the window crosses
 * the width; `UnifiedSidebar` draws the rail and its overlay.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { cn, useIsViewportBelow, useSidebar } from '@object-ui/components';
import {
  defineWorkspacePreference,
  useWorkspacePreference,
  versionedPreferenceCodec,
  workspacePreferenceStorage,
  type PreferenceSwitch,
} from '../utils/workspacePreference.js';

/**
 * The expanded sidebar's width in CSS pixels: the sidebar primitive's
 * `--sidebar-width` (16rem) in `@object-ui/components`.
 * `consoleSidebarRail.width-27593.test.tsx` reads the primitive's value and
 * holds this equal to it, so the derived threshold below follows the sidebar.
 */
export const CONSOLE_EXPANDED_SIDEBAR_WIDTH = 256;

/**
 * The content width the record split needs to draw its list's columns: the
 * narrowest list that still draws them (440) beside the record pane at its
 * default width (720), objectstack#27545.
 */
export const RECORD_SPLIT_MIN_CONTENT_WIDTH = 440 + 720;

/**
 * Below this window width the sidebar folds to the icon rail on its own.
 *
 * Derived, not picked: a window narrower than the split's content plus the
 * expanded sidebar cannot fit the split beside the expanded sidebar, so the
 * sidebar gives the content its width. 1160 + 256 = 1416: a 1280 px window
 * folds (1280 − the 48 px rail leaves 1232 for the split), a 1440 px window
 * keeps the sidebar expanded (1184 left). The record page's own column tiers
 * are measured on the container it gets, so they follow either way.
 */
export const CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH = RECORD_SPLIT_MIN_CONTENT_WIDTH + CONSOLE_EXPANDED_SIDEBAR_WIDTH;

/**
 * The reader's "keep the sidebar open": `on` turns the fold off, so a narrow
 * window keeps the wide-window sidebar. A reader preference, per browser,
 * never metadata (objectstack#27052). With no choice: off.
 */
export const CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE = defineWorkspacePreference<PreferenceSwitch>({
  name: 'console.sidebar.keepOpen',
  codec: versionedPreferenceCodec<PreferenceSwitch>({
    version: 1,
    toRecord: (value) => ({ value }),
    fromRecord: (record) => (record.value === 'on' || record.value === 'off' ? record.value : undefined),
  }),
});

/**
 * Where the fold keeps the wide-window open state while the rail holds the
 * sidebar. The primitive writes its `sidebar_state` cookie on every open and
 * close, the fold's included, so without this a narrow window would overwrite
 * the state the reader chose on a wide one. Bookkeeping of the shell, not a
 * reader preference: present only while the rail holds the sidebar, or until
 * the next wide load hands it back.
 */
const WIDE_OPEN_STASH_KEY = 'os:console-sidebar:wide-open';

/** The stashed wide-window open state, or `undefined` when none is stashed. */
export function readStashedWideOpen(): boolean | undefined {
  const storage = workspacePreferenceStorage();
  if (!storage) return undefined;
  try {
    const stored = storage.getItem(WIDE_OPEN_STASH_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Stash the wide-window open state, or clear the stash with `undefined`. */
export function writeStashedWideOpen(open: boolean | undefined): void {
  const storage = workspacePreferenceStorage();
  if (!storage) return;
  try {
    if (open === undefined) storage.removeItem(WIDE_OPEN_STASH_KEY);
    else storage.setItem(WIDE_OPEN_STASH_KEY, String(open));
  } catch {
    // A storage that refuses the write keeps nothing: the next wide load reads the cookie.
  }
}

export interface ConsoleSidebarRail {
  /** The window is below {@link CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH} and above the phone breakpoint. */
  narrow: boolean;
  /** The reader keeps the sidebar open on a narrow window. */
  keepOpen: boolean;
  setKeepOpen: (keepOpen: boolean) => void;
  /** The fold is on: a narrow window and no "keep open". */
  railMode: boolean;
  /** The rail is expanded over the content. */
  overlayOpen: boolean;
}

/**
 * Where the console sidebar stands against the fold. Inside the sidebar
 * provider. `enabled: false` answers "no fold" at every width: a sidebar the
 * console layout does not fold is drawn as the provider says.
 */
export function useConsoleSidebarRail({ enabled = true }: { enabled?: boolean } = {}): ConsoleSidebarRail {
  const { isMobile, open } = useSidebar();
  const belowRailWidth = useIsViewportBelow(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH);
  const [keepOpenChoice, setKeepOpenChoice] = useWorkspacePreference(
    CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE,
    'user',
    'off',
  );
  const setKeepOpen = useCallback(
    (keepOpen: boolean) => setKeepOpenChoice(keepOpen ? 'on' : 'off'),
    [setKeepOpenChoice],
  );
  const narrow = enabled && belowRailWidth && !isMobile;
  const keepOpen = keepOpenChoice === 'on';
  const railMode = narrow && !keepOpen;
  return { narrow, keepOpen, setKeepOpen, railMode, overlayOpen: railMode && open };
}

/**
 * The frame's class while the rail is expanded over the content: the
 * sidebar's gap (the in-flow box that reserves the sidebar's width, the first
 * child of the primitive's `data-collapsible` element) keeps the rail's
 * width, so the content beside it does not move, while the fixed panel takes
 * the expanded width over the content. The frame is `display: contents`, so it
 * adds no box of its own to the shell's row.
 */
export const RAIL_OVERLAY_FRAME_KEEPS_GAP = '[&>[data-collapsible=icon]>div:first-child]:w-(--sidebar-width-icon)';

/** The panel's classes while the rail is expanded over the content: above the page, with a shadow. */
export const RAIL_OVERLAY_PANEL = 'z-40 shadow-xl';

/** What a click on the rail lands on when it is not the rail's background. */
const RAIL_CONTROL =
  'a[href], button, input, select, textarea, [role="button"], [role="menuitem"], [role="combobox"], [role="switch"]';

export interface ConsoleSidebarRailPanel {
  /** The class of the `display: contents` frame around the sidebar. */
  frameClassName: string;
  /** Classes added to the sidebar panel. */
  panelClassName: string | undefined;
  /** Props added to the sidebar panel while the fold is on. */
  panelProps: {
    'data-console-rail'?: 'rail' | 'overlay';
    onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
    onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  };
}

/**
 * How the folded sidebar behaves: a click on the rail's background expands it
 * over the content (hover does not); a navigation choice, a press outside it
 * or Esc folds it again. The app bar's trigger and ⌘B toggle it through the
 * provider as everywhere else. Inside the sidebar provider and a router.
 */
export function useConsoleSidebarRailPanel(rail: ConsoleSidebarRail): ConsoleSidebarRailPanel {
  const { open, setOpen } = useSidebar();
  const { railMode, overlayOpen } = rail;
  const location = useLocation();
  const setOpenRef = useRef(setOpen);
  const overlayOpenRef = useRef(overlayOpen);
  // The press that last landed in the sidebar's React tree, portals included
  // (an entry's menu), so the document listener can tell it from an outside one.
  const insidePress = useRef<Event | null>(null);

  useLayoutEffect(() => {
    setOpenRef.current = setOpen;
    overlayOpenRef.current = overlayOpen;
  });

  // Any navigation folds the overlay: an entry chosen in it, the command palette, Back.
  const routeKey = `${location.pathname}${location.search}`;
  const lastRouteKey = useRef(routeKey);
  useEffect(() => {
    if (lastRouteKey.current === routeKey) return;
    lastRouteKey.current = routeKey;
    if (overlayOpenRef.current) setOpenRef.current(false);
  }, [routeKey]);

  useEffect(() => {
    if (!overlayOpen) return undefined;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event === insidePress.current) return;
      // The app bar's trigger toggles the sidebar itself.
      if (event.target instanceof Element && event.target.closest('[data-sidebar="trigger"]')) return;
      setOpenRef.current(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // A layer that handled Esc (a menu, a dialog) marks it handled.
      if (event.key === 'Escape' && !event.defaultPrevented) setOpenRef.current(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [overlayOpen]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    insidePress.current = event.nativeEvent;
  }, []);

  const onClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (open) {
        if (target.closest('a[href]')) setOpen(false);
        return;
      }
      if (!target.closest(RAIL_CONTROL)) setOpen(true);
    },
    [open, setOpen],
  );

  return {
    frameClassName: cn('contents', overlayOpen && RAIL_OVERLAY_FRAME_KEEPS_GAP),
    panelClassName: overlayOpen ? RAIL_OVERLAY_PANEL : undefined,
    panelProps: railMode
      ? { 'data-console-rail': overlayOpen ? 'overlay' : 'rail', onPointerDown, onClick }
      : {},
  };
}
