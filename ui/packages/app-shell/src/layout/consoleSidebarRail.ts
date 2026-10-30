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
  readWorkspacePreference,
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
 * Where the reader's wide-window choice, sidebar expanded or collapsed, is
 * kept (objectstack#28079). Only an open or close on a wide window writes it;
 * the fold, the overlay and a sidebar kept open on a narrow window never do,
 * and the "keep open" preference lives under its own key. The primitive's
 * `sidebar_state` cookie records every open and close, the fold's included,
 * so it cannot hold the wide-window choice. The key is the one the fold's
 * stash used before, which held the same value.
 */
const WIDE_OPEN_KEY = 'os:console-sidebar:wide-open';

/** The reader's wide-window choice, or `undefined` when none is kept. */
export function readWideWindowOpen(): boolean | undefined {
  const storage = workspacePreferenceStorage();
  if (!storage) return undefined;
  try {
    const stored = storage.getItem(WIDE_OPEN_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keep `open` as the wide-window choice when none is kept yet: before the
 * fold first closes the sidebar, the open state it closes is the one the
 * reader last had on a wide window (or the primitive's default).
 */
export function seedWideWindowOpen(open: boolean): void {
  if (readWideWindowOpen() === undefined) writeWideWindowOpen(open);
}

/** Keep the reader's wide-window choice. */
export function writeWideWindowOpen(open: boolean): void {
  const storage = workspacePreferenceStorage();
  if (!storage) return;
  try {
    storage.setItem(WIDE_OPEN_KEY, String(open));
  } catch {
    // A storage that refuses the write keeps nothing: the next wide load reads the cookie.
  }
}

/**
 * The sidebar primitive's cookie (`SIDEBAR_COOKIE_NAME` in
 * `@object-ui/components`' `ui/sidebar.tsx`), which `SidebarProvider` reads
 * once, when it mounts, for its first open state.
 */
const SIDEBAR_STATE_COOKIE = 'sidebar_state';
const SIDEBAR_STATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** The primitive's cookie as its provider reads it: `true`, `false`, or `undefined` for none. */
function readSidebarStateCookie(): boolean | undefined {
  for (const entry of document.cookie.split(';')) {
    const [name, value] = entry.split('=').map((part) => part.trim());
    if (name !== SIDEBAR_STATE_COOKIE) continue;
    return value === 'true' ? true : value === 'false' ? false : undefined;
  }
  return undefined;
}

/**
 * The phone breakpoint (`useIsMobile`'s 768 px in `@object-ui/components`):
 * below it the primitive's drawer takes over and the fold stays off. Read
 * synchronously here, while `useIsMobile` answers `false` until its effect.
 */
const PHONE_BELOW_WIDTH = 768;

/**
 * Hand the sidebar provider the open state its first frame draws, before it
 * mounts (objectstack#28077): the provider starts from its cookie, which the
 * last page wrote, so a narrow window would draw the expanded sidebar once and
 * then fold it, with the primitive's width transition in between. Below the
 * fold width with no "keep open" the first frame is the rail; on a wide
 * window it is the reader's wide-window choice; a sidebar kept open, and the
 * phone, keep what the cookie says. Call it once, from the component that
 * renders the provider, before the provider's first render.
 */
export function primeConsoleSidebarOpen(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const width = window.innerWidth;
  if (width < PHONE_BELOW_WIDTH) return;
  let open: boolean | undefined;
  if (width >= CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH) {
    open = readWideWindowOpen();
  } else if (readWorkspacePreference(CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE, 'user') !== 'on') {
    // The primitive's own default is open.
    seedWideWindowOpen(readSidebarStateCookie() ?? true);
    open = false;
  }
  if (open === undefined) return;
  document.cookie = `${SIDEBAR_STATE_COOKIE}=${open}; path=/; max-age=${SIDEBAR_STATE_COOKIE_MAX_AGE}`;
}

export interface ConsoleSidebarRail {
  /** The window is at or above {@link CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH}. */
  wide: boolean;
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
  const belowPhoneWidth = useIsViewportBelow(PHONE_BELOW_WIDTH);
  const [keepOpenChoice, setKeepOpenChoice] = useWorkspacePreference(
    CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE,
    'user',
    'off',
  );
  const setKeepOpen = useCallback(
    (keepOpen: boolean) => setKeepOpenChoice(keepOpen ? 'on' : 'off'),
    [setKeepOpenChoice],
  );
  const narrow = enabled && belowRailWidth && !belowPhoneWidth && !isMobile;
  const keepOpen = keepOpenChoice === 'on';
  const railMode = narrow && !keepOpen;
  return { wide: !belowRailWidth, narrow, keepOpen, setKeepOpen, railMode, overlayOpen: railMode && open };
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

/** A layer drawn over the page that takes Esc for itself. */
const ESCAPE_LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Would this Esc go to a tooltip nobody sees (objectstack#28078)? The
 * primitive keeps an entry's tooltip open, but hidden, while the sidebar is
 * expanded: hovering or focusing an entry in the overlay opens it, and its
 * layer takes the next Esc and marks it handled. Read before any layer's own
 * Esc listener runs: an open hidden tooltip and no layer shown.
 */
function escapeOnlyForHiddenTooltip(): boolean {
  const shown = (el: Element) => !el.closest('[hidden]');
  const tooltips = Array.from(document.querySelectorAll('[role="tooltip"]'));
  if (!tooltips.some((el) => !shown(el))) return false;
  return !Array.from(document.querySelectorAll(ESCAPE_LAYER)).some(shown);
}

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
    // On the window in the capture phase, ahead of the layers' own listeners.
    let hiddenTooltipEscape = false;
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hiddenTooltipEscape = escapeOnlyForHiddenTooltip();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A layer that handled Esc (a menu, a dialog) marks it handled; a hidden tooltip does not count.
      if (!event.defaultPrevented || hiddenTooltipEscape) setOpenRef.current(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDownCapture, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDownCapture, true);
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
