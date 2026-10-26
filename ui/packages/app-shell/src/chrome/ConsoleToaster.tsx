/**
 * ConsoleToaster
 *
 * Sonner Toaster configured for the console app. Uses the local ThemeProvider
 * instead of next-themes to resolve the current color scheme.
 * @module
 */

import { useEffect, useState } from 'react';
import { Toaster as Sonner } from 'sonner';
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from 'lucide-react';
import { useTheme } from './ThemeProvider.js';
import { useObjectTranslation } from '@object-ui/i18n';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * objectui#13340 — with no drawer open, the toaster sits top-centre, just
 * below the console's top bar.
 *
 * The top-right corner was not free: every page header puts its actions there
 * (a list's New and Import, a record's Edit and its header actions, a
 * dashboard's controls). At 1440×900 a toast at sonner's default top-right
 * offset covered New and Import for its whole 4s life, so the button the user
 * needed next could not be clicked. Bottom-right stays out (objectui#7482: the
 * assistant's FAB and composer). Top-centre is the strip nothing interactive
 * uses: page headers put their title on the left and their actions on the
 * right. The offset clears the top bar (`AppShell`'s `h-12` header), whose
 * centre holds the global search. One anchor for every page, so no page needs
 * to know where the toaster is.
 */
const APP_HEADER_HEIGHT = 48; // `AppShell`'s sticky `<header>`, `h-12`
const APP_HEADER_GAP = 8;
const DEFAULT_OFFSET: ToasterProps['offset'] = { top: APP_HEADER_HEIGHT + APP_HEADER_GAP };

/**
 * objectui#11685 — the toaster steps clear of an open right-edge drawer.
 *
 * While a right-side drawer is open the toaster goes back to the `top-right`
 * corner and is offset from there, because that corner is also where every
 * right-side drawer puts its chrome: the record drawer's expand and close
 * buttons and its title, the record's own header with its Approve-style
 * actions under it. A success toast raised while one is open, which is exactly
 * what creating a record or running a record action does, would otherwise land
 * on top of all of them. The offset:
 *
 * - When the strip of page left of the drawer is wide enough for a toast, the
 *   toaster moves into that strip, to the drawer's left edge. The strip is
 *   under the drawer's modal overlay, so nothing interactive lives there, and
 *   no part of the drawer is covered.
 * - Otherwise (a phone, or a drawer nearly as wide as the window) it drops
 *   below the drawer's header, the block that carries the dialog's title and
 *   its controls.
 *
 * "A right-edge drawer" is read off the DOM, not off a prop: an open Radix
 * dialog (`role="dialog"`, `data-state="open"`) laid out fixed against the
 * top, right and bottom edges. Every `side="right"` sheet in the console
 * matches, the record drawer included; popovers, centred dialogs, left and
 * bottom sheets do not. Its header is the dialog's top-level block that holds
 * its `aria-labelledby` title. Sizes are layout sizes (`offsetWidth`,
 * `offsetTop`), so the drawer's slide-in transform does not skew them.
 */
const VIEWPORT_GAP = 24; // sonner's VIEWPORT_OFFSET
const MOBILE_VIEWPORT_GAP = 16; // sonner's MOBILE_VIEWPORT_OFFSET
const TOAST_WIDTH = 356; // sonner's TOAST_WIDTH

interface DrawerClearance {
  offset: ToasterProps['offset'];
  mobileOffset: ToasterProps['mobileOffset'];
}

const isZero = (length: string) => parseFloat(length) === 0;

function openRightDrawers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]')).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.position === 'fixed' && isZero(style.top) && isZero(style.right) && isZero(style.bottom);
  });
}

function headerOf(drawer: HTMLElement): HTMLElement | null {
  const titleId = drawer.getAttribute('aria-labelledby');
  const title = titleId ? document.getElementById(titleId) : null;
  if (!title || !drawer.contains(title) || title === drawer) return null;
  let block = title;
  while (block.parentElement && block.parentElement !== drawer) block = block.parentElement;
  return block;
}

function clearanceFor(drawers: HTMLElement[]): DrawerClearance | null {
  if (drawers.length === 0) return null;
  let width = 0;
  let headerBottom = 0;
  for (const drawer of drawers) {
    width = Math.max(width, drawer.offsetWidth);
    const header = headerOf(drawer);
    if (header) headerBottom = Math.max(headerBottom, header.offsetTop + header.offsetHeight);
  }
  const fitsBeside = window.innerWidth - width >= TOAST_WIDTH + 2 * VIEWPORT_GAP;
  return {
    offset: fitsBeside ? { right: width + VIEWPORT_GAP } : { top: headerBottom + VIEWPORT_GAP },
    // Below 600px sonner spans the toaster across the viewport, so there is
    // never a strip beside the drawer: always drop below its header.
    mobileOffset: { top: headerBottom + MOBILE_VIEWPORT_GAP },
  };
}

function useDrawerClearance(): DrawerClearance | null {
  const [clearance, setClearance] = useState<DrawerClearance | null>(null);

  useEffect(() => {
    let frame = 0;
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      const drawers = openRightDrawers();
      sizes?.disconnect();
      for (const drawer of drawers) {
        sizes?.observe(drawer);
        const header = headerOf(drawer);
        if (header) sizes?.observe(header);
      }
      const next = clearanceFor(drawers);
      // Compared by value: a fresh-but-equal object would re-render the
      // toaster on every DOM mutation the observers below report.
      setClearance((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }
    // Radix portals each dialog straight into <body>, so its mount and
    // unmount are child-list changes of <body> itself; opening or closing one
    // that stays mounted flips `data-state` somewhere below it.
    const portals = new MutationObserver(schedule);
    portals.observe(document.body, { childList: true });
    const states = new MutationObserver(schedule);
    states.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      portals.disconnect();
      states.disconnect();
      sizes?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return clearance;
}

/**
 * objectui#11723 — a toast stays clickable, and its click stays its own, while
 * a Radix modal (the record drawer, a dialog) is open.
 *
 * Two mechanisms made Undo and × dead under a modal; each needs its own answer.
 *
 * - A modal sets `pointer-events: none` on `<body>` and turns pointer events
 *   back on for its own layer only. The toaster inherited the `none`, so the
 *   hit test skipped every toast and the click landed on whatever lay under
 *   it: the overlay, which closes the drawer, or a drawer control. Each toast
 *   now carries `pointer-events-auto` (`toastOptions.classNames.toast` below).
 *   The toast only, not the toaster: a pointer resting beside a toast is still
 *   not inside the toaster, so objectui#7482's dismiss timer keeps running. A
 *   toast hidden beyond `visibleToasts` keeps sonner's own
 *   `pointer-events: none`, which is unlayered CSS and so outranks the utility.
 * - A toast that takes the click is still outside the modal's content, and
 *   Radix closes a modal on a `pointerdown` outside it, heard by a listener on
 *   `document`. The `pointerdown` now stops at the toaster, so no
 *   document-level outside-click handler hears it: not the drawer's, not a
 *   dialog's, not an open popover's. React delegates at its root, so the stop
 *   runs after sonner's own handlers (swipe, and the timer pause while a toast
 *   is pressed) and before the event can reach `document`.
 *
 * Not Radix's `DismissableLayerBranch`, the answer Radix's own Toast uses: a
 * branch registers in the module state of `@radix-ui/react-dismissable-layer`,
 * which `@radix-ui/react-dialog` pins to an exact version. A copy imported here
 * registers in a different module whenever the two resolve differently, and
 * the branch then silently does nothing. Not each modal's `onInteractOutside`
 * either: every modal host would have to know about the toaster, and one that
 * forgot would close on Undo.
 */
const stopAtToaster = (event: React.PointerEvent) => event.stopPropagation();

export function ConsoleToaster(props: ToasterProps) {
  const { theme = 'system' } = useTheme();
  const { t } = useObjectTranslation();
  const clearance = useDrawerClearance();

  return (
    // objectui#11723 — `contents`: the wrapper draws no box, it only bounds
    // where a toast's `pointerdown` stops (see `stopAtToaster`).
    <div className="contents" onPointerDown={stopAtToaster}>
      <Sonner
        theme={theme as ToasterProps['theme']}
        className="toaster group"
        // UX defaults chosen for an enterprise console — match the Linear /
        // Notion pattern users expect. Callers can still override any of
        // these via the spread `{...props}` below.
        //
        // objectui#7482 — a TOP anchor is load-bearing, not cosmetic. The
        // bottom-right corner belongs to the ChatDock's composer and the FAB
        // that launches it (ADR-0057 P3a/P3b), and a toaster anchored there does
        // more than overlap them: sonner pauses a toast's dismiss timer while
        // the pointer is inside the toaster region (`expanded || interacting ||
        // isDocumentHidden` in its Toast effect), so a pointer resting on the
        // composer underneath keeps the toast on screen until the user clicks ×.
        // Override the position only onto a corner nothing interactive occupies.
        //
        // objectui#13340 — top-centre below the top bar, not top-right: the
        // page header's actions live in the top-right corner (see
        // `DEFAULT_OFFSET`). objectui#11685 — while a right-edge drawer is
        // open, top-right shifted clear of the drawer's chrome (see
        // `useDrawerClearance`). The phone offset stays sonner's own until a
        // drawer needs clearing.
        position={clearance ? 'top-right' : 'top-center'}
        offset={clearance?.offset ?? DEFAULT_OFFSET}
        mobileOffset={clearance?.mobileOffset}
        closeButton
        richColors
        expand
        visibleToasts={4}
        containerAriaLabel={t('notifications.regionLabel', { defaultValue: 'Notifications' })}
        icons={{
          success: <CircleCheck className="h-4 w-4" />,
          info: <Info className="h-4 w-4" />,
          warning: <TriangleAlert className="h-4 w-4" />,
          error: <OctagonX className="h-4 w-4" />,
          loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
        }}
        toastOptions={{
          // 4s default keeps actionable toasts visible long enough to
          // click an Undo button without feeling sticky. objectui#7482 asked for
          // 3–5s on success toasts and this already sits in that band; it is
          // pinned in `__tests__/ConsoleToaster.autoDismiss-7482` because
          // nothing checked it, and a success toast that outlives its own
          // information is what that card was reported as.
          //
          // NOT split per intent ("errors may persist"): sonner has no per-type
          // duration on `Toaster`, so the only way to say it is a `duration` at
          // each of the ~100 `toast.error(...)` call sites. `closeButton` below
          // already gives every toast a manual exit.
          duration: 4000,
          classNames: {
            // objectui#11723 — `pointer-events-auto`: a toast takes its own
            // clicks under an open Radix modal (see `stopAtToaster`). A plain
            // utility on purpose: a `group-[…]:` form would outrank sonner's
            // `pointer-events: none` on a hidden toast and make it clickable.
            toast:
              'group toast pointer-events-auto group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
            description: 'group-[.toast]:text-muted-foreground',
            actionButton:
              'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
            cancelButton:
              'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          },
        }}
        {...props}
      />
    </div>
  );
}
