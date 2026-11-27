// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's right slot and its assistant, moved out of
 * `StudioDesignSurface.tsx` unchanged by objectstack#37553 (a move-only
 * split): where the one right slot is hosted, its shown-or-hidden and
 * properties-or-copilot state, `⌘.`, the title row's assistant control, and
 * the slot itself with the copilot inside it.
 */

import * as React from 'react';
import { cn, useIsMobile } from '@object-ui/components';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { StudioChatDock, type StudioCopilotStatus, type StudioSurfaceLabel } from './StudioAiCopilot.js';
import { StudioRightSlot } from './StudioRightSlot.js';
import { AssistantTopBarButton } from '../../layout/AssistantTopBarButton.js';
import { ChatDockControlProvider, type ChatDockControl } from '../../layout/chatDockControl.js';
import {
  matchStudioSlotShortcut,
  type StudioRightSlotHandle,
  type StudioSlotMode,
} from './studioRightSlotState.js';
import {
  DOCK_STUDIO_EXPANDED_STORAGE_KEY,
  maximizedDockWidth,
  readStoredDockExpanded,
  writeStoredDockExpanded,
} from '../../layout/chatDockState.js';
import { STUDIO_HEADER_ICON_BUTTON } from './studio-tokens.js';
import { t, type SupportedLocale } from '../metadata-admin/i18n.js';

/** The one right slot: where it is hosted, what it shows, and its controls. */
export function useStudioSurfaceRightSlot({
  aiSlot,
  packageId,
  pkgMissing,
  locale,
}: {
  aiSlot: React.ReactNode;
  packageId: string | null;
  pkgMissing: boolean;
  locale: SupportedLocale;
}) {
  // objectui#12725 — the Studio grid is `[left: nav/tree] [center: canvas]
  // [right: ONE slot, properties OR copilot]`. NOT keyed on the async agent
  // catalog (that would flip the whole grid after load): on an agent-less env
  // the slot holds the properties alone. An injected `aiSlot` (the cloud seam,
  // ADR-0080) keeps the legacy left panel and the pillars' own asides — the
  // cloud edition migrates on its own schedule.
  const chatDockMode = !aiSlot;
  // objectui#11795 — Studio stays a desktop tool; on a phone it says so once,
  // in one line under the header, rather than leave the cramped layout to
  // speak for itself.
  const isMobile = useIsMobile();
  // objectui#8219 — the Interfaces pillar's open leaf, lifted to the dock so
  // the copilot's "discussing" chip reads its display label (objectui#7254).
  // Display-only; the agent's context stays URL-derived. Other pillars report
  // nothing, so their chip keeps reading `type · name`.
  const [surfaceLabel, setSurfaceLabel] = React.useState<StudioSurfaceLabel | null>(null);

  // objectui#12725 — the one right slot (`StudioRightSlot`): the open item's
  // properties OR the copilot, the maintainer's 「按「右栏二选一」定稿」. Not in
  // the package-less scope: its one pillar keeps its own aside, and its build
  // thread would be a package's, with no package here to build into
  // (objectui#11553).
  // objectstack#32615 — nor in a package that is not there (`pkgMissing`): its
  // copilot would offer to "edit this app" and write drafts under an id no
  // package has.
  const slotHost = chatDockMode && packageId !== null && !pkgMissing;
  // Shown or hidden from the top bar, remembered per tab under the key the
  // Studio dock kept its collapse in (#2477 item 2): an author who hid the
  // copilot finds the slot hidden. Under `md` the slot overlays the page and
  // starts closed — a phone must not open on a panel over the Studio.
  const [slotOpenStored, setSlotOpenStored] = React.useState(() =>
    readStoredDockExpanded(DOCK_STUDIO_EXPANDED_STORAGE_KEY, true),
  );
  const [slotOpenMobile, setSlotOpenMobile] = React.useState(false);
  const slotOpen = isMobile ? slotOpenMobile : slotOpenStored;
  const setSlotOpen = React.useCallback(
    (next: boolean) => {
      if (isMobile) {
        setSlotOpenMobile(next);
        return;
      }
      setSlotOpenStored(next);
      writeStoredDockExpanded(DOCK_STUDIO_EXPANDED_STORAGE_KEY, next);
    },
    [isMobile],
  );
  // The copilot first: nothing is selected yet, and the card's slot opens on
  // the conversation. A selection asks for the properties (`showProps`).
  const [slotMode, setSlotMode] = React.useState<StudioSlotMode>('copilot');
  const [slotPropsTarget, setSlotPropsTarget] = React.useState<HTMLElement | null>(null);
  const [slotPropsClaims, setSlotPropsClaims] = React.useState(0);
  const [copilotStatus, setCopilotStatus] = React.useState<StudioCopilotStatus>({
    available: false,
    planPendingCount: 0,
  });
  // objectstack#34610 — the copilot's expand control widens the slot in place
  // (it used to navigate to `/ai/build`, losing this page).
  const [copilotWide, setCopilotWide] = React.useState(false);
  // objectstack#34725 — the copilot's history list, behind the slot header's History button.
  const [copilotHistoryOpen, setCopilotHistoryOpen] = React.useState(false);
  const slotHasProps = slotPropsClaims > 0;
  const copilotAvailable = copilotStatus.available;
  // What the slot SHOWS: a missing half never shows.
  const shownSlotMode: StudioSlotMode = !copilotAvailable ? 'props' : !slotHasProps ? 'copilot' : slotMode;
  const slotHasContent = slotHasProps || copilotAvailable;
  const claimSlotProps = React.useCallback(() => {
    setSlotPropsClaims((n) => n + 1);
    return () => setSlotPropsClaims((n) => n - 1);
  }, []);
  // objectstack#26737 — a selection shows its properties at every width: a
  // hidden slot unfolds, as `⌘.` unfolds it, so a builder who hid the panel is
  // never left with a selection whose properties are drawn nowhere. One
  // function for the surface's life (state, not a memo — AGENTS.md #10): the
  // pillars ask on a new selection only, never because this was re-created.
  const setSlotOpenRef = React.useRef(setSlotOpen);
  React.useLayoutEffect(() => {
    setSlotOpenRef.current = setSlotOpen;
  });
  const [showSlotProps] = React.useState(() => () => {
    setSlotMode('props');
    setSlotOpenRef.current(true);
  });
  const slotHandle = React.useMemo<StudioRightSlotHandle | null>(
    () =>
      slotHost
        ? { propsTarget: slotPropsTarget, mode: shownSlotMode, claimProps: claimSlotProps, showProps: showSlotProps }
        : null,
    [slotHost, slotPropsTarget, shownSlotMode, claimSlotProps, showSlotProps],
  );
  // `⌘.` / `Ctrl+.` — a hidden slot opens; a shown one switches its halves.
  React.useEffect(() => {
    if (!slotHost) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matchStudioSlotShortcut(e)) return;
      e.preventDefault();
      if (!slotOpen) {
        setSlotOpen(true);
        return;
      }
      if (slotHasProps && copilotAvailable) setSlotMode(shownSlotMode === 'props' ? 'copilot' : 'props');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [slotHost, slotOpen, setSlotOpen, slotHasProps, copilotAvailable, shownSlotMode]);
  // objectstack#34725 — the top-bar robot's handle on the slot: pressed while
  // the slot shows; a press hides it, or shows it on the AI assistant.
  const openSlotOnCopilot = React.useCallback(() => {
    setSlotMode('copilot');
    setSlotOpen(true);
  }, [setSlotOpen]);
  const slotRobotControl = React.useMemo<ChatDockControl>(
    () => ({
      expanded: slotOpen,
      fullWindow: copilotWide,
      toggle: () => (slotOpen ? setSlotOpen(false) : openSlotOnCopilot()),
      open: openSlotOnCopilot,
    }),
    [slotOpen, copilotWide, setSlotOpen, openSlotOnCopilot],
  );
  // objectui#12725 — the title row's right-most icon shows or hides the right
  // slot; `⌘.` switches what it shows. objectstack#34725 — with a copilot
  // served, that icon is the console top bar's robot (the same component),
  // and it opens the slot on the AI assistant. Without one, the panel icon
  // stays for the properties.
  const titleRowAssistant =
    !slotHost || !slotHasContent ? null : copilotAvailable ? (
      <ChatDockControlProvider value={slotRobotControl}>
        <AssistantTopBarButton />
      </ChatDockControlProvider>
    ) : (
      <button
        type="button"
        data-testid="studio-slot-toggle"
        onClick={() => setSlotOpen(!slotOpen)}
        aria-pressed={slotOpen}
        aria-label={t(slotOpen ? 'engine.studio.slot.collapse' : 'engine.studio.slot.expand', locale)}
        title={t(slotOpen ? 'engine.studio.slot.collapse' : 'engine.studio.slot.expand', locale)}
        className={cn(STUDIO_HEADER_ICON_BUTTON, slotOpen && 'text-foreground')}
      >
        {slotOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
      </button>
    );
  const rightSlot = slotHost && (
    <StudioRightSlot
      open={slotOpen}
      mode={shownSlotMode}
      onModeChange={setSlotMode}
      hasProps={slotHasProps}
      copilotAvailable={copilotAvailable}
      planPendingCount={copilotStatus.planPendingCount}
      propsTargetRef={setSlotPropsTarget}
      wideWidth={copilotWide && !isMobile ? maximizedDockWidth(window.innerWidth) : undefined}
      wide={copilotWide}
      onWideChange={setCopilotWide}
      historyOpen={copilotHistoryOpen}
      onHistoryOpenChange={setCopilotHistoryOpen}
      onClose={() => setSlotOpen(false)}
      overlay={isMobile}
      onOverlayDismiss={() => setSlotOpen(false)}
      locale={locale}
      copilot={
        <StudioChatDock
          packageId={packageId}
          surfaceLabel={surfaceLabel}
          onStatusChange={setCopilotStatus}
          historyOpen={copilotHistoryOpen}
          onHistoryOpenChange={setCopilotHistoryOpen}
        />
      }
    />
  );
  return {
    isMobile,
    setSurfaceLabel,
    slotHost,
    slotOpen,
    slotHasContent,
    slotHandle,
    titleRowAssistant,
    rightSlot,
  };
}
