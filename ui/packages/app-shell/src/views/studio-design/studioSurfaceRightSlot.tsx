// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's right slot and its assistant, moved out of
 * `StudioDesignSurface.tsx` unchanged by objectstack#37553 (a move-only
 * split): where the one right slot is hosted, its shown-or-hidden state,
 * `⌘.`, the title row's toggle, and the slot itself.
 */

import * as React from 'react';
import { cn, useIsMobile } from '@object-ui/components';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { StudioRightSlot } from './StudioRightSlot.js';
import {
  matchStudioSlotShortcut,
  type StudioRightSlotHandle,
} from './studioRightSlotState.js';
import {
  DOCK_STUDIO_EXPANDED_STORAGE_KEY,
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
  // [right: ONE slot, the properties]`. An injected `aiSlot` (the cloud seam,
  // ADR-0080) keeps the legacy left panel and the pillars' own asides — the
  // cloud edition migrates on its own schedule.
  const chatDockMode = !aiSlot;
  // objectui#11795 — Studio stays a desktop tool; on a phone it says so once,
  // in one line under the header, rather than leave the cramped layout to
  // speak for itself.
  const isMobile = useIsMobile();
  // objectui#12725 — the one right slot (`StudioRightSlot`): the open item's
  // properties. Not in the package-less scope: its one pillar keeps its own
  // aside (objectui#11553).
  // objectstack#32615 — nor in a package that is not there (`pkgMissing`).
  const slotHost = chatDockMode && packageId !== null && !pkgMissing;
  // Shown or hidden from the title row, remembered per tab under the key the
  // Studio dock kept its collapse in (#2477 item 2): an author who hid the
  // slot finds it hidden. Under `md` the slot overlays the page and
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
  const [slotPropsTarget, setSlotPropsTarget] = React.useState<HTMLElement | null>(null);
  const [slotPropsClaims, setSlotPropsClaims] = React.useState(0);
  const slotHasProps = slotPropsClaims > 0;
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
    setSlotOpenRef.current(true);
  });
  const slotHandle = React.useMemo<StudioRightSlotHandle | null>(
    () =>
      slotHost
        ? { propsTarget: slotPropsTarget, claimProps: claimSlotProps, showProps: showSlotProps }
        : null,
    [slotHost, slotPropsTarget, claimSlotProps, showSlotProps],
  );
  // `⌘.` / `Ctrl+.` — a hidden slot opens.
  React.useEffect(() => {
    if (!slotHost) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matchStudioSlotShortcut(e)) return;
      e.preventDefault();
      if (!slotOpen) setSlotOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [slotHost, slotOpen, setSlotOpen]);
  const titleRowAssistant =
    !slotHost || !slotHasProps ? null : (
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
      hasProps={slotHasProps}
      propsTargetRef={setSlotPropsTarget}
      onClose={() => setSlotOpen(false)}
      overlay={isMobile}
      onOverlayDismiss={() => setSlotOpen(false)}
      locale={locale}
    />
  );
  return {
    isMobile,
    slotHost,
    slotOpen,
    slotHasProps,
    slotHandle,
    titleRowAssistant,
    rightSlot,
  };
}
