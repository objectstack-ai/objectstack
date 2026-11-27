// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioRightSlot — the one right-hand slot of the Studio design surface
 * (objectui#12725): it shows the open item's properties, never beside a
 * second right-hand panel.
 *
 *  - objectstack#34725 — ONE header row: the title on the left, Close on the
 *    right. The title row's panel icon (and `⌘.` / `Ctrl+.`,
 *    `matchStudioSlotShortcut`) opens and closes it.
 *  - Its width is resizable from the left edge within 320–560 px (360 by
 *    default, `useStudioSlotWidth`); under `md` it overlays the page at its own
 *    width.
 *  - Properties are a portal target: a pillar that hosts its inspector here
 *    claims the slot through `useStudioRightSlot` (`studioRightSlotState.ts`)
 *    and renders into `propsTarget`. A pillar that claims nothing keeps its own
 *    aside, and the slot draws nothing.
 *  - The body stays MOUNTED and is hidden with the slot, so a pillar's portal
 *    target never disappears under an open editor.
 */

import * as React from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button, cn } from '@object-ui/components';
import { t } from '../metadata-admin/i18n.js';
import {
  STUDIO_SLOT_MAX_WIDTH,
  STUDIO_SLOT_MIN_WIDTH,
  useStudioSlotWidth,
} from './studioRightSlotState.js';

export interface StudioRightSlotProps {
  /** Whether the slot is shown (the title row's toggle). */
  open: boolean;
  /** A pillar has claimed the properties. */
  hasProps: boolean;
  /** Callback ref for the properties portal target. */
  propsTargetRef: (el: HTMLElement | null) => void;
  /** objectstack#34725 — the header's Close: hides the slot, as the title row's toggle does. */
  onClose?: () => void;
  /** Under `md`: the slot overlays the page instead of reflowing it. */
  overlay?: boolean;
  onOverlayDismiss?: () => void;
  locale?: string;
}

export function StudioRightSlot({
  open,
  hasProps,
  propsTargetRef,
  onClose,
  overlay = false,
  onOverlayDismiss,
  locale,
}: StudioRightSlotProps): React.ReactElement {
  const slotWidth = useStudioSlotWidth();
  const shown = open && hasProps;
  const headerButton = 'h-7 w-7 text-muted-foreground hover:text-foreground';
  return (
    <>
      {overlay && shown && (
        <div className="fixed inset-0 z-30 bg-black/30" aria-hidden="true" onClick={onOverlayDismiss} />
      )}
      <aside
        data-testid="studio-right-slot"
        aria-label={t('engine.studio.slot.label', locale)}
        hidden={!shown}
        style={overlay ? undefined : { width: slotWidth.width }}
        className={cn(
          'relative shrink-0 flex-col overflow-hidden border-l bg-background [&:not([hidden])]:flex',
          overlay && 'fixed inset-y-0 right-0 z-40 w-[min(420px,100vw)] shadow-xl',
          !overlay && !slotWidth.dragging && 'transition-[width] duration-200 ease-out',
        )}
      >
        {/* objectstack#34725 — the left-edge resize handle, the console drawer's. */}
        {overlay ? null : (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('engine.studio.slot.resize', locale)}
            aria-valuenow={Math.round(slotWidth.width)}
            aria-valuemin={STUDIO_SLOT_MIN_WIDTH}
            aria-valuemax={STUDIO_SLOT_MAX_WIDTH}
            tabIndex={0}
            data-testid="studio-slot-resize"
            onPointerDown={slotWidth.onResizePointerDown}
            onKeyDown={slotWidth.onResizeKeyDown}
            className={cn(
              'absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none',
              slotWidth.dragging && 'bg-primary/50',
            )}
          />
        )}
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3" data-testid="studio-slot-header">
          <span className="inline-flex h-8 min-w-0 items-center gap-1.5 px-1 text-[13px] font-medium" data-testid="studio-slot-title">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            {t('engine.studio.inspector.props', locale)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            {onClose ? (
              <Button
                variant="ghost"
                size="icon"
                className={headerButton}
                onClick={onClose}
                aria-label={t('engine.studio.slot.collapse', locale)}
                title={t('engine.studio.slot.collapse', locale)}
                data-testid="studio-slot-close"
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </span>
        </div>
        <div
          ref={propsTargetRef}
          data-testid="studio-slot-props"
          className="min-h-0 flex-1 flex-col overflow-hidden flex"
        />
      </aside>
    </>
  );
}
