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
 * ViewNavigationConfig mode. Supports drawer (Sheet), modal (Dialog),
 * split (ResizablePanelGroup), and popover modes.
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
import { Maximize2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '../ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
// `PopoverAnchor` is NOT re-exported by `../ui/popover`, and that file is a
// no-touch Shadcn-synced file (AGENTS.md #7) — so the anchor part is taken
// from the primitive here, in the custom wrapper, which is exactly what that
// rule prescribes.
import * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from './resizable';
import { usePopperAwareInteractOutside } from './mobile-dialog-content';
import { createSafeTranslation } from '@object-ui/i18n';

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
  // Default accessible name + tooltip of the icon-only expand button. Hosts
  // may override it via the `expandLabel` prop; this is what ships otherwise.
  'detail.openAsFullPage': 'Open as full page',
  // VISIBLE overlay heading when the host passes no `title` — not merely an
  // a11y name.
  'detail.recordDetail': 'Record Detail',
  // sr-only Sheet/Dialog description used when the host passes no
  // `description`. Rendered in three places (drawer / modal / popover).
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

/** Navigation mode type — matches ViewNavigationConfig.mode */
export type NavigationOverlayMode =
  | 'page'
  | 'drawer'
  | 'modal'
  | 'split'
  | 'popover'
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
  /** Set open state (for controlled Sheet/Dialog onOpenChange) */
  setIsOpen: (open: boolean) => void;
  /** Width for the overlay (drawer/modal/split) */
  width?: string | number;
  /** Whether navigation is an overlay mode */
  isOverlay: boolean;
  /** Target view/form name from NavigationConfig */
  view?: string;
  /** Title for the overlay header */
  title?: string;
  /** Description for the overlay header */
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
   * The main content to wrap (for split mode only).
   * In split mode, the main content is rendered in the left panel.
   */
  mainContent?: React.ReactNode;
  /**
   * Popover trigger element (for popover mode).
   *
   * Rendered through Radix's `PopoverTrigger asChild`, so it is mounted HERE,
   * inside the overlay's own subtree. That makes it the right carrier only for
   * a host that has no element of its own to point at — a host wanting the
   * popover to sit on an element it already rendered elsewhere (a grid row, a
   * tree node, a gantt bar, a kanban card, a calendar event) must use
   * {@link NavigationOverlayProps.popoverAnchorRef}, because re-rendering that
   * element here would draw a SECOND copy of it in the overlay rather than
   * anchor to the first.
   */
  popoverTrigger?: React.ReactNode;
  /**
   * The already-rendered element the popover should be anchored to
   * (popover mode).
   *
   * ⭐ This is how the five list-type renderers honour `navigation.mode:
   * 'popover'` after objectui#9299: the click handler stores
   * `event.currentTarget` — the row / node / bar / card / event the user
   * actually clicked — on this ref in the same turn that opens the overlay,
   * and the popover is positioned against it through Radix's virtual-anchor
   * shape (`Popper.Anchor virtualRef`). No element is re-rendered, so nothing
   * is duplicated and the renderer keeps ownership of its own DOM.
   *
   * When neither this nor `popoverTrigger` is supplied the overlay falls back
   * to a compact `Dialog`. ⛔ After objectui#9299 none of the five renderers is
   * allowed to reach that fallback — it survives only for a host that genuinely
   * has no anchor to offer.
   */
  popoverAnchorRef?: React.RefObject<HTMLElement | null>;
  /**
   * Optional handler invoked when the user clicks the "Expand to full page"
   * affordance in the drawer/modal header. Mirrors Linear / Notion / Airtable
   * peek-to-full-page behavior — the consumer is responsible for closing the
   * overlay and router-pushing to the full record route.
   *
   * When omitted, the expand button is not rendered.
   */
  onExpand?: () => void;
  /**
   * Optional label for the expand button (accessible name & tooltip).
   *
   * When omitted the overlay resolves `detail.openAsFullPage` from the session
   * locale (English when no `I18nProvider` is mounted) — it is no longer a
   * hardcoded English literal (objectstack#5506).
   */
  expandLabel?: string;
  /**
   * Optional storage key for persisting the user's manually-resized drawer
   * width (drawer mode only). When provided, the drawer renders a drag
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
   * (drawer mode only).
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
}

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
 * Remember the element a click landed on, so `popover` mode can anchor to it.
 *
 * ⭐ objectui#9299 item 3: `popover` is anchored to the clicked element — the
 * row, node, bar, card or event the user actually pressed. That element is
 * rendered by the RENDERER, not by this overlay, so the overlay cannot find it
 * on its own, and `popoverTrigger` (which MOUNTS an element of its own inside
 * the overlay) is the wrong carrier for it — passing the row there would draw
 * a second copy of the row instead of pointing at the first.
 *
 * Two carriers, same recorder. Spread `anchorCaptureProps` on the renderer's
 * own container when the click reaches it without a DOM event (a chart, a
 * calendar grid); call `captureAnchor(event)` directly at a click site that
 * already HAS one (a kanban card, a tree row). Either way hand `anchorRef` to
 * {@link NavigationOverlayProps.popoverAnchorRef}. The container form uses the
 * capture phase deliberately: it runs before the bubbling `onClick` that opens
 * the overlay, so by the time the popover renders the anchor is recorded.
 *
 * It reads `target`, not `currentTarget`, because the handler sits on the
 * CONTAINER: `currentTarget` there is the whole view, and a popover anchored
 * to the whole board is not anchored to anything. `target` is the deepest
 * element under the pointer — the bar, the card, the cell — which is what the
 * user pointed at.
 *
 * ⚠️ Read synchronously, which is what this does: React nulls its event fields
 * out once the handler returns, so stashing the event rather than the element
 * would hand the overlay a dead reference.
 *
 * Clicks that do not open anything (a toolbar button, a filter) also land here
 * and are harmless: `anchorRef` is only ever read while the popover is open,
 * and the click that opened it is by construction the last one recorded.
 */
export function useOverlayAnchor(): {
  anchorRef: React.RefObject<HTMLElement | null>;
  captureAnchor: (event: { target?: unknown } | null | undefined) => void;
  anchorCaptureProps: { onClickCapture: (event: { target?: unknown }) => void };
} {
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const captureAnchor = React.useCallback((event: { target?: unknown } | null | undefined) => {
    const el = event?.target as HTMLElement | null | undefined;
    if (el && typeof el.getBoundingClientRect === 'function') {
      anchorRef.current = el;
    }
  }, []);
  const anchorCaptureProps = React.useMemo(
    () => ({ onClickCapture: captureAnchor }),
    [captureAnchor],
  );
  return { anchorRef, captureAnchor, anchorCaptureProps };
}

/**
 * Resolve width to CSS-compatible value
 */
function resolveWidth(width: string | number | undefined): string | undefined {
  if (width == null) return undefined;
  if (typeof width === 'number') return `${width}px`;
  return width;
}

/**
 * Compute CSS style from NavigationConfig width.
 *
 * Exposes the requested width as a `--ov-w` CSS variable rather than
 * setting `maxWidth` directly. This lets the overlay's className apply the
 * cap only above the `sm` breakpoint (`sm:max-w-[var(--ov-w)]`), so on
 * mobile the drawer can occupy the full viewport — matching the Linear /
 * Notion / Salesforce mobile peek pattern. Setting an inline maxWidth
 * unconditionally caps the drawer at e.g. 70vw even on a 390px phone,
 * leaving an unusable empty strip on the side.
 */
function getWidthStyle(width: string | number | undefined): React.CSSProperties {
  const resolved = resolveWidth(width);
  if (!resolved) return {};
  return { ['--ov-w' as any]: resolved };
}

/** Hard floor for drag-resize — narrower than this and the body becomes unusable. */
const DRAWER_MIN_PX = 360;
/** Soft ceiling — keep at least a thin sliver of underlying page visible. */
const DRAWER_MAX_VW_FACTOR = 0.95;

/**
 * Drawer resize state — drag handle on the left edge, value persisted to
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

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    if (!storageKey || typeof window === 'undefined') return;
    e.preventDefault();
    draggingRef.current = true;

    const maxPx = Math.floor(window.innerWidth * DRAWER_MAX_VW_FACTOR);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      // Drawer is right-anchored: rightX = window.innerWidth, leftX = mouseX.
      const next = Math.min(maxPx, Math.max(DRAWER_MIN_PX, window.innerWidth - ev.clientX));
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
 * - **drawer**: Right-side Sheet panel
 * - **modal**: Center Dialog overlay
 * - **split**: Side-by-side ResizablePanelGroup
 * - **popover**: Hoverable/clickable popover card
 * - **page / new_window / none**: No overlay rendered (handled by hook)
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
  popoverTrigger,
  popoverAnchorRef,
  onExpand,
  expandLabel,
  storageKey,
  legacyStorageKey,
}) => {
  const widthStyle = getWidthStyle(width);
  // Every chrome string below is locale-driven (objectstack#5430 for the two
  // close affordances, objectstack#5506 for the rest). Must stay above the
  // conditional returns — rules-of-hooks.
  const { t } = useOverlayTranslation();
  const resolvedTitle = title || t('detail.recordDetail');
  // `??` rather than a destructuring default so the semantics are unchanged
  // for hosts that pass the prop: a default parameter also only fires on
  // `undefined`, and `ObjectView` already supplies its own translated label.
  const resolvedExpandLabel = expandLabel ?? t('detail.openAsFullPage');
  // sr-only Sheet/Dialog description, used in three modes below.
  const overlayDescription = t('detail.recordDetailOverlay', { title: resolvedTitle });
  // Keep hooks above all conditional returns. Opening a record changes
  // selectedRecord from null to an object, but hook order must stay stable.
  const resize = useDrawerResize(
    mode === 'drawer' ? storageKey : undefined,
    mode === 'drawer' ? legacyStorageKey : undefined,
  );
  // Inline-edit dropdowns render in body-level poppers; without this guard the
  // click that closes an open dropdown also dismisses the drawer/modal (#2156).
  const handleInteractOutside = usePopperAwareInteractOutside();

  // Non-overlay modes don't render anything
  if (mode === 'page' || mode === 'new_window' || mode === 'none') {
    return null;
  }

  if (!selectedRecord) {
    return null;
  }

  // Drawer width policy:
  // - If the user explicitly drag-resized, honor that exact pixel value
  //   (their choice always wins).
  // - Otherwise, treat the authored width as a *floor*. On wide monitors,
  //   weakly-authored values like 600px get bumped up to a healthier
  //   `min(60vw, 880px)` so the drawer doesn't feel cramped on 1920px
  //   displays. Strongly-authored larger values still win via `max()`.
  // - The mobile gate (`sm:` on the className) prevents this from
  //   affecting phones.
  const authoredWidthCss = resolveWidth(width) ?? '42rem';
  const drawerStyle: React.CSSProperties = resize.width != null
    ? { ['--ov-w' as any]: `${resize.width}px` }
    : { ['--ov-w' as any]: `max(${authoredWidthCss}, min(60vw, 880px))` };

  // Use renderView when both renderView and view are provided; otherwise fallback to children
  const renderContent = (record: Record<string, unknown>) => {
    if (renderView && view) {
      return renderView(record, view);
    }
    return children(record);
  };

  // --- Drawer Mode (Sheet) ---
  if (mode === 'drawer') {
    return (
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="right"
          onInteractOutside={handleInteractOutside}
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
          className={cn(
            // Mobile: full width (no inline cap, no max-w from base sheet).
            // sm+: honor the host-supplied width via `--ov-w` CSS var with a
            // sensible 2xl ceiling so very wide configs don't dwarf the
            // page. The host's className still wins on more specific tokens.
            'w-screen max-w-none sm:w-full sm:max-w-[var(--ov-w,42rem)] p-0 flex flex-col gap-0 overflow-hidden',
            // Hide shadcn Sheet's auto-rendered close (X) — it's the LAST
            // direct <button> child of SheetContent. We render our own close
            // inside the header so it sits in a single button cluster
            // visually aligned with the expand action.
            '[&>button:last-of-type]:hidden',
            className,
          )}
          style={drawerStyle}
        >
          {/* Drag-resize handle — only rendered on sm+ (mobile uses full
              viewport so there's nothing meaningful to resize). The
              4px-wide invisible hit-area sits flush with the left edge;
              the visible 1px tint reacts on hover so users discover the
              affordance. Double-click resets to the configured default. */}
          {resize.enabled && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('common.resizeDrawer')}
              onMouseDown={resize.handleMouseDown}
              onDoubleClick={resize.handleDoubleClick}
              className="hidden sm:block absolute left-0 top-0 bottom-0 z-30 w-1 cursor-col-resize touch-none bg-transparent hover:bg-primary/40 active:bg-primary/60 transition-colors"
            />
          )}
          {/* Chrome header — subdued breadcrumb-style label that does not
              compete with the record-title rendered by the embedded content.
              Buttons live in the same flex row so they share vertical
              centering with the title text (no absolute positioning, no
              pixel-perfect math to maintain). */}
          <SheetHeader className="shrink-0 flex-row items-center justify-between gap-2 space-y-0 px-4 py-2 border-b bg-muted/30">
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-xs font-medium tracking-wide text-muted-foreground">
                {resolvedTitle}
              </SheetTitle>
              {description ? (
                <SheetDescription className="truncate text-xs">{description}</SheetDescription>
              ) : (
                <SheetDescription className="sr-only">
                  {overlayDescription}
                </SheetDescription>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {onExpand && (
                <button
                  type="button"
                  onClick={onExpand}
                  aria-label={resolvedExpandLabel}
                  title={resolvedExpandLabel}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              )}
              <SheetClose asChild>
                <button
                  type="button"
                  aria-label={t('common.close')}
                  title={t('common.close')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </SheetClose>
            </div>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {renderContent(selectedRecord)}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // --- Modal Mode (Dialog) ---
  if (mode === 'modal') {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          onInteractOutside={handleInteractOutside}
          className={cn(
            'w-[calc(100vw-1rem)] max-w-none sm:max-w-[var(--ov-w,42rem)] max-h-[90vh] overflow-y-auto',
            className,
          )}
          style={widthStyle}
        >
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              aria-label={resolvedExpandLabel}
              title={resolvedExpandLabel}
              className="absolute right-12 top-4 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
          <DialogHeader>
            <DialogTitle>{resolvedTitle}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : (
              <DialogDescription className="sr-only">
                {overlayDescription}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="mt-4">
            {renderContent(selectedRecord)}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // --- Split Mode (Resizable Panels) ---
  if (mode === 'split') {
    if (!isOpen || !mainContent) {
      return null;
    }

    // Calculate panel sizes based on width config
    const detailPercent = width
      ? typeof width === 'number'
        ? Math.min(70, Math.max(20, (width / 1200) * 100))
        : 40
      : 40;
    const mainPercent = 100 - detailPercent;

    return (
      <ResizablePanelGroup orientation="horizontal" className={cn('h-full', className)}>
        <ResizablePanel defaultSize={mainPercent} minSize={30}>
          {mainContent}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={detailPercent} minSize={20}>
          <div className="h-full overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{resolvedTitle}</h3>
              <button type="button"
                onClick={close}
                className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label={t('common.closePanel')}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {description && (
              <p className="text-sm text-muted-foreground mb-4">{description}</p>
            )}
            {renderContent(selectedRecord)}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  // --- Popover Mode ---
  if (mode === 'popover') {
    if (!popoverTrigger && !popoverAnchorRef) {
      // Fallback: a compact floating card when the host offers NO anchor at
      // all — neither an element for us to render as the trigger, nor a
      // reference to one it rendered itself.
      //
      // ⛔ objectui#9299 item 3: this is no longer the path any of the five
      // list-type renderers takes. It measured as the path ALL of them took —
      // `popover` was honoured on no surface, because nothing ever passed a
      // trigger — and the ruling closed that. It survives for a host that
      // genuinely has nothing to point at.
      if (!isOpen) return null;
      return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent
            className={cn('w-96 max-h-[80vh] overflow-y-auto p-4', className)}
            style={widthStyle}
          >
            <DialogHeader>
              <DialogTitle className="text-sm">{resolvedTitle}</DialogTitle>
              {description ? (
                <DialogDescription className="text-xs">{description}</DialogDescription>
              ) : (
                <DialogDescription className="sr-only">
                  {overlayDescription}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="mt-2">
              {renderContent(selectedRecord)}
            </div>
          </DialogContent>
        </Dialog>
      );
    }
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        {popoverTrigger ? (
          <PopoverTrigger asChild>
            {popoverTrigger}
          </PopoverTrigger>
        ) : (
          // Virtual anchor: position against the element the host ALREADY
          // rendered and the user actually clicked. Nothing is mounted for it,
          // so the row / node / bar / card / event is not duplicated here.
          <PopoverPrimitive.Anchor virtualRef={popoverAnchorRef} />
        )}
        <PopoverContent
          className={cn('w-96 max-h-[400px] overflow-y-auto p-4', className)}
          style={widthStyle}
        >
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">{resolvedTitle}</h4>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
            {renderContent(selectedRecord)}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return null;
};

NavigationOverlay.displayName = 'NavigationOverlay';
