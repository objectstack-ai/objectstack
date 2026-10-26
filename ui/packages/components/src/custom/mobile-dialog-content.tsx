/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * MobileDialogContent
 *
 * A mobile-optimized wrapper around the upstream Shadcn DialogContent.
 * On mobile (< sm breakpoint), the dialog is full-screen with a larger
 * close-button touch target (≥ 44×44px per WCAG 2.5.5).
 * On tablet+ (≥ sm), it falls back to the standard centered dialog.
 *
 * This lives in `custom/` to avoid modifying the Shadcn-synced `ui/dialog.tsx`.
 */

import * as React from 'react';
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { CloseSrLabel } from '../lib/close-label';
import { DialogOverlay, DialogPortal } from '../ui/dialog';

/**
 * Radix Select / Popover / DropdownMenu render their flyout into a portal at
 * `document.body` — physically OUTSIDE this DialogContent's DOM. So clicking an
 * empty part of an open dropdown reads as an "interact outside" and would close
 * the whole dialog. Suppress that: if the interaction's real target sits inside
 * a Radix popper layer, keep the dialog open (the popper closes itself). A real
 * backdrop click (target = overlay) is untouched and still closes the dialog.
 */
const POPPER_LAYER_SELECTOR =
  '[data-radix-popper-content-wrapper],[data-radix-select-content],[data-radix-select-viewport]';

/**
 * True when `target` sits inside a Radix popper flyout (Select / Popover /
 * DropdownMenu). Such elements are portalled to `document.body`, so an
 * "interact outside" the dialog whose target is one of them is really an
 * interaction with the dialog's own dropdown — it must not close the dialog.
 */
export function isInsidePopperLayer(target: Element | null | undefined): boolean {
  return !!target?.closest?.(POPPER_LAYER_SELECTOR);
}

type InteractOutsideHandler = NonNullable<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>['onInteractOutside']
>;

/**
 * Popper-aware interact-outside guard for Radix Dialog/Sheet content.
 *
 * Covers a second dismissal path `isInsidePopperLayer` alone cannot: with a
 * dropdown OPEN, one outside click must only close the dropdown — but
 * radix-dialog@1.1.17 defers its outside-pointerdown verdict to the `click`
 * phase (`deferPointerDownOutside`), while radix-select@2.3.1 dismisses and
 * unregisters on `pointerdown`. By the deferred verdict the dialog has become
 * the top layer, so it treats the dropdown-closing click as its own outside
 * click and dismisses too (#2156).
 *
 * The guard snapshots "was a popper flyout open?" on every `pointerdown`
 * (document capture phase — runs before Radix's bubble-phase dismissal
 * unmounts the flyout) and swallows the pointer-initiated interact-outside
 * that follows. Focus-driven interact-outside (Tab out) is untouched, as is a
 * plain backdrop click with no flyout open.
 */
export function usePopperAwareInteractOutside(
  onInteractOutside?: InteractOutsideHandler,
): InteractOutsideHandler {
  const popperOpenAtPointerDownRef = React.useRef(false);
  React.useEffect(() => {
    const snapshotPopperState = (e: PointerEvent) => {
      const t = e.target as Element | null;
      // Same deferred-verdict race, second source: a NESTED dialog (a create /
      // edit form opened from a lookup field's inline "+ create") also portals
      // to <body>. Closing it — e.g. its Cancel button — reads to THIS dialog as
      // its own outside click and dismisses it too. Snapshot on the capture
      // phase whether the pointerdown landed on a popper OR inside another open
      // dialog, before Radix's bubble-phase dismissal can unmount it.
      popperOpenAtPointerDownRef.current =
        !!document.querySelector(POPPER_LAYER_SELECTOR) ||
        !!t?.closest?.('[role="dialog"]');
    };
    document.addEventListener('pointerdown', snapshotPopperState, true);
    return () => document.removeEventListener('pointerdown', snapshotPopperState, true);
  }, []);
  return React.useCallback(
    (event: Parameters<InteractOutsideHandler>[0]) => {
      const originalEvent = event.detail?.originalEvent;
      const target = (originalEvent?.target ?? null) as Element | null;
      // Inside this dialog's own dropdown flyout, or inside a nested dialog
      // stacked above it — either way, not a backdrop click, so keep this open.
      if (isInsidePopperLayer(target) || target?.closest?.('[role="dialog"]')) {
        event.preventDefault();
        return;
      }
      if (originalEvent?.type === 'pointerdown' && popperOpenAtPointerDownRef.current) {
        event.preventDefault();
        return;
      }
      onInteractOutside?.(event);
    },
    [onInteractOutside],
  );
}

export type MobileDialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /**
   * Whether the dialog draws its own close (X) button. Defaults to `true`;
   * `false` leaves it out of the DOM entirely (objectui#11061), the same
   * switch upstream Shadcn's `DialogContent` names `showCloseButton`. The
   * dialog stays dismissable without it: Escape and a backdrop click still
   * reach the `Dialog`'s `onOpenChange(false)` through Radix, so a caller that
   * hides the X only has to keep whatever explicit way out its body offers.
   */
  showCloseButton?: boolean;
};

export const MobileDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  MobileDialogContentProps
>(({ className, children, onInteractOutside, showCloseButton = true, ...props }, ref) => {
  const handleInteractOutside = usePopperAwareInteractOutside(onInteractOutside);
  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onInteractOutside={handleInteractOutside}
      className={cn(
        // Mobile-first: full-screen
        'fixed inset-0 z-50 w-full bg-background p-4 shadow-lg duration-200',
        'h-[100dvh]',
        // Desktop (sm+): centered dialog with border + rounded corners
        'sm:inset-auto sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%]',
        'sm:max-w-lg sm:h-auto sm:max-h-[90vh] sm:rounded-lg sm:border sm:p-6',
        // Animations
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
        'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close
          className={cn(
            'absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity',
            'hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground',
            // Mobile touch target ≥ 44×44px (WCAG 2.5.5)
            'min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center',
          )}
        >
          <X className="h-5 w-5 sm:h-4 sm:w-4" />
          {/* objectui#4024 — the remainder objectstack#5505 could not reach.
              That change routed the close label through `CloseSrLabel` for the
              two SHADCN-SYNCED primitives under `src/ui/**`, via the declared
              patch in `scripts/shadcn-local-patches.mjs`. This file is a
              hand-written `custom/` wrapper with its own close button, outside
              that regeneration zone, so it kept the English literal — and it is
              what `plugin-form`'s `ModalForm` renders, i.e. exactly the
              create/edit dialog the card measured. */}
          <CloseSrLabel />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
  );
});
MobileDialogContent.displayName = 'MobileDialogContent';
