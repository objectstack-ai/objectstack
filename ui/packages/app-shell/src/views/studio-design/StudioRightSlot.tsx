// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioRightSlot — the one right-hand slot of the Studio design surface
 * (objectui#12725, the maintainer's 「按「右栏二选一」定稿」): it shows EITHER the
 * open item's properties OR the AI copilot, never both, and never beside a
 * second right-hand panel.
 *
 *  - objectstack#34725 — ONE header row, the console drawer's: on the left a
 *    segmented 属性 | AI 助手 switch (`⌘.` / `Ctrl+.` does the same,
 *    `matchStudioSlotShortcut`); on the right, while the copilot shows,
 *    History, the in-place widen (objectstack#34610) and Close. The top bar's
 *    robot opens and closes the slot as the console's robot opens its drawer.
 *  - Its width is the console drawer's default, resizable from the left edge
 *    (`useStudioSlotWidth`); under `md` it overlays the page.
 *  - Properties are a portal target: a pillar that hosts its inspector here
 *    claims the slot through `useStudioRightSlot` (`studioRightSlotState.ts`)
 *    and renders into
 *    `propsTarget`. A pillar that claims nothing keeps its own aside, and the
 *    slot shows the copilot alone (the header reads as a title, not a switch).
 *  - While the properties show, the copilot folds to a 40 px strip at the
 *    slot's foot that leads back to the conversation.
 *  - The copilot segment and the strip say how many items the copilot
 *    proposed await the author's confirmation (「N 项待确认」, objectstack#25943).
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
import { ArrowRight, History, Maximize2, Minimize2, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { Button, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { useStudioSlotWidth, type StudioSlotMode } from './studioRightSlotState.js';

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
  /**
   * objectui#11666 / objectstack#25943 — how many items the copilot proposed
   * await the author's confirmation; 0 when none.
   */
  planPendingCount: number;
  /** The copilot body (`StudioChatDock`). Always mounted, hidden by mode. */
  copilot: React.ReactNode;
  /** Callback ref for the properties portal target. */
  propsTargetRef: (el: HTMLElement | null) => void;
  /** A width in px while the copilot is widened in place (objectstack#34610); `undefined` otherwise. */
  wideWidth?: number;
  /**
   * objectstack#34610 / objectstack#34725 — whether the copilot is widened in
   * place, and the header control that widens and narrows it (absent: no
   * control). Drawn while the copilot shows, never in the phone overlay.
   */
  wide?: boolean;
  onWideChange?: (wide: boolean) => void;
  /** objectstack#34725 — the copilot's conversation history is open over it; the header's History button toggles it. */
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
  /** objectstack#34725 — the header's Close: hides the slot, as the top bar's robot does. */
  onClose?: () => void;
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
  planPendingCount,
  copilot,
  propsTargetRef,
  wideWidth,
  wide = false,
  onWideChange,
  historyOpen = false,
  onHistoryOpenChange,
  onClose,
  overlay = false,
  onOverlayDismiss,
  locale,
}: StudioRightSlotProps): React.ReactElement {
  const { t: tc } = useObjectTranslation();
  const slotWidth = useStudioSlotWidth();
  const shown = open && (hasProps || copilotAvailable);
  const showsProps = mode === 'props';
  const switchable = hasProps && copilotAvailable;
  const planPending = planPendingCount > 0;
  const planMarkerId = React.useId();
  const pendingText = planPending
    ? tFormat('engine.studio.slot.pendingCount', locale, { count: planPendingCount })
    : '';
  const planMarker = planPending ? (
    <span
      aria-hidden="true"
      data-testid="studio-slot-plan-pending"
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-white tabular-nums"
    >
      {planPendingCount}
    </span>
  ) : null;
  const copilotShown = !showsProps && copilotAvailable;
  const widened = Boolean(wideWidth) && !showsProps;
  const wideLabel = wide
    ? tc('console.ai.dock.restore', { defaultValue: 'Restore side panel' })
    : tc('console.ai.dock.expand', { defaultValue: 'Expand' });
  const historyLabel = t('engine.studio.slot.history', locale);
  const headerButton = 'h-7 w-7 text-muted-foreground hover:text-foreground';
  const segment = (value: StudioSlotMode) =>
    cn(
      'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] transition-colors',
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
        style={overlay ? undefined : { width: widened ? wideWidth : slotWidth.width }}
        className={cn(
          'relative shrink-0 flex-col overflow-hidden border-l bg-background [&:not([hidden])]:flex',
          overlay && 'fixed inset-y-0 right-0 z-40 w-[min(420px,100vw)] shadow-xl',
          !overlay && !slotWidth.dragging && 'transition-[width] duration-200 ease-out',
        )}
      >
        {/* objectstack#34725 — the left-edge resize handle, the console drawer's. */}
        {overlay || widened ? null : (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('engine.studio.slot.resize', locale)}
            aria-valuenow={Math.round(slotWidth.width)}
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
          {switchable ? (
            <div
              role="tablist"
              aria-label={t('engine.studio.slot.label', locale)}
              title={t('engine.studio.slot.switchHint', locale)}
              className="flex h-8 min-w-0 items-center gap-0.5 rounded-lg bg-muted p-0.5"
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
            <span className="inline-flex h-8 min-w-0 items-center gap-1.5 px-1 text-[13px] font-medium" data-testid="studio-slot-title">
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
              {pendingText}
            </span>
          )}
          <span className="flex shrink-0 items-center gap-0.5">
            {copilotShown && onHistoryOpenChange ? (
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground', historyOpen && 'bg-accent text-foreground')}
                onClick={() => onHistoryOpenChange(!historyOpen)}
                aria-pressed={historyOpen}
                aria-label={historyOpen ? t('engine.studio.slot.backToChat', locale) : historyLabel}
                data-testid="studio-slot-history"
              >
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                {historyLabel}
              </Button>
            ) : null}
            {copilotShown && onWideChange && !overlay ? (
              <Button
                variant="ghost"
                size="icon"
                className={headerButton}
                onClick={() => onWideChange(!wide)}
                aria-label={wideLabel}
                title={wideLabel}
                aria-pressed={wide}
                data-testid="studio-copilot-maximize"
              >
                {wide ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
            ) : null}
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
                  <span data-testid="studio-slot-strip-plan-pending">{pendingText}</span>
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
