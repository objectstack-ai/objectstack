// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioDesignSurface — the open-source WYSIWYG design surface (ADR-0080).
 *
 * Routed as /studio/:packageId/metadata/* (the "All metadata" area, where
 * objects, flows and permission sets open their designers full-screen),
 * /studio/:packageId/owd (the sharing overview) and
 * /studio/:packageId/overview (概览 Overview, the package's own page,
 * objectstack#37454). objectstack#36909 — the
 * retired pillar addresses (`data`, `automations`, `access`, `interfaces`)
 * never reach this surface: the route redirects them
 * (`StudioPillarRedirect`), and any other segment draws a not-found state.
 *
 * Open-core boundary: the left AI copilot is NOT part of the open-source
 * surface — it is an injected slot (`aiSlot`) the cloud edition fills.
 */

import * as React from 'react';
import { useParams, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useStudioAccentOnBody } from './studioAccent.js';
import { StudioRefusalStrip } from './StudioRefusalStrip.js';
import { studioEntryFallbackPath, useStudioEntryPermissions } from './studioEntryPermissions.js';
import { StudioPackageMenu } from './StudioPackageMenu.js';
import { useCanAuthorMetadata } from '../../hooks/useCanAuthorMetadata.js';
import { type NewFlowTrigger } from './AutomationsFlowRail.js';
import {
  type StudioBaseCustomization,
  StudioHeldNotice,
  StudioReadOnlyLink,
} from './StudioPillarKit.js';
import { AutomationsPillar } from './AutomationsPillar.js';
import { DataPillar, renderStudioGridList } from './DataPillar.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
// objectui#11773 — every draft save of an existing item sends the version its buffer was built on.
// objectstack#26858 — the served verdict a flow's inspectors read at their own paths.
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { STUDIO_HOME_PILLAR } from './studioInterfacesRetired.js';
import {
  StudioSaveControls,
} from './studioSaveBar.js';
import { STUDIO_METADATA_AREA, settledAreaAddress } from './metadataArea.js';
import { useMetadataLocale } from '../metadata-admin/i18n.js';
import {
  customizationPairBaseOf,
} from './StudioRailCustomizations.js';
import {
  studioMetadataTypePath,
  studioPillarPath,
} from './studioAddress.js';
// objectstack#37553 — the scope resolution, moved to its own module unchanged.
import {
  useStudioBaseCustomization,
  useStudioPackageApps,
  useStudioPackageFacts,
  useStudioSurfaceScope,
} from './studioSurfaceScope.js';
// objectstack#37553 — the publish and drafts state, moved to its own module unchanged.
import {
  useStudioChangesSheet,
  useStudioDraftLedger,
} from './studioSurfaceDrafts.js';
// objectstack#37553 — the publish, moved to its own module unchanged.
import { useStudioPublishAction } from './studioSurfacePublish.js';
// objectstack#37553 — the right slot and its assistant, moved to their own module unchanged.
import { useStudioSurfaceRightSlot } from './studioSurfaceRightSlot.js';
// objectstack#37553 — the navigation and the palette, moved to their own module unchanged.
import { useRetiredInterfacesLanding, useStudioSurfaceNavigation } from './studioSurfaceNavigation.js';
// objectstack#37553 — the page beside the menu, moved to its own module unchanged.
import { StudioSurfacePage } from './StudioSurfacePage.js';
// objectstack#37553 — the frame, moved to its own module unchanged.
import { StudioSurfaceFrame } from './StudioSurfaceFrame.js';
// objectstack#37553 — the save-entry plumbing, moved to its own module unchanged.
import { useStudioSurfaceSave } from './studioSurfaceSave.js';

// objectstack#29988 — the pillar kit moved to its own module; re-exported for its pins.
export { StudioHeldNotice, StudioReadOnlyLink, type StudioBaseCustomization };

// objectstack#29148 — the strip moved to its own module; re-exported for its pins.
export { StudioRefusalStrip };

export interface StudioDesignSurfaceProps {
  /** Open-core slot — the cloud edition injects its AI copilot panel here. */
  aiSlot?: React.ReactNode;
  /**
   * objectstack#28561 — the surface is mounted on the "All metadata" area's
   * route (`/studio/:packageId/metadata/*`), which has no `:tab` segment: the
   * header marks the area and the body renders it.
   */
  area?: typeof STUDIO_METADATA_AREA;
}

/**
 * objectstack#28572 (ADR-0146 D3) — a URL of a base's paired `<base>.custom`
 * outside the area (its sharing overview, or a segment no page has) lands on
 * the base's surface, which lists, edits and publishes the pair's items: the
 * pair has no surface of its own. The segment and the query are kept.
 *
 * ⛔ Not the "All metadata" area (`area`): its list links an item of the pair
 * to the pair's own area (`?package=<pair>`, which the area re-roots onto
 * that package), so landing that URL on the base would send it straight back.
 *
 * objectstack#36909 — a retired pillar's address (`data`, `automations`,
 * `access`, `interfaces`) is redirected by the route (`StudioPillarRedirect`)
 * before this surface mounts, so none is handled here.
 */
export function StudioDesignSurface(props: StudioDesignSurfaceProps): React.ReactElement {
  const params = useParams<{ packageId?: string; tab?: string }>();
  const location = useLocation();
  const pairBase = props.area ? null : customizationPairBaseOf(params.packageId ?? null);
  if (pairBase !== null) {
    const tab = params.tab ?? STUDIO_HOME_PILLAR;
    return <Navigate to={studioPillarPath(pairBase, tab, { search: location.search })} state={location.state} replace />;
  }
  return <StudioDesignSurfaceBody {...props} />;
}

function StudioDesignSurfaceBody({ aiSlot, area }: StudioDesignSurfaceProps): React.ReactElement {
  const { scopeSegment, allScope, packageId, tab } = useStudioSurfaceScope(area);
  const locale = useMetadataLocale();
  const { retiredLanding, setRetiredOn } = useRetiredInterfacesLanding();

  const {
    pkgWritable,
    pkgEntry,
    setPkgEntry,
    pkgMissing,
    readOnly,
    baseRead,
    pairId,
    draftScope,
    publishReadOnly,
    customizeWalled,
    ensurePairPackage,
    ensurePair,
    baseLabel,
  } = useStudioPackageFacts(packageId);

  const { setPillarDirty, heldEdit, setHeldEdit, saveBar, confirmLeavePillar } = useStudioSurfaceSave(locale);

  // The shared authenticated metadata client for this surface. Declared here
  // rather than beside its other reader below because the publish immediately
  // under it needs the SAME instance: `useMetadataClient` is the layer that
  // hands the console's advisory toast renderer to the client, so the seam is
  // what makes the gate's per-draft findings reach the author (objectui#10039).
  const shellClient = useMetadataClient();

  const {
    changesOpen,
    setChangesOpen,
    publishing,
    setPublishing,
    publishNonce,
    setPublishNonce,
    draftNonce,
    setDraftNonce,
  } = useStudioChangesSheet();
  const customization = useStudioBaseCustomization({
    baseRead,
    packageId,
    baseLabel,
    customizeWalled,
    pairId,
    ensurePair,
    ensurePairPackage,
  });
  const {
    setPublishRefusals,
    refreshPending,
    onDraftSaved,
    renderPublishRefusal,
    publishRefusalFor,
    shownPendingCount,
    pillarPendingDrafts,
  } = useStudioDraftLedger({ packageId, draftScope, publishNonce, setDraftNonce, locale });

  const { openAccessRef, doPublish } = useStudioPublishAction({
    shellClient,
    packageId,
    pairId,
    draftScope,
    refreshPending,
    locale,
    heldEdit,
    saveBar,
    setPublishing,
    setPublishRefusals,
    setChangesOpen,
    setPublishNonce,
  });

  // Builder → running-app bridge: the builder edits the package (the design
  // surface), the app is its published front-end. The header's way back to it
  // is 「‹ Back to app」 at the left (`StudioBackToApp`, objectstack#36501), in
  // the same tab, mirroring the app bar's Edit app.
  const shellNavigate = useNavigate();
  // objectstack#36908 — where the package-not-found state's way out leads:
  // Setup → Packages for a principal who may open it, the "All metadata" area
  // for a Studio-only author (the same choice as Studio's entry).
  const notFoundExit = studioEntryFallbackPath(useStudioEntryPermissions());
  // objectstack#37139 — the package's 「⋯」 menu (`StudioPackageMenu`) is a
  // manage_metadata holder's. A revert or an adoption changes what the package
  // holds: the pillars re-read their baseline, the pending count re-reads (the
  // nonce's effect above), and the other surfaces hear of it. Saved package
  // info renames the bar's package name in place.
  const canAuthorPackage = useCanAuthorMetadata();
  const onPackageChanged = React.useCallback(() => {
    setPublishNonce((n) => n + 1);
    emitMetadataRefresh();
  }, []);
  const onPackageRenamed = React.useCallback(
    (name: string) => setPkgEntry((prev) => (prev && prev.id === packageId ? { ...prev, name } : prev)),
    [packageId],
  );
  React.useEffect(() => {
    // objectstack#36909 — the package's permission sets, where the retired
    // Access pillar's bare address lands, without the hop through it.
    openAccessRef.current = () => {
      if (confirmLeavePillar()) shellNavigate(settledAreaAddress(studioMetadataTypePath(scopeSegment, 'permission')));
    };
  });
  const { packageApp, publishedApps } = useStudioPackageApps(shellClient, packageId, publishNonce, draftNonce);

  const {
    isMobile,
    setSurfaceLabel,
    slotHost,
    slotOpen,
    slotHasContent,
    slotHandle,
    titleRowAssistant,
    rightSlot,
  } = useStudioSurfaceRightSlot({ aiSlot, packageId, pkgMissing, locale });

  const { requestSurface, reenterPillar, showMenu, paletteSurface, paletteHosted } = useStudioSurfaceNavigation({
    scopeSegment,
    allScope,
    packageId,
    draftScope,
    pkgMissing,
    pkgEntry,
    confirmLeavePillar,
    shellNavigate,
    setChangesOpen,
  });

  // objectstack#37139 — the package's 「⋯」 menu: a current package (never
  // `~org` or `~all`) that is there, and a manage_metadata holder.
  // objectstack#37454 — drawn in 概览 Overview's header, moved there from the
  // top bar with its six rows as they were (ADR-0084, amended 2026-11-26).
  const packageMenu =
    packageId !== null && !pkgMissing && canAuthorPackage ? (
      <StudioPackageMenu
        packageId={packageId}
        packageName={pkgEntry?.id === packageId ? pkgEntry.name : packageId}
        writable={pkgWritable}
        pendingCount={shownPendingCount}
        locale={locale}
        onChanged={onPackageChanged}
        onRenamed={onPackageRenamed}
        beforeNavigate={confirmLeavePillar}
        navigate={shellNavigate}
      />
    ) : null;
  // objectstack#37454 — the package's rename re-reads 概览's row too.
  const overviewRefresh = `${publishNonce}:${pkgEntry?.id === packageId ? pkgEntry.name : ''}`;

  // objectstack#37455 — the top bar's page controls, placed by the open
  // page's title row (`studioTitleRow.tsx`). objectstack#36511 — the page's
  // Cancel and Save: drawn only while the open page holds unsaved edits,
  // never in a package that is not there nor on the cross-package leg.
  const titleRowSave =
    !pkgMissing && !allScope && (saveBar.dirty || saveBar.saving) ? (
      <StudioSaveControls coordinator={saveBar} locale={locale} />
    ) : null;

  // objectstack#37455 — and on what Studio draws in a portal on `body`
  // (dialogs, menus, sheets, tooltips, toasts, the palette), while mounted.
  useStudioAccentOnBody();

  return (
    <StudioSurfaceFrame
      scopeSegment={scopeSegment}
      allScope={allScope}
      packageId={packageId}
      pkgMissing={pkgMissing}
      pkgEntry={pkgEntry}
      readOnly={readOnly}
      draftScope={draftScope}
      publishReadOnly={publishReadOnly}
      pairId={pairId}
      baseLabel={baseLabel}
      saveBar={saveBar}
      confirmLeavePillar={confirmLeavePillar}
      changesOpen={changesOpen}
      setChangesOpen={setChangesOpen}
      publishing={publishing}
      shownPendingCount={shownPendingCount}
      renderPublishRefusal={renderPublishRefusal}
      pillarPendingDrafts={pillarPendingDrafts}
      doPublish={doPublish}
      publishedApps={publishedApps}
      isMobile={isMobile}
      slotHost={slotHost}
      slotOpen={slotOpen}
      slotHasContent={slotHasContent}
      slotHandle={slotHandle}
      titleRowAssistant={titleRowAssistant}
      rightSlot={rightSlot}
      requestSurface={requestSurface}
      reenterPillar={reenterPillar}
      showMenu={showMenu}
      paletteSurface={paletteSurface}
      paletteHosted={paletteHosted}
      retiredLanding={retiredLanding}
      setRetiredOn={setRetiredOn}
      aiSlot={aiSlot}
      locale={locale}
      shellNavigate={shellNavigate}
      canAuthorPackage={canAuthorPackage}
      titleRowSave={titleRowSave}
    >
      <StudioSurfacePage
        allScope={allScope}
        scopeSegment={scopeSegment}
        packageId={packageId}
        tab={tab}
        pkgMissing={pkgMissing}
        pkgEntry={pkgEntry}
        pkgWritable={pkgWritable}
        readOnly={readOnly}
        draftScope={draftScope}
        publishReadOnly={publishReadOnly}
        pairId={pairId}
        baseLabel={baseLabel}
        setHeldEdit={setHeldEdit}
        setPillarDirty={setPillarDirty}
        confirmLeavePillar={confirmLeavePillar}
        publishNonce={publishNonce}
        publishing={publishing}
        setChangesOpen={setChangesOpen}
        onDraftSaved={onDraftSaved}
        publishRefusalFor={publishRefusalFor}
        shownPendingCount={shownPendingCount}
        renderPublishRefusal={renderPublishRefusal}
        doPublish={doPublish}
        packageApp={packageApp}
        publishedApps={publishedApps}
        setSurfaceLabel={setSurfaceLabel}
        locale={locale}
        shellNavigate={shellNavigate}
        notFoundExit={notFoundExit}
        customization={customization}
        packageMenu={packageMenu}
        overviewRefresh={overviewRefresh}
      />
    </StudioSurfaceFrame>
  );
}

// objectstack#29988 — the Automations rail's flow helpers moved to their own module; re-exported for their pins.
// objectstack#36903 — the rail's status dot went with the rail.
export { type NewFlowTrigger };

// objectstack#36893 — the Automations pillar moved to its own module; re-exported for its pins.
// objectstack#36905 — the Access pillar is gone: its addresses redirect (`accessPillarRedirect.ts`, reached
// through `StudioPillarRedirect`, objectstack#36909).
export { AutomationsPillar };

// objectstack#36893 — the Data pillar moved to its own module; re-exported for its pins.
export { DataPillar, renderStudioGridList };

export default StudioDesignSurface;
