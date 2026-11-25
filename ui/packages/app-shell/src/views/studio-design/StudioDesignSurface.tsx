// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioDesignSurface — the open-source WYSIWYG design surface (ADR-0080).
 *
 * Routed as /studio/:packageId/{data|automations|interfaces} — three pillars,
 * each composed AROUND existing renderers (no new editor code):
 *   - Interfaces: the real App navigation tree → live canvas (getMetadataPreview)
 *     + inspector (getMetadataInspector), edits persisting via draft → publish.
 *   - Data: the package's objects → fields + record grid.
 *   - Automations: flows → FlowPreview (default OFF / review-then-enable).
 *
 * Open-core boundary: the left AI copilot is NOT part of the open-source
 * surface — it is an injected slot (`aiSlot`) the cloud edition fills.
 */

import * as React from 'react';
import { useParams, useNavigate, useSearchParams, useLocation, Navigate } from 'react-router-dom';
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
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { StudioChatDock, type StudioCopilotStatus, type StudioSurfaceLabel } from './StudioAiCopilot.js';
import { StudioRightSlot } from './StudioRightSlot.js';
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
import type { AppMarkApp } from '../../layout/AppMark.js';
import {
  STUDIO_HEADER,
  STUDIO_HEADER_ICON_BUTTON,
  STUDIO_HEADER_PACKAGE_COLUMN,
  STUDIO_HEADER_WIDE_WORD,
  STUDIO_PILLARS_HOST,
} from './studio-tokens.js';
import {
  StudioPendingDraftsContext,
  type StudioPendingDrafts,
} from './studioItemDraftStatus.js';
import { StudioEmptyState } from './StudioEmptyState.js';
import {
  navigationObjectOrder,
} from './flowGrouping.js';
import { StudioRefusalStrip } from './StudioRefusalStrip.js';
import { PACKAGE_LIST_TOAST_ID } from './PackageSwitcher.js';
import { studioEntryFallbackPath } from './StudioEntryRedirect.js';
import { useStudioEntryPermissions } from './studioEntryPermissions.js';
import { SETUP_PACKAGES_PATH } from '../metadata-admin/packageSource.js';
import { StudioBackToApp, type StudioAppTarget } from './StudioBackToApp.js';
import {
  FlowStatusDot,
  type NewFlowTrigger,
} from './AutomationsFlowRail.js';
import {
  CreateTakenNotice,
  findTakenIdentifier,
  type StudioBaseCustomization,
  StudioHeldNotice,
  StudioReadOnlyLink,
  type StudioSavedDraft,
} from './StudioPillarKit.js';
import { AutomationsPillar } from './AutomationsPillar.js';
import { DataPillar, renderStudioGridList } from './DataPillar.js';
import {
  cn,
  useIsMobile,
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import {
  Loader2,
  Plus,
  GitBranch,
  Rocket,
  PanelRightClose,
  PanelRightOpen,
  FileQuestion,
  PackageX,
} from 'lucide-react';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
// objectui#11773 — every draft save of an existing item sends the version its buffer was built on.
// objectstack#26858 — the served verdict a flow's inspectors read at their own paths.
import { fetchPendingDrafts, usePendingDrafts } from '../../preview/usePendingDrafts.js';
import { emitMetadataRefresh, subscribeMetadataRefresh } from '../../assistant/assistantBus.js';
import { STUDIO_CHANGES_PARAM, STUDIO_CHANGES_REVIEW } from './studioChangesLink.js';
import {
  RETIRED_INTERFACES_SEGMENT,
  STUDIO_HOME_PILLAR,
  isRetiredInterfacesLanding,
  retiredInterfacesState,
  retiredInterfacesTarget,
} from './studioInterfacesRetired.js';
import { StudioInterfacesRetiredNotice } from './StudioInterfacesRetiredNotice.js';
import {
  StudioSaveControls,
  StudioSaveProvider,
  useStudioSaveCoordinator,
} from './studioSaveBar.js';
import {
  BATCH_ABORTED_CODE,
  causalPublishFailures,
  publishRefusal,
  type PublishFailure,
  type StudioRefusal,
} from './metadataError.js';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';
import {
  STUDIO_ORG_SCOPE_PILLAR,
  isOrgScopeDraft,
  isStudioOrgScope,
  studioOrgScopePath,
} from './studioScope.js';
import { STUDIO_METADATA_AREA, isStudioAllPackagesScope } from './metadataArea.js';
import { StudioMenu, StudioMenuDataProvider, StudioMenuProvider, StudioMenuTrigger } from './StudioMenu.js';
import { StudioMetadataArea } from './StudioMetadataArea.js';
import { StudioOwdOverviewPage } from './StudioOwdOverviewPage.js';
import { AccessPillarLanding } from './accessPillarLanding.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
import {
  type SurfaceTarget,
} from './useSurfaceDeepLink.js';
import { SurfaceDeepLinkProvider } from './surfaceDeepLinkChannel.js';
import { buildAppSkeleton, type AppNavSeed } from './skeletons.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { confirmUnsavedLeave, useRegisterUnsavedEdits } from '../../chrome/unsavedEdits.js';
import { CommandPalette, type StudioPaletteSurface } from '../../chrome/CommandPalette.js';
import { CommandPaletteProvider, useCommandPaletteProviderMounted } from '../../context/CommandPaletteProvider.js';
import { StudioPaletteGroups } from './StudioPaletteGroups.js';
import { openStudioPaletteAddress, studioSamePageSearch } from './studioPaletteModel.js';
import { CreateItemDialog } from './CreateItemDialog.js';
// objectui#11787 — the shared draft autosave, moved to its own module unchanged.
import {
  ensureCustomizationPackage,
  fetchListedPackageIds,
  fetchListedPackageManifests,
  fetchPackages,
  listedCustomizationPairOf,
  listedPackageEntry,
  listedPackageVersion,
  type EnsuredCustomizationPackage,
  type PkgEntry,
} from './packages-io.js';
import { usePackageCustomizations } from './CustomizationMark.js';
import {
  customizationPairBaseOf,
} from './StudioRailCustomizations.js';
import {
  useCustomizeDoorWalled,
} from './StudioCustomizeControls.js';
import {
  DraftChangesPanel,
  type DraftChangeEntry,
  type DraftChangesPosture,
  type DraftPublishOptions,
} from '../../preview/DraftChangesPanel.js';
import { toast } from 'sonner';
import { STUDIO_OWD_SECTION, studioPillarItemAddress, studioPillarPath } from './studioAddress.js';

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

// The pillar segments `/studio/<package>/<pillar>` serves. objectstack#36899
// (ADR-0084, amended) — they are no longer a navigation: Studio's one
// navigation is the left menu (`StudioMenu`), and these pages are where an
// object, a flow or a permission set opens until each becomes a full-screen
// item page. Data stays the Studio home. objectstack#36502 — the Interfaces
// pillar is retired (`studioInterfacesRetired.tsx`). The "All metadata" area
// (`/studio/<package>/metadata/…`, `metadataArea.ts`) is not a pillar, so the
// not-found check does not hold it.
const PILLARS: readonly string[] = [STUDIO_HOME_PILLAR, 'automations', 'access'];
// objectstack#29988 — the pillar kit moved to its own module; re-exported for its pins.
export { StudioHeldNotice, StudioReadOnlyLink, type StudioBaseCustomization };

/**
 * Which pillar owns a surface type — the routing half of a live surface
 * request (see surfaceDeepLinkChannel). Only the types a pillar actually
 * RESOLVES are listed, mirroring the `resolveSurfaceDeepLink` call sites
 * below; an unlisted type is delivered in place rather than guessed at,
 * because navigating to the wrong pillar costs the author their position and
 * buys nothing.
 */
const PILLAR_FOR_SURFACE_TYPE: Readonly<Record<string, string>> = {
  object: 'data',
  flow: 'automations',
  permission: 'access',
};


// objectstack#29148 — the strip moved to its own module; re-exported for its pins.
export { StudioRefusalStrip };

/**
 * objectstack#26730 — which Pending changes entry a kept publish refusal
 * belongs to: the draft's canonical type and name. The `_drafts` feed and
 * `failed[]` may spell a type either way; the panel's entries are folded.
 */
function publishRefusalKey(type: string, name: string): string {
  return `${canonicalMetaUrlType(type)}/${name}`;
}

const NO_PUBLISH_REFUSALS: ReadonlyMap<string, StudioRefusal> = new Map();

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
 * objectstack#28572 (ADR-0146 D3) — a pillar URL of a base's paired
 * `<base>.custom` lands on the base's surface, which lists, edits and
 * publishes the pair's items: the pair has no surface of its own. The pillar
 * and the query (a `?surface=` deep link) are kept.
 *
 * ⛔ Not the "All metadata" area (`area`): its list links an item of the pair
 * to the pair's own area (`?package=<pair>`, which the area re-roots onto
 * that package), so landing that URL on the base would send it straight back.
 */
export function StudioDesignSurface(props: StudioDesignSurfaceProps): React.ReactElement {
  const params = useParams<{ packageId?: string; tab?: string }>();
  const location = useLocation();
  // objectstack#36502 — an old Interfaces URL lands on the Studio home and
  // says where interface editing went (`studioInterfacesRetired.tsx`).
  if (!props.area && params.tab === RETIRED_INTERFACES_SEGMENT) {
    const scope = customizationPairBaseOf(params.packageId ?? null) ?? params.packageId ?? 'com.example.showcase';
    return <Navigate to={retiredInterfacesTarget(scope, location.search)} state={retiredInterfacesState()} replace />;
  }
  const pairBase = props.area ? null : customizationPairBaseOf(params.packageId ?? null);
  if (pairBase !== null) {
    const tab = params.tab ?? STUDIO_HOME_PILLAR;
    return <Navigate to={studioPillarPath(pairBase, tab, { search: location.search })} state={location.state} replace />;
  }
  return <StudioDesignSurfaceBody {...props} />;
}

function StudioDesignSurfaceBody({ aiSlot, area }: StudioDesignSurfaceProps): React.ReactElement {
  const params = useParams<{ packageId?: string; tab?: string }>();
  // The route segment: a package id, or the package-less scope's reserved
  // segment (objectui#11553, `studioScope.ts`). URLs are built from it.
  const scopeSegment = params.packageId ?? 'com.example.showcase';
  // objectstack#36899 — the "All metadata" area's cross-package leg (`~all`)
  // is drawn in this shell too, so the left menu is the same on every Studio
  // page: the area alone, with no package, no package actions and no slot.
  const allScope = isStudioAllPackagesScope(scopeSegment);
  // `null` in the package-less scope and on the cross-package leg. Every
  // package-scoped read, write and publish below keys on this value, so none
  // of them can be handed a reserved segment as though it named a package.
  const packageId: string | null = isStudioOrgScope(scopeSegment) || allScope ? null : scopeSegment;
  const tab = area ?? params.tab ?? STUDIO_HOME_PILLAR;
  // objectstack#26708 — a segment no pillar has is a not-found state, never
  // a pillar it falls through to.
  const pillarKnown = PILLARS.includes(tab);
  const locale = useMetadataLocale();
  // objectstack#36502 — a landing from an old Interfaces URL says once where
  // interface editing went. The landing's history state is read once and
  // latched here, keyed on the pillar it landed on: the Data pillar writes
  // its own `?surface=` (the first object) and the Changes drawer drops
  // `?changes=` right after the landing, and those navigations carry no state.
  // It goes when dismissed or when the author leaves for another pillar;
  // another old URL is a new history state, so it shows again.
  const landingState: unknown = useLocation().state;
  const [retiredOn, setRetiredOn] = React.useState<string | null>(() =>
    isRetiredInterfacesLanding(landingState) ? tab : null,
  );
  React.useEffect(() => {
    if (isRetiredInterfacesLanding(landingState)) setRetiredOn(tab);
    // Keyed on the state object alone: a new landing is a new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingState]);
  React.useEffect(() => {
    if (retiredOn !== null && retiredOn !== tab) setRetiredOn(null);
  }, [retiredOn, tab]);
  const retiredLanding = retiredOn !== null && retiredOn === tab;

  // Courtesy gate (the framework's ADR-0124 D1 — server enforces, client is
  // courtesy): a read-only code/installed package refuses authoring
  // server-side (ADR-0070), so don't let the user build up doomed local edits
  // first — disable the authoring affordances up front. Unknown writability
  // (fetch failed / still loading) stays ungated; the server gate remains the
  // authority either way. `undefined` is "still asking" and `null` is "could
  // not find out": the gate reads both as ungated, and only the Interfaces
  // pillar's `?sel=nav:` deep link tells them apart, so that it does not act
  // on a write state nobody has answered yet (objectui#11153).
  const [pkgWritable, setPkgWritable] = React.useState<boolean | null | undefined>(undefined);
  // objectui#12718 — the package's display name, from the same answer: the
  // Interfaces pillar names a package that has no app yet by it. Held with
  // the id it answered for, so a switch never hands the next package the
  // previous one's name while its own read is in flight.
  const [pkgEntry, setPkgEntry] = React.useState<PkgEntry | null>(null);
  // objectstack#26708 — the package list answered and lists no package with
  // this id: the surface renders "package not found" instead of a builder
  // whose every save the server refuses. Only a positive answer sets it — a
  // read still in flight or one that failed leaves the builder as it was, the
  // same fail direction as the writability gate above. A switcher entry is
  // installed; an id with none is then looked up in every id the list serves
  // (`fetchListedPackageIds`, the same request), because the switcher's
  // entries hide the kernel packages that ARE installed.
  const [pkgMissing, setPkgMissing] = React.useState(false);
  // objectstack#28562 (ADR-0146 D2, D3) — what customizing a read-only base
  // reads off the same list: the version its manifest declares (an override's
  // `basedOn`) and its paired customization package when one is listed. Held
  // with the id it answered for; `null` until read, and on a writable package.
  const [baseFacts, setBaseFacts] = React.useState<{
    for: string;
    basedOn: string | null;
    listedPair: string | null;
  } | null>(null);
  React.useEffect(() => {
    // objectui#11553 — the package-less scope has no package to look up; its
    // writability is decided below, not fetched.
    if (packageId === null) return;
    let cancelled = false;
    setPkgWritable(undefined);
    setPkgMissing(false);
    setBaseFacts(null);
    // Asked beside the entries read, so both share its one request. A failure
    // is reported once, by the entries read below.
    const listedIds = fetchListedPackageIds();
    listedIds.catch(() => {});
    const listedManifests = fetchListedPackageManifests();
    listedManifests.catch(() => {});
    const settle = (entry: PkgEntry | null) => {
      setPkgWritable(entry?.writable ?? null);
      setPkgEntry(entry);
      if (!entry || entry.writable) return;
      listedManifests.then(
        (manifests) => {
          if (cancelled) return;
          setBaseFacts({
            for: packageId,
            basedOn: listedPackageVersion(manifests, packageId),
            listedPair: listedCustomizationPairOf(manifests, packageId),
          });
        },
        () => {},
      );
    };
    fetchPackages()
      .then((list) => {
        if (cancelled) return;
        const entry = list.find((p) => p.id === packageId) ?? null;
        if (entry) {
          settle(entry);
          return;
        }
        // objectstack#29567 — the switcher's entries leave the kernel packages
        // out, but an open one is still judged: the listed row carries the
        // server's verdict (read-only by scope), so the surface reads it
        // read-only and offers Customize, as for a code-booted base.
        // `pkgWritable` stays "still asking" until that answer lands.
        listedManifests.then(
          (manifests) => {
            if (!cancelled) settle(listedPackageEntry(manifests, packageId));
          },
          () => {
            if (!cancelled) settle(null);
          },
        );
        listedIds.then(
          (ids) => {
            if (!cancelled) setPkgMissing(!ids.has(packageId));
          },
          () => {},
        );
      })
      .catch((e: unknown) => {
        // Staying ungated is still right — the server gate is the authority
        // and a failed probe must not lock the author out of their own
        // package. But "I could not find out" is not the same event as "still
        // asking", and until objectui#7368 neither one said anything at all.
        // Same toast id as the switcher: one outage, one toast.
        if (cancelled) return;
        setPkgWritable(null);
        toast.error(formatMetadataError(e), { id: PACKAGE_LIST_TOAST_ID });
      });
    return () => {
      cancelled = true;
    };
  }, [packageId]);
  // objectui#11553 — the package-less scope's flows are the organization's
  // own, so they open editable whatever the last package answered. The
  // server's write gate stays the authority, exactly as for a writable package.
  const readOnly = packageId !== null && pkgWritable === false;
  // objectstack#28562 — the base's pair: the ensure door's answer once this
  // surface has asked it, else the listed one. Pending, the changes panel and
  // Publish act on its drafts (`draftScope`); with no pair, on the base's own,
  // as before. ⛔ A write names the door's answer only (`ensurePair`).
  const [ensuredPair, setEnsuredPair] = React.useState<{ base: string; packageId: string } | null>(null);
  const baseRead = readOnly && baseFacts !== null && baseFacts.for === packageId ? baseFacts : null;
  const pairId =
    !readOnly || packageId === null
      ? null
      : ensuredPair?.base === packageId
        ? ensuredPair.packageId
        : (baseRead?.listedPair ?? null);
  const draftScope = pairId ?? packageId;
  // A read-only base with no pair has nothing of its own to publish.
  const publishReadOnly = readOnly && pairId === null;
  const customizeWalled = useCustomizeDoorWalled();
  const ensurePairPackage = React.useCallback(async (): Promise<EnsuredCustomizationPackage> => {
    if (packageId === null) throw new Error('No package is open.');
    const answer = await ensureCustomizationPackage(packageId);
    setEnsuredPair({ base: packageId, packageId: answer.packageId });
    return answer;
  }, [packageId]);
  const ensurePair = React.useCallback(async (): Promise<string> => (await ensurePairPackage()).packageId, [ensurePairPackage]);
  const baseLabel = pkgEntry?.id === packageId ? pkgEntry.name : (packageId ?? '');

  // objectui#2600 — the header's pillar links and its 「‹ Back to app」 link
  // are pure SPA client navigation, so the editors' `beforeunload` guard never
  // fires; a dirty pillar unmounts silently and its unsaved edits are gone
  // (Access matrix cells, Interfaces nav). Each pillar mirrors its dirty state
  // up (the PR #2588 `onDirtyChange` contract) and every header-driven
  // departure gates on the same native confirm the pillars use internally.
  // Pillars reset their report on unmount, so a confirmed discard clears the
  // flag by itself.
  const [pillarDirty, setPillarDirty] = React.useState(false);
  // objectui#11786 — what the open pillar's autosave holds unsent (an
  // incomplete-but-normal edit), as the clause naming what it needs. A publish
  // promotes the drafts the server holds, which do not carry that edit, so it is
  // refused while one is held rather than going around it silently.
  const [heldEdit, setHeldEdit] = React.useState<string | null>(null);
  // objectstack#36511 — the open page's buffers that save with the top bar's
  // Save and Cancel (`studioSaveBar.tsx`).
  const saveBar = useStudioSaveCoordinator(locale);
  // objectstack#26705 — a held edit lives only in the pillar's buffer, so a
  // departure drops it exactly as it drops a dirty pillar's edits: both are
  // unsaved work, and every guard below reads this one bit. objectstack#36511
  // — so does an edit waiting for the top bar's Save.
  const unsavedPillarWork = pillarDirty || heldEdit !== null || saveBar.dirty;
  // objectstack#36900 — every departure this surface starts asks the shell's
  // unsaved-edits seam, not only this surface's own bit: the seam holds this
  // surface's work (registered below with the same question) AND every editor
  // below it that registers its own, the "All metadata" item page
  // (`ResourceEditPage`) among them, whose edits this bit never sees. So the
  // palette's picks, the header's Back to app, the retired-Interfaces notice
  // and a request to open another pillar's surface all ask before they drop
  // either kind of edit. `true`: nothing would be lost, or the author agreed.
  const confirmLeavePillar = React.useCallback((): boolean => {
    let agreed = false;
    confirmUnsavedLeave(() => {
      agreed = true;
    });
    return agreed;
  }, []);
  // Browser-native "leave site?" prompt on tab close / reload while a pillar
  // is dirty. The matrix editor installs its own (double registration is
  // harmless); the Interfaces nav editor has none, so this closes that gap.
  React.useEffect(() => {
    if (!unsavedPillarWork) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for Chrome to actually show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [unsavedPillarWork]);
  // objectui#13253 — the shell's own departures (header menus, palette, inbox,
  // AI entry) leave from buttons this surface never sees, so a dirty pillar
  // registers with the shell's seam, with the same question the header asks.
  // While registered, the seam's link guard also asks before a pillar link
  // leaves, so the pillar links below no longer ask a second time.
  useRegisterUnsavedEdits(unsavedPillarWork, t('engine.edit.unsavedLeaveConfirm', locale));

  // The shared authenticated metadata client for this surface. Declared here
  // rather than beside its other reader below because the publish immediately
  // under it needs the SAME instance: `useMetadataClient` is the layer that
  // hands the console's advisory toast renderer to the client, so the seam is
  // what makes the gate's per-draft findings reach the author (objectui#10039).
  const shellClient = useMetadataClient();

  // Package-level publish (ADR-0033/0037/0048): drafts are per item, STAMPED
  // with this package (each save passes packageId → the draft row's
  // sys_metadata.package_id). Publishing promotes exactly THIS package's drafts in
  // one atomic pass (POST /packages/:id/publish-drafts), reviewed as a whole in
  // DraftChangesPanel. objectstack#36511 — an editor converted to the top bar's
  // Save writes its item's draft and publishes that one item at once
  // (`publishSavedItem`), so it leaves no draft; Changes and Publish are for the
  // drafts other writers (the copilot) and the editors not yet converted leave.
  const [changesOpen, setChangesOpen] = React.useState(false);
  // objectui#12517 — which trigger opened the sheet: Publish opens it to
  // confirm (rows expanded, focus on Publish all), Changes opens it to review.
  const [changesPosture, setChangesPosture] = React.useState<DraftChangesPosture>('review');
  // objectui#12894 — the drawer's one way in from outside the top bar:
  // `?changes=review` (`studioChangesLink.ts`), written by the copilot's
  // applied card (查看变更并发布). Opened to review, then the param is dropped
  // (replace) so a refresh or a Back does not reopen it. Read on every change,
  // not only at mount: the Studio copilot writes it while the surface is up.
  const [searchParams, setSearchParams] = useSearchParams();
  const changesRequest = searchParams.get(STUDIO_CHANGES_PARAM);
  React.useEffect(() => {
    if (changesRequest === null) return;
    if (changesRequest === STUDIO_CHANGES_REVIEW) {
      setChangesPosture('review');
      setChangesOpen(true);
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(STUDIO_CHANGES_PARAM);
        return next;
      },
      { replace: true },
    );
    // Keyed on the param's value alone: `setSearchParams` is re-minted with
    // every search change (objectui#8640 — never key on a hook's identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changesRequest]);
  const [publishing, setPublishing] = React.useState(false);
  const [publishNonce, setPublishNonce] = React.useState(0); // ↑ → pillars re-read the published baseline
  const [draftNonce, setDraftNonce] = React.useState(0); // ↑ → a draft save landed (`onDraftSaved`)
  // objectstack#28572 (ADR-0146 D3) — the base's served customization read
  // (N-15), which every pillar rail marks its rows from; read again whenever
  // the served overrides may have moved. objectstack#30238 — that is the
  // metadata-refresh pulse, not `publishNonce`: a publish moves the nonce AND
  // announces itself on the bus, but "Restore package original" (every
  // pillar's, and the bundle item editor's) deletes the pair's row and only
  // announces, so a read keyed on the nonce left the rail's marks and the
  // "only customizations" count stale until a reload. Keyed on the pulse
  // alone, a publish reads once, not twice; a copilot publish is read too.
  const customizationsRefresh = useMetadataRefreshNonce();
  const baseCustomizations = usePackageCustomizations(
    baseRead && packageId !== null ? packageId : null,
    customizationsRefresh,
  );
  const customization = React.useMemo<StudioBaseCustomization | null>(
    () =>
      baseRead && packageId !== null
        ? {
            base: packageId,
            baseLabel,
            basedOn: baseRead.basedOn,
            walled: customizeWalled,
            pairId,
            ensure: ensurePair,
            ensurePackage: ensurePairPackage,
            marks: baseCustomizations,
          }
        : null,
    [baseRead, packageId, baseLabel, customizeWalled, pairId, ensurePair, ensurePairPackage, baseCustomizations],
  );
  // objectstack#26730 — what the last publish refused, by draft
  // (`publishRefusalKey`), each shown on its Pending changes entry until it is
  // resolved: the draft saved again, a publish that lets it through, or the
  // draft no longer pending. A toast alone was gone in four seconds.
  const [publishRefusals, setPublishRefusals] = React.useState(NO_PUBLISH_REFUSALS);

  // objectui#5801 — the shared pending-drafts source: same fetch, same count,
  // and the assistant bus's metadata-refresh pulse keeps this topbar in step
  // with every OTHER surface's publishes (chat bar, home banner) — previously
  // a publish from the right dock never updated this count.
  //
  // objectui#11553 — the package-less scope reads the env-wide feed and counts
  // only what it shows and publishes: package-less FLOW drafts. Still `null`
  // while the feed is unknown, so the header keeps telling unknown from zero.
  const {
    count: feedCount,
    entries: pendingEntries,
    refresh: refreshPending,
    behindSave,
  } = usePendingDrafts({ packageId: draftScope });
  const pendingCount =
    packageId !== null ? feedCount : feedCount === null ? null : pendingEntries.filter(isOrgScopeDraft).length;

  // A draft save asks for its own read (`onDraftSaved` below, objectui#11787);
  // this one serves the mount and a publish.
  React.useEffect(() => {
    void refreshPending();
  }, [refreshPending, publishNonce]);
  const refreshPendingRef = React.useRef(refreshPending);
  React.useLayoutEffect(() => {
    refreshPendingRef.current = refreshPending;
  });
  // A kept refusal whose draft the ledger no longer lists has nothing left to
  // fix (discarded, or published from another surface), so it is not shown.
  // Read only off a known ledger: an unknown one (`feedCount === null`) lists nothing.
  const listedPublishRefusals = React.useMemo(() => {
    if (feedCount === null || publishRefusals.size === 0) return publishRefusals;
    const listed = new Set(pendingEntries.map((e) => publishRefusalKey(e.type, e.name)));
    return new Map([...publishRefusals].filter(([key]) => listed.has(key)));
  }, [feedCount, pendingEntries, publishRefusals]);

  // The publish toast's way to the Access pillar; set once the router's
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

  // objectui#11787 — a Studio draft save reports here when it lands, and the
  // count follows it: the read it asks for is sent after the save, never
  // answered by a read already on the wire, and until that read answers the
  // count is at least the one draft the save wrote (`behindSave`). So the
  // header stops saying "No drafts pending publish" in the same render that
  // shows an item's "Unpublished draft" chip, both being set by the save that
  // landed. Pinned by `StudioDesignSurface.changesCount-11787.test.tsx`.
  //
  // objectstack#26730 — `saved` names the draft the save wrote, and a refusal
  // its last publish left is dropped: the author has changed what was judged.
  const onDraftSaved = React.useCallback((saved?: StudioSavedDraft) => {
    if (saved) {
      const key = publishRefusalKey(saved.type, saved.name);
      setPublishRefusals((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
    setDraftNonce((n) => n + 1);
    void refreshPendingRef.current({ afterSave: true });
  }, []);
  // objectstack#26730 — the refusal kept for an entry, under its row in the
  // sheet. No "Show me" there: the sheet's way to an item is its own link, and
  // the strip's opens an input only in the pillar that holds the item.
  const renderPublishRefusal = React.useCallback(
    (entry: DraftChangeEntry) => {
      const refusal = listedPublishRefusals.get(publishRefusalKey(entry.type, entry.name));
      return refusal ? <StudioRefusalStrip refusal={refusal} locale={locale} className="px-2 py-1.5 text-xs" /> : null;
    },
    [listedPublishRefusals, locale],
  );
  // objectstack#30064 — the same kept refusal, for the All metadata area's
  // editor of the item it refused (a customized dataset), shown at the item.
  const publishRefusalFor = React.useCallback(
    (type: string, name: string): StudioRefusal | null => listedPublishRefusals.get(publishRefusalKey(type, name)) ?? null,
    [listedPublishRefusals],
  );
  const shownPendingCount = behindSave ? Math.max(pendingCount ?? 0, 1) : pendingCount;
  const hasPending = (shownPendingCount ?? 0) > 0;
  // objectui#12725 — the same ledger and number, for the pillars' item headers
  // (「草稿 · N 项未发布」): the rows the count above counts, so the package-less
  // scope offers its org-scope flow drafts only.
  const pillarPendingDrafts = React.useMemo<StudioPendingDrafts>(
    () => ({
      count: shownPendingCount,
      entries: packageId !== null ? pendingEntries : pendingEntries.filter(isOrgScopeDraft),
      behindSave,
    }),
    [shownPendingCount, packageId, pendingEntries, behindSave],
  );
  const publishReadOnlyReasonId = React.useId();
  // The reason a disabled Publish gives, or `null` when it gives none.
  // objectstack#36511 — Publish is drawn only while a draft is pending, so the
  // one reason left is a read-only package.
  const publishDisabledReason: { id: string; text: string; testId?: string } | null = publishReadOnly
    ? { id: publishReadOnlyReasonId, text: t('engine.studio.pkg.readonlyHint', locale) }
    : null;

  // Builder → running-app bridge: the builder edits the package (the design
  // surface), the app is its published front-end. The header's way back to it
  // is 「‹ Back to app」 at the left (`StudioBackToApp`, objectstack#36501), in
  // the same tab, mirroring the app bar's Edit app.
  const shellNavigate = useNavigate();
  // objectstack#36908 — where the package-not-found state's way out leads:
  // Setup → Packages for a principal who may open it, the "All metadata" area
  // for a Studio-only author (the same choice as Studio's entry).
  const notFoundExit = studioEntryFallbackPath(useStudioEntryPermissions());
  React.useEffect(() => {
    openAccessRef.current = () => {
      if (confirmLeavePillar()) shellNavigate(studioPillarPath(scopeSegment, 'access', { segmentEncoding: 'verbatim' }));
    };
  });
  // objectui#11181 — `label` is the app's own `I18nLabel` (a plain string or an
  // inline locale map), held as the spec types it and never `String()`ed: a map
  // would read `[object Object]`. Only the presence of `packageApp` is read
  // today; a reader of `label` resolves it in the designer locale at render,
  // through `navItemLabelText`, as the Interfaces rail heading does.
  const [packageApp, setPackageApp] = React.useState<{ name: string; label: I18nLabel; icon?: string; branding?: AppMarkApp['branding'] } | null>(null);
  // objectui#12612 — the objects the package app's navigation lists, in its
  // order: the Automations rail orders its groups by it. Read off the same
  // app row as `packageApp`, so the pillar adds no read of its own.
  const [packageAppObjectOrder, setPackageAppObjectOrder] = React.useState<readonly string[]>([]);
  // objectstack#36501 — the package's PUBLISHED apps, where the header's
  // 「‹ Back to app」 goes when the author did not come from an app: a draft
  // app has no running front-end to open. Read off the same list as
  // `packageApp`.
  const [publishedApps, setPublishedApps] = React.useState<readonly StudioAppTarget[]>([]);
  // Create app (package has no app yet): create a draft `app` item — the
  // published front-end's on-ramp. After the package publish, 「‹ Back to
  // app」 names it.
  const [appCreating, setAppCreating] = React.useState(false);
  const [appBusy, setAppBusy] = React.useState(false);
  const [appErr, setAppErr] = React.useState<string | null>(null);
  const [appDraftPending, setAppDraftPending] = React.useState<string | null>(null);
  // objectstack#26917 — a create refused because an app already holds the
  // identifier (published or as a draft, in any package): the app's label, for
  // the dialog's sentence. Create app is offered only to a package with no app,
  // so the holder is never one this package can open instead.
  const [appTaken, setAppTaken] = React.useState<{ name: string; label: string } | null>(null);
  // Scaffold the new app's navigation from the package's objects (default on) —
  // otherwise a fresh app has zero menu items and every object must be wired by
  // hand in the app's design mode (objectui#2262).
  const [appAddObjects, setAppAddObjects] = React.useState(true);

  const loadPackageObjects = React.useCallback(async (): Promise<AppNavSeed[]> => {
    // Published objects + pending DRAFT objects, merged — a fresh package's
    // objects are usually still drafts (same merge the Data pillar rail does).
    // Names only (objectui#11201): a seeded entry carries no label, so nothing
    // here reads one. This used to hand `buildAppSkeleton` each object's label,
    // and a draft's or unlabelled object's machine name in its place.
    // The package-less scope creates no app (objectui#11553): nothing to seed.
    if (packageId === null) return [];
    const [list, draftHeaders] = await Promise.all([
      shellClient.list('object', { packageId }) as Promise<Array<Record<string, unknown>>>,
      shellClient.listDrafts({ packageId, type: 'object' }).catch(() => [] as Array<{ name?: string }>),
    ]);
    const items: AppNavSeed[] = (list || [])
      .map((o) => ({ name: String(o.name ?? '') }))
      .filter((o) => o.name);
    const known = new Set(items.map((o) => o.name));
    for (const d of draftHeaders) {
      if (d.name && !known.has(d.name)) items.push({ name: d.name });
    }
    return items;
  }, [shellClient, packageId]);

  const doCreateApp = React.useCallback(
    async (label: string, name: string) => {
      // The package-less scope offers no Create app (objectui#11553).
      if (packageId === null) return;
      setAppBusy(true);
      setAppErr(null);
      setAppTaken(null);
      try {
        // A name an app already holds, published or as a draft, in any
        // package, is refused here and nothing is written: over a published
        // app the first-write pin below would write this skeleton as its
        // pending draft (`findTakenIdentifier`).
        const taken = await findTakenIdentifier(shellClient, 'app', name, locale);
        if (taken) {
          setAppTaken(taken);
          return;
        }
        const navObjects = appAddObjects ? await loadPackageObjects().catch(() => []) : [];
        // objectui#11773 — and the door refuses a draft row too (the
        // first-write pin), for one that lands between the check above and
        // this save.
        await shellClient.save(
          'app',
          name,
          buildAppSkeleton(name, label, navObjects),
          { mode: 'draft', packageId, ifNoneMatch: '*', surface: 'studio' },
        );
        toast.success(tFormat('engine.studio.app.savedDraft', locale, { label }));
        setAppDraftPending(label);
        setAppCreating(false);
        onDraftSaved();
        // objectstack#36502 — the author stays on the pillar they were on: the
        // app is designed in the running app once the package is published,
        // which the header's pending chip says.
      } catch (e) {
        setAppErr(formatMetadataError(e));
      } finally {
        setAppBusy(false);
      }
    },
    [appAddObjects, loadPackageObjects, shellClient, packageId, locale, onDraftSaved],
  );

  // objectui#5800, fixed in passing — the topbar's app detection used to
  // disagree with the Interfaces pillar's (published-only read, no draftNonce
  // dep, no refresh subscription, and never re-run on a pillar switch since
  // /data and /access share one route element): a deep-link to /access could
  // report "This package has no app yet." while /data showed the app at the
  // same moment. Same resolution as the pillar now: published first, DRAFT app
  // fallback, re-resolved on draft saves and on the metadata-refresh pulse.
  const resolvePackageApp = React.useCallback(async (): Promise<void> => {
    // objectui#11553 — no package, so no package app to resolve.
    if (packageId === null) {
      setPackageApp(null);
      setPackageAppObjectOrder([]);
      setPublishedApps([]);
      return;
    }
    try {
      const apps = (await shellClient.list('app', { packageId })) as Array<Record<string, unknown>>;
      setPackageAppObjectOrder(navigationObjectOrder((apps || []).find((a) => a?.name)?.navigation));
      setPublishedApps(
        (apps || [])
          .filter((a) => a?.name)
          .map((a) => ({ name: String(a.name), label: (a.label ?? a.name) as I18nLabel })),
      );
      let first = (apps || [])
        .map((a) => ({
          name: String(a.name ?? ''),
          label: (a.label ?? a.name ?? '') as I18nLabel,
          // objectui#12459 — the chip in the shell header draws the app's own
          // tile (icon on its brand color), as Home's app tile and the app
          // switcher do through `AppMark`.
          icon: typeof a.icon === 'string' ? a.icon : undefined,
          branding: a.branding && typeof a.branding === 'object' ? (a.branding as AppMarkApp['branding']) : undefined,
        }))
        .filter((a) => a.name)[0];
      if (!first) {
        const drafts = await shellClient.listDrafts?.({ packageId, type: 'app' });
        const d = drafts?.[0] as { name?: unknown; label?: I18nLabel } | undefined;
        if (d?.name) first = { name: String(d.name), label: d.label ?? String(d.name), icon: undefined, branding: undefined };
      }
      setPackageApp(first ?? null);
    } catch {
      setPackageApp(null);
      setPackageAppObjectOrder([]);
      setPublishedApps([]);
    }
  }, [shellClient, packageId]);
  React.useEffect(() => {
    void resolvePackageApp();
    return subscribeMetadataRefresh(() => {
      void resolvePackageApp();
    });
  }, [resolvePackageApp, publishNonce, draftNonce]);

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
   * author in front of it:
   *
   *  - ANOTHER pillar's surface still travels through the URL, because that
   *    pillar is unmounted and its mount-time capture is the mechanism built
   *    for exactly this. Vetoed (`false`) when the author declines to abandon
   *    unsaved edits, so a request never outlives the navigation it needed.
   *  - THIS pillar's surface is the case the capture cannot serve at all —
   *    nothing remounts — so the channel carries it and the pillar applies it
   *    once.
   *
   * Either way the sheet closes: a selection nobody can see is not navigation.
   */
  const requestSurface = React.useCallback(
    (target: SurfaceTarget): boolean | void => {
      const pillar = PILLAR_FOR_SURFACE_TYPE[target.type];
      // objectui#11553 — the package-less scope has one pillar; a surface
      // owned by another is not in this scope, so nothing to navigate to.
      const reachable = !allScope && (packageId !== null || pillar === STUDIO_ORG_SCOPE_PILLAR);
      if (pillar && pillar !== tab && reachable) {
        if (!confirmLeavePillar()) return false;
        shellNavigate(studioPillarItemAddress(scopeSegment, pillar, target, { segmentEncoding: 'verbatim' }));
      }
      setChangesOpen(false);
    },
    [tab, allScope, packageId, scopeSegment, confirmLeavePillar, shellNavigate],
  );
  // objectstack#36899 — a menu entry that re-enters the open pillar on another
  // `?surface=` (the default sharing overview, on the Access pillar) opens the
  // pillar afresh, as arriving from any other page does: a pillar reads its
  // deep link once, at mount (`useSurfaceDeepLink`). The shell's link guard
  // lets a link to the page already shown through, so this asks first. The
  // remount waits for the new query to be the router's: the router may apply
  // a navigation in a later render than the click's own state updates, and a
  // pillar remounted before it would capture the old deep link.
  // objectstack#36900 — it waits for the query it was asked for, not for the
  // next query change: the command palette closes itself (its `?palette=`
  // goes) before the pick navigates, and that first change must not remount
  // the pillar on the old deep link.
  const [pillarEntry, setPillarEntry] = React.useState(0);
  const reentryPending = React.useRef<string | null>(null);
  const currentSearch = useLocation().search;
  const reenterPillar = React.useCallback(
    (search: string): boolean => {
      if (!confirmLeavePillar()) return false;
      reentryPending.current = search;
      return true;
    },
    [confirmLeavePillar],
  );
  React.useLayoutEffect(() => {
    const expected = reentryPending.current;
    if (expected === null || !studioSamePageSearch(currentSearch, expected)) return;
    reentryPending.current = null;
    setPillarEntry((n) => n + 1);
  }, [currentSearch]);
  // objectstack#26708 — a package that is not there has no menu.
  const showMenu = !pkgMissing;

  // objectstack#36900 — ⌘K on every design page (decision 7 of #36890: an
  // author switches items by ×, by ‹ › and by ⌘K). The palette lists this
  // scope's menu, and on a package its items (`StudioPaletteGroups`); a pick
  // leaves the way a menu entry does: it asks about unsaved work, and an
  // address that is the page already open on another query re-enters the
  // page, which reads its deep link once, at mount. The palette's own
  // `?palette=` is not part of the page's query. A package that is not there
  // has no menu, so its palette is the landing's.
  const currentPathname = useLocation().pathname;
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

  const publishButton = (
    <button
      type="button"
      // Publish is review-then-confirm: open the pending-changes panel,
      // whose footer button fires the actual atomic package publish —
      // never straight from this header click (objectui#2261). It opens the
      // panel in its confirm posture (objectui#12517).
      onClick={() => {
        setChangesPosture('confirm');
        setChangesOpen(true);
      }}
      disabled={publishing || publishReadOnly}
      aria-describedby={publishDisabledReason?.id}
      // A disabled Publish's reason is its wrapper's (objectui#12303,
      // objectstack#31495), never a `title` the disabled button cannot show.
      title={publishReadOnly ? undefined : t('engine.studio.publishTitle', locale)}
      // objectui#8219 — the primary style is for a publish the author
      // CAN do. A disabled one (no draft, or a read-only package)
      // drops to an outline, instead of staying the loudest element
      // on the page dimmed only by `disabled:opacity-50`.
      className={cn(
        // The border is on both states so the swap never shifts the bar.
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium',
        // objectstack#36511 — beside the top bar's Save, Save is the primary action.
        publishing || (!publishReadOnly && !saveBar.dirty)
          ? 'border-transparent bg-primary text-primary-foreground disabled:opacity-50'
          : 'text-muted-foreground',
        // The wrapper takes the hover: the disabled button lets it through.
        publishDisabledReason && 'disabled:pointer-events-none',
      )}
    >
      {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
      {t('engine.studio.publish', locale)}
    </button>
  );

  const page = (
    <StudioMenuDataProvider segment={scopeSegment}>
    <SurfaceDeepLinkProvider onRequest={requestSurface}>
      <StudioSaveProvider value={saveBar.registry}>
      <StudioRightSlotContext.Provider value={slotHandle}>
      {/* objectstack#36899 — the left menu's provider is the frame: the app
          sidebar's, under Studio's own collapse cookie (`StudioMenu.tsx`). */}
      <StudioMenuProvider className="h-screen min-h-0 overflow-hidden bg-background text-foreground">
        {/* The ADR-0080 `aiSlot` seam — a cloud edition may still inject its own
          * left copilot panel; the built-in copilot is the RIGHT dock below. */}
        {/* objectstack#32615 — not beside a package that is not there. */}
        {aiSlot && !pkgMissing ? (
          <aside className="w-64 shrink-0 overflow-auto border-r bg-muted/40">{aiSlot}</aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className={STUDIO_HEADER} data-testid="studio-shell-header">
            {/* objectui#12459 — the way back to the app at the left, the
                package actions at the right. objectstack#36899 — the pillars
                that sat between them are gone: the left menu is Studio's one
                navigation, and its show / hide control leads the bar. Changes
                and Publish stay at the right end, beside Cancel and Save. */}
            <div className={cn('flex min-w-0 items-center gap-1', STUDIO_HEADER_PACKAGE_COLUMN)}>
              {showMenu && <StudioMenuTrigger locale={locale} />}
              {/* objectstack#36501 — 「‹ Back to app」, the app's name and the
                  Studio mark: Studio's one way out. objectstack#36899
                  (decision 5) — it names the CURRENT package's app; with none,
                  the package, or the scope on `~org` and `~all`. */}
              <StudioBackToApp
                packageId={packageId}
                packageLabel={
                  packageId !== null
                    ? pkgEntry?.id === packageId
                      ? pkgEntry.name
                      : null
                    : t(allScope ? 'engine.studio.menu.environment' : 'engine.studio.menu.orgFlows', locale)
                }
                apps={publishedApps}
                locale={locale}
                beforeNavigate={confirmLeavePillar}
                navigate={shellNavigate}
              />
            </div>

            {/* Package-level draft review + one atomic publish (replaces per-item Publish) */}
            <div className="flex min-w-0 items-center justify-end gap-2">
              {/* objectstack#26708 — nothing to create, review or publish in a
                  package that is not there, nor on the cross-package leg. */}
              {!pkgMissing && !allScope && (<>
              {/* objectui#11553 — the package-less scope has no app to create. */}
              {packageId === null || packageApp ? null : appDraftPending ? (
                <span
                  title={t('engine.studio.app.willOpenAfterPublish', locale)}
                  className="rounded bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-300"
                >
                  {tFormat('engine.studio.app.pending', locale, { label: appDraftPending })}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setAppCreating(true)}
                  disabled={readOnly}
                  title={readOnly ? t('engine.studio.pkg.readonlyHint', locale) : t('engine.studio.app.noneTitle', locale)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className={STUDIO_HEADER_WIDE_WORD}>{t('engine.studio.app.create', locale)}</span>
                </button>
              )}
              {/* objectstack#36511 — Changes and Publish are for drafts, which
                  the copilot and the editors still on drafts (the Interfaces
                  pillar, the Metadata area) leave: drawn only while one is
                  pending, at the left of Cancel and Save. */}
              {hasPending && (
                <>
                {/* objectui#12459 — the pending count is a pill, not "· N" text. */}
                <button
                  type="button"
                  onClick={() => {
                    setChangesPosture('review');
                    setChangesOpen(true);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] text-foreground hover:bg-muted"
                >
                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                  {t('engine.studio.changes', locale)}
                  <span className="sr-only"> · </span>
                  <span
                    data-testid="studio-changes-count"
                    className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                  >
                    {shownPendingCount}
                  </span>
                </button>
                {/* A disabled Publish says why, to the mouse, the keyboard and
                    assistive tech alike — the record page's Archive pattern
                    (`DeclaredActionsBar`, objectui#11811), for the reason it
                    can be off: a read-only package (objectui#12303). A natively
                    disabled button fires no hover or focus, so the wrapping span
                    is the tooltip trigger and a tab stop, and the button and the
                    span both point `aria-describedby` at an `sr-only` copy of
                    the reason. objectstack#28562 — a read-only base with a
                    customization package publishes that package's drafts, so it
                    is not read-only here. */}
                {publishDisabledReason ? (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          aria-describedby={publishDisabledReason.id}
                          data-disabled-reason=""
                          className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {publishButton}
                          <span
                            id={publishDisabledReason.id}
                            className="sr-only"
                            data-testid={publishDisabledReason.testId}
                          >
                            {publishDisabledReason.text}
                          </span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{publishDisabledReason.text}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  publishButton
                )}
                </>
              )}
              {/* objectstack#36511 — the page's Cancel and Save, where Publish
                  was: drawn only while the open page holds unsaved edits. */}
              <StudioSaveControls coordinator={saveBar} locale={locale} />
              </>)}
              {/* objectui#12725 — the top bar's right-most icon shows or hides
                  the right slot; `⌘.` switches what it shows.
                  objectstack#34725 — with a copilot served, that icon is the
                  console top bar's robot (the same component, in the same
                  place), and it opens the slot on the AI assistant. Without
                  one, the panel icon stays for the properties. */}
              {slotHost && slotHasContent && copilotAvailable && (
                <>
                  <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
                  <ChatDockControlProvider value={slotRobotControl}>
                    <AssistantTopBarButton />
                  </ChatDockControlProvider>
                </>
              )}
              {slotHost && slotHasContent && !copilotAvailable && (
                <>
                  <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
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
                </>
              )}
            </div>
          </header>

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
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {showMenu && <StudioMenu segment={scopeSegment} locale={locale} onReenterPillar={reenterPillar} />}
          <div
            className={cn('min-h-0 min-w-0 flex-1', STUDIO_PILLARS_HOST)}
            data-testid="studio-pillars-host"
            data-studio-slot={slotHost && slotOpen && slotHasContent && !isMobile ? 'open' : 'closed'}
          >
            {/* objectui#12725 — the pillars' item headers read the ledger the
                badge counts (`studioItemDraftStatus.ts`). */}
            <StudioPendingDraftsContext.Provider value={pillarPendingDrafts}>
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
              tab === STUDIO_ORG_SCOPE_PILLAR ? (
                <AutomationsPillar
                  key={`${scopeSegment}:${pillarEntry}`}
                  packageId={null}
                  publishNonce={publishNonce}
                  onDraftSaved={onDraftSaved}
                  readOnly={readOnly}
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
                onSurfaceLabelChange={setSurfaceLabel}
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
            ) : !pillarKnown ? (
              <StudioEmptyState
                icon={FileQuestion}
                testId="studio-pillar-not-found"
                sentence={tFormat('engine.studio.notFound.pillar', locale, { pillar: tab })}
              />
            ) : tab === 'data' ? (
              <DataPillar
                key={`${packageId}:${pillarEntry}`}
                packageId={packageId}
                publishNonce={publishNonce}
                onDraftSaved={onDraftSaved}
                readOnly={readOnly}
                customization={customization}
                onHeldEditChange={setHeldEdit}
                onSurfaceLabelChange={setSurfaceLabel}
                onReviewChanges={() => {
                  setChangesPosture('review');
                  setChangesOpen(true);
                }}
              />
            ) : tab === 'automations' ? (
              <AutomationsPillar
                key={`${packageId}:${pillarEntry}`}
                packageId={packageId}
                objectOrder={packageAppObjectOrder}
                publishNonce={publishNonce}
                onDraftSaved={onDraftSaved}
                readOnly={readOnly}
                customization={customization}
                onHeldEditChange={setHeldEdit}
                onSurfaceLabelChange={setSurfaceLabel}
              />
            ) : (
              // objectstack#36905 — the Access pillar draws no page: a set opens
              // at its metadata address (a set the base's pair adds at the
              // pair's), the sharing overview on its own route, and the bare
              // pillar on the list of sets.
              <AccessPillarLanding
                key={`${packageId}${currentSearch}`}
                packageId={packageId}
                search={currentSearch}
                state={landingState}
              />
            )}
            </StudioPendingDraftsContext.Provider>
          </div>
          </div>
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
          posture={changesPosture}
          renderEntryNote={renderPublishRefusal}
          // ADR-0146 D3 — reviewing the pair's drafts, the sheet names the
          // base they are saved for.
          customizationOf={pairId !== null ? baseLabel : undefined}
        />

        <CreateItemDialog
          open={appCreating}
          onOpenChange={(open) => {
            setAppCreating(open);
            if (!open) setAppTaken(null);
          }}
          title={t('engine.studio.app.create', locale)}
          labelFieldLabel={t('engine.studio.app.nameLabel', locale)}
          labelPlaceholder={t('engine.studio.app.namePlaceholder', locale)}
          idFieldLabel={t('engine.studio.app.idLabel', locale)}
          idPlaceholder={t('engine.studio.app.idPlaceholder', locale)}
          submitLabel={t('engine.studio.createDraft', locale)}
          submittingLabel={t('engine.studio.creating', locale)}
          busy={appBusy}
          error={appErr}
          locale={locale}
          onSubmit={({ label, name }) => void doCreateApp(label, name)}
          extra={
            <>
              {appTaken && (
                <CreateTakenNotice
                  scope="app"
                  sentence={tFormat('engine.studio.app.createTaken', locale, { label: appTaken.label, name: appTaken.name })}
                />
              )}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={appAddObjects}
                  onChange={(e) => setAppAddObjects(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {t('engine.studio.app.scaffoldNav', locale)}
              </label>
            </>
          }
        />
      </StudioMenuProvider>
      {/* objectstack#36900 — the command palette, in its `studio` scope, with this page's groups. */}
      {!paletteHosted && <CommandPalette scope="studio" surface={paletteSurface} />}
      </StudioRightSlotContext.Provider>
      </StudioSaveProvider>
    </SurfaceDeepLinkProvider>
    </StudioMenuDataProvider>
  );
  return paletteHosted ? page : <CommandPaletteProvider>{page}</CommandPaletteProvider>;
}

// objectstack#29988 — the Automations rail's flow helpers moved to their own module; re-exported for their pins.
export { FlowStatusDot, type NewFlowTrigger };

// objectstack#36893 — the Automations pillar moved to its own module; re-exported for its pins.
// objectstack#36905 — the Access pillar is gone: its addresses redirect (`accessPillarRedirect.ts`).
export { AutomationsPillar };

// objectstack#36893 — the Data pillar moved to its own module; re-exported for its pins.
export { DataPillar, renderStudioGridList };

export default StudioDesignSurface;
