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
// The ONE draft-envelope reader (objectui#8181): unwrap AND strip the
// framework's read decorations in one place. This file used to carry its own
// copy that did the unwrap and skipped the strip.
// …and `formatMetadataError`, the one metadata-save error reader (objectui#11302).
// …and `dropServedPicklistOptions`, the served -> authored conversion of a
// picklist-bound field (objectui#10202), moved here by objectui#11692.
import {
  extractDraftBody,
  formatMetadataError,
} from '@object-ui/data-objectstack';
import type { MetadataClient, MetadataError } from '@object-ui/data-objectstack';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { resolveI18nLabel } from '@objectstack/spec/ui';
import { StudioChatDock, type StudioCopilotStatus, type StudioSurfaceLabel } from './StudioAiCopilot.js';
import { StudioRightSlot } from './StudioRightSlot.js';
import { CONSOLE_FULL_HEIGHT } from '../../layout/chromeBannerHost.js';
import { StudioTitleRowProvider } from './studioTitleRow.js';
import { useStudioAccentOnBody } from './studioAccent.js';
import { AssistantTopBarButton } from '../../layout/AssistantTopBarButton.js';
import { ChatDockControlProvider, type ChatDockControl } from '../../layout/chatDockControl.js';
import {
  StudioRightSlotContext,
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
import {
  STUDIO_ACCENT,
  STUDIO_HEADER_ICON_BUTTON,
  STUDIO_PILLARS_HOST,
} from './studio-tokens.js';
import {
  StudioPendingDraftsContext,
} from './studioItemDraftStatus.js';
import { StudioEmptyState } from './StudioEmptyState.js';
import { StudioRefusalStrip } from './StudioRefusalStrip.js';
import { studioEntryFallbackPath, useStudioEntryPermissions } from './studioEntryPermissions.js';
import { SETUP_PACKAGES_PATH } from '../metadata-admin/packageSource.js';
import { StudioPackageMenu } from './StudioPackageMenu.js';
import { StudioPackageOverviewPage } from './StudioPackageOverviewPage.js';
import { useCanAuthorMetadata } from '../../hooks/useCanAuthorMetadata.js';
import { type NewFlowTrigger } from './AutomationsFlowRail.js';
import {
  type StudioBaseCustomization,
  StudioHeldNotice,
  StudioReadOnlyLink,
} from './StudioPillarKit.js';
import { AutomationsPillar } from './AutomationsPillar.js';
import { DataPillar, renderStudioGridList } from './DataPillar.js';
import {
  cn,
  useIsMobile,
  Button,
} from '@object-ui/components';
import {
  PanelRightClose,
  PanelRightOpen,
  FileQuestion,
  PackageX,
} from 'lucide-react';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
// objectui#11773 — every draft save of an existing item sends the version its buffer was built on.
// objectstack#26858 — the served verdict a flow's inspectors read at their own paths.
import { fetchPendingDrafts } from '../../preview/usePendingDrafts.js';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { STUDIO_HOME_PILLAR, isRetiredInterfacesLanding } from './studioInterfacesRetired.js';
import { StudioInterfacesRetiredNotice } from './StudioInterfacesRetiredNotice.js';
import {
  StudioSaveControls,
  StudioSaveProvider,
} from './studioSaveBar.js';
import {
  BATCH_ABORTED_CODE,
  causalPublishFailures,
  publishRefusal,
  type PublishFailure,
} from './metadataError.js';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';
import {
  isOrgScopeDraft,
  studioOrgScopePath,
} from './studioScope.js';
import { STUDIO_METADATA_AREA, settledAreaAddress } from './metadataArea.js';
import { StudioMenu, StudioMenuDataProvider, StudioMenuProvider } from './StudioMenu.js';
import { StudioMetadataArea } from './StudioMetadataArea.js';
import { StudioOwdOverviewPage } from './StudioOwdOverviewPage.js';
import {
  type SurfaceTarget,
} from './useSurfaceDeepLink.js';
import { SurfaceDeepLinkProvider } from './surfaceDeepLinkChannel.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { CommandPalette, type StudioPaletteSurface } from '../../chrome/CommandPalette.js';
import { CommandPaletteProvider, useCommandPaletteProviderMounted } from '../../context/CommandPaletteProvider.js';
import { StudioPaletteGroups } from './StudioPaletteGroups.js';
import { openStudioPaletteAddress } from './studioPaletteModel.js';
import {
  customizationPairBaseOf,
} from './StudioRailCustomizations.js';
import {
  DraftChangesPanel,
  type DraftPublishOptions,
} from '../../preview/DraftChangesPanel.js';
import { toast } from 'sonner';
import {
  STUDIO_OVERVIEW_SECTION,
  STUDIO_OWD_SECTION,
  studioItemPath,
  studioMetadataTypePath,
  studioPillarPath,
} from './studioAddress.js';
import { studioPackageOverviewPath } from './studioOverviewAddress.js';
import { StudioMissingPackageStrip, StudioMobileStrip, StudioTopLeft } from './StudioTopLeft.js';
import { StudioTitleRowFallback } from './StudioTitleRowFallback.js';
// objectstack#37553 — the scope resolution, moved to its own module unchanged.
import {
  useStudioBaseCustomization,
  useStudioPackageApps,
  useStudioPackageFacts,
  useStudioSurfaceScope,
} from './studioSurfaceScope.js';
// objectstack#37553 — the publish and drafts state, moved to its own module unchanged.
import {
  NO_PUBLISH_REFUSALS,
  publishRefusalKey,
  useStudioChangesSheet,
  useStudioDraftLedger,
} from './studioSurfaceDrafts.js';
// objectstack#37553 — the save-entry plumbing, moved to its own module unchanged.
import { useStudioSurfaceSave } from './studioSurfaceSave.js';

/** The batch door's `backfillApplied` receipt, by reference to what the client returns (objectui#12929). */
type PublishBackfillReceipt = NonNullable<
  Awaited<ReturnType<MetadataClient['publishPackageDrafts']>>['backfillApplied']
>;

/**
 * objectui#12929 — the batch door's backfill receipt as the author reads it:
 * one clause per field, in the order the publish named them, carrying the rows
 * the server says it wrote (`updated`) and, for a field that stopped short, the
 * server's reason. Nothing is derived or estimated here — not a total, and not
 * the record count the sheet showed before the publish.
 */
function formatBackfillReceipt(receipt: PublishBackfillReceipt, locale: string): string {
  return receipt.fields
    .map((f) =>
      tFormat(f.error ? 'engine.studio.backfillStopped' : 'engine.studio.backfillWritten', locale, {
        field: `${f.object}.${f.field}`,
        count: f.updated,
        error: f.error ?? '',
      }),
    )
    .join(' · ');
}

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
  // objectstack#36502 — a landing from an old Interfaces URL says once where
  // interface editing went. The landing's history state is read once and
  // latched here, keyed on the page it landed on: the Changes drawer drops
  // `?changes=` right after the landing, and the area writes its `?package=`,
  // and those navigations carry no state. objectstack#36904 — keyed on the
  // path, not the pillar: the home is the area's object list now, and the
  // area's other pages share its segment. It goes when dismissed or when the
  // author leaves for another page; another old URL is a new history state,
  // so it shows again.
  const { state: landingState, pathname: landingPath }: { state: unknown; pathname: string } = useLocation();
  const [retiredOn, setRetiredOn] = React.useState<string | null>(() =>
    isRetiredInterfacesLanding(landingState) ? landingPath : null,
  );
  React.useEffect(() => {
    if (isRetiredInterfacesLanding(landingState)) setRetiredOn(landingPath);
    // Keyed on the state object alone: a new landing is a new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingState]);
  React.useEffect(() => {
    if (retiredOn !== null && retiredOn !== landingPath) setRetiredOn(null);
  }, [retiredOn, landingPath]);
  const retiredLanding = retiredOn !== null && retiredOn === landingPath;

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

  // The publish toast's way to the package's permission sets; set once the router's
  // navigate is in hand below.
  const openAccessRef = React.useRef<() => void>(() => {});

  // `options` is the review sheet's (objectui#12929): its checked backfill
  // choices, or nothing. Only the package batch door below carries it; the
  // sheet offers no choice in the package-less scope.
  const doPublish = React.useCallback(async (options?: DraftPublishOptions) => {
    if (heldEdit !== null) {
      toast.error(tFormat('engine.studio.held.publish', locale, { clause: heldEdit }));
      return;
    }
    // objectstack#36511 — a publish re-reads the open page from the server, so
    // it would drop edits still waiting for Save: they are saved or cancelled first.
    if (saveBar.dirty) {
      toast.error(t('engine.studio.save.publishFirst', locale));
      return;
    }
    setPublishing(true);
    // objectstack#26730 — a refusal is kept on each causal draft's entry, read
    // by the refused-save reader against the draft the publish judged, and the
    // toast says so. ⛔ It names no engine text: that stays under Details.
    const keepRefusals = async (failed: PublishFailure[]): Promise<void> => {
      const kept = await Promise.all(
        causalPublishFailures(failed).map(async (f) => {
          const type = canonicalMetaUrlType(f.type);
          // Only an issue has a place to point at; the read is best-effort.
          const body =
            Array.isArray(f.issues) && f.issues.length > 0
              ? await shellClient
                  .getDraft<Record<string, unknown>>(f.type, f.name, draftScope !== null ? { packageId: draftScope } : {})
                  .then((resp) => extractDraftBody(resp) as Record<string, unknown> | null, () => null)
              : null;
          return [publishRefusalKey(type, f.name), f.name, publishRefusal(f, type, body, locale)] as const;
        }),
      );
      setPublishRefusals(new Map(kept.map(([key, , refusal]) => [key, refusal])));
      const lines = kept.map(([, name, refusal]) => `${name}: ${refusal.message}`);
      if (failed.some((f) => f.code === BATCH_ABORTED_CODE)) lines.unshift(t('engine.studio.publishRefusedBatch', locale));
      toast.error(
        tFormat(kept.length === 1 ? 'engine.studio.publishRefusedOne' : 'engine.studio.publishRefused', locale, {
          count: kept.length,
        }),
        { description: lines.join('\n') },
      );
    };
    try {
      if (packageId === null) {
        // objectui#11553 — the package-less scope has no package to publish
        // as a batch: `POST /packages/:id/publish-drafts` cannot reach a draft
        // bound to none. Each package-less flow draft is promoted BY REFERENCE
        // instead, through the single-item door the client documents for
        // exactly that case (`publishDraft`), as Home's publish-all does for
        // its package-less drafts. Read fresh, never from the header's count,
        // and narrowed to what this scope reviewed: package-less flows.
        const pending = (await fetchPendingDrafts(null)).filter(isOrgScopeDraft);
        const failed: PublishFailure[] = [];
        for (const d of pending) {
          try {
            await shellClient.publishDraft('flow', d.name);
          } catch (e) {
            failed.push({
              type: 'flow',
              name: d.name,
              error: formatMetadataError(e),
              issues: (e as Partial<MetadataError> | null)?.issues,
            });
          }
        }
        if (failed.length > 0) {
          // Not all-or-nothing: the drafts that went live stay live, and the
          // ones that did not keep their reason on their entries.
          await keepRefusals(failed);
        } else if (pending.length === 0) {
          // objectui#11807 — nothing was pending by the time this read ran, so
          // nothing went live: said as such, never as a success.
          toast.info(t('engine.studio.publishNoneTitle', locale));
          setChangesOpen(false);
        } else {
          // objectui#11807 — how many went live: every draft read above, as
          // none failed.
          // The toast names what went live: one flow in its title, several
          // by count with their names in the description.
          setPublishRefusals(NO_PUBLISH_REFUSALS);
          const names = pending.map((d) => resolveI18nLabel(d.label, locale)?.trim() || d.name);
          if (names.length === 1) {
            toast.success(tFormat('engine.studio.publishedAllFlowsOne', locale, { label: names[0] }));
          } else {
            toast.success(tFormat('engine.studio.publishedAllFlows', locale, { count: names.length }), {
              description: names.join(', '),
            });
          }
          setChangesOpen(false);
        }
        setPublishNonce((n) => n + 1);
        emitMetadataRefresh();
        // The tail below the `finally` is the package path's; this one
        // re-reads the count itself before leaving.
        await refreshPending();
        return;
      }
      // objectui#10039 — through `MetadataClient`, not a bare `fetch`. The
      // route answers the runtime authoring gate's per-draft advisories on
      // each `published[]` element (objectstack#9343), and the client is the
      // seam that reports them: one advisory event per advised item, into the
      // same sink, renderer and wording every other write door on this surface
      // uses. A bare fetch had nothing to report THROUGH. Same move
      // PR objectui#10038 made for the two sibling call sites.
      // objectui#12929 — the sheet's options ride only when it gave some, so an
      // unchecked publish is the very call it was before.
      // objectstack#28562 — on a read-only base, its pair's drafts.
      const publishTarget = pairId ?? packageId;
      const payload = (await (options
        ? shellClient.publishPackageDrafts(publishTarget, options)
        : shellClient.publishPackageDrafts(publishTarget))) as {
        success?: boolean;
        outcome?: string;
        error?: { message?: string; details?: { issues?: unknown } };
        failed?: PublishFailure[];
        published?: unknown[];
        backfillApplied?: PublishBackfillReceipt;
      };
      // A non-2xx now throws inside the client, already carrying the server's
      // message AND the field-anchored `error.details.issues` on
      // `MetadataError.issues` — which is exactly what `formatMetadataError`
      // in the catch below reads, so the hard-failure branch keeps its shape
      // without restating it. What is left here is the 2xx batch verdict.
      //
      // `failed[]` off the body the client returns: it unwraps the
      // dispatcher's `{ success, data }` for this route (the one route whose
      // spec declaration says it arrives inside one), so the enveloped and
      // unenveloped compositions read through ONE spelling here.
      const failed = payload?.failed ?? [];
      if (payload?.outcome === 'nothing_to_publish') {
        // objectui#11807 — the batch's zero answer: nothing went live and
        // nothing was refused. `success` is false on it too, and the spec says
        // to read `outcome` rather than that boolean
        // (`PublishPackageDraftsResponseSchema`), so it is neither the failure
        // below nor a success.
        toast.info(t('engine.studio.publishNoneTitle', locale));
        setPublishRefusals(NO_PUBLISH_REFUSALS);
        setChangesOpen(false);
      } else if (failed.length > 0) {
        // Partial publish: some drafts did NOT go live. The server returns 200
        // with them buried in `failed[]`, so the UI used to claim success and
        // swallow the reason — surface which drafts failed and why instead.
        //
        // objectui#11807 — read BEFORE `success === false`, because a refusal
        // carries both: the batch's own `success` is false on `refused`, and
        // `failed[]` is where its reasons are. Asked in the other order (as
        // since objectui#10039 moved this call onto the client, which unwraps
        // the dispatcher's envelope and so hands back the batch's own
        // `success`), every refusal reached the author as "Action failed".
        await keepRefusals(failed);
      } else if (payload?.success === false && payload?.outcome !== 'published_unregistered') {
        // objectstack#33277 — `published_unregistered` answers `success: false`
        // over drafts that DID land: the registry refused an object, and that
        // object's `published[]` element carries the warning the client has
        // already reported. It reads as the published branch below, as it did
        // while the server answered `published` for it.
        //
        // The status is no longer in hand — a non-2xx threw above — so the
        // last rung is a sentence rather than "HTTP 200".
        throw Object.assign(
          new Error(
            // The sibling call site's own last rung for THIS route
            // (`PackagesPage`'s `publishDrafts`), reused rather than a new
            // key: one route, one sentence when the body carried no prose.
            readEnvelopeFailureText(payload) ||
              t('engine.packages.detail.actionFailed', locale),
          ),
          { issues: payload?.error?.details?.issues },
        );
      } else {
        // objectui#11807 — name how many items went live, read off the batch's
        // own `published[]` (every promoted draft, a draft that changed
        // nothing included). A runtime that answers without it gets the
        // sentence that names no number.
        setPublishRefusals(NO_PUBLISH_REFUSALS);
        const published = payload?.published;
        const title = Array.isArray(published)
          ? tFormat(
              published.length === 1 ? 'engine.studio.publishedAllCountOne' : 'engine.studio.publishedAllCount',
              locale,
              { count: published.length },
            )
          : t('engine.studio.publishedAll', locale);
        // objectui#12929 — the backfill receipt, present only when the sheet
        // named fields and the batch published: per field, the rows the server
        // wrote. A field that stopped short leaves the publish standing, so the
        // toast still says what went live, as a warning that carries why.
        const receipt = payload?.backfillApplied;
        // A published app or object reaches members only through a permission
        // set, so the toast points the author to Access.
        const reachesMembers =
          Array.isArray(published) &&
          published.some((p) => {
            const type = (p as { type?: unknown } | null)?.type;
            return type === 'app' || type === 'object';
          });
        const access = reachesMembers
          ? {
              action: {
                label: t('engine.studio.publishedOpenAccess', locale),
                onClick: () => openAccessRef.current(),
              },
            }
          : {};
        if (receipt) {
          const description = formatBackfillReceipt(receipt, locale);
          if (receipt.success === false) toast.warning(title, { description, ...access });
          else toast.success(title, { description, ...access });
        } else if (reachesMembers) {
          toast.success(title, { description: t('engine.studio.publishedAccessHint', locale), ...access });
        } else {
          toast.success(title);
        }
        setChangesOpen(false);
      }
      setPublishNonce((n) => n + 1);
      // objectui#5801 — announce the publish so the chat bar / home banner /
      // draft cards converge without their own polling.
      emitMetadataRefresh();
    } catch (e) {
      toast.error(formatMetadataError(e));
    } finally {
      setPublishing(false);
    }
    await refreshPending();
  }, [shellClient, packageId, pairId, draftScope, refreshPending, locale, heldEdit, saveBar.dirty]);

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

  /**
   * Host side of the live `?surface=` channel. Producers below the provider —
   * today the pending-changes sheet's security block, which names a draft the
   * publish door would refuse — hand us a surface identity and we put the
   * author in front of it: the item's own address, vetoed (`false`) when the
   * author declines to abandon unsaved edits, so a request never outlives the
   * navigation it needed. A type with no designer page of its own moves
   * nothing.
   *
   * Either way the sheet closes: a selection nobody can see is not navigation.
   */
  const currentPathname = useLocation().pathname;
  const requestSurface = React.useCallback(
    (target: SurfaceTarget): boolean | void => {
      // objectstack#36904 — an object is its designer's own address, in the
      // package that holds the draft the sheet names (`draftScope`): on a
      // read-only base, the `.custom` pair, where an object the pair adds
      // resolves and the base's address does not. objectstack#36909 — a
      // permission set the same way: its matrix's address, in that package
      // (it used to go through the retired Access pillar's address).
      if ((target.type === 'object' || target.type === 'permission') && draftScope !== null) {
        const to = studioItemPath(draftScope, target.type, target.name);
        if (to !== currentPathname) {
          if (!confirmLeavePillar()) return false;
          shellNavigate(to);
        }
        setChangesOpen(false);
        return;
      }
      // objectstack#36903 — a flow is its designer's own address, in a
      // package's area or the package-less scope's.
      if (target.type === 'flow' && !allScope) {
        const to = packageId === null ? studioOrgScopePath(target) : studioItemPath(packageId, 'flow', target.name);
        if (to.split('?')[0] !== currentPathname) {
          if (!confirmLeavePillar()) return false;
          shellNavigate(to);
        }
        setChangesOpen(false);
        return;
      }
      setChangesOpen(false);
    },
    [allScope, packageId, draftScope, confirmLeavePillar, shellNavigate, currentPathname],
  );
  // objectstack#36899 — a menu entry or a palette pick that is the page
  // already shown, on another query, asks about unsaved work first: the
  // shell's link guard lets a link to the page already shown through.
  // objectstack#36909 — it used to remount the open pillar too, so the pillar
  // read the new deep link at mount; no pillar draws a page any more, and the
  // area's pages read their own query.
  const currentSearch = useLocation().search;
  const reenterPillar = React.useCallback((_search: string): boolean => confirmLeavePillar(), [confirmLeavePillar]);
  // objectstack#26708 — a package that is not there has no menu.
  const showMenu = !pkgMissing;

  // objectstack#36900 — ⌘K on every design page (decision 7 of #36890: an
  // author switches items by ×, by ‹ › and by ⌘K). The palette lists this
  // scope's menu, and on a package its items (`StudioPaletteGroups`); a pick
  // leaves the way a menu entry does: it asks about unsaved work, and an
  // address that is the page already open on another query re-enters the
  // page, which reads its deep link once, at mount. The palette's own
  // `?palette=` is not part of the page's query. A package that is not there
  // has no menu, so its palette is the landing's. (`currentPathname` is read
  // above, for `requestSurface`.)
  const openFromPalette = React.useCallback(
    (to: string) =>
      openStudioPaletteAddress(
        to,
        { pathname: currentPathname, search: currentSearch },
        { navigate: shellNavigate, reenter: reenterPillar },
      ),
    [currentPathname, currentSearch, reenterPillar, shellNavigate],
  );
  const paletteLabel = packageId !== null && pkgEntry?.id === packageId ? pkgEntry.name : undefined;
  const paletteSurface = React.useMemo<StudioPaletteSurface | undefined>(
    () =>
      showMenu
        ? {
            packageScope: packageId !== null,
            renderGroups: (groupsProps) => (
              <StudioPaletteGroups segment={scopeSegment} packageLabel={paletteLabel} {...groupsProps} />
            ),
            open: openFromPalette,
          }
        : undefined,
    [showMenu, packageId, scopeSegment, paletteLabel, openFromPalette],
  );
  // A host that already mounts a command palette above this surface keeps
  // its own: a second provider would toggle the one `?palette=` twice per
  // ⌘K, and a second palette would draw a second dialog.
  const paletteHosted = useCommandPaletteProviderMounted();

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

  // objectstack#37455 — and on what Studio draws in a portal on `body`
  // (dialogs, menus, sheets, tooltips, toasts, the palette), while mounted.
  useStudioAccentOnBody();

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
          * left copilot panel; the built-in copilot is the RIGHT dock below. */}
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
            data-studio-slot={slotHost && slotOpen && slotHasContent && !isMobile ? 'open' : 'closed'}
          >
            {/* objectui#11272 — every pillar is keyed by package: a package
                switch keeps this route mounted, and every piece of a pillar's
                state is the package's (objectui#11203). Unkeyed,
                each list effect kept the open item (it keeps the current one
                on a re-read of the same package, a publish or a copilot
                pulse, as it must), its load did not re-run, and an edit saved
                the previous package's item into the next package.
                objectui#11553 — the package-less scope is keyed the same way,
                by its segment, and serves its one pillar: another pillar's
                URL lands on it rather than on a package pillar with no
                package under it. */}
            {allScope ? (
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
                  onSurfaceLabelChange={setSurfaceLabel}
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
                onSurfaceLabelChange={setSurfaceLabel}
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
            )}
          </div>
          {/* objectstack#37456 — the page controls of a page with no title row. */}
          <StudioTitleRowFallback />
          </div>
          </StudioPendingDraftsContext.Provider>
        </div>

        {/* objectui#12725 — the one right slot: properties OR the copilot.
          * The copilot is the same package-scoped build thread the dock held,
          * self-gating on the agent catalog as it always has. */}
        {slotHost && (
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
        )}

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
