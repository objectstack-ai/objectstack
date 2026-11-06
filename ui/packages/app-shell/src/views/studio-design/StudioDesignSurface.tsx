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
import { useAdapter, SchemaRendererProvider, useMetadata } from '@object-ui/react';
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
import {
  StudioRightSlotContext,
  isSlotEscapeExempt,
  matchStudioSlotShortcut,
  useStudioRightSlot,
  type StudioRightSlotHandle,
  type StudioSlotMode,
} from './studioRightSlotState.js';
import { AUTOMATIONS_CONFIG_FOLD_WIDTH, useIsNarrowerThan } from './wideViewport.js';
import {
  DOCK_STUDIO_EXPANDED_STORAGE_KEY,
  maximizedDockWidth,
  readStoredDockExpanded,
  writeStoredDockExpanded,
} from '../../layout/chatDockState.js';
import type { AppMarkApp } from '../../layout/AppMark.js';
import {
  STUDIO_FOLD_LABEL,
  STUDIO_HEADER,
  STUDIO_HEADER_ICON_BUTTON,
  STUDIO_HEADER_PACKAGE_COLUMN,
  STUDIO_HEADER_PILLAR,
  STUDIO_HEADER_PILLAR_NAV,
  STUDIO_KIND_CHIP,
} from './studio-tokens.js';
import { StudioInspector } from './StudioInspector.js';
import { agentDraftMarkOf, DraftChip, DraftSourceLine } from './StudioDraftMark.js';
import {
  StudioItemHeader,
  StudioItemHeaderFoldedItems,
  StudioStatusChip,
  StudioTab,
  type StudioItemStatus,
} from './StudioItemHeader.js';
import { StudioItemTools } from '../item-tools/StudioItemTools.js';
import {
  StudioPendingDraftsContext,
  useStudioItemDraftStatus,
  type StudioPendingDrafts,
} from './studioItemDraftStatus.js';
import { FlowItemMoreMenu, flowCloneNoticeText, type FlowCopied } from './FlowItemMoreMenu.js';
import { FlowLedgerSwitch } from './FlowLedgerSwitch.js';
import { requestFlowToggle, useFlowLedgerWalledReadOnly } from '../setup/packagedFlowLedger.js';
import { activationReading } from '../setup/packagedFlows.js';
import { DATA_CONTENT_CONTAINER, DATA_TAB_FLAT_ONLY, DATA_TAB_FOLDED_ONLY } from './dataTabsFold.js';
import { StudioRail, StudioRailGroup, StudioRailRow } from './StudioRail.js';
import { StudioEmptyState, StudioEmptyStateAction } from './StudioEmptyState.js';
import {
  FLOW_TRIGGER_GLYPHS,
  flowTriggerGlyph,
  groupFlowsByObject,
  navigationObjectOrder,
} from './flowGrouping.js';
import { StudioRefusalStrip } from './StudioRefusalStrip.js';
import { StudioNavItemInspector, StudioPicker } from './StudioNavItemInspector.js';
import { PACKAGE_LIST_TOAST_ID, PackageSwitcher, STUDIO_LANDING_PATH } from './PackageSwitcher.js';
import {
  ContributedNavRows,
  InterfacesNavContributionsContext,
  InterfacesNavOverrideMark,
  InterfacesRailMarksContext,
  InterfacesServedContributedNavContext,
  NavTree,
  OFF_NAV_TYPES,
  OffNavSections,
  itemKeyOf,
  navIcon,
  navKindName,
  navOpenedItems,
  offNavViewHeading,
  offNavViewLabel,
  offNavViewReachedByEntry,
  type OffNavType,
} from './InterfacesNavRail.js';
import {
  FLOW_COPIED_ARRIVAL_STATE,
  FLOW_GLYPH_ICON,
  FLOW_GLYPH_LABEL_KEY,
  type FlowCopiedStrip,
  flowDotClass,
  type FlowRailState,
  flowRailState,
  flowRailStatus,
  type FlowRuntimeState,
  FlowStatusDot,
  type NewFlowTrigger,
  newFlowTriggerFields,
  NO_OBJECT_GROUP_KEY,
  NO_OBJECT_ORDER,
  pairIdOf,
  readFlowCopiedArrival,
  readFlowDefinitions,
  readFlowRegistrations,
  readObjectLabels,
  withStartTrigger,
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
  announceDraftSaved,
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
import {
  GridFieldAuthoringProvider,
  cn,
  useIsMobile,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import { ObjectView as PluginObjectView } from '@object-ui/plugin-view';
import { ListView } from '@object-ui/plugin-list';
import { ObjectForm } from '@object-ui/plugin-form';
import {
  Ban,
  Database,
  LayoutDashboard,
  Workflow,
  SlidersHorizontal,
  MousePointer2,
  Code2,
  Copy,
  MoreHorizontal,
  Eye,
  Loader2,
  Pencil,
  Check,
  Plus,
  GitBranch,
  Rocket,
  ChevronDown,
  Lock,
  Home as HomeIcon,
  Shield,
  ShieldCheck,
  ShieldQuestion,
  Menu,
  Undo2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  FileQuestion,
  PackageX,
  Library,
  type LucideIcon,
} from 'lucide-react';
import {
  useRegisteredMetadataPreview,
  useRegisteredMetadataPreviewTypes,
  type MetadataSelection,
} from '../metadata-admin/preview-registry.js';
import {
  getStudioCanvasPreview,
  StudioCanvasCardSelectionContext,
  StudioCanvasColumnSelectionContext,
  StudioCanvasDraftOnlyObjectsContext,
  StudioCanvasListViewContext,
  StudioCanvasNavEntryContext,
  StudioObjectRecordsCanvas,
  type StudioCanvasCardSelection,
  type StudioCanvasColumnSelection,
  type StudioCanvasDraftOnlyObjects,
  type StudioCanvasNavEntry,
} from './studio-canvas-preview.js';
import {
  listViewCardIdOf,
  listViewCardSelection,
  listViewColumnFields,
  listViewColumnIndexOf,
  listViewColumnSelection,
  listViewHeldEdit,
  listViewNameOf,
  listViewIsKanban,
  ObjectListViewInspector,
  useObjectListViewDraft,
  type DraftOnlyObjects,
  type ListViewCustomization,
} from './ObjectListViewInspector.js';
import { ObjectListViewTitle } from './ObjectListViewTitle.js';
import {
  DEFAULT_PAGE_SOURCE_KIND,
  NO_REPORT_BINDING,
  PageCreateFields,
  ReportCreateFields,
  buildDashboardSkeleton,
  buildPageSkeleton,
  buildReportSkeleton,
  interfaceNavEntry,
  isReportBindingComplete,
  type InterfaceCreateKind,
  type PageSourceKind,
  type ReportBinding,
} from './interfaceCreate.js';
import { StudioDatasetAuthoringContext, type StudioDatasetAuthoring } from './datasetCreate.js';
import { PermissionMatrixEditPage, type PermissionStudioTab } from '../metadata-admin/PermissionMatrixEditor.js';
import { AccessExplainPanel } from '../metadata-admin/AccessExplainPanel.js';
import {
  useRegisteredMetadataInspector,
  useRegisteredMetadataInspectorTypes,
} from '../metadata-admin/inspector-registry.js';
import { useRegisteredMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry.js';
import { getMetadataResource } from '../metadata-admin/registry.js';
import { useMetadataClient, useMetadataTypes } from '../metadata-admin/useMetadata.js';
// objectui#11773 — every draft save of an existing item sends the version its buffer was built on.
import { readDraftForSave, useDraftSaveGuard } from '../metadata-admin/DraftConflictDialog.js';
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
  verdictEntriesStillShown,
  verdictPreviewEntries,
  type ServerDiagnostics,
} from '../metadata-admin/draftVerdict.js';
import {
  DESIGNER_SURFACE_PARAM,
  formatSurfaceParam,
} from '../metadata-admin/nav-selection.js';
import { useNavSelDeepLink } from '../metadata-admin/useNavSelDeepLink.js';
import { SourcePageEditor } from '../metadata-admin/previews/SourcePageEditor.js';
import { SourcePageProperties, type SourcePageNavEntry } from '../metadata-admin/previews/SourcePageProperties.js';
import { fetchPendingDrafts, usePendingDrafts } from '../../preview/usePendingDrafts.js';
import { emitMetadataRefresh, subscribeMetadataRefresh } from '../../assistant/assistantBus.js';
import { STUDIO_CHANGES_PARAM, STUDIO_CHANGES_REVIEW } from './studioChangesLink.js';
import {
  BATCH_ABORTED_CODE,
  causalPublishFailures,
  dashboardHeldEdit,
  flowHeldEdit,
  flowSaveRefusal,
  issueRefusal,
  leafIssueLocator,
  navEntryLocator,
  objectHeldEdit,
  objectSaveRefusal,
  plainRefusal,
  publishRefusal,
  reportHeldEdit,
  type PublishFailure,
  type StudioHeld,
  type StudioRefusal,
} from './metadataError.js';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';
import {
  loadPackageLessSurfaces,
  loadPackageSurfaces,
  withDraftViewBindings,
  type PackageSurface,
} from './packageSurfaces.js';
import {
  STUDIO_ORG_SCOPE_PILLAR,
  isOrgScopeDraft,
  isStudioOrgScope,
  studioOrgScopePath,
} from './studioScope.js';
import { STUDIO_METADATA_AREA, studioMetadataAreaPath, studioPillarItemPath } from './metadataArea.js';
import { PermissionSetCloneDialog } from '../metadata-admin/PermissionSetCloneDialog.js';
import { permissionSetCloneNoticeText, type PermissionSetCloned } from '../metadata-admin/permission-set-clone.js';
import { useWalledCatalogReadOnly } from '../metadata-admin/catalog-scope.js';
import { useCanAuthorMetadata } from '../../hooks/useCanAuthorMetadata.js';
import { StudioMetadataArea } from './StudioMetadataArea.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
import { resolveSurface, findSurfaceInTree, isSameSurface, type NavNode, type Surface } from './navSurface.js';
import { servedNavTextOf, displayNavTree, displayAppLabel, type ServedNavText } from './servedNavText.js';
import { ServedWidgetTextContext, servedWidgetTextOf } from './servedDashboardText.js';
import {
  useSurfaceDeepLink,
  useSurfaceDeepLinkCapture,
  useSurfaceDeepLinkMirror,
  resolveSurfaceDeepLink,
  type SurfaceTarget,
} from './useSurfaceDeepLink.js';
import { SurfaceDeepLinkProvider, useRequestedSurface, useSurfaceNavigator } from './surfaceDeepLinkChannel.js';
import { buildObjectSkeleton, buildFlowSkeleton, buildAppSkeleton, buildPermissionSkeleton, type AppNavSeed } from './skeletons.js';
import { OWD_CREATE_MODELS, OWD_DEFAULT, type OwdCreateModel } from './owd-sharing.js';
import { t, tFormat, translateMetadataType, translateValidationMessage, useMetadataLocale } from '../metadata-admin/i18n.js';
import { useRegisterUnsavedEdits } from '../../chrome/unsavedEdits.js';
import { ObjectPicker } from '../metadata-admin/inspectors/ObjectPicker.js';
import { useDisplayLocale } from '@object-ui/i18n';
import { SuggestedBindingsPanel } from '../../components/SuggestedBindingsPanel.js';
import { AppNavCanvas, navPayloadOf } from '../metadata-admin/previews/AppNavCanvas.js';
import {
  FlowRegistrationContext,
  FlowRuntimeContext,
  deriveFlowRunStatus,
  type FlowRunStatus,
} from '../metadata-admin/previews/flow-problems.js';
import {
  FlowMetaPills,
  FlowPreviewChromeProvider,
  flowSelectionHeading,
  type FlowPreviewSection,
  type FlowProblemTally,
} from '../metadata-admin/previews/FlowPreview.js';
import { InspectorShellHostProvider } from '../metadata-admin/inspectors/_shared.js';
import type { FlowRegistration } from '@objectstack/spec/api';
import {
  navEntryLabelText,
  navItemLabelText,
  type NavEntryLike,
} from '../metadata-admin/previews/navItemLabel.js';
import { DraftTargetLabels, findByName, useNavTargetLabel } from '../../hooks/useNavTargetLabel.js';
import {
  NAV_ENTRY_TYPES,
} from '../metadata-admin/inspectors/nav-target.js';
import type { NavigationItemType } from '@object-ui/types';
import { errorCodeIs } from '@object-ui/types';
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
import { readAuthoredDraft } from './authoredDraft.js';
import { CreateItemDialog } from './CreateItemDialog.js';
import { AddFieldPopover } from './AddFieldPopover.js';
// objectui#11787 — the shared draft autosave, moved to its own module unchanged.
import { useDraftAutoSave, type DraftSend } from './useDraftAutoSave.js';
import { FLOW_PRESETS, flowPresetTrigger, type FlowPreset } from './flowPresets.js';
import { FormToolbar, ObjectFormDesigner } from './ObjectFormDesigner.js';
import { formLayoutChoiceOf, useFormViewDraft } from './useFormViewDraft.js';
import { formViewBodyOf, formViewSectionsOf } from './formViewSections.js';
import {
  resolveFormViewLayout,
  type FormViewDefinition,
  type ObjectDefinitionForFormView,
  type RecordFormFlow,
} from '../../utils/recordFormNavigation.js';
import { isStudioHiddenSystemField } from './studioHiddenSystemField.js';
import { ObjectGroupInspector } from './ObjectGroupInspector.js';
import { ObjectValidationsPanel } from './ObjectValidationsPanel.js';
import { ObjectSettingsPanel } from './ObjectSettingsPanel.js';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel.js';
import { ObjectApiPanel } from './ObjectApiPanel.js';
import { ObjectHooksPanel } from './ObjectHooksPanel.js';
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
  type ListedPackageManifest,
} from './packages-io.js';
import { usePackageCustomizations } from './CustomizationMark.js';
import {
  ContributedRailRow,
  contributedElsewhereText,
  RailCustomizationFilter,
  RailCustomizationMark,
  StudioPairItemChip,
  contributedItemTitle,
  customizationPairBaseOf,
  railCustomizationsOf,
  useDeepLinkFallback,
  useContributedElsewhere,
  useOpenContributor,
  useRailCustomizationsOnly,
  withPairItems,
} from './StudioRailCustomizations.js';
import {
  baseContributionsOf,
  contributedFieldsOf,
  placeNavContributions,
  placesAnyNav,
  servedContributedNavOf,
  withContributedFlowGroups,
  NO_SERVED_CONTRIBUTED_NAV,
  type ServedContributedNav,
  type ContributedOnObject,
} from './contributionRows.js';
import {
  StudioCustomizeButton,
  StudioOverrideChip,
  StudioRestoreOriginalDialog,
  isStudioCustomizeType,
  overrideDraftBody,
  useCustomizeDoorWalled,
  useServedOverride,
  OBJECT_EXTENSION_TYPE,
  baseOwnedFieldNames,
  extensionFieldName,
  extensionBodyForSave,
  extensionFieldNames,
  foldObjectExtension,
  objectExtensionBodyOf,
  routeFoldedFieldsEdit,
  type CustomizeBlock,
  type ObjectExtensionBody,
  type ServedOverride,
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

// objectui#12452 — Access is the fourth segment, and the "More" overflow that
// held it alone (objectui#5813) is retired. If a second overflow pillar is ever
// added, More returns with the objectui#11794 behaviour: its trigger keeps the
// name More whichever of its pillars is open.
const PILLARS: ReadonlyArray<{ key: string; label: string; Icon: LucideIcon }> = [
  { key: 'data', label: 'Data', Icon: Database },
  { key: 'automations', label: 'Automations', Icon: Workflow },
  { key: 'interfaces', label: 'Interfaces', Icon: LayoutDashboard },
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
/**
 * objectui#11357 — the body the Interfaces pillar saves for its open leaf. A
 * page goes through the `page` registration's `fromDraft`, the serialiser
 * the metadata editor's save uses: it leaves out the `requires` the server
 * stamps from an html page's source, so the stamp the buffer was seeded with
 * never travels back as a hand-written list. ⛔ Nothing here computes
 * `requires`. Every other type is sent as the draft it is.
 *
 * Page-scoped on purpose. This pillar applies no `toDraft` on load, so a
 * type's `fromDraft` is safe here only where that type registers no
 * `toDraft` (a pair is an inverse; half of it would send a shape the pillar
 * never received). The `page` registration has none, and the pillar's pin
 * holds that precondition.
 */
function interfacesSaveBody(type: string, draft: Record<string, unknown>): Record<string, unknown> {
  if (type !== 'page') return draft;
  const fromDraft = getMetadataResource('page')?.fromDraft;
  return fromDraft ? fromDraft(draft) : draft;
}

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
  const pairBase = props.area ? null : customizationPairBaseOf(params.packageId ?? null);
  if (pairBase !== null) {
    const tab = params.tab ?? 'interfaces';
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
  const tab = area ?? params.tab ?? 'interfaces';
  // objectstack#26708 — a segment no pillar has is a not-found state, never
  // the Interfaces pillar it used to fall through to.
  const pillarKnown = PILLARS.some((p) => p.key === tab);
  const locale = useMetadataLocale();

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
  // objectstack#29851 — the listed manifests this same read answered, held
  // with the id it answered for: the Interfaces pillar's no-app empty state
  // reads the open package's declared navigation targets off it (addresses
  // only), so it sends no package-list request of its own.
  const [listedManifests, setListedManifests] = React.useState<{
    for: string;
    manifests: ReadonlyMap<string, ListedPackageManifest>;
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
    listedManifests.then(
      (manifests) => {
        if (!cancelled) setListedManifests({ for: packageId, manifests });
      },
      () => {},
    );
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

  // objectui#2600 — the header's pillar links, Home button and PackageSwitcher
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
  // objectstack#26705 — a held edit lives only in the pillar's buffer, so a
  // departure drops it exactly as it drops a dirty pillar's edits: both are
  // unsaved work, and every guard below reads this one bit.
  const unsavedPillarWork = pillarDirty || heldEdit !== null;
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

  // Package-level publish (ADR-0033/0037/0048): edits accumulate as per-item
  // drafts STAMPED with this package (each save passes packageId → the draft row's
  // sys_metadata.package_id). Publishing promotes exactly THIS package's drafts in
  // one atomic pass (POST /packages/:id/publish-drafts), reviewed as a whole in
  // DraftChangesPanel. There is no per-item publish.
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
      } else if (payload?.success === false) {
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
  }, [shellClient, packageId, pairId, draftScope, refreshPending, locale, heldEdit]);

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
  const publishNoneReasonId = React.useId();
  const publishReadOnlyReasonId = React.useId();

  // Builder → running-app bridge (Airtable's Launch): the builder edits the
  // package (the design surface), the app is its published front-end. If this
  // package ships an app, offer Open app — opened in a new tab so the builder
  // context survives. (App → builder is the reverse bridge, tracked separately.)
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
  // Create app (package has no app yet): create a draft `app` item — the
  // published front-end's on-ramp. The button flips to Open app after the
  // package publish.
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
  // hand in the Interfaces pillar (objectui#2262).
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
        // objectui#11794 — the app lives in the Interfaces pillar, so that is
        // where its author lands, instead of being left on the pillar the
        // header button was pressed from. Navigation only: the save above is
        // the whole write. Same door as a pillar link: an unsent edit on the
        // pillar being left asks first, and a "stay" keeps the author there
        // with the app already created.
        if (tab !== 'interfaces' && confirmLeavePillar()) {
          shellNavigate(`/studio/${scopeSegment}/interfaces`);
        }
      } catch (e) {
        setAppErr(formatMetadataError(e));
      } finally {
        setAppBusy(false);
      }
    },
    [appAddObjects, loadPackageObjects, shellClient, packageId, locale, onDraftSaved, tab, confirmLeavePillar, shellNavigate, scopeSegment],
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
      return;
    }
    try {
      const apps = (await shellClient.list('app', { packageId })) as Array<Record<string, unknown>>;
      setPackageAppObjectOrder(navigationObjectOrder((apps || []).find((a) => a?.name)?.navigation));
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
  const slotHost = chatDockMode && packageId !== null;
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
  const [copilotCanvasOpen, setCopilotCanvasOpen] = React.useState(false);
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
      disabled={publishing || !hasPending || publishReadOnly}
      aria-describedby={
        publishReadOnly
          ? publishReadOnlyReasonId
          : !hasPending && !publishing
            ? publishNoneReasonId
            : undefined
      }
      // A read-only package's reason is the wrapper's (objectui#12303), not a
      // `title` the disabled button can never show.
      title={
        publishReadOnly
          ? undefined
          : hasPending
            ? t('engine.studio.publishTitle', locale)
            : t('engine.studio.publishNoneTitle', locale)
      }
      // objectui#8219 — the primary style is for a publish the author
      // CAN do. A disabled one (no draft, or a read-only package)
      // drops to an outline, instead of staying the loudest element
      // on the page dimmed only by `disabled:opacity-50`.
      className={cn(
        // The border is on both states so the swap never shifts the bar.
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium',
        publishing || (hasPending && !publishReadOnly)
          ? 'border-transparent bg-primary text-primary-foreground disabled:opacity-50'
          : 'text-muted-foreground',
        // The wrapper takes the hover: the disabled button lets it through.
        publishReadOnly && 'disabled:pointer-events-none',
      )}
    >
      {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
      {t('engine.studio.publish', locale)}
    </button>
  );

  return (
    <SurfaceDeepLinkProvider onRequest={requestSurface}>
      <StudioRightSlotContext.Provider value={slotHandle}>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        {/* The ADR-0080 `aiSlot` seam — a cloud edition may still inject its own
          * left copilot panel; the built-in copilot is the RIGHT dock below. */}
        {aiSlot ? (
          <aside className="w-64 shrink-0 overflow-auto border-r bg-muted/40">{aiSlot}</aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className={STUDIO_HEADER} data-testid="studio-shell-header">
            {/* objectui#12459 — three columns: the package at the left, the
                pillars centered, the package actions at the right.
                objectui#12509 — below `sm` the pillars take a second row of
                their own (`STUDIO_HEADER_PILLAR_NAV`), and on any row the
                package chip is the piece that gives way. */}
            <div className={cn('flex min-w-0 items-center gap-1', STUDIO_HEADER_PACKAGE_COLUMN)}>
              {/* Never a dead end: walk back to the Studio landing
                  (objectui#12513), where the author picks the next package.
                  The console home stays one click away from there, through
                  the landing's own top bar. */}
              <button
                type="button"
                data-testid="studio-home"
                onClick={() => {
                  if (!confirmLeavePillar()) return;
                  shellNavigate(STUDIO_LANDING_PATH);
                }}
                title={t('engine.studio.landingHome', locale)}
                className={STUDIO_HEADER_ICON_BUTTON}
              >
                <HomeIcon className="h-4 w-4" />
              </button>
              <div className="flex min-w-0">
                <PackageSwitcher
                  packageId={packageId}
                  tab={tab}
                  beforeNavigate={confirmLeavePillar}
                  app={packageApp}
                  openEntry={pkgEntry?.id === packageId ? pkgEntry : null}
                />
              </div>
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
                      1024 px row was sized for the four pillar names. */}
                  <span className={p.key === STUDIO_METADATA_AREA ? 'sr-only xl:not-sr-only' : 'sr-only lg:not-sr-only'}>
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
              {/* objectui#5800 — the Open app teleport is retired: the canvas's
                  Run mode IS the way to try the app without leaving the
                  workbench. The published-app state needs no chrome at all.
                  objectui#11553 — the package-less scope has no app to create. */}
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
                  <span className="sr-only xl:not-sr-only">{t('engine.studio.app.create', locale)}</span>
                </button>
              )}
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
                {hasPending && <span className="sr-only"> · </span>}
                {hasPending && (
                  <span
                    data-testid="studio-changes-count"
                    className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                  >
                    {shownPendingCount}
                  </span>
                )}
              </button>
              {/* objectui#8219 — with nothing to publish, say so on the page;
                  objectui#12459 moves the sentence off the strip into the
                  Publish button's description, where readers and the tooltip
                  still find it. */}
              {!hasPending && !publishReadOnly && !publishing && (
                <span
                  id={publishNoneReasonId}
                  className="sr-only"
                  data-testid="publish-none-reason"
                >
                  {t('engine.studio.publishNoneTitle', locale)}
                </span>
              )}
              {/* objectui#12303 — on a read-only package the reason rides the
                  record page's Archive pattern (`DeclaredActionsBar`,
                  objectui#11811) instead of a `title` on the disabled button:
                  a natively disabled button fires no hover or focus, so the
                  `title` reached no keyboard or assistive-tech user and Tab
                  skipped Publish entirely. The wrapping span is the tooltip
                  trigger and a tab stop, and the button and the span both
                  point `aria-describedby` at an `sr-only` copy of the reason.
                  objectstack#28562 — a read-only base with a customization
                  package publishes that package's drafts, so it is not this. */}
              {publishReadOnly ? (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        aria-describedby={publishReadOnlyReasonId}
                        data-disabled-reason=""
                        className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {publishButton}
                        <span id={publishReadOnlyReasonId} className="sr-only">
                          {t('engine.studio.pkg.readonlyHint', locale)}
                        </span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('engine.studio.pkg.readonlyHint', locale)}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                publishButton
              )}
              </>)}
              {/* objectui#12725 — the top bar's right-most icon shows or hides
                  the right slot; `⌘.` switches what it shows. */}
              {slotHost && slotHasContent && (
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

          {isMobile && (
            <p
              role="note"
              data-testid="studio-desktop-hint"
              className="shrink-0 border-b bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground"
            >
              {t('engine.studio.desktopHint', locale)}
            </p>
          )}

          <div className="min-h-0 flex-1">
            {/* objectui#12725 — the pillars' item headers read the ledger the
                badge counts (`studioItemDraftStatus.ts`). */}
            <StudioPendingDraftsContext.Provider value={pillarPendingDrafts}>
            {/* objectui#11272 — Data and Automations are keyed by package too,
                for the reason written at `InterfacesPillar` below. Unkeyed,
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
              />
            ) : tab === 'access' ? (
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
              />
            ) : (
              // objectui#11203 / objectui#11232 — keyed by package. A package
              // switch keeps this route mounted, and every piece of the
              // pillar's state is the package's: the app and its nav edit
              // buffer, the nav editor's dirty flag and open editing, the open
              // leaf and its page draft. Kept, they outlived the confirmed
              // discard: the load installed the next package's app under a
              // dirty flag that still stood, and the autosave sent it as a
              // draft; the previous package's page stayed open and saved into
              // the next one. One reset, of all of it. This is a new document,
              // not a data refresh, which Commandment #8 keeps from a key bump.
              // objectui#11862 — the pending drafts read above (the Changes
              // count's `_drafts` rows, each with its label) are the last rung
              // of the nav editor's label resolver: a label-less entry that
              // opens a draft-only object or dashboard reads as that draft's
              // label, not its machine name. No read is added for it.
              <DraftTargetLabels.Provider value={pendingEntries}>
                <InterfacesPillar
                  key={packageId}
                  packageId={packageId}
                  packageLabel={pkgEntry?.id === packageId ? pkgEntry.name : undefined}
                  publishNonce={publishNonce}
                  draftNonce={draftNonce}
                  onDraftSaved={onDraftSaved}
                  onCreateApp={readOnly ? undefined : () => setAppCreating(true)}
                  readOnly={readOnly}
                  readOnlySettled={pkgWritable !== undefined}
                  customization={customization}
                  listedManifests={listedManifests?.for === packageId ? listedManifests.manifests : null}
                  onDirtyChange={setPillarDirty}
                  onSurfaceLabelChange={setSurfaceLabel}
                  onHeldEditChange={setHeldEdit}
                />
              </DraftTargetLabels.Provider>
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
            wideWidth={copilotCanvasOpen && !isMobile ? maximizedDockWidth(window.innerWidth) : undefined}
            overlay={isMobile}
            onOverlayDismiss={() => setSlotOpen(false)}
            locale={locale}
            copilot={
              <StudioChatDock
                packageId={packageId}
                locale={locale}
                surfaceLabel={surfaceLabel}
                onStatusChange={setCopilotStatus}
                onCanvasOpenChange={setCopilotCanvasOpen}
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
    </SurfaceDeepLinkProvider>
  );
}

/**
 * A Studio list row's name (objectui#11862, on the maintainer's word
 * 「所有地方以标签为主，机器名只作为次要信息」): the label as the primary text, and
 * the machine name beneath it as secondary text — smaller and monospace — when
 * it differs from the label. With no label the name alone is the text.
 *
 * Display only: it reads what the row already holds and writes nothing. The
 * secondary name is `aria-hidden`, so a row's accessible name stays the label
 * it was; the nav rail carries the machine name for assistive tech on the
 * row's `title` (`type · name`), as it did before.
 */
function StudioNameLabel({ label, name }: { label: string; name?: string }): React.ReactElement {
  const primary = label.trim() ? label : (name ?? '');
  const secondary = name && name !== primary ? name : '';
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate">{primary}</span>
      {secondary ? (
        <span aria-hidden="true" className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
          {secondary}
        </span>
      ) : null}
    </span>
  );
}

// objectstack#29988 — the nav item inspector moved to its own module; re-exported for its pins.
export { StudioNavItemInspector };

/** The Interfaces pillar's leaf identity, `type:name` (`:` when none is open). */
const leafKeyOf = (s: Surface | null): string => `${s?.type ?? ''}:${s?.name ?? ''}`;

/** The key an item of `base` is customized under: the base, `type` and `name`. */
const customizeItemKey = (base: string, type: string, name: string): string => JSON.stringify([base, type, name]);

export function InterfacesPillar({
  packageId,
  packageLabel,
  publishNonce = 0,
  draftNonce = 0,
  onDraftSaved,
  onCreateApp,
  readOnly = false,
  readOnlySettled = true,
  onDirtyChange,
  onSurfaceLabelChange,
  onHeldEditChange,
  customization = null,
  listedManifests = null,
}: {
  packageId: string;
  /** objectstack#29851 — the package list's manifests, as the Studio surface
   * already read them; `null` until that read answers (or when it failed).
   * The no-app empty state reads the open package's declared navigation
   * targets off it, as addresses only. */
  listedManifests?: ReadonlyMap<string, ListedPackageManifest> | null;
  /** objectui#12718 — the package's display name, as the Studio top bar
   * reads it; `undefined` until the package list answers. The pillar names a
   * package with no app by it, so the id shows only when neither exists. */
  packageLabel?: string;
  /** objectstack#28562 — on a read-only base, what its views, dashboards and
   * reports are customized with ({@link StudioBaseCustomization}); `null`
   * otherwise, and then nothing here changes. */
  customization?: StudioBaseCustomization | null;
  publishNonce?: number;
  /** Bumped when a draft is saved elsewhere (e.g. the header's create-app flow) — a
   * re-resolve signal so a just-created app appears without a reload. */
  draftNonce?: number;
  onDraftSaved?: (saved?: StudioSavedDraft) => void;
  /** Invoked from the empty state when this package has no app, to open the
   * header's create-app flow (single source of truth for app creation). */
  onCreateApp?: () => void;
  /** Courtesy gate: hide/disable interface-authoring affordances — nav
   * editing, the canvas's in-place edits and every editor in the right rail
   * (the block inspector, the default inspector, a source page's code editor)
   * included. Both autosaves below are blocked on it, so an affordance that
   * ignored it would take an edit on screen and silently discard it
   * (objectui#11136). */
  readOnly?: boolean;
  /** objectui#11153 — false while the package's write state is still being
   * asked for: the Studio surface learns it from the package list, its own
   * request, not ordered against this pillar's app draft. Only the
   * `?sel=nav:` deep link reads it, and waits on it rather than read the
   * unknown state as writable. Defaults to true: a caller that passes
   * `readOnly` outright has settled it. */
  readOnlySettled?: boolean;
  /** objectui#2600 — mirrors the unsaved-nav-edit state (`navDirty`) up to the
   * Studio header, whose pillar/Home/package navigation unmounts this whole
   * pillar (SPA nav, so no beforeunload). Reports `false` on unmount so a
   * confirmed discard clears the surface's guard. objectstack#29113 — and an
   * open leaf's edit whose last save was refused (`refusedUnsent`): nothing
   * sends it again until the author edits, so it is unsaved work too. */
  onDirtyChange?: (dirty: boolean) => void;
  /** objectui#8219 — reports the open leaf's display label (tagged with the
   * leaf's type and name) up to the surface that mounts the copilot dock, for
   * its "discussing" chip. A label-less leaf reports the text it inherits
   * (objectui#11196), so the chip reads what the rail reads. `null` when no
   * leaf is open, when its display text is empty (a label that is present but
   * resolves to nothing), and on unmount. */
  onSurfaceLabelChange?: (surface: StudioSurfaceLabel | null) => void;
  /** objectui#11910 — the clause of the dashboard edit the leaf autosave holds
   * unsent (a widget not yet bound), or `null`, as the Data and Automations
   * pillars report theirs (objectui#11786); `null` on unmount. */
  onHeldEditChange?: (clause: string | null) => void;
}): React.ReactElement {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  // See DataPillar's rail — same mobile-overlay treatment for the nav tree.
  const isMobile = useIsMobile();
  const [railOpen, setRailOpen] = React.useState(false);

  // objectui#11181 — the app's own `label`, held as the spec types it
  // (`I18nLabel`: a plain string or an inline locale map) and resolved at render
  // in the designer locale, so the rail heading follows a designer-language
  // switch as the nav rows do. ⛔ Never `String()` it: a map reads
  // `[object Object]`.
  // objectui#12718 — `null` until an app is found. A package with no app yet
  // is named by its display name, and by its id only when it declares none.
  const [loadedAppLabel, setAppLabel] = React.useState<I18nLabel | null>(null);
  const appLabel: I18nLabel = loadedAppLabel ?? packageLabel ?? packageId;
  const [appName, setAppName] = React.useState<string | null>(null);
  const [appDraft, setAppDraft] = React.useState<Record<string, unknown>>({});
  // objectui#11272 — the app `appDraft` was loaded for, `app:NAME`: written
  // where the app load installs it, and nowhere else.
  const [appDraftFor, setAppDraftFor] = React.useState('');
  // objectui#11167 — the app document as the server holds it, as far as this
  // pillar knows: written where the load below installs `appDraft` and where a
  // nav save lands. `appDraft` is also the nav edit buffer, so this is what a
  // read-only answer puts back (see the effect below).
  const navBaselineRef = React.useRef<Record<string, unknown>>({});
  const navTree = React.useMemo<NavNode[]>(
    () => (Array.isArray(appDraft.navigation) ? (appDraft.navigation as NavNode[]) : []),
    [appDraft],
  );
  // objectui#12688 — the server's localized text for the app this pillar
  // loaded, paired with the published layer it was translated from
  // (`servedNavText.ts`). The rail DRAWS `railTree` and the heading
  // `railAppLabel`; every editor keeps reading `navTree` / `appLabel`, the
  // authored buffer, so no input ever echoes a served text.
  const [servedNav, setServedNav] = React.useState<ServedNavText | null>(null);
  const [servedContributed, setServedContributed] = React.useState<ServedContributedNav>(NO_SERVED_CONTRIBUTED_NAV);
  const railTree = React.useMemo(() => displayNavTree(navTree, servedNav), [navTree, servedNav]);
  const railAppLabel = displayAppLabel(appLabel, servedNav);
  // objectstack#29786 — what other packages add to this app's navigation,
  // from the base's one customization read (`customization.marks`), placed
  // in the tree the rail draws.
  const customizationMarks = customization?.marks;
  const contributions = React.useMemo(() => baseContributionsOf(customizationMarks), [customizationMarks]);
  const navPlacement = React.useMemo(
    () => placeNavContributions(contributions, appName, railTree),
    [contributions, appName, railTree],
  );
  // nav editing — drag-drop reorder / rename / add / remove via AppNavCanvas
  const [editNav, setEditNav] = React.useState(false);
  const [navSel, setNavSel] = React.useState<{ kind: string; id: string } | null>(null);
  const [navDirty, setNavDirty] = React.useState(false);
  // objectui#11776 — the last nav save's failure, the nav editor's own: shown
  // in the canvas banner beside the pillar's `error` until a nav save lands,
  // or the buffer it was about is put back. Held apart from `error` so a nav
  // save that lands clears its own failure and never one a leaf load or save
  // is still showing. objectui#11785 — held as a refusal: the author sentence,
  // the nav entry it names, and the raw text behind Details.
  const [navError, setNavError] = React.useState<StudioRefusal | null>(null);

  // App resolution status — tells "still loading" apart from "this package has
  // no app", so the canvas shows a real empty state instead of an endless
  // spinner.
  const [appStatus, setAppStatus] = React.useState<'loading' | 'ready' | 'missing'>('loading');

  // objectstack#30059 (ADR-0146 D2) — on a read-only base the navigation is
  // customized as the app's override in the base's pair: the nav editor edits
  // the app document as on a writable package, and its first saved edit
  // copies the whole app into the pair, declaring the override, as a view's
  // Customize does. Unless the ensure door refuses this caller (`walled`), or
  // the base's manifest declares no version: no override can be declared then
  // (`basedOn`), so every save of the copy would be refused and the editor is
  // not offered, as before.
  // ⛔ The pair a write names is the door's answer (`pairFor`); the pair a
  // read names is the surface's (`navPairAt`).
  const navOverridable = readOnly && customization !== null && isStudioCustomizeType('app');
  const navCustomizable = navOverridable && customization?.walled !== true && !!customization?.basedOn;
  const navPairAt = navOverridable ? (customization?.pairId ?? null) : null;

  // objectui#11167 — a read-only answer closes nav editing. The Studio surface
  // learns the package's write state from its own request (see
  // `readOnlySettled`), and an unknown state stays ungated, so the toggle is on
  // offer while that request is in flight: an author can open nav editing, and
  // edit, before `writable: false` arrives. The nav autosave is blocked on
  // `readOnly`, and the server refuses authoring on a read-only package
  // (ADR-0070), so from that answer on nothing in the buffer can be saved.
  //  - Editing closes the way the toggle closes it: `editNav` and `navSel`
  //    reset, and the nav-item inspector (it needs both) goes with them.
  //  - An unsaved edit is put back to the baseline, which the toggle does not
  //    do: on a writable package a buffer kept at "Done" still has an autosave
  //    to reach, and here it has none. Kept, it would stay on screen in the rail
  //    as if it were the package's navigation, and hold the leave guard and the
  //    copilot refresh (both keyed on `navDirty`) for good.
  // Declared BEFORE the `?sel=nav:` deep link below on purpose: effects run in
  // declaration order, and the answer that closes editing is also the one
  // that settles a pending link, so the link applies after the close and its
  // read-only selection is not cleared by it. Both read the same `readOnly`.
  // objectstack#30059 — unless the navigation is customized into the pair.
  React.useEffect(() => {
    if (!readOnly || navCustomizable) return;
    if (editNav) {
      setEditNav(false);
      setNavSel(null);
    }
    if (navDirty) {
      setAppDraft(navBaselineRef.current);
      setNavDirty(false);
      // objectui#11776 — a failure of the buffer just put back is moot.
      setNavError(null);
    }
  }, [readOnly, navCustomizable, editNav, navDirty]);

  // #2272 — designer deep-link: `?sel=nav:<id>` selects the nav item with
  // that spec `id` and switches the pillar into nav editing. The id is the
  // stable external contract; positional `navigation[i]` selection ids stay
  // internal. Selection changes mirror back to the URL (replace).
  // objectui#11153 — the shared hook keeps the param until the app draft has
  // loaded, and on a read-only package selects the item without entering nav
  // editing (whose autosave is blocked there). The pillar reads only the
  // `navigation` root key, so that is the document the link resolves against.
  const navDoc = React.useMemo(() => ({ navigation: navTree }), [navTree]);
  useNavSelDeepLink({
    enabled: true,
    draft: navDoc,
    loaded: appStatus === 'ready',
    readOnly: readOnlySettled ? readOnly : undefined,
    selection: navSel,
    onApply: (hit, { enterEditing }) => {
      if (enterEditing) setEditNav(true);
      setNavSel({ kind: 'nav', id: hit.selectionId });
    },
  });
  // Mirror `navDirty` up to the surface (see the onDirtyChange prop doc); the
  // report itself sits below `refusedUnsent`, which it also reads.
  // Ref-stabilized like PermissionMatrixEditPage's report, so a non-memoized
  // callback prop doesn't refire the effect; the unmount cleanup reports
  // `false` so a deliberately-discarded pillar clears the host's guard state.
  const onDirtyChangeRef = React.useRef(onDirtyChange);
  React.useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  // objectui#11189 — `navDirty` as last committed, for the app load, which
  // installs what it read after an await. The same state, read late; only this
  // effect writes it. (A nav save completing reads the autosave's claim on the
  // buffer it sent instead, objectui#11204.)
  const navCommittedRef = React.useRef({ dirty: navDirty });
  React.useEffect(() => {
    navCommittedRef.current = { dirty: navDirty };
  }, [navDirty]);
  React.useEffect(
    () => () => {
      onDirtyChangeRef.current?.(false);
    },
    [],
  );
  const [navHasDraft, setNavHasDraft] = React.useState(false);
  const [navSaving, setNavSaving] = React.useState<false | 'draft' | 'publish'>(false);
  // objectui#11773 — two buffers, two guards: the open leaf's `draft` and the
  // app document `appDraft` the nav editor saves. Each sends the version its
  // own buffer was saved at; a conflict's "reload" re-runs that buffer's load.
  const [leafReloadNonce, setLeafReloadNonce] = React.useState(0);
  const reloadLeafDraft = React.useCallback(() => setLeafReloadNonce((n) => n + 1), []);
  const {
    save: saveLeafDraft,
    recordRead: recordLeafRead,
    forget: forgetLeafVersion,
    dialog: leafConflictDialog,
  } = useDraftSaveGuard(client, reloadLeafDraft);
  const [navReloadNonce, setNavReloadNonce] = React.useState(0);
  // A reload replaces the buffer even over an unsent edit: the author chose
  // the saved version over it.
  const reloadNavDraft = React.useCallback(() => {
    setNavDirty(false);
    setNavReloadNonce((n) => n + 1);
  }, []);
  const {
    save: saveNavDraft,
    recordRead: recordNavRead,
    forget: forgetNavVersion,
    dialog: navConflictDialog,
  } = useDraftSaveGuard(client, reloadNavDraft);
  // The app load also re-reads after every draft save in the package (the
  // `draftNonce` it keys on), its own included. The re-read that follows this
  // pillar's own nav save installs what that save wrote, so the version stays;
  // any other install forgets it. Holds the `publishNonce` the save landed
  // under: a publish in between dropped the draft, version and all.
  const navEchoRef = React.useRef<number | null>(null);
  // objectstack#30059 — the package the nav buffer's draft read was asked at:
  // the address its pin describes. A first save into a pair the buffer was not
  // read at pins no draft there (`doNavSave`).
  const navReadAtRef = React.useRef<string | null>(null);
  // objectui#7255 — the copilot dock shares this document, so a turn that
  // staged/published metadata converges the rail here instead of waiting for a
  // page reload. HELD while the nav editor has unsaved (or in-flight) edits:
  // this pillar's load rehydrates `appDraft`, which IS the nav edit buffer, so
  // an unheld pulse would overwrite the author mid-drag. The hold defers, it
  // does not drop — autosave clears `navDirty` within a beat and the pulse
  // lands then.
  const metadataRefreshNonce = useMetadataRefreshNonce(navDirty || !!navSaving);
  const [current, setCurrent] = React.useState<Surface | null>(null);
  // objectstack#28572 (ADR-0146 D3) — one surface for a read-only base and its
  // pair. The app, its navigation and the rail's reads stay the base's
  // (`packageId`, `readOnly`); an item the pair adds (`current.addedIn`) opens
  // writable, read and saved at the pair (`leafPackageId`). A New on the
  // read-only base lands in the pair through the ensure door, linked from no
  // navigation (the base's app takes no edit).
  const currentAddedIn = current?.addedIn ?? null;
  const leafPackageId = currentAddedIn ?? packageId;
  const railPairId = readOnly && customization ? customization.pairId : null;
  const railMarks = railCustomizationsOf(customization?.marks, packageId);
  const [onlyCustomized, toggleOnlyCustomized] = useRailCustomizationsOnly();
  const newInPair = readOnly && customization !== null && !customization.walled;
  // Re-reads the rail's items: an item just created in the pair.
  const [itemsNonce, setItemsNonce] = React.useState(0);
  // objectui#11196 — the open leaf's Surface names a label-less entry by what
  // it inherits, asked of the console's own resolver, as the rail's rows ask
  // it. The app load reads it through this ref after its awaits: the latest
  // resolver, and never a dependency of that effect, whose re-run rehydrates
  // the nav edit buffer. (Commandment #10: nothing here rests on the hook's
  // memoised identity.)
  const targetLabel = useNavTargetLabel();
  const targetLabelRef = React.useRef(targetLabel);
  React.useEffect(() => {
    targetLabelRef.current = targetLabel;
  });
  // `?surface=` capture — shared plumbing (see useSurfaceDeepLink). The mirror
  // runs below the list-view buffer: it writes the open view beside the leaf
  // (objectstack#30046).
  const initialSurface = useSurfaceDeepLinkCapture();
  // objectstack#28561 — a deep link to a page, dashboard, report or view that
  // no nav entry opens: the "All metadata" area opens such an item here by
  // URL. The app load below finds no entry for it, so it holds its first-leaf
  // default in `offNavFallbackRef`, and the effect after the package-items read
  // opens the item from those lists, or that default when the package has no
  // such item. Decided once, for the link this pillar mounted with.
  // objectstack#30046 — so does a link to an object no entry opens (the object
  // page a list view under 不在导航中 opens, reloaded or shared): the views
  // the package lists say which object that is.
  const offNavDeepLinkRef = React.useRef<'pending' | 'done'>(
    initialSurface && ([...OFF_NAV_TYPES, 'object'] as readonly string[]).includes(initialSurface.type)
      ? 'pending'
      : 'done',
  );
  // objectstack#30046 — the doors that open a list view on its object's page
  // (`listViewDoorOf`, `openListViewDoor`, below), read by the deep-link
  // effect, which runs before they are defined in this render.
  const listViewDoorRef = React.useRef<{
    of: (item: PackageSurface & { addedIn?: string }) => { surface: Surface; viewId: string } | null;
    objectSurface: (objectName: string) => Surface;
    open: (door: { surface: Surface; viewId: string }) => void;
  } | null>(null);
  const offNavFallbackRef = React.useRef<Surface | null>(null);
  const offNavUpgrade = useDeepLinkFallback();
  const currentRef = React.useRef(current);
  React.useLayoutEffect(() => {
    currentRef.current = current;
  });
  // objectui#8219 — lift the open leaf's label to the dock (see the prop doc).
  // Keyed on the primitives, and the callback read through a ref, so neither a
  // re-created Surface object nor a non-memoized callback refires the report.
  const onSurfaceLabelChangeRef = React.useRef(onSurfaceLabelChange);
  React.useEffect(() => {
    onSurfaceLabelChangeRef.current = onSurfaceLabelChange;
  });
  const currentType = current?.type;
  const currentName = current?.name;
  const currentLabel = current?.label;
  React.useEffect(() => {
    onSurfaceLabelChangeRef.current?.(
      currentType && currentName && currentLabel
        ? { type: currentType, name: currentName, label: currentLabel }
        : null,
    );
  }, [currentType, currentName, currentLabel]);
  React.useEffect(
    () => () => {
      onSurfaceLabelChangeRef.current?.(null);
    },
    [],
  );
  // objectui#12725 — the item's definition (查看定义, the header's ⋯ menu): a
  // source page's code editor, any other item's document as JSON. It replaces
  // the inspector's 源码 tab, the maintainer's 「源码的选项卡有必要保留吗」.
  const [definitionOpen, setDefinitionOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  // objectui#11272 — the leaf `draft` was loaded for, as `leafKeyOf` spells
  // it: written where the load below installs a buffer, and nowhere else.
  const [draftFor, setDraftFor] = React.useState('');
  // objectui#7137 — the block selection is STAMPED with the leaf it was made
  // on, so it expires BY CONSTRUCTION when the leaf changes — the same shape
  // `blockingReport` already uses against `inspectorKey` below, and the reason
  // that one cannot be stranded either.
  //
  // The previous shape was a bare `MetadataSelection | null` whose ONLY clear
  // lived inside the draft-load effect, *after* its
  // `if (!current || !isEditable) … return` guard. So the clear never ran on any
  // leaf where `isEditable` is false, and `isEditable = !!Preview && !StudioCanvas`
  // is a conjunction — that is a studio-canvas leaf OR a leaf whose own type has
  // no registered designer. Walking to either carried a selection describing a
  // block on the PREVIOUS leaf's canvas. Measured before the repair: the scoped
  // inspector mounted three times as `page:home_page:block:blk_1` with `blk_1` a
  // dashboard block, and in the folded layout `hasInspectorTarget` stayed true
  // across the leaf change so `nextCenterTab` saw no edge and stranded the author
  // on Properties ("expected 'Properties' to be 'Canvas'").
  //
  // ⛔ Deliberately NOT repaired by hoisting that imperative clear above the
  // guard. Two reasons, the first measured: a clear in an effect runs one
  // COMMITTED render after the leaf change, so the foreign-block inspector still
  // mounts and runs its effects before being torn down — keying it to the leaf
  // makes `selection` null in the SAME render. And an imperative clear is what
  // this defect was: a guard added later stranded it, and the next guard could
  // strand it again.
  const leafKey = leafKeyOf(current);
  const [selectionState, setSelectionState] = React.useState<{
    key: string;
    value: MetadataSelection | null;
  }>({ key: '', value: null });
  const selection = selectionState.key === leafKey ? selectionState.value : null;
  const setSelection = React.useCallback(
    (next: MetadataSelection | null) => setSelectionState({ key: leafKey, value: next }),
    [leafKey],
  );
  // objectui#12725 — the surface's right slot hosts this pillar's properties
  // (`useStudioRightSlot`); `null` under an injected `aiSlot`, where the
  // classic aside beside the canvas stays.
  const slot = useStudioRightSlot();
  const inSlot = slot !== null;
  const claimSlotProps = slot?.claimProps;
  React.useEffect(() => (claimSlotProps ? claimSlotProps() : undefined), [claimSlotProps]);
  // The classic layout's aside can be collapsed to give the canvas more room —
  // in-memory, per-mount. In the slot the top bar's toggle owns that instead.
  const [inspectorCollapsed, setInspectorCollapsed] = React.useState(false);
  const canCollapseInspector = !inSlot;
  // objectui#12725 — switching by intent: selecting anything on the canvas
  // (or a nav entry in nav editing) shows its properties in the slot; Esc or a
  // click on empty canvas drops the selection, so the slot returns to the
  // item's own properties. Keyed on the selection's identity, so a second
  // element selected while the copilot shows asks again.
  const inspectorTargetKey =
    editNav && navSel ? `nav:${navSel.id}` : selection ? `${selection.kind}:${selection.id}` : '';
  const showSlotProps = slot?.showProps;
  React.useEffect(() => {
    if (inspectorTargetKey && showSlotProps) showSlotProps();
  }, [inspectorTargetKey, showSlotProps]);
  const clearInspectorTarget = React.useCallback(() => {
    setSelection(null);
    setNavSel(null);
  }, [setSelection]);
  // objectstack#26730 — a leaf refusal's "Show me": the widget it names, or the
  // leaf's own properties when it names no selection (a report's), opened in
  // the inspector with the focus on the input the sentence names.
  const inspectorBodyRef = React.useRef<HTMLDivElement>(null);
  const focusInspectorInput = useShowInputFocus(inspectorBodyRef);
  const showLeafRefusal = React.useCallback(
    (target: MetadataSelection | null, input?: string) => {
      setNavSel(null);
      setSelection(target);
      showSlotProps?.();
      setInspectorCollapsed(false);
      focusInspectorInput(input);
    },
    [setSelection, showSlotProps, focusInspectorInput],
  );
  React.useEffect(() => {
    if (!inspectorTargetKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isSlotEscapeExempt(e.target)) return;
      clearInspectorTarget();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inspectorTargetKey, clearInspectorTarget]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState<false | 'draft' | 'publish'>(false);
  const [hasDraft, setHasDraft] = React.useState(false);
  // objectui#11785 — a load failure as it was (`plainRefusal`), a refused leaf
  // save as an author sentence with the raw text behind Details.
  const [error, setError] = React.useState<StudioRefusal | null>(null);
  // objectstack#29851 — on the no-app empty state only: what this package adds
  // to other packages' apps, from the target's served owner and that owner's
  // customization read (the declared app is an address, never shown).
  const contributedElsewhere = useContributedElsewhere(
    packageId,
    appStatus === 'missing' && !error,
    listedManifests,
    (name) => client.get<Record<string, unknown>>('app', name),
  );
  const openContributor = useOpenContributor();
  // Objects in THIS package (published ∪ draft) — the nav item inspector's
  // object picker, so nav can be wired to sibling objects before publishing.
  const [pkgObjects, setPkgObjects] = React.useState<Array<{ name: string; label: string; icon?: string; pair?: true }>>(
    [],
  );
  const objectIconMap = React.useMemo(
    () => Object.fromEntries(pkgObjects.map((o) => [o.name, o.icon])),
    [pkgObjects],
  );
  // objectui#12508 — the package's draft-only objects (a pending draft, no
  // published row), stamped with the publish they were read under: the
  // list-view buffer skips `/layers` for a view of one of them.
  const [draftOnlyObjects, setDraftOnlyObjects] = React.useState<DraftOnlyObjects | null>(null);
  // objectui#12508 — the same names for the canvas: an answer read under an
  // earlier publish is pending, never used.
  const canvasDraftOnly = React.useMemo<StudioCanvasDraftOnlyObjects>(
    () =>
      draftOnlyObjects && draftOnlyObjects.publishNonce === publishNonce
        ? { status: 'known', names: draftOnlyObjects.names }
        : { status: 'pending' },
    [draftOnlyObjects, publishNonce],
  );

  // objectstack#30059 — on a read-only base, its pair's objects follow the
  // base's, so a customized navigation can open an object the pair adds. A
  // failed read of the pair leaves the base's.
  React.useEffect(() => {
    let cancelled = false;
    const readUnder = publishNonce;
    (async () => {
      try {
        const noRows = () => [] as Array<Record<string, unknown>>;
        const [pub, drafts, pairPub, pairDrafts] = await Promise.all([
          client.list('object', { packageId }) as Promise<Array<Record<string, unknown>>>,
          client.listDrafts({ packageId, type: 'object' }).catch(noRows),
          railPairId
            ? (client.list('object', { packageId: railPairId }) as Promise<Array<Record<string, unknown>>>).catch(noRows)
            : noRows(),
          railPairId ? client.listDrafts({ packageId: railPairId, type: 'object' }).catch(noRows) : noRows(),
        ]);
        if (cancelled) return;
        const byName = new Map<string, { name: string; label: string; icon?: string; pair?: true }>();
        const baseRows = [...(pub || []), ...(drafts || [])];
        for (const raw of [...baseRows, ...(pairPub || []), ...(pairDrafts || [])]) {
          const o = raw as Record<string, unknown>;
          const name = String(o.name ?? '');
          if (!name || byName.has(name)) continue;
          const row = { name, label: String(o.label ?? o.name ?? name), icon: o.icon ? String(o.icon) : undefined };
          // Held by the pair only: the entry bound to it gates on it (`requiresObject`).
          byName.set(name, baseRows.includes(raw) ? row : { ...row, pair: true });
        }
        setPkgObjects([...byName.values()]);
        const publishedNames = new Set(
          [...(pub || []), ...(pairPub || [])].map((o) => String((o as Record<string, unknown>).name ?? '')),
        );
        const draftOnly = new Set<string>();
        for (const d of [...(drafts || []), ...(pairDrafts || [])]) {
          const name = String((d as Record<string, unknown>).name ?? '');
          if (name && !publishedNames.has(name)) draftOnly.add(name);
        }
        setDraftOnlyObjects({ publishNonce: readUnder, names: draftOnly });
      } catch {
        /* non-fatal — picker just stays empty */
        // objectui#12508 — and no name is known draft-only, so the canvas
        // renders the records grid as it did before, rather than wait.
        if (!cancelled) setDraftOnlyObjects({ publishNonce: readUnder, names: new Set() });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, packageId, railPairId, publishNonce, draftNonce, metadataRefreshNonce]);

  // objectstack#26889 — the package's pages, dashboards, reports and views,
  // published ∪ draft, each narrowed by its type's own list filter, as
  // Setup › Metadata lists them: the sections under the nav tree list the ones
  // no entry opens (`OffNavSections`). Re-read when the package's metadata
  // moves, as the app is. Stamped with the package read, so a package switch
  // never shows another package's items. A type whose read fails lists
  // nothing, as the object read above leaves its picker empty.
  const [packageItems, setPackageItems] = React.useState<{
    packageId: string;
    byType: Partial<Record<OffNavType, Array<PackageSurface & { addedIn?: string }>>>;
  } | null>(null);
  // objectstack#28572 — on a read-only base, its pair's items of each type
  // are listed beside the base's, each one the base does not name stamped
  // `addedIn` (`withPairItems`). A pair that is not installed reads empty.
  React.useEffect(() => {
    let cancelled = false;
    const read = (at: string) =>
      Promise.all(
        OFF_NAV_TYPES.map((type) =>
          loadPackageSurfaces(client, type, at, locale, getMetadataResource(type)?.listFilter)
            // objectstack#30046 — a view row says its object and family, a
            // draft-only one too: the 视图 group and its doors read them.
            .then((items) => (type === 'view' ? withDraftViewBindings(client, at, items) : items))
            .catch(() => [] as PackageSurface[]),
        ),
      );
    (async () => {
      const [lists, pairLists] = await Promise.all([read(packageId), railPairId ? read(railPairId) : Promise.resolve(null)]);
      if (cancelled) return;
      setPackageItems({
        packageId,
        byType: Object.fromEntries(
          OFF_NAV_TYPES.map((type, i) => [type, withPairItems(lists[i], pairLists?.[i] ?? [], railPairId)]),
        ),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [client, packageId, railPairId, locale, publishNonce, draftNonce, metadataRefreshNonce, itemsNonce]);

  // objectstack#28561 — the off-nav deep link (see `offNavDeepLinkRef`), once
  // both reads it waits on have answered: the app (or its absence), and this
  // package's off-nav lists.
  React.useEffect(() => {
    if (!initialSurface) return;
    if (appStatus === 'loading' || packageItems?.packageId !== packageId) return;
    // objectstack#30046 — a link to an object no entry opens: a list view of
    // it is among the package's views, and the object's page opens (on the
    // view the link names, `initialView` of the list-view buffer).
    const objectViews =
      initialSurface.type === 'object'
        ? (packageItems.byType.view ?? []).some((i) => i.viewKind === 'list' && i.object === initialSurface.name)
        : false;
    const item = (packageItems.byType[initialSurface.type as OffNavType] ?? []).find(
      (i) => i.name === initialSurface.name,
    );
    // objectstack#30046 — a link to a list view itself (`surface=view:`, the
    // All metadata door) lands on its object's page, as a row under 不在导航中
    // does.
    const door = item && initialSurface.type === 'view' ? (listViewDoorRef.current?.of(item) ?? null) : null;
    const linked: Surface | null = door
      ? door.surface
      : objectViews
        ? (listViewDoorRef.current?.objectSurface(initialSurface.name) ?? null)
        : item
          ? { type: item.type, name: item.name, label: item.label, ...(item.addedIn ? { addedIn: item.addedIn } : {}) }
          : null;
    // objectstack#28572 — an item the pair adds is listed once the pair is
    // known, after the package list answers: a link the first lists could not
    // resolve opens it then, while the default it opened is still open.
    if (offNavDeepLinkRef.current === 'done') {
      if (linked && offNavUpgrade.take(currentRef.current ? leafKeyOf(currentRef.current) : null, leafKeyOf(linked))) {
        if (door) listViewDoorRef.current?.open(door);
        else setCurrent(linked);
      }
      return;
    }
    offNavDeepLinkRef.current = 'done';
    if (door && currentRef.current === null) {
      listViewDoorRef.current?.open(door);
      return;
    }
    const target = linked ?? offNavFallbackRef.current;
    if (!linked && target && currentRef.current === null) offNavUpgrade.note(leafKeyOf(target));
    setCurrent((cur) => cur ?? target);
  }, [appStatus, packageItems, packageId, initialSurface, offNavUpgrade]);

  // Resolve THIS package's App → load its navigation tree. The query is scoped
  // to the package (`list('app', { packageId })`) so a design surface only ever
  // shows the current package's app — never another package's. `list()` sees
  // published metadata only, so a freshly-created (unpublished) app is found via
  // `listDrafts()` instead, keeping it designable before its first publish.
  //
  // objectui#7255 — which package we are resolving, so a RE-read of the same
  // package (a publish, a draft save, a copilot pulse) refreshes in place while
  // a genuine package switch still shows the loading state. Without this the
  // status flapped `ready → loading → ready` on every pulse and the nav
  // toolbar (gated on `ready`) blinked once per copilot turn: rebuilding UI for
  // a data refresh, which is exactly what AGENTS.md Commandment #8 forbids.
  const appIdentityRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const isSameApp = appIdentityRef.current === packageId;
    appIdentityRef.current = packageId;
    if (!isSameApp) setAppStatus('loading');
    (async () => {
      try {
        const published = (await client.list('app', { packageId })) as Array<Record<string, unknown>>;
        if (cancelled) return;
        let name = published?.[0]?.name ? String(published[0].name) : null;
        let label: I18nLabel = published?.[0]
          ? ((published[0].label ?? published[0].name ?? packageId) as I18nLabel)
          : packageId;
        if (!name) {
          const drafts = await client.listDrafts({ packageId, type: 'app' });
          if (cancelled) return;
          const d = drafts?.[0];
          if (d?.name) {
            name = String(d.name);
            // objectui#12718 — the `_drafts` row serves the app's label
            // (objectstack-ai/objectstack#22200), as the shell header's
            // draft-only read already takes it.
            const rowLabel = (d as { label?: I18nLabel | null }).label;
            label = rowLabel ?? String(d.name);
          }
        }
        if (!name) {
          setAppStatus('missing');
          return;
        }
        setAppLabel(label);
        setAppName(name);
        // objectui#11799 — an app the published list does not hold was found
        // in the drafts ledger: it has never been saved, so it has no layer to
        // read and `/layers` would answer 404. Its draft is the whole document.
        const saved = !!published?.[0]?.name;
        // objectui#11773 — the draft is read at the address the nav save writes
        // (`?package=` this package), so the version it serves pins that save.
        // objectstack#30059 — on a read-only base, its pair, when one is
        // listed: the pair's draft of the app is the customized navigation.
        const navReadAt = navPairAt ?? packageId;
        const [layRaw, appDraftRead] = await Promise.all([
          // ADR-0048 — read at this package, the app's owner: a layered read
          // naming no package is refused for a name two packages hold. On a
          // read-only base it serves the app's declared override (ADR-0146 D8).
          saved ? client.layered<Record<string, unknown>>('app', name, { packageId }) : null,
          readDraftForSave<Record<string, unknown>>(client, 'app', name, navReadAt),
        ]);
        if (cancelled) return;
        // objectstack#29148 — an app draft the server refused to read (`403`:
        // its audience gate names a capability this author does not hold) is
        // no absence. No nav buffer is installed over it, so the nav is not
        // shown to edit and its autosave has nothing to send: a buffer seeded
        // from the published layer would be saved over the draft, dropping its
        // entries and its gate. The pillar reads it as a failed load.
        if ('refused' in appDraftRead) {
          setAppDraft({});
          setAppDraftFor('');
          setNavDirty(false);
          setEditNav(false);
          setNavHasDraft(true);
          setError({
            message: t('engine.studio.refusal.draftUnreadable', locale),
            detail: formatMetadataError(appDraftRead.refused),
          });
          setAppStatus('missing');
          return;
        }
        // objectstack#30859 — a pending app draft is edited as stored, read at
        // the draft read's address: the served body's label and navigation
        // labels are translated for this locale. A draft whose stored copy was
        // not served installs no nav buffer, as a refused one above.
        const servedAppDraft = extractDraftBody(appDraftRead.answer);
        const authoredApp = servedAppDraft
          ? await readAuthoredDraft(client, 'app', name, servedAppDraft, { packageId: navReadAt })
          : null;
        if (cancelled) return;
        if (authoredApp?.kind === 'unserved') {
          setAppDraft({});
          setAppDraftFor('');
          setNavDirty(false);
          setEditNav(false);
          setNavHasDraft(true);
          setError({ message: t('engine.studio.refusal.draftUnreadable', locale) });
          setAppStatus('missing');
          return;
        }
        const lay = layRaw as { effective?: Record<string, unknown>; code?: Record<string, unknown> } | null;
        const eff = (lay?.effective ?? lay?.code ?? {}) as Record<string, unknown>;
        // objectui#12688 — the list row read above is the server's `/meta`
        // answer, localized for this request; `eff` is the layer it was
        // translated from. A never-saved app has neither, and no served text.
        const served = saved ? servedNavTextOf(eff, published[0]) : null;
        setServedNav(served);
        // objectstack#29851 — from the same two answers: the entries the fold
        // added, by id, for the contributed rows' labels. No request of its own.
        setServedContributed(saved ? servedContributedNavOf(eff, published[0]) : NO_SERVED_CONTRIBUTED_NAV);
        const appDraftBody = authoredApp ? authoredApp.body : null;
        // A served draft is the whole document — taken as-is, never spread
        // over the published layer (objectui#10765; the rule is stated once
        // at `ResourceEditPage`'s load effect). Baseline only when no draft.
        const body = appDraftBody ?? eff;
        // The body's own label, else its name; a body with neither keeps the
        // list row's. A locale map is taken as it is, not stringified.
        const bodyLabel = (body.label ?? body.name) as I18nLabel | undefined;
        if (bodyLabel != null) setAppLabel(bodyLabel);
        // objectui#11189 — a re-read of the same package (a save's
        // draft-saved signal, a publish, a copilot pulse) does not install
        // the served draft over a buffer holding an unsent nav edit, taken
        // before this read or while it was in flight. It defers: the save
        // that sends the edit signals again, and that re-read installs. A
        // package switch replaces the buffer, as it always has.
        if (!isSameApp || !navCommittedRef.current.dirty) {
          setAppDraft(body);
          setAppDraftFor(`app:${name}`);
          // objectui#11773 — the next nav save is pinned to what this read
          // served, unless it is the read-back of this pillar's own nav save
          // (see `navEchoRef`), whose receipt already pins it.
          if (!isSameApp || navEchoRef.current !== publishNonce) {
            recordNavRead('app', name, navReadAt, appDraftRead.pin);
          }
          navReadAtRef.current = navReadAt;
          navEchoRef.current = null;
        }
        navBaselineRef.current = body;
        setNavHasDraft(!!appDraftBody);
        setAppStatus('ready');
        // objectui#12688 — the tree as the rail draws it, so the leaf opened
        // here is captioned with the text its row shows.
        const tree = displayNavTree(Array.isArray(body.navigation) ? (body.navigation as NavNode[]) : [], served);
        // auto-open the first resolvable leaf. Its label is resolved in the
        // designer locale of this load, like the rail's (objectui#11158), and
        // a label-less leaf's with the rail's resolver (objectui#11196).
        // `locale` is deliberately not a dependency of this effect: a language
        // switch must not re-run the load, which rehydrates the nav edit buffer.
        const resolveTarget = targetLabelRef.current;
        const firstLeaf = (function find(nodes: NavNode[]): Surface | null {
          for (const n of nodes) {
            if (n.type === 'group' || n.children?.length) {
              const r = find(n.children ?? []);
              if (r) return r;
            } else {
              const s = resolveSurface(n, locale, resolveTarget);
              if (s) return s;
            }
          }
          return null;
        })(tree);
        // A `?surface=` deep-link wins over the first-leaf default when it
        // still resolves to a leaf in this app's nav; otherwise fall back.
        // Its `?nav=` entry id, when that entry still exists, picks the entry
        // among several that open one target (objectui#11774).
        const deepLinked = initialSurface ? findSurfaceInTree(tree, initialSurface, locale, resolveTarget) : null;
        // objectstack#28561 — an off-nav deep link no entry opens waits for the
        // package's own lists (the effect after the package-items read).
        if (!deepLinked && offNavDeepLinkRef.current === 'pending') {
          offNavFallbackRef.current = firstLeaf;
          return;
        }
        setCurrent((cur) => cur ?? deepLinked ?? firstLeaf);
      } catch (e) {
        if (!cancelled) {
          setError(plainRefusal(e));
          setAppStatus('missing');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, packageId, navPairAt, publishNonce, draftNonce, metadataRefreshNonce, navReloadNonce, recordNavRead]);

  const Preview = useRegisteredMetadataPreview(current?.type ?? '');
  // Studio-canvas surface override: the SAME type can render as a different
  // surface here than in the Data pillar. Only `object` opts in today (→ the
  // runtime records grid, not the field-form designer that is `object`'s
  // MetadataPreview). Overridable/extendable via `registerStudioCanvasPreview`.
  const StudioCanvas = getStudioCanvasPreview(current?.type ?? '');
  // objectui#11774 — the entry the canvas is open on (its id, and an object
  // entry's `filters` / `viewName`), handed to the studio canvas beside its
  // props. Read by value downstream, never by this object's identity.
  const canvasNavEntry = React.useMemo<StudioCanvasNavEntry | null>(
    () => (current ? { navId: current.navId, filters: current.filters, viewName: current.viewName } : null),
    [current],
  );
  const Inspector = useRegisteredMetadataInspector(current?.type ?? '');
  // The "home" (no-selection) inspector for the surface type — e.g. a page's
  // interfaceConfig form. Interface/list pages (kanban/calendar boards) have no
  // block tree, so `selection` never populates; without this the panel would
  // sit permanently on the "click a block" empty state.
  const DefaultInspector = useRegisteredMetadataDefaultInspector(current?.type ?? '');
  // objectui#6795 part C — WHY the three reads above can be `undefined` decides
  // what this pillar may truthfully say, and there are exactly two causes:
  //   1. no designer is registered for THIS type (others are) — a product fact;
  //   2. the registries are empty wholesale, because the module-scope
  //      registration side effect has not run — an environment fact.
  // The retired copy asserted (2)'s cause with (1)'s wording ("design support is
  // in progress") on a branch that renders no preview at all, so it was false
  // either way. `list*Types()` is a read of the SAME already-imported registry
  // module, so telling the two apart costs nothing and invents no state.
  //
  // Every read here is observed (objectui#11939): a registration that lands
  // after this pillar rendered re-renders it, so it leaves these fallbacks by
  // itself. ⛔ Neither branch may promise that recovery all the same: nothing
  // here knows a registration is on its way, so "Loading…" / "try again" would
  // be a statement this pillar cannot back. Both type lists are read
  // unconditionally — a hook behind `&&` would be a conditional hook.
  const registeredPreviewTypes = useRegisteredMetadataPreviewTypes();
  const registeredInspectorTypes = useRegisteredMetadataInspectorTypes();
  const designersUnregistered =
    registeredPreviewTypes.length === 0 && registeredInspectorTypes.length === 0;
  // Blocking author-time issues the right-rail inspector is showing — a CEL
  // predicate that does not parse must not be saveable here either
  // (objectui#4527). #4306 wired the Data pillar only, which left the SAME
  // malformed-CEL publish reachable through this pillar with the gate inert.
  //
  // One hold serves both rail branches, stamped with which of them produced it
  // and with the selection it described, so it expires by construction when the
  // selection changes, when the rail swaps scoped for default, or when the leaf
  // changes — an unmounted inspector can never retract its last verdict.
  const [blockingReport, setBlockingReport] = React.useState({ key: '', count: 0 });
  const inspectorKey = `${leafKey}:${selection ? `${selection.kind}:${selection.id}` : 'default'}`;
  const inspectorBlocking = blockingReport.key === inspectorKey ? blockingReport.count : 0;
  // A studio-canvas surface (e.g. object → runtime records grid) renders the
  // running app, not an editable draft — schema editing is the Data pillar's
  // job — so those leaves are not draft-editable in this canvas.
  const isEditable = !!Preview && !StudioCanvas;
  // objectstack#28562 (ADR-0146 D2, D3) — Customize. On a read-only base a
  // view, dashboard or report (and an `object` leaf's list view) is edited in
  // the base's paired customization package, as a declared override of the
  // base's item. Its editors stay read-only until Customize is pressed, or
  // while the server serves no override of it; nothing is written until an
  // edit is saved, and that save asks the ensure door for the pair (once per
  // item) and writes there. ⛔ The pair a write names is the door's answer,
  // never a `<base>.custom` spelled here; the pair a READ names is the
  // surface's (`StudioBaseCustomization.pairId`), read through this ref, so a
  // pair the first save creates never reloads the buffer it saved.
  const customizationRef = React.useRef(customization);
  React.useLayoutEffect(() => {
    customizationRef.current = customization;
  });
  const customizing = readOnly && customization !== null;
  const customizeBase = customizing && customization ? customization.base : null;
  const customizePair = customizing && customization ? customization.pairId : null;
  const customizeBaseLabel = customization?.baseLabel ?? packageId;
  // objectstack#30436 — the pair the "saved to" note names: the served one, or
  // the `<base>.custom` id the first save creates.
  const customizeNotePair = customization ? (customization.pairId ?? pairIdOf(customization.base)) : null;
  const customizeWalled = customizing && customization?.walled === true;
  const customizeBlock: CustomizeBlock = customizeWalled
    ? 'walled'
    : customizing && !customization?.basedOn
      ? 'noVersion'
      : null;
  // The items Customize was pressed on (`customizeItemKey`): unlocked, nothing saved yet.
  const [customizeAsked, setCustomizeAsked] = React.useState<ReadonlySet<string>>(() => new Set());
  const askCustomize = React.useCallback((key: string) => {
    setCustomizeAsked((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  // The ensure door's answer for each item's first saved edit: asked once
  // per item, and again only after a refusal.
  const pairsByItemRef = React.useRef(new Map<string, Promise<string>>());
  const pairFor = React.useCallback(
    (custom: StudioBaseCustomization, type: string, name: string): Promise<string> => {
      const key = customizeItemKey(custom.base, type, name);
      const held = pairsByItemRef.current.get(key);
      if (held) return held;
      const asked = custom.ensure();
      pairsByItemRef.current.set(key, asked);
      asked.catch(() => {
        if (pairsByItemRef.current.get(key) === asked) pairsByItemRef.current.delete(key);
      });
      return asked;
    },
    [],
  );
  // Re-reads the served declarations: an item's first save into the pair, a restore.
  const [servedNonce, setServedNonce] = React.useState(0);
  const servedKey = `${publishNonce}:${servedNonce}`;
  // A restore in flight: no save is sent beside it.
  const [restoring, setRestoring] = React.useState(false);
  // objectstack#28562 — the package the leaf buffer's draft read was asked
  // at: the address its pin describes (see `doSave`).
  const leafReadAtRef = React.useRef<{ key: string; at: string } | null>(null);
  const leafCustomizable =
    customizing && !!current && !current.addedIn && isEditable && isStudioCustomizeType(current.type);
  const leafServed = useServedOverride(client, leafCustomizable ? current : null, customizeBase, customizePair, servedKey);
  const leafCustomizeKey =
    current && customizeBase ? customizeItemKey(customizeBase, current.type, current.name) : '';
  const leafInPair = leafCustomizable && leafServed.declaration !== null;
  const leafUnlocked =
    leafCustomizable &&
    !customizeWalled &&
    (leafInPair || (customizeBlock === null && customizeAsked.has(leafCustomizeKey)));
  // objectstack#28572 — an item the pair adds is the pair's, and writable.
  const leafReadOnly = readOnly && !leafUnlocked && currentAddedIn === null;
  const leafInPairRef = React.useRef(leafInPair);
  React.useLayoutEffect(() => {
    leafInPairRef.current = leafInPair;
  });
  // objectstack#30059 — the app's override the server serves (the pair's
  // draft, else the read's overlay): the rail's mark and its Restore read it.
  // The navigation is editable on a read-only base once the pair holds the
  // override, or while the version to declare is known.
  const navServed = useServedOverride(
    client,
    navOverridable && appName ? { type: 'app', name: appName } : null,
    customizeBase,
    customizePair,
    servedKey,
  );
  const navInPair = navOverridable && navServed.declaration !== null;
  const navWritable = !readOnly || (navCustomizable && (navInPair || customizeBlock === null));
  const navInPairRef = React.useRef(navInPair);
  React.useLayoutEffect(() => {
    navInPairRef.current = navInPair;
  });
  // objectui#5800 — Design ⇄ Run: one canvas, two modes (ADR-0080's pivot made
  // visible). Run mode is pure subtraction: `editing=false` drops the design
  // overlays (dashboard widget overlays, page block canvas) and the SAME
  // renderer serves the interactive runtime — click New, enter a record.
  // Selection state is retained so switching back to design keeps context.
  const [canvasMode, setCanvasMode] = React.useState<'design' | 'run'>('design');
  const designing = canvasMode === 'design';
  // `kind: 'html'`/`'react'` pages are a `source` string (ADR-0080/0081),
  // rendered by SourcePageEditor as a code-editor + live-preview split — there
  // is no block tree, so `selection` never populates and the generic "click a
  // block" Properties empty state below would otherwise be permanently dead
  // for these pages.
  const sourcePageKind = current?.type === 'page' ? (draft as { kind?: string })?.kind : undefined;
  const isSourcePage = sourcePageKind === 'html' || sourcePageKind === 'react';

  // objectui#12688 — the published layer of the open dashboard leaf: the
  // document the server translated the dashboard it serves from, which the
  // component list's served widget titles are paired with
  // (`servedDashboardText.ts`). Stamped with the leaf it was read for; `read`
  // is false while a leaf with a pending draft has not had it read yet.
  const [leafPublished, setLeafPublished] = React.useState<{
    key: string;
    doc: Record<string, unknown> | null;
    read: boolean;
  }>({ key: '', doc: null, read: false });

  // objectstack#29311 — the served verdict on the open leaf as its load read
  // it (the pending draft's `_diagnostics`, kept before `extractDraftBody`
  // strips them, else the published layer's), and the body it judged. A form
  // view's `form-field-unknown` warnings ride here. Stamped with its leaf, as
  // `leafPublished` is; never part of the buffer, so no save carries it.
  const [leafVerdict, setLeafVerdict] = React.useState<{
    key: string;
    diagnostics: ServerDiagnostics | undefined;
    judged: unknown;
  }>({ key: '', diagnostics: undefined, judged: undefined });

  // Load the selected surface's draft (only for editable preview types).
  React.useEffect(() => {
    if (!current || !isEditable) {
      // objectui#11272 — `{}` is this leaf's buffer, not the page it replaces:
      // stamped as this leaf's, and clean, like every buffer a load installs.
      // Otherwise a dirty flag raised on a page outlived it, and reopening
      // that page with its reload slower than the debounce sent `{}` as the
      // page's draft.
      setDraft({});
      setDraftFor(leafKeyOf(current));
      forgetLeafVersion();
      leafReadAtRef.current = null;
      setHasDraft(false);
      setIfDirty(false);
      setLeafRefusedFor(null);
      setLeafVerdict({ key: leafKeyOf(current), diagnostics: undefined, judged: undefined });
      return;
    }
    let cancelled = false;
    // objectui#11331 — whether this run's load has settled (see the cleanup).
    let settled = false;
    setLoading(true);
    setError(null);
    // A LEAF CHANGE no longer needs this — `selection` is keyed to the leaf and
    // is already null by the time this runs (objectui#7137). What is left is the
    // narrower case this effect also fires for: a RELOAD of the same leaf
    // (`publishNonce` bumped, or a new `client`), where the leaf key is unchanged
    // and a block selected against the pre-publish draft should not carry into
    // the reloaded one.
    setSelection(null);
    (async () => {
      try {
        // objectui#11773 — read at the address the leaf save writes, so the
        // version it serves pins that save. objectstack#28562 — a read-only
        // base's view, dashboard or report: its pair, when one is listed.
        // objectstack#28572 — an item the pair adds, at the pair it was listed in.
        const pair = customizing ? customizationRef.current?.pairId : null;
        const readAt = current.addedIn ?? (pair && isStudioCustomizeType(current.type) ? pair : packageId);
        const draftRead = await readDraftForSave<Record<string, unknown>>(client, current.type, current.name, readAt);
        if (cancelled) return;
        // A pending draft the server refused to read (`403`: its audience gate
        // names a capability this author does not hold) is no absence. No
        // buffer is installed over it, so nothing is shown to edit and the
        // autosave has nothing to send: a buffer seeded from the published
        // layer would be saved over the draft, dropping its keys and its gate.
        // objectstack#29884 — and a buffer already stamped as this leaf's is
        // taken back: the `{}` the no-designer arm above installs while the
        // built-in designers are still loading, or the body an earlier read of
        // this leaf installed before a reload. A stamped buffer is a loaded one
        // to the autosave, the canvas, the inspector and the item tools.
        if ('refused' in draftRead) {
          setDraft({});
          setDraftFor('');
          forgetLeafVersion();
          leafReadAtRef.current = null;
          setIfDirty(false);
          setError({
            message: t('engine.studio.refusal.draftUnreadable', locale),
            detail: formatMetadataError(draftRead.refused),
          });
          return;
        }
        // objectstack#30859 — a pending draft is edited as stored, read at the
        // draft read's address: the served body of a page, a view, a dashboard
        // or a report is translated for this locale. A draft whose stored copy
        // was not served installs no buffer, as a refused one above.
        const served = extractDraftBody(draftRead.answer);
        const authored = served
          ? await readAuthoredDraft(client, current.type, current.name, served, { packageId: readAt })
          : null;
        if (cancelled) return;
        if (authored?.kind === 'unserved') {
          setDraft({});
          setDraftFor('');
          forgetLeafVersion();
          leafReadAtRef.current = null;
          setIfDirty(false);
          setError({ message: t('engine.studio.refusal.draftUnreadable', locale) });
          return;
        }
        const body = authored ? authored.body : null;
        // objectui#11799 — the baseline is read only when it is used, for a
        // leaf with no pending draft. An unsaved leaf always has one, so it
        // never asks `/layers`, which answers 404 for a name with no layer.
        // ADR-0048 — read at the leaf's owner: a layered read naming no
        // package is refused for a name two packages hold. That is the pair
        // for an item the pair adds; else this package, whose read on a
        // read-only base serves its declared override (ADR-0146 D8).
        const lay = body
          ? null
          : await client.layered<Record<string, unknown>>(current.type, current.name, {
              packageId: current.addedIn ?? packageId,
            });
        if (cancelled) return;
        const baseline = ((lay as { effective?: unknown; code?: unknown } | null)?.effective ??
          (lay as { code?: unknown } | null)?.code ??
          {}) as Record<string, unknown>;
        // objectui#12688 — with no pending draft the baseline just read IS the
        // dashboard's published layer; with one, it is read below, and only
        // for a dashboard the server serves (so never for an unsaved one).
        if (current.type === 'dashboard') {
          setLeafPublished({ key: leafKeyOf(current), doc: body ? null : baseline, read: !body });
        }
        // Served draft as-is, baseline only without one (objectui#10765): a
        // spread over `effective` resurrects every key the draft deleted.
        setDraft(body ?? baseline);
        setDraftFor(leafKeyOf(current));
        // objectstack#29311 — the verdict on that body, and the body it judged.
        setLeafVerdict({
          key: leafKeyOf(current),
          diagnostics: editedItemDiagnostics({
            hasDraft: !!body,
            draftDiagnostics: draftEnvelopeDiagnostics(draftRead.answer),
            layered: lay,
          }),
          judged: body ?? baseline,
        });
        // objectui#11773 — the next save is pinned to what the draft read served.
        recordLeafRead(current.type, current.name, readAt, draftRead.pin);
        leafReadAtRef.current = { key: leafKeyOf(current), at: readAt };
        setHasDraft(!!body);
        setIfDirty(false);
        setLeafRefusedFor(null);
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
      // its start claimed. Its `finally` will not lower `loading`, and the next
      // run may start no load at all (a leaf with no designer returns early
      // above), which left the canvas on "Loading…" for good. A next run that
      // does load raises the flag again in this same effect flush, so the two
      // updates batch into one render; the `!draftLoaded` arm covers the new
      // leaf either way. The Data and Automations pillars' loads follow the
      // same rule.
      if (!settled) setLoading(false);
    };
  }, [client, current, isEditable, packageId, publishNonce, leafReloadNonce, recordLeafRead, forgetLeafVersion, customizing]);

  // objectstack#29311 — the open leaf's verdict as the canvas preview's
  // `diagnostics` (a form view's preview shows its warnings at their sections).
  // This pillar does not read the leaf again after an autosave, so an entry
  // whose value the author has since edited is dropped rather than shown about
  // a body no longer on screen (`verdictEntriesStillShown`).
  const leafDiagnostics = React.useMemo(
    () =>
      leafVerdict.key === leafKey
        ? verdictEntriesStillShown(leafVerdict.diagnostics, leafVerdict.judged, draft)
        : undefined,
    [leafVerdict, leafKey, draft],
  );

  // objectui#12688 — the open dashboard as the server serves it for this
  // session's language: the `/meta` dashboard list the console's metadata
  // store holds (`translateDashboard` localized it). Asked of the store only
  // while a dashboard leaf is open.
  const metadata = useMetadata();
  const servedDashboard =
    currentType === 'dashboard' && currentName
      ? ((findByName(metadata.dashboards, currentName) as Record<string, unknown> | undefined) ?? null)
      : null;
  // A dashboard leaf with a pending draft reads its published layer once, to
  // pair the served titles with: only when the server serves that dashboard,
  // so a never-published draft asks no `/layers` (objectui#11799).
  const publishedPending =
    currentType === 'dashboard' && leafPublished.key === leafKey && !leafPublished.read && !!servedDashboard;
  React.useEffect(() => {
    if (!publishedPending || !currentType || !currentName) return;
    const key = leafKey;
    let cancelled = false;
    // ADR-0048 — at the leaf's owner, as the leaf's load reads its baseline.
    client.layered<Record<string, unknown>>(currentType, currentName, { packageId: leafPackageId }).then(
      (lay) => {
        if (cancelled) return;
        const doc = ((lay as { effective?: unknown; code?: unknown } | null)?.effective ??
          (lay as { code?: unknown } | null)?.code ??
          null) as Record<string, unknown> | null;
        setLeafPublished({ key, doc, read: true });
      },
      // Display only: an unreadable layer leaves every title authored.
      () => {
        if (!cancelled) setLeafPublished({ key, doc: null, read: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [publishedPending, client, currentType, currentName, leafKey, leafPackageId]);
  const servedWidgets = React.useMemo(
    () =>
      currentType === 'dashboard' && leafPublished.key === leafKey && leafPublished.read
        ? servedWidgetTextOf(leafPublished.doc, servedDashboard)
        : null,
    [currentType, leafPublished, leafKey, servedDashboard],
  );

  // objectui#5813 — a local dirty flag so auto-save only arms after a real
  // edit, never on the load-effect's own setDraft.
  const [ifDirty, setIfDirty] = React.useState(false);
  // objectui#12522 — when this pillar's own save last landed a leaf's draft,
  // stamped with the leaf it saved, so it reads for that leaf only and expires
  // by construction when another leaf opens. A source page's editor says it.
  const [leafSavedAt, setLeafSavedAt] = React.useState<{ key: string; at: Date } | null>(null);
  // objectstack#29113 — the leaf whose last save was refused (`leafKeyOf`), so
  // its edit, still in the buffer and sent again only after another edit
  // (`useDraftAutoSave`), counts as unsaved work: a save that lands, or a
  // buffer a load installs, clears it.
  const [leafRefusedFor, setLeafRefusedFor] = React.useState<string | null>(null);
  const onPatch = React.useCallback(
    (patch: Record<string, unknown>) => {
      setDraft((d) => ({ ...d, ...patch }));
      setIfDirty(true);
    },
    [],
  );
  const doSave = React.useCallback(async (sent: DraftSend) => {
    if (!current) return;
    setSaving('draft');
    // objectui#11950 — each save starts clear, as the Data and Automations
    // pillars' do: a refusal is about the body its save sent, so it goes when
    // a later save is sent, and a save refused again shows its own.
    setError(null);
    const body = interfacesSaveBody(current.type, draft);
    try {
      // objectstack#28562 — a read-only base's view, dashboard or report is
      // saved into the pair the ensure door answers, declaring the override.
      // A refused door is shown as it was sent, and nothing is saved.
      // objectstack#28572 — an item the pair adds is saved at that pair as it
      // is: it is no override, so it declares none.
      const custom = readOnly && !current.addedIn ? customizationRef.current : null;
      let target: { packageId: string; body: Record<string, unknown> } = { packageId: current.addedIn ?? packageId, body };
      let entering = false;
      if (custom && isStudioCustomizeType(current.type)) {
        let pair: string;
        try {
          pair = await pairFor(custom, current.type, current.name);
        } catch (e) {
          setError(plainRefusal(e));
          setLeafRefusedFor(leafKeyOf(current));
          return;
        }
        const declared = overrideDraftBody(body, custom.base, custom.basedOn);
        if (declared === null) {
          setError({ message: tFormat('engine.studio.customize.noVersion', locale, { package: custom.baseLabel }) });
          setLeafRefusedFor(leafKeyOf(current));
          return;
        }
        // The buffer was read at another package (the base, before its pair
        // was listed): the pair is taken to hold no draft of the item, so a
        // draft there is a conflict the author is asked about, never one
        // this save overwrites. Its receipt pins the saves after it.
        const key = leafKeyOf(current);
        if (!(leafReadAtRef.current?.key === key && leafReadAtRef.current.at === pair)) {
          recordLeafRead(current.type, current.name, pair, { ifNoneMatch: '*' });
          leafReadAtRef.current = { key, at: pair };
        }
        entering = !leafInPairRef.current;
        target = { packageId: pair, body: declared };
      }
      const outcome = await saveLeafDraft(current.type, current.name, target.body, {
        mode: 'draft',
        packageId: target.packageId,
        surface: 'studio',
      });
      // objectui#11773 — the author chose the saved version; the load replaces the buffer.
      if (outcome === 'reloaded') return;
      // The badge reads the declaration the server now serves.
      if (entering) setServedNonce((n) => n + 1);
      setHasDraft(true);
      setLeafSavedAt({ key: leafKeyOf(current), at: new Date() });
      setLeafRefusedFor(null);
      // objectui#11204 — clean only if nothing was edited while it was in flight.
      if (sent.unmoved()) setIfDirty(false);
      // objectstack#28984 — named as the rail names the leaf.
      announceDraftSaved({ type: current.type, name: current.name }, current.label, locale);
      onDraftSaved?.({ type: current.type, name: current.name });
    } catch (e) {
      // objectui#11785 — a page's issue paths (its blocks) name no input this
      // pillar can open, so the sentence says the draft was refused and
      // Details keep every path. objectstack#26730 — a dashboard's widget and
      // a report's own properties are placed (`leafIssueLocator`).
      setError(issueRefusal(e, locale, leafIssueLocator(current.type, body, locale)));
      setLeafRefusedFor(leafKeyOf(current));
    } finally {
      setSaving(false);
    }
  }, [saveLeafDraft, current, draft, onDraftSaved, packageId, locale, readOnly, pairFor, recordLeafRead]);
  // objectui#11910 — a dashboard edit that leaves a widget's binding out (a
  // widget just added, before its dataset and measures are picked) is held, not
  // sent: the draft door would refuse it with a 422 naming that input. The
  // widget's inspector hints the input, and the line on the canvas names it.
  // Asked of the spec's own widget schema (`dashboardHeldEdit`); a widget that
  // is finished but wrong is sent, and its refusal shows as before.
  // objectstack#27459 — so is an item just added to one of the dashboard's
  // own list properties (Global Filters, the header's Actions), asked of the
  // spec's dashboard schema, until its required inputs are filled in.
  // objectstack#27785 — a report likewise: an item just added to Order or a
  // joined report's Blocks, or a chart whose type is picked before its axes,
  // asked of the spec's report schema (`reportHeldEdit`).
  const leafType = current?.type;
  const leafIncomplete = React.useMemo(() => {
    if (!ifDirty) return null;
    if (leafType === 'dashboard') return dashboardHeldEdit(draft, locale);
    if (leafType === 'report') return reportHeldEdit(draft, locale);
    return null;
  }, [ifDirty, leafType, draft, locale]);
  const { loaded: draftLoaded } = useDraftAutoSave({
    // objectui#11232 — the leaf `doSave` addresses, `type:name`.
    target: leafKey,
    loadedFor: draftFor,
    dirty: ifDirty,
    blocked:
      !current || !isEditable || !!saving || leafReadOnly || restoring || inspectorBlocking > 0 || leafIncomplete !== null,
    snapshot: draft,
    save: doSave,
  });
  // Only the open leaf's own buffer is held (objectui#11272).
  const leafHeld = draftLoaded ? leafIncomplete : null;
  // objectstack#27464 — a nav rename typed but not committed (blur / Enter)
  // lives only in the canvas input, so it is held as the leaf's edit is: the
  // same report, so the surface's one guard (beforeunload included) asks.
  const [navRenamePending, setNavRenamePending] = React.useState<string | null>(null);
  const navRenameClause =
    navRenamePending === null ? null : tFormat('engine.studio.held.navRename', locale, { item: navRenamePending });
  // objectui#12725 — the header's draft line reads the badge's ledger.
  const leafDraftStatus = useStudioItemDraftStatus(
    current ? { type: current.type, name: current.name } : null,
    hasDraft && draftLoaded,
    locale,
  );

  // objectui#11823 — an `object` leaf's list view: the third buffer, edited in
  // the Properties panel and shown on the canvas, autosaved to the package
  // draft like the other two. Blocked on `readOnly` like them.
  // objectstack#28562 — on a read-only base the view is read in its pair and
  // customized there (`ListViewCustomization`); a restore reloads it.
  const listViewCustomization = React.useMemo<ListViewCustomization | null>(
    () =>
      customizing
        ? {
            readAt: () => customizationRef.current?.pairId ?? null,
            writeTarget: async (viewId, row) => {
              const custom = customizationRef.current;
              if (!custom) return { packageId, body: row };
              const pair = await pairFor(custom, 'view', viewId);
              const body = overrideDraftBody(row, custom.base, custom.basedOn);
              if (body === null) {
                throw new Error(tFormat('engine.studio.customize.noVersion', locale, { package: custom.baseLabel }));
              }
              return { packageId: pair, body };
            },
          }
        : null,
    [customizing, pairFor, packageId, locale],
  );
  const [listViewRestoreNonce, setListViewRestoreNonce] = React.useState(0);
  const listView = useObjectListViewDraft({
    client,
    packageId,
    leaf: current,
    publishNonce: publishNonce + listViewRestoreNonce,
    draftOnlyObjects,
    onDraftSaved,
    customization: listViewCustomization,
    // objectstack#30046 — the view a link names, shown once its leaf opens.
    initialView: initialSurface?.viewId ? { surface: initialSurface, viewId: initialSurface.viewId } : null,
  });
  // `?surface=` mirror (see useSurfaceDeepLink), with the view an `object`
  // leaf shows when it is not the one its entry opens (objectstack#30046).
  useSurfaceDeepLinkMirror(current, current?.type === 'object' && listView.entryTarget ? (listView.target?.viewId ?? null) : null);
  // objectstack#30046 — an object's name as the Studio shows it: the label the
  // shell's metadata serves in this locale, else this package's own row, else
  // the name. Names the page of an object no entry opens, and its forms.
  const objectLabelOf = (objectName: string): string =>
    resolveI18nLabel((findByName(metadata.objects, objectName) as { label?: I18nLabel } | undefined)?.label, locale)?.trim() ||
    pkgObjects.find((o) => o.name === objectName)?.label ||
    objectName;
  // objectstack#30046 (Scope 6) — a list view opened from a door outside the
  // header (a row under 不在导航中, a link to the view itself) lands on its
  // object's page, the one page a list view is edited on: the object's nav
  // entry when it has one (the first, in tree order, as a link to the object
  // finds it), else the object itself, with no entry. A form view, a view
  // whose family or object is unknown, and one a read-only base's pair adds
  // (read and saved at that pair) open as themselves, as before.
  const objectSurfaceOf = (objectName: string): Surface =>
    findSurfaceInTree(navTree, { type: 'object', name: objectName }, locale, targetLabel) ?? {
      type: 'object',
      name: objectName,
      label: objectLabelOf(objectName),
    };
  const listViewDoorOf = (item: PackageSurface & { addedIn?: string }): { surface: Surface; viewId: string } | null =>
    item.type === 'view' && item.viewKind === 'list' && item.object && !item.addedIn
      ? { surface: objectSurfaceOf(item.object), viewId: item.name }
      : null;
  const openListView = listView.openView;
  const openListViewDoor = (door: { surface: Surface; viewId: string }) => {
    openListView(door.surface, door.viewId);
    setCurrent(door.surface);
  };
  React.useLayoutEffect(() => {
    listViewDoorRef.current = { of: listViewDoorOf, objectSurface: objectSurfaceOf, open: openListViewDoor };
  });
  const listViewTargetId = listView.target?.viewId ?? null;
  const listViewCustomizable = customizing && listViewTargetId !== null;
  const listViewServed = useServedOverride(
    client,
    listViewCustomizable && listViewTargetId ? { type: 'view', name: listViewTargetId } : null,
    customizeBase,
    customizePair,
    `${servedKey}:${listViewRestoreNonce}`,
  );
  const listViewCustomizeKey =
    listViewTargetId && customizeBase ? customizeItemKey(customizeBase, 'view', listViewTargetId) : '';
  const listViewInPair = listViewCustomizable && listViewServed.declaration !== null;
  const listViewUnlocked =
    listViewCustomizable &&
    !customizeWalled &&
    (listViewInPair || (customizeBlock === null && customizeAsked.has(listViewCustomizeKey)));
  const listViewReadOnly = readOnly && !listViewUnlocked;
  // The view's first save into the pair: the badge reads what is now served.
  const listViewSavedInPair = listViewUnlocked && !listViewInPair && listView.hasDraft;
  React.useEffect(() => {
    if (listViewSavedInPair) setServedNonce((n) => n + 1);
  }, [listViewSavedInPair]);
  // objectstack#27895 — an edit that clears a required setting of the view
  // type's own block (a calendar's start date) is held, not sent, as a
  // leaf's is: asked of the spec's list-view schema (`listViewHeldEdit`).
  // objectstack#30046 — so is an edit while a conditional-formatting rule's
  // CEL does not parse (the panel's `ListViewMoreSection`), as the view's own
  // page held its Save on the same verdicts.
  const listViewTargetKey = listView.targetKey;
  const [listViewCel, setListViewCel] = React.useState<{ key: string; count: number }>({ key: '', count: 0 });
  const reportListViewCel = React.useCallback(
    (count: number) =>
      setListViewCel((prev) => (prev.key === listViewTargetKey && prev.count === count ? prev : { key: listViewTargetKey, count })),
    [listViewTargetKey],
  );
  const listViewCelBlocking = listViewCel.key === listViewTargetKey ? listViewCel.count : 0;
  const listViewHeld =
    listViewHeldEdit(listView, locale) ??
    (listViewCelBlocking > 0 && listView.dirty && listView.target
      ? {
          clause: tFormat('engine.studio.held.inspectorInvalid', locale, {
            item: listViewNameOf(listView, listView.target, listView.row, locale),
          }),
          target: null,
        }
      : null);
  const { flush: flushListView } = useDraftAutoSave({
    target: listView.targetKey,
    loadedFor: listView.loadedFor,
    dirty: listView.dirty,
    blocked: !listView.target || listView.saving || listViewReadOnly || restoring || listViewHeld !== null,
    snapshot: listView.row,
    save: listView.save,
  });
  useHeldEditReport(onHeldEditChange, leafHeld?.clause ?? listViewHeld?.clause ?? navRenameClause);
  const heldUnsent = leafHeld !== null || listViewHeld !== null;
  // objectstack#29113 — an edit of the open leaf whose last save was refused:
  // the leaf buffer's, or an object leaf's list view's. Not held (a held edit
  // is never sent, and the publish refuses over one), but unsent all the same.
  const listViewRefused = listView.dirty && listView.failure?.during === 'save';
  const refusedUnsent = (ifDirty && draftLoaded && leafRefusedFor === leafKey) || listViewRefused;
  const leafUnsent = heldUnsent || refusedUnsent;
  React.useEffect(() => {
    onDirtyChangeRef.current?.(navDirty || refusedUnsent);
  }, [navDirty, refusedUnsent]);
  // objectstack#27896 — the panel's view picker (and its "Back to …") opens
  // another view of the object in the one list-view buffer, whose load
  // replaces the open view's edits, and the autosave sends nothing once the
  // view has changed (objectui#11232). So the switch sends a pending edit
  // first with the autosave's own `flush` and shows the view once the buffer
  // is clean, as the Data pillar's object rail does (objectstack#27511); a
  // save in flight is waited out the same way. An edit that cannot be sent
  // (held, or its save refused with the refusal on screen) is the author's to
  // drop: the switch asks (objectstack#26705).
  const [listViewSwitchTo, setListViewSwitchTo] = React.useState<string | null>(null);
  const listViewDirty = listView.dirty;
  const listViewSaving = listView.saving;
  const listViewHolds = listViewHeld !== null;
  const showListView = listView.showView;
  const switchListView = React.useCallback(
    (viewId: string) => {
      if (listViewSaving || (listViewDirty && !listViewHolds && flushListView())) {
        setListViewSwitchTo(viewId);
        return;
      }
      if (!confirmDropUnsavedWork(listViewDirty, locale)) return;
      setListViewSwitchTo(null);
      setSelection(null);
      showListView(viewId);
    },
    [listViewSaving, listViewDirty, listViewHolds, flushListView, locale, setSelection, showListView],
  );
  React.useEffect(() => {
    if (!listViewSwitchTo || listViewSaving) return;
    if (listViewDirty && !listViewHolds && flushListView()) return;
    setListViewSwitchTo(null);
    // Still dirty: the save was refused (on screen) or an edit taken meanwhile
    // is held. The author stays; the next switch asks.
    if (listViewDirty) return;
    setSelection(null);
    showListView(listViewSwitchTo);
  }, [listViewSwitchTo, listViewSaving, listViewDirty, listViewHolds, flushListView, setSelection, showListView]);
  // objectui#12725 — a click on a column header in an `object` leaf's canvas
  // selects that column (`StudioCanvasColumnSelectionContext`): the pillar's
  // one selection, so it shows in the panel's column list, asks the slot for
  // 属性, and Esc or an empty-canvas click drops it as on a dashboard. Only
  // the columns the panel lists are offered; another header keeps sorting.
  const columnFieldsKey = JSON.stringify(current?.type === 'object' ? listViewColumnFields(listView) : []);
  const listViewObject = listView.target?.objectName;
  const selectedColumnIndex = listViewColumnIndexOf(selection);
  const canvasColumns = React.useMemo<StudioCanvasColumnSelection | null>(() => {
    const fields = JSON.parse(columnFieldsKey) as string[];
    if (!listViewObject || fields.length === 0) return null;
    return {
      objectName: listViewObject,
      fields,
      selected: selectedColumnIndex != null ? (fields[selectedColumnIndex] ?? null) : null,
      onSelect: (field, label) => {
        const index = fields.indexOf(field);
        if (index >= 0) setSelection(listViewColumnSelection(index, label));
      },
    };
  }, [columnFieldsKey, listViewObject, selectedColumnIndex, setSelection]);
  // objectui#12725 — and on a kanban view, a click on a card selects the
  // board's card (`StudioCanvasCardSelectionContext`): the same one
  // selection, `{ kind: 'card' }`, so the slot, Esc and the empty-canvas
  // click treat it as they treat a column. Its properties are the panel's
  // kanban card section.
  const kanbanLeaf = current?.type === 'object' && listViewIsKanban(listView);
  const selectedCardId = listViewCardIdOf(selection);
  const cardLabel = t('engine.studio.inspector.listView.kanbanCard', locale);
  const canvasCards = React.useMemo<StudioCanvasCardSelection | null>(() => {
    if (!kanbanLeaf || !listViewObject) return null;
    return {
      objectName: listViewObject,
      selected: selectedCardId,
      onSelect: (id) => setSelection(listViewCardSelection(id, cardLabel)),
    };
  }, [kanbanLeaf, listViewObject, selectedCardId, cardLabel, setSelection]);

  // nav editing — patch appDraft.navigation, then save/publish the App overlay
  const onNavPatch = React.useCallback((patch: Record<string, unknown>) => {
    setAppDraft((d) => ({ ...d, ...patch }));
    setNavDirty(true);
  }, []);
  // objectui#11823 (step 2) — `doc` is the app document to send: the buffer
  // (`appDraft`, what the autosave sends), unless a caller that sends its own
  // write names the document it built (a create's link, below).
  const doNavSave = React.useCallback(async (sent: DraftSend, doc: Record<string, unknown> = appDraft) => {
    if (!appName) return;
    setNavSaving('draft');
    // objectui#11776 — "Add nav item" births `{ id, type: 'object' }`, which
    // the spec refuses until a target is picked in the inspector, and an
    // unbind leaves an entry with no `type`. The save sends the editor's
    // navigation less every entry that names no target for its `type`, at
    // every depth (`navPayloadOf`); the editor keeps showing it, in its
    // place. A root entry with no `id` is given one by its place in the
    // EDITOR, before anything is left out, so leaving an entry out never
    // moves another entry's id. objectui#11785 — computed before the save so
    // a refusal is placed on the entry it names: its path indexes `sentNav`,
    // and `editorNav` keeps the editor's indexes.
    const rawNav = Array.isArray(doc.navigation) ? doc.navigation : [];
    const editorNav = rawNav.map((n, i) => {
      const item = n as Record<string, unknown>;
      if (!item || typeof item !== 'object' || (typeof item.id === 'string' && item.id)) return n;
      return { ...item, id: `nav_item_${i + 1}` };
    });
    const sentNav = navPayloadOf(editorNav);
    try {
      const leftOut = sentNav.length !== editorNav.length || sentNav.some((n, i) => n !== editorNav[i]);
      let saved: Record<string, unknown> = { ...doc, navigation: sentNav };
      let target = packageId;
      let entering = false;
      // objectstack#30059 (ADR-0146 D2) — on a read-only base the app is saved
      // into the pair the ensure door answers, whole, declaring the override
      // at the base's version (`overrideDraftBody`). A refused door is shown
      // as it was sent, and nothing is saved.
      const custom = readOnly ? customizationRef.current : null;
      if (custom) {
        let pair: string;
        try {
          pair = await pairFor(custom, 'app', appName);
        } catch (e) {
          setNavError(plainRefusal(e));
          return;
        }
        const declared = overrideDraftBody(saved, custom.base, custom.basedOn);
        if (declared === null) {
          setNavError({ message: tFormat('engine.studio.customize.noVersion', locale, { package: custom.baseLabel }) });
          return;
        }
        // The buffer was read at another package (the base, before its pair
        // was listed): the pair is taken to hold no draft of the app, so one
        // there is a conflict the author is asked about, never overwritten.
        if (navReadAtRef.current !== pair) {
          recordNavRead('app', appName, pair, { ifNoneMatch: '*' });
          navReadAtRef.current = pair;
        }
        entering = !navInPairRef.current;
        saved = declared;
        target = pair;
      }
      const outcome = await saveNavDraft('app', appName, saved, { mode: 'draft', packageId: target, surface: 'studio' });
      // objectui#11773 — the author chose the saved version; the load replaces
      // the buffer, and with it any failure this editor showed (objectui#11776).
      if (outcome === 'reloaded') {
        setNavError(null);
        return;
      }
      navEchoRef.current = publishNonce;
      navBaselineRef.current = saved;
      setNavHasDraft(true);
      // The rail's mark reads the declaration the server now serves.
      if (entering) setServedNonce((n) => n + 1);
      // objectui#11776 — the save landed: the failure an earlier one showed goes.
      setNavError(null);
      // objectui#11189, objectui#11204 — clean only if the buffer is still what
      // this save sent. An edit taken while it was in flight keeps the buffer
      // dirty: the autosave (or a pending "Done") sends it next, and the leave
      // guard holds until then. objectui#11776 — so does an entry this save
      // left out for want of a target: it is on screen and not on the server,
      // and a clean buffer would let the re-read this save signals install the
      // served draft over it. Binding it is the edit that sends it.
      if (sent.unmoved() && !leftOut) setNavDirty(false);
      // objectstack#28984 — the navigation is the app's: named by its label.
      announceDraftSaved({ type: 'app', name: appName }, navItemLabelText(appLabel, locale), locale);
      onDraftSaved?.({ type: 'app', name: appName });
    } catch (e) {
      setNavError(
        issueRefusal(
          e,
          locale,
          navEntryLocator({ sent: sentNav, editor: editorNav, locale, targetLabel: targetLabelRef.current }),
        ),
      );
    } finally {
      setNavSaving(false);
    }
  }, [saveNavDraft, appName, appDraft, appLabel, onDraftSaved, packageId, publishNonce, locale, readOnly, pairFor, recordNavRead]);
  // objectui#5813 — nav edits auto-save while edit mode is open.
  const { flush: flushNavSave, sending: navSending } = useDraftAutoSave({
    // objectui#11232 — the app `doNavSave` addresses. The package is this
    // pillar's mount (it is keyed by package where the surface renders it).
    target: `app:${appName ?? ''}`,
    loadedFor: appDraftFor,
    dirty: navDirty,
    blocked: !appName || !editNav || !!navSaving || !navWritable || restoring,
    snapshot: appDraft,
    save: doNavSave,
  });
  // objectui#11189 — "Done" never closes nav editing over an unsent edit. It
  // asks for the close; this effect sends a dirty buffer at once (the
  // autosave, fired early), waits out a save in flight, and closes once the
  // buffer is clean. A buffer that cannot be sent (the save it already
  // attempted failed, and its error is on screen) keeps editing open.
  const [navClosing, setNavClosing] = React.useState(false);
  React.useEffect(() => {
    if (!navClosing || navSaving) return;
    if (navDirty && flushNavSave()) return;
    setNavClosing(false);
    if (navDirty) return;
    setEditNav(false);
    setNavSel(null);
  }, [navClosing, navSaving, navDirty, flushNavSave]);

  // objectui#11823 (steps 2 and 3) — *New dashboard* / *New report* / *New
  // page* (ADR-0084: the Interface pillar holds dashboards, reports and
  // pages). The rail is the app's navigation, so a create writes the item's
  // draft AND the entry that links it, then opens the new leaf on the canvas
  // this pillar renders for its type (builder-ui §6): the structured canvas
  // for a dashboard or a report, a page's source beside its live preview.
  // Offered only while nav editing is closed: the nav buffer is then the app
  // document as the server holds it, and no nav save is in flight ("Done"
  // closes only once the buffer is clean).
  const [createKind, setCreateKind] = React.useState<InterfaceCreateKind | null>(null);
  const [createBusy, setCreateBusy] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [reportBinding, setReportBinding] = React.useState<ReportBinding>(NO_REPORT_BINDING);
  const [pageKind, setPageKind] = React.useState<PageSourceKind>(DEFAULT_PAGE_SOURCE_KIND);
  // objectstack#27518 — the New dataset entry beside the report dialog's and
  // the widget inspector's dataset pickers saves into this package, and its
  // presence is what has those pickers read the draft-overlaid catalog.
  const datasetAuthoring = React.useMemo<StudioDatasetAuthoring>(
    () => ({ packageId: leafPackageId, onDraftSaved }),
    [leafPackageId, onDraftSaved],
  );
  const openCreate = React.useCallback(
    (kind: InterfaceCreateKind) => {
      // objectstack#26845 — the created item opens at once, and its load
      // replaces the buffer a held widget lives in: asked before the dialog
      // opens, so Cancel costs nothing and the create itself asks nothing.
      if (!confirmDropUnsavedWork(leafUnsent, locale)) return;
      setCreateError(null);
      setReportBinding(NO_REPORT_BINDING);
      setPageKind(DEFAULT_PAGE_SOURCE_KIND);
      setCreateKind(kind);
    },
    [leafUnsent, locale],
  );
  // objectui#12455 — the "+" kind picker's other kinds: the entry is added
  // where "Add nav item" adds one (the end of the top level, an id minted the
  // way `AppNavCanvas` mints it), born with no label (objectui#11196) and, for
  // a kind with a target, unbound until the inspector picks one: the save
  // leaves it out until then and the editor keeps it in its place
  // (`navPayloadOf`, objectui#11776). A group is born with the empty list its
  // member requires. Nav editing opens on it, so the inspector beside the
  // canvas edits it and the nav autosave sends it.
  const addNavEntry = React.useCallback(
    (kind: NavigationItemType) => {
      if (!navWritable || !appName) return;
      const navigation = Array.isArray(appDraft.navigation) ? (appDraft.navigation as NavNode[]) : [];
      const taken = new Set(navigation.map((n) => (typeof n.id === 'string' ? n.id : '')).filter(Boolean));
      let id = `nav_item_${navigation.length + 1}`;
      for (let n = navigation.length + 2; taken.has(id); n++) id = `nav_item_${n}`;
      const entry: NavNode = kind === 'group' ? { id, type: 'group', children: [] } : { id, type: kind };
      onNavPatch({ navigation: [...navigation, entry] });
      setEditNav(true);
      setNavSel({ kind: 'nav', id: `navigation[${navigation.length}]` });
      setInspectorCollapsed(false);
      if (isMobile) setRailOpen(false);
    },
    [navWritable, appName, appDraft, onNavPatch, setInspectorCollapsed, isMobile],
  );
  const doCreateSurface = React.useCallback(
    async (
      kind: InterfaceCreateKind,
      label: string,
      name: string,
      binding: ReportBinding,
      sourceKind: PageSourceKind,
    ) => {
      // objectstack#28572 — on a read-only base the item lands in its pair.
      const intoPair = readOnly && newInPair && customization !== null;
      if (editNav || (readOnly && !intoPair) || (!intoPair && !appName)) return;
      if (kind === 'report' && !isReportBindingComplete(binding)) {
        setCreateError(t('engine.studio.interfaces.create.needsBinding', locale));
        return;
      }
      setCreateBusy(true);
      setCreateError(null);
      try {
        // A name an item of this type already holds, in this package or any
        // other, is refused here and nothing is written. The draft door is a
        // PUT by name: it would write this skeleton over that item, in this
        // package's draft, and the entry below would open whichever one the
        // server resolves.
        const [published, drafts] = await Promise.all([
          client.list<Record<string, unknown>>(kind),
          client.listDrafts({ type: kind }),
        ]);
        if ([...(published ?? []), ...(drafts ?? [])].some((row) => row?.name === name)) {
          setCreateError(
            tFormat(
              kind === 'dashboard'
                ? 'engine.studio.interfaces.create.dashboardTaken'
                : kind === 'report'
                  ? 'engine.studio.interfaces.create.reportTaken'
                  : 'engine.studio.interfaces.create.pageTaken',
              locale,
              { name },
            ),
          );
          return;
        }
        const body =
          kind === 'dashboard'
            ? buildDashboardSkeleton(name, label)
            : kind === 'report'
              ? buildReportSkeleton(name, label, binding)
              : buildPageSkeleton(name, label, sourceKind, t('engine.studio.interfaces.create.pageStarter', locale));
        // objectstack#28572 — the pair is the ensure door's answer, never an
        // id spelled here. The item is the pair's: no nav entry links it (the
        // base's app takes none); it opens at once, listed with the base's
        // items, writable there.
        if (intoPair) {
          const pair = (await customization.ensurePackage()).packageId;
          await client.save(kind, name, body, { mode: 'draft', packageId: pair, ifNoneMatch: '*', surface: 'studio' });
          onDraftSaved?.();
          setCreateKind(null);
          setItemsNonce((n) => n + 1);
          setCurrent({ type: kind, name, label: label || name, addedIn: pair });
          setCanvasMode('design');
          if (kind === 'page') setDefinitionOpen(true);
          if (isMobile) setRailOpen(false);
          return;
        }
        // objectui#11773 — and the door refuses it too (the first-write pin),
        // for a draft that lands between the check above and this save.
        await client.save(kind, name, body, { mode: 'draft', packageId, ifNoneMatch: '*', surface: 'studio' });
        onDraftSaved?.();
        // The entry that links it, appended to the app document and sent
        // through the nav editor's own save, as an edit there would be: its
        // refusal shows in the canvas strip and keeps the buffer dirty, so the
        // leave guard holds and the next nav edit sends it again.
        const base = navBaselineRef.current;
        const navigation = Array.isArray(base.navigation) ? (base.navigation as NavNode[]) : [];
        const entry = interfaceNavEntry(kind, name, label, navigation);
        const linked = { ...base, navigation: [...navigation, entry] };
        setAppDraft(linked);
        setNavDirty(true);
        setCreateKind(null);
        const surface = resolveSurface(entry, locale, targetLabelRef.current);
        if (surface) setCurrent(surface);
        setCanvasMode('design');
        // A page opens on its source beside the live preview: the definition
        // sheet holds the code editor (objectui#12725).
        if (kind === 'page') setDefinitionOpen(true);
        if (isMobile) setRailOpen(false);
        await doNavSave(navSending(linked) ?? { unmoved: () => false }, linked);
      } catch (e) {
        // Shown in the create dialog, which prints the message only.
        setCreateError(plainRefusal(e).message);
      } finally {
        setCreateBusy(false);
      }
    },
    [
      readOnly,
      newInPair,
      customization,
      appName,
      editNav,
      locale,
      client,
      packageId,
      onDraftSaved,
      setCanvasMode,
      isMobile,
      doNavSave,
      navSending,
    ],
  );

  // ADR-0057 P3c — the canvas and the inspector are rendered by BOTH layouts
  // below (the classic three-zone row, and — objectui#12725 — the canvas with
  // its properties portaled into the surface's right slot), so they are built
  // once here. The classic branch composes exactly the pre-P3c tree.
  // objectui#8219 — true exactly when the canvas below renders its `Preview`
  // branch (same guards, same order). A registered preview brings its own
  // frame (PreviewShell), so the wrapper then draws none: one frame, and the
  // wrapper's border and padding go back to the preview. Every other canvas
  // state (no app, nothing picked, loading, the studio-canvas records grid,
  // no designer) has no shell of its own and keeps the wrapper's card.
  const canvasHostsPreviewShell =
    !(appStatus === 'missing' && !error) &&
    !!current &&
    !loading &&
    draftLoaded &&
    !StudioCanvas &&
    !isSourcePage &&
    !!Preview;
  // objectui#12455 — the nav entry the open leaf came from, at any depth: the
  // header names it by its kind and its icon, as the rail row does.
  const currentNavId = current?.navId;
  const currentNavEntry = React.useMemo(() => {
    if (!currentNavId) return null;
    const find = (nodes: NavNode[]): NavNode | null => {
      for (const node of nodes) {
        if (node.id === currentNavId) return node;
        if (Array.isArray(node.children)) {
          const hit = find(node.children);
          if (hit) return hit;
        }
      }
      return null;
    };
    return find(navTree);
  }, [currentNavId, navTree]);
  // objectui#12522 — a source page's Properties tab lists the navigation entries
  // that open it: a read of the tree this pillar already holds, every `page`
  // entry whose target is this page, at any depth, named as the rail names it
  // and with the groups it sits in.
  const currentPageName = isSourcePage ? current?.name : undefined;
  const sourcePageNavEntries = React.useMemo<SourcePageNavEntry[]>(() => {
    if (!currentPageName) return [];
    const out: SourcePageNavEntry[] = [];
    const walk = (nodes: NavNode[], trail: string[]) => {
      for (const node of nodes) {
        const text = navEntryLabelText(node as NavEntryLike, locale, targetLabel);
        if (node.type === 'page' && (node as { pageName?: unknown }).pageName === currentPageName) {
          out.push({ id: String(node.id), label: text, trail });
        }
        if (Array.isArray(node.children)) walk(node.children, [...trail, text]);
      }
    };
    walk(navTree, []);
    return out;
  }, [currentPageName, navTree, locale, targetLabel]);
  // objectui#12522 — the one-line status under a source page's editor: the
  // pillar's own dirty flag and the time its last save of this leaf landed.
  // A clean buffer nothing was saved from in this visit is the stored draft
  // (or the published page) as it was read: saved, with no time to give.
  const displayLocale = useDisplayLocale();
  const leafSavedTime = leafSavedAt && leafSavedAt.key === leafKey ? leafSavedAt.at : null;
  const sourcePageStatusEl =
    isSourcePage && !leafReadOnly ? (
      <div
        className="shrink-0 border-t px-3 py-1.5 text-[11px] text-muted-foreground"
        data-testid="source-page-status"
        data-state={ifDirty || saving === 'draft' ? 'unsaved' : 'saved'}
        aria-live="polite"
      >
        {ifDirty || saving === 'draft'
          ? t('engine.studio.if.pageUnsaved', locale)
          : leafSavedTime
            ? tFormat('engine.studio.if.pageSavedAt', locale, {
                time: leafSavedTime.toLocaleTimeString(displayLocale, { hour: '2-digit', minute: '2-digit' }),
              })
            : t('engine.studio.if.pageSaved', locale)}
      </div>
    ) : null;
  // objectui#12459 — the item header inside the content column. objectui#7254:
  // the entry's label with its translated KIND beside it; the internal
  // `type · name` pair stays on the tooltip, so the header carries no api
  // chip. objectui#11196: with no label declared the header shows what the
  // entry inherits, as the rail does.
  // objectui#12455 — the Design ⇄ Run switch (objectui#5800) is a 26 px
  // segmented control with its glyphs, then a divider and the properties
  // toggle, which says whether the aside is open (`aria-pressed`) and is the
  // one control that opens and closes it in this layout.
  // objectui#12522 — a source page has no designer chrome: Design and Run draw
  // the same live preview, so the switch is offered disabled, and its reason
  // rides the objectui#12303 pattern (a wrapper that is the tooltip trigger and
  // a tab stop, with a visually hidden copy both point `aria-describedby` at).
  const sourceModeReasonId = React.useId();
  const sourceModeReason = isSourcePage
    ? tFormat('engine.studio.if.modeSourcePage', locale, {
        kind:
          sourcePageKind === 'react'
            ? t('engine.studio.interfaces.create.pageKindReact', locale)
            : t('engine.studio.interfaces.create.pageKindHtml', locale),
      })
    : '';
  const canvasModeSwitch = (
    <div
      className={cn(
        'inline-flex h-[26px] items-center rounded-md border bg-muted/40 p-0.5',
        isSourcePage && 'opacity-60',
      )}
      data-testid="canvas-mode-toggle"
      data-disabled={isSourcePage ? '' : undefined}
    >
      <button
        type="button"
        onClick={() => setCanvasMode('design')}
        aria-pressed={designing}
        disabled={isSourcePage}
        aria-describedby={isSourcePage ? sourceModeReasonId : undefined}
        className={
          'inline-flex h-5 items-center gap-1 rounded px-2 text-xs transition-all disabled:pointer-events-none ' +
          (designing ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')
        }
      >
        <Pencil className="h-3 w-3" aria-hidden="true" />
        {/* objectstack#29693 — on a narrow header the modes keep their glyphs; the words stay their names. */}
        <span data-studio-fold-label="" className={STUDIO_FOLD_LABEL}>
          {t('engine.studio.if.modeDesign', locale)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setCanvasMode('run')}
        aria-pressed={!designing}
        disabled={isSourcePage}
        aria-describedby={isSourcePage ? sourceModeReasonId : undefined}
        className={
          'inline-flex h-5 items-center gap-1 rounded px-2 text-xs transition-all disabled:pointer-events-none ' +
          (!designing ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')
        }
      >
        <Play className="h-3 w-3" aria-hidden="true" />
        <span data-studio-fold-label="" className={STUDIO_FOLD_LABEL}>
          {t('engine.studio.if.modeRun', locale)}
        </span>
      </button>
    </div>
  );
  const canvasModeToggleEl = StudioCanvas ? null : isSourcePage ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-describedby={sourceModeReasonId}
            data-disabled-reason=""
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {canvasModeSwitch}
            <span id={sourceModeReasonId} className="sr-only" data-testid="canvas-mode-reason">
              {sourceModeReason}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{sourceModeReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    canvasModeSwitch
  );
  const ifHeaderIcon: React.ElementType | undefined = !current
    ? undefined
    : currentNavEntry?.icon
      ? getIcon(currentNavEntry.icon)
      : current.type === 'object' && objectIconMap[current.name]
        ? getIcon(objectIconMap[current.name] as string)
        : navIcon(currentNavEntry?.type ?? current.type);
  const ifKindName = current ? navKindName(currentNavEntry ?? { type: current.type }, locale) || translateMetadataType(current.type, locale) : '';
  const ifInternalId = current ? `${t('engine.studio.if.internalId', locale)}: ${current.type} · ${current.name}` : undefined;
  // objectstack#26746 — the header names the open leaf as its rail row names
  // it: the row's entry in `railTree`, through the same `navEntryLabelText`
  // and resolver, asked on every render. `current.label` is that text frozen
  // when the Surface was made, so a label the resolver learns later (a
  // draft-only object's `_drafts` label, the console's object metadata) left
  // the header on the machine name while the rail already read the label.
  const ifTitleText = (() => {
    if (!current) return '';
    const find = (nodes: NavNode[]): NavNode | null => {
      for (const node of nodes) {
        if (node.id === current.navId) return node;
        const hit = Array.isArray(node.children) ? find(node.children) : null;
        if (hit) return hit;
      }
      return null;
    };
    const railEntry = current.navId ? find(railTree) : null;
    // objectstack#30046 — an object page no entry opens is named by its object.
    const text = railEntry
      ? navEntryLabelText(railEntry as NavEntryLike, locale, targetLabel)
      : current.type === 'object' && !current.navId
        ? objectLabelOf(current.name)
        : current.label;
    return text || current.name;
  })();
  // objectui#12455 — an object entry's structure is the Data pillar's: the
  // header offers to open it there, through the host's surface channel (no
  // channel, no chip: the hint under the tab row still names the pillar).
  const openSurface = useSurfaceNavigator();
  const isObjectLeaf = current?.type === 'object';
  // objectui#12455 — while a nav entry is open in the inspector, the aside
  // names it as the shared aside names anything: "Nav item · Kind", the
  // entry's label (what it inherits when it declares none), and its nav id.
  // Top-level entries only, as `StudioNavItemInspector` edits only those.
  const navInspectorHead = React.useMemo(() => {
    if (!editNav || !navSel) return null;
    const m = /^navigation\[(\d+)\]$/.exec(navSel.id);
    const node = m ? navTree[Number(m[1])] : undefined;
    if (!node) return null;
    const untitled = node.label === undefined && navPayloadOf([node]).length === 0;
    return {
      eyebrow: tFormat('engine.studio.nav.eyebrow', locale, { kind: navKindName(node, locale) }),
      title: untitled
        ? tFormat('engine.appNav.item', locale, { n: Number(m![1]) + 1 })
        : navEntryLabelText(node, locale, targetLabel) || undefined,
      id: typeof node.id === 'string' ? node.id : undefined,
    };
  }, [editNav, navSel, navTree, locale, targetLabel]);
  const canvasFrameRef = React.useRef<HTMLDivElement | null>(null);
  // objectui#12725 — 复制 JSON: the item's document as this pillar holds it.
  const copyDefinition = React.useCallback(() => {
    const text = JSON.stringify(draft, null, 2);
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) {
      toast.error(t('engine.studio.if.copyFailed', locale));
      return;
    }
    clipboard.writeText(text).then(
      () => toast.success(t('engine.studio.api.copied', locale)),
      () => toast.error(t('engine.studio.if.copyFailed', locale)),
    );
  }, [draft, locale]);
  // objectstack#28562 — the item this header customizes on a read-only base:
  // an `object` leaf's list view, else the open view, dashboard or report.
  const headerCustomize: {
    type: string;
    name: string;
    key: string;
    label: string;
    listView: boolean;
    declaration: ServedOverride['declaration'];
    inPair: boolean;
    unlocked: boolean;
    /** The item is there to customize: loaded, and (a list view) one the server holds. */
    ready: boolean;
    hasDraft: boolean;
    busy: boolean;
  } | null = isObjectLeaf
    ? listViewCustomizable && listViewTargetId
      ? {
          type: 'view',
          name: listViewTargetId,
          key: listViewCustomizeKey,
          label:
            navItemLabelText(listView.row?.label as I18nLabel | undefined, locale) || listViewTargetId,
          listView: true,
          declaration: listViewServed.declaration,
          inPair: listViewInPair,
          unlocked: listViewUnlocked,
          ready: listView.loadedFor === listView.targetKey && listView.row !== null && !listView.notList,
          hasDraft: listView.hasDraft,
          busy: listView.saving,
        }
      : null
    : leafCustomizable && current
      ? {
          type: current.type,
          name: current.name,
          key: leafCustomizeKey,
          label: ifTitleText || current.name,
          listView: false,
          declaration: leafServed.declaration,
          inPair: leafInPair,
          unlocked: leafUnlocked,
          ready: draftLoaded,
          hasDraft: hasDraft && draftLoaded,
          busy: !!saving,
        }
      : null;
  const headerUnlocked = headerCustomize?.unlocked === true;
  // objectstack#28562 — "Restore package original": the pair's draft of the
  // item, then its row, deleted at the pair. The pair is the door's answer
  // this item's saves named, else the surface's; never asked of the door
  // again. The base's item reads back, and the server's refusal is shown as
  // it is sent.
  // objectstack#30059 — and the app whose navigation the rail customizes (`nav`).
  const [restoreFor, setRestoreFor] = React.useState<{
    type: string;
    name: string;
    key: string;
    label: string;
    listView: boolean;
    nav?: boolean;
    hasDraft: boolean;
  } | null>(null);
  const restoreOriginal = React.useCallback(
    async (item: { type: string; name: string; key: string; label: string; listView: boolean; nav?: boolean }) => {
      const custom = customizationRef.current;
      if (!custom) return;
      const held = pairsByItemRef.current.get(item.key);
      const pair = (held ? await held.catch(() => null) : null) ?? custom.pairId;
      if (!pair) return;
      setRestoring(true);
      if (item.nav) setNavError(null);
      else setError(null);
      try {
        await client.reset(item.type, item.name, { state: 'draft', packageId: pair });
        await client.reset(item.type, item.name, { packageId: pair });
        pairsByItemRef.current.delete(item.key);
        setCustomizeAsked((prev) => {
          if (!prev.has(item.key)) return prev;
          const next = new Set(prev);
          next.delete(item.key);
          return next;
        });
        if (item.nav) {
          // The base's navigation reads back: editing closes, and the next
          // read's pin replaces the deleted draft's.
          setEditNav(false);
          setNavSel(null);
          navEchoRef.current = null;
          forgetNavVersion();
          reloadNavDraft();
        } else if (item.listView) {
          setListViewRestoreNonce((n) => n + 1);
        } else {
          setIfDirty(false);
          forgetLeafVersion();
          reloadLeafDraft();
        }
        setServedNonce((n) => n + 1);
        emitMetadataRefresh();
        toast.success(tFormat('engine.studio.customize.restoreDone', locale, { item: item.label, package: custom.baseLabel }));
      } catch (e) {
        if (item.nav) setNavError(plainRefusal(e));
        else setError(plainRefusal(e));
      } finally {
        setRestoring(false);
      }
    },
    [client, forgetLeafVersion, reloadLeafDraft, forgetNavVersion, reloadNavDraft, locale],
  );
  const restoreDialogEl = (
    <StudioRestoreOriginalDialog
      open={restoreFor !== null}
      onOpenChange={(open) => {
        if (!open) setRestoreFor(null);
      }}
      label={restoreFor?.label ?? ''}
      baseLabel={customizeBaseLabel}
      hasDraft={restoreFor?.hasDraft ?? false}
      locale={locale}
      onConfirm={() => {
        if (restoreFor) void restoreOriginal(restoreFor);
      }}
    />
  );
  // objectui#12725 — the item's ⋯ menu: its definition, and its document as
  // JSON. Rename and delete are not offered here: this header has neither
  // today (a nav entry is renamed and removed in nav editing). Restore is
  // the override mark's (objectstack#29692), not this menu's.
  const itemMoreEl =
    current && draftLoaded ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="if-item-more"
            aria-label={t('engine.studio.if.more', locale)}
            title={t('engine.studio.if.more', locale)}
            className={STUDIO_HEADER_ICON_BUTTON}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {/* objectstack#29693 — what the title row folded away, on a narrow row. */}
          <StudioItemHeaderFoldedItems />
          <DropdownMenuItem data-testid="if-item-view-definition" onSelect={() => setDefinitionOpen(true)}>
            <Code2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t('engine.studio.if.viewDefinition', locale)}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="if-item-copy-json" onSelect={copyDefinition}>
            <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t('engine.studio.if.copyJson', locale)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;
  // objectui#12725 — one status line above the canvas instead of the canvas's
  // own tabs: what the canvas shows, and (beside the right slot) what a click
  // on it does. An object entry's canvas is the running list; its line keeps
  // saying where the structure is edited (objectui#12455).
  const selectionLabel =
    editNav && navSel ? (navInspectorHead?.title ?? navSel.id) : selection ? (selection.label || selection.id) : null;
  const canvasHint = !inSlot
    ? null
    : selectionLabel !== null
      ? tFormat('engine.studio.if.canvasHint.selected', locale, { label: String(selectionLabel) })
      : slot?.mode === 'copilot' &&
          // objectui#12725 — an `object` leaf's headers are elements too, while the panel lists its
          // columns, and so are a kanban view's cards, on the default canvas: the one that reports
          // a header or a card click.
          ((Preview && designing && !StudioCanvas && !isSourcePage) ||
            (StudioCanvas === StudioObjectRecordsCanvas && (canvasColumns || canvasCards)))
        ? t('engine.studio.if.canvasHint.pick', locale)
        : null;
  const canvasStatusEl = current ? (
    <div
      data-testid="if-canvas-status"
      className="flex h-9 shrink-0 items-center gap-3 border-b px-6 text-xs text-muted-foreground"
    >
      {isObjectLeaf ? (
        <p className="min-w-0 truncate">
          {t('engine.studio.if.objectHintPre', locale)}<span className="font-medium">{t('engine.studio.pillar.data', locale)}</span>{t('engine.studio.if.objectHintPost', locale)}
        </p>
      ) : (
        <p className="min-w-0 truncate">
          {t(designing && !isSourcePage ? 'engine.studio.if.status.design' : 'engine.studio.if.status.run', locale)}
          {hasDraft && draftLoaded ? ` · ${t('engine.studio.if.status.unpublished', locale)}` : null}
        </p>
      )}
      {canvasHint && (
        <p className="ml-auto min-w-0 truncate" data-testid="if-canvas-hint">
          {canvasHint}
        </p>
      )}
    </div>
  ) : null;
  // objectstack#29691 (ADR-0146 D3) — an item the pair adds, overrides or is
  // unlocked to customize saves to the base's pair: the header says where,
  // in the pending-changes sheet's own words.
  const ifSavedTo =
    customization !== null && (currentAddedIn !== null || headerCustomize?.inPair === true || headerUnlocked);
  const ifHeaderEl = (
    <StudioItemHeader
      testId="if-item-header"
      // objectstack#29693 — on a narrow row the chips and the item tools fold
      // into the ⋯ menu before the title drops below its readable width.
      foldMenu={itemMoreEl ? 'pillar' : { label: t('engine.studio.if.more', locale), testId: 'if-item-header-more' }}
      note={ifSavedTo ? <SavedToCustomizationNote baseLabel={customizeBaseLabel} pairId={customizeNotePair} testId="if-item-saved-to" /> : undefined}
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
      icon={ifHeaderIcon}
      title={
        current ? (
          <>
            {/* objectstack#30046 — an object entry's title is object / view ▾, as the running list's is. */}
            {isObjectLeaf && listView.target ? (
              <ObjectListViewTitle
                listView={listView}
                objectText={ifTitleText}
                locale={locale}
                // objectstack#28562 — a new view is an item of the base, which takes none.
                canCreate={!readOnly}
                // The pending edit goes first, or the author is asked.
                onSwitchView={switchListView}
                // New view opens another view here: the pending edit goes first.
                onAddViewOpen={flushListView}
                // The selection named a column of the view shown before.
                onViewCreated={() => setSelection(null)}
              />
            ) : (
              ifTitleText
            )}
            <span className="sr-only"> · {ifKindName}</span>
          </>
        ) : (
          navItemLabelText(appLabel, locale)
        )
      }
      titleProps={
        current
          ? { 'data-testid': 'if-breadcrumb', title: ifInternalId }
          : { className: 'text-[13px] font-normal text-muted-foreground' }
      }
      chips={
        current ? (
          <>
            <span className={STUDIO_KIND_CHIP} data-testid="if-canvas-caption" title={ifInternalId}>
              <span className="sr-only">{ifTitleText} · </span>
              {ifKindName}
            </span>
            {/* objectstack#28562 — the override the server serves, never a computation. */}
            {headerCustomize?.declaration && (
              <StudioOverrideChip
                baseLabel={customizeBaseLabel}
                basedOn={headerCustomize.declaration.basedOn}
                locale={locale}
                // objectstack#29692 — Restore lives on the mark that names the customization.
                onRestore={headerCustomize.inPair ? () => setRestoreFor(headerCustomize) : undefined}
                restoreDisabled={
                  restoring ||
                  headerCustomize.busy ||
                  (customizePair === null && !pairsByItemRef.current.has(headerCustomize.key))
                }
              />
            )}
            {/* objectstack#28572 — an item the pair adds names the pair it lives in. */}
            {currentAddedIn && <StudioPairItemChip pairId={currentAddedIn} locale={locale} />}
          </>
        ) : undefined
      }
      // objectui#12524 — the draft status sits after the kind chip, as in
      // every pillar; the right slot holds actions only.
      status={leafDraftStatus}
      actions={
        <>
          {/* objectui#5813 — drafts auto-save; the spinner is the affordance. */}
          {saving === 'draft' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="if-autosaving">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('engine.studio.autoSaving', locale)}
            </span>
          )}
          {/* objectstack#28562 — Customize unlocks the item's editors; nothing is saved until an edit. */}
          {headerCustomize && !headerCustomize.unlocked && !headerCustomize.inPair && headerCustomize.ready && (
            <StudioCustomizeButton
              block={customizeBlock}
              baseLabel={customizeBaseLabel}
              locale={locale}
              onCustomize={() => askCustomize(headerCustomize.key)}
            />
          )}
          {readOnly && !headerUnlocked && currentAddedIn === null && (
            <StudioReadOnlyLink item={current} title={t('engine.studio.pkg.readonlyHint', locale)} locale={locale} />
          )}
          {isObjectLeaf && openSurface && current && (
            <button
              type="button"
              data-testid="if-open-in-data"
              title={t('engine.studio.if.openInData', locale)}
              onClick={() => openSurface({ type: 'object', name: current.name })}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs text-foreground hover:bg-muted"
            >
              <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              {/* objectstack#30046 — on a narrow header it keeps its glyph, so the title keeps the view's name. */}
              <span data-studio-fold-label="" className={STUDIO_FOLD_LABEL}>
                {t('engine.studio.if.openInData', locale)}
              </span>
            </button>
          )}
          {/* objectstack#28239 — the item tools Setup's item page opens. An
              object entry's item is the object, edited in Data: its source
              here is the served body, read-only. */}
          {current && (draftLoaded || isObjectLeaf) && (
            <StudioItemTools
              type={current.type}
              name={current.name}
              packageId={leafPackageId}
              readOnly={readOnly && currentAddedIn === null}
              source={
                isObjectLeaf
                  ? undefined
                  : {
                      value: draft,
                      onChange: isEditable
                        ? (next) => {
                            setDraft(next);
                            setIfDirty(true);
                          }
                        : undefined,
                    }
              }
              onRolledBack={() => setLeafReloadNonce((n) => n + 1)}
              locale={locale}
            />
          )}
          {canvasModeToggleEl}
          {itemMoreEl}
          {canCollapseInspector && (
            <>
              <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
              <button
                type="button"
                data-testid="if-properties-toggle"
                onClick={() => setInspectorCollapsed(!inspectorCollapsed)}
                aria-pressed={!inspectorCollapsed}
                className={cn(STUDIO_HEADER_ICON_BUTTON, !inspectorCollapsed && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
                aria-label={t(inspectorCollapsed ? 'engine.studio.inspector.expand' : 'engine.studio.inspector.collapse', locale)}
                title={t(inspectorCollapsed ? 'engine.studio.inspector.expand' : 'engine.studio.inspector.collapse', locale)}
              >
                {inspectorCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
              </button>
            </>
          )}
        </>
      }
      // objectui#12725 — no tab row: the status line under the header
      // (`canvasStatusEl`) continues it, so the header drops its own rule.
      className={current ? 'border-b-0 pb-3' : undefined}
    />
  );
  const canvasEl = (
    // objectui#12611 — beside the right slot (objectui#11795's width), the
    // canvas keeps a 16 px gutter instead of 24, so a dashboard's tiles get
    // their width. objectui#12725 — a click on empty canvas (the gutter, or
    // the frame around the preview) drops the selection.
    <main
      data-testid="if-canvas-main"
      onClick={(e) => {
        if (e.target === e.currentTarget || e.target === canvasFrameRef.current) clearInspectorTarget();
      }}
      className={cn('flex min-w-0 flex-1 flex-col overflow-auto bg-muted/30 py-4', inSlot ? 'px-4' : 'px-6')}
    >
      {(error || navError || leafHeld || listViewHeld) && (
        <div className="mb-3 flex shrink-0 flex-col gap-1.5">
          {/* objectui#11776 — the pillar's failure and the nav editor's own,
              each cleared by what settles it, the same failure shown once.
              objectui#11785 — each as a refusal strip; the nav editor's "Show
              me" opens nav editing on the entry it names. */}
          {error && (
            <StudioRefusalStrip refusal={error} locale={locale} onShow={showLeafRefusal} className="px-3 py-2 text-xs" />
          )}
          {navError && !(error && error.message === navError.message && error.detail === navError.detail) && (
            <StudioRefusalStrip
              refusal={navError}
              locale={locale}
              onShow={(target) => {
                if (!target) return;
                setEditNav(true);
                setNavSel({ kind: target.kind, id: target.id });
              }}
              className="px-3 py-2 text-xs"
            />
          )}
          {leafHeld && (
            <StudioHeldNotice
              held={leafHeld}
              locale={locale}
              // objectui#11910 — no "Show me" while that widget is the one open.
              // objectstack#27459 — an item of the leaf's own list property
              // (`target: null`) always offers it: the leaf's properties may
              // be collapsed, or scrolled past the list it opens and focuses.
              onShow={
                leafHeld.target === null
                  ? () => showLeafRefusal(null, leafHeld.input)
                  : selection?.kind === leafHeld.target.kind && selection.id === leafHeld.target.id
                    ? undefined
                    : (target) => setSelection(target)
              }
              className="px-3 py-2 text-xs"
            />
          )}
          {listViewHeld && (
            <StudioHeldNotice
              held={listViewHeld}
              locale={locale}
              // The setting is in the leaf's own panel, which may be collapsed or scrolled past.
              onShow={() => showLeafRefusal(null, listViewHeld.input)}
              className="px-3 py-2 text-xs"
            />
          )}
        </div>
      )}
      <div
        ref={canvasFrameRef}
        className={cn(
          // Source pages: let the live preview fill the canvas height (it
          // brings its own PreviewShell chrome), so it balances the taller
          // editor panel instead of floating as a short card.
          isSourcePage
            ? 'min-h-0 flex-1 overflow-hidden'
            : canvasHostsPreviewShell
              ? undefined
              : 'rounded-lg border bg-background p-4',
        )}
      >
        {/* objectstack#26889 — a package with no app shows its empty state
            until a row of the rail's sections opens one of its items. */}
        {appStatus === 'missing' && !error && !current ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <LayoutDashboard className="h-6 w-6 text-muted-foreground" />
            </div>
            {contributedElsewhere ? (
              // objectstack#29851 — what the served reads show this package
              // adding to other packages' apps, each with a way there.
              <div data-testid="if-contributes-elsewhere">
                <p className="text-sm font-medium">{t('engine.studio.if.noOwnAppTitle', locale)}</p>
                {contributedElsewhere.map((found) => (
                  <div key={found.app} className="mt-1 flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground">{contributedElsewhereText(found, locale)}</p>
                    <button
                      type="button"
                      data-testid="if-open-owner"
                      data-package={found.ownerId}
                      onClick={() => openContributor(`/studio/${encodeURIComponent(found.ownerId)}/interfaces`)}
                      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      {tFormat('engine.studio.if.openOwner', locale, { package: found.ownerName })}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium">{t('engine.studio.if.noAppTitle', locale)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('engine.studio.if.noAppHint', locale)}</p>
              </div>
            )}
            {onCreateApp && (
              <button
                type="button"
                onClick={onCreateApp}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> {t('engine.studio.app.create', locale)}
              </button>
            )}
          </div>
        ) : !current ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t('engine.studio.if.pickLeft', locale)}</div>
        ) : loading || !draftLoaded ? (
          // objectui#11272 — nothing of another leaf's buffer is shown under
          // this one. A load that failed leaves it there: the error above says
          // why, and no spinner promises it is still coming.
          error && !loading ? null : (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('engine.studio.loading', locale)}
            </div>
          )
        ) : StudioCanvas ? (
          // Studio-canvas surface override. The object nav leaf resolves here to
          // the records list as the running app shows it (preview = runtime) —
          // schema editing lives in the Data pillar, so this is the object-view
          // grid, not the field-form preview. Default lives in
          // `studio-canvas-preview`; downstream can override via
          // `registerStudioCanvasPreview()` instead of forking this component.
          // objectui#11774 — the open nav entry rides beside the props, not in
          // them (`StudioCanvasPreviewProps` is a published face): the default
          // object canvas previews the entry's slice or named view.
          // objectui#11823 — and so does the list view the panel is editing.
          // objectui#12508 — and the package's draft-only objects, which have
          // no runtime yet: the default canvas shows them as not published.
          <StudioCanvasNavEntryContext.Provider value={canvasNavEntry}>
            <StudioCanvasListViewContext.Provider value={listView.canvas}>
              <StudioCanvasDraftOnlyObjectsContext.Provider value={canvasDraftOnly}>
                {/* objectui#12725 — and the panel's column selection, which a
                    header click on the default canvas makes. */}
                <StudioCanvasColumnSelectionContext.Provider value={canvasColumns}>
                  {/* objectui#12725 — and, on a kanban view, its card selection. */}
                  <StudioCanvasCardSelectionContext.Provider value={canvasCards}>
                    <StudioCanvas type={current.type} name={current.name} draft={draft} locale={locale} />
                  </StudioCanvasCardSelectionContext.Provider>
                </StudioCanvasColumnSelectionContext.Provider>
              </StudioCanvasDraftOnlyObjectsContext.Provider>
            </StudioCanvasListViewContext.Provider>
          </StudioCanvasNavEntryContext.Provider>
        ) : isSourcePage ? (
          // Source pages have no block tree — the canvas shows only the live
          // preview; the code editor lives in the inspector's Source tab.
          <SourcePageEditor mode="preview" draft={draft} readOnly locale={locale} />
        ) : Preview ? (
          <Preview
            type={current.type}
            name={current.name}
            draft={draft}
            editing={designing}
            selection={designing ? selection : null}
            onSelectionChange={designing ? setSelection : undefined}
            // objectui#11136 — a read-only package gets no `onPatch`: per the
            // preview contract the canvas is then read-only (no add, drag,
            // rename or delete — each a write the blocked autosave would
            // discard), while selecting a block or widget still opens the
            // inspector, read-only. objectstack#28562 — unless the item is
            // being customized into the base's pair.
            onPatch={leafReadOnly ? undefined : onPatch}
            locale={locale}
            diagnostics={leafDiagnostics}
          />
        ) : (
          <div className="py-12 text-center text-xs text-muted-foreground">
            {tFormat(
              designersUnregistered
                ? 'engine.studio.if.designersMissing'
                : 'engine.studio.if.noDesigner',
              locale,
              { type: current.type },
            )}
          </div>
        )}
      </div>
    </main>
  );

  // Collapsed state — a thin rail on the right with an expand affordance, so the
  // canvas reclaims the ~288px the properties aside otherwise holds.
  const inspectorBodyEl =
    editNav && navSel ? (
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <StudioNavItemInspector
          navId={navSel.id}
          appDraft={appDraft}
          objects={pkgObjects}
          packageId={packageId}
          // objectstack#30059 — a customized navigation can open what the pair adds.
          pairId={railPairId}
          onNavPatch={onNavPatch}
          onClear={() => setNavSel(null)}
        />
      </div>
    ) : StudioCanvas && current ? (
      // ⭐ objectui#7121 — a studio-canvas leaf has no block tree, so the
      // generic "click a block on the canvas" invitation below instructs the
      // author to do something impossible: `StudioCanvasPreviewProps` carries
      // no `selection`/`onSelectionChange` by contract, so this canvas can
      // never produce one. Measured with the designer registry POPULATED
      // (`listMetadataPreviewTypes() === ['dashboard']`), which is what makes
      // this a different cause from #6795 part C's empty-registry states.
      //
      // Ordered BEFORE the `selection` branch on purpose, mirroring the canvas
      // chain where `StudioCanvas` also wins. When this ordering landed it was
      // also load-bearing against a second defect: `selection` outlived a leaf
      // change (the load effect cleared it only on the editable path), so
      // arriving here with a block selected on the PREVIOUS leaf opened the
      // scoped inspector for a block this canvas does not contain — measured,
      // `ObjectFieldInspector` handed `object:showcase_task:block:blk_1`.
      // objectui#7137 fixed that at the source by keying `selection` to its
      // leaf, so this branch is no longer the thing standing between an author
      // and a foreign block. Keep the order anyway: it states which branch is
      // TRUE for this leaf, and it does not depend on the state lifecycle
      // staying correct.
      //
      // ⛔ Says what is true and promises no recovery — no "loading…", no "try
      // again". Same constraint part C established for the designer strings
      // (the comment above `engine.studio.if.designersMissing` in
      // `metadata-admin/i18n.ts`). Here the statement is not even about
      // registration — this canvas has no blocks by contract, so there is
      // nothing to wait for.
      //
      // objectui#11823 — except the list itself. An `object` leaf's canvas is
      // the object's running list, and the list view it shows IS package
      // metadata: this panel edits its columns, filter and sort (the view the
      // canvas opens, see `ObjectListViewInspector`). Still no block.
      // objectui#12725 — its one selection is a column: the default canvas
      // reports a header click through a context beside the props
      // (`StudioCanvasColumnSelectionContext`), never through them. Every
      // other studio-canvas type keeps the statement below.
      current.type === 'object' && listView.target ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ObjectListViewInspector
            listView={listView}
            // objectstack#28562 — a customized view is edited.
            readOnly={listViewReadOnly}
            locale={locale}
            // objectui#12725 — the pillar's selection, which a canvas header click also makes.
            selection={selection}
            onSelectionChange={setSelection}
            // objectstack#30046 — a formatting rule's CEL that does not parse holds the autosave.
            onBlockingIssuesChange={reportListViewCel}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-xs text-muted-foreground">
            <Eye className="h-5 w-5" />
            {t('engine.studio.inspector.studioCanvasNoBlocks', locale)}
          </div>
        </div>
      )
    ) : current && !draftLoaded ? (
      // objectui#11272 — no editor over another leaf's buffer: the canvas
      // beside it says whether this leaf's own document is on its way.
      <div className="min-h-0 flex-1" />
    ) : selection && Inspector && current ? (
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <Inspector
          type={current.type}
          name={current.name}
          draft={draft}
          selection={selection}
          onPatch={onPatch}
          onClearSelection={() => setSelection(null)}
          onSelectionChange={setSelection}
          onBlockingIssuesChange={(count: number) =>
            setBlockingReport({ key: inspectorKey, count })
          }
          // objectui#11136 — the pillar's real flag, threaded exactly as the
          // Data pillar threads it (objectui#2259). objectstack#28562 — the
          // leaf's: a customized item is edited.
          readOnly={leafReadOnly}
          locale={locale}
        />
      </div>
    ) : isSourcePage ? (
      // objectui#12725 — no 源码 tab: the properties say what the page IS
      // (objectui#12522); its code opens from the header's ⋯ menu (查看定义).
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {current && (
          <SourcePageProperties
            draft={draft}
            name={current.name}
            navEntries={sourcePageNavEntries}
            onPatch={leafReadOnly ? undefined : onPatch}
            readOnly={leafReadOnly}
            locale={locale}
          />
        )}
      </div>
    ) : DefaultInspector && current && isEditable ? (
      // No block selected → the surface's "home" inspector (e.g. a page's
      // interfaceConfig form). Selecting a sub-element from it swaps in the
      // scoped block inspector above via onSelectionChange.
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {/* objectui#12688 — a dashboard's component list draws the served
            widget titles (display only); `null` for any other leaf. */}
        <ServedWidgetTextContext.Provider value={servedWidgets}>
          <DefaultInspector
            type={current.type}
            name={current.name}
            draft={draft}
            onPatch={onPatch}
            onSelectionChange={setSelection}
            onBlockingIssuesChange={(count: number) =>
              setBlockingReport({ key: inspectorKey, count })
            }
            // objectui#11136 — same flag, same threading as the block inspector.
            readOnly={leafReadOnly}
            locale={locale}
          />
        </ServedWidgetTextContext.Provider>
      </div>
    ) : designersUnregistered ? (
      // ⭐ #6795 part C. "Click a block on the canvas, and edit its properties
      // right here" instructs the author to do something impossible: with the
      // registries unpopulated the canvas beside this rail is the
      // designers-missing notice, not a block tree, so there is nothing to
      // click and nothing this rail could open if they did.
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-xs text-muted-foreground">
          <Ban className="h-5 w-5" />
          {t('engine.studio.inspector.designersMissing', locale)}
        </div>
      </div>
    ) : (
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-xs text-muted-foreground">
          <MousePointer2 className="h-5 w-5" />
          {t('engine.studio.inspector.emptyLine1', locale)}
          <br />
          {t('engine.studio.inspector.emptyLine2', locale)}
        </div>
      </div>
    );
  // The one properties aside, in the right slot (filling it) or beside the
  // canvas (the classic layout).
  const inspectorAsideEl = (
    <StudioInspector
      testId="if-inspector"
      eyebrow={navInspectorHead?.eyebrow ?? t('engine.studio.inspector.props', locale)}
      title={navInspectorHead?.title}
      id={navInspectorHead?.id}
      className={inSlot ? 'w-full flex-1 border-l-0' : undefined}
      // objectui#12455 — in the classic layout the header's properties toggle
      // opens and closes the aside, so it carries no second one.
      onClose={navInspectorHead ? () => setNavSel(null) : selection && !StudioCanvas ? () => setSelection(null) : undefined}
      closeLabel={t('engine.studio.deselect', locale)}
      // objectui#12453 — a read-only package saves no draft: no footer.
      // objectstack#28562 — a customized item's drafts go to the base's pair.
      footer={
        !readOnly || currentAddedIn !== null
          ? t('engine.studio.inspector.draftFooter', locale)
          : headerUnlocked
            ? t('engine.studio.customize.draftFooter', locale)
            : null
      }
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <div ref={inspectorBodyRef} className="contents">
        {inspectorBodyEl}
      </div>
    </StudioInspector>
  );
  // objectui#12725 — 查看定义: a source page's code editor (where its 源码 tab
  // was), any other item's document, read-only, as JSON.
  const definitionSheetEl = current ? (
    <Sheet open={definitionOpen} onOpenChange={setDefinitionOpen}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        data-testid="if-definition-sheet"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="shrink-0 border-b px-4 py-3 pr-10">
          <SheetTitle className="text-[13px] font-medium">
            {tFormat('engine.studio.if.definitionTitle', locale, { label: ifTitleText })}
          </SheetTitle>
        </SheetHeader>
        {isSourcePage ? (
          // objectui#11136 — the editor's own read-only contract ("onPatch:
          // undefined in read-only mode"), fed by the pillar's real flag.
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <SourcePageEditor
                mode="editor"
                draft={draft}
                onPatch={leafReadOnly ? undefined : onPatch}
                readOnly={leafReadOnly}
                locale={locale}
              />
            </div>
            {sourcePageStatusEl}
          </div>
        ) : (
          <pre
            data-testid="if-definition-json"
            className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4 font-mono text-xs leading-relaxed"
          >
            {JSON.stringify(draft, null, 2)}
          </pre>
        )}
      </SheetContent>
    </Sheet>
  ) : null;

  // A rail row opens its item: a tree entry or a row of the sections under it.
  const pickSurface = (s: Surface) => {
    // objectstack#26705 — another leaf's load replaces the buffer the held
    // widget lives in; an entry for the open leaf keeps it. objectstack#29113
    // — so it does an edit whose save was refused.
    if (leafKeyOf(s) !== leafKey && !confirmDropUnsavedWork(leafUnsent, locale)) return;
    setCurrent(s);
    if (isMobile) setRailOpen(false);
  };
  // objectstack#30046 (Scope 6) — a row under 不在导航中 opens its item; a list
  // view's is its object's page (`listViewDoorOf`). On that page already, the
  // pick is the header dropdown's: a pending edit is sent first, or asked about.
  const pickOffNav = (s: Surface) => {
    const item = s.type === 'view' ? (packageItems?.byType.view ?? []).find((i) => i.name === s.name) : undefined;
    const door = item && !s.addedIn ? listViewDoorOf(item) : null;
    if (!door) {
      pickSurface(s);
      return;
    }
    if (current?.type === 'object' && isSameSurface(current, door.surface)) {
      switchListView(door.viewId);
    } else {
      if (leafKeyOf(door.surface) !== leafKey && !confirmDropUnsavedWork(leafUnsent, locale)) return;
      openListViewDoor(door);
    }
    if (isMobile) setRailOpen(false);
  };
  // objectstack#26889 — what the sections under the tree list: the package's
  // items no entry of the nav buffer opens, an unsent nav edit included. None
  // while the app is still resolving, so an item its entry will claim is never
  // shown and then taken away.
  // objectstack#28572 — on a read-only base the "+" creates into the pair.
  const addMenuTitle = readOnly
    ? tFormat('engine.studio.if.addInPairTitle', locale, { baseName: customizeBaseLabel })
    : t('engine.studio.if.addMenuTitle', locale);
  const navOpened = navOpenedItems(navTree, locale);
  // objectstack#28572 — "only customizations": every item of the package (and
  // its pair) that carries a mark, a nav-opened one included, in place of the
  // tree; the count is the same set's.
  const itemsRead = appStatus !== 'loading' && packageItems?.packageId === packageId;
  const markedOf = (type: OffNavType) =>
    itemsRead && railMarks
      ? (packageItems?.byType[type] ?? []).filter((item) => railMarks.markOf({ type, name: item.name, addedIn: item.addedIn }) !== null)
      : [];
  // objectstack#30059 — the app's override is a customization too: one more,
  // and "only customizations" keeps the (customized) navigation it is.
  const navMarked = navServed.declaration !== null;
  const markedCount = OFF_NAV_TYPES.reduce((n, type) => n + markedOf(type).length, navMarked ? 1 : 0);
  const listOnlyCustomized = onlyCustomized && railMarks !== null && railMarks.failed === null;
  // objectstack#30059 — the navigation entries the "+" adds, on a read-only
  // base into the app's override.
  const navAddable = appStatus === 'ready' && navWritable;
  const navCustomizeKey = appName && customizeBase ? customizeItemKey(customizeBase, 'app', appName) : '';
  const navRestoreTarget =
    appName && navInPair
      ? {
          type: 'app',
          name: appName,
          key: navCustomizeKey,
          label: navItemLabelText(appLabel, locale) || appName,
          listView: false,
          nav: true,
          hasDraft: navHasDraft,
        }
      : null;
  // objectstack#30046 — under 视图: a list view an entry's header dropdown
  // reaches is not listed again (Scope 7); a form view reads a readable name,
  // and the heading says what the group holds (Scope 8).
  const offNavSections = OFF_NAV_TYPES.map((type) => {
    const items = listOnlyCustomized
      ? markedOf(type)
      : itemsRead
        ? (packageItems?.byType[type] ?? []).filter(
            (item) =>
              !navOpened.has(itemKeyOf(type, item.name)) && !(type === 'view' && offNavViewReachedByEntry(item, navOpened)),
          )
        : [];
    if (type !== 'view') return { type, items };
    return {
      type,
      label: offNavViewHeading(items, locale),
      items: items.map((item) => ({ ...item, label: offNavViewLabel(item, objectLabelOf(item.object ?? ''), locale) })),
    };
  });
  // objectstack#30046 — the view an object page opened from 不在导航中 shows: its row is the active one.
  const offNavActiveView = current?.type === 'object' && !current.navId ? (listView.target?.viewId ?? null) : null;

  return (
    <StudioDatasetAuthoringContext.Provider value={datasetAuthoring}>
    <div className="flex h-full flex-col">
      {leafConflictDialog}
      {navConflictDialog}
      {listView.conflictDialog}
      {/* objectstack#28562 — Restore's confirmation, outside the menu that opens it. */}
      {restoreDialogEl}
      {/* objectui#11823 (steps 2 and 3) — the shared create dialog; a report
          also asks for its dataset and one measure (`ReportCreateFields`), a
          page for its source kind (`PageCreateFields`). */}
      <CreateItemDialog
        open={createKind !== null && (!readOnly || newInPair)}
        onOpenChange={(open) => {
          if (!open) setCreateKind(null);
        }}
        title={t(
          createKind === 'report'
            ? 'engine.studio.interfaces.create.report'
            : createKind === 'page'
              ? 'engine.studio.interfaces.create.page'
              : 'engine.studio.interfaces.create.dashboard',
          locale,
        )}
        description={
          readOnly
            ? tFormat('engine.studio.interfaces.create.descriptionInPair', locale, {
                baseName: customizeBaseLabel,
              })
            : tFormat('engine.studio.interfaces.create.description', locale, {
                app: navItemLabelText(appLabel, locale),
              })
        }
        labelFieldLabel={t(
          createKind === 'report'
            ? 'engine.studio.interfaces.create.reportNameLabel'
            : createKind === 'page'
              ? 'engine.studio.interfaces.create.pageNameLabel'
              : 'engine.studio.interfaces.create.dashboardNameLabel',
          locale,
        )}
        labelPlaceholder={t(
          createKind === 'report'
            ? 'engine.studio.interfaces.create.reportNamePlaceholder'
            : createKind === 'page'
              ? 'engine.studio.interfaces.create.pageNamePlaceholder'
              : 'engine.studio.interfaces.create.dashboardNamePlaceholder',
          locale,
        )}
        idFieldLabel={t('engine.studio.interfaces.create.idLabel', locale)}
        idPlaceholder={t(
          createKind === 'report'
            ? 'engine.studio.interfaces.create.reportIdPlaceholder'
            : createKind === 'page'
              ? 'engine.studio.interfaces.create.pageIdPlaceholder'
              : 'engine.studio.interfaces.create.dashboardIdPlaceholder',
          locale,
        )}
        submitLabel={t('engine.studio.createDraft', locale)}
        submittingLabel={t('engine.studio.creating', locale)}
        busy={createBusy}
        error={createError}
        locale={locale}
        extra={
          createKind === 'report' ? (
            <ReportCreateFields
              value={reportBinding}
              onChange={setReportBinding}
              authoring={datasetAuthoring}
              locale={locale}
            />
          ) : createKind === 'page' ? (
            <PageCreateFields value={pageKind} onChange={setPageKind} locale={locale} />
          ) : undefined
        }
        onSubmit={({ label, name }) => {
          if (createKind) void doCreateSurface(createKind, label, name, reportBinding, pageKind);
        }}
      />
      <div className="relative flex min-h-0 flex-1">
        {isMobile && railOpen && (
          <div
            className="absolute inset-0 z-10 bg-black/30"
            onClick={() => setRailOpen(false)}
            aria-hidden="true"
          />
        )}
        {/* real App navigation tree */}
        <StudioRail
          testId="studio-rail-interfaces"
          heading={tFormat('engine.studio.if.navHeading', locale, { app: navItemLabelText(railAppLabel, locale) })}
          headerExtra={
            <>
              {/* objectui#12455 — the "+" offers every kind of nav entry the
                  spec declares (`NAV_ENTRY_TYPES`, pinned by objectui#11790),
                  each with its glyph, name and one line on what it opens. A
                  page, a dashboard or a report continues into today's create
                  flow (objectui#11823 steps 2 and 3: the item's draft and the
                  entry that links it); every other kind adds its entry,
                  unbound where it has a target, and opens it in the nav-item
                  inspector. Offered while nav editing is closed and the
                  package is writable, as the create flow always was. */}
              {/* objectstack#28572 — on a read-only base, the kinds that
                  create an item, which lands in the base's pair. */}
              {/* objectstack#30059 — the app's override: its mark, whose popover offers Restore. */}
              {navServed.declaration && (
                <InterfacesNavOverrideMark
                  baseLabel={customizeBaseLabel}
                  pairId={customizePair ?? ''}
                  basedOn={navServed.declaration.basedOn}
                  locale={locale}
                  onRestore={navRestoreTarget ? () => setRestoreFor(navRestoreTarget) : undefined}
                  restoreDisabled={
                    restoring ||
                    !!navSaving ||
                    navDirty ||
                    (customizePair === null && !pairsByItemRef.current.has(navCustomizeKey))
                  }
                />
              )}
              {((appStatus === 'ready' && !readOnly) || (appStatus !== 'loading' && newInPair)) && !editNav && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="if-create-menu"
                      aria-label={addMenuTitle}
                      title={addMenuTitle}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[268px] p-1.5" data-testid="if-add-kind-menu">
                    <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {addMenuTitle}
                    </DropdownMenuLabel>
                    {NAV_ENTRY_TYPES.map((kind) => {
                      const KindIcon = navIcon(kind);
                      const creates = kind === 'page' || kind === 'dashboard' || kind === 'report';
                      if (readOnly && !creates && !navAddable) return null;
                      return (
                        <React.Fragment key={kind}>
                          {kind === 'group' && (!readOnly || navAddable) && <DropdownMenuSeparator />}
                          <DropdownMenuItem
                            data-testid={creates ? `if-create-${kind}` : `if-add-nav-${kind}`}
                            onSelect={() => (creates ? openCreate(kind) : addNavEntry(kind))}
                            className="items-start gap-2.5 px-2 py-1.5"
                          >
                            <KindIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="flex min-w-0 flex-col">
                              <span className="text-[13px] font-medium leading-tight">{navKindName({ type: kind }, locale)}</span>
                              <span className="text-[11px] leading-snug text-muted-foreground">
                                {t(`engine.studio.if.kindDesc.${kind}`, locale)}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        </React.Fragment>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {/* objectstack#30059 — on a read-only base, Edit customizes the
                  navigation: nothing is written until an edit is saved. */}
              {appStatus === 'ready' && navWritable && (
                <button
                  type="button"
                  data-testid="if-edit-nav"
                  onClick={() => {
                    // objectui#11189 — "Done" closes through the effect beside
                    // the nav autosave, which sends an unsent edit first.
                    if (editNav) {
                      setNavClosing(true);
                      return;
                    }
                    setEditNav(true);
                    setNavSel(null);
                  }}
                  title={editNav ? t('engine.studio.if.doneEditTitle', locale) : t('engine.studio.if.editNavTitle', locale)}
                  className={
                    'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ' +
                    (editNav ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')
                  }
                >
                  {editNav ? (
                    <>
                      <Check className="h-3 w-3" /> {t('engine.studio.done', locale)}
                    </>
                  ) : (
                    <>
                      <Pencil className="h-3 w-3" /> {t('engine.studio.edit', locale)}
                    </>
                  )}
                </button>
              )}
            </>
          }
          filters={
            editNav ? undefined : (
              <RailCustomizationFilter
                marks={railMarks}
                marked={markedCount}
                on={onlyCustomized}
                onToggle={toggleOnlyCustomized}
                locale={locale}
              />
            )
          }
          isMobile={isMobile}
          open={railOpen}
        >
          <InterfacesRailMarksContext.Provider value={railMarks}>
          <InterfacesNavContributionsContext.Provider value={navPlacement}>
          <InterfacesServedContributedNavContext.Provider value={servedContributed}>
          {editNav && (
              <div className="mt-1.5 flex items-center gap-1.5">
                {navHasDraft && (
                  <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">
                    {t('engine.studio.unpublished', locale)}
                  </span>
                )}
                {navSaving === 'draft' && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" data-testid="nav-autosaving">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('engine.studio.autoSaving', locale)}
                  </span>
                )}
              </div>
          )}
          {/* objectstack#30059 — where a read-only base's navigation edit is saved. */}
          {editNav && readOnly && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              <SavedToCustomizationNote baseLabel={customizeBaseLabel} pairId={customizeNotePair} testId="if-nav-saved-to" />
            </p>
          )}
            {listOnlyCustomized && !editNav && !navMarked ? null : appStatus === 'missing' && !error ? (
              <div className="px-2 py-3" data-testid="if-no-app-rail">
                {contributedElsewhere ? (
                  <>
                    <p className="text-[11px] text-muted-foreground">{t('engine.studio.if.noOwnApp', locale)}</p>
                    {contributedElsewhere.map((found) => (
                      <p key={found.app} className="mt-1 text-[11px] text-muted-foreground">
                        {contributedElsewhereText(found, locale)}
                      </p>
                    ))}
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">{t('engine.studio.if.noApp', locale)}</p>
                )}
                {onCreateApp && (
                  <button
                    type="button"
                    onClick={onCreateApp}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-muted"
                  >
                    <Plus className="h-3 w-3" /> {t('engine.studio.app.create', locale)}
                  </button>
                )}
              </div>
            ) : editNav ? (
              // Edit mode renders AppNavCanvas even when the nav is empty — it
              // carries its own "Add nav item" affordance, so a fresh app can be
              // built up from nothing.
              <AppNavCanvas
                draft={appDraft}
                rootKey="navigation"
                onPatch={onNavPatch}
                selection={navSel}
                onSelectionChange={(s) => setNavSel(s ? { kind: s.kind, id: s.id } : null)}
                onRenamePendingChange={setNavRenamePending}
              />
            ) : navTree.length === 0 && !(appStatus === 'ready' && placesAnyNav(navPlacement)) ? (
              <p className="px-2 py-3 text-[11px] text-muted-foreground">
                {error
                  ? t('engine.studio.loadFailed', locale)
                  : appStatus === 'loading'
                    ? t('engine.studio.loading', locale)
                    : t('engine.studio.if.noNavItems', locale)}
              </p>
            ) : (
              <>
                <NavTree nodes={railTree} active={current} objectIcons={objectIconMap} onPick={pickSurface} />
                {/* objectstack#29786 — contributed entries the app's top level
                    holds: those naming no group, and those naming a group the
                    app does not declare (the served navigation appends both). */}
                <ContributedNavRows rows={navPlacement.top} />
              </>
            )}
            {/* objectstack#26889 — under the tree (or the no-app notice), the
                items no entry opens. Not while nav editing: the rail is the
                nav editor then. */}
            {!editNav && (
              <OffNavSections
                sections={offNavSections}
                active={current}
                activeViewId={offNavActiveView}
                onPick={pickOffNav}
                onlyCustomized={listOnlyCustomized}
              />
            )}
          </InterfacesServedContributedNavContext.Provider>
          </InterfacesNavContributionsContext.Provider>
          </InterfacesRailMarksContext.Provider>
        </StudioRail>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden" data-testid="if-content-column">
          {ifHeaderEl}
          {canvasStatusEl}
          {definitionSheetEl}
          <div className="flex min-h-0 flex-1">
        {canvasEl}
        {inSlot
          ? // objectui#12725 — the properties live in the surface's right slot.
            slot.propsTarget && createPortal(inspectorAsideEl, slot.propsTarget)
          : // The classic layout (an injected `aiSlot`): the aside beside the
            // canvas, collapsible from the header to hand the canvas its width.
            inspectorCollapsed
            ? null
            : inspectorAsideEl}
          </div>
        </div>
      </div>
    </div>
    </StudioDatasetAuthoringContext.Provider>
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
    />
  );
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
}: {
  packageId: string;
  publishNonce?: number;
  onDraftSaved?: (saved?: StudioSavedDraft) => void;
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
  // The last-saved time reads the DISPLAY locale — not `locale` above, which
  // picks the pillar's strings and is `'en-US'` for every non-zh language
  // (objectui#10232).
  const displayLocale = useDisplayLocale();
  // Live server JSONSchemas per metadata type (`/meta/types`) — handed to the
  // Actions/Hooks config panels so their forms are driven by the real metadata
  // contract (and stay forward-compatible when the server spec adds fields).
  const { entries: metaTypes } = useMetadataTypes(client);
  const typeSchemas = React.useMemo(() => {
    const idx: Record<string, Record<string, unknown> | undefined> = {};
    for (const e of metaTypes) idx[e.type] = e.schema;
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
  // Timestamp of the last successful draft save — renders a "last saved HH:MM"
  // hint next to the Save button (framework#2615 P3: nothing confirmed a draft
  // save persisted, unlike the sibling pillars which toast).
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [gridVer, setGridVer] = React.useState(0);
  // Records grid ⇄ Form ⇄ Validations ⇄ Settings — four views of the SAME
  // object. Grid/Form are the runtime renderer (same-renderer principle);
  // Validations edits `validations` rules; Settings edits object basics +
  // the ADR-0085 semantic roles. All patch the one `objDraft`.
  const [viewMode, setViewMode] = React.useState<'grid' | 'form' | 'rules' | 'settings' | 'hooks' | 'actions' | 'api'>('grid');
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
  const {
    save: saveObjDraft,
    recordRead: recordObjRead,
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
            .map((o) => ({ type: 'object', name: String(o.name ?? ''), label: String(o.label ?? o.name ?? ''), icon: o.icon ? String(o.icon) : undefined }))
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
          .map((o) => ({ type: 'object', name: String(o.name ?? ''), label: String(o.label ?? o.name ?? ''), icon: o.icon ? String(o.icon) : undefined }))
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
    const loadKey = `${current.name}#${publishNonce}#${objReloadNonce}`;
    if (loadedNameRef.current === loadKey) return;
    loadedNameRef.current = loadKey;
    let cancelled = false;
    // objectui#11331 — whether this run's load has settled (see the cleanup).
    let settled = false;
    setLoading(true);
    setError(null);
    setFieldSel(null);
    // objectstack#27485 — kept CEL verdicts judged the buffer this load replaces.
    setCelVerdicts({});
    setPanelCelVerdicts({});
    // objectstack#27644 — and so did the served one; a save's re-read in flight is dropped.
    objVerdictSeq.current += 1;
    setObjVerdict(undefined);
    setObjVerdictBody(undefined);
    setDirty(false);
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
  }, [client, current, packageId, publishNonce, objReloadNonce, recordObjRead]);

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
    const loadKey = `${name}#${publishNonce}#${extReloadNonce}`;
    if (extLoadedRef.current === loadKey) return;
    extLoadedRef.current = loadKey;
    let cancelled = false;
    let settled = false;
    setExt(null);
    setExtDirty(false);
    setExtHasDraft(false);
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
          draft = objectExtensionBodyOf(extractDraftBody(draftRead.answer), name);
          published = objectExtensionBodyOf(publishedRow, name);
          recordExtRead(OBJECT_EXTENSION_TYPE, name, pair, draftRead.pin);
        }
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
  }, [client, current, extendsBase, publishNonce, extReloadNonce, recordExtRead]);

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
  const gridColumnsComputed = React.useMemo(() => {
    // objectstack#29793 — the served object's columns the buffer does not
    // declare (`owner_id` and the other injected ones) lead, as they lead the
    // served object: the grid shows the records as the server has them.
    const held = readFields(shownDraft.fields).entries;
    const heldNames = new Set(held.map((e) => e.name));
    return [...servedOnly.filter((e) => !heldNames.has(e.name)), ...held]
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
  }, [shownDraft.fields, publishedFieldNames, servedOnly]);
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

  // objectstack#30057 — the form view the app's New and Edit dialogs open for
  // this object, asked of the app's own resolver over the shell's merged
  // objects (`formLayoutChoiceOf` → `selectRecordFormView`). With one, the
  // Form tab lays out THAT view's sections and saves them to its draft (on a
  // read-only base, as a declared override in its pair, ADR-0146 D2); with
  // none, the object's field groups, as before. Where New and Edit open
  // different form views, the author picks which one is shown.
  const shellMetadata = useMetadata();
  const [formFlow, setFormFlow] = React.useState<RecordFormFlow>('create');
  const servedFormObject = current
    ? (findByName(shellMetadata.objects, current.name) as ObjectDefinitionForFormView | undefined)
    : undefined;
  const formChoice = formLayoutChoiceOf(servedFormObject, formFlow);
  const formViewCustomization = extendsBase ? customization : null;
  const formViewId = formChoice.viewId;
  const formView = useFormViewDraft({
    client,
    packageId,
    viewId: formViewId,
    publishNonce,
    customization: formViewCustomization,
    locale,
    onDraftSaved: () => onDraftSaved?.({ type: 'view', name: formViewId }),
  });
  // A read-only package edits a form view only where its pair takes the override.
  const formViewReadOnly = !formViewId || (readOnly && (formViewCustomization === null || formViewCustomization.walled));
  const { flush: flushFormView } = useDraftAutoSave({
    target: formView.targetKey,
    loadedFor: formView.loadedFor,
    dirty: formView.dirty,
    blocked: !formView.row || formView.saving || formViewReadOnly,
    snapshot: formView.row,
    save: formView.save,
  });
  const formViewDirty = formView.dirty;
  // Until the buffer loads, the served view's sections, read-only.
  const formViewLayout = formChoice.view
    ? formView.sections && !formViewReadOnly
      ? { sections: formView.sections, onSectionsChange: formView.setSections }
      : { sections: formView.sections ?? formViewSectionsOf(formChoice.view as Record<string, unknown>), onSectionsChange: () => {} }
    : null;

  // objectui#12515 — what the Form tab's Preview renders. The draft differs
  // from the published definition when there is no published one, a pending
  // draft, or an unsaved edit; then Preview shows the draft unless the author
  // picked Published (offered only when a published version exists).
  // objectstack#30057 — the form view's draft counts too.
  const draftDiffers =
    !hasBaseline ||
    hasDraft ||
    dirty ||
    (extOpen !== null && (extHasDraft || extDirty)) ||
    (formChoice.view !== null && (formView.hasDraft || formViewDirty));
  const previewShowsDraft = !hasBaseline || (draftDiffers && previewSource === 'draft');
  const previewDraft = previewShowsDraft ? shownDraft : null;
  const previewObjectName = current?.name ?? '';
  // objectstack#30057 — Preview lays the form out as the dialog it previews
  // does: the chosen form view's sections (its draft beside a draft preview),
  // through the dialog's own resolver.
  const previewFormView =
    formChoice.view && previewShowsDraft && formView.row ? formViewBodyOf(formView.row) : formChoice.view;
  const previewFormLayout = resolveFormViewLayout(
    previewFormView ? { name: previewObjectName, form: previewFormView as FormViewDefinition } : null,
  );
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

  // "+ new object": create a fresh object as a DRAFT in this package (runtime
  // create — same path the classic Studio editor uses), seeded with one text
  // field so the form/grid isn't empty. It stays draft-only (no physical table)
  // until the package publish, so we land on Form · Layout — the metadata-level
  // surface that never fires data SQL.
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
        const surface: Surface =
          target.packageId === railPackageId ? { type: 'object', name, label } : { type: 'object', name, label, addedIn: target.packageId };
        setObjects((prev) => [...prev, surface]);
        if (surface.addedIn) setRailNonce((n) => n + 1);
        setCurrent(surface);
        setViewMode('form');
        setFormMode('layout');
        setCreating(false);
        onDraftSaved?.();
      } catch (e) {
        // Shown in the create dialog, which prints the message only: kept whole.
        setError(plainRefusal(e));
      } finally {
        setCreateBusy(false);
      }
    },
    [objects, client, railPackageId, onDraftSaved, packageReadOnly, newInPair, customization, locale, namespace],
  );

  const doSave = React.useCallback(async (sent: DraftSend) => {
    if (!current) return;
    setSaving('draft');
    setError(null);
    // objectui#10202 — the buffer was seeded from the served object, whose
    // picklist-bound fields carry the list's resolved `options`; the door
    // refuses them beside `picklist`, so they stay out of the body.
    // objectui#11785 — kept, so a refusal is read against what was sent.
    const body = dropServedPicklistOptions(objDraft);
    try {
      const outcome = await saveObjDraft('object', current.name, body, { mode: 'draft', packageId, surface: 'studio' });
      // objectui#11773 — the author chose the saved version; the load replaces the buffer.
      if (outcome === 'reloaded') return;
      setHasDraft(true);
      // objectui#11204 — clean only if nothing was edited while it was in flight.
      if (sent.unmoved()) setDirty(false);
      setSavedAt(new Date());
      // objectstack#27644 — the draft this save stored carries its own publish
      // verdict on its next read; the one held described the body before it.
      const seq = ++objVerdictSeq.current;
      void readDraftForSave(client, 'object', current.name, packageId).then((read) => {
        if (seq !== objVerdictSeq.current) return;
        setObjVerdict(draftEnvelopeDiagnostics(read.answer));
        setObjVerdictBody(extractDraftBody(read.answer) ?? undefined);
      });
      // objectstack#28984 — named by the label this save stored; one toast per
      // object however many editing pauses save it (`announceDraftSaved`).
      announceDraftSaved(
        { type: 'object', name: current.name },
        typeof body.label === 'string' && body.label ? body.label : current.label,
        locale,
      );
      onDraftSaved?.({ type: 'object', name: current.name });
    } catch (e) {
      setError(objectSaveRefusal(e, body, locale));
    } finally {
      setSaving(false);
    }
  }, [saveObjDraft, client, current, objDraft, onDraftSaved, packageId, locale]);

  // objectui#11786 — an edit whose body the write guard would refuse (a choice
  // field before its options, a relationship before its target) is held, not
  // sent: it stays dirty and on screen, the field's inspector hints what it
  // needs, and the line below names it. Asked of the guard on the body `doSave`
  // would send, so it holds exactly what the door would refuse.
  const objIncomplete = React.useMemo(
    () => (dirty ? objectHeldEdit(dropServedPicklistOptions(objDraft), locale) : null),
    [dirty, objDraft, locale],
  );

  // objectui#5813 — auto-save replaces the Save draft button; the blocked guard
  // is the button's old disabled-condition verbatim, plus the hold above.
  const { flush: flushObjSave, sending: sendingObjDraft, loaded: objLoaded } = useDraftAutoSave({
    // objectui#11232 — the object `doSave` addresses.
    target: `object:${current?.name ?? ''}`,
    loadedFor: objDraftFor,
    dirty,
    blocked: !current || !!saving || readOnly || saveBlocking > 0 || objIncomplete !== null,
    snapshot: objDraft,
    save: doSave,
  });

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
  // The extension's draft save, into the pair the door answered. A refusal
  // (the suffix, a structural key, the ensure door's walled 403) is shown as
  // the server sent it.
  const doSaveExt = React.useCallback(
    async (sent: DraftSend) => {
      if (!extOpen || !customization) return;
      const { for: name, body } = extOpen;
      setSaving('draft');
      setError(null);
      try {
        const pair = await extPairFor(customization);
        const outcome = await saveExtDraft(OBJECT_EXTENSION_TYPE, name, extensionBodyForSave(body), {
          mode: 'draft',
          packageId: pair,
          surface: 'studio',
        });
        if (outcome === 'reloaded') return;
        setExtHasDraft(true);
        if (sent.unmoved()) setExtDirty(false);
        setSavedAt(new Date());
        // objectstack#28984 — the extension customizes the open object, so it
        // is named by that object's label.
        announceDraftSaved({ type: OBJECT_EXTENSION_TYPE, name }, current?.label ?? '', locale);
        onDraftSaved?.({ type: OBJECT_EXTENSION_TYPE, name });
      } catch (e) {
        setError(plainRefusal(e));
      } finally {
        setSaving(false);
      }
    },
    [extOpen, customization, extPairFor, saveExtDraft, onDraftSaved, current, locale],
  );
  const { flush: flushExtSave } = useDraftAutoSave({
    target: `${OBJECT_EXTENSION_TYPE}:${current?.name ?? ''}`,
    loadedFor: extOpen ? `${OBJECT_EXTENSION_TYPE}:${extOpen.for}` : '',
    dirty: extDirty,
    blocked: !extWritable || !!saving || saveBlocking > 0,
    snapshot: extOpen?.body ?? null,
    save: doSaveExt,
  });
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
  useHeldEditReport(onHeldEditChange, objHeld?.clause ?? null);
  // objectstack#27511 — opening another object replaces the one buffer the
  // open object's edits live in, and the autosave's timer sends nothing once
  // the open object has changed (objectui#11232). So an edit still inside the
  // debounce was dropped by the switch with nothing on screen. The switch now
  // sends it first with the autosave's own `flush` and opens the object once
  // the buffer is clean, as the Interfaces nav's "Done" closes (objectui#11189);
  // a save already in flight is waited out the same way. An edit that cannot
  // be sent (held, or its save refused with the refusal on screen) is the
  // author's to drop: the switch asks (objectstack#26705).
  const [switchTo, setSwitchTo] = React.useState<Surface | null>(null);
  const openObject = React.useCallback(
    (next: Surface): boolean => {
      if (next.name === current?.name) {
        setSwitchTo(null);
        setCurrent(next);
        return true;
      }
      // objectstack#28575 — and the base object's extension buffer the same way.
      // objectstack#30057 — and the form view's buffer.
      if (
        saving ||
        (dirty && objHeld === null && flushObjSave()) ||
        (extDirty && flushExtSave()) ||
        (formViewDirty && flushFormView())
      ) {
        setSwitchTo(next);
        return true;
      }
      if (!confirmDropUnsavedWork(dirty || extDirty || formViewDirty, locale)) return false;
      setSwitchTo(null);
      setCurrent(next);
      return true;
    },
    [current, saving, dirty, extDirty, formViewDirty, objHeld, flushObjSave, flushExtSave, flushFormView, locale],
  );
  React.useEffect(() => {
    if (!switchTo || saving || formView.saving) return;
    if (dirty && objHeld === null && flushObjSave()) return;
    if (extDirty && flushExtSave()) return;
    if (formViewDirty && flushFormView()) return;
    setSwitchTo(null);
    // Still dirty: the save was refused (on screen) or an edit taken meanwhile
    // is held. The author stays; the next switch asks.
    if (dirty || extDirty || formViewDirty) return;
    setCurrent(switchTo);
  }, [switchTo, saving, dirty, extDirty, formViewDirty, formView.saving, objHeld, flushObjSave, flushExtSave, flushFormView]);
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

  // Drag-reorder columns → reorder the object's `fields` metadata (field display
  // order follows metadata order), saved as a DRAFT. Published later via the
  // package release — NOT auto-published per reorder as it used to be.
  // objectui#11204 — this save is sent here, not by the autosave, so it takes
  // its claim on the buffer from the autosave's `sending`: an edit taken while
  // it is in flight stays dirty, and the autosave sends it next.
  const doReorderFields = React.useCallback(
    async (orderedNames: string[]) => {
      if (!current) return;
      const view = readFields(objDraft.fields);
      // Reorder only the visible fields among their own slots; keep system /
      // hidden fields (not shown as columns) in their original positions.
      const visible = new Set(orderedNames);
      const visibleInOrder = orderedNames
        .map((n) => view.entries.find((e) => e.name === n))
        .filter((e): e is (typeof view.entries)[number] => Boolean(e));
      let vi = 0;
      const entries = view.entries.map((e) => (visible.has(e.name) ? visibleInOrder[vi++] : e));
      const body = { ...objDraft, fields: writeFields({ ...view, entries }) };
      // objectui#11272 — no claim, no save: the buffer is not this object's.
      const sent = sendingObjDraft(body);
      if (!sent) return;
      setObjDraft(body);
      setSaving('draft');
      setError(null);
      // objectui#10202 — same served `options` as `doSave` above.
      const wire = dropServedPicklistOptions(body);
      try {
        const outcome = await saveObjDraft('object', current.name, wire, { mode: 'draft', packageId, surface: 'studio' });
        if (outcome === 'reloaded') return;
        setHasDraft(true);
        if (sent.unmoved()) setDirty(false);
        onDraftSaved?.({ type: 'object', name: current.name });
        setGridVer((v) => v + 1); // remount so the grid reflects the new (draft) order
      } catch (e) {
        setError(objectSaveRefusal(e, wire, locale));
      } finally {
        setSaving(false);
      }
    },
    [saveObjDraft, current, objDraft, onDraftSaved, sendingObjDraft, packageId, locale],
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
  // objectstack#30057 — which layout the tab shows, and, where New and Edit
  // open different form views, the pick between them. A pending edit of the
  // shown view is sent before the other one loads, or the author is asked.
  const switchFormFlow = (next: RecordFormFlow) => {
    if (next === formFlow) return;
    if (formViewDirty && !flushFormView() && !confirmDropUnsavedWork(true, locale)) return;
    setFormFlow(next);
  };
  const formLayoutSource = current ? (
    <div className="inline-flex items-center gap-2" data-testid="form-layout-source">
      {formChoice.flowsDiffer && (
        <div
          role="group"
          aria-label={t('engine.studio.data.form.flowLabel', locale)}
          data-testid="form-layout-flow"
          className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5"
        >
          {(['create', 'edit'] as const).map((flow) => (
            <button
              key={flow}
              type="button"
              onClick={() => switchFormFlow(flow)}
              aria-pressed={formFlow === flow}
              className={formModeItem(formFlow === flow)}
            >
              {t(flow === 'create' ? 'engine.studio.data.form.flowCreate' : 'engine.studio.data.form.flowEdit', locale)}
            </button>
          ))}
        </div>
      )}
      <span
        data-testid="form-layout-source-chip"
        data-source={formChoice.view ? 'form-view' : 'field-groups'}
        data-view={formViewId || undefined}
        title={t(
          formChoice.view
            ? 'engine.studio.data.form.layoutSource.formViewTitle'
            : 'engine.studio.data.form.layoutSource.fieldGroupsTitle',
          locale,
        )}
        className="inline-flex h-6 items-center rounded bg-muted px-2 text-[11px] text-muted-foreground"
      >
        {formChoice.view
          ? tFormat('engine.studio.data.form.layoutSource.formView', locale, { name: formViewId || current.name })
          : t('engine.studio.data.form.layoutSource.fieldGroups', locale)}
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
      {extConflictDialog}
      {formView.conflictDialog}
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
                icon={<Icon className="h-4 w-4 shrink-0" />}
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
            title={current ? current.label : t('engine.studio.data.objects', locale)}
            titleProps={current ? undefined : { className: 'text-[13px] font-normal text-muted-foreground' }}
            apiName={current?.name}
            chips={current?.addedIn ? <StudioPairItemChip pairId={current.addedIn} locale={locale} /> : undefined}
            meta={current && objLoaded ? fieldCountText : undefined}
            status={objDraftStatus}
            actions={
              <>
                {/* objectui#5813 — drafts auto-save (see useDraftAutoSave above); the
                    hint is the whole affordance: saving spinner while in flight, the
                    last-saved time once landed. The old Save draft button is retired. */}
                {saving === 'draft' ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="data-autosaving">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('engine.studio.autoSaving', locale)}
                  </span>
                ) : savedAt && !dirty && !extDirty ? (
                  <span className="text-[11px] text-muted-foreground" data-testid="data-saved-at">
                    {tFormat('engine.studio.data.lastSaved', locale, {
                      time: savedAt.toLocaleTimeString(displayLocale, { hour: '2-digit', minute: '2-digit' }),
                    })}
                  </span>
                ) : null}
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
                    offered where fields are laid out: the Form toolbar and the
                    Records grid's own "+" column, both opening the Add field
                    popover that runs `addField` (objectui#12516). The
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
                  objectName={current.name}
                  packageId={packageId}
                  disabled={readOnly}
                  hookSchema={typeSchemas.hook}
                  publishNonce={publishNonce}
                  onDraftSaved={onDraftSaved}
                />
              ) : viewMode === 'actions' ? (
                <div ref={actionsPanelRef} className="contents">
                  <ObjectActionsPanel
                    draft={objDraft}
                    onPatch={onPatch}
                    disabled={readOnly}
                    focus={actionFocus}
                    actionSchema={typeSchemas.action}
                    onCelVerdictsChange={reportPanelVerdicts}
                    // objectstack#30088 — a base object's new actions are items of the pair.
                    pair={
                      extendsBase && customization
                        ? {
                            pairId: railPairId,
                            ensure: customization.ensure,
                            walled: customization.walled,
                            marks: railMarks,
                            publishNonce,
                            onDraftSaved,
                          }
                        : null
                    }
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
                className="relative min-h-0 flex-1 overflow-auto bg-background"
                data-testid="data-records-body"
                onClickCapture={(e) => {
                  // React carries a click inside the (portalled) popover here
                  // too; only a click in the body's own DOM is the grid's.
                  if (e.target instanceof Element && e.currentTarget.contains(e.target)) {
                    gridAddFieldButton.current = e.target.closest('button');
                  }
                }}
              >
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
                    onEditColumn: (fieldName) => {
                      // ignore non-field columns (e.g. the row-actions column)
                      if (readFields(shownDraft.fields).entries.some((e) => e.name === fieldName)) {
                        setFieldSel({ kind: 'field', id: fieldName });
                      }
                    },
                    editColumnLabel: t('engine.studio.data.editFieldProps', locale),
                  }}
                >
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
                {formChoice.view && formView.failure && (
                  <div
                    role="alert"
                    data-testid="form-view-failure"
                    className="shrink-0 border-b bg-destructive/5 px-6 py-2 text-xs text-destructive"
                  >
                    {plainRefusal(formView.failure.error).message}
                  </div>
                )}
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
                  readOnly={formViewLayout ? formViewReadOnly || !formView.sections : readOnly}
                  modeControl={formToolbarLeading}
                  contributedFields={contributedFields}
                  formView={formViewLayout}
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
                          // objectstack#30057 — the chosen form view's layout, as the dialog lays it out.
                          ...(previewFormLayout.sections ? { sections: previewFormLayout.sections } : {}),
                          ...(previewFormLayout.contentLayout === 'tabbed' ? { formType: 'tabbed' } : {}),
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
            id={fieldSel.id}
            onClose={() => setFieldSel(null)}
            closeLabel={t('engine.studio.close', locale)}
            // objectui#12725 — the copilot's 草稿 chip on a field it changed.
            actions={fieldAgentMark ? <DraftChip locale={locale} className="mr-1" /> : undefined}
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
        submitLabel={t('engine.studio.createDraft', locale)}
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

/** Automations pillar — flows: list → FlowPreview (default OFF / review-then-enable). */
export function AutomationsPillar({
  packageId: railPackageId,
  objectOrder = NO_OBJECT_ORDER,
  publishNonce = 0,
  onDraftSaved,
  readOnly: packageReadOnly = false,
  customization = null,
  onHeldEditChange,
}: {
  /**
   * The package whose flows the rail lists, or `null` for the package-less
   * scope (objectui#11553, `studioScope.ts`): every flow that belongs to no
   * package, saved as package-less drafts.
   */
  packageId: string | null;
  /**
   * objectui#12612 — the objects the package app's navigation lists, in its
   * order (`navigationObjectOrder`): the rail's groups follow it. The shell
   * reads it with the package's app; none (the package-less scope, a package
   * without an app) leaves every group ordered by its flow count.
   */
  objectOrder?: readonly string[];
  publishNonce?: number;
  onDraftSaved?: (saved?: StudioSavedDraft) => void;
  /** Courtesy gate: hide/disable flow-authoring affordances. */
  readOnly?: boolean;
  /** objectstack#28572 — on a read-only base, its pair: the rail lists the pair's flows too, and New lands there. */
  customization?: StudioBaseCustomization | null;
  /** objectui#11786 — the clause of the edit the autosave holds unsent, for the surface's Publish. */
  onHeldEditChange?: (clause: string | null) => void;
}): React.ReactElement {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  const navigate = useNavigate();
  const location = useLocation();
  // objectstack#28572 (ADR-0146 D3) — the rail is the base's; on a read-only
  // base it lists the flows its pair adds too, and New lands in the pair.
  const railPairId = packageReadOnly && railPackageId !== null && customization ? customization.pairId : null;
  const railMarks = railPackageId === null ? null : railCustomizationsOf(customization?.marks, railPackageId);
  const [onlyCustomized, toggleOnlyCustomized] = useRailCustomizationsOnly();
  const newInPair = packageReadOnly && railPackageId !== null && customization !== null && !customization.walled;
  // objectstack#28567 — "New similar" (`FlowItemMoreMenu`): the strip that
  // shows the copy the clone door saved, with the door's sentence that it is
  // switched off, as sent. The copy usually opens in ANOTHER package (a
  // read-only base's pair), which remounts this pillar (keyed by package), so
  // the landing rides the navigation's state and is read once here.
  const [flowCopied, setFlowCopied] = React.useState<FlowCopiedStrip | null>(
    () =>
      readFlowCopiedArrival(location.state, railPackageId) ??
      // objectstack#28572 — a copy that landed in the base's pair arrives on
      // the base's surface (the pair's URL lands there). Matched by the spec's
      // pairing rule: a read of where the copy went, never a write target.
      (railPackageId !== null ? readFlowCopiedArrival(location.state, pairIdOf(railPackageId)) : null),
  );
  // The copy to open once the rail re-reads, when it landed in THIS package.
  const openAfterListRef = React.useRef<string | null>(null);
  const canAuthorFlows = useCanAuthorMetadata();
  // See DataPillar's rail — same mobile-overlay treatment for the flow list.
  const isMobile = useIsMobile();
  const [railOpen, setRailOpen] = React.useState(false);
  // objectui#11795 — on a row too narrow for the Configuration aside to sit
  // beside the canvas (`AUTOMATIONS_CONFIG_FOLD_WIDTH`), the aside folds away
  // and a selection opens the same configuration as a drawer over the canvas,
  // so the canvas keeps the row's width. Wider rows keep the aside as it was.
  const layoutRowRef = React.useRef<HTMLDivElement>(null);
  const configFolded = useIsNarrowerThan(layoutRowRef, AUTOMATIONS_CONFIG_FOLD_WIDTH);
  const [flows, setFlows] = React.useState<Surface[]>([]);
  // objectui#11794 — the rail's search: a case-insensitive match on the label
  // or the machine name. Ephemeral (AGENTS.md #8): nobody expects it back.
  const [railQuery, setRailQuery] = React.useState('');
  const railNeedle = railQuery.trim().toLowerCase();
  const flowMatches = (f: Surface) => f.label.toLowerCase().includes(railNeedle) || f.name.toLowerCase().includes(railNeedle);
  // objectstack#28572 — "only customizations" keeps the marked rows.
  const flowShown = (f: Surface) =>
    (!railNeedle || flowMatches(f)) && (!onlyCustomized || railMarks?.markOf(f) != null);
  const shownFlows = flows.filter(flowShown);
  const markedFlows = railMarks ? flows.filter((f) => railMarks.markOf(f) !== null).length : 0;
  // objectui#7255 — same live-pulse subscription as the sibling rails; this
  // one only replaces the flow LIST, so it needs no edit-buffer hold either.
  const metadataRefreshNonce = useMetadataRefreshNonce();
  const [current, setCurrent] = React.useState<Surface | null>(null);
  // objectstack#28572 — a flow the pair adds (`current.addedIn`) opens
  // writable, read and saved at the pair: every read and write of the OPEN
  // flow below names `packageId` and asks `readOnly`, the open flow's own.
  const packageId: string | null = current?.addedIn ?? railPackageId;
  const readOnly = packageReadOnly && !current?.addedIn;
  // The draft writes' package binding (objectui#11553): none in the
  // package-less scope, so the draft row stays as package-less as the flow it
  // edits. The client sends no `package=` for an absent id.
  const draftPackageId = packageId ?? undefined;
  // objectstack#28570 (ADR-0146 D9 items 1–3, D2) — Customize a flow. On a
  // read-only base its flow is edited in the base's paired customization
  // package under the flow's own name, as a declared override of the base's
  // flow, with N-17's control and ensure door. Its editors stay read-only
  // until Customize is pressed, or while the server serves no override of
  // it; nothing is written until an edit is saved. ⛔ The pair a write names
  // is the door's answer; the pair a READ names is the surface's, read
  // through this ref, so a pair the first save creates never reloads the
  // buffer it saved. Whether the flow is overridden is the declared
  // override's own row as served (`useServedOverride`: the pair's draft, else
  // the layered read's `overlay`), ⛔ never the served envelope's
  // `deletable`, which follows the base's seal.
  const customizationRef = React.useRef(customization);
  React.useLayoutEffect(() => {
    customizationRef.current = customization;
  });
  const flowCustomizing = packageReadOnly && railPackageId !== null && customization !== null;
  const customizeBase = flowCustomizing && customization ? customization.base : null;
  const customizePair = flowCustomizing && customization ? customization.pairId : null;
  const customizeBaseLabel = customization?.baseLabel ?? railPackageId ?? '';
  // objectstack#30436 — the pair the "saved to" note names.
  const customizeNotePair = customization ? (customization.pairId ?? pairIdOf(customization.base)) : null;
  const customizeWalled = flowCustomizing && customization?.walled === true;
  const customizeBlock: CustomizeBlock = customizeWalled
    ? 'walled'
    : flowCustomizing && !customization?.basedOn
      ? 'noVersion'
      : null;
  const flowCustomizable = flowCustomizing && !!current && !current.addedIn;
  // The flows Customize was pressed on, by name: unlocked, nothing saved yet.
  const [customizeAsked, setCustomizeAsked] = React.useState<ReadonlySet<string>>(() => new Set());
  // The ensure door's answer for each flow's first saved edit: asked once per
  // flow, and again only after a refusal.
  const pairsByFlowRef = React.useRef(new Map<string, Promise<string>>());
  const pairForFlow = React.useCallback((custom: StudioBaseCustomization, name: string): Promise<string> => {
    const held = pairsByFlowRef.current.get(name);
    if (held) return held;
    const asked = custom.ensure();
    pairsByFlowRef.current.set(name, asked);
    asked.catch(() => {
      if (pairsByFlowRef.current.get(name) === asked) pairsByFlowRef.current.delete(name);
    });
    return asked;
  }, []);
  // Re-reads the served declaration: a flow's first save into the pair, a restore.
  const [servedNonce, setServedNonce] = React.useState(0);
  const flowServed = useServedOverride(
    client,
    flowCustomizable && current ? { type: 'flow', name: current.name } : null,
    customizeBase,
    customizePair,
    `${publishNonce}:${servedNonce}`,
  );
  const flowInPair = flowCustomizable && flowServed.declaration !== null;
  const flowUnlocked =
    flowCustomizable &&
    !customizeWalled &&
    (flowInPair || (customizeBlock === null && !!current && customizeAsked.has(current.name)));
  // The open flow's editors: locked on a read-only package's flow unless it is customized.
  const editLocked = readOnly && !flowUnlocked;
  const flowInPairRef = React.useRef(flowInPair);
  React.useLayoutEffect(() => {
    flowInPairRef.current = flowInPair;
  });
  // A restore in flight: no save is sent beside it.
  const [restoring, setRestoring] = React.useState(false);
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  // The package the open flow's draft read was asked at (`flow:NAME`): the
  // address the pin it recorded describes.
  const flowReadAtRef = React.useRef<{ key: string; at: string | undefined } | null>(null);
  // `?surface=flow:<name>` capture + mirror — shared plumbing (see
  // useSurfaceDeepLink). No producer emits this link yet; honoring it keeps
  // the pillars uniform so a future "design this flow" bridge just works.
  const initialSurface = useSurfaceDeepLink(current);
  // objectui#11553 — the package-less probe for a deep-linked flow this
  // package does not hold runs once per mount, not on every list re-read.
  const deepLinkProbedRef = React.useRef(false);
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  // objectui#11272 — the flow `draft` was loaded for, `flow:NAME`: written
  // where the load below installs it, and nowhere else.
  const [draftFor, setDraftFor] = React.useState('');
  // objectui#11773 — the version `draft` was saved at, sent as `If-Match` by
  // every save of this buffer (the autosave and the enable switch). A
  // conflict's "reload" re-runs the flow load below.
  const [flowReloadNonce, setFlowReloadNonce] = React.useState(0);
  const reloadFlowDraft = React.useCallback(() => setFlowReloadNonce((n) => n + 1), []);
  const {
    save: saveFlowDraft,
    recordRead: recordFlowRead,
    dialog: flowConflictDialog,
  } = useDraftSaveGuard(client, reloadFlowDraft);
  const [selection, setSelection] = React.useState<MetadataSelection | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState<false | 'draft' | 'publish'>(false);
  const [hasDraft, setHasDraft] = React.useState(false);
  // objectstack#26858 — the server's verdict on the flow on screen: the pending
  // draft's (what its publish will refuse), else the layered read's. Taken off
  // each read, never computed here; the inspectors read it at their paths.
  const [flowVerdict, setFlowVerdict] = React.useState<ServerDiagnostics | undefined>(undefined);
  // objectstack#27799 — and the flow's Problems list reads that same verdict,
  // so it never calls a flow valid that its publish refuses.
  const flowPreviewDiagnostics = React.useMemo(
    () =>
      verdictPreviewEntries(flowVerdict).map((entry) => ({
        ...entry,
        message: translateValidationMessage(entry.message, locale),
      })),
    [flowVerdict, locale],
  );
  const flowVerdictSeq = React.useRef(0);
  // objectstack#28570 — read at the package the draft was saved at (a customized flow's pair).
  const rereadFlowVerdict = React.useCallback(
    (flowName: string, at: string | undefined) => {
      const seq = ++flowVerdictSeq.current;
      void readDraftForSave(client, 'flow', flowName, at).then((read) => {
        if (seq === flowVerdictSeq.current) setFlowVerdict(draftEnvelopeDiagnostics(read.answer));
      });
    },
    [client],
  );
  // objectui#11785 — a load failure as it was (`plainRefusal`), a refused save
  // as an author sentence naming the step and its input, raw text behind Details.
  const [error, setError] = React.useState<StudioRefusal | null>(null);
  // Tells "still fetching the list" apart from "fetched, package has no flows"
  // — without it the empty rail showed an endless "Loading…" for a fresh package.
  const [listed, setListed] = React.useState(false);
  // The flow a deep link named that this rail, once listed, does not hold.
  const missingFlow =
    listed && initialSurface?.type === 'flow' && !flows.some((f) => f.name === initialSurface.name)
      ? initialSurface.name
      : null;
  // Inline create — a fresh package starts with zero flows, so the pillar must
  // offer a way to author the first one (mirrors the object/app creators).
  const [creating, setCreating] = React.useState(false);
  const [createBusy, setCreateBusy] = React.useState(false);
  // objectui#11788 — the trigger the New dialog asks for (unset = choose it
  // later on the Start node), and the object a record trigger watches. The
  // New button empties both each time it opens the dialog, as the dialog
  // empties its own inputs.
  const [newTrigger, setNewTrigger] = React.useState('');
  const [newTriggerObject, setNewTriggerObject] = React.useState('');
  const startTrigger = React.useMemo(() => newFlowTriggerFields(locale), [locale]);
  // objectui#11861 — the dialog opens on the starting points of
  // `flowPresets.ts`; the trigger form above is the *Advanced* choice. A
  // record preset waits for its object: `newNeeds` is the line the dialog
  // shows while Create holds it.
  const [newChoice, setNewChoice] = React.useState<FlowPreset | 'advanced'>(FLOW_PRESETS[0]);
  const [newNeeds, setNewNeeds] = React.useState<string | null>(null);
  // objectstack#26917 — a create refused because the identifier is taken:
  // which flow holds it, and whether it is on this rail, so it can be opened.
  const [createTaken, setCreateTaken] = React.useState<{ name: string; label: string; here: boolean } | null>(null);
  const newChoiceGroup = React.useId();
  // objectui#12303 — the read-only reason the header's status switch is described by.
  const toggleReadOnlyReasonId = React.useId();
  // objectui#12454 — the canvas hint the header used to print describes the Canvas tab.
  const canvasHintId = React.useId();
  // objectui#11591 — keyed on the pillar's one type, as the inspector beside
  // it is, never on the open flow's: with no flow open (a deep link naming one
  // this rail does not hold, or an empty rail) a selection-keyed read found no
  // designer and the canvas chip below said none were registered, on a page
  // whose designers are.
  const Preview = useRegisteredMetadataPreview('flow');
  const inspector = useRegisteredMetadataInspector('flow');
  const isEditable = !!Preview;
  // objectui#6795 part C — the FOURTH site, found by sweeping past the three the
  // ruling named. Same class as the Interfaces rail: with the registries
  // unpopulated the canvas below degrades to a raw JSON dump, and both the
  // header chip ("click a node to configure") and the rail ("Click a node on the
  // canvas, and its configuration appears here") went on instructing the author
  // to click nodes that are not rendered. Same constraint on the wording — ⛔ no
  // "loading…"/"try again": the reads are observed (objectui#11939), so a late
  // registration does bring the canvas back, but nothing here knows one is on
  // its way. Both type lists are read unconditionally (no hook behind `&&`).
  const registeredPreviewTypes = useRegisteredMetadataPreviewTypes();
  const registeredInspectorTypes = useRegisteredMetadataInspectorTypes();
  const designersUnregistered =
    registeredPreviewTypes.length === 0 && registeredInspectorTypes.length === 0;

  // Runtime enable/bound state per flow (GET /automation/_status). Persisted
  // `status` is intent; this is what's actually live in the engine — the truth
  // behind the rail's status dots. Refetched after a publish (publishNonce);
  // degrades silently on an older backend / offline (dots just don't render).
  const [flowStatus, setFlowStatus] = React.useState<Record<string, FlowRailState>>({});
  // objectui#11779 — whether `flowStatus` holds an answer from the engine. With
  // one, a flow the map has no row for is a flow the engine does not have
  // (nothing of it is deployed); without one, there is nothing to say about any
  // flow's live state, and the header reads the draft's own switch instead.
  const [flowStatusRead, setFlowStatusRead] = React.useState(false);
  // objectui#12349 — the engine's registration verdict per flow, from the flow
  // list's `registrations` (served beside the items, keyed by name). A flow
  // with no entry is one no engine judged, which reads as before.
  const [flowRegistrations, setFlowRegistrations] = React.useState<Record<string, FlowRegistration>>({});
  // objectui#12454 — the rail groups flows by the object each is about and
  // marks each with its trigger kind, both read off the flow's definition as
  // served (`flowGrouping.ts`), with the scope's objects naming the groups.
  const [flowDefinitions, setFlowDefinitions] = React.useState<ReadonlyMap<string, unknown>>(() => new Map());
  const [objectLabels, setObjectLabels] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  // Which groups the author folded. Ephemeral (AGENTS.md #8), as the search is.
  const [foldedGroups, setFoldedGroups] = React.useState<ReadonlySet<string>>(() => new Set());
  // objectui#12454 — the tab the item header's tab row has open over the flow,
  // and the problem tally its Problems tab carries (reported by the preview).
  const [flowSection, setFlowSection] = React.useState<FlowPreviewSection>('canvas');
  const [problemTally, setProblemTally] = React.useState<FlowProblemTally>({ count: 0, errors: 0 });
  // ADR-0146 D4 — bumped after a ledger toggle the server accepted: its answer
  // carries the flag alone, and the flip can move what the engine armed.
  const [statusNonce, setStatusNonce] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/automation/_status', { credentials: 'include', headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const payload = (await res.json().catch(() => null)) as { data?: { flows?: FlowRuntimeState[] }; flows?: FlowRuntimeState[] } | null;
        const list = payload?.data?.flows ?? payload?.flows ?? [];
        if (cancelled || !Array.isArray(list)) return;
        const map: Record<string, FlowRailState> = {};
        for (const s of list) if (s?.name) map[s.name] = flowRailState(s);
        setFlowStatus(map);
        setFlowStatusRead(true);
      } catch {
        /* offline / older backend → no dots */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publishNonce, statusNonce]);

  // #27356 row 19 — a delete re-reads the rail (`flowListNonce`) and leaves
  // the pillar on its empty state: that one re-read opens no other flow.
  const [flowListNonce, setFlowListNonce] = React.useState(0);
  const keepEmptyAfterDeleteRef = React.useRef(false);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Published flows ∪ pending DRAFT flows — `list()` only sees
        // published/active metadata, so a just-authored flow that hasn't been
        // published yet (or a fresh writable-base package whose flows are all
        // drafts) would render an empty rail even though "Changes · N" shows the
        // draft exists. Mirrors the Data / Interfaces / Access pillars, which all
        // merge their drafts. Keyed on `publishNonce` too so drafts that go live
        // collapse back into the published rail after a package publish.
        // objectui#11862 — a draft-only flow reads as the label its `_drafts`
        // row carries, resolved in the designer locale.
        const packageId = railPackageId;
        // objectstack#28572 — on a read-only base with a pair, the pair's
        // flows too: the ones the base's list does not hold are the flows the
        // pair adds, grouped and dotted from the pair's own reads. A failed
        // pair read lists none of them.
        const pairId = railPairId;
        const readPair = async () =>
          pairId === null
            ? null
            : Promise.all([
                loadPackageSurfaces(client, 'flow', pairId, locale),
                readFlowRegistrations(client, pairId),
                readFlowDefinitions(client, pairId),
                readObjectLabels(client, pairId, locale),
              ]);
        const [baseItems, registrations, definitions, objects, pair] = await Promise.all([
          packageId === null
            ? loadPackageLessSurfaces(client, 'flow', locale)
            : loadPackageSurfaces(client, 'flow', packageId, locale),
          readFlowRegistrations(client, packageId),
          readFlowDefinitions(client, packageId),
          readObjectLabels(client, packageId, locale),
          readPair().catch(() => null),
        ]);
        if (cancelled) return;
        const items: Surface[] = withPairItems<Surface>(baseItems, pair?.[0] ?? [], pairId);
        setFlows(items);
        setFlowRegistrations(pair ? { ...pair[1], ...registrations } : registrations);
        setFlowDefinitions(pair ? new Map([...pair[2], ...definitions]) : definitions);
        setObjectLabels(pair ? new Map([...pair[3], ...objects]) : objects);
        const deepLinked = resolveSurfaceDeepLink(items, initialSurface, 'flow');
        // objectui#11553 — a deep link that NAMES a flow this rail does not
        // hold opens no other flow in its place: the first flow under the name
        // of the one asked for is how the clone's link "redirected to another
        // flow". A package-less flow named from a package's pillar is found in
        // the package-less scope and opened there, once per mount.
        const named = initialSurface?.type === 'flow' ? initialSurface.name : null;
        if (named && !deepLinked && packageId !== null && !deepLinkProbedRef.current) {
          deepLinkProbedRef.current = true;
          const packageLess = await loadPackageLessSurfaces(client, 'flow', locale).catch(() => []);
          if (cancelled) return;
          if (packageLess.some((f) => f.name === named)) {
            navigate(studioOrgScopePath({ type: 'flow', name: named }), { replace: true });
            return;
          }
        }
        const keepEmpty = keepEmptyAfterDeleteRef.current;
        keepEmptyAfterDeleteRef.current = false;
        // objectstack#28567 — a copy "New similar" saved in this package opens.
        const copied = openAfterListRef.current;
        openAfterListRef.current = null;
        const copiedFlow = copied ? items.find((f) => f.name === copied) : undefined;
        if (copiedFlow) {
          setCurrent(copiedFlow);
          return;
        }
        setCurrent((c) => (keepEmpty ? c : (c ?? deepLinked ?? (named ? null : items[0]) ?? null)));
      } catch (e) {
        if (!cancelled) setError(plainRefusal(e));
      } finally {
        if (!cancelled) setListed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, railPackageId, railPairId, publishNonce, metadataRefreshNonce, locale, flowListNonce]);

  const doCreateFlow = React.useCallback(
    async (label: string, name: string, trigger: NewFlowTrigger | null) => {
      setCreateBusy(true);
      setError(null);
      setCreateTaken(null);
      try {
        // A name a flow already holds, published or as a draft, in this
        // package or any other, is refused here and nothing is written: over
        // a published flow the first-write pin below would write this blank
        // skeleton as its pending draft (`findTakenIdentifier`).
        const taken = await findTakenIdentifier(client, 'flow', name, locale);
        if (taken) {
          setCreateTaken({ ...taken, here: flows.some((f) => f.name === name) });
          return;
        }
        // Minimal valid, autolaunched skeleton: start → end. The designer fills in
        // the trigger + nodes; publishing it is a separate, user-initiated step.
        //
        // objectui#11779 — and it is born switched OFF, as the bar above the
        // rail promises ("Off by default · review before enabling"). With no
        // `status` the spec's default is `draft`, which the engine arms like
        // `active`: the switch read "Enabled" on a flow nobody had reviewed, and
        // a package publish armed it as soon as it had a trigger. `obsolete` is
        // what the switch itself writes for Off; enabling it is the author's
        // own flip.
        const skeleton = withStartTrigger(
          {
            ...buildFlowSkeleton(
              name,
              label,
              t('engine.studio.auto.nodeStart', locale),
              t('engine.studio.auto.nodeEnd', locale),
            ),
            status: 'obsolete',
          },
          trigger,
        );
        // objectstack#28572 (ADR-0146 D3) — on a read-only base the flow is
        // created in its pair, which the ensure door answers (creating it on
        // first use, without a prompt).
        const target = packageReadOnly && customization ? (await customization.ensurePackage()).packageId : null;
        // objectui#11773 — and the door refuses a draft row too (the
        // first-write pin), for one that lands between the check above and
        // this save.
        await client.save('flow', name, skeleton, {
          mode: 'draft',
          packageId: target ?? railPackageId ?? undefined,
          ifNoneMatch: '*',
          surface: 'studio',
        });
        const item: Surface = target === null ? { type: 'flow', name, label } : { type: 'flow', name, label, addedIn: target };
        setFlows((fs) => [...fs.filter((f) => f.name !== name), item]);
        // objectstack#28572 — the rail reads again after the save, so the
        // pair's list it reads holds the new flow.
        if (target !== null) setFlowListNonce((n) => n + 1);
        // objectui#12454 — and groups by what it was born with.
        setFlowDefinitions((m) => new Map([...m, [name, skeleton]]));
        setCurrent(item);
        setHasDraft(true);
        setCreating(false);
        onDraftSaved?.();
        toast.success(tFormat('engine.studio.auto.savedDraft', locale, { label }));
      } catch (e) {
        // Shown in the create dialog, which prints the message only: kept whole.
        setError(plainRefusal(e));
      } finally {
        setCreateBusy(false);
      }
    },
    [client, railPackageId, packageReadOnly, customization, onDraftSaved, locale, flows],
  );

  React.useEffect(() => {
    if (!current) return;
    let cancelled = false;
    // objectui#11331 — whether this run's load has settled (see the cleanup).
    let settled = false;
    setLoading(true);
    setError(null);
    setSelection(null);
    (async () => {
      try {
        // objectui#11773 — read at the address the flow saves write, so the
        // version it serves pins the first of them. objectstack#28570 — a
        // read-only base's flow: its pair, when one is listed.
        const pair = flowCustomizing && !current.addedIn ? (customizationRef.current?.pairId ?? null) : null;
        const readAt = pair ?? draftPackageId;
        const draftRead = await readDraftForSave<Record<string, unknown>>(client, 'flow', current.name, readAt);
        if (cancelled) return;
        // objectstack#29148 — a flow draft the server refused to read is no
        // absence: no buffer is installed over it (see InterfacesPillar's leaf
        // load), so nothing is shown to edit and the autosave has nothing to send.
        if ('refused' in draftRead) {
          setDraftFor('');
          setError({
            message: t('engine.studio.refusal.draftUnreadable', locale),
            detail: formatMetadataError(draftRead.refused),
          });
          return;
        }
        const draftBody = extractDraftBody(draftRead.answer);
        // objectui#11799 — the baseline is read only for a flow with no
        // pending draft, the one case it is used. An unsaved flow always has
        // one, so it never asks `/layers`, which answers 404 for it.
        // ADR-0048 — at the package the flow saves write, its owner here; with
        // none, the read names none, and a name two packages hold is refused
        // with the server's own sentence, shown as the load's error.
        const layRaw = draftBody
          ? null
          : await client.layered<Record<string, unknown>>(
              'flow',
              current.name,
              draftPackageId ? { packageId: draftPackageId } : {},
            );
        if (cancelled) return;
        const lay = layRaw as { effective?: Record<string, unknown>; code?: Record<string, unknown> } | null;
        const baseline = (lay?.effective ?? lay?.code ?? {}) as Record<string, unknown>;
        // Served draft as-is, baseline only without one (objectui#10765).
        setDraft(draftBody ?? baseline);
        setDraftFor(`flow:${current.name}`);
        flowVerdictSeq.current += 1;
        setFlowVerdict(
          editedItemDiagnostics({
            hasDraft: !!draftBody,
            draftDiagnostics: draftEnvelopeDiagnostics(draftRead.answer),
            layered: layRaw,
          }),
        );
        // objectui#11773 — the next save is pinned to what the draft read served.
        recordFlowRead('flow', current.name, readAt, draftRead.pin);
        flowReadAtRef.current = { key: `flow:${current.name}`, at: readAt };
        setHasDraft(!!draftBody);
      } catch (e) {
        if (!cancelled) setError(plainRefusal(e));
      } finally {
        settled = true;
        if (!cancelled) {
          setLoading(false);
          setAutoDirty(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      // objectui#11331 — a load cancelled before it settled lowers the
      // `loading` it raised, as in InterfacesPillar's draft load.
      if (!settled) setLoading(false);
    };
  }, [client, current, draftPackageId, publishNonce, flowReloadNonce, recordFlowRead, flowCustomizing]);

  // objectui#5813 — local dirty flag: auto-save arms only after a real edit.
  const [autoDirty, setAutoDirty] = React.useState(false);
  const onPatch = React.useCallback(
    (patch: Record<string, unknown>) => {
      setDraft((d) => ({ ...d, ...patch }));
      setAutoDirty(true);
    },
    [],
  );
  const doSave = React.useCallback(async (sent: DraftSend) => {
    if (!current) return;
    setSaving('draft');
    setError(null);
    try {
      // objectstack#28570 — a read-only base's flow is saved into the pair the
      // ensure door answers, under its own name, declaring the override. A
      // refused door is shown as it was sent, and nothing is saved.
      const custom = readOnly ? customizationRef.current : null;
      let target: { packageId: string | undefined; body: Record<string, unknown> } = { packageId: draftPackageId, body: draft };
      let entering = false;
      if (custom) {
        let pair: string;
        try {
          pair = await pairForFlow(custom, current.name);
        } catch (e) {
          setError(plainRefusal(e));
          return;
        }
        const declared = overrideDraftBody(draft, custom.base, custom.basedOn);
        if (declared === null) {
          setError({ message: tFormat('engine.studio.customize.noVersion', locale, { package: custom.baseLabel }) });
          return;
        }
        // The buffer was read at another package (the base, before its pair
        // was listed): the pair is taken to hold no draft of the flow, so a
        // draft there is a conflict the author is asked about, never one this
        // save overwrites. Its receipt pins the saves after it.
        const key = `flow:${current.name}`;
        if (!(flowReadAtRef.current?.key === key && flowReadAtRef.current.at === pair)) {
          recordFlowRead('flow', current.name, pair, { ifNoneMatch: '*' });
          flowReadAtRef.current = { key, at: pair };
        }
        entering = !flowInPairRef.current;
        target = { packageId: pair, body: declared };
      }
      const outcome = await saveFlowDraft('flow', current.name, target.body, {
        mode: 'draft',
        packageId: target.packageId,
        surface: 'studio',
      });
      // objectui#11773 — the author chose the saved version; the load replaces the buffer.
      if (outcome === 'reloaded') return;
      // The badge reads the declaration the server now serves.
      if (entering) setServedNonce((n) => n + 1);
      setHasDraft(true);
      // objectstack#26858 — the stored draft carries its own verdict now.
      rereadFlowVerdict(current.name, target.packageId);
      // objectui#11204 — clean only if nothing was edited while it was in flight.
      if (sent.unmoved()) setAutoDirty(false);
      // objectstack#28984 — named as the rail names the flow.
      announceDraftSaved({ type: 'flow', name: current.name }, current.label, locale);
      onDraftSaved?.({ type: 'flow', name: current.name });
    } catch (e) {
      // objectui#11785 — read against `draft`, the body this save sent.
      setError(flowSaveRefusal(e, draft, locale));
    } finally {
      setSaving(false);
    }
  }, [saveFlowDraft, current, draft, draftPackageId, onDraftSaved, locale, rereadFlowVerdict, readOnly, pairForFlow, recordFlowRead]);
  // objectui#11786 — an edit that leaves a step's required input out (a step
  // just added, before it is filled in) is held, not sent: the server would
  // refuse the flow with a 422 naming that input. The step's inspector hints the
  // input, and the line below names it. Asked of the spec's own flow judges
  // (`specRequiresField`) over the inputs each step's inspector offers.
  const flowIncomplete = React.useMemo(
    () => (autoDirty ? flowHeldEdit(draft, locale) : null),
    [autoDirty, draft, locale],
  );
  const { sending: sendingFlowDraft, loaded: flowLoaded } = useDraftAutoSave({
    // objectui#11232 — the flow `doSave` addresses.
    target: `flow:${current?.name ?? ''}`,
    loadedFor: draftFor,
    dirty: autoDirty,
    blocked: !current || !isEditable || !!saving || editLocked || restoring || flowIncomplete !== null,
    snapshot: draft,
    save: doSave,
  });
  // Only the open flow's own buffer is held (objectui#11272).
  const flowHeld = flowLoaded ? flowIncomplete : null;
  useHeldEditReport(onHeldEditChange, flowHeld?.clause ?? null);
  // objectui#12725 — the header's draft line reads the badge's ledger.
  const flowDraftStatus = useStudioItemDraftStatus(
    current ? { type: 'flow', name: current.name } : null,
    hasDraft && flowLoaded,
    locale,
  );

  // Enable/disable persists via the flow's deployment `status` (active = on,
  // obsolete = off) — the engine honors it on the next publish. The switch flips
  // it and saves the draft immediately; the change goes live when the package is
  // published (so "review before enabling" is preserved).
  const flowEnabled = draft.status !== 'obsolete' && draft.status !== 'invalid';
  // The flow the draft on screen belongs to — read by the toggle's rollback
  // below, so a refusal that lands after the author opened another flow never
  // rewrites that other flow's draft.
  const draftFlowRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    draftFlowRef.current = current?.name ?? null;
  }, [current]);
  const toggleEnabled = React.useCallback(async () => {
    // Guarded in addition to being disabled (objectui#11124): a read-only
    // package refuses the draft save, so the flip would only be rolled back.
    if (!current || readOnly) return;
    const flowName = current.name;
    const prevDraft = draft;
    const next = !(draft.status !== 'obsolete' && draft.status !== 'invalid');
    const nextStatus = next ? 'active' : 'obsolete';
    const nextDraft = { ...draft, status: nextStatus };
    // objectui#11272 — refused on a buffer that is not this flow's document
    // (its load is not in yet): the switch is not offered then either.
    if (!sendingFlowDraft(nextDraft)) return;
    setDraft(nextDraft);
    setSaving('draft');
    setError(null);
    try {
      // objectui#11773 — a reload replaced the buffer the flip was taken on.
      if ((await saveFlowDraft('flow', flowName, nextDraft, { mode: 'draft', packageId: draftPackageId, surface: 'studio' })) === 'reloaded') return;
      setHasDraft(true);
      rereadFlowVerdict(flowName, draftPackageId);
      onDraftSaved?.({ type: 'flow', name: flowName });
      toast.success(next ? t('engine.studio.auto.enabledToast', locale) : t('engine.studio.auto.disabledToast', locale));
    } catch (e) {
      // objectui#11124 — the save was refused, so roll the optimistic flip
      // back: the switch and the canvas status (both read `draft.status`) must
      // never show a status the server refused. Only `status` is put back, so
      // an edit made while the save was in flight survives; and only on the
      // same flow, still holding the refused status.
      setDraft((d) => {
        if (draftFlowRef.current !== flowName || d.status !== nextStatus) return d;
        const { status: _refused, ...rest } = d;
        return 'status' in prevDraft ? { ...rest, status: prevDraft.status } : rest;
      });
      setError(flowSaveRefusal(e, nextDraft, locale));
    } finally {
      setSaving(false);
    }
  }, [saveFlowDraft, current, draft, draftPackageId, onDraftSaved, locale, readOnly, sendingFlowDraft, rereadFlowVerdict]);

  // The rail's "+" — and the empty block's button, which runs this same
  // handler (objectui#12514). objectui#11553 — no "New" in the package-less
  // scope: new authoring stays package-first, and this scope reaches flows
  // that already exist without a package.
  const openCreateFlow =
    (!packageReadOnly || newInPair) && railPackageId !== null
      ? () => {
          // objectstack#26845 — the created flow opens at once, and its load
          // replaces the buffer a held step lives in: asked before the dialog
          // opens, so Cancel costs nothing and the create itself asks nothing.
          if (!confirmDropUnsavedWork(flowHeld !== null, locale)) return;
          setError(null);
          setNewTrigger('');
          setNewTriggerObject('');
          setNewChoice(FLOW_PRESETS[0]);
          setNewNeeds(null);
          setCreateTaken(null);
          setCreating(true);
        }
      : undefined;
  // #27356 row 19 — Delete flow (`FlowItemMoreMenu`): the autosave disarmed,
  // the draft (so none is left to publish the flow back) and then the flow
  // deleted at the drafts' package, then the empty state over a re-read rail.
  // A refusal shows the door's sentence and keeps the flow open.
  const deleteOpenFlow = React.useCallback(async () => {
    if (!current || packageId === null) return;
    const flow = current;
    setAutoDirty(false);
    setError(null);
    try {
      if (hasDraft) {
        await client.reset('flow', flow.name, { state: 'draft', packageId });
        setHasDraft(false);
      }
      await client.reset('flow', flow.name, { packageId });
    } catch (e) {
      setError(plainRefusal(e));
      return;
    }
    keepEmptyAfterDeleteRef.current = true;
    setCurrent(null);
    setFlows((fs) => fs.filter((f) => f.name !== flow.name));
    setFlowListNonce((n) => n + 1);
    onDraftSaved?.({ type: 'flow', name: flow.name });
    toast.success(tFormat('engine.studio.auto.flowDeleted', locale, { item: flow.label || flow.name }));
  }, [client, current, packageId, hasDraft, onDraftSaved, locale]);
  // objectstack#28570 (ADR-0146 D2) — "Restore package original" on a flow
  // the pair overrides: the pair's draft of the flow, then its row, deleted
  // at the pair. The pair is the door's answer this flow's saves named, else
  // the surface's; never asked of the door again. The base's flow reads back
  // and runs again under the same ledger row, and the server's refusal is
  // shown as it is sent.
  const restoreFlow = React.useCallback(async () => {
    const custom = customizationRef.current;
    if (!current || !custom) return;
    const flow = current;
    const held = pairsByFlowRef.current.get(flow.name);
    const pair = (held ? await held.catch(() => null) : null) ?? custom.pairId;
    if (!pair) return;
    setRestoring(true);
    setAutoDirty(false);
    setError(null);
    try {
      await client.reset('flow', flow.name, { state: 'draft', packageId: pair });
      await client.reset('flow', flow.name, { packageId: pair });
    } catch (e) {
      setError(plainRefusal(e));
      return;
    } finally {
      setRestoring(false);
    }
    pairsByFlowRef.current.delete(flow.name);
    setCustomizeAsked((prev) => {
      if (!prev.has(flow.name)) return prev;
      const next = new Set(prev);
      next.delete(flow.name);
      return next;
    });
    reloadFlowDraft();
    setServedNonce((n) => n + 1);
    // The base's flow is armed again: the engine's rows are read again.
    setStatusNonce((n) => n + 1);
    emitMetadataRefresh();
    onDraftSaved?.({ type: 'flow', name: flow.name });
    toast.success(
      tFormat('engine.studio.customize.restoreDone', locale, { item: flow.label || flow.name, package: custom.baseLabel }),
    );
  }, [client, current, reloadFlowDraft, onDraftSaved, locale]);
  // objectstack#28567 (ADR-0146 D4) — "New similar" saved a copy. It opens
  // only where the door's answer says it landed: in this pillar after a
  // re-read when that is this package, else that package's Automations pillar
  // on the copy (a read-only base's pair, `<base>.custom`). An answer naming
  // no package opens nothing and says so; the landing is never derived here.
  const onFlowCopied = React.useCallback(
    (copy: FlowCopied) => {
      setError(null);
      if (copy.packageId === null) {
        setFlowCopied({ kind: 'noPackage', name: copy.name, notice: copy.notice, noticeCode: copy.noticeCode });
        return;
      }
      const landed: FlowCopiedStrip = {
        kind: 'landed',
        name: copy.name,
        packageId: copy.packageId,
        notice: copy.notice,
        noticeCode: copy.noticeCode,
      };
      onDraftSaved?.({ type: 'flow', name: copy.name });
      // objectstack#28572 — the pair's flows are this surface's too.
      if (copy.packageId === railPackageId || (railPairId !== null && copy.packageId === railPairId)) {
        setFlowCopied(landed);
        openAfterListRef.current = copy.name;
        setFlowListNonce((n) => n + 1);
        return;
      }
      navigate(studioPillarItemPath(copy.packageId, 'automations', { type: 'flow', name: copy.name }), {
        state: { [FLOW_COPIED_ARRIVAL_STATE]: landed },
      });
    },
    [railPackageId, railPairId, navigate, onDraftSaved],
  );
  // A landing is shown on its copy; an answer that names no package, on any flow.
  const flowCopiedShown =
    flowCopied && (flowCopied.kind === 'noPackage' || flowCopied.name === current?.name) ? flowCopied : null;
  // ADR-0146 D4 — a read-only package's open flow offers the activation-ledger
  // switch (`FlowLedgerSwitch`). It reads the engine's `_status` row for the
  // flow, never the draft's `status`, in `activationReading`'s three readings,
  // the ones Setup › Packaged automation shows. With no row served there is
  // nothing to bind and the read-only definition switch stays as it was. The
  // door is pre-judged from the served posture facts; after any attempt the
  // server's refusal is shown as sent.
  const ledgerRow =
    readOnly && packageId !== null && current && flowStatusRead ? flowStatus[current.name] : undefined;
  const ledgerOn = ledgerRow?.enabled;
  const ledgerWalled = useFlowLedgerWalledReadOnly();
  const ledgerWalledReason = ledgerWalled ? t('engine.studio.auto.ledger.walled', locale) : undefined;
  const [ledgerBusy, setLedgerBusy] = React.useState(false);
  const toggleLedger = React.useCallback(async () => {
    if (!current || ledgerOn === undefined || ledgerWalled) return;
    const flow = current;
    setError(null);
    setLedgerBusy(true);
    // Never throws: a failed request comes back as an outcome.
    const outcome = await requestFlowToggle(flow.name, !ledgerOn, {
      http: (status) => tFormat('engine.studio.auto.ledger.toggleFailedHttp', locale, { status }),
      network: t('engine.studio.auto.ledger.toggleFailed', locale),
    });
    setLedgerBusy(false);
    // VERBATIM: the posture gate's 403 names the sanctioned path, the subflow
    // guard's 409 names the callers that would break.
    if (!outcome.ok) {
      setError({ message: outcome.message });
      return;
    }
    const enabled = outcome.enabled;
    setFlowStatus((m) => (m[flow.name] ? { ...m, [flow.name]: { ...m[flow.name], enabled } } : m));
    setStatusNonce((n) => n + 1);
    toast.success(
      tFormat(enabled ? 'engine.studio.auto.ledger.switchedOn' : 'engine.studio.auto.ledger.switchedOff', locale, {
        label: flow.label || flow.name,
      }),
    );
  }, [current, ledgerOn, ledgerWalled, locale]);
  // objectstack#26917 — the refusal's way out: the flow holding the identifier
  // is on this rail, so it opens instead of a second one being made. The New
  // button already asked about a held step (objectstack#26845).
  const openTakenFlow = (name: string) => {
    const flow = flows.find((f) => f.name === name);
    if (!flow) return;
    setCreating(false);
    setCreateTaken(null);
    setCurrent(flow);
  };
  // objectui#12514 — a listed package with no flow: one centered block in the
  // content column, and no aside while there is nothing to select.
  const flowsEmpty = listed && !error && flows.length === 0;

  // objectui#12725 — the surface's right slot hosts the Configuration
  // (`useStudioRightSlot`); `null` in the package-less scope and under an
  // injected `aiSlot`, where the aside beside the canvas (or, on a folded
  // row, the drawer over it) stays. Held while there is a flow to select, as
  // the aside is drawn. A selection asks for the properties, keyed on its
  // identity; Esc drops it (the canvas's own background press already does),
  // so the slot returns to the flow's Configuration.
  const slot = useStudioRightSlot();
  const inSlot = slot !== null;
  const claimSlotProps = slot?.claimProps;
  React.useEffect(
    () => (claimSlotProps && !flowsEmpty ? claimSlotProps() : undefined),
    [claimSlotProps, flowsEmpty],
  );
  const flowSelectionKey = selection ? `${selection.kind}:${selection.id}` : '';
  const showSlotProps = slot?.showProps;
  React.useEffect(() => {
    if (flowSelectionKey && showSlotProps) showSlotProps();
  }, [flowSelectionKey, showSlotProps]);
  React.useEffect(() => {
    if (!inSlot || !flowSelectionKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isSlotEscapeExempt(e.target)) return;
      setSelection(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inSlot, flowSelectionKey]);

  // The Configuration's body, in the aside beside the canvas or, on a folded
  // row, in the drawer over it (objectui#11795). objectstack#26730 — the ref
  // is where a refusal's "Show me" looks for the input it names.
  const configBodyRef = React.useRef<HTMLDivElement>(null);
  const focusConfigInput = useShowInputFocus(configBodyRef);
  const configBodyEl =
    selection && inspector && current && flowLoaded ? (
      // objectstack#26858 — the inspectors read the served verdict at their paths.
      <DraftVerdictContext.Provider value={flowVerdict}>
      <div ref={configBodyRef} className="contents">
        {React.createElement(inspector, {
          type: 'flow',
          name: current.name,
          draft,
          selection,
          onPatch,
          onClearSelection: () => setSelection(null),
          onSelectionChange: setSelection,
          // objectui#11124 — the pillar's real flag, threaded exactly as
          // the Data pillar threads it (objectui#2259). objectstack#28570 —
          // a customized flow's editors are open.
          readOnly: editLocked,
          readOnlyReason: editLocked ? t('engine.studio.pkg.readonlyHint', locale) : undefined,
          locale,
        })}
      </div>
      </DraftVerdictContext.Provider>
    ) : designersUnregistered ? (
      <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-xs text-muted-foreground">
        <Ban className="h-5 w-5" />
        {t('engine.studio.auto.designersMissing', locale)}
      </div>
    ) : !current ? null : (
      // objectui#12514 — the node prompt only where there are nodes to click.
      <div className="flex flex-col items-center gap-2 px-2 py-10 text-center text-xs text-muted-foreground">
        <MousePointer2 className="h-5 w-5" />
        {t('engine.studio.auto.emptyLine1', locale)}
        <br />
        {t('engine.studio.auto.emptyLine2', locale)}
      </div>
    );

  // objectui#12459 — the switch and the "off by default" sentence sit in the
  // item header's actions slot; the full-width band above the rail retires.
  // objectui#12454 — the sentence is the switch's own: the first line of its
  // title, and a visually hidden line right after it for a reader, instead of a
  // second line of header text. It is not wired as the switch's description:
  // that stays the read-only reason alone (objectui#12303, owned by #12453).
  // objectui#11272 — the switch reads and saves the open flow's own
  // document, so it waits for it: not offered over another's.
  const flowSwitchEl =
    current && flowLoaded && ledgerRow ? (
      <FlowLedgerSwitch
        checked={ledgerRow.enabled}
        reading={activationReading(ledgerRow)}
        notRunningReason={ledgerRow.reason}
        busy={ledgerBusy}
        walledReason={ledgerWalledReason}
        locale={locale}
        onToggle={() => void toggleLedger()}
      />
    ) : current && flowLoaded && flowCustomizable && (flowInPair || flowUnlocked)
      ? // objectstack#28570 (ADR-0146 D9 item 3) — a customized flow is
        // switched by the ledger row alone; no definition switch is drawn for
        // it, and Studio never writes its `status` to mean on or off.
        null
      : current && flowLoaded
      ? (() => {
          const defaultOff = t('engine.studio.auto.defaultOff', locale);
          // objectstack#27356 — a read-only package's switch cannot be flipped,
          // so it is not drawn like a live control: no green track and no
          // hover, and a lock beside the word. The thumb and the word still
          // say on or off, as the flow's status does.
          const track = readOnly
            ? flowEnabled
              ? 'bg-muted-foreground/60'
              : 'bg-muted-foreground/25'
            : flowEnabled
              ? 'bg-emerald-500'
              : 'bg-muted-foreground/40';
          // objectstack#29376 — while a save is in flight the switch is
          // `aria-disabled`, never `disabled`: a focused control that turns
          // `disabled` drops focus to the page, and nothing hands it back when
          // the save lands, so a keyboard author would tab back from the top
          // after every flip. The press is refused in the handler instead, so a
          // second Space sends no second save. A switch that cannot be flipped
          // at all (no canvas, or a read-only package) stays `disabled`.
          const inert = !isEditable || readOnly;
          const busy = !inert && !!saving;
          const toggle = (
            <button
              type="button"
              role="switch"
              aria-checked={flowEnabled}
              onClick={() => {
                if (!saving) void toggleEnabled();
              }}
              disabled={inert}
              aria-disabled={busy || undefined}
              aria-describedby={readOnly ? toggleReadOnlyReasonId : undefined}
              // A read-only package's reason is the wrapper's (objectui#12303),
              // not a `title` the disabled button can never show.
              title={
                readOnly
                  ? undefined
                  : `${defaultOff}\n${flowEnabled ? t('engine.studio.auto.disableTitle', locale) : t('engine.studio.auto.enableTitle', locale)}`
              }
              className={
                'inline-flex h-7 items-center gap-2 rounded-md px-1 text-[12px] ' +
                (readOnly
                  ? 'text-muted-foreground disabled:pointer-events-none'
                  : 'text-foreground hover:bg-muted disabled:opacity-50 aria-disabled:opacity-50')
              }
            >
              <span className={'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ' + track}>
                <span className={'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ' + (flowEnabled ? 'translate-x-[18px]' : 'translate-x-0.5')} />
              </span>
              {readOnly && <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />}
              {/* objectstack#29693 — on a narrow header the switch keeps its track; the word stays its name. */}
              <span data-studio-fold-label="" className={STUDIO_FOLD_LABEL}>
                {flowEnabled ? t('engine.studio.auto.enabled', locale) : t('engine.studio.auto.disabled', locale)}
              </span>
            </button>
          );
          const defaultOffLine = <span className="sr-only">{defaultOff}</span>;
          if (!readOnly)
            return (
              <>
                {toggle}
                {defaultOffLine}
              </>
            );
          return (
            <>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      aria-describedby={toggleReadOnlyReasonId}
                      data-disabled-reason=""
                      className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {toggle}
                      <span id={toggleReadOnlyReasonId} className="sr-only">
                        {t('engine.studio.pkg.readonlyHint', locale)}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('engine.studio.pkg.readonlyHint', locale)}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {defaultOffLine}
            </>
          );
        })()
      : null;

  // objectui#12454 — the open flow groups and reads by the draft on screen, so
  // an edit to its Start node moves its row as it moves the header's Trigger.
  const liveFlowDefinitions = React.useMemo(() => {
    if (!current || draftFor !== `flow:${current.name}`) return flowDefinitions;
    return new Map<string, unknown>([...flowDefinitions, [current.name, draft]]);
  }, [flowDefinitions, current, draftFor, draft]);
  const railGroups = React.useMemo(
    () =>
      groupFlowsByObject(flows, liveFlowDefinitions, objectLabels, {
        noObjectLabel: t('engine.studio.auto.group.noObject', locale),
        objectOrder,
        locale,
      }),
    [flows, liveFlowDefinitions, objectLabels, objectOrder, locale],
  );
  // objectstack#29786 — the flows other packages ship on the base's objects,
  // from the base's one customization read, each in its object's group.
  const customizationMarks = customization?.marks;
  const contributedFlows = React.useMemo(() => baseContributionsOf(customizationMarks), [customizationMarks]);
  const railGroupsShown = React.useMemo(
    () =>
      withContributedFlowGroups(railGroups, contributedFlows, (object) => ({
        key: object,
        objectName: object,
        label: objectLabels.get(object) || object,
        items: [] as Surface[],
      })),
    [railGroups, contributedFlows, objectLabels],
  );
  const openContributor = useOpenContributor();
  const contributedFlowShown = (f: ContributedOnObject) =>
    !onlyCustomized &&
    (!railNeedle || f.name.toLowerCase().includes(railNeedle) || f.packageName.toLowerCase().includes(railNeedle));

  // The legend under the rail: the four trigger glyphs and the dots. Off and
  // Refused are named only while some flow in the rail reads so.
  const railStatusKinds = new Set(
    flows.map((f) => flowRailStatus(flowStatus[f.name], flowRegistrations[f.name], locale)?.status.kind),
  );
  const legendDot = (kind: FlowRunStatus, words: string) => (
    <span key={kind.kind} className="inline-flex items-center gap-1">
      <span aria-hidden className={'h-1.5 w-1.5 rounded-full ' + flowDotClass(kind)} />
      {words}
    </span>
  );
  const railLegend =
    flows.length > 0 ? (
      <div
        role="note"
        aria-label={t('engine.studio.auto.legend', locale)}
        data-testid="auto-rail-legend"
        className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground"
      >
        {FLOW_TRIGGER_GLYPHS.map((glyph) => {
          const Glyph = FLOW_GLYPH_ICON[glyph];
          return (
            <span key={glyph} className="inline-flex items-center gap-1">
              <Glyph aria-hidden className="h-3 w-3" />
              {t(FLOW_GLYPH_LABEL_KEY[glyph], locale)}
            </span>
          );
        })}
        {legendDot({ kind: 'on' }, t('engine.studio.auto.on', locale))}
        {legendDot({ kind: 'not-running' }, t('engine.studio.auto.notRunning', locale))}
        {railStatusKinds.has('off') && legendDot({ kind: 'off' }, t('engine.studio.auto.off', locale))}
        {railStatusKinds.has('refused') && legendDot({ kind: 'refused', message: '' }, t('engine.studio.auto.refused', locale))}
      </div>
    ) : undefined;

  // objectui#12454 — the item header's meta and tab row over the open flow.
  // The Status the meta shows is the one the preview's Problems note reads
  // (objectui#11779): the runtime row while one is in, the draft otherwise.
  const flowOpen = !!current && flowLoaded && isEditable;
  // The engine keys run history by the flow's name, as the preview's Runs did.
  const flowHasRuns = typeof draft.name === 'string' && draft.name.length > 0;
  const section: FlowPreviewSection = flowSection === 'runs' && !flowHasRuns ? 'canvas' : flowSection;
  const headerRunStatus = current
    ? deriveFlowRunStatus(flowStatusRead ? (flowStatus[current.name] ?? null) : undefined, draft.status, flowRegistrations[current.name])
    : null;
  const flowTab = (
    key: FlowPreviewSection,
    label: string,
    extra?: { title?: string; badge?: React.ReactNode; describedBy?: string },
  ) => (
    <StudioTab
      key={key}
      active={section === key}
      onClick={() => setFlowSection(key)}
      title={extra?.title}
      aria-describedby={extra?.describedBy}
      data-testid={`auto-tab-${key}`}
    >
      {label}
      {extra?.badge}
    </StudioTab>
  );
  // objectui#12453 — with a flow open, the header row already holds the
  // flow's meta and its Enabled switch, and at the 1280 px design width the
  // link there truncated the flow's label; it sits at the tab row's right
  // end, the slot objectui#12456 gave the Access note for the same reason.
  const autoReadOnlyLinkEl =
    editLocked && packageId !== null ? (
      <StudioReadOnlyLink item={current} title={t('engine.studio.pkg.readonlyHint', locale)} locale={locale} />
    ) : null;
  /** The flow's ⋯ menu is drawn (objectstack#28567): the header folds into it (objectstack#29693). */
  const flowMoreShown = !!current && flowLoaded && packageId !== null;
  const flowTabsEl =
    flowOpen ? (
      <>
        {flowTab('canvas', t('engine.studio.if.tabCanvas', locale), {
          title: t('engine.studio.auto.canvasHint', locale),
          describedBy: canvasHintId,
        })}
        {flowTab('variables', t('engine.flowPreview.variables', locale))}
        {flowHasRuns && flowTab('runs', t('engine.flowPreview.runs', locale), { title: t('engine.flowPreview.runsTitle', locale) })}
        {flowTab('problems', t('engine.flowPreview.problems', locale), {
          title: t('engine.flowPreview.problemsTitle', locale),
          badge:
            problemTally.count > 0 ? (
              <span
                data-testid="auto-problems-count"
                className={
                  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[11px] font-semibold ' +
                  (problemTally.errors > 0
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300')
                }
              >
                {problemTally.count}
              </span>
            ) : undefined,
        })}
        {flowTab('debug', t('engine.flowPreview.debug', locale))}
        {autoReadOnlyLinkEl && <span className="ml-auto flex items-center self-center pl-3">{autoReadOnlyLinkEl}</span>}
      </>
    ) : undefined;

  return (
    <div className="flex h-full flex-col">
      {flowConflictDialog}
      {/* objectstack#28570 — Restore's confirmation, outside the menu that opens it. */}
      <StudioRestoreOriginalDialog
        open={restoreOpen && flowInPair}
        onOpenChange={setRestoreOpen}
        kind="flow"
        label={current ? current.label || current.name : ''}
        baseLabel={customizeBaseLabel}
        hasDraft={hasDraft && flowLoaded}
        locale={locale}
        onConfirm={() => void restoreFlow()}
      />
      <div ref={layoutRowRef} data-testid="auto-layout-row" className="relative flex min-h-0 flex-1">
        {isMobile && railOpen && (
          <div
            className="absolute inset-0 z-10 bg-black/30"
            onClick={() => setRailOpen(false)}
            aria-hidden="true"
          />
        )}
        <StudioRail
          testId="studio-rail-automations"
          heading={t('engine.studio.auto.heading', locale)}
          count={flows.length}
          onAdd={openCreateFlow}
          addLabel={t('engine.studio.auto.newTitle', locale)}
          addTestId="studio-rail-add"
          search={{
            value: railQuery,
            onChange: setRailQuery,
            placeholder: t('engine.studio.designer.search', locale),
            testId: 'auto-rail-search',
            matchCount: shownFlows.length,
          }}
          filters={
            <RailCustomizationFilter
              marks={railMarks}
              marked={markedFlows}
              on={onlyCustomized}
              onToggle={toggleOnlyCustomized}
              locale={locale}
            />
          }
          footer={railLegend}
          isMobile={isMobile}
          open={railOpen}
        >
          {/* objectui#12454 — grouped by the object each flow is about, in the
              order of the objects' labels, "No object" last; a search filters
              within the groups and shows every group that holds a match,
              folded or not. Each row: its trigger glyph, its label on one
              line (the row's title holds it whole, with its trigger kind and
              status words — the redesign trades objectui#11794's wrap for the
              32 px row), and its status dot. */}
          {railGroupsShown.map(({ group, contributed: contributedAll }) => {
            const items = railNeedle || onlyCustomized ? group.items.filter(flowShown) : group.items;
            const contributed = contributedAll.filter(contributedFlowShown);
            if (items.length === 0 && contributed.length === 0) return null;
            const groupKey = group.key || NO_OBJECT_GROUP_KEY;
            return (
              <StudioRailGroup
                key={groupKey}
                testId={`auto-rail-group-${group.key || 'none'}`}
                label={group.label}
                count={items.length + contributed.length}
                collapsed={!railNeedle && !onlyCustomized && foldedGroups.has(groupKey)}
                onToggle={() =>
                  setFoldedGroups((folded) => {
                    const next = new Set(folded);
                    if (!next.delete(groupKey)) next.add(groupKey);
                    return next;
                  })
                }
              >
                {items.map((f) => {
                  const active = current?.name === f.name;
                  const glyph = flowTriggerGlyph(liveFlowDefinitions.get(f.name));
                  const Glyph = FLOW_GLYPH_ICON[glyph];
                  const reading = flowRailStatus(flowStatus[f.name], flowRegistrations[f.name], locale);
                  return (
                    <StudioRailRow
                      key={f.name}
                      indent
                      active={active}
                      data-testid={`auto-rail-row-${f.name}`}
                      data-trigger={glyph}
                      title={[f.label, t(FLOW_GLYPH_LABEL_KEY[glyph], locale), reading?.view.label].filter(Boolean).join(' · ')}
                      onClick={() => {
                        // objectstack#26705 — another flow's load replaces the
                        // buffer the held step lives in; the open one keeps it.
                        if (!active && !confirmDropUnsavedWork(flowHeld !== null, locale)) return;
                        setCurrent(f);
                        if (isMobile) setRailOpen(false);
                      }}
                      icon={<Glyph aria-hidden className={'h-3.5 w-3.5 shrink-0' + (active ? '' : ' text-muted-foreground')} />}
                      trailing={
                        <>
                          <RailCustomizationMark row={f} marks={railMarks} locale={locale} />
                          <FlowStatusDot state={flowStatus[f.name]} registration={flowRegistrations[f.name]} locale={locale} />
                        </>
                      }
                    >
                      {f.label}
                    </StudioRailRow>
                  );
                })}
                {/* objectstack#29786 — the flows another package ships on this
                    object: greyed, with the package, opening it there. */}
                {contributed.map((f) => (
                  <ContributedRailRow
                    key={`${f.packageId}:${f.name}`}
                    item={f}
                    indent
                    icon={<Workflow aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                    title={contributedItemTitle(f, locale)}
                    onOpen={() =>
                      openContributor(studioPillarItemPath(f.packageId, 'automations', { type: 'flow', name: f.name }))
                    }
                    locale={locale}
                  />
                ))}
              </StudioRailGroup>
            );
          })}
          {flows.length === 0 && (contributedFlows?.flows.length ?? 0) === 0 && !creating && (error || !listed || openCreateFlow) && (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">
              {error
                ? t('engine.studio.loadFailed', locale)
                : !listed
                  ? t('engine.studio.loading', locale)
                  : t('engine.studio.auto.none', locale)}
            </p>
          )}
        </StudioRail>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* objectui#11665 — the header names the open flow by its LABEL,
              the string its rail row prints, never by `flow · NAME`: the
              metadata type word was developer vocabulary inside the
              author's own copy (objectui#11659 ruling 6). The API name
              moves to the tooltip for the authors who need it, as the
              Interfaces caption keeps its internal id (objectui#7254). A
              label that resolves to nothing falls back to the name. */}
          <StudioItemHeader
            testId="auto-flow-header"
            // objectstack#29693 — the chips and the item tools fold into the
            // flow's ⋯ menu (or the header's own, where the flow has none).
            foldMenu={
              flowMoreShown ? 'pillar' : { label: t('engine.studio.if.more', locale), testId: 'auto-flow-header-more' }
            }
            // objectstack#29691 (ADR-0146 D3) — a flow the pair adds, overrides
            // or is unlocked to customize saves to the base's pair.
            note={
              customization !== null && (!!current?.addedIn || flowInPair || flowUnlocked) ? (
                <SavedToCustomizationNote baseLabel={customizeBaseLabel} pairId={customizeNotePair} testId="auto-flow-saved-to" />
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
            icon={current ? Workflow : undefined}
            title={current ? current.label || current.name : t('engine.studio.auto.heading', locale)}
            titleProps={
              current
                ? { 'data-testid': 'auto-canvas-caption', title: `${t('designer.field.apiName', locale)}: ${current.name}` }
                : { className: 'text-[13px] font-normal text-muted-foreground' }
            }
            // objectui#12454 — the open flow's Trigger, Status, Run as and
            // version, as the designer's info bar reads them. The canvas hint
            // the row printed stays in it for a reader (visually hidden; the
            // Canvas tab's description and title), so the row still reads it
            // whole as objectui#11665 pins. Without designers the line says
            // so, and yields to the label on a narrow row as it did.
            meta={
              isEditable ? (
                <>
                  <span id={canvasHintId} className="sr-only">
                    {t('engine.studio.auto.canvasHint', locale)}
                  </span>
                  {flowOpen && headerRunStatus && (
                    <span data-testid="auto-flow-meta" className="inline-flex min-w-0">
                      <FlowMetaPills draft={draft} runStatus={headerRunStatus} locale={locale} variant="header" />
                    </span>
                  )}
                </>
              ) : (
                <span className="hidden 2xl:inline">{t('engine.studio.auto.designersMissing', locale)}</span>
              )
            }
            chips={
              current?.addedIn ? (
                <StudioPairItemChip pairId={current.addedIn} locale={locale} />
              ) : flowCustomizable && flowServed.declaration ? (
                // objectstack#28570 — the override the server serves, never a computation.
                <StudioOverrideChip
                  baseLabel={customizeBaseLabel}
                  basedOn={flowServed.declaration.basedOn}
                  locale={locale}
                  // objectstack#29692 — Restore lives on the mark that names the customization.
                  onRestore={flowInPair ? () => setRestoreOpen(true) : undefined}
                  restoreDisabled={restoring || !!saving}
                />
              ) : undefined
            }
            status={flowDraftStatus}
            actions={
              <>
                {/* objectui#5813 — drafts auto-save; the spinner is the affordance. */}
                {saving === 'draft' && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="auto-autosaving">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('engine.studio.autoSaving', locale)}
                  </span>
                )}
                {/* objectstack#28570 — Customize unlocks the flow's editors; nothing is saved until an edit. */}
                {current && flowLoaded && flowCustomizable && !flowUnlocked && !flowInPair && (
                  <StudioCustomizeButton
                    block={customizeBlock}
                    baseLabel={customizeBaseLabel}
                    locale={locale}
                    onCustomize={() =>
                      setCustomizeAsked((prev) => (prev.has(current.name) ? prev : new Set(prev).add(current.name)))
                    }
                  />
                )}
                {flowSwitchEl}
                {/* objectstack#28239 — the item tools Setup's item page opens. */}
                {current && flowLoaded && (
                  <StudioItemTools
                    type="flow"
                    name={current.name}
                    packageId={packageId}
                    readOnly={readOnly}
                    source={{
                      value: draft,
                      onChange: isEditable
                        ? (next) => {
                            setDraft(next);
                            setAutoDirty(true);
                          }
                        : undefined,
                    }}
                    onRolledBack={() => setFlowReloadNonce((n) => n + 1)}
                    locale={locale}
                  />
                )}
                {!flowTabsEl && autoReadOnlyLinkEl}
                {/* objectstack#28567 — New similar on a read-only package's
                    flow and on a writable one's (the door picks the pair for
                    a read-only base; a writable package is the target);
                    Delete on a writable package's flow only. The
                    package-less scope has no pair and no package to name. */}
                {flowMoreShown && current && (
                  <FlowItemMoreMenu
                    name={current.name}
                    label={current.label}
                    locale={locale}
                    disabled={!!saving}
                    onDelete={readOnly ? undefined : () => void deleteOpenFlow()}
                    newSimilar={{
                      target: readOnly ? undefined : packageId,
                      blocked: canAuthorFlows ? null : t('engine.edit.capabilityReadOnly', locale),
                      // The copy opens in place of this flow, which drops a
                      // held edit; asked before the dialog, as New is.
                      confirmOpen: () => confirmDropUnsavedWork(flowHeld !== null, locale),
                      onCopied: onFlowCopied,
                    }}
                  />
                )}
              </>
            }
            tabs={flowTabsEl}
          />
          {/* objectui#12454 — the body is the flow, flush under the tab row:
              no padded band and no bordered card around the canvas. A refusal
              or a held edit sits above it, inside the column's gutter. */}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {flowCopiedShown && (
              <div className="shrink-0 px-6 pt-3">
                <div
                  role={flowCopiedShown.kind === 'landed' ? 'status' : 'alert'}
                  data-testid="auto-new-similar-strip"
                  className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p>
                      {flowCopiedShown.kind === 'landed'
                        ? tFormat('engine.studio.auto.newSimilar.done', locale, {
                            name: flowCopiedShown.name,
                            package: flowCopiedShown.packageId,
                          })
                        : tFormat('engine.studio.auto.newSimilar.noPackage', locale, { name: flowCopiedShown.name })}
                    </p>
                    {/* The door's sentence that the copy is switched off: in the console's
                        language for its known code (objectstack#29727), else VERBATIM. */}
                    {flowCopiedShown.notice && (
                      <p data-testid="auto-new-similar-notice">{flowCloneNoticeText(flowCopiedShown, locale)}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFlowCopied(null)}
                    className="shrink-0 rounded-md px-1.5 text-[12px] hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  >
                    {t('engine.studio.auto.newSimilar.dismiss', locale)}
                  </button>
                </div>
              </div>
            )}
            {(error || flowHeld) && (
              <div className="shrink-0 space-y-2 px-6 pb-1 pt-3">
                {error && (
                  <StudioRefusalStrip
                    refusal={error}
                    locale={locale}
                    // objectui#11785 — "Show me" selects the named step, which opens
                    // its inspector in the right rail, and (objectstack#26730)
                    // focuses the input the sentence names.
                    onShow={(target, input) => {
                      if (!target) return;
                      setSelection({ kind: target.kind, id: target.id });
                      focusConfigInput(input);
                    }}
                    className="shrink-0 px-3 py-2 text-xs"
                  />
                )}
                {flowHeld && (
                  <StudioHeldNotice
                    held={flowHeld}
                    locale={locale}
                    // objectui#11786 — no "Show me" while that step is the one open.
                    onShow={
                      selection?.kind === flowHeld.target.kind && selection.id === flowHeld.target.id
                        ? undefined
                        : (target) => setSelection({ kind: target.kind, id: target.id })
                    }
                    className="shrink-0 px-3 py-2 text-xs"
                  />
                )}
              </div>
            )}
            {/* `flex-1 min-h-0` so the canvas fills the pillar's full remaining
              * height instead of shrinking to FlowCanvas's intrinsic content height. */}
            <div className="min-h-0 flex-1">
              {!current ? (
                missingFlow ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    {/* objectui#11553 — a deep link that named a flow this rail
                        does not hold says so, instead of opening another. */}
                    {tFormat('engine.studio.auto.deepLinkMissing', locale, { name: missingFlow })}
                  </div>
                ) : flowsEmpty ? (
                  <div className="flex h-full">
                    <StudioEmptyState
                      testId="auto-empty"
                      icon={Workflow}
                      sentence={t(packageId === null ? 'engine.studio.org.none' : 'engine.studio.auto.emptyMain', locale)}
                      action={
                        packageId === null ? (
                          // objectui#12513 — the package-less scope creates
                          // nothing, and since ADR-0146 D11 no Setup page
                          // copies into it: the sentence says so, with no
                          // link out of Studio.
                          undefined
                        ) : (
                          openCreateFlow && (
                            <StudioEmptyStateAction
                              data-testid="auto-empty-new"
                              label={t('engine.studio.auto.newTitle', locale)}
                              onClick={openCreateFlow}
                            />
                          )
                        )
                      }
                    />
                  </div>
                ) : null
              ) : loading || !flowLoaded ? (
                // objectui#11272 — nothing of another flow's buffer under this
                // one; after a failed load, the error above says why.
                error && !loading ? null : (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t('engine.studio.loading', locale)}
                  </div>
                )
              ) : Preview ? (
                // objectui#11779 — the open flow's runtime row, so the flow
                // header and its Problems panel read the run status this rail
                // reads: the row, `null` when the engine has none for this flow,
                // nothing while no runtime answer is in.
                <FlowRuntimeContext.Provider value={flowStatusRead ? (flowStatus[current.name] ?? null) : undefined}>
                  {/* objectui#12349 — and the engine's verdict on it, when the list served one. */}
                  <FlowRegistrationContext.Provider value={flowRegistrations[current.name]}>
                    {/* objectui#12454 — the header holds the meta and the tabs, so the
                        preview shows the open tab's section and draws no bar of its own. */}
                    <FlowPreviewChromeProvider
                      value={{ section, onSectionChange: setFlowSection, onProblemsChange: setProblemTally }}
                    >
                      {React.createElement(Preview, {
                        type: current.type,
                        name: current.name,
                        draft,
                        editing: true,
                        selection,
                        onSelectionChange: setSelection,
                        // objectui#11124 — a read-only package gets no `onPatch`: per
                        // the preview contract the canvas is then read-only (no add,
                        // insert, drag or delete — each a doomed write), while node and
                        // edge selection still open the inspector read-only below.
                        onPatch: editLocked ? undefined : onPatch,
                        locale,
                        // objectstack#27799 — the Problems list reads the verdict the inspectors read.
                        diagnostics: flowPreviewDiagnostics,
                      })}
                    </FlowPreviewChromeProvider>
                  </FlowRegistrationContext.Provider>
                </FlowRuntimeContext.Provider>
              ) : (
                <pre className="h-full overflow-auto px-6 py-4 text-[11px] text-muted-foreground">
                  {JSON.stringify(draft, null, 2)}
                </pre>
              )}
            </div>
          </main>
        </div>

        {flowsEmpty ? null : configFolded && !inSlot ? (
          // objectui#11795 — the folded row: no aside reserving width beside
          // the canvas; the selection's configuration opens over it, and
          // closing the drawer clears the selection, as the aside's ✕ does.
          // objectui#12725 — in the right slot the Configuration reserves no
          // width in this row at all (the slot's width is the copilot's
          // already), so the drawer has nothing left to save and only the
          // classic layout folds.
          <Sheet open={selection !== null} onOpenChange={(open) => { if (!open) setSelection(null); }}>
            <SheetContent
              side="right"
              aria-describedby={undefined}
              data-testid="auto-config-drawer"
              className="flex w-full flex-col gap-0 p-0 sm:max-w-sm"
            >
              <SheetHeader className="shrink-0 border-b px-3 py-2 pr-10">
                <SheetTitle className="flex items-center gap-2 text-[13px] font-medium">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  {t('engine.studio.auto.config', locale)}
                </SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-auto p-3">{configBodyEl}</div>
            </SheetContent>
          </Sheet>
        ) : (
        (() => {
          // objectui#12488 — one header: the aside's names the selection
          // ("Node · Decision", its label, close) and the inspector below
          // draws none of its own (`InspectorShellHostProvider`). With nothing
          // selected the aside keeps its "Configuration" eyebrow.
          const heading =
            selection && inspector && current && flowLoaded ? flowSelectionHeading(draft, selection, locale) : null;
          const aside = (
            <StudioInspector
              testId="auto-config-aside"
              className={inSlot ? 'w-full flex-1 border-l-0' : undefined}
              eyebrow={heading?.eyebrow ?? t('engine.studio.auto.config', locale)}
              title={heading?.title}
              onClose={selection ? () => setSelection(null) : undefined}
              closeLabel={t('engine.studio.deselect', locale)}
              // objectui#12453 — a read-only package saves no draft: no footer.
              // objectstack#28570 — a customized flow saves into the pair.
              footer={
                editLocked
                  ? null
                  : readOnly
                    ? t('engine.studio.customize.draftFooter', locale)
                    : t('engine.studio.inspector.draftFooter', locale)
              }
              // objectui#12454 — a selection's inspector brings its own padding
              // (the metadata inspector shell); only the empty sentence takes the aside's.
              bodyClassName={heading ? 'p-0' : undefined}
            >
              {heading ? (
                <InspectorShellHostProvider value={{ onSelectionChange: setSelection }}>{configBodyEl}</InspectorShellHostProvider>
              ) : (
                configBodyEl
              )}
            </StudioInspector>
          );
          // objectui#12725 — in the right slot (filling it), or beside the canvas.
          return inSlot ? slot.propsTarget && createPortal(aside, slot.propsTarget) : aside;
        })()
        )}
      </div>

      <CreateItemDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('engine.studio.auto.newTitle', locale)}
        labelFieldLabel={t('engine.studio.auto.nameLabel', locale)}
        labelPlaceholder={t('engine.studio.auto.namePlaceholder', locale)}
        idFieldLabel={t('engine.studio.auto.idLabel', locale)}
        idPlaceholder={t('engine.studio.auto.idPlaceholder', locale)}
        submitLabel={t('engine.studio.createDraft', locale)}
        submittingLabel={t('engine.studio.creating', locale)}
        busy={createBusy}
        error={newNeeds ?? error?.message ?? null}
        locale={locale}
        extra={
          /* objectui#11861 — the dialog opens on starting points in plain
             words (`flowPresets.ts`), the first one chosen. Each is one of the
             Start node's trigger choices, written by the same create path. A
             record one asks for its object right under it, with the Start
             node's own Object field, and Create holds it until one is named.
             *Advanced* is the trigger form below, unchanged: it writes what
             it wrote. */
          <>
            {createTaken && (
              <CreateTakenNotice
                scope="flow"
                sentence={tFormat(
                  createTaken.here ? 'engine.studio.auto.createTaken' : 'engine.studio.auto.createTakenElsewhere',
                  locale,
                  { label: createTaken.label, name: createTaken.name },
                )}
                openLabel={tFormat('engine.studio.create.openExisting', locale, { label: createTaken.label })}
                onOpen={createTaken.here ? () => openTakenFlow(createTaken.name) : undefined}
              />
            )}
            <fieldset className="space-y-2">
              <legend className="mb-1 block text-sm font-medium">{t('engine.studio.auto.presets', locale)}</legend>
              {FLOW_PRESETS.map((p) => (
                <div key={p.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={newChoiceGroup}
                      value={p.id}
                      checked={newChoice === p}
                      data-testid={`create-flow-preset-${p.id}`}
                      onChange={() => {
                        setNewChoice(p);
                        setNewNeeds(null);
                      }}
                    />
                    {t(p.labelKey, locale)}
                  </label>
                  {newChoice === p && startTrigger.object?.showWhen?.equals.includes(p.triggerType) && (
                    <div className="ml-6 mt-1.5">
                      {/* objectstack#30038 — no expression is legal here: a typed
                          prefix is never saved as the trigger object. */}
                      <ObjectPicker
                        label={startTrigger.object.label}
                        value={newTriggerObject}
                        objectsOnly
                        onCommit={(v) => {
                          setNewTriggerObject(v);
                          setNewNeeds(null);
                        }}
                        locale={locale}
                      />
                    </div>
                  )}
                </div>
              ))}
              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={newChoiceGroup}
                    value="advanced"
                    checked={newChoice === 'advanced'}
                    data-testid="create-flow-advanced"
                    onChange={() => {
                      setNewChoice('advanced');
                      setNewNeeds(null);
                    }}
                  />
                  {/* The Validations and Actions menus' own word for the full form. */}
                  {t('engine.studio.rules.advanced', locale)}
                </label>
                {/* objectui#11788 — the trigger, asked for here rather than found
                    later inside the Start node. The choices, their labels and
                    which of them watch an object are the Start node's own
                    trigger field (`fieldsForNodeType('start')`), so the two can
                    never offer different triggers; what is chosen is written
                    where that field writes it. */}
                {newChoice === 'advanced' && startTrigger.trigger && (
                  <div className="ml-6 mt-1.5 space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">{startTrigger.trigger.label}</span>
                      <StudioPicker
                        value={newTrigger}
                        options={[
                          { value: '', label: t('engine.studio.newAutoTrigger.later', locale) },
                          ...(startTrigger.trigger.options ?? []).map((o) => ({ value: o.value, label: o.label })),
                        ]}
                        onPick={setNewTrigger}
                        className="h-auto rounded px-2 py-1.5 text-sm"
                        testId="create-flow-trigger"
                      />
                    </label>
                    {startTrigger.trigger.help && (
                      <p className="-mt-2 text-[11px] text-muted-foreground">{startTrigger.trigger.help}</p>
                    )}
                    {startTrigger.object && newTrigger && startTrigger.object.showWhen?.equals.includes(newTrigger) && (
                      <ObjectPicker
                        label={startTrigger.object.label}
                        value={newTriggerObject}
                        objectsOnly
                        onCommit={setNewTriggerObject}
                        locale={locale}
                      />
                    )}
                  </div>
                )}
              </div>
            </fieldset>
          </>
        }
        onSubmit={({ label, name }) => {
          if (newChoice === 'advanced') {
            void doCreateFlow(
              label,
              name,
              newTrigger
                ? {
                    triggerType: newTrigger,
                    objectName:
                      startTrigger.object?.showWhen?.equals.includes(newTrigger) && newTriggerObject.trim()
                        ? newTriggerObject.trim()
                        : undefined,
                  }
                : null,
            );
            return;
          }
          // A preset: its trigger, or nothing sent while it waits for its object.
          const trigger = flowPresetTrigger(newChoice, startTrigger.object?.showWhen?.equals ?? [], newTriggerObject);
          if (!trigger) {
            setNewNeeds(t('engine.studio.auto.preset.needsObject', locale));
            return;
          }
          void doCreateFlow(label, name, trigger);
        }}
      />
    </div>
  );
}

/**
 * objectstack#28573 — what the Access pillar's "New similar" strip says: the
 * copy the clone door saved (shown on that copy, in the package the answer
 * named), or an answer the pillar could not open (no copy named, or no
 * package). `notice` is the server's sentence, and `noticeCode` the code it
 * names it by (objectstack#29727): shown in the console's language for a known
 * code, as sent otherwise.
 */
type NewSimilarStrip =
  | { kind: 'landed'; name: string; package: string; notice: string; noticeCode?: string }
  | { kind: 'noPackage'; name: string; notice: string; noticeCode?: string }
  | { kind: 'noName'; notice: string; noticeCode?: string };

/** The navigation-state key the copy's landing rides to the copy's pillar on. */
const NEW_SIMILAR_ARRIVAL_STATE = 'accessNewSimilar';

/**
 * The landing a "New similar" navigation carried, for the pillar it opened:
 * kept only when it names THIS package, so a stale history entry of another
 * package's pillar shows nothing.
 */
function readNewSimilarArrival(state: unknown, packageId: string): NewSimilarStrip | null {
  const arrival = (state as Record<string, unknown> | null | undefined)?.[NEW_SIMILAR_ARRIVAL_STATE] as
    | Partial<Extract<NewSimilarStrip, { kind: 'landed' }>>
    | undefined;
  if (!arrival || arrival.kind !== 'landed' || arrival.package !== packageId || typeof arrival.name !== 'string') {
    return null;
  }
  return {
    kind: 'landed',
    name: arrival.name,
    package: packageId,
    notice: typeof arrival.notice === 'string' ? arrival.notice : '',
    ...(typeof arrival.noticeCode === 'string' ? { noticeCode: arrival.noticeCode } : {}),
  };
}

/**
 * Access pillar — the permission workbench (builder-ui §7, ADR-0084's fourth
 * content pillar). Left rail: the environment's permission sets / profiles;
 * main: the Salesforce-style PermissionMatrixEditPage (objects × CRUD/VAMA +
 * field-level R/W).
 *
 * Scope note (ADR-0086 P0/P1/P2): the pillar is scoped to the current package.
 * The left rail lists only permission sets this package owns — the metadata API
 * filters `permission` by the record-level `package_id` provenance server-side
 * (P1), so environment-owned platform defaults (`admin_full_access`,
 * `member_default`, …) are excluded by the backend. The object MATRIX lists only
 * the objects this package declares, and Save merges just that slice back,
 * leaving other packages' contributed rows untouched (P0). Save writes a package
 * DRAFT and publishes with the whole package via the top-bar Publish (P2, D6).
 */
// Exported for tests — routed only through StudioDesignSurface in production.
export function AccessPillar({
  packageId: railPackageId,
  publishNonce,
  onDraftSaved,
  readOnly: packageReadOnly = false,
  customization = null,
  onDirtyChange,
}: {
  packageId: string;
  publishNonce?: number;
  onDraftSaved?: () => void;
  /** Courtesy gate: hide/disable permission-authoring affordances. */
  readOnly?: boolean;
  /** objectstack#28572 — on a read-only base, its pair: the rail lists the pair's sets too, and New lands there. */
  customization?: StudioBaseCustomization | null;
  /** objectui#2600 — mirrors the pillar's unsaved-edit state (permission
   * matrix or OWD overview rows) up to the Studio header, whose
   * pillar/Home/package navigation unmounts this whole pillar (SPA nav, so no
   * beforeunload). Reports `false` when the pillar unmounts, same contract as
   * PermissionMatrixEditPage's own onDirtyChange. */
  onDirtyChange?: (dirty: boolean) => void;
}): React.ReactElement {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  // See DataPillar's rail — same mobile-overlay treatment for the permission-set list.
  const isMobile = useIsMobile();
  const [railOpen, setRailOpen] = React.useState(false);
  // objectui#7255 — same live-pulse subscription as the sibling rails; this
  // one only replaces the permission-set LIST, so no edit-buffer hold.
  const metadataRefreshNonce = useMetadataRefreshNonce();
  const [perms, setPerms] = React.useState<
    Array<{ name: string; label: string; isDefault?: boolean; addedIn?: string }>
  >([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState<string | null>(null);
  // objectstack#28572 (ADR-0146 D3) — the rail is the base's; on a read-only
  // base it lists the sets its pair adds too, and New lands in the pair. A set
  // the pair adds opens writable, read and saved at the pair: the open set's
  // matrix names `packageId` and asks `readOnly`, the open set's own. The
  // package-wide surfaces (the OWD overview, suggested bindings, Explain)
  // stay the base's.
  const railPairId = packageReadOnly && customization ? customization.pairId : null;
  const railMarks = railCustomizationsOf(customization?.marks, railPackageId);
  const [onlyCustomized, toggleOnlyCustomized] = useRailCustomizationsOnly();
  const newInPair = packageReadOnly && customization !== null && !customization.walled;
  const currentAddedIn = perms.find((p) => p.name === current)?.addedIn;
  const packageId = currentAddedIn ?? railPackageId;
  const readOnly = packageReadOnly && !currentAddedIn;
  // The Record Sharing Baseline (OWD) overview is a sibling surface to the
  // permission-set matrix (objectui#2505) — same package-author ownership
  // boundary, no principal dimension. `owdOpen` swaps the main panel to it;
  // `owdHighlight` carries the object a permission-matrix badge deep-linked to.
  const [owdOpen, setOwdOpen] = React.useState(false);
  const [owdHighlight, setOwdHighlight] = React.useState<string | null>(null);
  const appliedOwdDeepLink = React.useRef(false);
  // `?surface=permission:<name>` / `?surface=owd:overview` capture + mirror —
  // shared plumbing (see useSurfaceDeepLink). This rail keys `current` by name,
  // so wrap the open surface in the identity the param carries.
  const currentSurface = React.useMemo(
    () =>
      owdOpen
        ? { type: 'owd', name: 'overview' }
        : current
          ? { type: 'permission', name: current }
          : null,
    [owdOpen, current],
  );
  const initialSurface = useSurfaceDeepLink(currentSurface);
  // objectstack#28572 — see `useDeepLinkFallback`.
  const deepLinkUpgrade = useDeepLinkFallback();
  const currentRef = React.useRef(current);
  React.useLayoutEffect(() => {
    currentRef.current = current;
  });
  const [query, setQuery] = React.useState('');
  // inline creator (same rail pattern as the Data pillar's object creator)
  const [creating, setCreating] = React.useState(false);
  const [createErr, setCreateErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // objectstack#26836 — a create refused because the name is taken: which set
  // holds it, and whether it is this package's, so the dialog can open it.
  const [createTaken, setCreateTaken] = React.useState<{ name: string; label: string; here: boolean } | null>(null);
  // Which of the rail's sets are published, and which hold a pending draft:
  // the draft discard's two inputs, read by `load` with the rail.
  const [publishedNames, setPublishedNames] = React.useState<ReadonlySet<string>>(() => new Set());
  const [draftNames, setDraftNames] = React.useState<ReadonlySet<string>>(() => new Set());
  const [discarding, setDiscarding] = React.useState(false);
  // Bumped by a discard: the open matrix re-reads as it does after a publish,
  // since in both its draft is gone (added to `publishNonce` below).
  const [draftGoneNonce, setDraftGoneNonce] = React.useState(0);
  // [ADR-0090 D6] "why can this user access?" — right-side explain sheet.
  const [explainOpen, setExplainOpen] = React.useState(false);
  // objectstack#28573 (ADR-0146 D6) — "New similar" on a read-only base's set:
  // whether its dialog is open, and what the strip above the matrix says. A
  // `landed` strip is the copy the clone door saved, shown on that copy; a
  // `noPackage` / `noName` strip is an answer this pillar cannot open, shown
  // on the base. The copy usually opens in ANOTHER package, which remounts
  // this pillar (keyed by package), so the strip rides the navigation's state
  // and is read once here.
  const navigate = useNavigate();
  const location = useLocation();
  const [newSimilarOpen, setNewSimilarOpen] = React.useState(false);
  const [newSimilarStrip, setNewSimilarStrip] = React.useState<NewSimilarStrip | null>(() => {
    // objectstack#28572 — a copy that landed in the base's pair arrives on
    // the base's surface; matched by the spec's pairing rule (a read).
    const pair = pairIdOf(railPackageId);
    return readNewSimilarArrival(location.state, railPackageId) ?? (pair ? readNewSimilarArrival(location.state, pair) : null);
  });
  // Who may press it: the clone door asks the metadata door's verdict
  // (`manage_metadata`), and under a wall the catalog is the platform
  // operator's (ADR-0131 D3), refused whatever the capability. Either way the
  // action draws disabled, with the console's own sentence for why.
  const canAuthorSets = useCanAuthorMetadata();
  const walledSets = useWalledCatalogReadOnly('permission');
  // objectui#12456 — the open set's tab (epic objectui#12446, decision C):
  // Objects, System capabilities, Row-level security, Tab visibility,
  // Delegated admin. Objects is the landing; the choice holds across sets.
  const [accessTab, setAccessTab] = React.useState<PermissionStudioTab>('objects');
  // Both main-panel surfaces hold unsaved edits and unmount on a rail-driven
  // swap: the matrix page is keyed by `current` (and unmounts entirely when
  // the OWD overview swaps in), and the OWD overview batch-editor unmounts
  // when a set swaps back in. Each editor reports its dirty state up
  // (`onDirtyChange` — the two never coexist, so at most one bit is set), and
  // every swap is gated on this confirm — same native prompt as the metadata
  // editor's leave guard. Each editor resets its report on unmount, so a
  // confirmed discard clears its bit by itself.
  const [matrixDirty, setMatrixDirty] = React.useState(false);
  const [owdDirty, setOwdDirty] = React.useState(false);
  const pillarDirty = matrixDirty || owdDirty;
  // The combined bit also gates the Studio header's pillar/Home/package
  // navigation, which unmounts this whole pillar (objectui#2600) — mirror it
  // up alongside the local rail guard. Ref-stabilized like the editors' own
  // reports; the unmount cleanup reports `false` so a discarded pillar clears
  // the surface's guard state.
  const onDirtyChangeRef = React.useRef(onDirtyChange);
  React.useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  React.useEffect(() => {
    onDirtyChangeRef.current?.(pillarDirty);
  }, [pillarDirty]);
  React.useEffect(
    () => () => {
      onDirtyChangeRef.current?.(false);
    },
    [],
  );
  const confirmDiscardEdits = React.useCallback(
    () => confirmDropUnsavedWork(pillarDirty, locale),
    [pillarDirty, locale],
  );

  // objectstack#28572 — the latest rail read wins: a read the pair's arrival
  // re-ran can finish before or after one a New in the pair asked for.
  const loadSeqRef = React.useRef(0);
  const load = React.useCallback(async (pairOverride?: string) => {
    const seq = ++loadSeqRef.current;
    const railPair = pairOverride ?? railPairId;
    try {
      // Scope the rail to this package server-side (ADR-0086 P1): the metadata
      // API filters `permission` by the record-level `package_id` provenance, so
      // it returns only the sets this package owns — environment-owned platform
      // defaults (`admin_full_access`, `member_default`, …) are excluded by the
      // backend, not the client. (The `?package=` list rows don't echo the
      // provenance columns, so a client-side filter can't do this.)
      //
      // ADR-0086 P2 (D6): a package permission set is draft/published metadata,
      // so the rail shows published ∪ pending-draft sets — a set created (or
      // renamed) as a draft but not yet published must still appear, just like
      // the Data/Interfaces pillars merge their drafts. Draft headers are
      // already package-scoped by `listDrafts({ packageId })`.
      const packageId = railPackageId;
      // objectstack#28572 — and, on a read-only base with a pair, the pair's
      // published and draft sets: those the base's list does not hold are the
      // sets the pair adds. A failed pair read lists none of them.
      const readPair = async () =>
        railPair === null
          ? null
          : Promise.all([
              client.list('permission', { packageId: railPair }) as Promise<Array<Record<string, unknown>>>,
              client.listDrafts({ packageId: railPair, type: 'permission' }).catch(() => []),
            ]);
      const [list, drafts, pair] = await Promise.all([
        client.list('permission', { packageId }) as Promise<Array<Record<string, unknown>>>,
        client.listDrafts({ packageId, type: 'permission' }).catch(() => []),
        readPair().catch(() => null),
      ]);
      if (seq !== loadSeqRef.current) return;
      const byName = new Map<string, { name: string; label: string; isDefault?: boolean; addedIn?: string }>();
      for (const p of list || []) {
        const name = String(p.name ?? (p as Record<string, unknown>).id ?? '');
        if (!name) continue;
        byName.set(name, {
          name,
          label: String(p.label ?? p.name ?? ''),
          isDefault: !!(p as Record<string, unknown>).isDefault,
        });
      }
      // objectui#11862 — a draft-only set reads as the label its `_drafts` row
      // carries (objectstack-ai/objectstack#22200), in the designer locale; the
      // set is not read for it (ruling `6053526025`, question 1). A row with
      // no label leaves `label` empty, and the rail shows the name alone.
      for (const d of (drafts as Array<{ name?: string; label?: I18nLabel | null }>) || []) {
        const name = String(d?.name ?? '');
        if (!name || byName.has(name)) continue;
        byName.set(name, { name, label: navItemLabelText(d?.label ?? undefined, locale).trim() });
      }
      const [pairList, pairDrafts] = pair ?? [[], []];
      if (railPair !== null) {
        for (const p of pairList || []) {
          const name = String(p.name ?? (p as Record<string, unknown>).id ?? '');
          if (!name || byName.has(name)) continue;
          byName.set(name, { name, label: String(p.label ?? p.name ?? ''), addedIn: railPair });
        }
        for (const d of (pairDrafts as Array<{ name?: string; label?: I18nLabel | null }>) || []) {
          const name = String(d?.name ?? '');
          if (!name || byName.has(name)) continue;
          byName.set(name, { name, label: navItemLabelText(d?.label ?? undefined, locale).trim(), addedIn: railPair });
        }
      }
      const scoped = [...byName.values()];
      setPerms(scoped);
      const nameOf = (p: Record<string, unknown>) => String(p.name ?? p.id ?? '');
      setPublishedNames(new Set([...(list || []), ...(pairList || [])].map(nameOf)));
      setDraftNames(
        new Set(
          [...((drafts as Array<{ name?: string }>) || []), ...((pairDrafts as Array<{ name?: string }>) || [])]
            .map((d) => String(d?.name ?? ''))
            .filter(Boolean),
        ),
      );
      // A `?surface=owd:overview` deep-link opens the OWD overview instead of a
      // permission set; `current` still defaults to the first set so switching
      // back to the matrix has a target. Applied once — a later publish re-runs
      // `load`, and we must not yank the user back to OWD then.
      if (!appliedOwdDeepLink.current && initialSurface?.type === 'owd') {
        appliedOwdDeepLink.current = true;
        setOwdOpen(true);
      }
      const deepLinked = resolveSurfaceDeepLink(scoped, initialSurface, 'permission');
      // objectstack#28572 — a set the pair adds is listed once the pair is
      // known (`useDeepLinkFallback`).
      if (deepLinked && deepLinkUpgrade.take(currentRef.current, deepLinked.name)) {
        setCurrent(deepLinked.name);
      } else {
        if (!deepLinked && initialSurface?.type === 'permission' && currentRef.current === null) {
          deepLinkUpgrade.note(scoped[0]?.name ?? null);
        }
        setCurrent((c) => c ?? deepLinked?.name ?? scoped[0]?.name ?? null);
      }
    } catch (e) {
      if (seq === loadSeqRef.current) setError(formatMetadataError(e));
    } finally {
      if (seq === loadSeqRef.current) setLoaded(true);
    }
  }, [client, railPackageId, railPairId, locale]);

  React.useEffect(() => {
    void load();
    // Re-read after a package publish so drafts that went live collapse into
    // the published rail (ADR-0086 P2), and on the live-metadata pulse so a
    // copilot turn's permission set appears without a page reload (#7255).
  }, [load, publishNonce, metadataRefreshNonce]);

  const doCreate = React.useCallback(
    async (label: string, name: string) => {
      setBusy(true);
      setCreateErr(null);
      setCreateTaken(null);
      try {
        // A name a permission set already holds, published or as a draft, in
        // this package or any other, is refused here and nothing is written:
        // over a published set the first-write pin below would write this
        // blank skeleton as its pending draft (`findTakenIdentifier`).
        const taken = await findTakenIdentifier(client, 'permission', name, locale);
        if (taken) {
          setCreateTaken({ ...taken, here: perms.some((p) => p.name === name) });
          return;
        }
        // objectstack#28572 (ADR-0146 D3) — on a read-only base the set is
        // created in its pair, which the ensure door answers (creating it on
        // first use, without a prompt).
        const target =
          packageReadOnly && customization ? (await customization.ensurePackage()).packageId : railPackageId;
        // Package door → create as a DRAFT stamped with this package (D6/D7),
        // published atomically with the rest of the package.
        // objectui#11773 — and the door refuses a draft row too (the
        // first-write pin), for one that lands between the check above and
        // this save. A set published in that window is not refused by it.
        await client.save('permission', name, buildPermissionSkeleton(name, label), {
          mode: 'draft',
          packageId: target,
          ifNoneMatch: '*',
          surface: 'studio',
        });
        toast.success(tFormat('engine.studio.access.created', locale, { label }));
        setCreating(false);
        onDraftSaved?.();
        // A set made in the pair is read back from the pair the door named.
        await load(target === railPackageId ? undefined : target);
        // Land on the new set's matrix — also from the OWD overview, whose
        // discard the "+ New" gate already confirmed up front.
        setOwdOpen(false);
        setCurrent(name);
      } catch (e) {
        // objectstack#26846 — the first-write pin's refusal, for a draft that
        // landed after the check above, read by its code: this create sent
        // the pin, so a conflict means the identifier holds a draft. The
        // door's sentence speaks of the pin itself and is not shown.
        setCreateErr(
          errorCodeIs(e, 'METADATA_CONFLICT')
            ? tFormat('engine.studio.access.createDraftTaken', locale, { name })
            : formatMetadataError(e),
        );
      } finally {
        setBusy(false);
      }
    },
    [client, load, railPackageId, packageReadOnly, customization, onDraftSaved, locale, perms],
  );

  // The refusal's way out: the taken set is this package's, so it opens in
  // the matrix instead of a second one being made. The "+ New" gate already
  // confirmed any discard of unsaved edits.
  const openTakenSet = React.useCallback((name: string) => {
    setCreating(false);
    setCreateTaken(null);
    setOwdOpen(false);
    setCurrent(name);
  }, []);

  // objectstack#28573 — the clone door saved a copy of the open set. It opens
  // only where the answer says it landed: that package's Access pillar with
  // the copy selected. An answer that names no copy, or no package, is said
  // so and opens nothing; the landing is never derived from the base.
  const onNewSimilarSaved = React.useCallback(
    (copy: PermissionSetCloned) => {
      setNewSimilarOpen(false);
      if (!copy.name) {
        setNewSimilarStrip({ kind: 'noName', notice: copy.notice, noticeCode: copy.noticeCode });
        return;
      }
      if (typeof copy.package !== 'string') {
        setNewSimilarStrip({ kind: 'noPackage', name: copy.name, notice: copy.notice, noticeCode: copy.noticeCode });
        return;
      }
      const landed: NewSimilarStrip = {
        kind: 'landed',
        name: copy.name,
        package: copy.package,
        notice: copy.notice,
        noticeCode: copy.noticeCode,
      };
      // objectstack#28572 — the pair's sets are this surface's too.
      if (copy.package === railPackageId || (railPairId !== null && copy.package === railPairId)) {
        setNewSimilarStrip(landed);
        setOwdOpen(false);
        setCurrent(copy.name);
        void load();
        return;
      }
      navigate(studioPillarItemPath(copy.package, 'access', { type: 'permission', name: copy.name }), {
        state: { [NEW_SIMILAR_ARRIVAL_STATE]: landed },
      });
    },
    [railPackageId, railPairId, navigate, load],
  );

  // Discard the open set's pending draft (`DELETE ?state=draft` at this
  // package's address, the door the metadata editor's "Discard draft" uses).
  // A published set goes back to its live body; a set that was never
  // published has nothing left, so it leaves the rail.
  const discardDraft = React.useCallback(
    async (name: string) => {
      const row = perms.find((p) => p.name === name);
      const item = row?.label || name;
      const neverPublished = !publishedNames.has(name);
      // One confirm: an unsaved edit on the open matrix is an unpublished
      // change of this same set, and the discard removes it with the rest.
      if (
        !window.confirm(
          tFormat(
            neverPublished ? 'engine.studio.access.discardConfirmUnpublished' : 'engine.studio.access.discardConfirm',
            locale,
            { item },
          ),
        )
      ) {
        return;
      }
      setDiscarding(true);
      try {
        await client.reset('permission', name, { state: 'draft', packageId });
        toast.success(tFormat('engine.edit.draftDiscarded', locale, { item }));
        if (neverPublished) setCurrent((c) => (c === name ? null : c));
        // The open matrix holds the discarded draft and the pin it was read
        // with: read it again, as after a publish (its draft is gone).
        setDraftGoneNonce((n) => n + 1);
        onDraftSaved?.();
        await load();
      } catch (e) {
        toast.error(t('engine.studio.access.discardFailed', locale), {
          description: formatMetadataError(e),
          classNames: { description: 'whitespace-pre-line' },
        });
      } finally {
        setDiscarding(false);
      }
    },
    [perms, publishedNames, locale, client, packageId, onDraftSaved, load],
  );

  const filtered = perms.filter(
    (p) =>
      (!query.trim() ||
        p.label.toLowerCase().includes(query.trim().toLowerCase()) ||
        p.name.toLowerCase().includes(query.trim().toLowerCase())) &&
      // objectstack#28572 — "only customizations" keeps the marked rows.
      (!onlyCustomized || railMarks?.markOf({ type: 'permission', ...p }) != null),
  );
  const markedSets = railMarks ? perms.filter((p) => railMarks.markOf({ type: 'permission', ...p }) !== null).length : 0;

  // objectui#12459 — the item header inside the content column. The
  // "Permission matrix" band above the rail retires. objectui#12456 — an
  // open set's header is the matrix page's own (its label, api name, Package
  // chip, granted / override counts, History, the tab row), fed the three
  // pieces below; this pillar draws the header for the OWD overview and for
  // the empty states.
  const accessRailToggleEl = (
    <button
      type="button"
      onClick={() => setRailOpen((v) => !v)}
      aria-label={t('engine.studio.toggleRail', locale)}
      className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
    >
      <Menu className="h-4 w-4" />
    </button>
  );
  // objectui#11781 — "saved as draft" is what an editable package does. A
  // read-only one saves nothing: objectui#12453 puts the read-only link where
  // the note was, and the link's title carries the note's sentence. An open
  // set's header draws it at the tab row's right end (objectui#12456: the
  // title row truncated the set's label at the 1280 px design width).
  // objectui#12524 — the writable note is this pillar's draft status: the
  // header draws it in the status place every pillar shares. The read-only
  // link is an action, so it stays in the actions slot.
  // The note speaks for what the main panel shows: the open set, or the
  // package-wide OWD overview and empty header, which are the base's.
  const noteReadOnly = owdOpen || current === null ? packageReadOnly : readOnly;
  // objectstack#29674 — an open set the pair adds lists its base's objects
  // too (`permissionObjectScopePackages`), so its note names the base instead
  // of claiming "this package's objects" only.
  const notePairBase = !owdOpen && current !== null && currentAddedIn ? (customization?.baseLabel ?? railPackageId) : null;
  const accessStatus: StudioItemStatus | undefined = noteReadOnly
    ? undefined
    : notePairBase !== null
      ? {
          label: tFormat('engine.studio.access.bannerPair', locale, { package: notePairBase }),
          title: tFormat('engine.studio.access.bannerTitlePair', locale, { package: notePairBase }),
        }
      : { label: t('engine.studio.access.banner', locale), title: t('engine.studio.access.bannerTitle', locale) };
  const accessNoteEl = accessStatus ? (
    <StudioStatusChip {...accessStatus} />
  ) : (
    <StudioReadOnlyLink
      item={current !== null && !owdOpen ? { type: 'permission', name: current } : null}
      title={t('engine.studio.access.bannerTitleReadOnly', locale)}
      locale={locale}
    />
  );
  const accessExplainEl = (
    <button
      type="button"
      onClick={() => setExplainOpen(true)}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ShieldQuestion className="h-3.5 w-3.5" />
      {t('engine.studio.access.explain.open', locale)}
    </button>
  );
  // The rail's "+" — and the empty block's button, which runs this same
  // handler (objectui#12514). Creating a set lands on the new set's matrix — a
  // remount of the open matrix, or a swap out of the OWD overview — so gate
  // the flow up front.
  const openCreateSet = packageReadOnly && !newInPair
    ? undefined
    : () => {
        if (!confirmDiscardEdits()) return;
        setCreateErr(null);
        setCreateTaken(null);
        setCreating(true);
      };
  // objectstack#26836 — the open set's pending draft can be discarded where
  // the set is edited; nothing in Studio offered it, so a blank draft over a
  // live set could only be published.
  const accessDiscardEl =
    !readOnly && current && !owdOpen && draftNames.has(current) ? (
      <button
        type="button"
        data-testid="access-discard-draft"
        onClick={() => void discardDraft(current)}
        disabled={discarding}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <Undo2 className="h-3.5 w-3.5" />
        {t('engine.edit.discardDraft', locale)}
      </button>
    ) : null;
  // objectstack#28573 (ADR-0146 D6) — a read-only base's set offers "New
  // similar", never an override: the copy is a NEW set, in the package the
  // clone door chooses. Disabled, it says why in the console's words.
  const newSimilarBlocked = walledSets
    ? tFormat('engine.catalog.readOnly.walled', locale, { type: translateMetadataType('permission', locale) })
    : canAuthorSets
      ? null
      : t('engine.edit.capabilityReadOnly', locale);
  const accessNewSimilarEl =
    readOnly && current && !owdOpen ? (
      <span title={newSimilarBlocked ?? t('perm.clone.hint', locale)} className="inline-flex">
        <button
          type="button"
          data-testid="access-new-similar"
          onClick={() => {
            setNewSimilarStrip(null);
            setNewSimilarOpen(true);
          }}
          disabled={newSimilarBlocked !== null || newSimilarOpen}
          aria-describedby={newSimilarBlocked !== null ? 'access-new-similar-blocked' : undefined}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Copy className="h-3.5 w-3.5" />
          {t('perm.clone.action', locale)}
        </button>
        {newSimilarBlocked !== null && (
          <span id="access-new-similar-blocked" className="sr-only">
            {newSimilarBlocked}
          </span>
        )}
      </span>
    ) : null;
  const newSimilarStripEl =
    newSimilarStrip && !owdOpen && (newSimilarStrip.kind !== 'landed' || newSimilarStrip.name === current) ? (
      <div
        role={newSimilarStrip.kind === 'landed' ? 'status' : 'alert'}
        data-testid="access-new-similar-strip"
        className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
      >
        <Copy className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p>
            {newSimilarStrip.kind === 'landed'
              ? tFormat('engine.studio.access.newSimilar.done', locale, {
                  name: newSimilarStrip.name,
                  package: newSimilarStrip.package,
                })
              : newSimilarStrip.kind === 'noPackage'
                ? tFormat('engine.studio.access.newSimilar.noPackage', locale, { name: newSimilarStrip.name })
                : t('perm.clone.noName', locale)}
          </p>
          {/* objectstack#29727 — in the console's language for its known code, else as sent. */}
          {newSimilarStrip.notice && (
            <p>
              {permissionSetCloneNoticeText(
                {
                  notice: newSimilarStrip.notice,
                  noticeCode: newSimilarStrip.noticeCode,
                  package: newSimilarStrip.kind === 'landed' ? newSimilarStrip.package : null,
                },
                locale,
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setNewSimilarStrip(null)}
          className="shrink-0 rounded-md px-1.5 text-[12px] hover:bg-amber-100 dark:hover:bg-amber-900/40"
        >
          {t('engine.studio.access.newSimilar.dismiss', locale)}
        </button>
      </div>
    ) : null;
  const accessHeaderEl = (
    <StudioItemHeader
      testId="access-item-header"
      leading={accessRailToggleEl}
      icon={owdOpen ? ShieldCheck : Shield}
      title={owdOpen ? t('engine.studio.owd.title', locale) : t('engine.studio.access.title', locale)}
      meta={owdOpen ? t('engine.studio.owd.subtitle', locale) : t('engine.studio.access.subtitle', locale)}
      status={accessStatus}
      actions={
        <>
          {noteReadOnly && accessNoteEl}
          {accessExplainEl}
        </>
      }
    />
  );

  return (
    <div className="flex h-full flex-col">
      {/* ADR-0090 D5/D9 — this package's suggested audience bindings
          (isDefault sets shipped by the package) and the deployment's
          decision on each. Renders nothing when there are none or for a
          caller without manage_metadata (the list answers 403); accept and
          revoke are enforced server-side by the anchor gates. */}
      {!packageReadOnly && (
        <SuggestedBindingsPanel
          packageId={railPackageId}
          className="mx-3 mt-2"
          strings={{
            describe: (s) =>
              tFormat(
                s.anchor === 'guest'
                  ? 'engine.studio.access.suggestPromptGuest'
                  : 'engine.studio.access.suggestPromptEveryone',
                locale,
                { set: s.permission_set_name },
              ),
            confirm: t('engine.studio.access.suggestConfirm', locale),
            confirming: t('engine.studio.access.suggestConfirming', locale),
            dismiss: t('engine.studio.access.suggestDismiss', locale),
            confirmedToast: (s) =>
              tFormat('engine.studio.access.suggestConfirmedToast', locale, {
                set: s.permission_set_name,
                anchor: s.anchor,
              }),
            dismissedToast: (s) =>
              tFormat('engine.studio.access.suggestDismissedToast', locale, { set: s.permission_set_name }),
            guestUnsupported: t('engine.studio.access.suggestGuestUnsupported', locale),
            acceptedState: (s) =>
              tFormat('engine.studio.access.suggestAcceptedState', locale, { set: s.permission_set_name }),
            notInForceState: (s) =>
              tFormat('engine.studio.access.suggestNotInForceState', locale, { set: s.permission_set_name }),
            dismissedState: (s) =>
              tFormat('engine.studio.access.suggestDismissedState', locale, { set: s.permission_set_name }),
            revoke: t('engine.studio.access.suggestRevoke', locale),
            revoking: t('engine.studio.access.suggestRevoking', locale),
            revokedToast: (s) =>
              tFormat('engine.studio.access.suggestRevokedToast', locale, { set: s.permission_set_name }),
            reopen: t('engine.studio.access.suggestReopen', locale),
            reopening: t('engine.studio.access.suggestReopening', locale),
            reopenedToast: (s) =>
              tFormat('engine.studio.access.suggestReopenedToast', locale, { set: s.permission_set_name }),
          }}
        />
      )}

      <div className="relative flex min-h-0 flex-1">
        {isMobile && railOpen && (
          <div
            className="absolute inset-0 z-10 bg-black/30"
            onClick={() => setRailOpen(false)}
            aria-hidden="true"
          />
        )}
        <StudioRail
          testId="studio-rail-access"
          heading={t('engine.studio.access.heading', locale)}
          count={perms.length}
          onAdd={openCreateSet}
          addLabel={t('engine.studio.access.new', locale)}
          addTestId="studio-rail-add"
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t('engine.studio.access.search', locale),
            matchCount: filtered.length,
          }}
          filters={
            <RailCustomizationFilter
              marks={railMarks}
              marked={markedSets}
              on={onlyCustomized}
              onToggle={toggleOnlyCustomized}
              locale={locale}
            />
          }
          pinned={
            // Pinned sibling surface: the package-wide Record Sharing Baseline
            // (OWD) overview (objectui#2505). Same package-author ownership as
            // the sets below, but a distinct surface — not a permission set.
            <div className="border-b px-2 pb-2 pt-2">
              <StudioRailRow
                active={owdOpen}
                onClick={() => {
                  // Re-clicking the open overview is a no-op — nothing
                  // remounts, so no confirm (mirrors the set re-click below).
                  if (owdOpen) {
                    setOwdHighlight(null);
                    if (isMobile) setRailOpen(false);
                    return;
                  }
                  if (!confirmDiscardEdits()) return;
                  setOwdOpen(true);
                  setOwdHighlight(null);
                  if (isMobile) setRailOpen(false);
                }}
                icon={<ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />}
                className="font-medium"
              >
                {t('engine.studio.owd.railLabel', locale)}
              </StudioRailRow>
            </div>
          }
          isMobile={isMobile}
          open={railOpen}
        >
          {/* objectui#12514 — the empty sentence names the "+" it points at;
              without one, the content column's block speaks alone. */}
          {perms.length === 0 && (error || !loaded || openCreateSet) && (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">
              {error ? t('engine.studio.loadFailed', locale) : loaded ? t('engine.studio.access.none', locale) : t('engine.studio.loading', locale)}
            </p>
          )}
          {filtered.map((p) => (
            <StudioRailRow
              key={p.name}
              active={!owdOpen && current === p.name}
              onClick={() => {
                if (!owdOpen && current === p.name) {
                  if (isMobile) setRailOpen(false);
                  return;
                }
                if (!confirmDiscardEdits()) return;
                setOwdOpen(false);
                setCurrent(p.name);
                if (isMobile) setRailOpen(false);
              }}
              icon={<Shield className="h-4 w-4 shrink-0 text-muted-foreground" />}
              // objectui#12456 — two-line rows (label, then the api name in
              // mono) at 36 px: the one height the shared rail lets differ.
              className="h-9"
              trailing={
                <>
                  <RailCustomizationMark row={{ type: 'permission', ...p }} marks={railMarks} locale={locale} />
                  {p.isDefault ? (
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">default</span>
                  ) : null}
                </>
              }
            >
              {/* objectui#11862 — the set's label first, its machine name as
                  secondary text. A set listed from its draft header alone
                  has no label in hand (the header carries none), so its
                  name is the text, as before. */}
              <StudioNameLabel label={p.label} name={p.name} />
            </StudioRailRow>
          ))}
        </StudioRail>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {(owdOpen || !current) && accessHeaderEl}
          {newSimilarStripEl}
          <main className="min-h-0 flex-1 overflow-auto">
          {owdOpen ? (
            /* Sibling surface: the package-wide OWD baseline overview
             * (objectui#2505) — object × sharingModel,
             * batch-edited as per-object drafts. */
            <PackageOwdOverviewPanel
              client={client}
              packageId={railPackageId}
              publishNonce={publishNonce}
              onDraftSaved={onDraftSaved}
              readOnly={packageReadOnly}
              locale={locale}
              highlightObject={owdHighlight}
              onDirtyChange={setOwdDirty}
            />
          ) : current ? (
            /* The existing Salesforce-style matrix page in its Studio
             * presentation (objectui#12456): the item header and five tabs
             * are the page's own, its autosave + destructive-change guard
             * included. The OWD chip deep-links to the overview above. */
            <PermissionMatrixEditPage
              key={current}
              type="permission"
              name={current}
              packageId={packageId}
              publishNonce={(publishNonce ?? 0) + draftGoneNonce}
              onDraftSaved={() => {
                // The set now holds a pending draft, so its discard shows.
                setDraftNames((names) => (names.has(current) ? names : new Set(names).add(current)));
                onDraftSaved?.();
                // objectstack#26846 — and the rail reads the sets again, so a
                // label this save changed shows there without a publish or a
                // reload.
                void load();
              }}
              readOnly={readOnly}
              onDirtyChange={setMatrixDirty}
              embedded
              // objectstack#29809 — the header's provenance chip reads the
              // mark this set's rail row draws, so the two tell one story.
              customizationMark={railMarks?.markOf({ type: 'permission', name: current, addedIn: currentAddedIn }) ?? null}
              studio={{
                tab: accessTab,
                onTabChange: setAccessTab,
                leading: accessRailToggleEl,
                chips: currentAddedIn ? (
                  <>
                    <StudioPairItemChip pairId={currentAddedIn} locale={locale} />
                    {accessNoteEl}
                  </>
                ) : (
                  accessNoteEl
                ),
                actions: (
                  <>
                    {accessNewSimilarEl}
                    {accessDiscardEl}
                    {accessExplainEl}
                  </>
                ),
              }}
              onOpenOwd={(objectName) => {
                // The badge deep-link swaps this page out for the OWD
                // overview — same remount, same guard.
                if (!confirmDiscardEdits()) return;
                setOwdHighlight(objectName || null);
                setOwdOpen(true);
              }}
            />
          ) : loaded && !error && perms.length === 0 ? (
            // objectui#12514 — one centered block whose button runs the rail's "+".
            <div className="flex h-full">
              <StudioEmptyState
                testId="access-empty"
                icon={Shield}
                sentence={t('engine.studio.access.emptyMain', locale)}
                action={
                  openCreateSet && (
                    <StudioEmptyStateAction
                      data-testid="access-empty-new"
                      label={t('engine.studio.access.new', locale)}
                      onClick={openCreateSet}
                    />
                  )
                }
              />
            </div>
          ) : null}
          </main>
        </div>
      </div>

      <AccessExplainPanel open={explainOpen} onOpenChange={setExplainOpen} packageId={railPackageId} />

      {/* objectstack#28573 — the clone door's dialog, shared with Setup's
          catalog: a name and a label, nothing else, refusals verbatim. */}
      {newSimilarOpen && current && (
        <PermissionSetCloneDialog
          source={current}
          locale={locale}
          onClose={() => setNewSimilarOpen(false)}
          onCloned={onNewSimilarSaved}
        />
      )}

      <CreateItemDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('engine.studio.access.new', locale)}
        labelFieldLabel={t('engine.studio.access.nameLabel', locale)}
        labelPlaceholder={t('engine.studio.access.labelPlaceholder', locale)}
        idFieldLabel={t('engine.studio.access.idLabel', locale)}
        idPlaceholder={t('engine.studio.access.idPlaceholder', locale)}
        // objectui#11787 — one label on every Studio create dialog: each writes a draft.
        submitLabel={t('engine.studio.createDraft', locale)}
        submittingLabel={t('engine.studio.creating', locale)}
        busy={busy}
        error={createErr}
        locale={locale}
        extra={
          createTaken && (
            <CreateTakenNotice
              scope="access"
              sentence={tFormat(
                createTaken.here ? 'engine.studio.access.createTaken' : 'engine.studio.access.createTakenElsewhere',
                locale,
                { label: createTaken.label, name: createTaken.name },
              )}
              openLabel={tFormat('engine.studio.create.openExisting', locale, { label: createTaken.label })}
              onOpen={createTaken.here ? () => openTakenSet(createTaken.name) : undefined}
            />
          )
        }
        onSubmit={({ label, name }) => void doCreate(label, name)}
      />
    </div>
  );
}

export default StudioDesignSurface;
