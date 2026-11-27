// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page the design surface draws beside its menu, moved out of
 * `StudioDesignSurface.tsx` unchanged by objectstack#37553 (a move-only
 * split): the "All metadata" area in a package, in the package-less scope or
 * on the cross-package leg, 概览 Overview with its Pending tab, the sharing
 * overview, and the not-found states. It holds no state: every value is the
 * surface's.
 */

import * as React from 'react';
import { Navigate, type NavigateFunction } from 'react-router-dom';
import { Button } from '@object-ui/components';
import { FileQuestion, PackageX } from 'lucide-react';
import { StudioEmptyState } from './StudioEmptyState.js';
import { SETUP_PACKAGES_PATH } from '../metadata-admin/packageSource.js';
import { StudioPackageOverviewPage } from './StudioPackageOverviewPage.js';
import type { StudioBaseCustomization } from './StudioPillarKit.js';
import { studioOrgScopePath } from './studioScope.js';
import { STUDIO_METADATA_AREA } from './metadataArea.js';
import { StudioMetadataArea } from './StudioMetadataArea.js';
import { StudioOwdOverviewPage } from './StudioOwdOverviewPage.js';
import { t, tFormat, type SupportedLocale } from '../metadata-admin/i18n.js';
import { DraftChangesPanel } from '../../preview/DraftChangesPanel.js';
import { STUDIO_OVERVIEW_SECTION, STUDIO_OWD_SECTION } from './studioAddress.js';
import type { useStudioPackageApps, useStudioPackageFacts, useStudioSurfaceScope } from './studioSurfaceScope.js';
import type { useStudioSurfaceSave } from './studioSurfaceSave.js';
import type { useStudioChangesSheet, useStudioDraftLedger } from './studioSurfaceDrafts.js';
import type { useStudioPublishAction } from './studioSurfacePublish.js';

export type StudioSurfacePageProps = Pick<
  ReturnType<typeof useStudioSurfaceScope>,
  'allScope' | 'scopeSegment' | 'packageId' | 'tab'
> &
  Pick<
    ReturnType<typeof useStudioPackageFacts>,
    'pkgMissing' | 'pkgEntry' | 'pkgWritable' | 'readOnly' | 'draftScope' | 'publishReadOnly' | 'pairId' | 'baseLabel'
  > &
  Pick<ReturnType<typeof useStudioSurfaceSave>, 'setHeldEdit' | 'setPillarDirty' | 'confirmLeavePillar'> &
  Pick<ReturnType<typeof useStudioChangesSheet>, 'publishNonce' | 'publishing' | 'setChangesOpen'> &
  Pick<
    ReturnType<typeof useStudioDraftLedger>,
    'onDraftSaved' | 'publishRefusalFor' | 'shownPendingCount' | 'renderPublishRefusal'
  > &
  Pick<ReturnType<typeof useStudioPublishAction>, 'doPublish'> &
  Pick<ReturnType<typeof useStudioPackageApps>, 'packageApp' | 'publishedApps'> & {
    locale: SupportedLocale;
    shellNavigate: NavigateFunction;
    /** objectstack#36908 — where the package-not-found state's way out leads. */
    notFoundExit: string;
    customization: StudioBaseCustomization | null;
    /** objectstack#37139 — the package's 「⋯」 menu, drawn in 概览's header. */
    packageMenu: React.ReactNode;
    /** objectstack#37454 — what re-reads 概览's row. */
    overviewRefresh: string;
  };

/** The page beside the menu, chosen by the scope and the route's segment. */
export function StudioSurfacePage({
  allScope,
  scopeSegment,
  packageId,
  tab,
  pkgMissing,
  pkgEntry,
  pkgWritable,
  readOnly,
  draftScope,
  publishReadOnly,
  pairId,
  baseLabel,
  setHeldEdit,
  setPillarDirty,
  confirmLeavePillar,
  publishNonce,
  publishing,
  setChangesOpen,
  onDraftSaved,
  publishRefusalFor,
  shownPendingCount,
  renderPublishRefusal,
  doPublish,
  packageApp,
  publishedApps,
  locale,
  shellNavigate,
  notFoundExit,
  customization,
  packageMenu,
  overviewRefresh,
}: StudioSurfacePageProps): React.ReactElement {
  /* objectui#11272 — every pillar is keyed by package: a package
     switch keeps this route mounted, and every piece of a pillar's
     state is the package's (objectui#11203). Unkeyed,
     each list effect kept the open item (it keeps the current one
     on a re-read of the same package, a publish or a copilot
     pulse, as it must), its load did not re-run, and an edit saved
     the previous package's item into the next package.
     objectui#11553 — the package-less scope is keyed the same way,
     by its segment, and serves its one pillar: another pillar's
     URL lands on it rather than on a package pillar with no
     package under it. */
  return allScope ? (
    <StudioMetadataArea key={scopeSegment} packageId={null} />
  ) : packageId === null ? (
    // objectstack#36903 — the package-less scope's area: its flows,
    // listed and opened full-screen (`studioScope.ts`).
    tab === STUDIO_METADATA_AREA ? (
      <StudioMetadataArea
        key={scopeSegment}
        packageId={null}
        orgScope
        publishNonce={publishNonce}
        onDraftSaved={onDraftSaved}
        onHeldEditChange={setHeldEdit}
      />
    ) : (
      <Navigate to={studioOrgScopePath()} replace />
    )
  ) : pkgMissing ? (
    <StudioEmptyState
      icon={PackageX}
      testId="studio-package-not-found"
      sentence={tFormat('engine.studio.notFound.package', locale, { id: packageId })}
      action={
        // objectstack#36908 — Setup → Packages, or the "All metadata"
        // area for one who may not open it: Studio's home, its old
        // way out, was removed.
        <Button type="button" size="sm" variant="outline" onClick={() => shellNavigate(notFoundExit)}>
          {notFoundExit === SETUP_PACKAGES_PATH
            ? t('engine.studio.notFound.packageList', locale)
            : t('engine.studio.notFound.allMetadata', locale)}
        </Button>
      }
    />
  ) : tab === STUDIO_METADATA_AREA ? (
    // objectstack#28561 — keyed by package like the pillars: every
    // page under it holds that package's scope and gate.
    // objectstack#28569 — its form editor customizes an email
    // template or a translation of a read-only base with the
    // Interfaces pillar's customization, and Publish and the
    // pending count are this header's.
    <StudioMetadataArea
      key={packageId}
      packageId={packageId}
      customization={customization}
      publishNonce={publishNonce}
      onDraftSaved={onDraftSaved}
      publishRefusalFor={publishRefusalFor}
      // objectstack#36904, objectstack#36903 — the object and flow designers' reports, as the pillars' are.
      onHeldEditChange={setHeldEdit}
      onReviewChanges={() => {
        setChangesOpen(true);
      }}
    />
  ) : tab === STUDIO_OVERVIEW_SECTION ? (
    // objectstack#37454 (ADR-0084, amended 2026-11-26) — 概览
    // Overview, the package's own page. Its Pending tab is the
    // changes panel in place, wired to the very publish the top
    // bar's Publish runs (`doPublish`), on the same drafts
    // (`draftScope`) and with the same read-only gate.
    <StudioPackageOverviewPage
      key={packageId}
      packageId={packageId}
      packageName={pkgEntry?.id === packageId ? pkgEntry.name : packageId}
      writable={pkgWritable}
      apps={publishedApps}
      app={packageApp}
      pendingCount={shownPendingCount}
      locale={locale}
      menu={packageMenu}
      refreshKey={overviewRefresh}
      beforeNavigate={confirmLeavePillar}
      navigate={shellNavigate}
      pending={
        <DraftChangesPanel
          embedded
          open
          onOpenChange={() => {}}
          reloadKey={`${publishNonce}:${shownPendingCount ?? ''}`}
          packageId={draftScope}
          onPublish={publishReadOnly ? undefined : doPublish}
          publishing={publishing}
          renderEntryNote={renderPublishRefusal}
          customizationOf={pairId !== null ? baseLabel : undefined}
        />
      }
    />
  ) : tab === STUDIO_OWD_SECTION ? (
    // objectstack#36905 (decision 11) — the organization-wide default
    // sharing overview's own route; its unsaved rows gate the header.
    <StudioOwdOverviewPage
      key={packageId}
      packageId={packageId}
      publishNonce={publishNonce}
      readOnly={readOnly}
      onDirtyChange={setPillarDirty}
    />
  ) : (
    // objectstack#26708 — a segment no page has is a not-found
    // state. objectstack#36909 — the retired pillars' segments never
    // reach here: the route redirects them (`StudioPillarRedirect`).
    <StudioEmptyState
      icon={FileQuestion}
      testId="studio-pillar-not-found"
      sentence={tFormat('engine.studio.notFound.pillar', locale, { pillar: tab })}
    />
  );
}
