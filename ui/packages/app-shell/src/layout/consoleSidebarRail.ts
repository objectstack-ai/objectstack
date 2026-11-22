// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * consoleSidebarRail — how the console sidebar docks and collapses, which
 * state a window starts in, and the menu it floats over the content
 * (objectstack#27593, objectstack#35062, objectstack#36112).
 *
 * From the phone breakpoint up the sidebar is docked beside the content or
 * collapsed, and a collapsed sidebar is hidden: it takes no width, and nothing
 * of it is drawn, focusable or announced (ruling 6973617688 on
 * objectstack#35062: one collapsed look at 768 px and up). The sidebar's
 * collapse button and, while it is collapsed, the page header's expand button
 * are the one control (ruling 7069868269 on objectstack#36112): each press is
 * the reader's choice, and this browser keeps it.
 *
 * Which state a window starts in is that choice, kept separately for a wide
 * window ({@link CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH} and up) and a narrow one
 * (from the phone breakpoint to below it). With no choice kept, a wide window
 * starts expanded and a narrow one collapsed.
 *
 * Collapsed, the full menu, with its labels and groups, floats over the
 * content without changing what the reader chose: after the pointer rests on
 * the window's left edge, after a press on that edge, and from ⌘B. A pointer
 * that floated it folds it back by moving away; a navigation choice, a press
 * outside it or Esc folds it from any of them.
 *
 * `useResponsiveSidebar` gives each window its state as it loads and as it
 * crosses the width, and keeps the reader's choices; `UnifiedSidebar` draws
 * the hidden sidebar, its edge and the float.
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
 * holds this equal to it. The width is fixed (objectstack#36112 F2).
 */
export const CONSOLE_EXPANDED_SIDEBAR_WIDTH = 256;

/**
 * The record drawer's width in CSS pixels: a list record opens in the side
 * preview at `RECORD_PREVIEW_DEFAULT_WIDTH` = `min(92vw, 460px)`
 * (objectstack#36149; 720 before). `consoleSidebarRail.width-27593.test.tsx`
 * reads that value and holds this equal to it.
 */
export const RECORD_DRAWER_WIDTH = 460;

/**
 * The narrowest list that still draws its columns, in CSS pixels: the 440 px
 * measured on objectstack#27545. The drawer is non-modal over a list and draws
 * no dimming there, so the list beside it stays readable and a click on
 * another row swaps the record (`NavigationOverlay` in `@object-ui/components`).
 */
export const LIST_MIN_COLUMNS_WIDTH = 440;

/**
 * Below this window width a window with no choice kept starts with the
 * sidebar collapsed; at it and above, expanded (ruling 7069868269 on
 * objectstack#36112, 「1280 起默认展开，更窄才收起」). The one threshold: the
 * wide and the narrow choice are kept on either side of it.
 *
 * Chosen, not derived. The record drawer beside the narrowest list that still
 * draws its columns, next to an expanded sidebar, needed 440 + 720 + 256 =
 * 1416 px when the drawer was 720, the threshold before; the ruling accepted
 * the cost below that. Since the side preview opens at 460
 * (objectstack#36149), a 1280 px window with the sidebar expanded leaves the
 * list beside it 1280 − 256 − 460 = 564 px (820 with the sidebar collapsed),
 * so the cost is gone at the preview's default width; a reader who drags it
 * wider pays it again. On 1280 to 1415 px with the sidebar expanded, opening
 * the record page's comment panel returns its fields to the tab row;
 * collapsing the sidebar gives the content the width back. The record page's own column tiers are
 * measured on the container it gets, so they follow either way.
 */
export const CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH = 1280;

/**
 * The reader's narrow-window choice: `on` keeps the sidebar expanded on a
 * window below {@link CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH}, `off` collapsed. A
 * reader preference, per browser, never metadata (objectstack#27052). With no
 * choice: collapsed. Only a collapse or expand on a narrow window by the
 * reader writes it; the float never does.
 *
 * Kept under the name the retired "Keep sidebar open" switch used, which held
 * the same choice: a reader who kept the sidebar open starts expanded on a
 * narrow window (ruling 7069868269 on objectstack#36112).
 */
export const CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE = defineWorkspacePreference<PreferenceSwitch>({
  name: 'console.sidebar.keepOpen',
  codec: versionedPreferenceCodec<PreferenceSwitch>({
    version: 1,
    toRecord: (value) => ({ value }),
    fromRecord: (record) => (record.value === 'on' || record.value === 'off' ? record.value : undefined),
  }),
});

/** The reader's narrow-window choice: expanded only when they chose it. */
function readNarrowWindowOpen(): boolean {
  return readWorkspacePreference(CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE, 'user') === 'on';
}

/**
 * Where the reader's wide-window choice, sidebar expanded or collapsed, is
 * kept (objectstack#28079). Only the reader's open or close on a wide window
 * writes it; the float never does, and the narrow-window choice lives under
 * its own key ({@link CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE}). The
 * primitive's `sidebar_state` cookie records every open and close, a narrow
 * window's included, so it cannot hold the wide-window choice.
 */
const WIDE_OPEN_KEY = 'os:console-sidebar:wide-open';

/**
 * Set while the menu floats over a sidebar the reader collapsed on a wide
 * window: the provider's open state is the float then, not the reader's choice, so {@link writeWideWindowOpen} keeps
 * none of it, its fold back included. `useConsoleSidebarRailPanel` sets it
 * when it floats the menu and clears it once the float has folded; the console
 * draws one sidebar per page.
 */
let floatHoldsWideWindowChoice = false;

function holdWideWindowChoice(hold: boolean): void {
  floatHoldsWideWindowChoice = hold;
}

/** The reader's wide-window choice, or `undefined` when none is kept (a wide window then starts expanded). */
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
 * The state a window starts in from the phone breakpoint up: the reader's
 * choice for its side of {@link CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH}, else
 * expanded on a wide window and collapsed on a narrow one.
 */
export function startingSidebarOpen(wide: boolean): boolean {
  return wide ? (readWideWindowOpen() ?? true) : readNarrowWindowOpen();
}

/**
 * Hand the sidebar provider the open state its first frame draws, before it
 * mounts (objectstack#28077): the provider starts from its cookie, which the
 * last page wrote, so a window would draw the last page's state once and then
 * switch, with the primitive's transition in between. From the phone
 * breakpoint up the first frame is the window's starting state
 * ({@link startingSidebarOpen}); the phone keeps what the cookie says. Call
 * it once, from the component that renders the provider, before the
 * provider's first render.
 */
export function primeConsoleSidebarOpen(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const width = window.innerWidth;
  if (width < PHONE_BELOW_WIDTH) return;
  writeSidebarStateCookie(startingSidebarOpen(width >= CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH));
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
  /** The reader's narrow-window choice: expanded. */
  narrowOpen: boolean;
  setNarrowOpen: (open: boolean) => void;
  /**
   * A narrow window whose sidebar is collapsed by the narrow-window choice
   * (the default): every open of the provider there is the float.
   */
  railMode: boolean;
}

/**
 * Where the console sidebar stands against the threshold. Inside the sidebar
 * provider. `enabled: false` answers "no fold" at every width: a sidebar the
 * console layout does not fold is drawn as the provider says.
 */
export function useConsoleSidebarRail({ enabled = true }: { enabled?: boolean } = {}): ConsoleSidebarRail {
  const { isMobile } = useSidebar();
  const belowRailWidth = useIsViewportBelow(CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH);
  const belowPhoneWidth = useIsViewportBelow(PHONE_BELOW_WIDTH);
  const [narrowChoice, setNarrowChoice] = useWorkspacePreference(
    CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE,
    'user',
    'off',
  );
  const setNarrowOpen = useCallback(
    (open: boolean) => setNarrowChoice(open ? 'on' : 'off'),
    [setNarrowChoice],
  );
  const desktop = enabled && !belowPhoneWidth && !isMobile;
  const narrow = desktop && belowRailWidth;
  const narrowOpen = narrowChoice === 'on';
  return { enabled, desktop, wide: !belowRailWidth, narrow, narrowOpen, setNarrowOpen, railMode: narrow && !narrowOpen };
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
 * call site places it where it places the sidebar.
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

/**
 * The sidebar trigger focus can go to: the first one not inside an inert
 * region. The sidebar's own collapse button is inert while it is hidden, so
 * this finds the page header's expand button then.
 */
function sidebarTrigger(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar="trigger"]')).find(
      (el) => !el.closest('[inert]'),
    ) ?? null
  );
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


/** What floated the menu: the pointer resting on the edge, a press on it, or ⌘B. */
type FloatOpener = 'hover' | 'press' | 'command';

/**
 * What folded it: a press outside it; Esc; a link chosen in it by keyboard (or
 * any other navigation), or by pointer; or the pointer moving away.
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
}

/**
 * How the console's collapsed sidebar behaves. Collapsed from 768 px up, it is
 * hidden and inert, and an 8 px strip at the window's left edge floats the
 * menu over the content: after the pointer rests there
 * ({@link SIDEBAR_FLOAT_OPEN_DELAY_MS}), at once on a press. ⌘B floats it too,
 * whichever window it collapsed on (ruling 6973617688 on objectstack#35062),
 * and moves focus into it. Floating changes nothing the reader chose: the
 * kept choices and the cookie keep the collapsed state, so a reload comes back
 * collapsed. The page header's expand button docks the sidebar instead, as the
 * reader's choice (ruling 7069868269 on objectstack#36112): on a narrow window
 * it keeps the narrow-window choice expanded, ahead of the provider's toggle.
 * A float the pointer opened folds once the pointer has been away from it for
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
  const { enabled, desktop, railMode, wide, narrowOpen, setNarrowOpen } = rail;
  const location = useLocation();

  // A float over a sidebar the reader collapsed, by the window it floated on;
  // while folded, every open is one. A window that turns wide or narrow ends
  // it (below).
  const width: FloatWidth = wide ? 'wide' : 'narrow';
  const [floatOn, setFloatOn] = useState<FloatWidth | null>(null);
  // The reader's own toggle while the sidebar is hidden by hand (below): the
  // open it brings is a float.
  const [toggleFloats, setToggleFloats] = useState<FloatWidth | null>(null);
  if (toggleFloats !== null && open) {
    setToggleFloats(null);
    if (desktop && !railMode && floatOn === null && toggleFloats === width) setFloatOn(toggleFloats);
  }
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

  // While the sidebar is hidden, the page header's expand button docks it,
  // as the reader's choice (ruling 7069868269): on a narrow window it keeps
  // the narrow-window choice expanded before the provider's toggle opens it,
  // so the open is not the float; on a wide window the toggle's open is
  // already the reader's. ⌘B floats the menu instead (ruling 6973617688):
  // while the sidebar is hidden by hand on a wide window its toggle is noted
  // in the capture phase, ahead of the provider's, whose open the next render
  // turns into the float; on the fold every open is the float. A browser may
  // render between the two (its microtask checkpoint after each listener), so
  // the note waits for the open.
  useEffect(() => {
    if (!hidden) return undefined;
    const onClickCapture = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-sidebar="trigger"]')) return;
      if (railModeRef.current) setNarrowOpen(true);
    };
    // The provider's chord: `SIDEBAR_KEYBOARD_SHORTCUT` in `@object-ui/components`' `ui/sidebar.tsx`.
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (!hiddenByHand || event.key !== 'b' || !(event.metaKey || event.ctrlKey)) return;
      holdWideWindowChoice(true);
      setToggleFloats(widthRef.current);
      // A toggle another listener swallowed opens nothing: drop the note.
      setTimeout(() => {
        setToggleFloats(null);
        if (!overlayOpenRef.current) holdWideWindowChoice(false);
      }, 0);
    };
    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('keydown', onKeyDownCapture, true);
    };
  }, [hidden, hiddenByHand, setNarrowOpen]);

  // While the menu floats, the primitive's cookie says collapsed: its setter
  // wrote it open, and a reload comes back to the reader's state, not the float.
  useLayoutEffect(() => {
    if (overlayOpen) writeSidebarStateCookie(false);
  }, [overlayOpen]);

  // Any navigation folds the float: an entry chosen in it, the command palette, Back.
  const routeKey = `${location.pathname}${location.search}`;
  const lastRouteKey = useRef(routeKey);
  useEffect(() => {
    if (lastRouteKey.current === routeKey) return;
    lastRouteKey.current = routeKey;
    close('navigate');
  }, [routeKey, close]);

  // A float over a collapsed sidebar ended by the window, not by folding: it
  // turned wide or narrow, or phone-sized. The sidebar is the window's
  // starting state there, as `useResponsiveSidebar` gives it.
  const floatedOn = useRef<FloatWidth | null>(null);
  useLayoutEffect(() => {
    const prev = floatedOn.current;
    floatedOn.current = floatOn;
    if (prev === null || floatOn !== null || !open) return;
    if (prev === width && desktop) return;
    setOpenRef.current(width === 'wide' ? (readWideWindowOpen() ?? true) : narrowOpen);
  }, [floatOn, width, desktop, open, narrowOpen]);

  // Focus: into a float the trigger or ⌘B opened; out of a sidebar that hides.
  const last = useRef({ open, overlayOpen, hidden });
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { open, overlayOpen, hidden };
    const root = sidebarRef.current;
    if (!hidden) clearTimeout(openTimer.current);
    // Opened while folded, by neither the edge nor the pointer: ⌘B.
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
    if (!becameHidden) return;
    const active = document.activeElement;
    // Focus stranded in the hidden, inert sidebar. A press outside moves it where it lands.
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
      // A sidebar trigger toggles the sidebar itself.
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
  };
}
