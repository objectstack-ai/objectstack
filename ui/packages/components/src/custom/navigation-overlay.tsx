/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * NavigationOverlay
 *
 * A reusable component that renders record detail overlays based on
 * ViewNavigationConfig mode: the drawer (Sheet), and the split pane a host
 * draws from a reader's own preference. `modal` and `popover` were retired
 * from the spec's `NavigationModeSchema` (objectstack#26677), and with them
 * the Dialog and Popover faces: no caller could reach either once the values
 * left metadata.
 *
 * Both faces leave a list the host hands over (`mainContent`) usable
 * (objectstack#27545): the drawer over it draws no dimming overlay and is
 * non-modal, so a click on another row swaps the record instead of closing
 * it; the split pane sits beside it, and it narrows to the remaining width.
 * A drawer with no list is the modal sheet over the page, as before. A split pane falls back to the drawer when
 * the content area is narrower than {@link RECORD_SPLIT_MIN_CONTENT_PX}, and a
 * `maximizable` host gets `⤢`, which widens the pane in place over the whole
 * content area — the sidebar stays — without leaving the URL it is on.
 *
 * Works in conjunction with useNavigationOverlay hook from @object-ui/react —
 * the hook manages state while this component handles the visual presentation.
 *
 * What the hook is handed as `objectName` is the block's RECORD SOURCE — the
 * object the clicked rows actually came from — read through the ONE shared
 * reader `resolveRecordSourceObjectName` from `@object-ui/core`
 * (`b041b9c0c`), and never a bare top-level `schema.objectName` in its place
 * (`2ce2612df`). `useNavigationOverlay`'s own doc block carries that rule in
 * full, including the caller with NO data config whose `schema.objectName`
 * already IS its record source; this example follows that block rather than
 * restating it, because a ruling written out twice is a ruling one of whose
 * copies rots — which is exactly what happened to this example (objectui#7787).
 *
 * @example
 * ```tsx
 * import {
 *   resolveRecordSourceConfig,
 *   resolveRecordSourceObjectName,
 * } from '@object-ui/core';
 * import { useNavigationOverlay } from '@object-ui/react';
 * import { NavigationOverlay } from '@object-ui/components';
 *
 * const dataConfig = useMemo(() => resolveRecordSourceConfig(schema), [schema]);
 * const nav = useNavigationOverlay({
 *   navigation: schema.navigation,
 *   objectName: resolveRecordSourceObjectName(schema, dataConfig),
 * });
 *
 * return (
 *   <>
 *     <DataTable onRowClick={nav.handleClick} />
 *     <NavigationOverlay {...nav} title="Record Detail">
 *       {(record) => <RecordDetail record={record} />}
 *     </NavigationOverlay>
 *   </>
 * );
 * ```
 */

import React from 'react';
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, Maximize2, Minimize2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet';
import { useOptionalSidebar } from '../ui/sidebar';
import { usePopperAwareInteractOutside } from './mobile-dialog-content';
import { createSafeTranslation } from '@object-ui/i18n';
import {
  ActiveListRecordProvider,
  RecordListFaceProvider,
  recordListFaceFor,
  type RecordListFace,
} from './record-list-face';

/**
 * English defaults for every string this overlay renders as chrome
 * (objectstack#5430, objectstack#5506).
 *
 * `createSafeTranslation` — not the per-call `useSafeTranslate` this file used
 * before — because two of these keys INTERPOLATE (`recordDetailOverlay` takes
 * `{{title}}`) and `useSafeTranslate`'s signature carries no options bag. The
 * defaults map is also what keeps the no-provider path English: `ObjectView`'s
 * unit tests and `e2e/live/inline-edit-polish-2572.spec.ts` address these
 * controls by their English accessible names with no `I18nProvider` mounted.
 */
const OVERLAY_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'common.close': 'Close',
  'common.closePanel': 'Close panel',
  // The drag handle is a bare `role="separator"` with no visible label, so
  // this literal IS the control to a screen reader.
  'common.resizeDrawer': 'Resize drawer',
  // Default accessible name + tooltip of the icon-only ↗ a host's own page
  // hop draws (`onExpand`). Hosts may override it via the `expandLabel` prop.
  'detail.openAsFullPage': 'Open as full page',
  // The bar's ⤢ / ⤡ pair (`maximizable`, objectstack#27545).
  'detail.maximize': 'Maximize',
  'detail.restoreSize': 'Restore size',
  // The pane's accessible name when the host passes no `title`. The bar draws
  // no title text on either face (objectstack#26679: the record body names
  // the record), so this is an accessible name only.
  'detail.recordDetail': 'Record Detail',
  // The bar's back control (`onBack`, objectstack#26679).
  'detail.goBack': 'Go back',
  // The bar's previous / next pair (`stepper`, objectstack#26679).
  'detail.previousRecord': 'Previous record',
  'detail.nextRecord': 'Next record',
  // sr-only Sheet description used when the host passes no `description`.
  'detail.recordDetailOverlay': 'Record detail overlay for {{title}}.',
};

/**
 * Probe key is `common.close`: present in all ten packs, so a mounted
 * `I18nProvider` always resolves it and the real `t` is used; with no provider
 * the probe fails and every key above falls back to its English default.
 */
const useOverlayTranslation = createSafeTranslation(
  OVERLAY_DEFAULT_TRANSLATIONS,
  'common.close',
);

/**
 * Navigation mode type — the spec's `NavigationMode` (`drawer | page |
 * new_window | none`, objectstack#26677) plus `split`: the side-by-side pane is
 * no longer metadata but a reader's own preference, which a host (the
 * console's object page) turns into this mode when it draws an open record
 * beside its list.
 */
export type NavigationOverlayMode =
  | 'page'
  | 'drawer'
  | 'split'
  | 'new_window'
  | 'none';

export interface NavigationOverlayProps {
  /** Whether the overlay is open */
  isOpen: boolean;
  /** The selected record */
  selectedRecord: Record<string, unknown> | null;
  /** The navigation mode */
  mode: NavigationOverlayMode;
  /** Close the overlay */
  close: () => void;
  /** Set open state (for the controlled Sheet's onOpenChange) */
  setIsOpen: (open: boolean) => void;
  /**
   * Width of the pane (drawer / split) until the reader drags it. Drawn as
   * given: no floor widens it (objectstack#27545).
   */
  width?: string | number;
  /** Whether navigation is an overlay mode */
  isOverlay: boolean;
  /** Target view/form name from NavigationConfig */
  view?: string;
  /**
   * The pane's accessible name. Neither face draws title text — the bar holds
   * controls only (objectstack#26679, maintainer ruling 2).
   */
  title?: string;
  /** The drawer's accessible description (objectstack#26679). */
  description?: string;
  /** CSS class for the overlay container */
  className?: string;
  /**
   * Render function for the overlay content.
   * Receives the selected record.
   */
  children: (record: Record<string, unknown>) => React.ReactNode;
  /**
   * Optional render function for a specific view/form based on `view` prop.
   * When provided, this takes priority over `children` for rendering overlay content.
   * Receives the selected record and the view name.
   */
  renderView?: (record: Record<string, unknown>, viewName: string) => React.ReactNode;
  /**
   * The list the pane opens records from (drawer and split, objectstack#27545).
   *
   * Drawn whether or not a record is open, always in the same place, so
   * opening, stepping and closing never remount it. The split face narrows it
   * beside the pane and publishes its narrowed face (`useRecordListFace`);
   * both faces publish which row is open (`useIsActiveListRecord`, from
   * {@link activeListRecordId}). Pass the same element across renders: an
   * unchanged element is not re-rendered when the open record changes.
   *
   * Without it the split face draws nothing and the drawer floats alone.
   */
  mainContent?: React.ReactNode;
  /**
   * The id of the row in {@link mainContent} the open record came from — the
   * root of a host's in-place stack, not the level it shows (objectstack#27545).
   */
  activeListRecordId?: string | null;
  /**
   * A host's own page hop, drawn as `↗` on the bar. The console's record
   * pane passes none: its full page is reached from the list row's `↗` and the
   * record header's `⋯` menu (objectstack#27545).
   *
   * When omitted, the button is not rendered.
   */
  onExpand?: () => void;
  /**
   * `⤢` maximize in place (objectstack#27545): the pane widens over the whole
   * content area — the viewport less the sidebar's live width — and the list
   * behind it is hidden; `⤡` or `Esc` restores the width it had. Nothing else
   * changes: the URL, the history, the list's scroll and the host's stack.
   * Not remembered: every open starts at the pane's width.
   */
  maximizable?: boolean;
  /**
   * Optional label for the `↗` host page hop (accessible name & tooltip).
   *
   * When omitted the overlay resolves `detail.openAsFullPage` from the session
   * locale (English when no `I18nProvider` is mounted) — it is no longer a
   * hardcoded English literal (objectstack#5506).
   */
  expandLabel?: string;
  /**
   * Optional storage key for persisting the user's manually-resized drawer
   * width (drawer and split). When provided, the pane renders a drag
   * handle on its left edge and remembers the resized width in
   * `localStorage` across sessions. Use a stable, scoped key such as
   * `'drawer-width:lead'` so different objects get independent widths.
   *
   * When omitted, the drag handle is hidden and width is fully controlled
   * by the `width` prop / configured ceiling.
   */
  storageKey?: string;
  /**
   * Retired storage key whose value is migrated into `storageKey` once
   * (drawer and split).
   *
   * ⭐ objectui#9299 item 4: there used to be TWO drag-resize implementations
   * with two different persisted keys and two different floors —
   * `RecordDetailDrawer`'s `objectui.drawerWidth.OBJECT` and this component's
   * `ov:STORAGE_KEY`. They are now one implementation, and a user who had
   * already dragged a gantt / kanban / calendar drawer to their preferred width
   * must keep that width rather than be silently reset to the default. So the
   * first mount that finds no value under `storageKey` adopts the value found
   * under this key, writes it forward, and REMOVES the retired entry — which is
   * what makes the migration one-time rather than a permanent second read: a
   * later double-click reset must not resurrect the old width.
   *
   * Build it with {@link legacyRecordDrawerWidthKey} rather than spelling the
   * prefix again at a call site.
   */
  legacyStorageKey?: string;
  /**
   * One level back (drawer and split, objectstack#26679). When provided the
   * bar draws a `←` control at its left edge and `Esc` calls this instead of
   * closing the drawer: a host that opened a record IN PLACE (a related row,
   * a lookup value) hands it the pop of its stack, so each `←` / `Esc` undoes
   * one click. Absent at the stack's root, where `Esc` closes as before.
   */
  onBack?: () => void;
  /**
   * The path drawn after the `←` control (drawer and split,
   * objectstack#26679) — the host's ancestors of the record shown, each one a
   * control that returns to it. Nothing is drawn at the left of the bar when
   * neither this nor {@link onBack} is passed: the bar names no object and no
   * position (maintainer rulings 2 and 3 on objectstack#26679).
   */
  trail?: React.ReactNode;
  /**
   * Previous / next record (drawer and split, objectstack#26679). When passed
   * the bar draws the `↑` `↓` pair, and `↑` / `↓` / `k` / `j` step through the
   * host's sibling set while no text input, menu or grid has the keyboard.
   * A missing handler draws its control disabled — the ends of the set.
   */
  stepper?: {
    onPrevious?: () => void;
    onNext?: () => void;
  };
}

/**
 * Whether a key event belongs to the element it was typed in rather than to
 * the drawer's own shortcuts: a text field, an editable region, or a
 * composite widget that already moves with the arrow keys (a menu, a list
 * box, a grid, a tab strip).
 */
function keyEventOwnedByTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
    return true;
  }
  return !!target.closest(
    '[role="menu"], [role="menubar"], [role="listbox"], [role="combobox"], [role="grid"], [role="treegrid"], [role="tree"], [role="tablist"], [role="radiogroup"], [role="slider"], [role="spinbutton"]',
  );
}

/**
 * The drawer's previous / next shortcuts (objectstack#26679): `ArrowUp` / `k`
 * and `ArrowDown` / `j`, on the document while the drawer is open, never with
 * a modifier and never while the event belongs to its target
 * ({@link keyEventOwnedByTarget}).
 */
function useStepperKeys(
  active: boolean,
  onPrevious: (() => void) | undefined,
  onNext: (() => void) | undefined,
) {
  const handlers = React.useRef({ onPrevious, onNext });
  handlers.current = { onPrevious, onNext };
  React.useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (keyEventOwnedByTarget(e.target)) return;
      let step: (() => void) | undefined;
      if (e.key === 'ArrowUp' || e.key === 'k') step = handlers.current.onPrevious;
      else if (e.key === 'ArrowDown' || e.key === 'j') step = handlers.current.onNext;
      else return;
      // The key is the drawer's even at an end of the set, so the body does
      // not scroll under a disabled control.
      e.preventDefault();
      step?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

/** The bar's icon-button face, shared by every control on it. */
const BAR_BUTTON_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

/**
 * The one `storageKey` spelling every record overlay uses, keyed by object.
 *
 * `NavigationOverlay` prefixes it with `ov:` on the way to `localStorage`, so
 * the stored key is `ov:drawer-width:OBJECT`. The console's own object page
 * (`app-shell`'s `ObjectView`) has always used this spelling; after
 * objectui#9299 the five list-type renderers use it too, so one object has one
 * remembered overlay width no matter which view type the user resized it on.
 */
export function recordOverlayWidthStorageKey(objectName: string): string {
  return `drawer-width:${objectName}`;
}

/**
 * The RETIRED per-object key `RecordDetailDrawer` persisted its width under
 * before objectui#9299. Read once, migrated forward, then removed — see
 * {@link NavigationOverlayProps.legacyStorageKey}. ⛔ Nothing writes it.
 */
export function legacyRecordDrawerWidthKey(objectName: string): string {
  return `objectui.drawerWidth.${objectName}`;
}

/**
 * Resolve width to CSS-compatible value
 */
function resolveWidth(width: string | number | undefined): string | undefined {
  if (width == null) return undefined;
  if (typeof width === 'number') return `${width}px`;
  return width;
}

/** Hard floor for drag-resize — narrower than this and the body becomes unusable. */
const DRAWER_MIN_PX = 360;
/**
 * The widest a reader can drag the pane, as a share of the viewport
 * (objectstack#27545: wider than that is what `⤢` is for). A remembered
 * width beyond it draws at this bound.
 */
const DRAWER_MAX_VW = 60;

/**
 * Below this content-area width a split pane draws as the drawer instead
 * (objectstack#27545): beside a 720 px pane the list would have no room left.
 */
export const RECORD_SPLIT_MIN_CONTENT_PX = 1000;

/**
 * The sidebar provider's own widths (`--sidebar-width`, `--sidebar-width-icon`
 * in `ui/sidebar.tsx`). Inside the provider the variables resolve to their
 * live values; these stand in only where they do not resolve — the drawer
 * renders in a portal outside the provider's element.
 */
export const SIDEBAR_WIDTH_FALLBACK = '16rem';
export const SIDEBAR_WIDTH_ICON_FALLBACK = '3rem';

/**
 * The CSS length the sidebar takes right now: its full width when expanded,
 * its icon rail when collapsed, none on a phone or with no sidebar at all.
 * Read on every render from the sidebar's own state, so a collapse — the
 * reader's or the shell's own — widens a maximized pane at once.
 */
function useLiveSidebarWidth(): string {
  const sidebar = useOptionalSidebar();
  if (!sidebar || sidebar.isMobile) return '0px';
  return sidebar.state === 'collapsed'
    ? `var(--sidebar-width-icon, ${SIDEBAR_WIDTH_ICON_FALLBACK})`
    : `var(--sidebar-width, ${SIDEBAR_WIDTH_FALLBACK})`;
}

/** The width a maximized pane takes: the viewport less the live sidebar. */
function maximizedWidthCss(sidebarWidth: string): string {
  return `calc(100vw - ${sidebarWidth})`;
}

/** An element's rendered width, kept current while it resizes; `null` until measured. */
function useElementWidth(el: HTMLElement | null): number | null {
  const [width, setWidth] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    if (!el) {
      setWidth(null);
      return;
    }
    const read = () => {
      const next = el.getBoundingClientRect().width;
      setWidth(next > 0 ? next : null);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return width;
}

/**
 * Whether an `Esc` belongs to the element it was pressed in rather than to the
 * split pane: a text field, or an open menu, list box or dialog (which closes
 * itself first and marks the event handled).
 */
function escapeOwnedByTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
    return true;
  }
  return !!target.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]');
}

/**
 * The split pane's `Esc`, on the document while it is open: the drawer gets
 * the same key from its dialog layer, the pane beside the list has none.
 */
function useSplitEscape(active: boolean, onEscape: () => void) {
  const handler = React.useRef(onEscape);
  handler.current = onEscape;
  React.useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (escapeOwnedByTarget(e.target)) return;
      e.preventDefault();
      handler.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

/**
 * Pane resize state — drag handle on the left edge, value persisted to
 * localStorage so the same user gets a consistent width across sessions /
 * objects. Returns `null` when storageKey is absent (resize disabled).
 */
function useDrawerResize(
  storageKey: string | undefined,
  legacyStorageKey: string | undefined,
) {
  const [width, setWidth] = React.useState<number | null>(null);
  const draggingRef = React.useRef(false);

  // Restore persisted width on mount — and, once, adopt a width the user had
  // already chosen under the RETIRED key (objectui#9299 item 4).
  //
  // Order matters and is the whole point: the current key wins outright, so a
  // width set since the migration is never overwritten by a stale one. The
  // legacy read only fires when this key holds nothing.
  //
  // ⚠️ `parseInt` is deliberate for the legacy value: that is how
  // `RecordDetailDrawer` read its own key, and reading it with a stricter
  // parser than the writer used would drop widths rather than carry them over.
  React.useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(`ov:${storageKey}`);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= DRAWER_MIN_PX) setWidth(n);
        return;
      }
      if (!legacyStorageKey) return;
      const legacyRaw = window.localStorage.getItem(legacyStorageKey);
      if (!legacyRaw) return;
      const legacy = parseInt(legacyRaw, 10);
      if (!Number.isFinite(legacy) || legacy < DRAWER_MIN_PX) return;
      setWidth(legacy);
      window.localStorage.setItem(`ov:${storageKey}`, String(legacy));
      // Removing it is what makes this a MIGRATION rather than a permanent
      // second read: after a double-click reset (which clears `ov:`) the old
      // width must stay gone.
      window.localStorage.removeItem(legacyStorageKey);
    } catch {
      // ignore (private mode / quota)
    }
  }, [storageKey, legacyStorageKey]);

  const handleMouseDown = React.useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!storageKey || typeof window === 'undefined') return;
    e.preventDefault();
    draggingRef.current = true;

    const maxPx = Math.floor((window.innerWidth * DRAWER_MAX_VW) / 100);
    // The pane is right-anchored: the drawer at the viewport's edge, the
    // split pane at the content area's (the handle's own pane).
    const paneRight = e.currentTarget.parentElement?.getBoundingClientRect().right || window.innerWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(maxPx, Math.max(DRAWER_MIN_PX, paneRight - ev.clientX));
      setWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Persist the latest value (read from state via functional setter to
      // avoid stale closures over the start-of-drag width).
      setWidth((latest) => {
        if (latest != null) {
          try {
            window.localStorage.setItem(`ov:${storageKey}`, String(latest));
          } catch {
            // ignore
          }
        }
        return latest;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [storageKey]);

  // Double-click handle resets to the host-configured width.
  const handleDoubleClick = React.useCallback(() => {
    if (!storageKey || typeof window === 'undefined') return;
    setWidth(null);
    try {
      window.localStorage.removeItem(`ov:${storageKey}`);
    } catch {
      // ignore
    }
  }, [storageKey]);

  return { width, handleMouseDown, handleDoubleClick, enabled: !!storageKey };
}

/**
 * NavigationOverlay — renders record detail in the configured overlay mode.
 *
 * Supports:
 * - **drawer**: Right-side Sheet panel — non-modal over a `mainContent` list,
 *   modal over the page without one
 * - **split**: a pane beside the list (a host's preference face); the drawer
 *   when the content area is too narrow for both
 * - **page / new_window / none**: no record is drawn (the hook navigates); a
 *   `mainContent` is still drawn, in the same place
 */
export const NavigationOverlay: React.FC<NavigationOverlayProps> = ({
  isOpen,
  selectedRecord,
  mode,
  close,
  setIsOpen,
  width,
  view,
  title,
  description,
  className,
  children,
  renderView,
  mainContent,
  activeListRecordId,
  onExpand,
  maximizable,
  expandLabel,
  storageKey,
  legacyStorageKey,
  onBack,
  trail,
  stepper,
}) => {
  // Every chrome string below is locale-driven (objectstack#5430 for the two
  // close affordances, objectstack#5506 for the rest). Must stay above the
  // conditional returns — rules-of-hooks.
  const { t } = useOverlayTranslation();
  const resolvedTitle = title || t('detail.recordDetail');
  // `??` rather than a destructuring default so the semantics are unchanged
  // for hosts that pass the prop: a default parameter also only fires on
  // `undefined`.
  const resolvedExpandLabel = expandLabel ?? t('detail.openAsFullPage');
  // sr-only Sheet description for the drawer below.
  const overlayDescription = t('detail.recordDetailOverlay', { title: resolvedTitle });
  const paneMode = mode === 'drawer' || mode === 'split';
  // Keep hooks above all conditional returns. Opening a record changes
  // selectedRecord from null to an object, but hook order must stay stable.
  const resize = useDrawerResize(
    paneMode ? storageKey : undefined,
    paneMode ? legacyStorageKey : undefined,
  );
  // The list is drawn in every mode, in one place, so a host that hands it
  // over never remounts it when the mode or the face changes.
  const hasList = mainContent != null;
  const [hostEl, setHostEl] = React.useState<HTMLDivElement | null>(null);
  const [listEl, setListEl] = React.useState<HTMLDivElement | null>(null);
  const hostWidth = useElementWidth(hasList ? hostEl : null);
  const listWidth = useElementWidth(hasList ? listEl : null);
  const shown = paneMode && isOpen && !!selectedRecord;
  // An unmeasured host (no layout yet) is taken as wide enough.
  const face: 'drawer' | 'split' =
    mode === 'split' && !(hostWidth !== null && hostWidth < RECORD_SPLIT_MIN_CONTENT_PX) ? 'split' : 'drawer';
  const [maximizedState, setMaximized] = React.useState(false);
  // Not remembered: a closed pane opens at its own width again.
  React.useEffect(() => {
    if (!shown) setMaximized(false);
  }, [shown]);
  const maximized = !!maximizable && shown && maximizedState;
  const sidebarWidth = useLiveSidebarWidth();
  const handleInteractOutside = usePopperAwareInteractOutside();
  useStepperKeys(paneMode && shown && !!stepper, stepper?.onPrevious, stepper?.onNext);
  // `Esc`: from maximized it restores, below the stack's root it goes back one
  // level, at the root it closes. The drawer's dialog layer asks the same
  // through `onEscapeKeyDown` below.
  const handleEscape = () => {
    if (maximized) setMaximized(false);
    else if (onBack) onBack();
    else close();
  };
  useSplitEscape(hasList && face === 'split' && shown, handleEscape);

  // Non-overlay modes draw no record (the hook navigates); only the list.
  if (!paneMode && !hasList) {
    return null;
  }
  // A split pane needs the list it sits beside.
  if (mode === 'split' && !hasList) {
    return null;
  }

  // Pane width policy: the reader's dragged width, bounded by the drag range
  // even when it was remembered at a wider viewport; otherwise the host's
  // width as given. A maximized pane takes the content area instead.
  const paneWidthCss = resize.width != null
    ? `min(${resize.width}px, ${DRAWER_MAX_VW}vw)`
    : resolveWidth(width) ?? '42rem';
  const widthStyle: React.CSSProperties = {
    ['--ov-w' as any]: maximized ? maximizedWidthCss(sidebarWidth) : paneWidthCss,
  };

  // Use renderView when both renderView and view are provided; otherwise fallback to children
  const renderContent = (record: Record<string, unknown>) => {
    if (renderView && view) {
      return renderView(record, view);
    }
    return children(record);
  };

  /* Drag-resize handle — only rendered on sm+ (mobile uses full viewport so
     there's nothing meaningful to resize) and never while maximized. The
     4px-wide invisible hit-area sits flush with the pane's left edge; the
     visible 1px tint reacts on hover so users discover the affordance.
     Double-click resets to the configured default. */
  const resizeHandle = resize.enabled && !maximized ? (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('common.resizeDrawer')}
      onMouseDown={resize.handleMouseDown}
      onDoubleClick={resize.handleDoubleClick}
      className="hidden sm:block absolute left-0 top-0 bottom-0 z-30 w-1 cursor-col-resize touch-none bg-transparent hover:bg-primary/40 active:bg-primary/60 transition-colors"
    />
  ) : null;

  // ✕ closes the whole path on either face; beside the list it is named the
  // panel's close, as it always was.
  const closeLabel = hasList && face === 'split' ? t('common.closePanel') : t('common.close');

  /* The bar (objectstack#26679, maintainer rulings 2-5): the left side holds
     only the in-place path — `←` and the ancestors — and is empty at the root;
     the right side holds ↑ ↓, ⤢ / ⤡ and ✕. No object name and no position. */
  const barControls = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1" data-testid="record-drawer-leading">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t('detail.goBack')}
            title={t('detail.goBack')}
            className={BAR_BUTTON_CLASS}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        {trail}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {stepper && (
          <>
            <button
              type="button"
              onClick={stepper.onPrevious}
              disabled={!stepper.onPrevious}
              aria-label={t('detail.previousRecord')}
              title={t('detail.previousRecord')}
              className={BAR_BUTTON_CLASS}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={stepper.onNext}
              disabled={!stepper.onNext}
              aria-label={t('detail.nextRecord')}
              title={t('detail.nextRecord')}
              className={BAR_BUTTON_CLASS}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {onExpand && (
          <button
            type="button"
            onClick={() => onExpand()}
            aria-label={resolvedExpandLabel}
            title={resolvedExpandLabel}
            className={BAR_BUTTON_CLASS}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        )}
        {maximizable && (
          <button
            type="button"
            onClick={() => setMaximized((was) => !was)}
            aria-label={maximized ? t('detail.restoreSize') : t('detail.maximize')}
            title={maximized ? t('detail.restoreSize') : t('detail.maximize')}
            className={BAR_BUTTON_CLASS}
            data-testid="record-pane-maximize"
          >
            {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={close}
          aria-label={closeLabel}
          title={closeLabel}
          className={BAR_BUTTON_CLASS}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </>
  );
  const barClass = 'shrink-0 flex-row items-center justify-between gap-2 space-y-0 px-4 py-2 border-b bg-muted/30';

  // --- Drawer (Sheet) ---
  // Over a list the host handed over, non-modal and undimmed
  // (objectstack#27545): the list stays readable and clickable, so an outside
  // click — another row, the toolbar — never dismisses it; ✕ and `Esc` do.
  // With no list it is the modal sheet over the page it always was.
  const drawer = paneMode && face === 'drawer' && selectedRecord ? (
    <Sheet open={isOpen} onOpenChange={setIsOpen} modal={!hasList}>
      <SheetContent
        side="right"
        hideOverlay={hasList}
        onInteractOutside={hasList ? (e) => e.preventDefault() : handleInteractOutside}
        // Suppress Radix's default auto-focus on open. The overlay is for
        // browsing/inspecting a record, not for immediate keyboard entry, so
        // auto-focusing the Close button (or the first focusable child)
        // flashes a focus ring on mount which feels jarring. Keyboard users
        // still Tab in normally.
        //
        // This came in with objectui#9299's chrome de-duplication: it was
        // `RecordDetailDrawer`'s behaviour, reasoned and deliberate, and the
        // ruling makes this component the ONE drawer. Converging on the
        // documented choice rather than dropping it is what "one shared
        // overlay shell" has to mean when the two shells disagreed.
        onOpenAutoFocus={(e) => e.preventDefault()}
        // objectstack#27545 — from maximized, `Esc` restores; objectstack#26679
        // — below the root of an in-place stack, `Esc` goes back one level.
        // Only the root's `Esc` closes.
        onEscapeKeyDown={maximized || onBack ? (e) => { e.preventDefault(); handleEscape(); } : undefined}
        className={cn(
          // Mobile: full width (no inline cap, no max-w from base sheet).
          // sm+: honor the pane width via the `--ov-w` CSS var. The host's
          // className still wins on more specific tokens.
          'w-screen max-w-none sm:w-full sm:max-w-[var(--ov-w,42rem)] p-0 flex flex-col gap-0 overflow-hidden',
          // Hide shadcn Sheet's auto-rendered close (X) — it's the LAST
          // direct <button> child of SheetContent. We render our own close
          // inside the header so it sits in a single button cluster.
          '[&>button:last-of-type]:hidden',
          mode === 'drawer' && className,
        )}
        style={widthStyle}
        data-maximized={maximized ? '' : undefined}
      >
        {resizeHandle}
        <SheetHeader className={barClass}>
          {/* The title and description stay for assistive technology only
              (Radix requires the title). */}
          <SheetTitle className="sr-only">{resolvedTitle}</SheetTitle>
          <SheetDescription className="sr-only">
            {description || overlayDescription}
          </SheetDescription>
          {barControls}
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {renderContent(selectedRecord)}
        </div>
      </SheetContent>
    </Sheet>
  ) : null;

  if (!hasList) return drawer;

  // --- The list, and the split pane beside it ---
  // One element across every state — closed, split, drawer, maximized — so
  // the list never remounts and its scroll survives (objectstack#27545). The
  // pane is one element too: maximizing restyles it, it does not remount it.
  const paneBeside = face === 'split' && shown;
  const listFace: RecordListFace = paneBeside && !maximized
    ? listWidth !== null ? recordListFaceFor(listWidth) : 'columns'
    : 'full';
  return (
    <>
      <ActiveListRecordProvider recordId={shown ? activeListRecordId ?? null : null}>
        <RecordListFaceProvider value={listFace}>
          <div
            ref={setHostEl}
            className={cn('relative flex h-full min-h-0 min-w-0 flex-1 flex-row', mode === 'split' && className)}
            data-testid="record-split-host"
          >
            <div
              ref={setListEl}
              className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
              // Maximized, the pane covers the list; the list keeps its place
              // and its scroll, out of reach until the pane is restored.
              inert={maximized}
              data-testid="record-split-list"
            >
              {mainContent}
            </div>
            {paneBeside && selectedRecord && (
              <aside
                aria-label={resolvedTitle}
                className={cn(
                  'flex h-full min-h-0 flex-col overflow-hidden bg-background',
                  maximized
                    ? 'absolute inset-y-0 right-0 z-20 w-[var(--ov-w)] max-w-full'
                    : 'relative w-[var(--ov-w)] max-w-full shrink-0 border-l',
                )}
                style={widthStyle}
                data-testid="record-split-pane"
                data-maximized={maximized ? '' : undefined}
              >
                {resizeHandle}
                <div className={cn('flex', barClass)}>{barControls}</div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {renderContent(selectedRecord)}
                </div>
              </aside>
            )}
          </div>
        </RecordListFaceProvider>
      </ActiveListRecordProvider>
      {drawer}
    </>
  );
};

NavigationOverlay.displayName = 'NavigationOverlay';
