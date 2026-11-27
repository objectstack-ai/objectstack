// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's frame, moved out of `StudioDesignSurface.tsx`
 * unchanged by objectstack#37553 (a move-only split): the providers every
 * Studio page reads (the menu's data, the `?surface=` channel, the page's
 * Save, the title row, the right slot), the two columns — the left menu with
 * its top rows, and the page beside it in the pillars host — the strips above
 * them, the right slot's mount, the review sheet and the command palette. It
 * holds no state: every value is the surface's, and the page is `children`.
 */

import * as React from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { cn } from '@object-ui/components';
import { CONSOLE_FULL_HEIGHT } from '../../layout/chromeBannerHost.js';
import { StudioTitleRowProvider } from './studioTitleRow.js';
import { StudioRightSlotContext } from './studioRightSlotState.js';
import { STUDIO_ACCENT, STUDIO_PILLARS_HOST } from './studio-tokens.js';
import { StudioPendingDraftsContext } from './studioItemDraftStatus.js';
import { StudioInterfacesRetiredNotice } from './StudioInterfacesRetiredNotice.js';
import { StudioSaveProvider } from './studioSaveBar.js';
import { isOrgScopeDraft } from './studioScope.js';
import { StudioMenu, StudioMenuDataProvider, StudioMenuProvider } from './StudioMenu.js';
import { SurfaceDeepLinkProvider } from './surfaceDeepLinkChannel.js';
import { t, type SupportedLocale } from '../metadata-admin/i18n.js';
import { CommandPalette } from '../../chrome/CommandPalette.js';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider.js';
import { DraftChangesPanel } from '../../preview/DraftChangesPanel.js';
import { studioPackageOverviewPath } from './studioOverviewAddress.js';
import { StudioMissingPackageStrip, StudioMobileStrip, StudioTopLeft } from './StudioTopLeft.js';
import { StudioTitleRowFallback } from './StudioTitleRowFallback.js';
import type { useStudioPackageApps, useStudioPackageFacts, useStudioSurfaceScope } from './studioSurfaceScope.js';
import type { useStudioSurfaceSave } from './studioSurfaceSave.js';
import type { useStudioChangesSheet, useStudioDraftLedger } from './studioSurfaceDrafts.js';
import type { useStudioPublishAction } from './studioSurfacePublish.js';
import type { useStudioSurfaceRightSlot } from './studioSurfaceRightSlot.js';
import type { useRetiredInterfacesLanding, useStudioSurfaceNavigation } from './studioSurfaceNavigation.js';

export type StudioSurfaceFrameProps = Pick<
  ReturnType<typeof useStudioSurfaceScope>,
  'scopeSegment' | 'allScope' | 'packageId'
> &
  Pick<
    ReturnType<typeof useStudioPackageFacts>,
    'pkgMissing' | 'pkgEntry' | 'readOnly' | 'draftScope' | 'publishReadOnly' | 'pairId' | 'baseLabel'
  > &
  Pick<ReturnType<typeof useStudioSurfaceSave>, 'saveBar' | 'confirmLeavePillar'> &
  Pick<ReturnType<typeof useStudioChangesSheet>, 'changesOpen' | 'setChangesOpen' | 'publishing'> &
  Pick<
    ReturnType<typeof useStudioDraftLedger>,
    'shownPendingCount' | 'renderPublishRefusal' | 'pillarPendingDrafts'
  > &
  Pick<ReturnType<typeof useStudioPublishAction>, 'doPublish'> &
  Pick<ReturnType<typeof useStudioPackageApps>, 'publishedApps'> &
  Pick<
    ReturnType<typeof useStudioSurfaceRightSlot>,
    'isMobile' | 'slotHost' | 'slotOpen' | 'slotHasProps' | 'slotHandle' | 'titleRowAssistant' | 'rightSlot'
  > &
  Pick<
    ReturnType<typeof useStudioSurfaceNavigation>,
    'requestSurface' | 'reenterPillar' | 'showMenu' | 'paletteSurface' | 'paletteHosted'
  > &
  Pick<ReturnType<typeof useRetiredInterfacesLanding>, 'retiredLanding' | 'setRetiredOn'> & {
    /** Open-core slot — the cloud edition injects its AI copilot panel here. */
    aiSlot: React.ReactNode;
    locale: SupportedLocale;
    shellNavigate: NavigateFunction;
    canAuthorPackage: boolean;
    /** objectstack#36511 — the page's Cancel and Save, for the title row. */
    titleRowSave: React.ReactNode;
    /** The page beside the menu (`StudioSurfacePage`). */
    children: React.ReactNode;
  };

/** The surface's providers and columns, with the page in the pillars host. */
export function StudioSurfaceFrame({
  scopeSegment,
  allScope,
  packageId,
  pkgMissing,
  pkgEntry,
  readOnly,
  draftScope,
  publishReadOnly,
  pairId,
  baseLabel,
  saveBar,
  confirmLeavePillar,
  changesOpen,
  setChangesOpen,
  publishing,
  shownPendingCount,
  renderPublishRefusal,
  pillarPendingDrafts,
  doPublish,
  publishedApps,
  isMobile,
  slotHost,
  slotOpen,
  slotHasProps,
  slotHandle,
  titleRowAssistant,
  rightSlot,
  requestSurface,
  reenterPillar,
  showMenu,
  paletteSurface,
  paletteHosted,
  retiredLanding,
  setRetiredOn,
  aiSlot,
  locale,
  shellNavigate,
  canAuthorPackage,
  titleRowSave,
  children,
}: StudioSurfaceFrameProps): React.ReactElement {
  const page = (
    <StudioMenuDataProvider segment={scopeSegment}>
    <SurfaceDeepLinkProvider onRequest={requestSurface}>
      <StudioSaveProvider value={saveBar.registry}>
      <StudioTitleRowProvider save={titleRowSave} assistant={titleRowAssistant}>
      <StudioRightSlotContext.Provider value={slotHandle}>
      {/* objectstack#36899 — the left menu's provider is the frame: the app
          sidebar's, under Studio's own collapse cookie (`StudioMenu.tsx`). */}
      {/* objectstack#37455 — Studio's graphite on its root: nothing Studio
          draws takes the app's theme colour (decision 4 of #37424). */}
      <StudioMenuProvider className={cn(CONSOLE_FULL_HEIGHT.screen, 'min-h-0 overflow-hidden bg-background text-foreground', STUDIO_ACCENT)}>
        {/* The ADR-0080 `aiSlot` seam — a cloud edition may still inject its own
          * left copilot panel. */}
        {/* objectstack#32615 — not beside a package that is not there. */}
        {aiSlot && !pkgMissing ? (
          <aside className="w-64 shrink-0 overflow-auto border-r bg-muted/40">{aiSlot}</aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* objectstack#37456 — Studio has no top bar (ADR-0084, amended
              2026-11-26, `#amendment-2026-11-26-frame`). Its tenants live on:
              the way back and the menu toggle in the left column's top rows
              (`StudioTopLeft`), the ⋯ menu, Changes and Publish on 概览
              Overview (its header and its Pending tab, objectstack#37454),
              Save and Cancel in the item header and the assistant at the end
              of the page's title row (objectstack#37455). Under 768 px the
              menu is a drawer, opened from the strip below. */}
          {showMenu && <StudioMobileStrip locale={locale} />}
          {/* …and a package that is not there, with no column, keeps its way back here. */}
          {pkgMissing && (
            <StudioMissingPackageStrip
              locale={locale}
              apps={publishedApps}
              beforeNavigate={confirmLeavePillar}
              navigate={shellNavigate}
            />
          )}

          {retiredLanding && (
            <StudioInterfacesRetiredNotice
              packageId={packageId}
              apps={publishedApps}
              locale={locale}
              beforeNavigate={confirmLeavePillar}
              navigate={shellNavigate}
              onDismiss={() => setRetiredOn(null)}
            />
          )}

          {isMobile && (
            <p
              role="note"
              data-testid="studio-desktop-hint"
              className="shrink-0 border-b bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground"
            >
              {t('engine.studio.desktopHint', locale)}
            </p>
          )}

          {/* objectstack#35061 — the pillars' host is what the rails' narrow
              form measures, and it says whether the right slot squeezes it
              (`STUDIO_PILLARS_HOST` in `studio-tokens.ts`): the slot shown
              beside it, not overlaying the page under `md`. */}
          {/* objectstack#36899 — the left menu and the page beside it. The
              menu docks in this row, below the header (a drawer under 768 px). */}
          {/* objectui#12725 — the pillars' item headers read the ledger the
              badge counts (`studioItemDraftStatus.ts`). objectstack#37454 —
              so may the menu beside them: 概览's pending badge is that count. */}
          <StudioPendingDraftsContext.Provider value={pillarPendingDrafts}>
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {showMenu && (
            <StudioMenu
              segment={scopeSegment}
              locale={locale}
              onReenterPillar={reenterPillar}
              // objectstack#37456 — the top left's two rows: Studio's, then the
              // way back and the package switcher (`StudioTopLeft.tsx`).
              head={
                <StudioTopLeft
                  packageId={packageId}
                  scope={allScope ? 'all' : packageId === null ? 'org' : undefined}
                  openEntry={pkgEntry}
                  readOnly={readOnly}
                  canCreate={canAuthorPackage}
                  apps={publishedApps}
                  locale={locale}
                  beforeNavigate={confirmLeavePillar}
                  navigate={shellNavigate}
                  packagePath={studioPackageOverviewPath}
                  // objectstack#37456 — `~org` has no 概览, so its Changes stays
                  // in the left column (`StudioScopePendingRow`), on the same sheet.
                  scopePending={
                    packageId === null && !allScope && (shownPendingCount ?? 0) > 0
                      ? {
                          count: shownPendingCount ?? 0,
                          onOpen: () => {
                            setChangesOpen(true);
                          },
                        }
                      : null
                  }
                />
              }
            />
          )}
          <div
            className={cn('min-h-0 min-w-0 flex-1', STUDIO_PILLARS_HOST)}
            data-testid="studio-pillars-host"
            data-studio-slot={slotHost && slotOpen && slotHasProps && !isMobile ? 'open' : 'closed'}
          >
            {children}
          </div>
          {/* objectstack#37456 — the page controls of a page with no title row. */}
          <StudioTitleRowFallback />
          </div>
          </StudioPendingDraftsContext.Provider>
        </div>

        {/* objectui#12725 — the one right slot: the open item's properties. */}
        {rightSlot}

        {/* objectui#11553 — the package-less scope reviews exactly what its
          * Publish ships: package-less flow drafts, read off the env-wide
          * feed (`packageId` null) and narrowed by `include`. */}
        <DraftChangesPanel
          open={changesOpen}
          onOpenChange={setChangesOpen}
          // objectstack#28562 — a read-only base reviews its pair's drafts.
          packageId={draftScope}
          include={packageId === null ? isOrgScopeDraft : undefined}
          onPublish={publishReadOnly ? undefined : doPublish}
          publishing={publishing}
          posture="review"
          renderEntryNote={renderPublishRefusal}
          // ADR-0146 D3 — reviewing the pair's drafts, the sheet names the
          // base they are saved for.
          customizationOf={pairId !== null ? baseLabel : undefined}
        />

      </StudioMenuProvider>
      {/* objectstack#36900 — the command palette, in its `studio` scope, with this page's groups. */}
      {!paletteHosted && <CommandPalette scope="studio" surface={paletteSurface} />}
      </StudioRightSlotContext.Provider>
      </StudioTitleRowProvider>
      </StudioSaveProvider>
    </SurfaceDeepLinkProvider>
    </StudioMenuDataProvider>
  );
  return paletteHosted ? page : <CommandPaletteProvider>{page}</CommandPaletteProvider>;
}
