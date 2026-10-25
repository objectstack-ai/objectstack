// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioRightSlot — the one right-hand slot of the Studio design surface
 * (objectui#12725, the maintainer's 「按「右栏二选一」定稿」): it shows EITHER the
 * open item's properties OR the AI copilot, never both, and never beside a
 * second right-hand panel.
 *
 *  - A segmented header 属性 | AI 副驾 switches the two; `⌘.` / `Ctrl+.` does
 *    the same (`matchStudioSlotShortcut`); the top bar's right-most icon
 *    hides the whole slot.
 *  - Properties are a portal target: a pillar that hosts its inspector here
 *    claims the slot through `useStudioRightSlot` (`studioRightSlotState.ts`)
 *    and renders into
 *    `propsTarget`. A pillar that claims nothing keeps its own aside, and the
 *    slot shows the copilot alone (the header reads as a title, not a switch).
 *  - While the properties show, the copilot folds to a 40 px strip at the
 *    slot's foot that leads back to the conversation.
 *  - Both bodies stay MOUNTED and are hidden by mode: a turn the copilot is
 *    streaming survives a look at the properties, and a pillar's portal target
 *    never disappears under an open editor.
 *
 * The copilot itself (`StudioChatDock`) is passed in as `copilot`, so its agent,
 * conversation and requests are untouched by the move; it reports whether the
 * agent catalog serves one (`copilotAvailable`) and the slot draws nothing for
 * a copilot that is not there.
 */

import * as React from 'react';
import { ArrowRight, SlidersHorizontal, Sparkles } from 'lucide-react';
import { cn } from '@object-ui/components';
import { t } from '../metadata-admin/i18n.js';
import { STUDIO_SLOT_WIDTH, type StudioSlotMode } from './studioRightSlotState.js';

export interface StudioRightSlotProps {
  /** Whether the slot is shown (the top bar's toggle). */
  open: boolean;
  /** The mode the slot shows; the caller has already folded in what exists. */
  mode: StudioSlotMode;
  onModeChange: (mode: StudioSlotMode) => void;
  /** A pillar has claimed the properties half. */
  hasProps: boolean;
  /** The agent catalog serves a copilot (reported by `copilot`). */
  copilotAvailable: boolean;
  /** objectui#11666 — a plan the copilot proposed awaits the author's approval. */
  planPending: boolean;
  /** The copilot body (`StudioChatDock`). Always mounted, hidden by mode. */
  copilot: React.ReactNode;
  /** Callback ref for the properties portal target. */
  propsTargetRef: (el: HTMLElement | null) => void;
  /** A width in px while the copilot's Live Canvas is open; `undefined` otherwise. */
  wideWidth?: number;
  /** Under `md`: the slot overlays the page instead of reflowing it. */
  overlay?: boolean;
  onOverlayDismiss?: () => void;
  locale?: string;
}

export function StudioRightSlot({
  open,
  mode,
  onModeChange,
  hasProps,
  copilotAvailable,
  planPending,
  copilot,
  propsTargetRef,
  wideWidth,
  overlay = false,
  onOverlayDismiss,
  locale,
}: StudioRightSlotProps): React.ReactElement {
  const shown = open && (hasProps || copilotAvailable);
  const showsProps = mode === 'props';
  const switchable = hasProps && copilotAvailable;
  const planMarkerId = React.useId();
  const planMarker = planPending ? (
    <span
      aria-hidden="true"
      data-testid="studio-slot-plan-pending"
      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
    />
  ) : null;
  const segment = (value: StudioSlotMode) =>
    cn(
      'inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] transition-colors',
      mode === value ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
    );
  return (
    <>
      {overlay && shown && (
        <div className="fixed inset-0 z-30 bg-black/30" aria-hidden="true" onClick={onOverlayDismiss} />
      )}
      <aside
        data-testid="studio-right-slot"
        data-mode={mode}
        aria-label={t('engine.studio.slot.label', locale)}
        hidden={!shown}
        style={wideWidth && !showsProps ? { width: wideWidth } : undefined}
        className={cn(
          'shrink-0 flex-col overflow-hidden border-l bg-background [&:not([hidden])]:flex',
          overlay ? 'fixed inset-y-0 right-0 z-40 w-[min(360px,100vw)] shadow-xl' : STUDIO_SLOT_WIDTH,
          !overlay && 'transition-[width] duration-200 ease-out',
        )}
      >
        <div className="shrink-0 border-b px-3 py-2.5">
          {switchable ? (
            <div
              role="tablist"
              aria-label={t('engine.studio.slot.label', locale)}
              title={t('engine.studio.slot.switchHint', locale)}
              className="flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={showsProps}
                data-testid="studio-slot-tab-props"
                onClick={() => onModeChange('props')}
                className={segment('props')}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                {t('engine.studio.inspector.props', locale)}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!showsProps}
                aria-describedby={planPending ? planMarkerId : undefined}
                data-testid="studio-slot-tab-copilot"
                onClick={() => onModeChange('copilot')}
                className={segment('copilot')}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {t('engine.studio.aiCopilot', locale)}
                {planMarker}
              </button>
            </div>
          ) : (
            <span className="inline-flex h-8 items-center gap-1.5 px-1 text-[13px] font-medium" data-testid="studio-slot-title">
              {showsProps ? (
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {t(showsProps ? 'engine.studio.inspector.props' : 'engine.studio.aiCopilot', locale)}
            </span>
          )}
          {planPending && (
            <span id={planMarkerId} hidden>
              {t('engine.studio.slot.planPending', locale)}
            </span>
          )}
        </div>
        <div
          ref={propsTargetRef}
          data-testid="studio-slot-props"
          hidden={!showsProps}
          className="min-h-0 flex-1 flex-col overflow-hidden [&:not([hidden])]:flex"
        />
        <div
          data-testid="studio-slot-copilot"
          hidden={showsProps}
          className="min-h-0 flex-1 flex-col overflow-hidden [&:not([hidden])]:flex"
        >
          {copilot}
        </div>
        {showsProps && copilotAvailable && (
          <button
            type="button"
            data-testid="studio-slot-copilot-strip"
            onClick={() => onModeChange('copilot')}
            className="flex h-10 shrink-0 items-center gap-2 border-t bg-primary/5 px-3 text-left text-[13px] text-primary hover:bg-primary/10"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {t('engine.studio.aiCopilot', locale)}
              {planPending && (
                <>
                  {' · '}
                  <span data-testid="studio-slot-strip-plan-pending">{t('engine.studio.slot.planPending', locale)}</span>
                </>
              )}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs">
              {t('engine.studio.slot.backToChat', locale)}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </button>
        )}
      </aside>
    </>
  );
}
