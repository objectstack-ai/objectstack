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
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams, useLocation, Link, Navigate } from 'react-router-dom';
import { useAdapter, SchemaRendererProvider } from '@object-ui/react';
import { leadWithNameField } from '@object-ui/core';
// The ONE draft-envelope reader (objectui#8181): unwrap AND strip the
// framework's read decorations in one place. This file used to carry its own
// copy that did the unwrap and skipped the strip.
// …and `formatMetadataError`, the one metadata-save error reader (objectui#11302).
// …and `dropServedPicklistOptions`, the served -> authored conversion of a
// picklist-bound field (objectui#10202), moved here by objectui#11692.
import {
  dropServedPicklistOptions,
  extractDraftBody,
  formatMetadataError,
  readDraftChanges,
  type DraftChange,
} from '@object-ui/data-objectstack';
import type { MetadataClient, MetadataError } from '@object-ui/data-objectstack';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { customizationNamespace } from '@objectstack/spec/kernel';
import { StudioChatDock, type StudioCopilotStatus, type StudioSurfaceLabel } from './StudioAiCopilot.js';
import { StudioRightSlot } from './StudioRightSlot.js';
import { AssistantTopBarButton } from '../../layout/AssistantTopBarButton.js';
import { ChatDockControlProvider, type ChatDockControl } from '../../layout/chatDockControl.js';
import {
  StudioRightSlotContext,
  matchStudioSlotShortcut,
  useStudioRightSlot,
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
  STUDIO_HEADER_PILLAR_NAME,
  STUDIO_HEADER_WIDE_WORD,
  STUDIO_HEADER_PILLAR,
  STUDIO_HEADER_PILLAR_NAV,
  STUDIO_PILLARS_HOST,
} from './studio-tokens.js';
import { StudioInspector } from './StudioInspector.js';
import { agentDraftMarkOf, DraftChip, DraftSourceLine, isAgentDraftSurface } from './StudioDraftMark.js';
import {
  StudioItemHeader,
  StudioTab,
} from './StudioItemHeader.js';
import { StudioItemTools } from '../item-tools/StudioItemTools.js';
import {
  StudioPendingDraftsContext,
  useStudioItemDraftStatus,
  type StudioPendingDrafts,
} from './studioItemDraftStatus.js';
import { DATA_CONTENT_CONTAINER, DATA_TAB_FLAT_ONLY, DATA_TAB_FOLDED_ONLY } from './dataTabsFold.js';
import { RECORDS_SCROLLBAR_VISIBLE, revealColumn } from './recordsGridChrome.js';
import { StudioRail, StudioRailRow } from './StudioRail.js';
import { StudioEmptyState } from './StudioEmptyState.js';
import {
  navigationObjectOrder,
} from './flowGrouping.js';
import { StudioRefusalStrip } from './StudioRefusalStrip.js';
import { StudioPicker } from './StudioPicker.js';
import { PACKAGE_LIST_TOAST_ID, STUDIO_LANDING_PATH } from './PackageSwitcher.js';
import { StudioBackToApp, type StudioAppTarget } from './StudioBackToApp.js';
import { addNewObjectToAppMenu } from './newObjectJoinsAppMenu.js';
import {
  FlowStatusDot,
  type NewFlowTrigger,
  pairIdOf,
} from './AutomationsFlowRail.js';
import {
  addedExtensionFieldName,
  addedFieldName,
  type CelPanelTab,
  extensionFieldsOf,
  fieldCelStamp,
  formFieldNames,
  formPreviewSource,
  isCelPanelTab,
  OWD_OPTION_DESC_KEY,
  OWD_OPTION_LABEL_KEY,
  panelItemCelStamp,
  panelItemOf,
  STUDIO_SYSTEM_FIELD_NAMES,
} from './DataPillarHelpers.js';
import {
  confirmDropUnsavedWork,
  CreateTakenNotice,
  findTakenIdentifier,
  type StudioBaseCustomization,
  StudioHeldNotice,
  StudioReadOnlyLink,
  type StudioSavedDraft,
  useHeldEditReport,
  useShowInputFocus,
} from './StudioPillarKit.js';
import { AutomationsPillar } from './AutomationsPillar.js';
import { AccessPillar } from './AccessPillar.js';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  GridFieldAuthoringProvider,
  cn,
  useIsMobile,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  ObjectIconTile,
} from '@object-ui/components';
import { ObjectView as PluginObjectView } from '@object-ui/plugin-view';
import { ListView } from '@object-ui/plugin-list';
import { ObjectForm } from '@object-ui/plugin-form';
import {
  Ban,
  Database,
  Workflow,
  Loader2,
  Plus,
  GitBranch,
  Rocket,
  ChevronDown,
  Shield,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  FileQuestion,
  PackageX,
  Library,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import {
  type MetadataSelection,
} from '../metadata-admin/preview-registry.js';
import {
  useRegisteredMetadataInspector,
} from '../metadata-admin/inspector-registry.js';
import type { FormViewSpec } from '../metadata-admin/form-spec.js';
import { useMetadataClient, useMetadataTypes } from '../metadata-admin/useMetadata.js';
// objectui#11773 — every draft save of an existing item sends the version its buffer was built on.
import { publishedPinOf, isPublishConflictKeptEditing, readDraftForSave, useDraftSaveGuard } from '../metadata-admin/DraftConflictDialog.js';
import {
  authoredObjectBuffer,
  authoredPublishedObject,
  servedOnlyFields,
  type ObjectLayers,
} from '../metadata-admin/authoredObjectBuffer.js';
// objectstack#26858 — the served verdict a flow's inspectors read at their own paths.
import {
  DraftVerdictBodyContext,
  DraftVerdictContext,
  draftEnvelopeDiagnostics,
  editedItemDiagnostics,
  type ServerDiagnostics,
} from '../metadata-admin/draftVerdict.js';
import {
  DESIGNER_SURFACE_PARAM,
  formatSurfaceParam,
} from '../metadata-admin/nav-selection.js';
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
  publishSavedItem,
  STUDIO_SAVE_TOAST_ID,
  StudioSaveControls,
  StudioSaveProvider,
  useStudioSaveCoordinator,
  useStudioSaveEntry,
  type StudioSaveResult,
} from './studioSaveBar.js';
import { irreversibleFieldChanges } from './objectSaveConfirm.js';
import {
  BATCH_ABORTED_CODE,
  causalPublishFailures,
  destructiveFindings,
  objectHeldEdit,
  objectSaveRefusal,
  plainRefusal,
  publishFailureOf,
  publishRefusal,
  type PublishFailure,
  type StudioHeld,
  type StudioRefusal,
} from './metadataError.js';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';
import {
  STUDIO_ORG_SCOPE_PILLAR,
  isOrgScopeDraft,
  isStudioOrgScope,
  studioOrgScopePath,
} from './studioScope.js';
import { STUDIO_METADATA_AREA, studioMetadataAreaPath } from './metadataArea.js';
import { StudioMetadataArea } from './StudioMetadataArea.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
import { type Surface } from './navSurface.js';
import {
  useSurfaceDeepLink,
  useSurfaceActionDeepLink,
  resolveSurfaceDeepLink,
  type SurfaceTarget,
} from './useSurfaceDeepLink.js';
import { SurfaceDeepLinkProvider, useRequestedSurface } from './surfaceDeepLinkChannel.js';
import { buildObjectSkeleton, buildAppSkeleton, type AppNavSeed } from './skeletons.js';
import { OWD_CREATE_MODELS, OWD_DEFAULT, type OwdCreateModel } from './owd-sharing.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { useRegisterUnsavedEdits } from '../../chrome/unsavedEdits.js';
import { InspectorShellHostProvider } from '../metadata-admin/inspectors/_shared.js';
import type { DestructiveChangeIssue } from '@objectstack/spec/api';
import {
  navItemLabelText,
} from '../metadata-admin/previews/navItemLabel.js';
import {
  readFields,
  writeFields,
  newField,
  type FieldEntry,
} from '../metadata-admin/previews/object-fields-io.js';
import type { FieldTypeId } from '../metadata-admin/previews/field-types.js';
import {
  ExternalObjectNotice,
  readExternalBinding,
  useExternalWriteState,
} from '../metadata-admin/previews/external-object.js';
import { CreateItemDialog } from './CreateItemDialog.js';
import { AddFieldPopover } from './AddFieldPopover.js';
import { StudioGridAddFieldButton, StudioGridAddFieldProvider, type StudioGridAddFieldValue } from './StudioGridAddField.js';
// objectui#11787 — the shared draft autosave, moved to its own module unchanged.
import { FormToolbar, ObjectFormDesigner } from './ObjectFormDesigner.js';
import { isStudioHiddenSystemField } from './studioHiddenSystemField.js';
import { ObjectGroupInspector } from './ObjectGroupInspector.js';
import { ObjectValidationsPanel } from './ObjectValidationsPanel.js';
import { ObjectSettingsPanel } from './ObjectSettingsPanel.js';
import { ObjectApiPanel } from './ObjectApiPanel.js';
import { ObjectHooksPanel } from './ObjectHooksPanel.js';
import { useObjectHooksBuffer } from './objectHooksBuffer.js';
import { usePairObjectActions, type PairActionsDoor } from './pairObjectActions.js';
import { ObjectActionsPanel } from './ObjectActionsPanel.js';
import { getIcon } from '../../utils/getIcon.js';
import {
  ensureCustomizationPackage,
  fetchListedPackageIds,
  fetchListedPackageManifests,
  fetchPackages,
  listedCustomizationPairOf,
  listedPackageEntry,
  listedPackageVersion,
  prefixObjectName,
  type EnsuredCustomizationPackage,
  type PkgEntry,
} from './packages-io.js';
import { usePackageCustomizations } from './CustomizationMark.js';
import {
  RailCustomizationFilter,
  RailCustomizationMark,
  StudioPairItemChip,
  contributedItemTitle,
  customizationPairBaseOf,
  railCustomizationsOf,
  useDeepLinkFallback,
  useRailCustomizationsOnly,
  withPairItems,
} from './StudioRailCustomizations.js';
import {
  baseContributionsOf,
  contributedFieldsOf,
} from './contributionRows.js';
import {
  useCustomizeDoorWalled,
  OBJECT_EXTENSION_TYPE,
  baseOwnedFieldNames,
  extensionFieldName,
  extensionBodyForSave,
  extensionFieldNames,
  foldObjectExtension,
  objectExtensionBodyOf,
  routeFoldedFieldsEdit,
  type ObjectExtensionBody,
  BaseFieldDisplayPatchContext,
} from './StudioCustomizeControls.js';
import {
  DraftChangesPanel,
  type DraftChangeEntry,
  type DraftChangesPosture,
  type DraftPublishOptions,
} from '../../preview/DraftChangesPanel.js';
import { SavedToCustomizationNote } from '../../preview/savedToCustomization.js';
import { toast } from 'sonner';

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

// objectui#12452 — Access is a segment of its own, and the "More" overflow that
// held it alone (objectui#5813) is retired. If a second overflow pillar is ever
// added, More returns with the objectui#11794 behaviour: its trigger keeps the
// name More whichever of its pillars is open.
// objectstack#36502 — the Interfaces pillar is retired: interfaces are designed
// in the running app's design mode (`studioInterfacesRetired.tsx`). Data, the
// first segment, is the Studio home.
const PILLARS: ReadonlyArray<{ key: string; label: string; Icon: LucideIcon }> = [
  { key: STUDIO_HOME_PILLAR, label: 'Data', Icon: Database },
  { key: 'automations', label: 'Automations', Icon: Workflow },
  { key: 'access', label: 'Access', Icon: Shield },
];
/**
 * objectstack ADR-0146 D1 (#28561) — the "All metadata" area joins the four
 * pillars in the header: a package's type directory, lists, generic item page,
 * history and diagnostics (`StudioMetadataArea`). Not a pillar: it designs no
 * type of its own, and its URLs are the area's (`/studio/<package>/metadata/…`,
 * `metadataArea.ts`), so `PILLARS` and the not-found check do not hold it.
 */
const METADATA_AREA_TAB: { key: string; label: string; Icon: LucideIcon } = {
  key: STUDIO_METADATA_AREA,
  label: 'All metadata',
  Icon: Library,
};
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
    return <Navigate to={`/studio/${encodeURIComponent(pairBase)}/${tab}${location.search}`} state={location.state} replace />;
  }
  return <StudioDesignSurfaceBody {...props} />;
}

function StudioDesignSurfaceBody({ aiSlot, area }: StudioDesignSurfaceProps): React.ReactElement {
  const params = useParams<{ packageId?: string; tab?: string }>();
  // The route segment: a package id, or the package-less scope's reserved
  // segment (objectui#11553, `studioScope.ts`). URLs are built from it.
  const scopeSegment = params.packageId ?? 'com.example.showcase';
  // `null` in the package-less scope. Every package-scoped read, write and
  // publish below keys on this value, so none of them can be handed the
  // reserved segment as though it named a package.
  const packageId: string | null = isStudioOrgScope(scopeSegment) ? null : scopeSegment;
  const tab = area ?? params.tab ?? STUDIO_HOME_PILLAR;
  // objectstack#26708 — a segment no pillar has is a not-found state, never
  // a pillar it falls through to.
  const pillarKnown = PILLARS.some((p) => p.key === tab);
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
  const confirmLeavePillar = React.useCallback(
    () => confirmDropUnsavedWork(unsavedPillarWork, locale),
    [unsavedPillarWork, locale],
  );
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
  React.useEffect(() => {
    openAccessRef.current = () => {
      if (confirmLeavePillar()) shellNavigate(`/studio/${scopeSegment}/access`);
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
      const reachable = packageId !== null || pillar === STUDIO_ORG_SCOPE_PILLAR;
      if (pillar && pillar !== tab && reachable) {
        if (!confirmLeavePillar()) return false;
        shellNavigate(
          `/studio/${scopeSegment}/${pillar}?${DESIGNER_SURFACE_PARAM}=${encodeURIComponent(formatSurfaceParam(target))}`,
        );
      }
      setChangesOpen(false);
    },
    [tab, packageId, scopeSegment, confirmLeavePillar, shellNavigate],
  );

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

  return (
    <SurfaceDeepLinkProvider onRequest={requestSurface}>
      <StudioSaveProvider value={saveBar.registry}>
      <StudioRightSlotContext.Provider value={slotHandle}>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        {/* The ADR-0080 `aiSlot` seam — a cloud edition may still inject its own
          * left copilot panel; the built-in copilot is the RIGHT dock below. */}
        {/* objectstack#32615 — not beside a package that is not there. */}
        {aiSlot && !pkgMissing ? (
          <aside className="w-64 shrink-0 overflow-auto border-r bg-muted/40">{aiSlot}</aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className={STUDIO_HEADER} data-testid="studio-shell-header">
            {/* objectui#12459 — three columns: the way back to the app at the
                left, the pillars centered, the package actions at the right.
                objectui#12509 — below `sm` the pillars take a second row of
                their own (`STUDIO_HEADER_PILLAR_NAV`), and on any row the
                app's name is the piece that gives way. */}
            <div className={cn('flex min-w-0 items-center gap-1', STUDIO_HEADER_PACKAGE_COLUMN)}>
              {/* objectstack#36501 — 「‹ Back to app」, the app's name and the
                  Studio mark: Studio's one way out, to the app page the author
                  came from. It replaced the Studio-home button, the package
                  switcher and the top-right Open app; a different package is
                  picked in the app, or on the Studio landing. */}
              <StudioBackToApp
                packageId={packageId}
                packageLabel={pkgEntry?.id === packageId ? pkgEntry.name : null}
                apps={publishedApps}
                locale={locale}
                beforeNavigate={confirmLeavePillar}
                navigate={shellNavigate}
              />
            </div>
            <nav className={STUDIO_HEADER_PILLAR_NAV} data-testid="studio-pillar-nav">
              {/* objectui#11553 — the package-less scope offers its one pillar. */}
              {/* objectstack#26708 — a package that is not there has no pillars. */}
              {/* objectstack#28561 — and a package has the "All metadata" area beside its pillars. */}
              {(packageId === null ? PILLARS.filter((p) => p.key === STUDIO_ORG_SCOPE_PILLAR) : pkgMissing ? [] : [...PILLARS, METADATA_AREA_TAB]).map((p) => (
                <Link
                  key={p.key}
                  to={p.key === STUDIO_METADATA_AREA ? studioMetadataAreaPath(scopeSegment) : `/studio/${scopeSegment}/${p.key}`}
                  aria-current={tab === p.key ? 'page' : undefined}
                  // No click handler of its own (objectui#13253): a dirty
                  // pillar is registered with the shell's seam, whose
                  // capture-phase link guard asks before this link leaves and
                  // skips what this handler used to skip (the open pillar's
                  // own URL, a modified or non-primary click). Asking here as
                  // well would be a second question after OK.
                  title={t(`engine.studio.pillar.${p.key}`, locale)}
                  className={
                    STUDIO_HEADER_PILLAR +
                    ' ' +
                    (tab === p.key
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  <p.Icon className={'h-3.5 w-3.5 ' + (tab === p.key ? 'text-primary' : '')} />
                  {/* objectui#12725 — named from 1024 px up; below that the
                      pillars read as icons, the name kept in the accessible
                      name and the tooltip. objectstack#28561 — the "All
                      metadata" area is named from 1280 px: the top bar's
                      1024 px row was sized for the four pillar names.
                      objectstack#34725 — both now answer the bar's own width
                      (see STUDIO_HEADER_PILLAR_NAME). */}
                  <span className={p.key === STUDIO_METADATA_AREA ? STUDIO_HEADER_WIDE_WORD : STUDIO_HEADER_PILLAR_NAME}>
                    {t(`engine.studio.pillar.${p.key}`, locale)}
                  </span>
                </Link>
              ))}
            </nav>

            {/* Package-level draft review + one atomic publish (replaces per-item Publish) */}
            <div className="flex min-w-0 items-center justify-end gap-2">
              {/* objectstack#26708 — nothing to create, review or publish in a
                  package that is not there. */}
              {!pkgMissing && (<>
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
          <div
            className={cn('min-h-0 flex-1', STUDIO_PILLARS_HOST)}
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
            {packageId === null ? (
              tab === STUDIO_ORG_SCOPE_PILLAR ? (
                <AutomationsPillar
                  key={scopeSegment}
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
                  <Button type="button" size="sm" variant="outline" onClick={() => shellNavigate(STUDIO_LANDING_PATH)}>
                    {t('engine.studio.landingHome', locale)}
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
              />
            ) : !pillarKnown ? (
              <StudioEmptyState
                icon={FileQuestion}
                testId="studio-pillar-not-found"
                sentence={tFormat('engine.studio.notFound.pillar', locale, { pillar: tab })}
              />
            ) : tab === 'data' ? (
              <DataPillar
                key={packageId}
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
                key={packageId}
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
              // objectstack#28573 — keyed by package like its siblings: "New
              // similar" opens the copy in ANOTHER package's Access pillar
              // (the base's `.custom`), and that route keeps this element
              // mounted. Unkeyed, the open set, the rail and the `?surface=`
              // capture stayed the base's.
              <AccessPillar
                key={packageId}
                packageId={packageId}
                publishNonce={publishNonce}
                onDraftSaved={onDraftSaved}
                readOnly={readOnly}
                customization={customization}
                onDirtyChange={setPillarDirty}
                onSurfaceLabelChange={setSurfaceLabel}
              />
            )}
            </StudioPendingDraftsContext.Provider>
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
      </div>
      </StudioRightSlotContext.Provider>
      </StudioSaveProvider>
    </SurfaceDeepLinkProvider>
  );
}

/**
 * Render the Data pillar's records grid using the SAME rich list surface as the
 * runtime list pages — the standard toolbar (view switcher, search, sort, filter,
 * group, hide-fields) plus Airtable-style inline data management. This is the
 * plugin ObjectView's `renderListView` slot, so the object-view still owns data
 * fetching while ListView owns the toolbar + grid. Defined at module scope (not
 * inline) so it stays a static component reference.
 *
 * Exported for tests (StudioDesignSurface.gridRefresh.test.tsx) — the refresh
 * channel this slot rides is a property of THIS function's schema forward, so
 * the test drives the real slot rather than a reconstruction of it. It is a
 * render-prop callback rather than a component, so Fast Refresh cannot treat it
 * as one; the export is scoped to that test and never reaches the package entry
 * (`index.ts` re-exports a named list, and `package.json` exports only `.`).
 */
// eslint-disable-next-line react-refresh/only-export-components -- see above
export function renderStudioGridList(props: {
  schema: Record<string, unknown>;
  dataSource: unknown;
  onEdit?: (record: Record<string, unknown>) => void;
  className?: string;
  onAddRecord?: () => void;
}): React.ReactElement {
  const { schema: listSchema, dataSource: ds, onEdit, className, onAddRecord } = props;
  return (
    <ListView
      schema={
        {
          // The spread carries the slot's `refreshTrigger` — the signal the
          // plugin ObjectView bumps after a mutation, and the ONE refresh input
          // ListView actually reads (it is in its fetch effect's dependency
          // array). Keep it: dropping or shadowing `refreshTrigger` here silently
          // severs the Data pillar's post-mutation refetch, and nothing looks
          // wrong afterwards because the grid re-renders constantly regardless.
          // The slot also passes a bare `refreshKey` carrying the same number;
          // that one is not a prop of ListView or of anything it renders, so the
          // forward was dead and objectui#4528 removed it (objectui#4549 measured
          // the channel and dropped the leftover parameter).
          ...listSchema,
          viewType: 'grid',
          // objectui#12450 — the Records toolbar the Data pillar's artboard
          // draws: Hide fields, Filter, Group and Sort as labelled buttons,
          // then Refresh, Search and Add record. That is the list's wide form
          // (`compactToolbar: false`, one button per control); the bundled
          // Display form the console's list pages default to (objectui#12423)
          // would fold Hide fields and Group away. Density is not offered: the
          // artboard has no density control. The toggles are spelled in
          // `userActions`, the protocol's home for them (the bare `show*`
          // spellings this used are retired tombstones, objectui#7924), and
          // the slot's own `userActions` — what a view declares — still wins.
          compactToolbar: false,
          userActions: {
            search: true,
            sort: true,
            filter: true,
            group: true,
            hideFields: true,
            rowHeight: false,
            ...(listSchema.userActions as Record<string, unknown> | undefined),
          },
          inlineEdit: true,
          addDeleteRecordsInline: true,
          // Fold "+ New" into this toolbar (next to Hide fields/Filter/Group/
          // Sort) instead of ObjectView's separate `showCreate` row above it —
          // that row was otherwise ~90% empty (nothing else populates its
          // left side in Studio) and just added a dead band before the grid.
          addRecord: { enabled: true },
        } as never
      }
      dataSource={ds as never}
      onEdit={onEdit}
      onAddRecord={onAddRecord}
      className={className}
      // objectstack#34794 — the Records tab's always-visible Add field, at the
      // start of this toolbar row; it draws only where the grid's "+" column
      // does (see `StudioGridAddFieldButton`).
      toolbarLeading={<StudioGridAddFieldButton />}
    />
  );
}

/** One object draft save: the address it writes, the buffer it was taken from, and the body sent. */
interface ObjDraftSend {
  name: string;
  packageId: string;
  draft: Record<string, unknown>;
  body: Record<string, unknown>;
}

// Exported for tests (StudioDesignSurface.emptyPackage.test.tsx) — the empty-
// package behavior (no forced creator modal, empty-state CTA) lives here.
export function DataPillar({
  packageId: railPackageId,
  publishNonce = 0,
  onDraftSaved,
  readOnly: packageReadOnly = false,
  customization = null,
  onHeldEditChange,
  onSurfaceLabelChange,
  onReviewChanges,
}: {
  packageId: string;
  publishNonce?: number;
  onDraftSaved?: (saved?: StudioSavedDraft) => void;
  /** objectstack#34725 — the open object's display label and tab, for the copilot's chip (see the Interfaces pillar's prop). */
  onSurfaceLabelChange?: (surface: StudioSurfaceLabel | null) => void;
  /** objectstack#34725 — the copilot-changes line's 查看: open the package's pending changes. */
  onReviewChanges?: () => void;
  /** Courtesy gate: hide/disable metadata-authoring affordances (records stay usable). */
  readOnly?: boolean;
  /** objectstack#28572 — on a read-only base, its pair: the rail lists the pair's objects too, and New lands there. */
  customization?: StudioBaseCustomization | null;
  /** objectui#11786 — the clause of the edit the autosave holds unsent, for the surface's Publish. */
  onHeldEditChange?: (clause: string | null) => void;
}): React.ReactElement {
  const client = useMetadataClient();
  const adapter = useAdapter();
  const locale = useMetadataLocale();
  // Live server JSONSchemas per metadata type (`/meta/types`) — handed to the
  // Actions/Hooks config panels so their forms are driven by the real metadata
  // contract (and stay forward-compatible when the server spec adds fields).
  const { entries: metaTypes } = useMetadataTypes(client);
  const typeSchemas = React.useMemo(() => {
    const idx: Record<string, Record<string, unknown> | undefined> = {};
    for (const e of metaTypes) idx[e.type] = e.schema;
    return idx;
  }, [metaTypes]);
  // objectstack#35650 — the served form layouts beside them, so a panel's
  // curated inspector draws a row the server declares a face for with it.
  const typeForms = React.useMemo(() => {
    const idx: Record<string, FormViewSpec | undefined> = {};
    for (const e of metaTypes) idx[e.type] = e.form;
    return idx;
  }, [metaTypes]);
  // Below the mobile breakpoint the Objects rail overlays the canvas instead
  // of a permanent 208px column (which otherwise squeezed the grid/form
  // canvas down to almost nothing on phones) — closed by default, toggled by
  // the header's Menu button.
  const isMobile = useIsMobile();
  const [railOpen, setRailOpen] = React.useState(false);
  const [objects, setObjects] = React.useState<Surface[]>([]);
  const [objectsLoaded, setObjectsLoaded] = React.useState(false);
  // objectstack#28572 — bumped after a New lands in the pair: the rail reads
  // again, after the save, so the new object is in the pair's list it reads.
  const [railNonce, setRailNonce] = React.useState(0);
  // objectui#7255 — the copilot dock shares this document; a turn that staged
  // or published metadata re-reads this rail in place. No hold is needed: the
  // rail load only replaces the LIST (the per-object edit buffer is loaded by
  // its own `loadedNameRef`-guarded effect and is never touched here).
  const metadataRefreshNonce = useMetadataRefreshNonce();
  const [current, setCurrent] = React.useState<Surface | null>(null);
  // objectstack#28572 (ADR-0146 D3) — one surface for a read-only base and its
  // pair. The rail is the base's (`railPackageId`); an object the pair adds
  // (`current.addedIn`) opens writable, read and saved at the pair, so every
  // read and write of the OPEN object below names `packageId` and asks
  // `readOnly`, the open object's own. The rail's reads, its New and its
  // namespace stay the base's.
  const packageId = current?.addedIn ?? railPackageId;
  const readOnly = packageReadOnly && !current?.addedIn;
  const railPairId = packageReadOnly && customization ? customization.pairId : null;
  const railMarks = railCustomizationsOf(customization?.marks, railPackageId);
  const [onlyCustomized, toggleOnlyCustomized] = useRailCustomizationsOnly();
  // New on a read-only base lands in its pair, through the ensure door.
  const newInPair = packageReadOnly && customization !== null && !customization.walled;
  // `?surface=object:<name>` capture + mirror — the app→Studio bridge
  // (ADR-0080, `appStudioObjectPath`) lands here with a specific object;
  // shared plumbing (see useSurfaceDeepLink).
  const initialSurface = useSurfaceDeepLink(current);
  // objectstack#28572 — see `useDeepLinkFallback`.
  const deepLinkUpgrade = useDeepLinkFallback();
  const currentRef = React.useRef(current);
  React.useLayoutEffect(() => {
    currentRef.current = current;
  });
  // The LIVE half of the same plumbing (see surfaceDeepLinkChannel): a
  // producer already inside this mounted pillar — the pending-changes sheet's
  // security block, naming the object the publish door would refuse — asks for
  // an object long after the capture ref above was read.
  //
  // Applied AT MOST ONCE, by id. A standing request re-resolved on every rail
  // reload (publish, package switch) would drag the author back off whatever
  // they had since selected, which is the regression the mount-time ref exists
  // to prevent — so the id is marked spent as soon as the loaded rail has been
  // consulted, whether or not it held a match.
  //
  // Applied below `objHeld`, which it asks about (objectstack#26845).
  const requestedSurface = useRequestedSurface();
  const appliedRequestRef = React.useRef(0);
  const [objDraft, setObjDraft] = React.useState<Record<string, unknown>>({});
  // objectstack#28575 (ADR-0146 D10) — a base object of a read-only base takes
  // fields as an extension in the base's pair, never in its own buffer: the
  // pair's `object_extension` of it (`extend` = the object), filed under the
  // object's name. The base object stays as shipped; `objDraft` holds it as
  // served (which already folds the pair's PUBLISHED extension), and what the
  // pillar shows is `shownDraft`, the two folded. `published` names the
  // fields the published extension declares, so one the draft drops is gone.
  const extendsBase = packageReadOnly && customization !== null && current !== null && !current.addedIn;
  const [ext, setExt] = React.useState<{
    for: string;
    body: ObjectExtensionBody;
    published: ReadonlySet<string>;
  } | null>(null);
  const [extDirty, setExtDirty] = React.useState(false);
  const [extHasDraft, setExtHasDraft] = React.useState(false);
  const [extReloadNonce, setExtReloadNonce] = React.useState(0);
  const extLoadedRef = React.useRef<string | null>(null);
  const extOpen = extendsBase && ext !== null && ext.for === current?.name ? ext : null;
  // Adding a field asks the ensure door for the pair once per base: its
  // answer names every write, ⛔ never a `<base>.custom` spelled here.
  const extWalled = customization?.walled === true;
  const extWritable = extOpen !== null && !extWalled;
  const shownDraft = React.useMemo(
    () => (extOpen ? foldObjectExtension(objDraft, extOpen.body, extOpen.published) : objDraft),
    [objDraft, extOpen],
  );
  // The served object's own fields: the ones a base-field patch addresses.
  const baseOwnedFields = React.useMemo(
    () => (extOpen ? baseOwnedFieldNames(objDraft, extOpen.body, extOpen.published) : null),
    [objDraft, extOpen],
  );
  // ADR-0015 — an external object's table belongs to the remote database: the
  // pillar offers no Add field on it (grid "+" column, Form toolbar) and says
  // where its fields come from. Rename / retype / duplicate / remove are gated
  // in the shared field inspector.
  const objExternal = readExternalBinding(objDraft);
  const objExternalWriteState = useExternalWriteState(objExternal);
  const objIsExternal = objExternal !== null;
  // objectui#11272 — the object `objDraft` was loaded for, `object:NAME`:
  // written where the load below installs it, and nowhere else.
  const [objDraftFor, setObjDraftFor] = React.useState('');
  // objectui#12725 — the per-key provenance the object's draft read served
  // (`draftChanges`), `null` when it recorded none or there is no draft. Read
  // by the field inspector's copilot marks; installed with `objDraft`.
  const [objDraftChanges, setObjDraftChanges] = React.useState<DraftChange[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  // objectui#11785 — a load failure as it was (`plainRefusal`), a refused save
  // as an author sentence naming the field, with the raw text behind Details.
  const [error, setError] = React.useState<StudioRefusal | null>(null);
  // field management — a selected field opens ObjectFieldInspector (full type + config)
  const [fieldSel, setFieldSel] = React.useState<MetadataSelection | null>(null);
  // objectui#12303 — the property rail's title, and the read-only reason its body is described by.
  const fieldRailTitleId = React.useId();
  const fieldRailReasonId = React.useId();
  // Blocking author-time issues the field inspector is showing — a CEL formula
  // that does not parse must not be saveable, let alone publishable as the live
  // field definition (objectui#4306).
  //
  // The report is STAMPED with the selection it came from: it is the open
  // inspector's live verdict, and never reads as another selection's.
  const [blockingReport, setBlockingReport] = React.useState({ key: '', count: 0 });
  const fieldSelKey = fieldSel ? `${current?.name ?? ''}:${fieldSel.kind}:${fieldSel.id}` : '';
  // objectstack#27485 — the verdict belongs to the draft, not to the selection.
  // Expiring it with the selection released the hold the moment the inspector
  // closed (Escape, Close, another field, another tab) while the broken text
  // stayed in the draft, and the autosave sent it. So each field's last live
  // verdict is kept with the stamp of what it judged (`fieldCelStamp`, taken
  // while the inspector is open on it) and holds, with the inspector closed,
  // while the draft still carries that stamp: an edit to the text, the field's
  // removal or the object's next load ends it. Nothing is left shut with
  // nothing to fix: the held line names the field and its "Show me" opens it,
  // and the open inspector's live verdict always wins.
  const [celVerdicts, setCelVerdicts] = React.useState<Record<string, { field: string; count: number; stamp: string | null }>>({});
  const liveFieldReport = fieldSel?.kind === 'field' && blockingReport.key === fieldSelKey;
  const openFieldStamp = fieldSel?.kind === 'field' ? fieldCelStamp(shownDraft, fieldSel.id) : null;
  React.useEffect(() => {
    if (!liveFieldReport || fieldSel === null) return;
    const kept = { field: fieldSel.id, count: blockingReport.count, stamp: openFieldStamp };
    setCelVerdicts((prev) => {
      const was = prev[fieldSelKey];
      if (was && was.count === kept.count && was.stamp === kept.stamp) return prev;
      return { ...prev, [fieldSelKey]: kept };
    });
  }, [liveFieldReport, fieldSel, fieldSelKey, blockingReport.count, openFieldStamp]);
  // The open object's fields whose verdict holds, and their summed count.
  const celHeldFields: string[] = [];
  let inspectorBlocking = 0;
  const celFieldPrefix = `${current?.name ?? ''}:field:`;
  for (const [key, kept] of Object.entries(celVerdicts)) {
    if (!key.startsWith(celFieldPrefix) || key === fieldSelKey) continue;
    if (kept.count > 0 && kept.stamp === fieldCelStamp(shownDraft, kept.field)) {
      celHeldFields.push(kept.field);
      inspectorBlocking += kept.count;
    }
  }
  if (blockingReport.key === fieldSelKey && blockingReport.count > 0) {
    if (fieldSel?.kind === 'field') celHeldFields.push(fieldSel.id);
    inspectorBlocking += blockingReport.count;
  } else if (fieldSelKey !== '' && !liveFieldReport) {
    // Opened, and its inspector has not reported yet: its kept verdict stands.
    const kept = celVerdicts[fieldSelKey];
    if (kept && kept.count > 0 && kept.stamp === openFieldStamp) {
      celHeldFields.push(kept.field);
      inspectorBlocking += kept.count;
    }
  }
  // The pillar's PANEL family reports separately (objectui#4527): the
  // validations, actions and settings panels all write through this same draft
  // and own no Save of their own, so their CEL faults have to reach this
  // button too. Kept apart from the field inspector's count above because the
  // two expire on different things.
  //
  // Stamped with the panel TAB: exactly one panel is mounted at a time, so
  // leaving the tab unmounts the reporter and it can never retract its last
  // verdict. objectstack#27629 — only Settings still reports through this
  // count (its inspector mounts no CEL editor today); Validations and Actions
  // report per item and keep their verdicts with the draft (`panelCelVerdicts`
  // below), so leaving their tab no longer releases the hold.
  const [panelBlockingReport, setPanelBlockingReport] = React.useState({ key: '', count: 0 });
  const [dirty, setDirty] = React.useState(false);
  const [hasDraft, setHasDraft] = React.useState(false);
  const [saving, setSaving] = React.useState<false | 'draft' | 'publish'>(false);
  const [gridVer, setGridVer] = React.useState(0);
  // Records grid ⇄ Form ⇄ Validations ⇄ Settings — four views of the SAME
  // object. Grid/Form are the runtime renderer (same-renderer principle);
  // Validations edits `validations` rules; Settings edits object basics +
  // the ADR-0085 semantic roles. All patch the one `objDraft`.
  const [viewMode, setViewMode] = React.useState<'grid' | 'form' | 'rules' | 'settings' | 'hooks' | 'actions' | 'api'>('grid');
  // objectstack#34725 — lift the open object's label to the copilot's chip,
  // with the tab in view: 「正在看：会议 · 记录」, never the machine name. The
  // Interfaces pillar's report (objectui#8219) is the same seam; keyed on
  // primitives, the callback read through a ref.
  const onSurfaceLabelChangeRef = React.useRef(onSurfaceLabelChange);
  React.useEffect(() => {
    onSurfaceLabelChangeRef.current = onSurfaceLabelChange;
  });
  const currentObjectName = current?.type === 'object' ? current.name : undefined;
  const currentObjectLabel = current?.type === 'object' ? current.label : undefined;
  const viewModeLabel = t(`engine.studio.data.tab.${viewMode === 'grid' ? 'records' : viewMode}`, locale);
  React.useEffect(() => {
    onSurfaceLabelChangeRef.current?.(
      currentObjectName && currentObjectLabel
        ? { type: 'object', name: currentObjectName, label: `${currentObjectLabel} · ${viewModeLabel}` }
        : null,
    );
  }, [currentObjectName, currentObjectLabel, viewModeLabel]);
  React.useEffect(
    () => () => {
      onSurfaceLabelChangeRef.current?.(null);
    },
    [],
  );
  // objectui#11781 — the field inspector belongs to the view that opened it,
  // so a view switch closes it, the same act as its own Close: the selection
  // goes, and its blocking count expires with it (see `blockingReport`). Left
  // open, a Records/Form selection stayed beside Validations, Hooks, Actions,
  // API and Settings, where nothing on screen is that field.
  const selectViewMode = (next: typeof viewMode) => {
    if (next !== viewMode) setFieldSel(null);
    setViewMode(next);
  };
  // objectstack#26736 — the action a refusal or a held line names, opened by
  // its "Show me": a fresh object per press, so pressing it again re-selects
  // the action after the author picked another one.
  const [actionFocus, setActionFocus] = React.useState<{ name: string } | null>(null);
  // objectstack#27629 — the rule a held line names, opened the same way.
  const [ruleFocus, setRuleFocus] = React.useState<{ name: string } | null>(null);
  const showObjTarget = (target: MetadataSelection) => {
    if (target.kind === 'action') {
      selectViewMode('actions');
      setActionFocus({ name: target.id });
      return;
    }
    if (target.kind === 'rule') {
      selectViewMode('rules');
      setRuleFocus({ name: target.id });
      return;
    }
    setFieldSel({ kind: target.kind, id: target.id });
  };
  // objectstack#34724 — `?surface=object:<name>&action=<action>` opens the
  // deep-linked object's Actions view on that action (Studio's landing links a
  // switched-off action that lives in its object's `actions[]` here).
  useSurfaceActionDeepLink(initialSurface, current, (name) => showObjTarget({ kind: 'action', id: name }));
  // objectstack#26730 — a refusal's "Show me" also ends on the input it names:
  // in the field inspector, or in the actions panel for an action.
  const fieldInspectorBodyRef = React.useRef<HTMLDivElement>(null);
  const actionsPanelRef = React.useRef<HTMLDivElement>(null);
  const focusFieldInput = useShowInputFocus(fieldInspectorBodyRef);
  const focusActionInput = useShowInputFocus(actionsPanelRef);
  const showObjRefusal = (target: MetadataSelection | null, input?: string) => {
    if (!target) return;
    showObjTarget(target);
    (target.kind === 'action' ? focusActionInput : focusFieldInput)(input);
  };
  // objectui#11781 — Escape closes it too, but only an Escape nothing else
  // took: a layer that answers Escape itself (a Radix menu, select or dialog,
  // an autocomplete, an inline edit) prevents its default, and that keystroke
  // stays the layer's. Read on the document because a click on the form
  // preview leaves focus on the body, and kept to this pillar and the body so
  // a keystroke in another surface is not read as one.
  const pillarRef = React.useRef<HTMLDivElement>(null);
  const inspectorOpen = fieldSel !== null;
  // objectui#12725 — the surface's right slot hosts the field inspector
  // (`useStudioRightSlot`); `null` under an injected `aiSlot`, where the
  // classic aside beside the canvas stays. The pillar has no properties of
  // its own to show with nothing selected (the object's own settings are its
  // Settings tab), so it claims the slot only while a field or group is
  // selected: Esc, an empty click or ✕ hand the slot back to the copilot.
  const slot = useStudioRightSlot();
  const inSlot = slot !== null;
  const slotPropsTarget = slot?.propsTarget ?? null;
  React.useEffect(() => {
    if (!inspectorOpen) return;
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      // The slot's inspector is this pillar's too, though it sits outside it.
      if (target !== document.body && !pillarRef.current?.contains(target) && !slotPropsTarget?.contains(target)) return;
      setFieldSel(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [inspectorOpen, slotPropsTarget]);
  // Stamp + read for the panel-family count declared above.
  const panelKey = `${current?.name ?? ''}:${viewMode}`;
  const panelBlocking = panelBlockingReport.key === panelKey ? panelBlockingReport.count : 0;
  const reportPanelBlocking = React.useCallback(
    (count: number) => setPanelBlockingReport({ key: panelKey, count }),
    [panelKey],
  );
  // objectstack#27629 — the panel family's verdicts belong to the draft, as the
  // field inspector's do (`celVerdicts` above, the ruling on objectstack#27485).
  // Validations and Actions report a verdict per rule or action; each is kept
  // with the stamp of what it judged (`panelItemCelStamp`, retaken while its
  // panel is mounted) and holds, with the tab left, while the draft still
  // carries that stamp: an edit to the item, its removal or the object's next
  // load ends it. While the panel is mounted its own report is the live verdict
  // and always wins; the held line names the item and its "Show me" reopens it.
  const [livePanelVerdicts, setLivePanelVerdicts] = React.useState<{
    key: string;
    verdicts: Readonly<Record<string, number>>;
  }>({ key: '', verdicts: {} });
  const reportPanelVerdicts = React.useCallback(
    (verdicts: Readonly<Record<string, number>>) => setLivePanelVerdicts({ key: panelKey, verdicts }),
    [panelKey],
  );
  const [panelCelVerdicts, setPanelCelVerdicts] = React.useState<
    Record<string, { tab: CelPanelTab; item: string; count: number; stamp: string | null }>
  >({});
  const livePanel = isCelPanelTab(viewMode) && livePanelVerdicts.key === panelKey ? livePanelVerdicts.verdicts : null;
  React.useEffect(() => {
    if (livePanel === null || !isCelPanelTab(viewMode)) return;
    setPanelCelVerdicts((prev) => {
      let next = prev;
      for (const [item, count] of Object.entries(livePanel)) {
        const kept = { tab: viewMode, item, count, stamp: panelItemCelStamp(objDraft, viewMode, item) };
        const key = `${panelKey}:${item}`;
        const was = prev[key];
        if (was && was.count === kept.count && was.stamp === kept.stamp) continue;
        if (next === prev) next = { ...prev };
        next[key] = kept;
      }
      return next;
    });
  }, [livePanel, viewMode, panelKey, objDraft]);
  // The open object's panel items whose verdict holds, and their summed count.
  const celHeldPanelItems: Array<{ tab: CelPanelTab; item: string }> = [];
  let panelCelBlocking = 0;
  const celPanelPrefix = `${current?.name ?? ''}:`;
  for (const [key, kept] of Object.entries(panelCelVerdicts)) {
    if (!key.startsWith(celPanelPrefix)) continue;
    if (livePanel !== null && kept.tab === viewMode && Object.prototype.hasOwnProperty.call(livePanel, kept.item)) continue;
    if (kept.count > 0 && kept.stamp !== null && kept.stamp === panelItemCelStamp(objDraft, kept.tab, kept.item)) {
      celHeldPanelItems.push({ tab: kept.tab, item: kept.item });
      panelCelBlocking += kept.count;
    }
  }
  if (livePanel !== null && isCelPanelTab(viewMode)) {
    for (const [item, count] of Object.entries(livePanel)) {
      if (count <= 0) continue;
      celHeldPanelItems.push({ tab: viewMode, item });
      panelCelBlocking += count;
    }
  }
  // objectstack#27644 — the open object's served verdict (the draft read's
  // `_diagnostics`, else the layered read's) and the body it judged, for the
  // Validations panel: a rule guard the publish refuses holds the autosave
  // through the panel's verdicts above while it still shows the judged text.
  // Each load and each save's re-read replaces both; the later one wins.
  const [objVerdict, setObjVerdict] = React.useState<ServerDiagnostics | undefined>(undefined);
  const [objVerdictBody, setObjVerdictBody] = React.useState<unknown>(undefined);
  const objVerdictSeq = React.useRef(0);
  // Either source closes the door: a malformed field formula and a malformed
  // rule guard are both unsaveable, and neither excuses the other.
  const saveBlocking = inspectorBlocking + panelBlocking + panelCelBlocking;
  // Within the Form view: Layout (WYSIWYG drag/section designer) ⇄ Preview
  // (live form).
  const [formMode, setFormMode] = React.useState<'layout' | 'preview'>('layout');
  // objectui#12515 — which definition Preview renders when the object has a
  // published version AND a pending change: the draft (the default) or the
  // published one. Without a published version only the draft exists.
  const [previewSource, setPreviewSource] = React.useState<'draft' | 'published'>('draft');
  // Tracks which object's baseline is currently loaded — so we (re)load exactly
  // once per selected object and never clobber an in-progress draft.
  const loadedNameRef = React.useRef<string | null>(null);
  // objectui#11773 — the version `objDraft` was saved at, sent as `If-Match` by
  // every save of this buffer (the autosave and the column reorder). A
  // conflict's "reload" re-runs the load below for the open object.
  const [objReloadNonce, setObjReloadNonce] = React.useState(0);
  const reloadObjDraft = React.useCallback(() => setObjReloadNonce((n) => n + 1), []);
  // objectstack#32610 — the copilot shares this document (ADR-0057 P3c): a
  // draft its tool writes, and the discard its undo runs, are announced on the
  // assistant bus, the pulse the rail above already re-reads on. The open
  // object and its extension re-read on it too, so the field properties, the
  // Form canvas and the header's own reading follow the server's draft. Held
  // while either buffer carries work not yet sent (an edit, a save in flight):
  // the pulse is released once that work is saved, never applied over it.
  const objBuffersHeld = dirty || extDirty || saving !== false;
  const objRefreshNonce = useMetadataRefreshNonce(objBuffersHeld);
  const objBuffersHeldRef = React.useRef(objBuffersHeld);
  React.useLayoutEffect(() => {
    objBuffersHeldRef.current = objBuffersHeld;
  });
  // Set by a re-read on the pulse as it installs: the selection is judged
  // once against what the re-read left (see the effect below the loads).
  const refreshInstalledRef = React.useRef(false);
  const {
    save: saveObjDraft,
    recordRead: recordObjRead,
    // objectstack#36601 — and the published row the buffer was loaded at, for the Save's publish.
    recordPublished: recordObjPublished,
    publish: publishObj,
    dialog: objConflictDialog,
  } = useDraftSaveGuard(client, reloadObjDraft);
  // objectstack#28575 — the extension buffer's own guard, pinned by its draft read at the pair.
  const reloadExt = React.useCallback(() => setExtReloadNonce((n) => n + 1), []);
  const {
    save: saveExtDraft,
    recordRead: recordExtRead,
    dialog: extConflictDialog,
  } = useDraftSaveGuard(client, reloadExt);
  // The pair a READ names is the surface's (`StudioBaseCustomization.pairId`),
  // read through this ref, so the pair a first add creates never reloads the
  // buffer it is about to save.
  const extReadPairRef = React.useRef<string | null>(customization?.pairId ?? null);
  React.useLayoutEffect(() => {
    extReadPairRef.current = customization?.pairId ?? null;
  });
  // Left-rail search + inline "new object" creator (design §4: rail = search + New).
  const [query, setQuery] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  // The OWD the create dialog will author (`7a90afdf9`). Pre-selected to the
  // platform's own recommended baseline; the author sees it and can change it
  // before the object exists. Reset by `openCreateDialog` below rather than by
  // an effect on `creating` — the effect spelling re-renders the dialog a
  // second time on every open purely to undo a previous session's pick.
  const [createOwd, setCreateOwd] = React.useState<OwdCreateModel>(OWD_DEFAULT);
  // objectstack#26917 — a create refused because the identifier is taken:
  // which object holds it, and whether it is on this rail, so it can be opened.
  const [createTaken, setCreateTaken] = React.useState<{ name: string; label: string; here: boolean } | null>(null);
  const openCreateDialog = React.useCallback(() => {
    setError(null);
    setCreateTaken(null);
    setCreateOwd(OWD_DEFAULT);
    setCreating(true);
  }, []);
  const [createBusy, setCreateBusy] = React.useState(false);
  // Whether the selected object exists beyond the draft (published/code baseline).
  // A draft-only object has NO physical table yet (DDL lands at publish), so the
  // Records grid must not fire data SQL against it.
  const [hasBaseline, setHasBaseline] = React.useState(true);
  /**
   * The field names that EXIST on the server for the current object — i.e. the
   * ones a data query may name in `select`.
   *
   * Measured, not assumed (cloud#1652): saving a field as a DRAFT returns 200
   * and `state=draft`, and the very next `select` naming it still answers
   * `400 INVALID_FIELD`. Materialisation happens at PUBLISH, so the draft body
   * is the wrong source for a projection even after a successful save.
   */
  const [publishedFieldNames, setPublishedFieldNames] = React.useState<Set<string>>(new Set());
  // objectui#12515 — the Published preview's field list: the published
  // definition's own form fields, in its order. Set where the load installs the
  // baseline, so its identity changes only with it (see `formFields`).
  const [publishedFormFields, setPublishedFormFields] = React.useState<string[]>([]);
  // objectstack#29793 — the fields the SERVED object carries that the buffer's
  // authored layers do not declare (the platform's injected columns, a field
  // another package folds on). The buffer holds what the author wrote; these
  // keep the header count and the records grid on the server's object.
  const [servedOnly, setServedOnly] = React.useState<FieldEntry[]>([]);
  // The package's object-name namespace (framework#2694). New objects are
  // auto-prefixed with `<namespace>_` so an author can never draft a prefix-less
  // object that publish would later reject (code NAMESPACE_PREFIX).
  const [namespace, setNamespace] = React.useState<string | null>(null);
  const pairNamespace = customizationNamespace(namespace);
  const newObjectNamespace = packageReadOnly ? (pairNamespace.ok ? pairNamespace.value : null) : namespace;

  React.useEffect(() => {
    let cancelled = false;
    fetchPackages()
      .then((list) => {
        if (!cancelled) setNamespace(list.find((p) => p.id === railPackageId)?.namespace ?? null);
      })
      .catch((e: unknown) => {
        // The namespace stays best-effort and publish still enforces the
        // prefix server-side — but silently losing it means the author drafts
        // prefix-less objects now and hears about it only at publish. Report
        // it at the moment it breaks (objectui#7368), on the shared toast id.
        if (cancelled) return;
        toast.error(formatMetadataError(e), { id: PACKAGE_LIST_TOAST_ID });
      });
    return () => {
      cancelled = true;
    };
  }, [railPackageId]);

  React.useEffect(() => {
    let cancelled = false;
    const packageId = railPackageId;
    (async () => {
      try {
        // Published objects + pending DRAFT objects, merged. `list()` only
        // sees published/active metadata, so a freshly-created writable base
        // whose objects are all drafts would render an empty (previously:
        // forever-"loading") rail.
        //
        // objectui#11843 — written when a draft header carried no label (since
        // objectstack-ai/objectstack#22200 the `_drafts` row carries one; this
        // read predates it and still works, objectui#11862), a draft-only
        // object takes its label from the draft-overlaid list
        // (`GET /meta/object?package=…&preview=draft`), which serves each
        // pending draft of the package with its own label and a `_draft` mark.
        // That list is read for labels ONLY:
        //  - the rail's members are still the published list plus the draft
        //    headers, in that order;
        //  - a published object keeps its published label, even when a pending
        //    draft of it declares another one;
        //  - a draft that declares no label, a caller the server answers the
        //    published list (pending drafts are not served to everyone), and a
        //    failed read all leave a draft-only object on its name, as before.
        //    The read is an async function so that even a throw before it is
        //    sent rejects, and the rail never fails on it.
        const readDraftLabels = async (): Promise<Map<string, string>> => {
          const overlaid = await client
            .withPreviewDrafts(true)
            .list<Record<string, unknown>>('object', { packageId });
          const labels = new Map<string, string>();
          for (const o of overlaid || []) {
            if (!o || o._draft !== true || typeof o.name !== 'string') continue;
            if (typeof o.label === 'string' && o.label.trim()) labels.set(o.name, o.label);
          }
          return labels;
        };
        // objectstack#28572 — and, on a read-only base with a pair, the pair's
        // published and draft objects: the ones the base's list does not hold
        // are the objects the pair adds. A failed pair read lists none of them.
        const readPair = async (): Promise<Surface[]> => {
          if (railPairId === null) return [];
          const [pairList, pairDrafts] = await Promise.all([
            client.list('object', { packageId: railPairId }) as Promise<Array<Record<string, unknown>>>,
            client.listDrafts({ packageId: railPairId, type: 'object' }).catch(() => []),
          ]);
          const rows: Surface[] = (pairList || [])
            .map((o) => ({
              type: 'object',
              name: String(o.name ?? ''),
              label: String(o.label ?? o.name ?? ''),
              icon: o.icon ? String(o.icon) : undefined,
              color: typeof o.color === 'string' ? o.color : undefined,
            }))
            .filter((o) => o.name);
          const seen = new Set(rows.map((o) => o.name));
          for (const d of pairDrafts as Array<{ name?: string | null; label?: I18nLabel | null }>) {
            if (d.name && !seen.has(d.name)) {
              rows.push({ type: 'object', name: d.name, label: resolveI18nLabel(d.label ?? undefined, locale)?.trim() || d.name });
              seen.add(d.name);
            }
          }
          return rows;
        };
        const [list, draftHeaders, draftLabels, pairRows] = await Promise.all([
          client.list('object', { packageId }) as Promise<Array<Record<string, unknown>>>,
          client.listDrafts({ packageId, type: 'object' }).catch(() => []),
          readDraftLabels().catch(() => new Map<string, string>()),
          readPair().catch(() => [] as Surface[]),
        ]);
        if (cancelled) return;
        const baseItems: Surface[] = (list || [])
          .map((o) => ({
            type: 'object',
            name: String(o.name ?? ''),
            label: String(o.label ?? o.name ?? ''),
            icon: o.icon ? String(o.icon) : undefined,
            color: typeof o.color === 'string' ? o.color : undefined,
          }))
          .filter((o) => o.name);
        const known = new Set(baseItems.map((o) => o.name));
        for (const d of draftHeaders) {
          if (d.name && !known.has(d.name)) {
            baseItems.push({ type: 'object', name: d.name, label: draftLabels.get(d.name) ?? d.name, icon: undefined });
          }
        }
        const items = withPairItems(baseItems, pairRows, railPairId);
        setObjects(items);
        // Honor a `?surface=object:<name>` deep-link when it names an object we
        // actually have; otherwise open the first object as before.
        const deepLinked = resolveSurfaceDeepLink(items, initialSurface, 'object');
        // objectstack#28572 — an object the pair adds is listed once the pair
        // is known (`useDeepLinkFallback`).
        if (deepLinked && deepLinkUpgrade.take(currentRef.current?.name ?? null, deepLinked.name)) {
          setCurrent(deepLinked);
        } else {
          if (!deepLinked && initialSurface?.type === 'object' && currentRef.current === null) {
            deepLinkUpgrade.note(items[0]?.name ?? null);
          }
          setCurrent((c) => c ?? deepLinked ?? items[0] ?? null);
        }
        // An empty writable package does NOT auto-open the creator dialog —
        // it used to, which forced an unrequested modal on EVERY visit to an
        // empty package (dogfood #2555). The empty-state panel carries the
        // create CTA instead.
      } catch (e) {
        if (!cancelled) setError(plainRefusal(e));
      } finally {
        if (!cancelled) setObjectsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, railPackageId, packageReadOnly, railPairId, locale, metadataRefreshNonce, railNonce]);

  React.useEffect(() => {
    if (!current) return;
    // Load once per selected object. Bail if this object's baseline is already
    // loaded — a client-identity churn or a child remount must NOT re-fetch and
    // clobber the in-progress form-layout draft the designer is editing.
    // Keyed by object + publishNonce: a package publish (nonce++) re-reads the
    // fresh published baseline; otherwise we never clobber an in-progress draft.
    const baseKey = `${current.name}#${publishNonce}#${objReloadNonce}`;
    const loadKey = `${baseKey}#${objRefreshNonce}`;
    if (loadedNameRef.current === loadKey) return;
    // objectstack#32610 — a re-read of the same object on the pulse alone
    // keeps what the author has open (the selected field, the canvas): only
    // what it shows is replaced. Any other load starts the object afresh.
    const refreshOnly = loadedNameRef.current?.startsWith(`${baseKey}#`) === true;
    loadedNameRef.current = loadKey;
    let cancelled = false;
    // objectui#11331 — whether this run's load has settled (see the cleanup).
    let settled = false;
    setLoading(true);
    setError(null);
    if (!refreshOnly) setFieldSel(null);
    // What the buffer this load replaces carried, dropped with it.
    const dropReplacedBuffer = () => {
      // objectstack#27485 — kept CEL verdicts judged the buffer this load replaces.
      setCelVerdicts({});
      setPanelCelVerdicts({});
      // objectstack#27644 — and so did the served one; a save's re-read in flight is dropped.
      objVerdictSeq.current += 1;
      setObjVerdict(undefined);
      setObjVerdictBody(undefined);
      setDirty(false);
    };
    // objectstack#36648 — a re-read on the pulse alone drops nothing until it
    // installs: the pulse is released the moment a Save ends, and an edit made
    // before this effect runs (a keystroke right after the Save) is the
    // author's, kept by the in-flight rule below exactly as one made while the
    // read is out. Dropped here, its dirty flag went, the read then installed
    // over it, and the edit was lost with no Save left to press.
    if (!refreshOnly) dropReplacedBuffer();
    (async () => {
      try {
        // objectui#11773 — the draft is read at the address the object saves
        // write, so the version it serves pins the first of them.
        // ADR-0048 — and the layers at this package, the object's owner: a
        // layered read naming no package is refused for a name two packages hold.
        const readLayers = () => client.layered<Record<string, unknown>>('object', current.name, { packageId });
        const readDraft = () => readDraftForSave<Record<string, unknown>>(client, 'object', current.name, packageId);
        // objectstack#29793 — the layers are read for every object, a
        // draft-only one included: they hold the buffer (`authoredObjectBuffer`,
        // the stored `draft` layer), and a caller the server serves that layer
        // to is answered it for a draft-only name too. The draft read stays
        // beside it for what only it carries: the version pin, the publish
        // verdict and the per-key provenance.
        const [layRaw, draftRead] = await Promise.all([readLayers(), readDraft()]);
        if (cancelled) return;
        // objectstack#29148 — an object draft the server refused to read is no
        // absence: no buffer is installed over it (see InterfacesPillar's leaf
        // load), so nothing is shown to edit and the autosave has nothing to send.
        if ('refused' in draftRead) {
          setObjDraftFor('');
          setError({
            message: t('engine.studio.refusal.draftUnreadable', locale),
            detail: formatMetadataError(draftRead.refused),
          });
          return;
        }
        const lay = layRaw as { effective?: Record<string, unknown>; code?: Record<string, unknown> };
        const baseline = (lay.effective ?? lay.code ?? {}) as Record<string, unknown>;
        const draftBody = extractDraftBody(draftRead.answer);
        // objectstack#29793 — the buffer is the object as its author wrote it:
        // the stored draft as-is (objectui#10765), else `overlay ?? code`. The
        // served draft above is translated and governed, so it is never the
        // buffer; a draft whose stored copy was not served installs nothing.
        const authored = authoredObjectBuffer(layRaw as ObjectLayers, draftBody);
        if (authored.kind === 'unserved') {
          setObjDraftFor('');
          setError({ message: t('engine.studio.refusal.draftUnreadable', locale) });
          return;
        }
        // objectstack#32610 — an edit begun while the re-read was in flight
        // keeps its buffer; its save is pinned to the read it was made on.
        if (refreshOnly && objBuffersHeldRef.current) return;
        if (refreshOnly) {
          refreshInstalledRef.current = true;
          dropReplacedBuffer();
        }
        objStoredRef.current = authored.body;
        setDestructive(null);
        setObjDraft(authored.body);
        setServedOnly(
          servedOnlyFields((draftBody ?? baseline).fields, [
            authored.body.fields,
            authoredPublishedObject(layRaw as ObjectLayers).fields,
          ]),
        );
        // objectstack#27644 — the verdict on that body, and the body it judged.
        const draftVerdict = draftEnvelopeDiagnostics(draftRead.answer);
        setObjVerdict(editedItemDiagnostics({ hasDraft: !!draftBody, draftDiagnostics: draftVerdict, layered: lay }));
        setObjVerdictBody(draftBody && draftVerdict ? draftBody : lay.effective);
        setObjDraftFor(`object:${current.name}`);
        setObjDraftChanges(draftBody ? readDraftChanges(draftRead.answer) : null);
        // objectui#11773 — the next save is pinned to what the draft read served.
        recordObjRead('object', current.name, packageId, draftRead.pin);
        // objectstack#36601 — …and its publish to the published row the layers served.
        recordObjPublished('object', current.name, packageId, publishedPinOf(layRaw));
        // objectui#11272 — the buffer installed is clean, as every pillar's
        // is: an edit a period began while it was another object's is dropped
        // with it, never sent as this object's.
        setDirty(false);
        setHasDraft(!!draftBody);
        setHasBaseline(!!(lay.effective ?? lay.code));
        // The projection baseline: the object as the SERVER has it. `objDraft`
        // above is the pending draft as-is when one exists, which is right for
        // the editor and wrong for a `select`: a draft-only field is not a
        // column the data API can answer yet (see `gridColumns`).
        setPublishedFieldNames(new Set(readFields(baseline.fields).entries.map((e) => e.name)));
        setPublishedFormFields(formFieldNames(baseline.fields));
      } catch (e) {
        if (!cancelled) setError(plainRefusal(e));
      } finally {
        settled = true;
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      // objectui#11331 — a load cancelled before it settled takes back what
      // its start claimed, as in InterfacesPillar's draft load: `loading`, and
      // here the load-once claim too. The cancelled load installed nothing, so
      // a re-run for the same key (a new `client` while it was in flight) must
      // load rather than bail as if it had, which left the object on
      // "Loading…" for good. A load that settled keeps its claim, so a client
      // change after it still never clobbers the draft being edited.
      if (!settled) {
        setLoading(false);
        loadedNameRef.current = null;
      }
    };
  }, [client, current, packageId, publishNonce, objReloadNonce, objRefreshNonce, recordObjRead, recordObjPublished]);

  // objectstack#28575 — the pair's extension of the open base object: its
  // pending draft at the pair, else its published row there, else a new
  // `{ extend }`. Loaded once per object, and again after a publish. A draft
  // starts from the published body, so a publish never drops a field the
  // published extension already declares.
  React.useEffect(() => {
    if (!extendsBase || !current) {
      extLoadedRef.current = null;
      return;
    }
    const name = current.name;
    const baseKey = `${name}#${publishNonce}#${extReloadNonce}`;
    const loadKey = `${baseKey}#${objRefreshNonce}`;
    if (extLoadedRef.current === loadKey) return;
    // objectstack#32610 — a re-read on the pulse alone keeps the extension
    // shown until its answer replaces it (see the object load above).
    const refreshOnly = extLoadedRef.current?.startsWith(`${baseKey}#`) === true;
    extLoadedRef.current = loadKey;
    let cancelled = false;
    let settled = false;
    if (!refreshOnly) {
      setExt(null);
      setExtDirty(false);
      setExtHasDraft(false);
    }
    const pair = extReadPairRef.current;
    (async () => {
      try {
        let draft: ObjectExtensionBody | null = null;
        let published: ObjectExtensionBody | null = null;
        if (pair) {
          const [draftRead, publishedRow] = await Promise.all([
            readDraftForSave<Record<string, unknown>>(client, OBJECT_EXTENSION_TYPE, name, pair),
            client.get<Record<string, unknown>>(OBJECT_EXTENSION_TYPE, name, { packageId: pair }),
          ]);
          if (cancelled) return;
          // objectstack#29148 — an extension draft the server refused to read
          // installs no extension buffer: one seeded from the published row
          // would be saved over the draft it never read.
          if ('refused' in draftRead) {
            setError({
              message: t('engine.studio.refusal.draftUnreadable', locale),
              detail: formatMetadataError(draftRead.refused),
            });
            return;
          }
          if (refreshOnly && objBuffersHeldRef.current) return;
          draft = objectExtensionBodyOf(extractDraftBody(draftRead.answer), name);
          published = objectExtensionBodyOf(publishedRow, name);
          recordExtRead(OBJECT_EXTENSION_TYPE, name, pair, draftRead.pin);
        }
        if (refreshOnly) refreshInstalledRef.current = true;
        setExt({ for: name, body: draft ?? published ?? { extend: name }, published: new Set(extensionFieldNames(published)) });
        setExtHasDraft(draft !== null);
      } catch (e) {
        if (!cancelled) setError(plainRefusal(e));
      } finally {
        settled = true;
      }
    })();
    return () => {
      cancelled = true;
      // A load cancelled before it settled takes its claim back (see the object load above).
      if (!settled) extLoadedRef.current = null;
    };
  }, [client, current, extendsBase, publishNonce, extReloadNonce, objRefreshNonce, recordExtRead]);

  // objectstack#32610 — a field the pulse's re-read no longer has (a discard
  // took it away) is not left selected; one it still has stays open.
  React.useEffect(() => {
    if (!refreshInstalledRef.current) return;
    refreshInstalledRef.current = false;
    const shown = extOpen ? foldObjectExtension(objDraft, extOpen.body, extOpen.published) : objDraft;
    const kept = new Set(readFields(shown.fields).entries.map((e) => e.name));
    setFieldSel((sel) => (sel?.kind === 'field' && !kept.has(String(sel.id)) ? null : sel));
  }, [objDraft, extOpen]);

  // The header counts the fields the canvas shows, and names the platform's
  // own columns apart: "2 fields (+8 system)". objectstack#29793 — the
  // platform's columns are the served object's: the buffer holds only what the
  // author wrote, so the ones it does not declare are counted from `servedOnly`.
  const fieldCount = React.useMemo(() => {
    const { entries } = readFields(shownDraft.fields);
    const held = new Set(entries.map((e) => e.name));
    const own = formFieldNames(shownDraft.fields).length;
    const served = servedOnly.filter((e) => !held.has(e.name)).length;
    return { own, system: entries.length - own + served };
  }, [shownDraft, servedOnly]);
  const fieldCountText =
    tFormat(fieldCount.own === 1 ? 'engine.studio.data.fieldCountOne' : 'engine.studio.data.fieldCount', locale, {
      count: fieldCount.own,
    }) +
    (fieldCount.system > 0 ? ` ${tFormat('engine.studio.data.systemFieldCount', locale, { count: fieldCount.system })}` : '');

  /**
   * The design-mode grid's columns: the object's own fields in metadata order,
   * dropping framework-managed/audit fields so the grid opens on the meaningful
   * columns first. Also drops a field named `actions` — the grid always pins its
   * own row-actions column headed "Actions", so a data column of the same name
   * reads as a duplicated column. (The field stays editable in the form designer.)
   *
   * Memoized because the IDENTITY of this array, not its contents, is a data-fetch
   * input downstream (objectui#4567). It reaches `ListView` unchanged — plugin-view's
   * ObjectView forwards it to the `renderListView` slot as `columns` by reference
   * (plugin-view/src/ObjectView.tsx) — and ListView derives its `$expand` fields from
   * `schema.columns` with that array in the memo's dependency array BY IDENTITY, which
   * is itself in the fetch effect's dependency array (plugin-list/src/ListView.tsx).
   * Built inline, this allocated a fresh array on every render of the pillar, so the
   * Studio grid issued a duplicate find() per render — measured 1 -> 4 across three
   * re-renders that changed nothing. The pillar re-renders constantly (its whole
   * schema is a fresh object literal each time), so that was a steady-state duplicate
   * query source against the backend, invisible in the UI because the rows just
   * repainted with the same data.
   *
   * Keyed on `objDraft.fields` rather than on `objDraft`: `onPatch` replaces the draft
   * object while keeping `fields` identical, so the looser key would churn the columns
   * — and refetch — on every unrelated draft edit (icon, label). The dependency stays
   * LIVE: a real field add/remove/reorder produces a new `fields`, hence a new array,
   * hence the refetch that change must have. Stabilising identity here is deliberately
   * a PRODUCER-side fix; ListView's by-identity dependency is correct for a genuine
   * column change and is left alone.
   */
  const draftNameField = shownDraft.nameField;
  const draftDisplayNameField = shownDraft.displayNameField;
  const gridColumnsComputed = React.useMemo(() => {
    // objectstack#29793 — the grid also shows the served object's columns the
    // buffer does not declare (`owner_id` and the other injected ones).
    // objectstack#34794 — they follow the author's fields, and the object's
    // name field leads: the design grid opens on the column that tells its
    // rows apart. The lead is the ADR-0079 D4 order through the shared
    // `leadWithNameField`, over the fields this memo already holds. This is
    // the design grid's default only; runtime list views keep their order.
    const held = readFields(shownDraft.fields).entries;
    const heldNames = new Set(held.map((e) => e.name));
    const all = [...held, ...servedOnly.filter((e) => !heldNames.has(e.name))];
    // Only the declared pointer keys and the fields reach the helper, so the
    // memo stays keyed on them rather than on the whole draft (see above).
    const ordered = leadWithNameField(
      { nameField: draftNameField, displayNameField: draftDisplayNameField, fields: Object.fromEntries(all.map((e) => [e.name, e.def])) },
      all.map((e) => e.name),
    );
    const byName = new Map(all.map((e) => [e.name, e]));
    return ordered
        .map((n) => byName.get(n)!)
        // objectui#11780 — a column the platform injects AND hides (`__search`,
        // `owning_business_unit_id`) is no column an author manages. Read off
        // the definition this memo already holds, so the key stays
        // `objDraft.fields` and the identity reasoning above is unchanged.
        .filter((e) => !isStudioHiddenSystemField(e.def))
        .map((e) => e.name)
        .filter((n) => !STUDIO_SYSTEM_FIELD_NAMES.has(n) && n !== 'actions')
        // cloud#1652 — a column the server does not have yet must not reach the
        // `select`. "+ add field" appends `field_<N>` to the DRAFT, this array
        // is a fetch input, and the data API refuses an unknown projection key
        // by design (dropping it would silently answer a NARROWER projection
        // with a WIDER one). The result was that adding a field replaced the
        // whole grid with "This view's query was refused" — on the most
        // ordinary edit there is.
        //
        // Filtering here rather than at the fetch keeps ONE source of truth for
        // what the grid asks for. The new field is still selected in the
        // inspector, which is where it gets configured; it joins the grid once
        // it is published and therefore queryable.
        .filter((n) => publishedFieldNames.has(n));
  }, [shownDraft.fields, draftNameField, draftDisplayNameField, publishedFieldNames, servedOnly]);
  // objectstack#28575 — with a base object's extension open, the folded object
  // (`shownDraft`) is rebuilt on every extension edit, so a label typed into an
  // extension field would hand the grid a fresh columns array per keystroke:
  // then the columns are keyed on their NAMES. Otherwise the array keeps the
  // identity semantics above, which `StudioDesignSurface.gridColumns.test.tsx`'s
  // identity-churn liveness case pins as a must-not-change.
  const gridColumnsExtKey = extOpen ? JSON.stringify(gridColumnsComputed) : null;
  const gridColumns = React.useMemo(
    () => (gridColumnsExtKey === null ? gridColumnsComputed : (JSON.parse(gridColumnsExtKey) as string[])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- with an extension open, the names alone key it
    [gridColumnsExtKey ?? gridColumnsComputed],
  );

  /**
   * The design-mode FORM's fields: the object's own fields, dropping
   * framework-managed/audit fields — the same base set `gridColumns` above
   * uses, but WITHOUT its `actions` exclusion. The grid drops a field named
   * `actions` because the grid always pins its own row-actions column headed
   * "Actions"; the form has no such column, so a data field literally named
   * `actions` stays editable here. That filter difference is why this is a
   * SECOND memo rather than a reuse of `gridColumns` — sharing it would
   * silently drop an `actions` field from the rendered form.
   *
   * Memoized for an IDENTITY reason, not a fetch reason (objectui#4574,
   * ruled to the objectui#4567 producer-side pattern above). `ObjectForm`
   * lists `schema.fields` in its field-generation effect's dependency array
   * BY IDENTITY (plugin-form/src/ObjectForm.tsx). Built inline, this
   * allocated a fresh array on every render of the pillar, so that effect
   * (ending in `setFormFields(generatedFields)`) re-ran on every keystroke —
   * redundant recomputation, NOT a duplicate query: the effect is a pure
   * derivation, and the object-schema fetch and the record load are separate
   * effects, neither of which depends on `schema.fields`. Unlike #4567,
   * there is no `dataSource` call in this effect's dependency chain today —
   * but there is a latent hazard: if one is ever added there, this becomes a
   * #4567 with no producer-side change needed, because the identity is
   * already stable.
   *
   * Keyed on `objDraft.fields` rather than `objDraft`, same reasoning as
   * `gridColumns`: `onPatch` replaces the draft object while keeping
   * `fields` identical, so the looser key would churn (and re-run the form's
   * field-generation effect) on every unrelated draft edit (icon, label).
   */
  const formFieldsComputed = React.useMemo(() => formFieldNames(shownDraft.fields), [shownDraft.fields]);
  // objectstack#28575 — with an extension open, keyed on the names, as `gridColumns` is.
  const formFieldsExtKey = extOpen ? JSON.stringify(formFieldsComputed) : null;
  const formFields = React.useMemo(
    () => (formFieldsExtKey === null ? formFieldsComputed : (JSON.parse(formFieldsExtKey) as string[])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- with an extension open, the names alone key it
    [formFieldsExtKey ?? formFieldsComputed],
  );

  // objectui#12515 — what the Form tab's Preview renders. The draft differs
  // from the published definition when there is no published one, a pending
  // draft, or an unsaved edit; then Preview shows the draft unless the author
  // picked Published (offered only when a published version exists).
  const draftDiffers =
    !hasBaseline ||
    hasDraft ||
    dirty ||
    (extOpen !== null && (extHasDraft || extDirty));
  const previewShowsDraft = !hasBaseline || (draftDiffers && previewSource === 'draft');
  const previewDraft = previewShowsDraft ? shownDraft : null;
  const previewObjectName = current?.name ?? '';
  const previewDataSource = React.useMemo(
    () =>
      formPreviewSource(
        adapter,
        previewDraft ? { name: previewObjectName, definition: previewDraft } : null,
      ),
    [adapter, previewObjectName, previewDraft],
  );

  const onPatch = React.useCallback((patch: Record<string, unknown>) => {
    setObjDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  }, []);

  // "+ new object": create a fresh object in this package (runtime create —
  // same path the classic Studio editor uses), seeded with one text field so
  // the form/grid isn't empty, and land on Form · Layout. objectstack#36511 —
  // it is written as a draft, then that one object is published, so it is
  // live at once like every Save in Studio: no draft is left for a package
  // publish, and Changes and Publish stay for the AI assistant's drafts.
  const doCreateObject = React.useCallback(
    async (label: string, rawName: string, sharingModel: OwdCreateModel) => {
      if (packageReadOnly && !newInPair) return;
      setCreateBusy(true);
      setError(null);
      setCreateTaken(null);
      try {
        // objectstack#28572 (ADR-0146 D3) — on a read-only base the object is
        // created in its pair, which the ensure door answers (creating it on
        // first use, without a prompt): its id and its namespace come from
        // that answer, never from a spelling here.
        const target =
          packageReadOnly && customization
            ? await customization.ensurePackage()
            : { packageId: railPackageId, namespace };
        // Auto-prefix with the package namespace (framework#2694) so a prefix-less
        // object can't be authored; the rule lives in packages-io/spec.
        const name = prefixObjectName(rawName, target.namespace);
        // A name an object already holds, published or as a draft, on this
        // rail or in any other package, is refused here and nothing is
        // written: over a published object the first-write pin below would
        // write this blank skeleton as its pending draft
        // (`findTakenIdentifier`). The namespace prefix makes a clash with
        // another package's object rarer, not impossible.
        const onRail = objects.find((o) => o.name === name);
        const taken = onRail
          ? { name, label: onRail.label || name }
          : await findTakenIdentifier(client, 'object', name, locale);
        if (taken) {
          setCreateTaken({ ...taken, here: onRail !== undefined });
          return;
        }
        const body = buildObjectSkeleton(name, label, t('engine.studio.data.nameFieldLabel', locale), sharingModel);
        // objectui#11773 — and the door refuses a draft row too (the
        // first-write pin), for one that lands between the check above and
        // this save.
        await client.save('object', name, body, {
          mode: 'draft',
          packageId: target.packageId,
          ifNoneMatch: '*',
          surface: 'studio',
        });
        // objectstack#36511 — and published at once. A refused publish takes
        // back the draft it wrote, so nothing is created, and says why.
        const live = await publishSavedItem(client, { type: 'object', name, packageId: target.packageId }, false);
        if (!live.ok) {
          setError(plainRefusal(live.error));
          return;
        }
        const surface: Surface =
          target.packageId === railPackageId ? { type: 'object', name, label } : { type: 'object', name, label, addedIn: target.packageId };
        setObjects((prev) => [...prev, surface]);
        if (surface.addedIn) setRailNonce((n) => n + 1);
        setCurrent(surface);
        setViewMode('form');
        setFormMode('layout');
        setCreating(false);
        toast.success(tFormat('engine.studio.save.done', locale, { items: label }), { id: STUDIO_SAVE_TOAST_ID });
        // objectstack#36748 — and it joins the menu of its package's one app,
        // so an app made before its objects does not open empty. Only in the
        // rail's own package (not a customization pair); a failure keeps the
        // object and says the menu was left as it was.
        if (target.packageId === railPackageId && !packageReadOnly) {
          const join = await addNewObjectToAppMenu(
            client as unknown as Parameters<typeof addNewObjectToAppMenu>[0],
            { packageId: target.packageId, objectName: name },
            {
              notListed: t('engine.studio.data.appMenu.unreadable', locale),
              pendingDraft: t('engine.studio.data.appMenu.pendingDraft', locale),
              noVersion: t('engine.studio.data.appMenu.unreadable', locale),
              notWritable: t('engine.studio.data.appMenu.unreadable', locale),
            },
          );
          if (join.kind === 'failed') {
            const reason = plainRefusal(join.error).message;
            toast.warning(
              join.app
                ? tFormat('engine.studio.data.appMenu.failed', locale, {
                    object: label,
                    app: navItemLabelText(join.app.label, locale) || join.app.name,
                    reason,
                  })
                : tFormat('engine.studio.data.appMenu.failedNoApp', locale, { object: label, reason }),
            );
          }
        }
      } catch (e) {
        // Shown in the create dialog, which prints the message only: kept whole.
        setError(plainRefusal(e));
      } finally {
        setCreateBusy(false);
      }
    },
    [objects, client, railPackageId, packageReadOnly, newInPair, customization, locale, namespace],
  );

  // objectstack#34931 — a save the door refused `409 DESTRUCTIVE_CHANGE`, held
  // for the author's answer: what it would lose, and the save itself.
  const [destructive, setDestructive] = React.useState<ObjDraftSend & {
    findings: DestructiveChangeIssue[];
  } | null>(null);
  // The object as the server holds it for this buffer (as loaded, or as last
  // saved): what keeping a field restores it from.
  const objStoredRef = React.useRef<Record<string, unknown> | null>(null);
  // The buffer as last committed: a save that lands clears the dirty flag
  // only while the buffer is still the body it sent.
  const objDraftRef = React.useRef(objDraft);
  React.useLayoutEffect(() => {
    objDraftRef.current = objDraft;
  });

  // objectstack#36511 — the top bar's Save for the object: its draft, then that
  // object's own publish, so the save is live at once. A refused publish keeps
  // the edits on the page, unsaved, with the reason in the refusal strip.
  const doSave = React.useCallback(async (forced?: ObjDraftSend): Promise<StudioSaveResult> => {
    if (!current) return { kind: 'declined' };
    // objectui#10202 — the buffer was seeded from the served object, whose
    // picklist-bound fields carry the list's resolved `options`; the door
    // refuses them beside `picklist`, so they stay out of the body.
    // objectui#11785 — kept, so a refusal is read against what was sent.
    // objectstack#34931 — ⛔ a forced save is the refused save whole: its
    // body, to the address it wrote (`packageId` included), never re-derived.
    const { name, packageId: to, draft, body } =
      forced ?? { name: current.name, packageId, draft: objDraft, body: dropServedPicklistOptions(objDraft) };
    // A removed or retyped published field is asked about before anything is sent.
    if (!forced) {
      const changes = irreversibleFieldChanges(objStoredRef.current, draft, publishedFieldNames, locale);
      if (
        changes.length > 0 &&
        !window.confirm(tFormat('engine.studio.save.confirmIrreversible', locale, { changes: changes.join('\n') }))
      ) {
        return { kind: 'declined' };
      }
    }
    setSaving('draft');
    setError(null);
    const hadDraft = hasDraft;
    const storedBefore = objStoredRef.current;
    try {
      const outcome = await saveObjDraft('object', name, body, {
        mode: 'draft',
        packageId: to,
        surface: 'studio',
        ...(forced ? { force: true } : {}),
      });
      // objectui#11773 — the author chose the saved version; the load replaces the buffer.
      if (outcome === 'reloaded') return { kind: 'declined' };
      objStoredRef.current = draft;
      setHasDraft(true);
      setSaving('publish');
      // objectstack#36601 — pinned to the published row this buffer was loaded at.
      const live = await publishSavedItem(client, { type: 'object', name, packageId: to }, hadDraft, publishObj);
      // The published row moved and the author chose to reload: the load replaces the buffer.
      if (!live.ok && 'reloaded' in live) return { kind: 'declined' };
      if (!live.ok) {
        if (live.draftDiscarded) {
          objStoredRef.current = storedBefore;
          setHasDraft(false);
          recordObjRead('object', name, to, { ifNoneMatch: '*' });
        }
        // The published row moved and the author kept editing: read as the draft conflict's "not saved".
        const refusal = isPublishConflictKeptEditing(live.error)
          ? objectSaveRefusal(live.error, body, locale)
          : publishRefusal(publishFailureOf('object', name, live.error), 'object', body, locale);
        setError(refusal);
        return { kind: 'refused', reason: refusal.message };
      }
      // Live: no draft is left, so the next save asserts none. The pulse the
      // publish sent re-reads the object once this save has settled.
      setHasDraft(false);
      recordObjRead('object', name, to, { ifNoneMatch: '*' });
      if (JSON.stringify(objDraftRef.current) === JSON.stringify(draft)) setDirty(false);
      return { kind: 'saved' };
    } catch (e) {
      // objectstack#34931 — what the save would lose is asked about, once:
      // a forced save refused again reads as any other refusal.
      const findings = forced ? null : destructiveFindings(e);
      if (findings) {
        setDestructive({ name, packageId: to, draft, body, findings });
        return { kind: 'declined' };
      }
      const refusal = objectSaveRefusal(e, body, locale);
      setError(refusal);
      return { kind: 'refused', reason: refusal.message };
    } finally {
      setSaving(false);
    }
  }, [saveObjDraft, recordObjRead, publishObj, client, current, objDraft, hasDraft, publishedFieldNames, packageId, locale]);

  // objectstack#34931 — Cancel keeps what the refused save would have lost:
  // each field a finding names goes back as the server holds it, and nothing
  // is sent unless the buffer still differs from what is stored.
  const keepDestructive = React.useCallback(() => {
    const asked = destructive;
    const stored = objStoredRef.current;
    setDestructive(null);
    if (!asked || !stored) return;
    const was = readFields(stored.fields);
    const view = readFields(objDraft.fields);
    for (const { field } of asked.findings) {
      const at = was.entries.findIndex((e) => e.name === field);
      if (at < 0) continue;
      const i = view.entries.findIndex((e) => e.name === field);
      if (i < 0) view.entries.splice(Math.min(at, view.entries.length), 0, was.entries[at]);
      else view.entries[i] = was.entries[at];
    }
    const next = { ...objDraft, fields: writeFields(view) };
    setObjDraft(next);
    setDirty(JSON.stringify(next) !== JSON.stringify(stored));
  }, [destructive, objDraft]);

  // objectui#11786 — an edit whose body the write guard would refuse (a choice
  // field before its options, a relationship before its target) is held, not
  // sent: it stays dirty and on screen, the field's inspector hints what it
  // needs, and the line below names it. Asked of the guard on the body `doSave`
  // would send, so it holds exactly what the door would refuse.
  const objIncomplete = React.useMemo(
    () => (dirty ? objectHeldEdit(dropServedPicklistOptions(objDraft), locale) : null),
    [dirty, objDraft, locale],
  );

  // objectui#11272 — the buffer is the open object's own once its load installed it.
  const objLoaded = current !== null && objDraftFor === `object:${current.name}`;

  // objectstack#28575 — the ensure door's answer for this base's extension
  // writes: asked by the first add (no prompt), once per base, and again only
  // after a refusal.
  const extPairRef = React.useRef<{ base: string; asked: Promise<string> } | null>(null);
  const extPairFor = React.useCallback((custom: StudioBaseCustomization): Promise<string> => {
    const held = extPairRef.current;
    if (held && held.base === custom.base) return held.asked;
    const asked = custom.ensure();
    extPairRef.current = { base: custom.base, asked };
    asked.catch(() => {
      if (extPairRef.current?.asked === asked) extPairRef.current = null;
    });
    return asked;
  }, []);
  const extBodyRef = React.useRef(extOpen?.body ?? null);
  React.useLayoutEffect(() => {
    extBodyRef.current = extOpen?.body ?? null;
  });
  // The extension's Save, into the pair the door answered, then that
  // extension's own publish there (objectstack#36511): an installed app's
  // object takes the page's fields live at once, in its `.custom` package. A
  // refusal (the suffix, a structural key, the ensure door's walled 403) is
  // shown as the server sent it.
  const doSaveExt = React.useCallback(async (): Promise<StudioSaveResult> => {
    if (!extOpen || !customization) return { kind: 'declined' };
    const { for: name, body } = extOpen;
    setSaving('draft');
    setError(null);
    const hadDraft = extHasDraft;
    try {
      const pair = await extPairFor(customization);
      const outcome = await saveExtDraft(OBJECT_EXTENSION_TYPE, name, extensionBodyForSave(body), {
        mode: 'draft',
        packageId: pair,
        surface: 'studio',
      });
      if (outcome === 'reloaded') return { kind: 'declined' };
      setExtHasDraft(true);
      setSaving('publish');
      const live = await publishSavedItem(client, { type: OBJECT_EXTENSION_TYPE, name, packageId: pair }, hadDraft);
      if (!live.ok) {
        if (live.draftDiscarded) {
          setExtHasDraft(false);
          recordExtRead(OBJECT_EXTENSION_TYPE, name, pair, { ifNoneMatch: '*' });
        }
        const refusal = publishRefusal(
          publishFailureOf(OBJECT_EXTENSION_TYPE, name, live.error),
          OBJECT_EXTENSION_TYPE,
          extensionBodyForSave(body),
          locale,
        );
        setError(refusal);
        return { kind: 'refused', reason: refusal.message };
      }
      setExtHasDraft(false);
      recordExtRead(OBJECT_EXTENSION_TYPE, name, pair, { ifNoneMatch: '*' });
      if (JSON.stringify(extBodyRef.current) === JSON.stringify(body)) setExtDirty(false);
      return { kind: 'saved' };
    } catch (e) {
      const refusal = plainRefusal(e);
      setError(refusal);
      return { kind: 'refused', reason: refusal.message };
    } finally {
      setSaving(false);
    }
  }, [extOpen, customization, extPairFor, saveExtDraft, recordExtRead, client, extHasDraft, locale]);
  // An edit of the folded object's fields, written into the extension: an
  // extension field whole, a base field's whitelisted change as its patch.
  const onExtFieldsPatch = React.useCallback(
    (patch: Record<string, unknown>) => {
      if (!extWritable || !('fields' in patch)) return;
      setExt((prev) => {
        if (!prev) return prev;
        const before = foldObjectExtension(objDraft, prev.body, prev.published).fields;
        const baseOwned = baseOwnedFieldNames(objDraft, prev.body, prev.published);
        return { ...prev, body: routeFoldedFieldsEdit({ before, after: patch.fields, baseOwned, ext: prev.body }) };
      });
      setExtDirty(true);
    },
    [extWritable, objDraft],
  );
  // objectstack#27485 — an unsent edit the CEL verdict holds is named like an
  // incomplete one: the held line, the surface's Publish and the rail's
  // question all read it, so it outlives the inspector without going unseen.
  // objectstack#27629 — then a rule or action the panel family holds.
  const celHeldField = celHeldFields[0] ?? null;
  const celHeldLabel = React.useMemo(() => {
    if (celHeldField === null) return null;
    const label = readFields(objDraft.fields).entries.find((e) => e.name === celHeldField)?.def.label;
    return typeof label === 'string' && label.trim() !== '' ? label.trim() : celHeldField;
  }, [celHeldField, objDraft.fields]);
  const celHeldPanelTab = celHeldPanelItems[0]?.tab ?? null;
  const celHeldPanelItem = celHeldPanelItems[0]?.item ?? null;
  const celHeldPanelLabel = React.useMemo(() => {
    if (celHeldPanelTab === null || celHeldPanelItem === null) return null;
    const label = panelItemOf(objDraft, celHeldPanelTab, celHeldPanelItem)?.label;
    return typeof label === 'string' && label.trim() !== '' ? label.trim() : celHeldPanelItem;
  }, [celHeldPanelTab, celHeldPanelItem, objDraft]);
  const objCelHeld = React.useMemo<StudioHeld | null>(() => {
    if (!dirty) return null;
    if (celHeldField !== null && celHeldLabel !== null) {
      return {
        clause: tFormat('engine.studio.held.celInvalid', locale, { field: celHeldLabel }),
        target: { kind: 'field', id: celHeldField },
      };
    }
    if (celHeldPanelTab !== null && celHeldPanelItem !== null && celHeldPanelLabel !== null) {
      return celHeldPanelTab === 'rules'
        ? {
            clause: tFormat('engine.studio.held.celInvalidRule', locale, { rule: celHeldPanelLabel }),
            target: { kind: 'rule', id: celHeldPanelItem },
          }
        : {
            clause: tFormat('engine.studio.held.celInvalidAction', locale, { action: celHeldPanelLabel }),
            target: { kind: 'action', id: celHeldPanelItem },
          };
    }
    return null;
  }, [dirty, celHeldField, celHeldLabel, celHeldPanelTab, celHeldPanelItem, celHeldPanelLabel, locale]);
  // Only the open object's own buffer is held (objectui#11272).
  const objHeld = objLoaded ? (objIncomplete ?? objCelHeld) : null;
  // objectstack#26917 — the refusal's way out: the object holding the
  // identifier is on this rail, so it opens instead of a second one being
  // made. The New button already asked about a held edit (objectstack#26845).
  const openTakenObject = (name: string) => {
    const object = objects.find((o) => o.name === name);
    if (!object) return;
    setCreating(false);
    setCreateTaken(null);
    setCurrent(object);
  };
  // objectui#12725 — the copilot's mark on the selected field: its key path is
  // `["fields", NAME]` in the object body, and only a `copilot` write answers —
  // or, objectstack#27176, an `mcp` one: an agent through the MCP build door.
  const fieldAgentMark =
    objLoaded && fieldSel?.kind === 'field' ? agentDraftMarkOf(objDraftChanges, ['fields', fieldSel.id]) : null;
  // objectstack#34725 — the same marks on the canvas: the records grid's
  // column header and the Form canvas's field card of every field an AI tool
  // changed in the pending draft, read off the same `draftChanges` (no other
  // read), and the line over the canvas counting the draft's AI entries.
  const agentDraftChanges = objLoaded ? objDraftChanges : null;
  const agentDraftCount = React.useMemo(
    () => (agentDraftChanges ?? []).filter((change) => isAgentDraftSurface(change.by)).length,
    [agentDraftChanges],
  );
  const shownFieldNamesKey = readFields(shownDraft.fields).entries.map((e) => e.name).join('\n');
  const agentMarkedFields = React.useMemo<ReadonlySet<string>>(() => {
    const marked = new Set<string>();
    if (!agentDraftChanges || !shownFieldNamesKey) return marked;
    for (const name of shownFieldNamesKey.split('\n')) {
      if (agentDraftMarkOf(agentDraftChanges, ['fields', name])) marked.add(name);
    }
    return marked;
  }, [agentDraftChanges, shownFieldNamesKey]);
  const agentColumnMarks = React.useMemo(() => {
    if (agentMarkedFields.size === 0) return undefined;
    const marks: Record<string, React.ReactNode> = {};
    for (const name of agentMarkedFields) {
      marks[name] = <DraftChip locale={locale} of={name} testId="studio-grid-column-draft-chip" />;
    }
    return marks;
  }, [agentMarkedFields, locale]);
  // objectstack#36511 item 6 — 放弃 AI 的改动: this one object's pending draft is
  // discarded at the package it was read at (`DELETE /meta/object/NAME?state=draft`),
  // so the page goes back to the live version and Changes counts one item
  // fewer. Edits on the page not yet saved go with it, asked first.
  const [discardingItemDraft, setDiscardingItemDraft] = React.useState(false);
  const discardItemDraft = React.useCallback(async () => {
    if (!current) return;
    if (dirty && !window.confirm(t('engine.studio.aiDraft.discardConfirmUnsaved', locale))) return;
    setDiscardingItemDraft(true);
    setError(null);
    try {
      await client.reset('object', current.name, { state: 'draft', ...(packageId ? { packageId } : {}) });
      setHasDraft(false);
      setDestructive(null);
      // The load installs the live version and pins the next save to it.
      reloadObjDraft();
      // The ledger behind Changes re-reads on the pulse, one item fewer.
      emitMetadataRefresh();
    } catch (e) {
      const refusal = plainRefusal(e);
      setError({ ...refusal, message: tFormat('engine.studio.aiDraft.discardFailed', locale, { reason: refusal.message }) });
    } finally {
      setDiscardingItemDraft(false);
    }
  }, [client, current, dirty, locale, packageId, reloadObjDraft]);
  // 放弃全部未发布改动 — the package's discard door (`packages.discardDrafts`),
  // which drops every pending draft of the package, the author's own too; the
  // confirm says so. There is no per-turn undo.
  const [discardingDrafts, setDiscardingDrafts] = React.useState(false);
  const discardAllDrafts = React.useCallback(async () => {
    if (!adapter || !window.confirm(t('engine.studio.copilotChanges.discardConfirm', locale))) return;
    setDiscardingDrafts(true);
    try {
      const result = await adapter.getClient().packages.discardDrafts(packageId);
      if (!result.success || result.failedCount > 0) {
        // The sentence names each item as the rail does (its label, else its
        // name); the server's own words stay behind Details, never in it.
        const labelOf = (f: { type: string; name: string }) =>
          (f.type === 'object' && objects.find((o) => o.type === 'object' && o.name === f.name)?.label) || f.name;
        const items = [...new Set(result.failed.map(labelOf))].join(
          t('engine.studio.copilotChanges.itemSeparator', locale),
        );
        setError({
          message: tFormat('engine.studio.copilotChanges.discardFailed', locale, { items }),
          detail: result.failed.map((f) => `${f.type}/${f.name}: ${f.error}`).join('\n') || undefined,
        });
      }
    } catch (e) {
      setError(plainRefusal(e));
    } finally {
      setDiscardingDrafts(false);
      reloadObjDraft();
      emitMetadataRefresh();
    }
  }, [adapter, locale, objects, packageId, reloadObjDraft]);
  useHeldEditReport(onHeldEditChange, objHeld?.clause ?? null);
  // objectstack#36511 — the object page's buffers, saved and cancelled by the
  // top bar's one Save and Cancel: the object (its fields, rules, actions and
  // settings), then a read-only base's extension of it in the pair. A CEL
  // verdict no field or rule names yet (Settings reports one count) holds the
  // Save as a named edit does.
  const objSaveHeld =
    objHeld?.clause ??
    (saveBlocking > 0 && current
      ? tFormat('engine.studio.held.inspectorInvalid', locale, { item: current.label || current.name })
      : null);
  useStudioSaveEntry(
    current && objLoaded && !readOnly
      ? {
          label: current.label || current.name,
          order: 0,
          dirty,
          held: objSaveHeld,
          save: () => doSave(),
          cancel: () => {
            setDestructive(null);
            reloadObjDraft();
          },
        }
      : null,
  );
  useStudioSaveEntry(
    current && extOpen !== null && extWritable
      ? {
          label: current.label || current.name,
          order: 1,
          dirty: extDirty,
          held: saveBlocking > 0 ? tFormat('engine.studio.held.inspectorInvalid', locale, { item: current.label || current.name }) : null,
          save: () => doSaveExt(),
          cancel: reloadExt,
        }
      : null,
  );
  // objectstack#36511 — the Hooks tab's buffer lives here, not in its panel,
  // so an edit outlives a tab switch and the top bar's Save still sends it.
  const hooksBuffer = useObjectHooksBuffer({
    objectName: current?.name ?? '',
    packageId,
    active: viewMode === 'hooks',
    disabled: readOnly,
    publishNonce,
  });
  // objectstack#36511 — opening another object replaces the buffers the open
  // object's unsaved edits live in, so the author is asked first, as every
  // departure asks (objectstack#26705); nothing is sent by the switch.
  // objectstack#30088 — a base object's new actions are items of the pair;
  // objectstack#36511 — read and buffered here, as the hooks are.
  const pairDoor: PairActionsDoor | null =
    extendsBase && customization
      ? {
          pairId: railPairId,
          ensure: customization.ensure,
          walled: customization.walled,
          marks: railMarks,
          publishNonce,
          onDraftSaved,
        }
      : null;
  const pairActions = usePairObjectActions(pairDoor, current?.name ?? '', viewMode === 'actions');
  const pageDirty = dirty || extDirty || hooksBuffer.dirty || pairActions.dirty;
  const openObject = React.useCallback(
    (next: Surface): boolean => {
      if (next.name !== current?.name && !confirmDropUnsavedWork(pageDirty, locale)) return false;
      setCurrent(next);
      return true;
    },
    [current, pageDirty, locale],
  );
  // The live request's apply (see `requestedSurface` above). objectstack#26845
  // — another object's load replaces the buffer a held edit lives in, so it
  // goes through the rail's own switch (`openObject`): an unsent edit is sent
  // first, or the author is asked; declined, the request is spent and the
  // edit stays. A request for the open object drops nothing and asks nothing.
  React.useEffect(() => {
    if (!requestedSurface || !objectsLoaded) return;
    if (requestedSurface.id === appliedRequestRef.current) return;
    appliedRequestRef.current = requestedSurface.id;
    const match = resolveSurfaceDeepLink(objects, requestedSurface.target, 'object');
    if (!match) return;
    openObject(match);
  }, [requestedSurface, objects, objectsLoaded, openObject]);
  // objectstack#26845 — a created object opens at once, and its load replaces
  // the buffer a held edit lives in: asked before the dialog opens, so Cancel
  // costs nothing and the create itself asks nothing.
  const openCreateObject = () => {
    if (!confirmDropUnsavedWork(objHeld !== null, locale)) return;
    openCreateDialog();
  };
  // objectui#12725 — the header's draft line reads the badge's ledger.
  const objDraftStatus = useStudioItemDraftStatus(
    current ? { type: 'object', name: current.name } : null,
    hasDraft && objLoaded,
    locale,
  );

  // "+ add field": append a field with the label and type the Add field
  // popover asked for (objectui#12516) and select it for editing in the panel.
  // Guarded in addition to being hidden — it's also reachable through
  // GridFieldAuthoringProvider/ObjectFormDesigner.
  // objectui#13389 — `typedName` is the api name the popover asked for when
  // the label derived none (or a taken one); otherwise it is derived here.
  const addField = React.useCallback((label: string, type: FieldTypeId, typedName?: string) => {
    // objectui#11272 — never onto another object's buffer (not offered then).
    if (!objLoaded || objIsExternal) return;
    // objectstack#28575 (ADR-0146 D10) — on a read-only base's object the
    // field is the customer's own, `__c`, declared in the pair's extension of
    // it; the base object's buffer is never touched. Create asks the ensure
    // door for the pair (no prompt); the extension's autosave writes there.
    if (extendsBase) {
      if (!extWritable || !customization) return;
      const existing = readFields(shownDraft.fields).entries.map((e) => e.name);
      const asked = typedName ? extensionFieldName(typedName) : '';
      const name = asked && !existing.includes(asked) ? asked : addedExtensionFieldName(label, existing);
      const { def } = newField(name, type, label);
      setExt((prev) =>
        prev ? { ...prev, body: { ...prev.body, fields: { ...extensionFieldsOf(prev.body), [name]: def } } } : prev,
      );
      setExtDirty(true);
      setFieldSel({ kind: 'field', id: name });
      extPairFor(customization).catch((e: unknown) => setError(plainRefusal(e)));
      return;
    }
    if (readOnly) return;
    const view = readFields(objDraft.fields);
    const existing = view.entries.map((e) => e.name);
    const name = typedName && !existing.includes(typedName) ? typedName : addedFieldName(label, existing);
    view.entries.push(newField(name, type, label));
    setObjDraft((d) => ({ ...d, fields: writeFields(view) }));
    setDirty(true);
    setFieldSel({ kind: 'field', id: name });
  }, [objDraft, readOnly, objLoaded, objIsExternal, extendsBase, extWritable, customization, shownDraft, extPairFor]);
  // objectstack#28575 — a read-only base's object takes fields into its pair,
  // unless the ensure door is walled for this caller (drawn disabled below).
  const canAddFields = !objIsExternal && (extendsBase ? extWritable : !readOnly);
  const addFieldTakenNames = React.useMemo(
    () => readFields(shownDraft.fields).entries.map((e) => e.name),
    [shownDraft.fields],
  );

  // objectui#12516 — the Records grid's "+" column opens the same popover. The
  // grid draws that button from its authoring context and hands no element
  // back, so the popover is placed against the records body's top-right
  // corner, and the button is remembered (from the click on its way down) to
  // take focus back when the popover closes.
  const [gridAddFieldOpen, setGridAddFieldOpen] = React.useState(false);
  const gridAddFieldButton = React.useRef<HTMLElement | null>(null);
  // Scopes the selected-header outline rule to this records body.
  const recordsColumnsScope = React.useId();
  // objectstack#35061 — a field selected while the Records grid is open (by
  // its header, or from the field list) has its column scrolled into view:
  // not under the frozen name column, not past the right edge.
  const recordsBodyRef = React.useRef<HTMLDivElement | null>(null);
  const selectedFieldId = fieldSel?.kind === 'field' ? fieldSel.id : null;
  React.useEffect(() => {
    if (viewMode !== 'grid' || selectedFieldId === null) return;
    const header = Array.from(recordsBodyRef.current?.querySelectorAll('thead th[data-column-key]') ?? []).find(
      (th) => th.getAttribute('data-column-key') === selectedFieldId,
    );
    if (header) revealColumn(header);
  }, [viewMode, selectedFieldId]);
  // objectstack#34794 — what the Records toolbar's Add field creates with.
  const gridAddFieldCreate = React.useMemo<StudioGridAddFieldValue>(
    () => ({ onCreate: addField, takenNames: addFieldTakenNames, extensionField: extendsBase }),
    [addField, addFieldTakenNames, extendsBase],
  );

  // Drag-reorder columns → reorder the object's `fields` metadata (field display
  // order follows metadata order). objectstack#36511 — an edit of the buffer
  // like any other: it is sent by the top bar's Save, never on the drop.
  const doReorderFields = React.useCallback(
    (orderedNames: string[]) => {
      // objectui#11272 — never onto another object's buffer.
      if (!current || !objLoaded || readOnly) return;
      const view = readFields(objDraft.fields);
      // Reorder only the visible fields among their own slots; keep system /
      // hidden fields (not shown as columns) in their original positions.
      const visible = new Set(orderedNames);
      const visibleInOrder = orderedNames
        .map((n) => view.entries.find((e) => e.name === n))
        .filter((e): e is (typeof view.entries)[number] => Boolean(e));
      let vi = 0;
      const entries = view.entries.map((e) => (visible.has(e.name) ? visibleInOrder[vi++] : e));
      setObjDraft({ ...objDraft, fields: writeFields({ ...view, entries }) });
      setDirty(true);
      setGridVer((v) => v + 1); // remount so the grid reflects the new order
    },
    [current, objLoaded, readOnly, objDraft],
  );

  // Observed (objectui#11939): an object inspector registered after this pillar
  // rendered fills the field rail below without a remount.
  const inspector = useRegisteredMetadataInspector('object');
  // objectstack#28575 — on a base object the field rail is writable (into the
  // pair's extension) for a field, never for a group; a base field opens in
  // the inspector's display-property mode. The rail's read-only reason wrapper
  // is then not drawn: the inspector describes each control it locks there
  // (objectstack#28986).
  // objectstack#29786 — the open base object's fields another package
  // contributes (the base's one customization read): greyed in the Form
  // layout, and read-only in this rail whatever the pair could write, since
  // neither the base nor its pair owns them.
  const customizationMarks = customization?.marks;
  const contributedFields = React.useMemo(
    () => contributedFieldsOf(baseContributionsOf(customizationMarks), current?.name),
    [customizationMarks, current?.name],
  );
  const selectedContributedField =
    fieldSel?.kind === 'field' ? (contributedFields.get(String(fieldSel.id)) ?? null) : null;
  const fieldRailReadOnly = (readOnly && !(extWritable && fieldSel?.kind === 'field')) || selectedContributedField !== null;
  const selectedBaseField =
    extWritable &&
    fieldSel?.kind === 'field' &&
    selectedContributedField === null &&
    baseOwnedFields !== null &&
    baseOwnedFields.has(String(fieldSel.id));
  const addFieldWalledId = React.useId();
  // objectstack#35018 — the field rail draws ONE header: the aside's names the
  // field (its label, one close) and the shared field inspector below draws
  // none of its own (`InspectorShellHostProvider`, the flow inspector's
  // objectui#12488 seam); its actions sit in this header's slot. The field's
  // machine name is not in the header: it is the inspector's 开发者信息.
  const [fieldHeaderSlot, setFieldHeaderSlot] = React.useState<HTMLElement | null>(null);
  const fieldRailHosted = fieldSel?.kind === 'field' && Boolean(inspector);
  const fieldRailTitle = React.useMemo(() => {
    if (fieldSel?.kind !== 'field') return undefined;
    const entry = readFields(shownDraft.fields).entries.find((e) => e.name === fieldSel.id);
    const label = entry?.def.label;
    return typeof label === 'string' && label ? label : String(fieldSel.id);
  }, [fieldSel, shownDraft.fields]);

  // objectui#12725 — the field rail is up exactly when the render below draws
  // it; that is when the pillar holds the slot's properties half. A selection
  // asks for them, keyed on its identity, as the Interfaces pillar does.
  const fieldRailShown = Boolean(current && fieldSel && objLoaded);
  const claimSlotProps = slot?.claimProps;
  React.useEffect(
    () => (claimSlotProps && fieldRailShown ? claimSlotProps() : undefined),
    [claimSlotProps, fieldRailShown],
  );
  const showSlotProps = slot?.showProps;
  React.useEffect(() => {
    if (fieldRailShown && fieldSelKey && showSlotProps) showSlotProps();
  }, [fieldRailShown, fieldSelKey, showSlotProps]);
  // objectui#12725 — a click on empty canvas (the body's own padding, or the
  // Form preview's frame and the space between its fields) drops the
  // selection, as Esc does.
  const clearFieldSelOnEmpty = (e: React.MouseEvent) => {
    if (inSlot && e.target === e.currentTarget) setFieldSel(null);
  };
  // The field rail in the slot (filling it), or beside the canvas (the
  // classic layout).
  const hostFieldRail = (rail: React.ReactElement): React.ReactNode =>
    inSlot ? slotPropsTarget && createPortal(rail, slotPropsTarget) : rail;

  // The object-level tabs (Data pillar): underline tabs in the item header.
  // objectui#5813 — the 90% path is Records / Form (fields ARE the grid's
  // columns, so a separate fields tab would ADD a surface, not remove one).
  // objectui#12450 — the five power panels are flat tabs beside them when the
  // content column has room, and fold back into one "Advanced" menu when it
  // does not (maintainer ruling 2026-10-15, decision B of epic objectui#12446;
  // the rule lives in `dataTabsFold.ts`).
  const dataTabs: ReadonlyArray<{ key: typeof viewMode; label: string }> = [
    { key: 'grid', label: t('engine.studio.data.tab.records', locale) },
    { key: 'form', label: t('engine.studio.data.tab.form', locale) },
  ];
  const advancedDataTabs: ReadonlyArray<{ key: typeof viewMode; label: string }> = [
    { key: 'rules', label: t('engine.studio.data.tab.rules', locale) },
    { key: 'hooks', label: t('engine.studio.data.tab.hooks', locale) },
    { key: 'actions', label: t('engine.studio.data.tab.actions', locale) },
    { key: 'api', label: t('engine.studio.data.tab.api', locale) },
    { key: 'settings', label: t('engine.studio.data.tab.settings', locale) },
  ];
  const activeAdvancedTab = advancedDataTabs.find((tabDef) => tabDef.key === viewMode);
  // objectui#12450 — the Records grid draws flush with the content column.
  const recordsFlush = Boolean(current) && objLoaded && viewMode === 'grid' && hasBaseline;
  // objectui#12451 — so does the Form tab: its one toolbar row spans the
  // column, and the canvas below it carries its own padding.
  const formFlush = Boolean(current) && objLoaded && viewMode === 'form';
  const bodyFlush = recordsFlush || formFlush;
  // objectui#12451 — the Form tab's compact Layout / Preview control (24 px
  // items). The caption that used to trail it is each item's title.
  const formModeItem = (active: boolean) =>
    cn(
      'h-6 rounded px-2.5 text-xs transition-colors',
      active ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
    );
  const formModeControl = (
    <div className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      <button
        type="button"
        onClick={() => setFormMode('layout')}
        aria-pressed={formMode === 'layout'}
        // The caption used to assert "your unsaved changes" from `formMode`
        // alone — a TAB selector — so it claimed pending edits on every clean
        // layout tab, including in a read-only package where `Save draft` is
        // disabled and the designer has no draggable at all (objectui#4036).
        // Say it only when it is true: real local edits, on a surface that can
        // save them. A read-only package is asked first: it has no draft layout
        // at all, so neither draft caption is true of it (objectui#11781), and
        // its read-only sentence is the header link's title (objectui#12453).
        title={
          readOnly
            ? undefined
            : dirty
              ? t('engine.studio.data.form.layoutBadge', locale)
              : t('engine.studio.data.form.layoutBadgeClean', locale)
        }
        className={formModeItem(formMode === 'layout')}
      >
        {t('engine.studio.data.form.layout', locale)}
      </button>
      <button
        type="button"
        onClick={() => setFormMode('preview')}
        aria-pressed={formMode === 'preview'}
        title={t('engine.studio.data.form.previewBadge', locale)}
        className={formModeItem(formMode === 'preview')}
      >
        {t('engine.studio.data.form.preview', locale)}
      </button>
    </div>
  );
  // objectstack-ai/objectstack#36425 — the create and edit dialogs lay out by
  // the object's field groups, never by an internal form view, so the Form tab
  // always edits the field groups and says so.
  const formLayoutSource = current ? (
    <div className="inline-flex items-center gap-2" data-testid="form-layout-source">
      <span
        data-testid="form-layout-source-chip"
        data-source="field-groups"
        title={t('engine.studio.data.form.layoutSource.fieldGroupsTitle', locale)}
        className="inline-flex h-6 items-center rounded bg-muted px-2 text-[11px] text-muted-foreground"
      >
        {t('engine.studio.data.form.layoutSource.fieldGroups', locale)}
      </span>
    </div>
  ) : null;
  // objectstack#28575 — on a base object the Form toolbar's Add field sits
  // beside the Layout / Preview control: the designer, read-only on a base
  // object, draws none, and the field goes into the pair's extension.
  const formToolbarLeading =
    extendsBase && canAddFields ? (
      <div className="inline-flex items-center gap-2">
        {formModeControl}
        {formLayoutSource}
        <AddFieldPopover onCreate={addField} takenNames={addFieldTakenNames} extensionField align="start">
          <button
            type="button"
            data-testid="data-form-add-extension-field"
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary/10 px-2.5 text-xs font-medium text-primary hover:bg-primary/15"
          >
            <Plus className="h-3.5 w-3.5" /> {t('engine.studio.data.addField', locale)}
          </button>
        </AddFieldPopover>
      </div>
    ) : (
      <div className="inline-flex items-center gap-2">
        {formModeControl}
        {formLayoutSource}
      </div>
    );

  // The selected object's own icon (from its metadata) — prefer the loaded
  // draft body, fall back to the rail header. getIcon degrades to Database.
  const HeaderIcon = getIcon(
    objLoaded && typeof objDraft.icon === 'string' ? (objDraft.icon as string) : current?.icon,
  );
  // objectstack#35985 — and its palette colour, so the header draws the tile
  // the console's menu draws for it; the draft's, as it is being edited.
  const headerColor = objLoaded && typeof objDraft.color === 'string' ? (objDraft.color as string) : current?.color;

  // objectui#12459 — the object's tab row lives in the item header (the
  // skeleton's scaffold). objectui#12450 — seven flat tabs at a content column
  // of `DATA_TABS_FOLD_WIDTH` and wider; narrower, the five power panels fold
  // into "Advanced". Both forms are rendered and a container query on the
  // content column displays exactly one of them (see `dataTabsFold.ts`).
  // Folded, the trigger keeps its own name whichever panel is open
  // (objectui#11794): renamed to the panel ("Validations ▾") it hid the one
  // word that says sibling panels sit behind it. Where you are still shows
  // twice — the trigger takes the active look while one of its panels is
  // open, and the menu marks that panel as the checked radio item.
  const dataTabRowEl = current ? (
    <>
      {dataTabs.map((tab) => (
        <StudioTab key={tab.key} active={viewMode === tab.key} onClick={() => selectViewMode(tab.key)}>
          {tab.label}
        </StudioTab>
      ))}
      {advancedDataTabs.map((tab) => (
        <StudioTab
          key={tab.key}
          data-testid={`data-tab-flat-${tab.key}`}
          active={viewMode === tab.key}
          onClick={() => selectViewMode(tab.key)}
          className={DATA_TAB_FLAT_ONLY}
        >
          {tab.label}
        </StudioTab>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <StudioTab data-testid="data-tabs-advanced" active={Boolean(activeAdvancedTab)} className={DATA_TAB_FOLDED_ONLY}>
            {t('engine.studio.data.tab.advanced', locale)}
            <ChevronDown className="h-3 w-3" />
          </StudioTab>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {/* The group only marks which item is checked; each item
              selects its own panel, as the plain items did. */}
          <DropdownMenuRadioGroup value={activeAdvancedTab?.key ?? ''}>
            {advancedDataTabs.map((tab) => (
              <DropdownMenuRadioItem key={tab.key} value={tab.key} onSelect={() => selectViewMode(tab.key)}>
                {tab.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  ) : undefined;

  const objectNeedle = query.trim().toLowerCase();
  // objectstack#28572 — "only customizations" narrows the rail to its marked rows.
  const markedObjects = railMarks ? objects.filter((o) => railMarks.markOf(o) !== null).length : 0;
  const shownObjects = objects.filter(
    (o) =>
      (!objectNeedle || o.label.toLowerCase().includes(objectNeedle) || o.name.toLowerCase().includes(objectNeedle)) &&
      (!onlyCustomized || railMarks?.markOf(o) != null),
  );

  return (
    <div ref={pillarRef} className="flex h-full flex-col">
      {objConflictDialog}
      {/* objectstack#36511 — the hooks' and the pair actions' buffers', here: a Save may ask while their tab is closed. */}
      {hooksBuffer.dialog}
      {pairActions.dialog}
      {/* objectstack#34931 — the door's other 409: confirmed, it is sent again forced; else what it would lose is kept. */}
      <AlertDialog open={destructive !== null} onOpenChange={(open) => !open && keepDestructive()}>
        <AlertDialogContent data-testid="object-destructive-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('engine.edit.destructiveTitle', locale)}</AlertDialogTitle>
            <AlertDialogDescription>{t('engine.edit.destructiveDesc', locale)}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-64 space-y-1 overflow-auto text-sm">
            {destructive?.findings.map((f, i) => (
              <li key={i} className="border-l-2 border-amber-500 pl-2">
                {f.message}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <Button variant="ghost" data-testid="object-destructive-keep" onClick={keepDestructive}>
              {t('engine.cancel', locale)}
            </Button>
            <Button
              variant="destructive"
              data-testid="object-destructive-force"
              onClick={() => {
                if (!destructive) return;
                setDestructive(null);
                const label = current?.label || destructive.name;
                void doSave(destructive).then((result) => {
                  if (result.kind === 'saved') toast.success(tFormat('engine.studio.save.done', locale, { items: label }));
                });
              }}
            >
              {t('engine.edit.forceSave', locale)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {extConflictDialog}
      <div className="relative flex min-h-0 flex-1">
        {isMobile && railOpen && (
          <div
            className="absolute inset-0 z-10 bg-black/30"
            onClick={() => setRailOpen(false)}
            aria-hidden="true"
          />
        )}
        <StudioRail
          testId="studio-rail-data"
          heading={t('engine.studio.data.objects', locale)}
          count={objects.length}
          onAdd={packageReadOnly && !newInPair ? undefined : openCreateObject}
          addLabel={t('engine.studio.data.newObject', locale)}
          addTestId="studio-rail-add"
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t('engine.studio.data.searchObjects', locale),
            matchCount: shownObjects.length,
          }}
          filters={
            <RailCustomizationFilter
              marks={railMarks}
              marked={markedObjects}
              on={onlyCustomized}
              onToggle={toggleOnlyCustomized}
              locale={locale}
            />
          }
          isMobile={isMobile}
          open={railOpen}
        >
          {objects.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">
              {error ? t('engine.studio.loadFailed', locale) : objectsLoaded ? t('engine.studio.data.noObjects', locale) : t('engine.studio.loading', locale)}
            </p>
          )}
          {shownObjects.map((o) => {
            const Icon = getIcon(o.icon);
            return (
              <StudioRailRow
                key={o.name}
                active={current?.name === o.name}
                onClick={() => {
                  // objectstack#26705, objectstack#27511 — another object's load
                  // replaces the buffer the open one's edits live in: they are
                  // sent first, or the author is asked (`openObject`).
                  if (openObject(o) && isMobile) setRailOpen(false);
                }}
                icon={<ObjectIconTile glyph={Icon} color={o.color} />}
                trailing={<RailCustomizationMark row={o} marks={railMarks} locale={locale} />}
              >
                {o.label}
              </StudioRailRow>
            );
          })}
        </StudioRail>

        <div className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', DATA_CONTENT_CONTAINER)} data-testid="data-content-column">
          {/* objectui#12459 — the object header sits inside the content column,
              over the thing it names, instead of spanning the rail. */}
          <StudioItemHeader
            testId="data-object-header"
            // objectstack#29693 — the header has no ⋯ of its own (objectui#12511),
            // so on a narrow row it draws one for the chips and the item tools.
            foldMenu={{ label: t('engine.studio.if.more', locale), testId: 'data-object-header-more' }}
            // objectstack#29691 (ADR-0146 D3) — an object the pair adds, or a
            // base object the pair extends, saves to the base's pair. Named
            // by the base's label: `packageId` names the pair for a pair's object.
            note={
              customization !== null &&
              (!!current?.addedIn ||
                (extOpen !== null && (extOpen.published.size > 0 || extHasDraft || extDirty))) ? (
                <SavedToCustomizationNote
                  baseLabel={customization.baseLabel}
                  pairId={customization.pairId ?? pairIdOf(customization.base)}
                  testId="data-object-saved-to"
                />
              ) : undefined
            }
            leading={
              <button
                type="button"
                onClick={() => setRailOpen((v) => !v)}
                aria-label={t('engine.studio.toggleRail', locale)}
                className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>
            }
            icon={current ? HeaderIcon : undefined}
            objectTile={current ? { color: headerColor } : undefined}
            title={current ? current.label : t('engine.studio.data.objects', locale)}
            // objectstack#34794 — the object's machine name is the title's
            // tooltip, not a chip beside it: the header reads as the label
            // the app shows, and the name stays one hover away.
            titleProps={current ? { title: current.name } : { className: 'text-[13px] font-normal text-muted-foreground' }}
            chips={current?.addedIn ? <StudioPairItemChip pairId={current.addedIn} locale={locale} /> : undefined}
            meta={current && objLoaded ? fieldCountText : undefined}
            status={objDraftStatus}
            actions={
              <>
                {/* objectstack#28239 — the item tools Setup's item page opens. */}
                {current && objLoaded && (
                  <StudioItemTools
                    type="object"
                    name={current.name}
                    packageId={packageId}
                    readOnly={readOnly}
                    source={{
                      value: objDraft,
                      onChange: objIsExternal
                        ? undefined
                        : (next) => {
                            setObjDraft(next);
                            setDirty(true);
                          },
                    }}
                    onRolledBack={() => setObjReloadNonce((n) => n + 1)}
                    locale={locale}
                  />
                )}
                {/* objectui#12511 — the header holds no actions of its own, so
                    it reads the same on every tab. Object settings retired: the
                    Settings tab is that control. Add field is a field action,
                    offered where fields are laid out: the Form toolbar, the
                    Records toolbar (objectstack#34794) and the Records grid's
                    own "+" column, all opening the Add field popover that
                    runs `addField` (objectui#12516). The
                    More menu went with it, since the header has no object-level
                    action left to put in one. */}
                {/* objectui#12453 — on the Form tab it carries the layout's
                    read-only sentence the Layout control no longer does. */}
                {/* objectstack#28575 — the ensure door refuses this caller: Add
                    field draws disabled, in the console's own sentence. */}
                {extendsBase && extWalled && objLoaded && !objIsExternal && (viewMode === 'grid' || viewMode === 'form') && (
                  <span
                    tabIndex={0}
                    title={t('engine.studio.customize.walled', locale)}
                    aria-describedby={addFieldWalledId}
                    data-testid="data-add-field-walled"
                    className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <button
                      type="button"
                      disabled
                      aria-describedby={addFieldWalledId}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary/10 px-2.5 text-xs font-medium text-primary disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" /> {t('engine.studio.data.addField', locale)}
                    </button>
                    <span id={addFieldWalledId} className="sr-only">
                      {t('engine.studio.customize.walled', locale)}
                    </span>
                  </span>
                )}
                {readOnly && (
                  <StudioReadOnlyLink
                    item={current}
                    title={
                      viewMode === 'form'
                        ? t('engine.studio.data.form.layoutBadgeReadOnly', locale)
                        : t('engine.studio.pkg.readonlyHint', locale)
                    }
                    locale={locale}
                  />
                )}
              </>
            }
            tabs={dataTabRowEl}
          />
          {/* objectui#12450 — the Records grid runs flush with the column: no
              body padding and no framed card around the list, so its toolbar,
              grid and footer span the column's full width. Every other view
              keeps the padded body. */}
          <main
            data-testid="data-canvas-main"
            onClick={clearFieldSelOnEmpty}
            className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', bodyFlush ? null : 'px-6 py-4')}
          >
          {!current ? (
            objectsLoaded && objects.length === 0 ? (
              /* Fresh package: the first act is creating an object — say so and
               * offer the creator right here (no auto-opened modal, dogfood #2555). */
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <p className="text-sm font-medium">{t('engine.studio.data.firstObjectTitle', locale)}</p>
                <p className="max-w-sm text-[11px] leading-5 text-muted-foreground">
                  {t('engine.studio.data.firstObjectHint', locale)}
                </p>
                {!(packageReadOnly && !newInPair) && (
                  <button
                    type="button"
                    data-testid="empty-state-new-object"
                    onClick={openCreateObject}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t('engine.studio.data.newObject', locale)}
                  </button>
                )}
              </div>
            ) : (
              <div className="py-16 text-center text-sm text-muted-foreground">{t('engine.studio.data.pickObject', locale)}</div>
            )
          ) : (
            <>
              {error && (
                <StudioRefusalStrip
                  refusal={error}
                  locale={locale}
                  // objectui#11785 — "Show me" opens the named field's inspector,
                  // or (objectstack#26736) the named action, and (objectstack#26730)
                  // focuses the input the sentence names.
                  onShow={showObjRefusal}
                  className={cn('mb-2 px-3 py-1.5 text-[11px]', bodyFlush && 'mx-6 mt-3')}
                />
              )}
              {objHeld && (
                <StudioHeldNotice
                  held={objHeld}
                  locale={locale}
                  explicitSave
                  // objectui#11786 — no "Show me" while that field is the one open.
                  onShow={
                    fieldSel?.kind === objHeld.target.kind && fieldSel.id === objHeld.target.id
                      ? undefined
                      : showObjTarget
                  }
                  className={cn('mb-2 px-3 py-1.5 text-[11px]', bodyFlush && 'mx-6 mt-3')}
                />
              )}
              {objLoaded && objExternal && (
                <div className={cn('mb-2', bodyFlush && 'mx-6 mt-3')}>
                  <ExternalObjectNotice binding={objExternal} state={objExternalWriteState} locale={locale} />
                </div>
              )}
              {/* objectstack#34725 — the AI assistant's drafts are on this
                  canvas: say how many, where to review them, and the package's
                  discard. objectstack#36511 item 6 — and that Save makes them
                  live too, with the undo of this one object's draft. */}
              {agentDraftCount > 0 && (
                <div
                  role="status"
                  data-testid="studio-copilot-changes"
                  className={cn(
                    'mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-1.5 text-xs dark:border-amber-500/30 dark:bg-amber-500/10',
                    bodyFlush && 'mx-6 mt-3',
                  )}
                >
                  <span className="inline-flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {tFormat(
                      agentDraftCount === 1 ? 'engine.studio.copilotChanges.lineOne' : 'engine.studio.copilotChanges.line',
                      locale,
                      { count: agentDraftCount },
                    )}
                  </span>
                  {!readOnly && (
                    <span data-testid="studio-ai-draft-notice" className="text-amber-800 dark:text-amber-200">
                      {t('engine.studio.aiDraft.notice', locale)}
                    </span>
                  )}
                  <span className="ml-auto inline-flex items-center gap-3">
                    {!readOnly && (
                      <button
                        type="button"
                        data-testid="studio-ai-draft-discard"
                        onClick={() => void discardItemDraft()}
                        disabled={discardingItemDraft || discardingDrafts || saving !== false}
                        title={t('engine.studio.aiDraft.discardTitle', locale)}
                        className="font-medium text-amber-700 hover:underline disabled:opacity-50 dark:text-amber-300"
                      >
                        {t('engine.studio.aiDraft.discard', locale)}
                      </button>
                    )}
                    {!readOnly && adapter && (
                      <button
                        type="button"
                        data-testid="studio-copilot-changes-discard"
                        onClick={() => void discardAllDrafts()}
                        disabled={discardingDrafts}
                        className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                      >
                        {t('engine.studio.copilotChanges.discardAll', locale)}
                      </button>
                    )}
                    {onReviewChanges && (
                      <button
                        type="button"
                        data-testid="studio-copilot-changes-view"
                        onClick={onReviewChanges}
                        className="font-medium text-amber-700 hover:underline dark:text-amber-300"
                      >
                        {t('engine.studio.copilotChanges.view', locale)}
                      </button>
                    )}
                  </span>
                </div>
              )}
              {!objLoaded ? (
                // objectui#11272 — no view of another object's buffer under
                // this one; after a failed load, the error above says why.
                error && !loading ? null : (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t('engine.studio.loading', locale)}
                  </div>
                )
              ) : viewMode === 'rules' ? (
                <DraftVerdictContext.Provider value={objVerdict}>
                  <DraftVerdictBodyContext.Provider value={objVerdictBody}>
                    <ObjectValidationsPanel
                      draft={objDraft}
                      onPatch={onPatch}
                      disabled={readOnly}
                      focus={ruleFocus}
                      onCelVerdictsChange={reportPanelVerdicts}
                    />
                  </DraftVerdictBodyContext.Provider>
                </DraftVerdictContext.Provider>
              ) : viewMode === 'settings' ? (
                <ObjectSettingsPanel
                  name={current.name}
                  draft={objDraft}
                  onPatch={onPatch}
                  locale={locale}
                  disabled={readOnly}
                  onBlockingIssuesChange={reportPanelBlocking}
                />
              ) : viewMode === 'hooks' ? (
                <ObjectHooksPanel
                  buffer={hooksBuffer}
                  disabled={readOnly}
                  hookSchema={typeSchemas.hook}
                  hookForm={typeForms.hook}
                />
              ) : viewMode === 'actions' ? (
                <div ref={actionsPanelRef} className="contents">
                  <ObjectActionsPanel
                    draft={objDraft}
                    onPatch={onPatch}
                    disabled={readOnly}
                    focus={actionFocus}
                    actionSchema={typeSchemas.action}
                    actionForm={typeForms.action}
                    onCelVerdictsChange={reportPanelVerdicts}
                    // objectstack#30088 — a base object's new actions are items of the pair.
                    pair={pairDoor}
                    pairActions={pairActions}
                  />
                </div>
              ) : viewMode === 'api' ? (
                <ObjectApiPanel name={current.name} draft={objDraft} />
              ) : viewMode === 'grid' && !hasBaseline ? (
                /* Draft-only object: no physical table until the package publish —
                 * rendering the runtime grid would fire data SQL against a table
                 * that doesn't exist. Say so instead of erroring. */
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 text-center">
                  <p className="text-sm font-medium">{t('engine.studio.data.draftObjectTitle', locale)}</p>
                  <p className="max-w-md text-[11px] leading-5 text-muted-foreground">
                    {t('engine.studio.data.draftObjectHint', locale)}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      selectViewMode('form');
                      setFormMode('layout');
                    }}
                    className="mt-1 inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
                  >
                    {t('engine.studio.data.goDesignFields', locale)}
                  </button>
                </div>
              ) : viewMode === 'grid' ? (
              <>
              {/* Records grid — fields are the columns. Header "+" adds a field, the
                * per-column edit affordance opens the field editor, and dragging a
                * column header reorders the object's fields (all via the context). */}
              <div
                ref={recordsBodyRef}
                // objectstack#35061 — the grid's sideways scrollbar is drawn at
                // rest (`recordsGridChrome.ts`), so a pane the right slot
                // narrows still shows there are columns to the right.
                className={cn('relative min-h-0 flex-1 overflow-auto bg-background', RECORDS_SCROLLBAR_VISIBLE)}
                data-testid="data-records-body"
                data-records-columns={recordsColumnsScope}
                onClickCapture={(e) => {
                  // React carries a click inside the (portalled) popover here
                  // too; only a click in the body's own DOM is the grid's.
                  if (!(e.target instanceof Element) || !e.currentTarget.contains(e.target)) return;
                  gridAddFieldButton.current = e.target.closest('button');
                  // objectstack#34794 — a click on a field's column header
                  // selects that field and opens its properties, as the
                  // Interfaces canvas does (objectui#12725's
                  // `ColumnHeaderSelect`): taken in the capture phase, before
                  // the header's own sort handler. Sort and hide stay in the
                  // header's column menu (`columnMenuLabel` below). A control
                  // inside the header (the menu caret, the edit button) keeps
                  // its job, and a column the buffer does not declare (an
                  // injected one) keeps the grid's own click.
                  const header = e.target.closest('thead th[data-column-key]');
                  if (!header || !e.currentTarget.contains(header)) return;
                  const control = e.target.closest('button, input, a, [role="checkbox"]');
                  if (control && header.contains(control)) return;
                  const field = header.getAttribute('data-column-key');
                  if (!field || !readFields(shownDraft.fields).entries.some((en) => en.name === field)) return;
                  e.stopPropagation();
                  e.preventDefault();
                  setFieldSel({ kind: 'field', id: field });
                }}
              >
                {fieldSel?.kind === 'field' ? (
                  // The selected field's header is outlined, as the Interfaces
                  // canvas outlines its selected column: a style rule, since
                  // the grid owns its cells and redraws them.
                  <style>{`[data-records-columns="${recordsColumnsScope}"] thead th[data-column-key=${JSON.stringify(fieldSel.id)}]{box-shadow:inset 0 0 0 2px hsl(var(--primary));}`}</style>
                ) : null}
                {canAddFields && (
                  <AddFieldPopover
                    open={gridAddFieldOpen}
                    onOpenChange={setGridAddFieldOpen}
                    onCreate={addField}
                    takenNames={addFieldTakenNames}
                    returnFocusTo={() => gridAddFieldButton.current}
                    extensionField={extendsBase}
                  >
                    <span aria-hidden="true" className="pointer-events-none absolute right-4 top-2 h-0 w-0" />
                  </AddFieldPopover>
                )}
                <GridFieldAuthoringProvider
                  value={{
                    // Read-only package: keep the per-column inspector (view props)
                    // but drop add-column and drag-reorder — both are doomed writes.
                    ...(readOnly ? {} : { onReorderFields: doReorderFields }),
                    // An external object (ADR-0015) keeps reorder but gets no
                    // add-column: a new field would be a new remote column.
                    ...(canAddFields
                      ? {
                          onAddColumn: () => setGridAddFieldOpen(true),
                          addColumnLabel: t('engine.studio.data.addField', locale),
                        }
                      : {}),
                    columnMenuLabel: t('engine.studio.data.columnMenu', locale),
                    onEditColumn: (fieldName) => {
                      // ignore non-field columns (e.g. the row-actions column)
                      if (readFields(shownDraft.fields).entries.some((e) => e.name === fieldName)) {
                        setFieldSel({ kind: 'field', id: fieldName });
                      }
                    },
                    editColumnLabel: t('engine.studio.data.editFieldProps', locale),
                    // objectstack#34725 — the AI assistant's draft marks on the column headers.
                    ...(agentColumnMarks ? { columnMarks: agentColumnMarks } : {}),
                  }}
                >
                  <StudioGridAddFieldProvider value={canAddFields ? gridAddFieldCreate : null}>
                  {/* Provide the adapter as the dataSource context so the object-grid's
                    * inline-edit save can write back: the ListView only fetches and
                    * passes data inline, leaving the grid itself without a write dataSource. */}
                  <SchemaRendererProvider dataSource={adapter as never}>
                    <PluginObjectView
                      key={`${current.name}:${gridVer}`}
                      schema={
                        {
                          type: 'object-view',
                          objectName: current.name,
                          // "+ New" now lives in the grid's own toolbar (via
                          // renderStudioGridList's `addRecord.enabled`), next to
                          // Hide fields/Filter/Group/Sort — suppress ObjectView's
                          // separate top row so it doesn't render a second,
                          // mostly-empty toolbar above the grid.
                          showCreate: false,
                          // No saved view exists in design mode, so show the object's
                          // own fields as columns (in metadata order), dropping
                          // framework-managed/audit fields so the grid opens on the
                          // meaningful columns first — the way Airtable does.
                          // Memoized at the top of the component: this array's IDENTITY
                          // is a fetch input downstream, so rebuilding it inline here
                          // issued a duplicate find() on every render (objectui#4567).
                          table: {
                            fields: gridColumns,
                          },
                        } as never
                      }
                      dataSource={adapter as never}
                      renderListView={renderStudioGridList}
                    />
                  </SchemaRendererProvider>
                  </StudioGridAddFieldProvider>
                </GridFieldAuthoringProvider>
              </div>
              </>
              ) : (
              <>
              {/* form sub-mode: Layout (WYSIWYG drag/section designer) ⇄
                  Preview (live form). objectui#12451 — the control sits at the
                  left of the Form tab's one toolbar row (the designer's in
                  Layout, `FormToolbar` in Preview), and the caption that used
                  to trail it is each item's title. */}
              {formMode === 'layout' ? (
                <>
                <ObjectFormDesigner
                  draft={shownDraft}
                  objectName={current.name}
                  systemFieldNames={STUDIO_SYSTEM_FIELD_NAMES}
                  onChange={onPatch}
                  selectedField={fieldSel?.kind === 'field' ? fieldSel.id : null}
                  onSelectField={(name) => setFieldSel({ kind: 'field', id: name })}
                  selectedGroup={fieldSel?.kind === 'group' ? fieldSel.id : null}
                  onSelectGroup={(key) => setFieldSel({ kind: 'group', id: key })}
                  // objectstack#30057 — on a base object a new field goes into
                  // the pair's extension, from the toolbar beside the mode control.
                  onAddField={canAddFields && !extendsBase ? addField : undefined}
                  readOnly={readOnly}
                  modeControl={formToolbarLeading}
                  contributedFields={contributedFields}
                  draftMarkedFields={agentMarkedFields}
                />
                </>
              ) : (
              <>
              <FormToolbar
                leading={formToolbarLeading}
                hint={
                  /* objectui#12515 — Preview renders the runtime form from the draft
                   * definition (the open object's buffer, unsaved edits included):
                   * a create form reads no record, so a draft-only object needs no
                   * table to preview. The chip says which definition is on screen;
                   * the toggle appears only when a published version exists. */
                  <>
                    {previewShowsDraft && (
                      <span
                        data-testid="form-preview-draft-chip"
                        title={t('engine.studio.data.form.draftChipTitle', locale)}
                        className="inline-flex h-6 items-center rounded bg-primary/10 px-2 text-[11px] font-medium text-primary"
                      >
                        {t('engine.studio.data.form.draftChip', locale)}
                      </span>
                    )}
                    {hasBaseline && draftDiffers && (
                      <div
                        role="group"
                        aria-label={t('engine.studio.data.form.sourceLabel', locale)}
                        data-testid="form-preview-source"
                        className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5"
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewSource('draft')}
                          aria-pressed={previewShowsDraft}
                          className={formModeItem(previewShowsDraft)}
                        >
                          {t('engine.studio.data.form.sourceDraft', locale)}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewSource('published')}
                          aria-pressed={!previewShowsDraft}
                          className={formModeItem(!previewShowsDraft)}
                        >
                          {t('engine.studio.data.form.sourcePublished', locale)}
                        </button>
                      </div>
                    )}
                  </>
                }
              />
              <div
                data-testid="data-form-preview-frame"
                onClick={clearFieldSelOnEmpty}
                className="flex min-h-0 flex-1 flex-col overflow-auto bg-sidebar p-6"
              >
              <>
              {/* Form — the real runtime ObjectForm ("same renderer"): the object's
                * form exactly as an end user sees it. Clicking any rendered field
                * (event-delegated via the renderer's data-field) selects it into the
                * SAME field inspector the grid uses — one screen, no pillar switch. */}
              <style>{`
                /* Design preview: the form is a click-to-select canvas, not a data-entry
                 * form. Disable interaction on field contents so a click anywhere on a
                 * field routes to its [data-field] wrapper (→ select), and neutralize the
                 * create/cancel footer so nothing is submittable here. */
                .os-form-authoring [data-field]{border-radius:8px;cursor:pointer;transition:box-shadow .12s;padding:8px;margin:-8px 0;}
                .os-form-authoring [data-field] *{pointer-events:none;}
                .os-form-authoring [data-field]:hover{box-shadow:0 0 0 1px hsl(var(--border));}
                .os-form-authoring form > div:last-child:has(button){display:none;}
                ${
                  fieldSel?.kind === 'field'
                    ? `.os-form-authoring [data-field="${String(fieldSel.id).replace(/[^\w-]/g, '')}"]{box-shadow:0 0 0 2px hsl(var(--primary));}`
                    : ''
                }
              `}</style>
              <div className="rounded-lg border bg-background p-6" onClick={clearFieldSelOnEmpty}>
                {/* Match the real display: the runtime form auto-widens (a
                    field-heavy record opens in a near-full-width modal), so its
                    container queries reach up to 4 columns on wide screens. A
                    narrow cap here would misrepresent the end-user layout. */}
                <div
                  className="os-form-authoring mx-auto max-w-6xl"
                  onClick={(e) => {
                    const el = (e.target as HTMLElement).closest('[data-field]');
                    const name = el?.getAttribute('data-field');
                    if (name && readFields(shownDraft.fields).entries.some((f) => f.name === name)) {
                      setFieldSel({ kind: 'field', id: name });
                    } else if (!el && inSlot) {
                      // objectui#12725 — the space between the fields is empty canvas.
                      setFieldSel(null);
                    }
                  }}
                >
                  <SchemaRendererProvider dataSource={previewDataSource as never}>
                    <ObjectForm
                      key={`${current.name}:${gridVer}:form`}
                      schema={
                        {
                          type: 'object-form',
                          objectName: current.name,
                          mode: 'create',
                          // Memoized above at the top of the component: this array's
                          // IDENTITY is a dependency of ObjectForm's field-generation
                          // effect, so rebuilding it inline here re-ran that effect on
                          // every keystroke-level render of the pillar (objectui#4574).
                          // The Published preview lists the published fields
                          // (objectui#12515), set where the baseline loads.
                          fields: previewShowsDraft ? formFields : publishedFormFields,
                        } as never
                      }
                      dataSource={previewDataSource as never}
                    />
                  </SchemaRendererProvider>
                </div>
              </div>
              </>
              </div>
              </>
              )}
              </>
              )}
            </>
          )}
          </main>
        </div>

        {/* Right rail — property inspector. Fields reuse the shared
          * ObjectFieldInspector; a selected group opens ObjectGroupInspector
          * (label + collapse behaviour). */}
        {/* ⭐ objectui#6795 part C — this guard used to read
          * `(fieldSel.kind === 'group' || inspector)`, so with
          * `getMetadataInspector('object')` undefined and a FIELD selected the
          * whole rail was dropped: measured `aside` count 0, i.e. clicking a
          * field did literally nothing while the designer above it went on
          * saying "click a field to edit its properties". A selection the author
          * just made must always open its rail; whether an EDITOR exists for it
          * is a question the rail body answers, not a reason to swallow the
          * click. (Unreachable in production today only because registration is
          * eager — the very thing part A wants to make lazy.) */}
        {current && fieldSel && objLoaded && hostFieldRail(
          <StudioInspector
            testId="data-field-inspector"
            className={inSlot ? 'w-full flex-1 border-l-0' : undefined}
            eyebrow={t(fieldSel.kind === 'group' ? 'engine.studio.data.groupProps' : 'engine.studio.data.fieldProps', locale)}
            eyebrowId={fieldRailTitleId}
            title={fieldRailHosted ? fieldRailTitle : undefined}
            id={fieldRailHosted ? undefined : fieldSel.id}
            onClose={() => setFieldSel(null)}
            closeLabel={t('engine.studio.close', locale)}
            // objectui#12725 — the copilot's 草稿 chip on a field it changed.
            actions={
              fieldAgentMark || fieldRailHosted ? (
                <>
                  {fieldAgentMark && <DraftChip locale={locale} className="mr-1" />}
                  {fieldRailHosted && (
                    <span ref={setFieldHeaderSlot} data-testid="data-field-header-actions" className="flex shrink-0 items-center" />
                  )}
                </>
              ) : undefined
            }
            // objectui#12453 — a read-only package saves no draft: no footer.
            footer={fieldRailReadOnly ? null : t('engine.studio.inspector.draftFooter', locale)}
            bodyClassName="flex min-h-0 flex-1 flex-col"
          >
            <div ref={fieldInspectorBodyRef} className="contents">
              {(() => {
                const fieldRailContent = fieldSel.kind === 'group' ? (
                  <ObjectGroupInspector
                    draft={objDraft}
                    objectName={current.name}
                    groupKey={fieldSel.id}
                    onPatch={onPatch}
                    onClose={() => setFieldSel(null)}
                    readOnly={readOnly}
                    locale={locale}
                  />
                ) : inspector ? (
                  // objectstack#28575 — on a base object the inspector edits
                  // the pair's extension: its own fields whole, a base field
                  // within the display-property whitelist only.
                  <BaseFieldDisplayPatchContext.Provider value={selectedBaseField}>
                    <InspectorShellHostProvider value={{ onSelectionChange: setFieldSel, headerActionsTarget: fieldHeaderSlot }}>
                    {React.createElement(inspector, {
                      type: 'object',
                      name: current.name,
                      draft: shownDraft,
                      selection: fieldSel,
                      onPatch: extOpen ? onExtFieldsPatch : onPatch,
                      onClearSelection: () => setFieldSel(null),
                      onSelectionChange: setFieldSel,
                      onBlockingIssuesChange: (count: number) =>
                        setBlockingReport({ key: fieldSelKey, count }),
                      readOnly: fieldRailReadOnly,
                      locale,
                    })}
                    </InspectorShellHostProvider>
                  </BaseFieldDisplayPatchContext.Provider>
                ) : (
                  /* No field inspector registered. ⛔ Not "loading…": the read
                   * is observed (objectui#11939), so a late registration does
                   * replace this note with the inspector, but nothing here knows
                   * one is on its way. State the fact. */
                  <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-xs text-muted-foreground">
                    <Ban className="h-5 w-5" />
                    {t('engine.studio.data.fieldInspectorMissing', locale)}
                  </div>
                );
                // objectui#12725 — the 来源 line under the field's properties.
                const railContent = fieldAgentMark ? (
                  <>
                    {fieldRailContent}
                    <DraftSourceLine mark={fieldAgentMark} locale={locale} className="mt-4 border-t pt-3" />
                  </>
                ) : (
                  fieldRailContent
                );
                if (!fieldRailReadOnly) return <div className="min-h-0 flex-1 overflow-auto p-3">{railContent}</div>;
                // objectui#12303 — on a read-only package every input and the
                // Remove button in this rail are disabled for one reason, the
                // package's. It rides the record page's Archive pattern
                // (`DeclaredActionsBar`, objectui#11811) on the rail body: the
                // body is the tooltip trigger, so hovering any disabled control
                // in it shows the reason, and a tab stop described by an
                // `sr-only` copy of it, so a keyboard or screen-reader user
                // reaches it too (a disabled input takes neither hover nor
                // focus, and Tab skipped the whole rail). One trigger for the
                // rail rather than one per control: the reason is the same for
                // all of them, and the controls are the shared inspector's.
                const reason = selectedContributedField
                  ? contributedItemTitle(selectedContributedField, locale)
                  : t('engine.studio.pkg.readonlyHint', locale);
                return (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          role="group"
                          aria-labelledby={fieldRailTitleId}
                          tabIndex={0}
                          aria-describedby={fieldRailReasonId}
                          data-disabled-reason=""
                          className="min-h-0 flex-1 overflow-auto p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          {railContent}
                          <span id={fieldRailReasonId} className="sr-only">{reason}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="left" align="start">{reason}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })()}
            </div>
          </StudioInspector>
        )}
      </div>

      <CreateItemDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('engine.studio.data.newObject', locale)}
        labelFieldLabel={t('engine.studio.data.nameLabel', locale)}
        labelPlaceholder={t('engine.studio.data.labelPlaceholder', locale)}
        idFieldLabel={t('engine.studio.data.idLabel', locale)}
        idPlaceholder={t('engine.studio.data.idPlaceholder', locale)}
        submitLabel={t('engine.studio.createLive', locale)}
        submittingLabel={t('engine.studio.creating', locale)}
        busy={createBusy}
        error={error?.message ?? null}
        locale={locale}
        // objectui#11792 — preview the name `doCreateObject` saves: the same
        // `prefixObjectName` over the same `namespace` state, so the dialog
        // shows `repairs_repair_ticket`, not the bare identifier.
        // objectstack#28572 — on a read-only base the preview names the pair's
        // namespace by the spec's pairing rule; the save prefixes with the
        // namespace the ensure door answers.
        storedName={(identifier) => prefixObjectName(identifier, newObjectNamespace)}
        extra={
          <>
            {createTaken && (
              <CreateTakenNotice
                scope="object"
                sentence={tFormat(
                  createTaken.here ? 'engine.studio.data.createTaken' : 'engine.studio.data.createTakenElsewhere',
                  locale,
                  { label: createTaken.label, name: createTaken.name },
                )}
                openLabel={tFormat('engine.studio.create.openExisting', locale, { label: createTaken.label })}
                onOpen={createTaken.here ? () => openTakenObject(createTaken.name) : undefined}
              />
            )}
            {/* Record sharing (OWD) — the third thing `New object` must ask for
               (`7a90afdf9`). Without it the object saves as a draft happily and
               is then REFUSED at Publish → Publish all by `security-owd-unset`, a
               wall the author meets only after building the whole object. The
               gloss is the SAME string the Settings tab shows for each model, so
               the two surfaces cannot describe one baseline two ways.

               `controlled_by_parent` is absent on purpose — see OWD_CREATE_MODELS:
               a just-created object has no master-detail field for it to derive
               access from. */}
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">
                {t('engine.studio.data.owdLabel', locale)}
              </span>
              <StudioPicker
                value={createOwd}
                options={OWD_CREATE_MODELS.map((m) => ({ value: m, label: t(OWD_OPTION_LABEL_KEY[m], locale) }))}
                onPick={(m) => setCreateOwd(m as OwdCreateModel)}
                className="h-auto rounded px-2 py-1 text-[12px]"
                testId="create-object-owd"
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {t(OWD_OPTION_DESC_KEY[createOwd], locale)}
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {t('engine.studio.data.owdHint', locale)}
              </span>
            </label>
          </>
        }
        onSubmit={({ label, name }) => void doCreateObject(label, name, createOwd)}
      />
    </div>
  );
}

// objectstack#29988 — the Automations rail's flow helpers moved to their own module; re-exported for their pins.
export { FlowStatusDot, type NewFlowTrigger };

// objectstack#36893 — the Automations and Access pillars moved to their own modules; re-exported for their pins.
export { AutomationsPillar, AccessPillar };

export default StudioDesignSurface;
