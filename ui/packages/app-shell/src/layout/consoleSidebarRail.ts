// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * consoleSidebarRail — how the console sidebar collapses, when it folds on its
 * own, and the menu it floats over the content (objectstack#27593,
 * objectstack#35062).
 *
 * From the phone breakpoint up a collapsed sidebar is hidden: it takes no
 * width, and nothing of it is drawn, focusable or announced. Both ways of
 * collapsing look the same (ruling 6973617688 on objectstack#35062: one
 * collapsed look at 768 px and up): the reader's own collapse, and the fold
 * below. The full menu, with its labels and groups, floats over the content
 * instead, without changing what the reader chose: after the pointer rests on
 * the window's left edge, after a press on that edge, and from the app bar's
 * trigger or ⌘B, whichever way it collapsed. A pointer that floated it folds
 * it back by moving away; a navigation choice, a press outside it or Esc folds
 * it from any of them. "Keep sidebar open", at the foot of the floated menu,
 * puts the sidebar back beside the content and keeps it there.
 *
 * On a window too narrow for the record drawer and the list beside it next to
 * an expanded sidebar, the sidebar folds on its own. A reader who keeps it
 * open ({@link CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE}) gets the wide-window
 * behaviour at every width above the phone breakpoint, where the primitive's
 * drawer takes over: the trigger collapses the sidebar, and floats its menu
 * once it is collapsed.
 *
 * `useResponsiveSidebar` folds and unfolds the sidebar as the window crosses
 * the width; `UnifiedSidebar` draws the hidden sidebar, its edge and the float.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
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
 * The record drawer's width in CSS pixels: a list record opens in the drawer
 * at plugin-view's `md` overlay bucket, `overlayWidthFor('md', …)` =
 * `min(92vw, 720px)` (objectstack#27545). `consoleSidebarRail.width-27593.test.tsx`
 * reads that value and holds this equal to it, so the derived threshold below
 * follows the drawer.
 */
export const RECORD_DRAWER_WIDTH = 720;

/**
 * The narrowest list that still draws its columns, in CSS pixels: the 440 px
 * measured on objectstack#27545. The drawer is non-modal over a list and draws
 * no dimming there, so the list beside it stays readable and a click on
 * another row swaps the record (`NavigationOverlay` in `@object-ui/components`).
 */
export const LIST_MIN_COLUMNS_WIDTH = 440;

/**
 * The content width the record drawer needs over the full-width list: the
 * drawer (720) and, beside it, the narrowest list that still draws its
 * columns (440).
 */
export const RECORD_DRAWER_MIN_CONTENT_WIDTH = LIST_MIN_COLUMNS_WIDTH + RECORD_DRAWER_WIDTH;

/**
 * Below this window width the sidebar folds on its own.
 *
 * Derived, not picked: a window narrower than the drawer's content plus the
 * expanded sidebar cannot keep the list's columns beside the open drawer with
 * the sidebar expanded, so the sidebar gives the content its width.
 * 1160 + 256 = 1416: a 1280 px window folds (the hidden sidebar leaves the
 * drawer 560 px of list beside it, where the expanded sidebar would leave
 * 304), a 1440 px window keeps the sidebar expanded (464 left). The record
 * page's own column tiers are measured on the container it gets, so they
 * follow either way.
 */
export const CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH = RECORD_DRAWER_MIN_CONTENT_WIDTH + CONSOLE_EXPANDED_SIDEBAR_WIDTH;

/**
 * The reader's "keep the sidebar open": `on` turns the fold off, so a narrow
 * window keeps the wide-window sidebar. A reader preference, per browser,
 * never metadata (objectstack#27052). With no choice: off. It changes when
 * the sidebar collapses, never how a collapsed sidebar looks.
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
 * the fold, the float and a sidebar kept open on a narrow window never do,
 * and the "keep open" preference lives under its own key. The primitive's
 * `sidebar_state` cookie records every open and close, the fold's included,
 * so it cannot hold the wide-window choice. The key is the one the fold's
 * stash used before, which held the same value.
 */
const WIDE_OPEN_KEY = 'os:console-sidebar:wide-open';

/**
 * Set while the menu floats over a sidebar the reader collapsed (on a wide
 * window, or on a narrow one kept open): the provider's open state is the
 * float then, not the reader's choice, so {@link writeWideWindowOpen} keeps
 * none of it, its fold back included. `useConsoleSidebarRailPanel` sets it
 * when it floats the menu and clears it once the float has folded; the console
 * draws one sidebar per page.
 */
let floatHoldsWideWindowChoice = false;

function holdWideWindowChoice(hold: boolean): void {
  floatHoldsWideWindowChoice = hold;
}

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

/** Keep the reader's wide-window choice; nothing while the menu floats. */
export function writeWideWindowOpen(open: boolean): void {
  if (floatHoldsWideWindowChoice) return;
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

/** Write the primitive's cookie as its provider writes it. */
function writeSidebarStateCookie(open: boolean): void {
  document.cookie = `${SIDEBAR_STATE_COOKIE}=${open}; path=/; max-age=${SIDEBAR_STATE_COOKIE_MAX_AGE}`;
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
 * then fold it, with the primitive's transition in between. Below the fold
 * width with no "keep open" the first frame is the hidden sidebar; on a wide
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
  writeSidebarStateCookie(open);
}

export interface ConsoleSidebarRail {
  /** The console's own collapse is on: hidden from 768 px up, with the edge and the float. */
  enabled: boolean;
  /** Enabled, and the window is at or above the phone breakpoint: the desktop sidebar, not the drawer. */
  desktop: boolean;
  /** The window is at or above {@link CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH}. */
  wide: boolean;
  /** The window is below {@link CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH} and above the phone breakpoint. */
  narrow: boolean;
  /** The reader keeps the sidebar open on a narrow window. */
  keepOpen: boolean;
  setKeepOpen: (keepOpen: boolean) => void;
  /** The fold is on: a narrow window and no "keep open". */
  railMode: boolean;
}

/**
 * Where the console sidebar stands against the fold. Inside the sidebar
 * provider. `enabled: false` answers "no fold" at every width: a sidebar the
 * console layout does not fold is drawn as the provider says.
 */
export function useConsoleSidebarRail({ enabled = true }: { enabled?: boolean } = {}): ConsoleSidebarRail {
  const { isMobile } = useSidebar();
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
  const desktop = enabled && !belowPhoneWidth && !isMobile;
  const narrow = desktop && belowRailWidth;
  const keepOpen = keepOpenChoice === 'on';
  return { enabled, desktop, wide: !belowRailWidth, narrow, keepOpen, setKeepOpen, railMode: narrow && !keepOpen };
}

/**
 * How long the pointer rests on the window's left edge before the menu floats
 * out, and how long after it moves away from the floated menu the menu folds
 * back, in ms. The hover timings of `@object-ui/components`' `NavigationMenu`,
 * the one menu there that opens on hover: Radix's navigation menu with no
 * override, whose `delayDuration` is 200 and whose close timer is 150.
 */
export const SIDEBAR_FLOAT_OPEN_DELAY_MS = 200;
export const SIDEBAR_FLOAT_CLOSE_DELAY_MS = 150;

/**
 * The left-edge strip drawn while the sidebar is hidden, which floats the
 * menu: 8 px (`w-2`), the strip the sidebar primitive's own `SidebarRail`
 * leaves inside the viewport beside a collapsed `offcanvas` sidebar (its `w-4`
 * strip moved `-right-2` past the panel's edge). Fixed, above the page; the
 * call site places it below the top bar, as it places the sidebar, so the
 * bar's trigger is never under it.
 */
export const SIDEBAR_EDGE_ZONE = 'fixed left-0 z-40 w-2';

/**
 * The frame's class while the menu floats: the sidebar's gap (the in-flow box
 * that reserves the sidebar's width, the first child of the primitive's
 * `data-collapsible` element) stays at no width, so the content beside it does
 * not move, while the fixed panel takes the expanded width over the content.
 * The frame is `display: contents`, so it adds no box of its own to the
 * shell's row.
 */
export const RAIL_OVERLAY_FRAME_NO_GAP = '[&>[data-collapsible=offcanvas]>div:first-child]:w-0';

/** The panel's classes while the menu floats: above the page, with a shadow. */
export const RAIL_OVERLAY_PANEL = 'z-40 shadow-xl';

/** A layer drawn over the page that takes Esc for itself, or holds the pointer while it is open. */
const ESCAPE_LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Is a layer (a menu, a dialog) shown over the page? */
function layerShown(): boolean {
  return Array.from(document.querySelectorAll(ESCAPE_LAYER)).some((el) => !el.closest('[hidden]'));
}

/**
 * Would this Esc go to a tooltip nobody sees (objectstack#28078)? The
 * primitive keeps an entry's tooltip open, but hidden, while the sidebar is
 * expanded: hovering or focusing an entry in the float opens it, and its
 * layer takes the next Esc and marks it handled. Read before any layer's own
 * Esc listener runs: an open hidden tooltip and no layer shown.
 */
function escapeOnlyForHiddenTooltip(): boolean {
  const tooltips = Array.from(document.querySelectorAll('[role="tooltip"]'));
  if (!tooltips.some((el) => el.closest('[hidden]'))) return false;
  return !layerShown();
}

/** The app bar's trigger: the shell's one sidebar trigger (objectui#12429). */
function sidebarTrigger(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-sidebar="trigger"]');
}

/** Where focus lands in the float: the entry of the page in view, else the first entry. */
function floatFocusTarget(root: HTMLElement | null): HTMLElement | null {
  const content = root?.querySelector<HTMLElement>('[data-sidebar="content"]');
  if (!content) return null;
  return (
    content.querySelector<HTMLElement>('[data-sidebar="menu-button"][data-active="true"]') ??
    content.querySelector<HTMLElement>('a[href], button:not([disabled])')
  );
}


/** What floated the menu: the pointer resting on the edge, a press on it, or the trigger or ⌘B. */
type FloatOpener = 'hover' | 'press' | 'command';

/**
 * What folded it: a press outside it; Esc; a link chosen in it by keyboard (or
 * any other navigation), or by pointer; the pointer moving away.
 */
type FloatCloser = 'outside' | 'escape' | 'navigate' | 'pointer' | 'away';

/** The window a float over a collapsed sidebar floated on: at or past the fold width, or below it. */
type FloatWidth = 'wide' | 'narrow';

export interface ConsoleSidebarRailPanel {
  /** The primitive's collapse: hidden when the console's collapse is on, its icon rail otherwise. */
  collapsible: 'offcanvas' | 'icon';
  /** The menu floats over the content. */
  overlayOpen: boolean;
  /** The class of the `display: contents` frame around the sidebar. */
  frameClassName: string;
  /** Classes added to the sidebar panel. */
  panelClassName: string | undefined;
  /** Props added to the sidebar panel while it is hidden or floats. */
  panelProps: {
    'data-console-rail'?: 'hidden' | 'overlay';
    inert?: boolean;
    onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove?: (event: PointerEvent<HTMLDivElement>) => void;
    onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  };
  /** The left-edge strip's handlers while the sidebar is hidden; `null` when no strip is drawn. */
  edgeZoneProps: {
    onPointerEnter: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerLeave: () => void;
    onClick: () => void;
  } | null;
  /**
   * "Keep sidebar open", at the foot of the panel: in a float it puts the
   * sidebar back beside the content and keeps it there; in a sidebar kept open
   * on a narrow window it is pressed, and turns the fold back on. `null` where
   * it is not drawn.
   */
  keepOpenControl: { pressed: boolean; onPress: () => void } | null;
}

/**
 * How the console's collapsed sidebar behaves. Collapsed from 768 px up, it is
 * hidden and inert, and an 8 px strip at the window's left edge floats the
 * menu over the content: after the pointer rests there
 * ({@link SIDEBAR_FLOAT_OPEN_DELAY_MS}), at once on a press. The app bar's
 * trigger and ⌘B float it too, whichever way the sidebar collapsed (ruling
 * 6973617688 on objectstack#35062), and move focus into it. Floating changes
 * nothing the reader chose: the wide-window choice and the cookie keep the
 * collapsed state, so a reload comes back collapsed; its "Keep sidebar open"
 * control docks the sidebar, as the reader's choice. A float the pointer
 * opened folds once the pointer has been away from it for
 * {@link SIDEBAR_FLOAT_CLOSE_DELAY_MS} (not while a menu or dialog is open over
 * the page); a navigation choice, a press outside it or Esc folds any float.
 * Focus inside a sidebar that hides goes back where it came from, or to the
 * trigger, unless a pointer folded it. `sidebarRef` is the sidebar's root (the
 * primitive's `data-collapsible` element). Inside the sidebar provider and a
 * router.
 */
export function useConsoleSidebarRailPanel(
  rail: ConsoleSidebarRail,
  sidebarRef: RefObject<HTMLDivElement | null>,
): ConsoleSidebarRailPanel {
  const { open, setOpen } = useSidebar();
  const { enabled, desktop, railMode, wide, narrow, keepOpen, setKeepOpen } = rail;
  const location = useLocation();

  // A float over a sidebar the reader collapsed, by the window it floated on;
  // while folded, every open is one. A window that turns wide or narrow ends
  // it (below).
  const width: FloatWidth = wide ? 'wide' : 'narrow';
  const [floatOn, setFloatOn] = useState<FloatWidth | null>(null);
  if (floatOn !== null && (!open || !desktop || floatOn !== width)) setFloatOn(null);
  const overlayOpen = desktop && open && (railMode || floatOn === width);
  const hidden = desktop && !open;
  const hiddenByHand = hidden && !railMode;

  const setOpenRef = useRef(setOpen);
  const overlayOpenRef = useRef(overlayOpen);
  const hiddenRef = useRef(hidden);
  const railModeRef = useRef(railMode);
  const widthRef = useRef(width);
  const openedBy = useRef<FloatOpener | null>(null);
  const closedBy = useRef<FloatCloser | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The press and the pointer move that last landed in the sidebar's React
  // tree, portals included (an entry's menu), so the document listeners can
  // tell them from outside ones.
  const insidePress = useRef<Event | null>(null);
  const insideMove = useRef<Event | null>(null);

  useLayoutEffect(() => {
    setOpenRef.current = setOpen;
    overlayOpenRef.current = overlayOpen;
    hiddenRef.current = hidden;
    railModeRef.current = railMode;
    widthRef.current = width;
  });

  const close = useCallback((by: FloatCloser) => {
    if (!overlayOpenRef.current) return;
    closedBy.current = by;
    setOpenRef.current(false);
  }, []);

  const floatMenu = useCallback((by: 'hover' | 'press') => {
    clearTimeout(openTimer.current);
    if (!hiddenRef.current) return;
    openedBy.current = by;
    if (!railModeRef.current) {
      // The reader collapsed it: the open state is the float's, not the reader's.
      holdWideWindowChoice(true);
      setFloatOn(widthRef.current);
    }
    setOpenRef.current(true);
  }, []);

  // While the sidebar is hidden by hand, the reader's own toggle (the app
  // bar's trigger, ⌘B) floats the menu as on the fold, instead of docking it
  // (ruling 6973617688). Noted in the capture phase, ahead of the provider's
  // toggle, which then opens it; "Keep sidebar open" docks it.
  useEffect(() => {
    if (!hiddenByHand) return undefined;
    const asFloat = () => {
      holdWideWindowChoice(true);
      setFloatOn(widthRef.current);
      // A toggle another listener swallowed opens nothing: let go again.
      setTimeout(() => {
        if (!overlayOpenRef.current) holdWideWindowChoice(false);
      }, 0);
    };
    const onClickCapture = (event: globalThis.MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-sidebar="trigger"]')) asFloat();
    };
    // The provider's chord: `SIDEBAR_KEYBOARD_SHORTCUT` in `@object-ui/components`' `ui/sidebar.tsx`.
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key === 'b' && (event.metaKey || event.ctrlKey)) asFloat();
    };
    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('keydown', onKeyDownCapture, true);
    };
  }, [hiddenByHand]);

  // While the menu floats, the primitive's cookie says collapsed: its setter
  // wrote it open, and a reload comes back to the reader's state, not the float.
  useLayoutEffect(() => {
    if (overlayOpen) writeSidebarStateCookie(false);
  }, [overlayOpen]);

  // "Keep sidebar open" in a float: the sidebar docks beside the content as
  // the reader's choice, kept as the wide-window choice on a wide window and
  // in the cookie; on the fold it also turns the fold off.
  const dock = useCallback(() => {
    holdWideWindowChoice(false);
    if (railModeRef.current) setKeepOpen(true);
    setFloatOn(null);
    setOpenRef.current(true);
    if (widthRef.current === 'wide') writeWideWindowOpen(true);
  }, [setKeepOpen]);
  const undock = useCallback(() => setKeepOpen(false), [setKeepOpen]);

  // Any navigation folds the float: an entry chosen in it, the command palette, Back.
  const routeKey = `${location.pathname}${location.search}`;
  const lastRouteKey = useRef(routeKey);
  useEffect(() => {
    if (lastRouteKey.current === routeKey) return;
    lastRouteKey.current = routeKey;
    close('navigate');
  }, [routeKey, close]);

  // A float over a collapsed sidebar ended by the window, not by folding or
  // docking: it turned wide or narrow, or phone-sized. The sidebar is what the
  // reader chose there: the wide-window choice on a wide window
  // (`useResponsiveSidebar` reads it too), collapsed otherwise ("keep open"
  // leaves the fold off on a narrow one).
  const floatedOn = useRef<FloatWidth | null>(null);
  useLayoutEffect(() => {
    const prev = floatedOn.current;
    floatedOn.current = floatOn;
    if (prev === null || floatOn !== null || !open) return;
    if (prev === width && desktop) return;
    setOpenRef.current(width === 'wide' ? (readWideWindowOpen() ?? false) : false);
  }, [floatOn, width, desktop, open]);

  // Focus: into a float the trigger or ⌘B opened; out of a sidebar that hides.
  const last = useRef({ open, overlayOpen, hidden });
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { open, overlayOpen, hidden };
    const root = sidebarRef.current;
    if (!hidden) clearTimeout(openTimer.current);
    // Opened while folded, by neither the edge nor the pointer: the trigger or ⌘B.
    // (The fold switching on under an open sidebar is not an opening:
    // `useResponsiveSidebar` folds it in the same frame.)
    if (overlayOpen && !prev.overlayOpen && !prev.open && openedBy.current === null) {
      openedBy.current = 'command';
      const active = document.activeElement;
      returnFocus.current =
        active instanceof HTMLElement && active !== document.body && !root?.contains(active) ? active : null;
      floatFocusTarget(root)?.focus({ preventScroll: true });
      return;
    }
    const overlayClosed = prev.overlayOpen && !overlayOpen;
    const becameHidden = hidden && !prev.hidden;
    if (!overlayClosed && !becameHidden) return;
    const by = openedBy.current;
    const closer = closedBy.current;
    const back = returnFocus.current;
    openedBy.current = null;
    closedBy.current = null;
    returnFocus.current = null;
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    // Docked from the float ("Keep sidebar open"): nothing to give back.
    if (!becameHidden) return;
    // Focus stranded in the hidden, inert sidebar. A press outside moves it where it lands.
    const active = document.activeElement;
    if (closer === 'outside' || !(active instanceof HTMLElement) || !root?.contains(active)) return;
    const byPointer = closer === 'pointer' || closer === 'away' || (closer === null && (by === 'hover' || by === 'press'));
    if (byPointer) active.blur();
    else (back?.isConnected ? back : sidebarTrigger())?.focus({ preventScroll: true });
  }, [open, overlayOpen, hidden, sidebarRef]);

  // The float has folded: the reader's wide-window choice is kept again.
  useEffect(() => {
    if (!overlayOpen) holdWideWindowChoice(false);
  }, [overlayOpen]);

  useEffect(
    () => () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      holdWideWindowChoice(false);
    },
    [],
  );

  useEffect(() => {
    if (!overlayOpen) return undefined;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event === insidePress.current) return;
      // The app bar's trigger toggles the sidebar itself.
      if (event.target instanceof Element && event.target.closest('[data-sidebar="trigger"]')) return;
      close('outside');
    };
    // A float the pointer opened folds once the pointer has been away from it a moment.
    const onPointerMove = (event: globalThis.PointerEvent) => {
      if (openedBy.current !== 'hover' || event.pointerType === 'touch') return;
      if (event === insideMove.current || layerShown()) {
        clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
        return;
      }
      if (closeTimer.current !== undefined) return;
      closeTimer.current = setTimeout(() => {
        closeTimer.current = undefined;
        close('away');
      }, SIDEBAR_FLOAT_CLOSE_DELAY_MS);
    };
    // On the window in the capture phase, ahead of the layers' own listeners.
    let hiddenTooltipEscape = false;
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hiddenTooltipEscape = escapeOnlyForHiddenTooltip();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A layer that handled Esc (a menu, a dialog) marks it handled; a hidden tooltip does not count.
      if (!event.defaultPrevented || hiddenTooltipEscape) close('escape');
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    window.addEventListener('keydown', onKeyDownCapture, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDownCapture, true);
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    };
  }, [overlayOpen, close]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    insidePress.current = event.nativeEvent;
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    insideMove.current = event.nativeEvent;
  }, []);

  // A link chosen in the float folds it, the page in view's own included. A
  // keyboard activation's click counts no presses (`detail` 0).
  const onClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!(event.target instanceof Element) || !event.target.closest('a[href]')) return;
      close(event.detail === 0 ? 'navigate' : 'pointer');
    },
    [close],
  );

  const onEdgeEnter = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') return;
      clearTimeout(openTimer.current);
      openTimer.current = setTimeout(() => floatMenu('hover'), SIDEBAR_FLOAT_OPEN_DELAY_MS);
    },
    [floatMenu],
  );
  const onEdgeLeave = useCallback(() => clearTimeout(openTimer.current), []);
  const onEdgePress = useCallback(() => floatMenu('press'), [floatMenu]);

  const panelProps: ConsoleSidebarRailPanel['panelProps'] = overlayOpen
    ? { 'data-console-rail': 'overlay', onPointerDown, onPointerMove, onClick }
    : hidden
      ? { 'data-console-rail': 'hidden', inert: true }
      : {};

  return {
    collapsible: enabled ? 'offcanvas' : 'icon',
    overlayOpen,
    frameClassName: cn('contents', overlayOpen && RAIL_OVERLAY_FRAME_NO_GAP),
    panelClassName: overlayOpen ? RAIL_OVERLAY_PANEL : undefined,
    panelProps,
    edgeZoneProps: hidden ? { onPointerEnter: onEdgeEnter, onPointerLeave: onEdgeLeave, onClick: onEdgePress } : null,
    keepOpenControl: overlayOpen
      ? { pressed: false, onPress: dock }
      : narrow && keepOpen
        ? { pressed: true, onPress: undock }
        : null,
  };
}
