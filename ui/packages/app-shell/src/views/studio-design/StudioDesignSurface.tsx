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
import { useParams, useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
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
import type { MetadataClient } from '@object-ui/data-objectstack';
import type { FlowRuntimeState as SpecFlowRuntimeState } from '@objectstack/spec/contracts';
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
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
import { AppMark, type AppMarkApp } from '../../layout/AppMark.js';
import {
  STUDIO_HEADER,
  STUDIO_HEADER_ICON_BUTTON,
  STUDIO_HEADER_PACKAGE_COLUMN,
  STUDIO_HEADER_PILLAR,
  STUDIO_HEADER_PILLAR_NAV,
  STUDIO_KIND_CHIP,
  STUDIO_PKG_READONLY_WORD,
} from './studio-tokens.js';
import { StudioInspector } from './StudioInspector.js';
import { copilotDraftMarkOf, DraftChip, DraftSourceLine } from './StudioDraftMark.js';
import {
  StudioItemHeader,
  StudioStatusChip,
  StudioTab,
  useStudioTabRowFold,
  type StudioItemStatus,
} from './StudioItemHeader.js';
import {
  StudioPendingDraftsContext,
  useStudioItemDraftStatus,
  type StudioPendingDrafts,
} from './studioItemDraftStatus.js';
import { overlayPath, packagedAutomationPath } from './BuilderLanding.js';
import { DATA_CONTENT_CONTAINER, DATA_TAB_FLAT_ONLY, DATA_TAB_FOLDED_ONLY } from './dataTabsFold.js';
import { StudioRail, StudioRailGroup, StudioRailRow } from './StudioRail.js';
import { StudioEmptyState, StudioEmptyStateAction } from './StudioEmptyState.js';
import {
  FLOW_TRIGGER_GLYPHS,
  flowTriggerGlyph,
  groupFlowsByObject,
  navigationObjectOrder,
  type FlowTriggerGlyph,
} from './flowGrouping.js';
import {
  GridFieldAuthoringProvider,
  cn,
  useIsMobile,
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  Badge,
  Separator,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import { ObjectView as PluginObjectView } from '@object-ui/plugin-view';
import { ListView } from '@object-ui/plugin-list';
import { ObjectForm } from '@object-ui/plugin-form';
import {
  AlertTriangle,
  Ban,
  Boxes,
  Building2,
  FileText,
  Database,
  LayoutDashboard,
  BarChart3,
  Table2,
  Folder,
  Compass,
  Link as LinkIcon,
  Puzzle,
  BookOpen,
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
  Settings,
  Home as HomeIcon,
  Shield,
  ShieldCheck,
  ShieldQuestion,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Minus,
  Trash2,
  Zap,
  Clock,
  MousePointerClick,
  CornerDownRight,
  Layers,
  ArrowUpRight,
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
  listViewIsKanban,
  ObjectListViewInspector,
  useObjectListViewDraft,
  type DraftOnlyObjects,
} from './ObjectListViewInspector.js';
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
  dashboardHeldEdit,
  flowHeldEdit,
  flowSaveRefusal,
  formatPublishFailures,
  issueRefusal,
  navEntryLocator,
  objectHeldEdit,
  objectSaveRefusal,
  plainRefusal,
  type PublishFailure,
  type StudioHeld,
  type StudioRefusal,
} from './metadataError.js';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';
import { loadPackageLessSurfaces, loadPackageSurfaces } from './packageSurfaces.js';
import {
  STUDIO_ORG_SCOPE_PILLAR,
  isOrgScopeDraft,
  isStudioOrgScope,
  studioOrgScopePath,
} from './studioScope.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
import { useHomePath } from '../../hooks/useHomePath.js';
import { resolveSurface, findSurfaceInTree, isSameSurface, type NavNode, type Surface } from './navSurface.js';
import { servedNavTextOf, displayNavTree, displayAppLabel, type ServedNavText } from './servedNavText.js';
import { ServedWidgetTextContext, servedWidgetTextOf } from './servedDashboardText.js';
import { useSurfaceDeepLink, resolveSurfaceDeepLink, type SurfaceTarget } from './useSurfaceDeepLink.js';
import { SurfaceDeepLinkProvider, useRequestedSurface, useSurfaceNavigator } from './surfaceDeepLinkChannel.js';
import { buildObjectSkeleton, buildFlowSkeleton, buildAppSkeleton, buildPermissionSkeleton, type AppNavSeed } from './skeletons.js';
import { OWD_CREATE_MODELS, OWD_DEFAULT, type OwdCreateModel } from './owd-sharing.js';
import { t, tFormat, translateMetadataType, useMetadataLocale } from '../metadata-admin/i18n.js';
import { useRegisterUnsavedEdits } from '../../chrome/unsavedEdits.js';
import { fieldsForNodeType, localizeFlowFields, type FlowConfigField } from '../metadata-admin/inspectors/flow-node-config.js';
import { ObjectPicker } from '../metadata-admin/inspectors/ObjectPicker.js';
import { IconPickerWidget } from '../metadata-admin/widgets.js';
import { useDisplayLocale } from '@object-ui/i18n';
import { SuggestedBindingsPanel } from '../../components/SuggestedBindingsPanel.js';
import { AppNavCanvas, navPayloadOf } from '../metadata-admin/previews/AppNavCanvas.js';
import {
  FlowRegistrationContext,
  FlowRuntimeContext,
  deriveFlowRunStatus,
  describeFlowRunStatus,
  type FlowRunStatus,
  type FlowRunStatusView,
  type FlowRuntimeRow,
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
  clearedLabel,
  inheritedNavEntryText,
  navEntryLabelText,
  navItemLabelText,
  renamedLabel,
  type NavEntryLike,
} from '../metadata-admin/previews/navItemLabel.js';
import { DraftTargetLabels, findByName, useNavTargetLabel } from '../../hooks/useNavTargetLabel.js';
import { listAppComponents } from '../../services/componentRegistry.js';
import {
  NAV_ENTRY_TYPES,
  isNavEntryType,
  isStaticPageOption,
  navEntryOffersField,
  navTypeAcceptsChildren,
  retypedNavEntry,
} from '../metadata-admin/inspectors/nav-target.js';
import type { NavigationItemType } from '@object-ui/types';
import type { NavTargetLabelResolver } from '@object-ui/layout';
import {
  readFields,
  writeFields,
  newField,
  toFieldNameLoose,
} from '../metadata-admin/previews/object-fields-io.js';
import type { FieldTypeId } from '../metadata-admin/previews/field-types.js';
import { CreateItemDialog } from './CreateItemDialog.js';
import { AddFieldPopover } from './AddFieldPopover.js';
// objectui#11787 — the shared draft autosave, moved to its own module unchanged.
import { useDraftAutoSave, type DraftSend } from './useDraftAutoSave.js';
import { FLOW_PRESETS, flowPresetTrigger, type FlowPreset } from './flowPresets.js';
import {
  CreatePackageDialog,
  PackageDetailSheet,
  type InstalledPackageRow,
} from '../metadata-admin/PackagesPage.js';
import { FormToolbar, ObjectFormDesigner } from './ObjectFormDesigner.js';
import { isStudioHiddenSystemField } from './studioHiddenSystemField.js';
import { ObjectGroupInspector } from './ObjectGroupInspector.js';
import { ObjectValidationsPanel } from './ObjectValidationsPanel.js';
import { ObjectSettingsPanel } from './ObjectSettingsPanel.js';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel.js';
import { ObjectApiPanel } from './ObjectApiPanel.js';
import { ObjectHooksPanel } from './ObjectHooksPanel.js';
import { ObjectActionsPanel } from './ObjectActionsPanel.js';
import { getIcon } from '../../utils/getIcon.js';
import { fetchPackages, prefixObjectName, type PkgEntry } from './packages-io.js';
import {
  DraftChangesPanel,
  type DraftChangesPosture,
  type DraftPublishOptions,
} from '../../preview/DraftChangesPanel.js';
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

/**
 * The create dialog's OWD options reuse the SETTINGS tab's own label and gloss
 * strings verbatim (`7a90afdf9`). The complaint it answered was that the Settings
 * page "is excellent — four options, each with a plain-language gloss" and that
 * nothing routes the author there; copying the wording rather than writing a
 * second, shorter one is what keeps the two surfaces from drifting into two
 * descriptions of one security baseline.
 */
const OWD_OPTION_LABEL_KEY: Record<OwdCreateModel, string> = {
  private: 'engine.studio.settings.sharingPrivate',
  public_read: 'engine.studio.settings.sharingPublicRead',
  public_read_write: 'engine.studio.settings.sharingPublicReadWrite',
};
const OWD_OPTION_DESC_KEY: Record<OwdCreateModel, string> = {
  private: 'engine.studio.settings.sharingDescPrivate',
  public_read: 'engine.studio.settings.sharingDescPublicRead',
  public_read_write: 'engine.studio.settings.sharingDescPublicReadWrite',
};

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

/**
 * objectui#11786 — tells the surface's Publish what edit a pillar holds unsent
 * (`StudioHeld.clause`, or `null`), and takes it back when the pillar unmounts,
 * so a pillar left behind never keeps Publish refusing.
 *
 * Keyed on the clause, a string, never on the view model's identity (AGENTS.md
 * #10); the reporter is read through a ref, so an unmemoised one cannot re-fire it.
 */
function useHeldEditReport(report: ((clause: string | null) => void) | undefined, clause: string | null): void {
  const reportRef = React.useRef(report);
  React.useLayoutEffect(() => {
    reportRef.current = report;
  });
  React.useEffect(() => {
    reportRef.current?.(clause);
  }, [clause]);
  React.useEffect(() => () => reportRef.current?.(null), []);
}

/**
 * objectui#11786 — the line a pillar shows, in place of a refusal, while its
 * autosave holds an incomplete-but-normal edit: what the edit still needs, that
 * it is kept and not yet saved, and a "Show me" that opens the input when it is
 * not the one already open. Neutral on purpose: nothing was refused, and the
 * author has not finished.
 *
 * Exported for its pins; `index.ts` does not re-export it.
 */
export function StudioHeldNotice({
  held,
  locale,
  onShow,
  className,
}: {
  held: StudioHeld;
  locale: string;
  /** Opens the held input; omitted while that input is the one open. */
  onShow?: (target: MetadataSelection) => void;
  /** Spacing and type size, which differ by pillar. */
  className?: string;
}): React.ReactElement {
  return (
    <div
      data-testid="studio-held"
      role="status"
      className={cn('flex items-start gap-2 rounded-md border bg-muted/40 text-muted-foreground', className)}
    >
      <p data-testid="studio-held-message" className="min-w-0 flex-1">
        {tFormat('engine.studio.held.line', locale, { clause: held.clause })}
      </p>
      {onShow && (
        <button
          type="button"
          onClick={() => onShow(held.target)}
          className="shrink-0 rounded border px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
        >
          {t('engine.studio.refusal.show', locale)}
        </button>
      )}
    </div>
  );
}

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

const KIND_ICON: Record<string, LucideIcon> = {
  group: Folder,
  page: FileText,
  object: Database,
  dashboard: LayoutDashboard,
  report: BarChart3,
  view: Table2,
  action: MousePointer2,
  // objectui#11790 — the types the nav editor can now add. A url / component /
  // doc row opens no design surface (`resolveSurface`), so it renders disabled,
  // under its own glyph rather than the generic compass.
  url: LinkIcon,
  component: Puzzle,
  doc: BookOpen,
  separator: Minus,
};
const navIcon = (type?: string): LucideIcon => KIND_ICON[type ?? ''] ?? Compass;


/**
 * objectui#11785 — the strip a pillar shows for a failed save or load. It
 * shows the refusal's sentence, a "Show me" button that opens the input the
 * sentence names, and the raw text (field paths, codes) inside a closed
 * "Details" disclosure. A failure with nothing rewritten (`plainRefusal`) has
 * no detail and renders as the single line it always was.
 *
 * Exported for its pins; `index.ts` does not re-export it.
 */
export function StudioRefusalStrip({
  refusal,
  locale,
  onShow,
  className,
}: {
  refusal: StudioRefusal;
  locale: string;
  /** Opens the target's input in the pillar that raised the refusal. */
  onShow?: (target: MetadataSelection) => void;
  /** Spacing and type size, which differ by pillar. */
  className?: string;
}): React.ReactElement {
  const { message, target, detail } = refusal;
  return (
    <div
      data-testid="studio-refusal"
      className={cn('rounded-md border border-destructive/40 bg-destructive/10 text-destructive', className)}
    >
      <div className="flex items-start gap-2">
        <p data-testid="studio-refusal-message" className="min-w-0 flex-1 whitespace-pre-line">
          {message}
        </p>
        {target && onShow && (
          <button
            type="button"
            onClick={() => onShow(target)}
            className="shrink-0 rounded border border-destructive/40 px-1.5 py-0.5 font-medium hover:bg-destructive/10"
          >
            {t('engine.studio.refusal.show', locale)}
          </button>
        )}
      </div>
      {detail && (
        <details data-testid="studio-refusal-detail" className="mt-1">
          <summary className="cursor-pointer select-none opacity-80">{t('engine.studio.refusal.details', locale)}</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono opacity-90">{detail}</pre>
        </details>
      )}
    </div>
  );
}

/** Top-bar package switcher: list app packages (writable base vs read-only
 * code), switch by navigation, create a new writable base via the standard
 * CreatePackageDialog, and open the standard PackageDetailSheet (info +
 * disable / duplicate / delete / publish …) for the current package. */
/**
 * One sonner id for EVERY `fetchPackages()` failure on this surface
 * (objectui#7368). Three effects call that one endpoint on mount — the
 * switcher list, the writability courtesy gate and the namespace lookup — so a
 * single 503 rejects all three. Sonner UPDATES a toast that already carries the
 * id instead of stacking a new one (the `outcomeToastId` pattern this repo
 * already uses in `packages/components/src/renderers/form/form.tsx`), so one
 * outage produces one toast, not three. Reporting the failure is the point;
 * reporting it three times is noise that would get the report muted.
 */
const PACKAGE_LIST_TOAST_ID = 'studio-package-list';

/**
 * objectui#12453 — a read-only package says so twice: the lock in the app
 * chip, and this link at the right of the open item's header, in every
 * pillar. It names the one way to change an installed package, an
 * environment overlay, and lands on the package's metadata directory
 * (`overlayPath`, the Studio home's read-only package card's route), where
 * each type says whether it accepts an overlay. The pillar's read-only
 * sentence (objectui#11781) is its title.
 *
 * objectui#12707 — at a tab row's end, the link folds to its glyph when the
 * row cannot hold it whole (`useStudioTabRowFold`), rather than being cut
 * mid-word at the row's edge. Folded, its text stays as its accessible name
 * and its title stays its tooltip; where it goes is the same.
 */
function StudioReadOnlyLink({
  packageId,
  title,
  locale,
}: {
  packageId: string;
  title: string;
  locale: string;
}): React.ReactElement {
  const ref = React.useRef<HTMLAnchorElement | null>(null);
  const label = t('engine.studio.pkg.readonlyLink', locale);
  const folded = useStudioTabRowFold(ref, label);
  return (
    <Link
      ref={ref}
      to={overlayPath(packageId)}
      title={title}
      data-testid="studio-readonly-link"
      data-folded={folded || undefined}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-amber-400/15 text-xs font-medium text-amber-700 hover:bg-amber-400/25 dark:text-amber-300',
        folded ? 'w-7 justify-center' : 'px-2.5',
      )}
    >
      <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className={folded ? 'sr-only' : undefined}>{label}</span>
    </Link>
  );
}

/** objectui#12513 — the Studio landing (`BuilderLanding`), where the header's first button and the switcher's first row lead. */
const STUDIO_LANDING_PATH = '/studio';

function PackageSwitcher({
  packageId,
  tab,
  beforeNavigate,
  app = null,
}: {
  /** The package's app, drawn as the chip's icon tile (objectui#12459); `null` draws the neutral tile. */
  app?: AppMarkApp | null;
  /** The open package, or `null` in the package-less scope (objectui#11553). */
  packageId: string | null;
  tab: string;
  /** objectui#2600 — veto hook for package-switch navigation: return false to
   * stay put (the surface prompts about unsaved pillar edits). Not consulted
   * for the deleted-package eviction in onManageChanged — that navigation is
   * forced (the package under the editor is gone). */
  beforeNavigate?: () => boolean;
}): React.ReactElement {
  const navigate = useNavigate();
  const locale = useMetadataLocale();
  // objectui#7373 — where the deleted-package eviction below lands when no
  // other package is left to open: the DECLARED landing, the launcher only when
  // the deployment declares none.
  const homePath = useHomePath();
  const [open, setOpen] = React.useState(false);
  const [pkgs, setPkgs] = React.useState<PkgEntry[] | null>(null);
  /**
   * The last package-list failure, or `null` if the last attempt did not fail
   * (objectui#7368).
   *
   * `pkgs === null` alone cannot say WHY the list is absent, and the trigger's
   * `current?.name ?? packageId` then renders the same raw reverse-domain id
   * for THREE different situations — still loading, the fetch failed, and a
   * package that genuinely declares no name. The author reading `app.b2r4` in
   * the top bar had no way to tell whether to go fix the manifest or to go
   * retry, and nothing else on screen told them either: no toast, no console
   * line. This slot is the second bit that separates them, and the surface
   * spells the three out the same way it already does at the Interfaces rail
   * / Data rail / Automations rail empty states (`error ? loadFailed : loaded
   * ? none : loading`).
   */
  const [pkgsErr, setPkgsErr] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [manage, setManage] = React.useState<InstalledPackageRow | null>(null);
  const [manageOpen, setManageOpen] = React.useState(false);
  const [manageBusy, setManageBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchPackages()
        .then((parsed) => {
          if (cancelled) return;
          setPkgs(parsed);
          setPkgsErr(null);
        })
        .catch((e: unknown) => {
          // objectui#7368 — the switcher still works for navigation-free
          // display, so this stays a DEGRADATION and never a throw: one 503
          // must not take the whole Studio top bar down with it. What it stops
          // being is SILENT. The failure is reported once (toast, this file's
          // own posture — `formatMetadataError` is used at 19 other call
          // sites in this file; this one was the exception, not the rule)
          // and, because a toast disappears while the top bar keeps showing
          // the id forever, it is also RECORDED so the trigger can say which
          // of the three states it is in.
          if (cancelled) return;
          const message = formatMetadataError(e);
          setPkgsErr(message);
          toast.error(message, { id: PACKAGE_LIST_TOAST_ID });
        });
    };
    load();
    // Refresh the switcher list (and thus the top-bar package name) when a
    // package is created or its manifest is edited elsewhere — PackageFormDialog
    // dispatches `objectui:packages-changed` on create/edit. Without this the
    // header showed the OLD name after a rename until a full page reload.
    window.addEventListener('objectui:packages-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('objectui:packages-changed', load);
    };
  }, [packageId]);

  const current = pkgs?.find((p) => p.id === packageId) ?? null;
  /**
   * Which of the three the trigger is showing (objectui#7368). A failure wins
   * over a list already in hand: after a failed refresh the names on screen are
   * stale, and saying "loaded" about them would be the same lie in a new place.
   */
  const pkgListState: 'loading' | 'failed' | 'loaded' =
    pkgsErr !== null ? 'failed' : pkgs === null ? 'loading' : 'loaded';

  // Open the standard detail/management sheet for a package — fetch its full
  // installed record (manifest + status) first, since the switcher only holds
  // the trimmed {id,name,writable} view.
  const fetchFullPackage = React.useCallback(async (id: string): Promise<InstalledPackageRow | null> => {
    const res = await fetch('/api/v1/packages', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    /**
     * ⛔ `res.ok` is not optional here (objectui#7881). The platform answers a
     * failed read in the ADR-0112 envelope — `{ success: false, error: { code,
     * message } }` — and that envelope PARSES CLEANLY through the reader
     * below: `root` becomes the error object, which is neither an array nor
     * carries `packages`, so `list` fell to `[]` and `.find()` to `null`.
     * Nothing threw, `openManage`'s catch never ran, and the management sheet
     * was opened on a null package. An empty list is a completely legitimate
     * SUCCESS answer, so using it for a failure is representing failure with a
     * legitimate success value — the same family as objectui#7368 and
     * objectui#7821 (PR #7879), one seam over.
     *
     * Measured on this path, not assumed. `GET /api/v1/packages` is served by
     * the direct-mount registrar (`@objectstack/rest` `package-routes.ts`,
     * which mounts FIRST in the production stack), and `check:route-envelope`
     * pins that module at zero hand-written bodies: every failure leaves
     * through the shared `sendError` / `sendThrownError`. The reachable
     * failures are `401 UNAUTHENTICATED` (anonymous deny), `403 FORBIDDEN`
     * (the `studio.access` / `setup.access` capability gate), `503
     * SERVICE_UNAVAILABLE` (either half of the two-source merge refusing a
     * read it could not perform) and `500 INTERNAL_ERROR` — one shape,
     * `{ success: false, error: { code, message } }`, pinned wire-side by
     * `package-envelope.conformance.test.ts`.
     *
     * So the envelope's own `success` is NOT a second bit to read here: `sendOk`
     * writes `true` on every 2xx and the error writers write `false` on every
     * non-2xx, which makes it `!res.ok` restated. `res.ok` is the DECISION; the
     * envelope is read for the WORDS, which is the half that needs it — in the
     * 5xx band the platform withholds the producer's prose and answers the
     * generic `Internal server error`, leaving `error.code` as the only
     * discriminating word, so the code travels with the message.
     *
     * The one other shape a browser can meet is a non-JSON error body (a
     * proxy's HTML 502/504). `res.json()` rejects on it — which the caller
     * already reported, as a JSON syntax error — so the tolerant read below
     * names the status instead.
     */
    if (!res.ok) {
      const failure = (await res.json().catch(() => null)) as {
        error?: { code?: unknown; message?: unknown; userMessage?: unknown };
      } | null;
      /**
       * ⭐ `userMessage` OUTRANKS `message`, and the order is the contract's,
       * not a preference (objectui#7938).
       *
       * `error.userMessage` is the producer's channel (objectstack `79c46da90`),
       * and the envelope writer's own words are the rule this line implements:
       * "the text a producer marked, AT THROW TIME, as addressed to the END USER.
       * Presence IS the marking — a consumer that sees the field renders it
       * verbatim and keeps its generic substitution for everything unmarked"
       * (`sendError`, `@objectstack/types` `response-envelope.ts`). This
       * reader was that consumer and did not see the field: it read
       * `error.message` and `error.code` and stopped, so a marked sentence
       * arrived on the wire and had nowhere to appear.
       *
       * The 5xx band is where the loss became visible rather than merely
       * theoretical. That door withholds the producer's PROSE and substitutes
       * the generic `Internal server error` into `error.message` — but the
       * withhold rewrites a local `message` const and `looksLikeInternalErrorLeak`
       * is only ever handed `thrown.message`, so `userMessage` is never an
       * input to it and rides through untouched (`sendThrownError`,
       * `@objectstack/rest` `package-routes.ts`; pinned wire-side by
       * `package-door-user-message.test.ts`). So on a marked 500/503 this
       * reader showed the author the generic sentence and dropped the
       * specific one written for them — nothing invalid displayed, which is
       * exactly what made it quiet.
       *
       * ⛔ NOT scoped to 5xx, deliberately. The marked channel is
       * status-agnostic by the producing door's own ruling — "a marked text is
       * the producer's deliberate statement to the caller at any status" — so
       * a consumer that honoured it only in one band would re-create, on the
       * reading end, precisely the divergence that door refused to create on
       * the writing end. A 4xx `message` is already caller-facing by design;
       * when a producer ALSO marked a text there, the mark is the more
       * specific answer to "what should this person read", and the diagnostic
       * it displaces is not lost to diagnosis — `code` still travels below.
       *
       * ⛔ Not a tolerant alias ladder either: these are two DECLARED fields
       * with different meanings, not two spellings of one. An unmarked refusal
       * carries no `userMessage` at all (the producer's `declaredUserMessage`
       * already applied its non-empty-string rule), so the overwhelmingly
       * common case falls straight through to `message` with byte-identical
       * output.
       */
      const marked = typeof failure?.error?.userMessage === 'string' ? failure.error.userMessage : '';
      const diagnostic = typeof failure?.error?.message === 'string' ? failure.error.message : '';
      const message = marked || diagnostic;
      const code = typeof failure?.error?.code === 'string' ? failure.error.code : '';
      throw new Error(message ? (code ? `${message} (${code})` : message) : `HTTP ${res.status}`);
    }
    const data = (await res.json()) as unknown;
    const root = (data as { data?: unknown })?.data ?? data;
    const list = (Array.isArray(root) ? root : ((root as { packages?: unknown[] })?.packages ?? [])) as Array<
      InstalledPackageRow & { id?: string }
    >;
    return list.find((p) => (p?.manifest?.id ?? p?.id) === id) ?? null;
  }, []);

  const openManage = React.useCallback(
    async (id: string) => {
      setOpen(false);
      setManageBusy(true);
      try {
        const full = await fetchFullPackage(id);
        /**
         * ⛔ The sheet never opens on a `null` package (objectui#7881). With
         * the read above now refusing, `null` means only what it always should
         * have meant: the list came back, and this package is not in it —
         * deleted or uninstalled elsewhere since the switcher last loaded.
         * `PackageDetailSheet` renders `null` for a null `pkg`, so opening it
         * anyway produced a click that did nothing and said nothing, and left
         * `manageOpen` stuck true with no rendered sheet to close it.
         *
         * Reported, not thrown: the read SUCCEEDED, so there is no caught
         * error to format and nothing about the endpoint to report.
         */
        if (!full) {
          toast.error(tFormat('engine.studio.pkg.manageMissing', locale, { id }), {
            id: PACKAGE_LIST_TOAST_ID,
          });
          return;
        }
        setManage(full);
        setManageOpen(true);
      } catch (e) {
        /*
         * This surface's EXISTING objectui#7368 posture, now also carrying the
         * shared sonner id: `fetchFullPackage` is the FOURTH caller of
         * `/api/v1/packages` on this surface (the switcher list, the
         * writability courtesy gate and the namespace lookup are the other
         * three), so one outage that rejects all four is one toast, not four.
         *
         * ⛔ Deliberately NOT also recorded in `pkgsErr`. That slot is the
         * switcher LIST's state and is written exactly where `pkgs` is — the
         * mount effect and `onManageChanged`. This callback never writes
         * `pkgs`, so the names in the trigger are precisely as current as they
         * were a moment ago, and the two sibling `fetchPackages` call sites
         * that likewise do not write the list report the same way.
         */
        toast.error(formatMetadataError(e), { id: PACKAGE_LIST_TOAST_ID });
      } finally {
        setManageBusy(false);
      }
    },
    [fetchFullPackage, locale],
  );

  // A lifecycle action ran in the sheet — refresh the list AND the managed
  // snapshot (so an edit shows immediately). If the managed package was the one
  // we're editing and it's now gone (deleted), return to the Studio landing
  // (home, when no package is left).
  const onManageChanged = React.useCallback(async () => {
    /**
     * `null` means "the refresh did not tell us anything", which is NOT the
     * same fact as "the server listed the packages and yours is not among
     * them" (objectui#7821). Those two used to be the SAME value: `list`
     * started as `[]` and the `.catch` left it that way — the comment there
     * said "keep the stale list", true of the `pkgs` state, which simply is
     * not written, but never of this local. So after a failed
     * `GET /api/v1/packages` the `!list.some(...)` below was unconditionally
     * true, the code took the branch labelled `// Deleted`, and with `list[0]`
     * undefined a transient 503 evicted the author from the editor to
     * `/home` — no toast, no confirmation, package still there. Absence of
     * evidence is not evidence of deletion.
     */
    let list: PkgEntry[] | null = null;
    try {
      list = await fetchPackages();
      setPkgs(list);
      // A list we did receive is current, so it also clears an earlier
      // failure — otherwise the trigger would keep reading `failed` over
      // names that are now fresh.
      setPkgsErr(null);
    } catch (e) {
      // Reported through this surface's EXISTING posture (objectui#7368):
      // `formatMetadataError` on the shared sonner id (one outage, one toast)
      // and recorded, so the trigger reads `failed` rather than showing a
      // stale list as though it were current. ⛔ Still not a `throw` — one
      // 503 must not take the Studio down — and ⛔ still no retry, whose
      // count / backoff / give-up state nobody has ruled on.
      const message = formatMetadataError(e);
      setPkgsErr(message);
      toast.error(message, { id: PACKAGE_LIST_TOAST_ID });
    }
    const managedId = manage?.manifest.id;
    if (!managedId) return;
    // A list we actually received, that does not contain the managed package,
    // is the ONLY evidence of deletion. `list === null` draws no inference
    // either way: the author stays put, and the managed snapshot below is
    // still refreshed (that call reports its own outcome).
    if (list !== null && !list.some((p) => p.id === managedId)) {
      // Deleted — only navigate away if it was the package we're editing.
      // While other packages remain, that is the Studio landing
      // (objectui#11784), where the author picks the next one or creates one;
      // this used to open `list[0]`, whichever package the list started with,
      // so a delete read as "Studio moved me into another app". With nothing
      // left it is still the declared home (objectui#7373).
      if (managedId === packageId) {
        navigate(list.length > 0 ? '/studio' : homePath);
      }
      return;
    }
    /**
     * The managed snapshot behind the OPEN sheet (objectui#7907). A lifecycle
     * action has just run — disable / enable / duplicate / publish /
     * publish-drafts / manifest edit — so the record in `manage` is ALREADY
     * known to be out of date, and this read is what replaces it. Neither way
     * it can fail may be silent, and neither may leave the PRE-ACTION record on
     * screen as though it were current.
     *
     * The arm this replaces was `catch {}` under a comment reading "keep the
     * current snapshot" — true of what it did, and the reason it was wrong:
     * the author disabled the package, was told nothing, and went on reading
     * `Status: Enabled`. ⚠️ It is a PRE-EXISTING defect that objectui#7881
     * (PR #7906) made much easier to hit, NOT a regression from it: before that
     * card `fetchFullPackage` never read `res.ok`, so this catch could only
     * ever see a `res.json()` rejection; now that the helper refuses a non-2xx,
     * the same catch also swallows every 401 / 403 / 503 / 500. Fixing one
     * swallowing site made the next swallowing site swallow more.
     *
     * ⛔ Why the sheet CLOSES rather than staying open on the stale record.
     * `PackageDetailSheet` is an ACTION surface, and it derives its verb from
     * the record it was handed: `enabled = pkg.enabled !== false && pkg.status
     * !== 'disabled'` picks both the button's label and the endpoint it POSTs
     * (`.../${enabled ? 'disable' : 'enable'}`, `PackagesPage.tsx`). Left open
     * over a snapshot we KNOW is pre-action, it does not merely display a stale
     * badge — it re-arms the author with the verb they just fired. Closing it
     * is still a DEGRADATION and not a throw (objectui#7368's standing ruling
     * — one 503 must not take the Studio down): the editor, the top bar and
     * the package list all stay, and reopening the sheet re-runs this same read
     * one click away, which objectui#7881 taught to report its own outcome.
     *
     * ⛔ `manage` is deliberately NOT nulled — a null `pkg` with `manageOpen`
     * still true is precisely the stuck state objectui#7881 fixed, and the next
     * `openManage` overwrites the record anyway.
     *
     * ⛔ Not recorded in `pkgsErr` either, and this arm was MEASURED rather
     * than inherited: that slot is the switcher LIST's state and is written
     * exactly where `pkgs` is — the mount effect and the HEAD of this callback,
     * the only two sites that write either. This TAIL writes neither; it writes
     * `manage`. The head has just recorded the list's own verdict (a fresh list
     * and `null`, or its failure), so writing `pkgsErr` from here would mark
     * the trigger `failed` over names the head refreshed successfully a moment
     * ago — the same lie as objectui#7368's, pointed the other way.
     *
     * ⛔ And no navigation: a snapshot this read could not deliver is not
     * evidence of deletion (objectui#7821). Reporting is not inferring.
     */
    try {
      const fresh = await fetchFullPackage(managedId);
      if (fresh) {
        setManage(fresh);
      } else {
        // The read SUCCEEDED and the package is not in the list — the same
        // fact `openManage` reports when it refuses to open on it, said with
        // the same key. Not a caught error: there is nothing about the
        // endpoint to report.
        toast.error(tFormat('engine.studio.pkg.manageMissing', locale, { id: managedId }), {
          id: PACKAGE_LIST_TOAST_ID,
        });
        setManageOpen(false);
      }
    } catch (e) {
      // This surface's EXISTING objectui#7368 posture — `formatMetadataError`
      // on the shared sonner id, so ONE outage that rejects both halves of this
      // callback is one toast rather than a stack. ⛔ Not a second reporting
      // channel: the message names the consequence the author can see (their
      // panel closed) and carries the server's own words inside it.
      toast.error(
        tFormat('engine.studio.pkg.manageRefreshFailed', locale, {
          id: managedId,
          error: formatMetadataError(e),
        }),
        { id: PACKAGE_LIST_TOAST_ID },
      );
      setManageOpen(false);
    }
  }, [manage, packageId, navigate, fetchFullPackage, locale, homePath]);

  return (
    // Radix Popover (portaled to <body>) — the top bar is `overflow-x-auto`,
    // which forces `overflow-y: auto` too, so an `absolute` panel used to be
    // CLIPPED by the header instead of overlaying the canvas. Portaling escapes
    // that clip. Create / manage open the standard dialog + sheet (also
    // portaled), so neither is subject to the header clip either.
    <Popover open={open} onOpenChange={setOpen}>
      {/* objectui#12611 — the chip's tooltip holds what a narrow chip drops:
          the whole name, the read-only posture, and what the chip does (the
          trigger's former `title`, moved here so one tooltip shows, not two). */}
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="studio-pkg-chip"
                /* objectui#7368 — the trigger's own read of which state it is in.
                   The text beside it is `current?.name ?? packageId`, which is the
                   SAME string in all three states for a package that declares no
                   name, so the state cannot be recovered from the text. */
                data-pkg-list-state={pkgListState}
                /* objectui#12611 — the width cap is the chip's own; how much of it
                   the chip gets is the header column's (`STUDIO_HEADER_PACKAGE_COLUMN`),
                   never the viewport's. */
                className="flex h-8 min-w-0 max-w-[280px] items-center gap-2 whitespace-nowrap rounded-md py-0.5 pl-1 pr-2 text-[13px] font-semibold hover:bg-muted"
              >
                {/* objectui#11553 — the package-less scope names itself; there is
                    no package id to show as the diagnostic handle. */}
                {packageId === null ? (
                  <>
                    <Building2 className="h-4 w-4" /> {t('engine.studio.org.name', locale)}
                  </>
                ) : (
                  <>
                    <AppMark app={app} size="md" />
                    <span data-slot="pkg-name" className="truncate">{current?.name ?? packageId}</span>
                  </>
                )}
                {/* ⛔ Not a replacement for the id (objectui#7368): the id is the one
                    diagnostic handle the author has, so the states are told apart by
                    what stands NEXT to it, never by swapping it for prose. */}
                {pkgListState === 'loading' && (
                  <Loader2
                    data-testid="pkg-switcher-loading"
                    aria-hidden
                    className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
                  />
                )}
                {pkgListState === 'failed' && (
                  <span
                    data-testid="pkg-switcher-failed"
                    title={pkgsErr ?? undefined}
                    className="inline-flex items-center gap-0.5 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-normal text-destructive"
                  >
                    <AlertTriangle className="h-2.5 w-2.5" /> {t('engine.studio.loadFailed', locale)}
                  </span>
                )}
                {/* objectui#12453 — the chip's half of the read-only posture: a
                    lock and the word, muted, after the name. The reason is its
                    title; the item header's link says what to do about it.
                    objectui#12611 — on a narrow header column the word gives way
                    first and the lock stays; the name truncates after it. */}
                {current && !current.writable && (
                  <span
                    data-testid="studio-pkg-readonly"
                    title={t('engine.studio.pkg.readonlyHint', locale)}
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-normal text-muted-foreground"
                  >
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    <span data-slot="pkg-readonly-word" className={STUDIO_PKG_READONLY_WORD}>
                      {t('engine.studio.pkg.readonly', locale)}
                    </span>
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent align="start" className="max-w-xs" data-testid="studio-pkg-chip-tooltip">
            <p className="font-medium">
              {packageId === null ? t('engine.studio.org.name', locale) : (current?.name ?? packageId)}
            </p>
            {current && !current.writable && (
              <p className="mt-0.5 flex items-center gap-1">
                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t('engine.studio.pkg.readonlyHint', locale)}
              </p>
            )}
            <p className="mt-0.5 opacity-80">{t('engine.studio.pkg.switchTitle', locale)}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent align="start" sideOffset={6} className="w-80 rounded-lg p-1.5">
            {/* objectui#12513 — the Studio landing leads the list: the way
                back to every package, recent ones and the organization's
                flows. Gated like every other row here. */}
            <div className="mb-1 border-b pb-1.5">
              <button
                type="button"
                data-testid="studio-switcher-home"
                onClick={() => {
                  setOpen(false);
                  if (beforeNavigate && !beforeNavigate()) return;
                  navigate(STUDIO_LANDING_PATH);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60"
              >
                <HomeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{t('engine.studio.landingHome', locale)}</span>
              </button>
            </div>
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('engine.studio.pkg.heading', locale)}
            </p>
            <div className="max-h-64 overflow-auto">
              {/* Same three-way the Interfaces / Data / Automations rails
                  already spell out in this file — a failed list stops reading
                  "Loading…" forever, and carries WHY. */}
              {pkgListState === 'loading' && (
                <p className="px-2 py-2 text-[11px] text-muted-foreground">{t('engine.studio.loading', locale)}</p>
              )}
              {pkgListState === 'failed' && (
                <p
                  data-testid="pkg-switcher-failed-detail"
                  className="whitespace-pre-line px-2 py-2 text-[11px] text-destructive"
                >
                  {pkgsErr}
                </p>
              )}
              {pkgListState === 'loaded' && pkgs?.length === 0 && (
                <p className="px-2 py-2 text-[11px] text-muted-foreground">{t('engine.studio.pkg.none', locale)}</p>
              )}
              {pkgs?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    // Re-picking the open package would re-navigate to the same
                    // URL — nothing unmounts, so no veto and no history churn.
                    if (p.id === packageId) return;
                    if (beforeNavigate && !beforeNavigate()) return;
                    navigate(`/studio/${encodeURIComponent(p.id)}/${tab}`);
                  }}
                  className={
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ' +
                    (p.id === packageId ? 'bg-muted font-medium' : 'hover:bg-muted/60')
                  }
                >
                  <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.name}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">{p.id}</span>
                  </span>
                  {p.writable ? (
                    <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
                      {t('engine.studio.pkg.writable', locale)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">
                      <Lock className="h-2.5 w-2.5" /> {t('engine.studio.pkg.readonly', locale)}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* objectui#11553 — the package-less scope, reachable from every
                package as it is from the Studio home. It lands on its one
                pillar whatever pillar is open here. */}
            <div className="mt-1 border-t pt-1.5">
              <button
                type="button"
                data-testid="studio-org-scope-entry"
                onClick={() => {
                  setOpen(false);
                  if (packageId === null) return;
                  if (beforeNavigate && !beforeNavigate()) return;
                  navigate(studioOrgScopePath());
                }}
                className={
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ' +
                  (packageId === null ? 'bg-muted font-medium' : 'hover:bg-muted/60')
                }
              >
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t('engine.studio.org.name', locale)}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {t('engine.studio.org.hint', locale)}
                  </span>
                </span>
              </button>
            </div>

            <div className="mt-1 space-y-0.5 border-t pt-1.5">
              {current && (
                <button
                  type="button"
                  onClick={() => void openManage(current.id)}
                  disabled={manageBusy}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  {manageBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Settings className="h-3.5 w-3.5" />}
                  {t('engine.studio.pkg.manage', locale)}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> {t('engine.studio.pkg.new', locale)}
              </button>
            </div>
      </PopoverContent>

      <CreatePackageDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          // Same veto as a switch: the jump into the new package unmounts the
          // current pillar. Declining keeps the edits; the created package
          // stays reachable from the list above.
          if (beforeNavigate && !beforeNavigate()) return;
          navigate(`/studio/${encodeURIComponent(id)}/data`);
        }}
      />
      <PackageDetailSheet
        pkg={manage}
        open={manageOpen}
        onOpenChange={setManageOpen}
        onChanged={onManageChanged}
      />
    </Popover>
  );
}

export interface StudioDesignSurfaceProps {
  /** Open-core slot — the cloud edition injects its AI copilot panel here. */
  aiSlot?: React.ReactNode;
}

export function StudioDesignSurface({ aiSlot }: StudioDesignSurfaceProps): React.ReactElement {
  const params = useParams<{ packageId?: string; tab?: string }>();
  // The route segment: a package id, or the package-less scope's reserved
  // segment (objectui#11553, `studioScope.ts`). URLs are built from it.
  const scopeSegment = params.packageId ?? 'com.example.showcase';
  // `null` in the package-less scope. Every package-scoped read, write and
  // publish below keys on this value, so none of them can be handed the
  // reserved segment as though it named a package.
  const packageId: string | null = isStudioOrgScope(scopeSegment) ? null : scopeSegment;
  const tab = params.tab ?? 'interfaces';
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
  React.useEffect(() => {
    // objectui#11553 — the package-less scope has no package to look up; its
    // writability is decided below, not fetched.
    if (packageId === null) return;
    let cancelled = false;
    setPkgWritable(undefined);
    fetchPackages()
      .then((list) => {
        if (cancelled) return;
        const entry = list.find((p) => p.id === packageId) ?? null;
        setPkgWritable(entry?.writable ?? null);
        setPkgEntry(entry);
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

  // objectui#2600 — the header's pillar links, Home button and PackageSwitcher
  // are pure SPA client navigation, so the editors' `beforeunload` guard never
  // fires; a dirty pillar unmounts silently and its unsaved edits are gone
  // (Access matrix cells, Interfaces nav). Each pillar mirrors its dirty state
  // up (the PR #2588 `onDirtyChange` contract) and every header-driven
  // departure gates on the same native confirm the pillars use internally.
  // Pillars reset their report on unmount, so a confirmed discard clears the
  // flag by itself.
  const [pillarDirty, setPillarDirty] = React.useState(false);
  const confirmLeavePillar = React.useCallback(() => {
    if (!pillarDirty) return true;
    return window.confirm(t('engine.edit.unsavedLeaveConfirm', locale));
  }, [pillarDirty, locale]);
  // Browser-native "leave site?" prompt on tab close / reload while a pillar
  // is dirty. The matrix editor installs its own (double registration is
  // harmless); the Interfaces nav editor has none, so this closes that gap.
  React.useEffect(() => {
    if (!pillarDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for Chrome to actually show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [pillarDirty]);
  // objectui#13253 — the shell's own departures (header menus, palette, inbox,
  // AI entry) leave from buttons this surface never sees, so a dirty pillar
  // registers with the shell's seam, with the same question the header asks.
  // While registered, the seam's link guard also asks before a pillar link
  // leaves, so the pillar links below no longer ask a second time.
  useRegisterUnsavedEdits(pillarDirty, t('engine.edit.unsavedLeaveConfirm', locale));

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
  } = usePendingDrafts({ packageId });
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

  // objectui#11786 — what the open pillar's autosave holds unsent (an
  // incomplete-but-normal edit), as the clause naming what it needs. A publish
  // promotes the drafts the server holds, which do not carry that edit, so it is
  // refused while one is held rather than going around it silently.
  const [heldEdit, setHeldEdit] = React.useState<string | null>(null);

  // `options` is the review sheet's (objectui#12929): its checked backfill
  // choices, or nothing. Only the package batch door below carries it; the
  // sheet offers no choice in the package-less scope.
  const doPublish = React.useCallback(async (options?: DraftPublishOptions) => {
    if (heldEdit !== null) {
      toast.error(tFormat('engine.studio.held.publish', locale, { clause: heldEdit }));
      return;
    }
    setPublishing(true);
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
            failed.push({ type: 'flow', name: d.name, error: formatMetadataError(e) });
          }
        }
        if (failed.length > 0) {
          // Not all-or-nothing: the drafts that went live stay live, and the
          // ones that did not are named with the server's own reason.
          toast.error(formatPublishFailures(failed));
        } else if (pending.length === 0) {
          // objectui#11807 — nothing was pending by the time this read ran, so
          // nothing went live: said as such, never as a success.
          toast.info(t('engine.studio.publishNoneTitle', locale));
          setChangesOpen(false);
        } else {
          // objectui#11807 — how many went live: every draft read above, as
          // none failed.
          toast.success(
            tFormat(
              pending.length === 1 ? 'engine.studio.publishedAllFlowsOne' : 'engine.studio.publishedAllFlows',
              locale,
              { count: pending.length },
            ),
          );
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
      const payload = (await (options
        ? shellClient.publishPackageDrafts(packageId, options)
        : shellClient.publishPackageDrafts(packageId))) as {
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
        toast.error(formatPublishFailures(failed));
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
        if (receipt) {
          const description = formatBackfillReceipt(receipt, locale);
          if (receipt.success === false) toast.warning(title, { description });
          else toast.success(title, { description });
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
  }, [shellClient, packageId, refreshPending, locale, heldEdit]);

  // objectui#11787 — a Studio draft save reports here when it lands, and the
  // count follows it: the read it asks for is sent after the save, never
  // answered by a read already on the wire, and until that read answers the
  // count is at least the one draft the save wrote (`behindSave`). So the
  // header stops saying "No drafts pending publish" in the same render that
  // shows an item's "Unpublished draft" chip, both being set by the save that
  // landed. Pinned by `StudioDesignSurface.changesCount-11787.test.tsx`.
  const onDraftSaved = React.useCallback(() => {
    setDraftNonce((n) => n + 1);
    void refreshPendingRef.current({ afterSave: true });
  }, []);
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
      try {
        const navObjects = appAddObjects ? await loadPackageObjects().catch(() => []) : [];
        // objectui#11773 — a create is the first-write pin: refused where the
        // name already holds a draft, instead of written over it.
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
    planPending: false,
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
  const showSlotProps = React.useCallback(() => {
    setSlotMode('props');
    if (isMobile) setSlotOpenMobile(true);
  }, [isMobile]);
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
      disabled={publishing || !hasPending || readOnly}
      aria-describedby={
        readOnly
          ? publishReadOnlyReasonId
          : !hasPending && !publishing
            ? publishNoneReasonId
            : undefined
      }
      // A read-only package's reason is the wrapper's (objectui#12303), not a
      // `title` the disabled button can never show.
      title={
        readOnly
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
        publishing || (hasPending && !readOnly)
          ? 'border-transparent bg-primary text-primary-foreground disabled:opacity-50'
          : 'text-muted-foreground',
        // The wrapper takes the hover: the disabled button lets it through.
        readOnly && 'disabled:pointer-events-none',
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
                <PackageSwitcher packageId={packageId} tab={tab} beforeNavigate={confirmLeavePillar} app={packageApp} />
              </div>
            </div>
            <nav className={STUDIO_HEADER_PILLAR_NAV} data-testid="studio-pillar-nav">
              {/* objectui#11553 — the package-less scope offers its one pillar. */}
              {(packageId === null ? PILLARS.filter((p) => p.key === STUDIO_ORG_SCOPE_PILLAR) : PILLARS).map((p) => (
                <Link
                  key={p.key}
                  to={`/studio/${scopeSegment}/${p.key}`}
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
                      name and the tooltip. */}
                  <span className="sr-only lg:not-sr-only">{t(`engine.studio.pillar.${p.key}`, locale)}</span>
                </Link>
              ))}
            </nav>

            {/* Package-level draft review + one atomic publish (replaces per-item Publish) */}
            <div className="flex min-w-0 items-center justify-end gap-2">
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
              {!hasPending && !readOnly && !publishing && (
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
                  point `aria-describedby` at an `sr-only` copy of the reason. */}
              {readOnly ? (
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
            ) : tab === 'data' ? (
              <DataPillar
                key={packageId}
                packageId={packageId}
                publishNonce={publishNonce}
                onDraftSaved={onDraftSaved}
                readOnly={readOnly}
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
                onHeldEditChange={setHeldEdit}
              />
            ) : tab === 'access' ? (
              <AccessPillar
                packageId={packageId}
                publishNonce={publishNonce}
                onDraftSaved={onDraftSaved}
                readOnly={readOnly}
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
            planPending={copilotStatus.planPending}
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
          packageId={packageId}
          include={packageId === null ? isOrgScopeDraft : undefined}
          onPublish={readOnly ? undefined : doPublish}
          publishing={publishing}
          posture={changesPosture}
        />

        <CreateItemDialog
          open={appCreating}
          onOpenChange={setAppCreating}
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
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={appAddObjects}
                onChange={(e) => setAppAddObjects(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              {t('engine.studio.app.scaffoldNav', locale)}
            </label>
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

/**
 * The kind tag a nav entry carries at the right of its rail row, and the kind
 * an entry is named by in the header chip and the inspector's eyebrow
 * (objectui#12455). A type the console also names as a metadata type (object,
 * page, dashboard, report) is translated by that one helper, so the rail, the
 * breadcrumb and the canvas caption say the same word; an `object` entry bound
 * to a named view reads "View"; the types that open no design surface (url,
 * action, component, doc) and the two structural ones are named from the
 * Studio's own table. `''` for an entry with no type the spec declares.
 */
function navKindName(node: Pick<NavNode, 'type' | 'viewName'>, locale: string): string {
  const type = node.type ?? '';
  if (type === 'object' && typeof node.viewName === 'string' && node.viewName) {
    return t('engine.studio.if.kind.view', locale);
  }
  if (type === 'object' || type === 'page' || type === 'dashboard' || type === 'report') {
    return translateMetadataType(type, locale);
  }
  if (isNavEntryType(type)) return t(`engine.studio.if.kind.${type}`, locale);
  return '';
}

/**
 * Whether `nodes` hold, at any depth, the entry that opens `active` — so a
 * group the sidebar would collapse opens when the open leaf is inside it.
 */
function navTreeHoldsActive(
  nodes: NavNode[] | undefined,
  active: Surface | null,
  locale: string,
  targetLabel: NavTargetLabelResolver,
): boolean {
  if (!active || !nodes) return false;
  return nodes.some((node) => {
    if (Array.isArray(node.children) && node.children.length) {
      return navTreeHoldsActive(node.children, active, locale, targetLabel);
    }
    const surface = resolveSurface(node, locale, targetLabel);
    return !!surface && isSameSurface(active, surface);
  });
}

/**
 * One group header and its children (objectui#12455). Open or closed as the
 * running app's sidebar opens it (`NavigationRenderer` in `@object-ui/layout`):
 * always open when the open leaf is inside it, else the spec's `expanded` when
 * the author set it, else open — however many children it holds
 * (objectui#13336). Collapsible by its
 * header, as the sidebar's is. A group with nothing in it says so in its place
 * instead of drawing a bare header.
 */
function NavTreeGroup({
  node,
  labelText,
  active,
  onPick,
  objectIcons,
  depth,
}: {
  node: NavNode;
  labelText: string;
  active: Surface | null;
  onPick: (s: Surface) => void;
  objectIcons?: Record<string, string | undefined>;
  depth: number;
}): React.ReactElement {
  const locale = useMetadataLocale();
  const targetLabel = useNavTargetLabel();
  const children = node.children ?? [];
  const holdsActive = navTreeHoldsActive(children, active, locale, targetLabel);
  const [open, setOpen] = React.useState(() => {
    if (holdsActive) return true;
    if (typeof node.expanded === 'boolean') return node.expanded;
    return true;
  });
  // A leaf opened from elsewhere (a deep link, a create) inside a closed
  // group opens the group, as the sidebar does for the route it is on.
  // Adjusted while rendering, on the change, so no effect re-renders it.
  const [heldActive, setHeldActive] = React.useState(holdsActive);
  if (holdsActive !== heldActive) {
    setHeldActive(holdsActive);
    if (holdsActive) setOpen(true);
  }
  return (
    <StudioRailGroup label={labelText} collapsed={!open} onToggle={() => setOpen((v) => !v)}>
      {children.length === 0 ? (
        <p className="flex h-7 items-center pl-[22px] text-xs text-muted-foreground">
          {t('engine.studio.if.emptyGroup', locale)}
        </p>
      ) : (
        <NavTree nodes={children} active={active} onPick={onPick} objectIcons={objectIcons} depth={depth + 1} />
      )}
    </StudioRailGroup>
  );
}

/**
 * Recursive App-navigation tree: groups, separators and typed leaves.
 *
 * objectui#12455 (epic objectui#12446, decision 5) — the rail shows the app's
 * navigation as the shipped sidebar renders it: the same order, the same
 * groups (collapsible, opened as the sidebar opens them, see `NavTreeGroup`),
 * the same icons. Each leaf is one 32 px row: its icon, its label, and its
 * kind as a tag at the right (`navKindName`). The internal `type · name` pair
 * lives on the row's tooltip (objectui#7254), which is also its accessible
 * description; the visible text is what an author reads.
 *
 * objectui#11791 — the rail draws a `separator` and a leaf's `badge` /
 * `badgeVariant` with the decisions the running app's sidebar makes
 * (`NavigationRenderer` in `@object-ui/layout`, which `UnifiedSidebar` mounts),
 * so the design surface agrees with the app it designs. Mirrored, not
 * imported: the sidebar draws both inline in its row renderer, and its rows
 * are `SidebarMenu` items this rail does not use. The pin that holds the two
 * together renders both: `StudioDesignSurface.railSeparatorBadge-11791.test.tsx`.
 */
function NavTree({
  nodes,
  active,
  onPick,
  objectIcons,
  depth = 0,
}: {
  nodes: NavNode[];
  active: Surface | null;
  onPick: (s: Surface) => void;
  /** object name → its metadata icon, so object nav items show their own glyph. */
  objectIcons?: Record<string, string | undefined>;
  /** Nesting depth: a row under a group header is indented one step. */
  depth?: number;
}): React.ReactElement {
  const locale = useMetadataLocale();
  // What a label-less row inherits is asked of the console's own resolver, so
  // the rail names it as the console's sidebar does (objectui#11196).
  const targetLabel = useNavTargetLabel();
  return (
    <>
      {nodes.map((node, i) => {
        // objectui#11158 — the spec types a nav item's `label` as `I18nLabel`,
        // so a locale map rendered raw threw ("Objects are not valid as a
        // React child") and took the whole rail down. Every read below goes
        // through the family's one helper, in the designer locale.
        // objectui#11196 — an ABSENT label shows the text the entry inherits:
        // the runtime's own rule, never a second copy of it.
        // objectui#11791 — a `separator` is a rule between rows, not an entry.
        // The sidebar's decision, mirrored: a decorative `Separator`
        // (`role="none"`), so it is no row to click, no stop for the keyboard,
        // and nothing a screen reader announces. The spec's separator carries
        // `type`, `id` and `order` only, so there is no label or badge to draw.
        if (node.type === 'separator') {
          return <Separator key={node.id ?? i} className="my-2" />;
        }
        const labelText = navEntryLabelText(node, locale, targetLabel);
        if (node.type === 'group' || (Array.isArray(node.children) && node.children.length)) {
          return (
            <NavTreeGroup
              key={node.id ?? i}
              node={node}
              labelText={labelText}
              active={active}
              onPick={onPick}
              objectIcons={objectIcons}
              depth={depth}
            />
          );
        }
        // The same resolver names the Surface a click opens, so the caption,
        // the breadcrumb and the copilot chip read what this row reads.
        const surface = resolveSurface(node, locale, targetLabel);
        // objectui#11862 — an entry that names no target yet ("Add nav item"
        // left unbound, which the editor keeps showing in its place) inherits
        // only its minted `id`. It reads as the editor's untitled wording
        // instead, never `nav_item_N`. "No target" is the save's own rule
        // (`navPayloadOf` leaves exactly these entries out), and an authored
        // label still renders verbatim.
        const untitled = node.label === undefined && navPayloadOf([node]).length === 0;
        // objectui#7254 — a nav item with no declared label used to render an
        // EMPTY row. It shows what it inherits (objectui#11196): its target's
        // current label, else the target's internal name, which is the
        // fallback #7254 chose. `surface?.name` stays for a label that is
        // present but resolves to nothing (an empty map).
        const rowText = untitled ? tFormat('engine.appNav.item', locale, { n: i + 1 }) : labelText || surface?.name || '';
        // Icon precedence: the nav item's own `icon`, then an object surface's
        // own metadata icon, then the type-generic fallback.
        const objIcon = surface?.type === 'object' ? objectIcons?.[surface.name] : undefined;
        const Icon: React.ElementType = node.icon ? getIcon(node.icon) : objIcon ? getIcon(objIcon) : navIcon(node.type);
        // objectui#11774 — the ENTRY is active, not every entry of its target:
        // compared by nav id when both carry one (see `isSameSurface`).
        const isActive = !!surface && !!active && isSameSurface(active, surface);
        const kind = navKindName(node, locale);
        return (
          <StudioRailRow
            key={node.id ?? i}
            onClick={() => surface && onPick(surface)}
            disabled={!surface}
            active={isActive}
            indent={depth > 0}
            // objectui#11862 — the label is what the row says; the machine
            // name is the secondary information, on the tooltip with the type.
            title={surface ? `${surface.type} · ${surface.name}` : rowText || undefined}
            className="disabled:opacity-40"
            icon={<Icon className="h-4 w-4 shrink-0" />}
            trailing={
              <>
                {/* objectui#11791 — the spec's `badge` / `badgeVariant`, drawn
                    when the sidebar row draws them (a present `badge`, a count
                    `0` included) with the same `Badge` and the same variant: an
                    absent `badgeVariant` is `Badge`'s own default, which is the
                    sidebar's. On every leaf, a disabled one too; never on a
                    group heading, where the sidebar draws none. Before the kind
                    tag, so the pill sits beside the text it qualifies. */}
                {node.badge != null && (
                  <Badge variant={node.badgeVariant} className="shrink-0 px-1.5 py-0 text-[10px]">
                    {node.badge}
                  </Badge>
                )}
                {kind && (
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    {kind}
                  </span>
                )}
              </>
            }
          >
            {rowText}
          </StudioRailRow>
        );
      })}
    </>
  );
}

/** Interfaces pillar — real App nav · live canvas · inspector. */
/**
 * StudioNavItemInspector — right-panel editor for the selected nav item while
 * editing an app's navigation. The Studio adds flat top-level items
 * (`navigation[i]`), so binding is a business-friendly picker per type (below,
 * objectui#11790) rather than the raw path field of the generic
 * AppNavInspector. For an `object` entry, picking an object
 * writes `{ type: 'object', objectName }` (which the runtime resolves to that
 * object's record list) and leaves the label as it is (objectui#11196, the
 * shape `AppNavInspector`'s picker has). A label-less entry stays label-less,
 * a standard one (objectui#11201, ruling B): its absent label inherits the
 * object's current label at render time, in the viewer's language. It used to
 * adopt the object's label here, stored as a copy (the machine name for a
 * draft or unlabelled object), and then to remove a "New item" placeholder
 * label; the canvas now births an entry label-less (`AppNavCanvas`), so there
 * is no placeholder left to recognise. A present label renders verbatim, so a
 * label the author typed, a locale map, and a legacy stored "New item" are all
 * kept as authored.
 * The comment used to say it writes `{ object }` — the bare
 * spelling `AppSchema` answers with `unrecognized_keys`; the code has always
 * written the canonical key and cleared `object` (objectui#4881).
 *
 * The Label input edits the item's `label`, an `I18nLabel` (a plain string or
 * an inline locale map), through the same `navItemLabel` module as the canvas
 * card beside it (objectui#11148) and `AppNavInspector`'s Label field
 * (objectui#11196), so the three cannot disagree. Its VALUE is the authored
 * text in the designer locale, and its PLACEHOLDER the text the entry inherits
 * (`inheritedNavEntryText`, the runtime's rule with the console's resolver),
 * never a stored value. Typing writes an author label; an edit of a map writes
 * only that locale's entry and keeps every other one. Emptying the field
 * restores inheritance: `clearedLabel` answers what is left, and when that is
 * nothing the `label` key is REMOVED, never written as `''`. It used to read
 * `String(label ?? title ?? name)`, so a map showed as `[object Object]`, and
 * one keystroke wrote a string over the whole map; until objectui#11196 an
 * emptied field wrote `label: ''`, an entry that then showed nothing instead of
 * inheriting. `title` / `name` are not nav-item keys and are not read as the
 * label.
 *
 * Every type the spec declares (objectui#11790). The nav editor's *Add nav
 * item* births an `object` entry and selects it; this inspector's Type choice
 * then offers exactly the members of the spec's `NavigationItemSchema`
 * (`NAV_ENTRY_TYPES`, keyed by the spec-derived `NavigationItemType`). A change
 * of type keeps what describes the entry and drops what it opened
 * (`retypedNavEntry`), so every write is a shape the spec's strict member for
 * that type takes. Each target-bearing type then picks its target from what the
 * package already has — its pages, dashboards, reports, actions, docs and
 * books, published and draft alike, as the object picker reads the pillar's
 * objects — or, for a `component`, from the screens registered with this
 * console; a `url` is typed. A `group` made here is born with no children
 * (this editor edits top-level entries only, so nothing is nested under it
 * from here), and a `separator` carries no label. An entry holding children
 * changes only to a type that keeps them. An
 * entry whose target is not picked yet, or is cleared, stays in the editor and
 * is left out of what a save sends (`navPayloadOf`, objectui#11776).
 *
 * Exported for tests (`StudioDesignSurface.navItemInspector.test.tsx`) — the
 * object picker's canonical-key binding is pinned there directly rather than
 * by driving the whole pillar. Not re-exported from the package index.
 */
export function StudioNavItemInspector({
  navId,
  appDraft,
  objects,
  packageId,
  onNavPatch,
  onClear,
}: {
  navId: string;
  appDraft: Record<string, unknown>;
  objects: Array<{ name: string; label: string }>;
  /** The package whose items the non-object pickers offer (objectui#11790). */
  packageId: string;
  onNavPatch: (patch: Record<string, unknown>) => void;
  onClear: () => void;
}): React.ReactElement {
  const locale = useMetadataLocale();
  // The console's own resolver for what a label-less entry inherits.
  const targetLabel = useNavTargetLabel();
  const typeGroupName = React.useId();
  const iconFieldId = React.useId();
  const idx = React.useMemo(() => {
    const m = /^navigation\[(\d+)\]$/.exec(navId);
    return m ? Number(m[1]) : -1;
  }, [navId]);
  const nav = React.useMemo(
    () => (Array.isArray(appDraft.navigation) ? (appDraft.navigation as Array<Record<string, unknown>>) : []),
    [appDraft],
  );
  const node = idx >= 0 ? nav[idx] : null;
  // A type the spec declares, else `null`: an untyped entry (what an object
  // unbind leaves) or a spelling no member declares.
  const kind: NavigationItemType | null = node && isNavEntryType(node.type) ? node.type : null;
  // Hooks run before the not-found return below; `undefined` fetches nothing.
  const targets = usePackageNavTargets(packageId, kind ? NAV_TARGET_METADATA[kind] : undefined);
  const books = usePackageNavTargets(packageId, kind === 'doc' ? 'book' : undefined);
  if (!node) {
    return (
      <div className="px-2 py-10 text-center text-xs text-muted-foreground">{t('engine.studio.nav.selectItem', locale)}</div>
    );
  }
  const patch = (updates: Record<string, unknown>) => {
    onNavPatch({ navigation: nav.map((n, i) => (i === idx ? { ...n, ...updates } : n)) });
  };
  /** Replace the entry whole: a write that must leave no key behind. */
  const replace = (next: Record<string, unknown>) => {
    onNavPatch({ navigation: nav.map((n, i) => (i === idx ? next : n)) });
  };
  /**
   * Set the entry's target `key`, or remove it when `value` is empty. ⛔ Never
   * written as `''`: a key holding a string is a target the save sends
   * (`navPayloadOf`), and an emptied picker means the entry is unbound again.
   */
  const setTarget = (key: string, value: string) => {
    const next = { ...node };
    if (value) next[key] = value;
    else delete next[key];
    replace(next);
  };
  /** An `action` entry's target is the action it runs: `actionDef.actionName`. */
  const setAction = (actionName: string) => {
    const next = { ...node };
    if (actionName) next.actionDef = { actionName };
    else delete next.actionDef;
    replace(next);
  };
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  // Canonical key FIRST (objectui#4881). `object` is a spelling `AppSchema`
  // rejects with `unrecognized_keys`, so it can only ever appear on a draft
  // that cannot be saved; when a draft carries both, the picker must show the
  // key the schema accepts, never the one it refuses. Whether the fallback
  // read should exist at all — a draft carrying `object` ALONE still displays
  // as bound — is a follow-up card's question, deliberately left out of #4881's scope.
  const boundObject = String(node.objectName ?? node.object ?? '');
  const label = node.label as I18nLabel | undefined;
  /**
   * The Label field's edit (objectui#11196). Typing writes an author label
   * (`renamedLabel`: a map changes only the designer locale's entry). Emptying
   * the field restores inheritance: `clearedLabel` answers what is left, and
   * when that is nothing the `label` key is REMOVED, never written as `''`.
   */
  const editLabel = (value: string) => {
    const next = value === '' ? clearedLabel(label, locale) : renamedLabel(label, value, locale);
    onNavPatch({
      navigation: nav.map((n, i) => {
        if (i !== idx) return n;
        if (next !== undefined) return { ...n, label: next };
        const rest = { ...n };
        delete rest.label;
        return rest;
      }),
    });
  };
  /**
   * Binding an object to this entry. The label is not touched: a label-less
   * entry stays label-less and inherits the object's label (objectui#11201),
   * and a present one renders verbatim (objectui#11196).
   */
  const bindObject = (objName: string) => {
    // Emit a spec-complete ObjectNavItem: the app schema's nav is a
    // discriminated union on `type` and BaseNavItem requires a snake_case
    // `id`. Missing either fails "navigation.0: Invalid input" at save.
    // `object`/`path` are cleared so no stray keys linger from an off-spec
    // draft.
    patch({
      id: (node.id as string) || `nav_${objName}`,
      type: 'object',
      objectName: objName,
      object: undefined,
      path: undefined,
    });
  };
  const optionsOf = (rows: ReadonlyArray<NavTargetRow>) =>
    rows.map((row) => {
      const text = navItemLabelText(row.label, locale).trim();
      return { value: row.name, label: text && text !== row.name ? `${text} (${row.name})` : row.name };
    });
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const actionDef = node.actionDef as { actionName?: unknown } | undefined;
  // Whether the entry names a target for its type yet (a group and a
  // separator name none, and are never unbound).
  const unbound =
    (kind === 'page' && !str(node.pageName)) ||
    (kind === 'dashboard' && !str(node.dashboardName)) ||
    (kind === 'report' && !str(node.reportName)) ||
    (kind === 'url' && !str(node.url)) ||
    (kind === 'component' && !str(node.componentRef)) ||
    (kind === 'action' && !str(actionDef?.actionName)) ||
    (kind === 'doc' && !str(node.doc) && !str(node.book));
  // objectui#11862 — an entry that names no target yet inherits only its
  // minted `id`; the field offers the editor's untitled wording instead, as the
  // rail names that entry, never `nav_item_N`. "No target" is the save's own
  // rule (`navPayloadOf`).
  const placeholderText =
    navPayloadOf([node]).length === 0
      ? tFormat('engine.appNav.item', locale, { n: idx + 1 })
      : inheritedNavEntryText(node as NavEntryLike, targetLabel);
  const labelField = (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{t('engine.studio.nav.label', locale)}</label>
      <input
        value={navItemLabelText(label, locale)}
        onChange={(e) => editLabel(e.target.value)}
        placeholder={placeholderText}
        className="w-full rounded border bg-background px-2 py-1 text-xs"
      />
    </div>
  );
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1 block text-[11px] font-medium text-muted-foreground">
          {t('engine.inspector.appNav.typeField', locale)}
        </legend>
        <div className="flex flex-wrap gap-1">
          {NAV_ENTRY_TYPES.map((type) => {
            // An entry holding children changes only to a type that keeps them.
            const disabled = hasChildren && !navTypeAcceptsChildren(type);
            return (
              <label key={type} className={cn('relative', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
                <input
                  type="radio"
                  name={typeGroupName}
                  value={type}
                  checked={kind === type}
                  disabled={disabled}
                  onChange={() => replace(retypedNavEntry(node, type))}
                  className="peer sr-only"
                />
                <span className="inline-flex rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-foreground peer-focus-visible:ring-1 peer-focus-visible:ring-ring">
                  {t(`engine.inspector.appNav.type.${type}`, locale)}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {(kind === 'object' || kind === null) && (
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{t('engine.studio.nav.linkObject', locale)}</label>
          <StudioPicker
            value={boundObject}
            options={[
              { value: '', label: t('engine.studio.nav.chooseObject', locale) },
              ...objects.map((o) => ({ value: o.name, label: `${o.label} (${o.name})` })),
            ]}
            onPick={(objName) => {
              if (!objName) {
                // Unbind → back to an (invalid, dropped-on-save) placeholder.
                patch({ type: undefined, objectName: undefined, object: undefined });
                return;
              }
              bindObject(objName);
            }}
            className={PICKER_XS}
            testId="nav-link-object"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {boundObject ? t('engine.studio.nav.boundHint', locale) : t('engine.studio.nav.unboundHint', locale)}
          </p>
          {objects.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              {t('engine.studio.nav.noObjects', locale)}
            </p>
          )}
        </div>
      )}
      {(kind === 'page' || kind === 'dashboard' || kind === 'report') && (
        <NavTargetSelect
          label={t(`engine.inspector.appNav.type.${kind}`, locale)}
          value={str(node[NAV_TARGET_KEY[kind]])}
          options={optionsOf(targets.rows)}
          loading={targets.loading}
          onPick={(v) => setTarget(NAV_TARGET_KEY[kind], v)}
          locale={locale}
        />
      )}
      {kind === 'action' && (
        <NavTargetSelect
          label={t('engine.inspector.appNav.type.action', locale)}
          value={str(actionDef?.actionName)}
          options={optionsOf(targets.rows)}
          loading={targets.loading}
          onPick={setAction}
          hint={t('engine.inspector.appNav.actionHint', locale)}
          locale={locale}
        />
      )}
      {kind === 'component' && (
        <NavTargetSelect
          label={t('engine.inspector.appNav.type.component', locale)}
          value={str(node.componentRef)}
          options={listAppComponents().map((c) => ({
            value: c.ref,
            label: c.label && c.label !== c.ref ? `${c.label} (${c.ref})` : c.ref,
          }))}
          loading={false}
          onPick={(v) => setTarget('componentRef', v)}
          locale={locale}
        />
      )}
      {kind === 'doc' && (
        <>
          <NavTargetSelect
            label={t('engine.inspector.appNav.docPage', locale)}
            value={str(node.doc)}
            options={optionsOf(targets.rows)}
            loading={targets.loading}
            onPick={(v) => setTarget('doc', v)}
            locale={locale}
          />
          <NavTargetSelect
            label={t('engine.inspector.appNav.book', locale)}
            value={str(node.book)}
            options={optionsOf(books.rows)}
            loading={books.loading}
            onPick={(v) => setTarget('book', v)}
            hint={t('engine.inspector.appNav.docHint', locale)}
            locale={locale}
          />
        </>
      )}
      {kind === 'url' && (
        <NavUrlFields
          url={str(node.url)}
          target={str(node.target) || '_self'}
          onUrl={(v) => setTarget('url', v)}
          onTarget={(v) => setTarget('target', v)}
          locale={locale}
        />
      )}
      {unbound && <p className="text-[11px] text-muted-foreground">{t('engine.inspector.appNav.unboundHint', locale)}</p>}
      {kind === 'group' && <p className="text-[11px] text-muted-foreground">{t('engine.inspector.appNav.groupHint', locale)}</p>}
      {navEntryOffersField(kind, 'label') ? (
        labelField
      ) : (
        <p className="text-[11px] text-muted-foreground">{t('engine.inspector.appNav.separatorHint', locale)}</p>
      )}
      {navEntryOffersField(kind, 'icon') && (
        // objectui#12455 — the entry's own `icon`, a Lucide name, as the rail
        // and the running sidebar draw it, picked from the catalog with the
        // console's icon picker (a preview beside the name). Clearing it
        // removes the key (the rail then falls back to the target's icon),
        // never writes `''`.
        <div>
          <label htmlFor={iconFieldId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
            {t('engine.studio.nav.icon', locale)}
          </label>
          <IconPickerWidget
            id={iconFieldId}
            schema={{ type: 'string' }}
            value={str(node.icon)}
            onChange={(v) => setTarget('icon', typeof v === 'string' ? v : '')}
          />
        </div>
      )}
      {node.visible !== undefined && (
        // objectui#12455 — the entry's `visible` predicate, shown as authored:
        // read here, written where the app's metadata is written.
        <div>
          <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{t('engine.studio.nav.visibleWhen', locale)}</span>
          <p className="break-all rounded border bg-muted/40 px-2 py-1.5 font-mono text-xs" data-testid="nav-visible-when">
            {typeof node.visible === 'string' ? node.visible : JSON.stringify(node.visible)}
          </p>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <button
          type="button"
          data-testid="nav-remove-item"
          onClick={() => {
            onNavPatch({ navigation: nav.filter((_, i) => i !== idx) });
            onClear();
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 text-xs text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t('engine.appNav.removeItem', locale)}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('engine.studio.deselect', locale)}
        </button>
      </div>
    </div>
  );
}

/** A nav target the package holds: its machine name and, when published, its label. */
interface NavTargetRow {
  name: string;
  label?: I18nLabel;
}

/**
 * The metadata type each target-bearing nav type picks its target from
 * (objectui#11790). `object` reads the pillar's own object list, `component`
 * the component registry, and a `url` is typed; a `doc` entry also picks a
 * `book`.
 */
const NAV_TARGET_METADATA: Partial<Record<NavigationItemType, string>> = {
  page: 'page',
  dashboard: 'dashboard',
  report: 'report',
  action: 'action',
  doc: 'doc',
};

/** The key a `page` / `dashboard` / `report` entry names its target with — the spec member's own key. */
const NAV_TARGET_KEY = {
  page: 'pageName',
  dashboard: 'dashboardName',
  report: 'reportName',
} as const;

/**
 * Whether a listed row can be a nav target. A record page needs a record id a
 * `page` entry cannot pass (`isStaticPageOption`), and an action bound to an
 * object is not addressable from the nav, which runs GLOBAL actions only
 * (`useNavActionDispatch`). Only a CONFIRMED one is left out: a draft header
 * carries no body, so a draft-only row is kept, as `isStaticPageOption` keeps
 * a row with no `type`.
 */
function isNavTargetRow(metaType: string, row: Record<string, unknown>): boolean {
  if (metaType === 'page') return isStaticPageOption(row as { type?: string });
  if (metaType === 'action') return !row.objectName;
  return true;
}

/**
 * The package's items of `metaType`, published ∪ draft by name (the published
 * row wins, for its label), as the pillar's object list is read
 * (objectui#11790). `undefined` reads nothing. A failed read leaves the
 * picker empty, as the object picker's does.
 */
function usePackageNavTargets(
  packageId: string,
  metaType: string | undefined,
): { rows: ReadonlyArray<NavTargetRow>; loading: boolean } {
  const client = useMetadataClient();
  const key = metaType ? `${metaType}:${packageId}` : '';
  const [state, setState] = React.useState<{ key: string; rows: NavTargetRow[] } | null>(null);
  React.useEffect(() => {
    if (!metaType) return;
    let cancelled = false;
    (async () => {
      const byName = new Map<string, NavTargetRow>();
      try {
        const [published, drafts] = await Promise.all([
          client.list(metaType, { packageId }) as Promise<Array<Record<string, unknown>> | null | undefined>,
          client.listDrafts({ packageId, type: metaType }).catch(() => [] as Array<{ name?: string | null }>),
        ]);
        for (const row of published ?? []) {
          const name = typeof row?.name === 'string' ? row.name : '';
          if (!name || byName.has(name) || !isNavTargetRow(metaType, row)) continue;
          byName.set(name, { name, label: row.label as I18nLabel | undefined });
        }
        // objectui#11862 — a draft-only target carries the label its `_drafts`
        // row serves (objectstack-ai/objectstack#22200), so the picker offers
        // it by that label, as it offers a published one.
        for (const draft of (drafts ?? []) as Array<{ name?: string | null; label?: I18nLabel | null }>) {
          const name = typeof draft?.name === 'string' ? draft.name : '';
          if (name && !byName.has(name)) byName.set(name, { name, label: draft.label ?? undefined });
        }
      } catch {
        /* non-fatal — the picker just stays empty */
      }
      if (!cancelled) setState({ key, rows: [...byName.values()] });
    })();
    return () => {
      cancelled = true;
    };
  }, [client, packageId, metaType, key]);
  if (!metaType) return { rows: [], loading: false };
  return state?.key === key ? { rows: state.rows, loading: false } : { rows: [], loading: true };
}

/** The item a value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/** The classes a nav-inspector picker takes, at the size the native control had. */
const PICKER_XS = 'h-auto rounded px-2 py-1 text-xs';

/**
 * objectui#11865 — one of the design surface's own pickers, drawn with the
 * shared `Select`, the control the rest of Studio picks with: the nav-item
 * inspector's object, target and *Open in* pickers, and the record sharing
 * and trigger pickers of the *New object* and *New automation* dialogs. They
 * used to be browser-native select elements. What a pick writes is unchanged:
 * `onPick` receives the picked option's own `value`, the string the native
 * control's `change` carried, and re-picking the current option writes
 * nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value. The object, target and
 *   trigger pickers open on an option whose value is `''` ("Choose object",
 *   "Choose", "Choose later on the Start node"), which `SelectItem` refuses;
 *   an index cannot collide with an object's or a target's name, as any
 *   stand-in string could.
 * - A value none of the options carries gets an item of its own, labelled
 *   with the value, so the trigger shows what the entry holds. The native
 *   control showed its first option there ("Choose object", "Same tab").
 *   Picking that item writes nothing. A nav target picker never needs it: it
 *   lists the entry's own target already ({@link NavTargetSelect}).
 * - Read-only has no state here: a read-only package closes nav editing, which
 *   unmounts the inspector, and offers neither *New* entry, so neither dialog
 *   opens there.
 * - Each caller keeps the name its native control had: a `<label htmlFor>`
 *   names the trigger by `id`, and a wrapping `<label>` names it as it named
 *   the native control. The object picker had none and still has none.
 */
function StudioPicker({
  id,
  value,
  options,
  onPick,
  className,
  testId,
}: {
  id?: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  className: string;
  testId?: string;
}): React.ReactElement {
  const at = options.findIndex((o) => o.value === value);
  const outside = at === -1 && value !== '';
  return (
    <Select
      value={at !== -1 ? String(at) : outside ? OUTSIDE_OPTIONS : ''}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the stored value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger id={id} data-testid={testId} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {outside && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One nav target picker: the package's items of one type, plus the entry's own
 * target when the list does not hold it (a target another package owns, or a
 * list still loading), so a bound entry never reads as unbound.
 */
function NavTargetSelect({
  label,
  value,
  options,
  loading,
  onPick,
  hint,
  locale,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  loading: boolean;
  onPick: (value: string) => void;
  hint?: string;
  locale: string;
}): React.ReactElement {
  const id = React.useId();
  const shown = value && !options.some((o) => o.value === value) ? [{ value, label: value }, ...options] : options;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <StudioPicker
        id={id}
        value={value}
        options={[{ value: '', label: t('engine.inspector.appNav.choose', locale) }, ...shown]}
        onPick={onPick}
        className={PICKER_XS}
      />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      {!loading && options.length === 0 && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t('engine.inspector.appNav.noTargets', locale)}</p>
      )}
    </div>
  );
}

/** A `url` entry's address, typed, and the window it opens in. */
function NavUrlFields({
  url,
  target,
  onUrl,
  onTarget,
  locale,
}: {
  url: string;
  target: string;
  onUrl: (value: string) => void;
  onTarget: (value: string) => void;
  locale: string;
}): React.ReactElement {
  const urlId = React.useId();
  const targetId = React.useId();
  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={urlId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
          {t('engine.inspector.appNav.url', locale)}
        </label>
        <input
          id={urlId}
          type="url"
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="https://"
          className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
        />
      </div>
      <div>
        <label htmlFor={targetId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
          {t('engine.inspector.appNav.urlTarget', locale)}
        </label>
        <StudioPicker
          id={targetId}
          value={target}
          options={[
            { value: '_self', label: t('engine.inspector.appNav.urlTargetSelf', locale) },
            { value: '_blank', label: t('engine.inspector.appNav.urlTargetBlank', locale) },
          ]}
          onPick={onTarget}
          className={PICKER_XS}
        />
      </div>
    </div>
  );
}

/** The Interfaces pillar's leaf identity, `type:name` (`:` when none is open). */
const leafKeyOf = (s: Surface | null): string => `${s?.type ?? ''}:${s?.name ?? ''}`;

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
}: {
  packageId: string;
  /** objectui#12718 — the package's display name, as the Studio top bar
   * reads it; `undefined` until the package list answers. The pillar names a
   * package with no app by it, so the id shows only when neither exists. */
  packageLabel?: string;
  publishNonce?: number;
  /** Bumped when a draft is saved elsewhere (e.g. the header's create-app flow) — a
   * re-resolve signal so a just-created app appears without a reload. */
  draftNonce?: number;
  onDraftSaved?: () => void;
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
   * confirmed discard clears the surface's guard. */
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
  const railTree = React.useMemo(() => displayNavTree(navTree, servedNav), [navTree, servedNav]);
  const railAppLabel = displayAppLabel(appLabel, servedNav);
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
  React.useEffect(() => {
    if (!readOnly) return;
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
  }, [readOnly, editNav, navDirty]);

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
  // Mirror `navDirty` up to the surface (see the onDirtyChange prop doc).
  // Ref-stabilized like PermissionMatrixEditPage's report, so a non-memoized
  // callback prop doesn't refire the effect; the unmount cleanup reports
  // `false` so a deliberately-discarded pillar clears the host's guard state.
  const onDirtyChangeRef = React.useRef(onDirtyChange);
  React.useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  React.useEffect(() => {
    onDirtyChangeRef.current?.(navDirty);
  }, [navDirty]);
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
    dialog: navConflictDialog,
  } = useDraftSaveGuard(client, reloadNavDraft);
  // The app load also re-reads after every draft save in the package (the
  // `draftNonce` it keys on), its own included. The re-read that follows this
  // pillar's own nav save installs what that save wrote, so the version stays;
  // any other install forgets it. Holds the `publishNonce` the save landed
  // under: a publish in between dropped the draft, version and all.
  const navEchoRef = React.useRef<number | null>(null);
  // objectui#7255 — the copilot dock shares this document, so a turn that
  // staged/published metadata converges the rail here instead of waiting for a
  // page reload. HELD while the nav editor has unsaved (or in-flight) edits:
  // this pillar's load rehydrates `appDraft`, which IS the nav edit buffer, so
  // an unheld pulse would overwrite the author mid-drag. The hold defers, it
  // does not drop — autosave clears `navDirty` within a beat and the pulse
  // lands then.
  const metadataRefreshNonce = useMetadataRefreshNonce(navDirty || !!navSaving);
  const [current, setCurrent] = React.useState<Surface | null>(null);
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
  // `?surface=` capture + mirror — shared plumbing (see useSurfaceDeepLink).
  const initialSurface = useSurfaceDeepLink(current);
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
  // Objects in THIS package (published ∪ draft) — the nav item inspector's
  // object picker, so nav can be wired to sibling objects before publishing.
  const [pkgObjects, setPkgObjects] = React.useState<Array<{ name: string; label: string; icon?: string }>>([]);
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

  React.useEffect(() => {
    let cancelled = false;
    const readUnder = publishNonce;
    (async () => {
      try {
        const [pub, drafts] = await Promise.all([
          client.list('object', { packageId }) as Promise<Array<Record<string, unknown>>>,
          client.listDrafts({ packageId, type: 'object' }).catch(() => [] as Array<Record<string, unknown>>),
        ]);
        if (cancelled) return;
        const byName = new Map<string, { name: string; label: string; icon?: string }>();
        for (const raw of [...(pub || []), ...(drafts || [])]) {
          const o = raw as Record<string, unknown>;
          const name = String(o.name ?? '');
          if (!name || byName.has(name)) continue;
          byName.set(name, { name, label: String(o.label ?? o.name ?? name), icon: o.icon ? String(o.icon) : undefined });
        }
        setPkgObjects([...byName.values()]);
        const publishedNames = new Set((pub || []).map((o) => String((o as Record<string, unknown>).name ?? '')));
        const draftOnly = new Set<string>();
        for (const d of drafts || []) {
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
  }, [client, packageId, publishNonce, draftNonce, metadataRefreshNonce]);

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
        const [layRaw, appDraftRead] = await Promise.all([
          saved ? client.layered<Record<string, unknown>>('app', name) : null,
          readDraftForSave<Record<string, unknown>>(client, 'app', name, packageId),
        ]);
        if (cancelled) return;
        const appDraftResp = appDraftRead.answer;
        const lay = layRaw as { effective?: Record<string, unknown>; code?: Record<string, unknown> } | null;
        const eff = (lay?.effective ?? lay?.code ?? {}) as Record<string, unknown>;
        // objectui#12688 — the list row read above is the server's `/meta`
        // answer, localized for this request; `eff` is the layer it was
        // translated from. A never-saved app has neither, and no served text.
        const served = saved ? servedNavTextOf(eff, published[0]) : null;
        setServedNav(served);
        const appDraftBody = extractDraftBody(appDraftResp);
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
            recordNavRead('app', name, packageId, appDraftRead.pin);
          }
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
  }, [client, packageId, publishNonce, draftNonce, metadataRefreshNonce, navReloadNonce, recordNavRead]);

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
      setHasDraft(false);
      setIfDirty(false);
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
        // version it serves pins that save.
        const draftRead = await readDraftForSave<Record<string, unknown>>(client, current.type, current.name, packageId);
        if (cancelled) return;
        const body = extractDraftBody(draftRead.answer);
        // objectui#11799 — the baseline is read only when it is used, for a
        // leaf with no pending draft. An unsaved leaf always has one, so it
        // never asks `/layers`, which answers 404 for a name with no layer.
        const lay = body ? null : await client.layered<Record<string, unknown>>(current.type, current.name);
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
        // objectui#11773 — the next save is pinned to what the draft read served.
        recordLeafRead(current.type, current.name, packageId, draftRead.pin);
        setHasDraft(!!body);
        setIfDirty(false);
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
  }, [client, current, isEditable, packageId, publishNonce, leafReloadNonce, recordLeafRead, forgetLeafVersion]);

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
    client.layered<Record<string, unknown>>(currentType, currentName).then(
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
  }, [publishedPending, client, currentType, currentName, leafKey]);
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
    try {
      const outcome = await saveLeafDraft(current.type, current.name, interfacesSaveBody(current.type, draft), { mode: 'draft', packageId, surface: 'studio' });
      // objectui#11773 — the author chose the saved version; the load replaces the buffer.
      if (outcome === 'reloaded') return;
      setHasDraft(true);
      setLeafSavedAt({ key: leafKeyOf(current), at: new Date() });
      // objectui#11204 — clean only if nothing was edited while it was in flight.
      if (sent.unmoved()) setIfDirty(false);
      onDraftSaved?.();
    } catch (e) {
      // objectui#11785 — no locator: a leaf's issue paths (page blocks,
      // dashboard widgets) name no input this pillar can open, so the sentence
      // says the draft was refused and Details keep every path.
      setError(issueRefusal(e, locale));
    } finally {
      setSaving(false);
    }
  }, [saveLeafDraft, current, draft, onDraftSaved, packageId, locale]);
  // objectui#11910 — a dashboard edit that leaves a widget's binding out (a
  // widget just added, before its dataset and measures are picked) is held, not
  // sent: the draft door would refuse it with a 422 naming that input. The
  // widget's inspector hints the input, and the line on the canvas names it.
  // Asked of the spec's own widget schema (`dashboardHeldEdit`); a widget that
  // is finished but wrong is sent, and its refusal shows as before.
  const leafType = current?.type;
  const leafIncomplete = React.useMemo(
    () => (ifDirty && leafType === 'dashboard' ? dashboardHeldEdit(draft, locale) : null),
    [ifDirty, leafType, draft, locale],
  );
  const { loaded: draftLoaded } = useDraftAutoSave({
    // objectui#11232 — the leaf `doSave` addresses, `type:name`.
    target: leafKey,
    loadedFor: draftFor,
    dirty: ifDirty,
    blocked: !current || !isEditable || !!saving || readOnly || inspectorBlocking > 0 || leafIncomplete !== null,
    snapshot: draft,
    save: doSave,
  });
  // Only the open leaf's own buffer is held (objectui#11272).
  const leafHeld = draftLoaded ? leafIncomplete : null;
  useHeldEditReport(onHeldEditChange, leafHeld?.clause ?? null);
  // objectui#12725 — the header's draft line reads the badge's ledger.
  const leafDraftStatus = useStudioItemDraftStatus(
    current ? { type: current.type, name: current.name } : null,
    hasDraft && draftLoaded,
    locale,
  );

  // objectui#11823 — an `object` leaf's list view: the third buffer, edited in
  // the Properties panel and shown on the canvas, autosaved to the package
  // draft like the other two. Blocked on `readOnly` like them.
  const listView = useObjectListViewDraft({ client, packageId, leaf: current, publishNonce, draftOnlyObjects, onDraftSaved });
  useDraftAutoSave({
    target: listView.targetKey,
    loadedFor: listView.loadedFor,
    dirty: listView.dirty,
    blocked: !listView.target || listView.saving || readOnly,
    snapshot: listView.row,
    save: listView.save,
  });
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
      const saved = { ...doc, navigation: sentNav };
      const outcome = await saveNavDraft('app', appName, saved, { mode: 'draft', packageId, surface: 'studio' });
      // objectui#11773 — the author chose the saved version; the load replaces
      // the buffer, and with it any failure this editor showed (objectui#11776).
      if (outcome === 'reloaded') {
        setNavError(null);
        return;
      }
      navEchoRef.current = publishNonce;
      navBaselineRef.current = saved;
      setNavHasDraft(true);
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
      onDraftSaved?.();
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
  }, [saveNavDraft, appName, appDraft, onDraftSaved, packageId, publishNonce, locale]);
  // objectui#5813 — nav edits auto-save while edit mode is open.
  const { flush: flushNavSave, sending: navSending } = useDraftAutoSave({
    // objectui#11232 — the app `doNavSave` addresses. The package is this
    // pillar's mount (it is keyed by package where the surface renders it).
    target: `app:${appName ?? ''}`,
    loadedFor: appDraftFor,
    dirty: navDirty,
    blocked: !appName || !editNav || !!navSaving || readOnly,
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
  const openCreate = React.useCallback((kind: InterfaceCreateKind) => {
    setCreateError(null);
    setReportBinding(NO_REPORT_BINDING);
    setPageKind(DEFAULT_PAGE_SOURCE_KIND);
    setCreateKind(kind);
  }, []);
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
      if (readOnly || !appName) return;
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
    [readOnly, appName, appDraft, onNavPatch, setInspectorCollapsed, isMobile],
  );
  const doCreateSurface = React.useCallback(
    async (
      kind: InterfaceCreateKind,
      label: string,
      name: string,
      binding: ReportBinding,
      sourceKind: PageSourceKind,
    ) => {
      if (readOnly || !appName || editNav) return;
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
    isSourcePage && !readOnly ? (
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
        {t('engine.studio.if.modeDesign', locale)}
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
        {t('engine.studio.if.modeRun', locale)}
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
  // objectui#12725 — the item's ⋯ menu: its definition, and its document as
  // JSON. Rename and delete are not offered here: this header has neither
  // today (a nav entry is renamed and removed in nav editing).
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
        <DropdownMenuContent align="end" className="w-44">
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
  const ifHeaderEl = (
    <StudioItemHeader
      testId="if-item-header"
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
            {current.label || current.name}
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
          <span className={STUDIO_KIND_CHIP} data-testid="if-canvas-caption" title={ifInternalId}>
            <span className="sr-only">{current.label || current.name} · </span>
            {ifKindName}
          </span>
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
          {readOnly && (
            <StudioReadOnlyLink packageId={packageId} title={t('engine.studio.pkg.readonlyHint', locale)} locale={locale} />
          )}
          {isObjectLeaf && openSurface && current && (
            <button
              type="button"
              data-testid="if-open-in-data"
              onClick={() => openSurface({ type: 'object', name: current.name })}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs text-foreground hover:bg-muted"
            >
              <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              {t('engine.studio.if.openInData', locale)}
            </button>
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
      {(error || navError || leafHeld) && (
        <div className="mb-3 flex shrink-0 flex-col gap-1.5">
          {/* objectui#11776 — the pillar's failure and the nav editor's own,
              each cleared by what settles it, the same failure shown once.
              objectui#11785 — each as a refusal strip; the nav editor's "Show
              me" opens nav editing on the entry it names. */}
          {error && <StudioRefusalStrip refusal={error} locale={locale} className="px-3 py-2 text-xs" />}
          {navError && !(error && error.message === navError.message && error.detail === navError.detail) && (
            <StudioRefusalStrip
              refusal={navError}
              locale={locale}
              onShow={(target) => {
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
              onShow={
                selection?.kind === leafHeld.target.kind && selection.id === leafHeld.target.id
                  ? undefined
                  : (target) => setSelection(target)
              }
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
        {appStatus === 'missing' && !error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <LayoutDashboard className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">{t('engine.studio.if.noAppTitle', locale)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('engine.studio.if.noAppHint', locale)}</p>
            </div>
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
            // inspector, read-only.
            onPatch={readOnly ? undefined : onPatch}
            locale={locale}
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
            readOnly={readOnly}
            locale={locale}
            // objectui#12725 — the pillar's selection, which a canvas header click also makes.
            selection={selection}
            onSelectionChange={setSelection}
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
          // Data pillar threads it (objectui#2259).
          readOnly={readOnly}
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
            onPatch={readOnly ? undefined : onPatch}
            readOnly={readOnly}
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
            readOnly={readOnly}
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
      footer={readOnly ? null : t('engine.studio.inspector.draftFooter', locale)}
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      {inspectorBodyEl}
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
            {tFormat('engine.studio.if.definitionTitle', locale, { label: current.label || current.name })}
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
                onPatch={readOnly ? undefined : onPatch}
                readOnly={readOnly}
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

  return (
    <div className="flex h-full flex-col">
      {leafConflictDialog}
      {navConflictDialog}
      {listView.conflictDialog}
      {/* objectui#11823 (steps 2 and 3) — the shared create dialog; a report
          also asks for its dataset and one measure (`ReportCreateFields`), a
          page for its source kind (`PageCreateFields`). */}
      <CreateItemDialog
        open={createKind !== null && !readOnly}
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
        description={tFormat('engine.studio.interfaces.create.description', locale, {
          app: navItemLabelText(appLabel, locale),
        })}
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
            <ReportCreateFields value={reportBinding} onChange={setReportBinding} locale={locale} />
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
              {appStatus === 'ready' && !readOnly && !editNav && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="if-create-menu"
                      aria-label={t('engine.studio.if.addMenuTitle', locale)}
                      title={t('engine.studio.if.addMenuTitle', locale)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[268px] p-1.5" data-testid="if-add-kind-menu">
                    <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {t('engine.studio.if.addMenuTitle', locale)}
                    </DropdownMenuLabel>
                    {NAV_ENTRY_TYPES.map((kind) => {
                      const KindIcon = navIcon(kind);
                      const creates = kind === 'page' || kind === 'dashboard' || kind === 'report';
                      return (
                        <React.Fragment key={kind}>
                          {kind === 'group' && <DropdownMenuSeparator />}
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
              {appStatus === 'ready' && !readOnly && (
                <button
                  type="button"
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
          isMobile={isMobile}
          open={railOpen}
        >
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
            {appStatus === 'missing' && !error ? (
              <div className="px-2 py-3">
                <p className="text-[11px] text-muted-foreground">{t('engine.studio.if.noApp', locale)}</p>
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
              />
            ) : navTree.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-muted-foreground">
                {error
                  ? t('engine.studio.loadFailed', locale)
                  : appStatus === 'loading'
                    ? t('engine.studio.loading', locale)
                    : t('engine.studio.if.noNavItems', locale)}
              </p>
            ) : (
              <NavTree
                nodes={railTree}
                active={current}
                objectIcons={objectIconMap}
                onPick={(s) => {
                  setCurrent(s);
                  if (isMobile) setRailOpen(false);
                }}
              />
            )}
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
  );
}

/** Next unused `field_N` name for a freshly-added field. */
function nextFieldName(existing: string[]): string {
  let i = existing.length + 1;
  let name = `field_${i}`;
  while (existing.includes(name)) name = `field_${++i}`;
  return name;
}

/**
 * The api name of a field added with `label` (objectui#12516): the name the
 * field inspector's Label derives from it (`toFieldNameLoose`), or, as the
 * inspector keeps the default when that derivation is empty (a label with no
 * Latin letters) or names another field, the next free `field_<N>`. The Add
 * field popover asks for the name in those two cases (objectui#13389), so the
 * `field_<N>` fallback is left for a caller that hands no name.
 */
function addedFieldName(label: string, existing: string[]): string {
  const derived = toFieldNameLoose(label);
  return derived && !existing.includes(derived) ? derived : nextFieldName(existing);
}

/**
 * Data pillar — the package's objects: a records grid (Airtable parity) plus
 * table-based field management. Add a field, or click a column header's edit
 * affordance, to open ObjectFieldInspector (full type list + per-type config)
 * in the right panel; changes persist via the object draft → publish overlay.
 */
/**
 * Framework-managed/audit fields. They lead the raw metadata order but aren't
 * what a user manages in a data grid, so the Data pillar drops them from the
 * column set (mirrors ObjectGrid's regular-vs-system split) to open on the
 * meaningful fields first — the same way Airtable hides system columns.
 *
 * objectui#11780 — this list is no longer the only test. The columns the
 * platform injects AND hides (`system: true` + `hidden: true` on the served
 * definition: `__search`, `owning_business_unit_id`, `organization_id`) are
 * dropped by `isStudioHiddenSystemField`, read off each field's definition
 * beside this list. The list keeps its own job: the audit columns are
 * `system` but NOT `hidden` in the platform's own definitions
 * (`AUDIT_FIELD_DEFS`), so the marks alone would put them back.
 */
const STUDIO_SYSTEM_FIELD_NAMES = new Set<string>([
  '_id', 'id', 'organization_id', 'org_id', 'space_id',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'modified_at', 'modified_by', 'created_time', 'modified_time', 'updated_time',
  'deleted_at', 'deleted_by',
]);

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

/**
 * The form fields of an object definition's `fields`, in metadata order: the
 * platform's injected-and-hidden fields (objectui#11780) and the audit fields
 * dropped. Read for the draft (`formFields`) and the published baseline.
 */
function formFieldNames(fields: unknown): string[] {
  return readFields(fields)
    .entries.filter((e) => !isStudioHiddenSystemField(e.def))
    .map((e) => e.name)
    .filter((n) => !STUDIO_SYSTEM_FIELD_NAMES.has(n));
}

/** The data-source writes the Form tab's Preview refuses (objectui#12515). */
const PREVIEW_REFUSED_WRITES = new Set<PropertyKey>(['create', 'update', 'delete', 'bulk', 'bulkUpdate', 'bulkDelete']);

/**
 * objectui#12515 — the data source the Form tab's Preview hands the runtime
 * `ObjectForm`, the same renderer the app's record form uses.
 *
 * The form reads the object's definition only through
 * `dataSource.getObjectSchema(name)`. With `draft` given, that read answers for
 * the open object from the pillar's buffer (the draft as served, plus the
 * edits not yet saved), so a draft-only object previews without a server read
 * and a published one previews its pending change. Every other read (another
 * object's definition, a lookup's options) goes to the real adapter.
 *
 * Preview never saves: the writes in `PREVIEW_REFUSED_WRITES` reject, in the
 * Draft and the Published preview alike.
 */
function formPreviewSource(
  adapter: object | null,
  draft: { name: string; definition: Record<string, unknown> } | null,
): object | null {
  // No adapter, no data source: the form says so, as it does today.
  if (!adapter) return null;
  return new Proxy(adapter, {
    get(target, prop) {
      if (PREVIEW_REFUSED_WRITES.has(prop)) {
        return () => Promise.reject(new Error('The form preview does not save.'));
      }
      if (draft && prop === 'getObjectSchema') {
        const read = Reflect.get(target, prop, target) as ((name: string) => Promise<unknown>) | undefined;
        return (name: string) =>
          name === draft.name
            ? Promise.resolve(structuredClone({ ...draft.definition, name: draft.name }))
            : read
              ? read.call(target, name)
              : Promise.reject(new Error(`No definition for "${name}".`));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// Exported for tests (StudioDesignSurface.emptyPackage.test.tsx) — the empty-
// package behavior (no forced creator modal, empty-state CTA) lives here.
export function DataPillar({
  packageId,
  publishNonce = 0,
  onDraftSaved,
  readOnly = false,
  onHeldEditChange,
}: {
  packageId: string;
  publishNonce?: number;
  onDraftSaved?: () => void;
  /** Courtesy gate: hide/disable metadata-authoring affordances (records stay usable). */
  readOnly?: boolean;
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
  // objectui#7255 — the copilot dock shares this document; a turn that staged
  // or published metadata re-reads this rail in place. No hold is needed: the
  // rail load only replaces the LIST (the per-object edit buffer is loaded by
  // its own `loadedNameRef`-guarded effect and is never touched here).
  const metadataRefreshNonce = useMetadataRefreshNonce();
  const [current, setCurrent] = React.useState<Surface | null>(null);
  // `?surface=object:<name>` capture + mirror — the app→Studio bridge
  // (ADR-0080, `appStudioObjectPath`) lands here with a specific object;
  // shared plumbing (see useSurfaceDeepLink).
  const initialSurface = useSurfaceDeepLink(current);
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
  const requestedSurface = useRequestedSurface();
  const appliedRequestRef = React.useRef(0);
  React.useEffect(() => {
    if (!requestedSurface || !objectsLoaded) return;
    if (requestedSurface.id === appliedRequestRef.current) return;
    appliedRequestRef.current = requestedSurface.id;
    const match = resolveSurfaceDeepLink(objects, requestedSurface.target, 'object');
    if (match) setCurrent(match);
  }, [requestedSurface, objects, objectsLoaded]);
  const [objDraft, setObjDraft] = React.useState<Record<string, unknown>>({});
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
  // The count is STAMPED with the selection it came from, so it expires by
  // construction when the selection changes or the panel closes: an unmounted
  // inspector can never retract its last verdict, and a host that waited for
  // one would leave Save wedged shut with nothing on screen to fix.
  const [blockingReport, setBlockingReport] = React.useState({ key: '', count: 0 });
  const fieldSelKey = fieldSel ? `${current?.name ?? ''}:${fieldSel.kind}:${fieldSel.id}` : '';
  const inspectorBlocking = blockingReport.key === fieldSelKey ? blockingReport.count : 0;
  // The pillar's PANEL family reports separately (objectui#4527): the
  // validations, actions and settings panels all write through this same draft
  // and own no Save of their own, so their CEL faults have to reach this
  // button too. Kept apart from the field inspector's count above because the
  // two expire on different things.
  //
  // Stamped with the panel TAB: exactly one panel is mounted at a time, so
  // leaving the tab unmounts the reporter and it can never retract its last
  // verdict — deriving against the live tab is what stops a fault authored
  // under Validations from wedging Save on a tab with no CEL editor at all.
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
  // Either source closes the door: a malformed field formula and a malformed
  // rule guard are both unsaveable, and neither excuses the other.
  const saveBlocking = inspectorBlocking + panelBlocking;
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
  // objectui#12508 — the names the package's published list answered at the
  // rail's last read; `null` until it has answered. The object load below
  // reads it to tell a draft-only object from a published one.
  const publishedObjectNamesRef = React.useRef<ReadonlySet<string> | null>(null);
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
  // Left-rail search + inline "new object" creator (design §4: rail = search + New).
  const [query, setQuery] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  // The OWD the create dialog will author (`7a90afdf9`). Pre-selected to the
  // platform's own recommended baseline; the author sees it and can change it
  // before the object exists. Reset by `openCreateDialog` below rather than by
  // an effect on `creating` — the effect spelling re-renders the dialog a
  // second time on every open purely to undo a previous session's pick.
  const [createOwd, setCreateOwd] = React.useState<OwdCreateModel>(OWD_DEFAULT);
  const openCreateDialog = React.useCallback(() => {
    setError(null);
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
  // The package's object-name namespace (framework#2694). New objects are
  // auto-prefixed with `<namespace>_` so an author can never draft a prefix-less
  // object that publish would later reject (code NAMESPACE_PREFIX).
  const [namespace, setNamespace] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchPackages()
      .then((list) => {
        if (!cancelled) setNamespace(list.find((p) => p.id === packageId)?.namespace ?? null);
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
  }, [packageId]);

  React.useEffect(() => {
    let cancelled = false;
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
        const [list, draftHeaders, draftLabels] = await Promise.all([
          client.list('object', { packageId }) as Promise<Array<Record<string, unknown>>>,
          client.listDrafts({ packageId, type: 'object' }).catch(() => []),
          readDraftLabels().catch(() => new Map<string, string>()),
        ]);
        if (cancelled) return;
        const items = (list || [])
          .map((o) => ({ type: 'object', name: String(o.name ?? ''), label: String(o.label ?? o.name ?? ''), icon: o.icon ? String(o.icon) : undefined }))
          .filter((o) => o.name);
        const known = new Set(items.map((o) => o.name));
        publishedObjectNamesRef.current = new Set(known);
        for (const d of draftHeaders) {
          if (d.name && !known.has(d.name)) {
            items.push({ type: 'object', name: d.name, label: draftLabels.get(d.name) ?? d.name, icon: undefined });
          }
        }
        setObjects(items);
        // Honor a `?surface=object:<name>` deep-link when it names an object we
        // actually have; otherwise open the first object as before.
        const deepLinked = resolveSurfaceDeepLink(items, initialSurface, 'object');
        setCurrent((c) => c ?? deepLinked ?? items[0] ?? null);
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
  }, [client, packageId, readOnly, metadataRefreshNonce]);

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
    setDirty(false);
    (async () => {
      try {
        // objectui#11773 — the draft is read at the address the object saves
        // write, so the version it serves pins the first of them.
        const readLayers = () => client.layered<Record<string, unknown>>('object', current.name);
        const readDraft = () => readDraftForSave<Record<string, unknown>>(client, 'object', current.name, packageId);
        // objectui#12508 — a draft-only object (a pending draft, and no row in
        // the package's published list) has no layer, and `/layers` answers
        // 404 for it. So for a name the published list does not hold, the
        // draft is read first and the layers only without one: a name
        // published since the rail's read has no pending draft either, so it
        // is still asked. A published name reads both at once, as before.
        const publishedNames = publishedObjectNamesRef.current;
        let layRaw: unknown;
        let draftRead: Awaited<ReturnType<typeof readDraft>>;
        if (publishedNames && !publishedNames.has(current.name)) {
          draftRead = await readDraft();
          if (cancelled) return;
          layRaw = extractDraftBody(draftRead.answer) ? {} : await readLayers();
        } else {
          [layRaw, draftRead] = await Promise.all([readLayers(), readDraft()]);
        }
        if (cancelled) return;
        const lay = layRaw as { effective?: Record<string, unknown>; code?: Record<string, unknown> };
        const baseline = (lay.effective ?? lay.code ?? {}) as Record<string, unknown>;
        const draftBody = extractDraftBody(draftRead.answer);
        // Served draft as-is, baseline only without one (objectui#10765).
        setObjDraft(draftBody ?? baseline);
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

  const fieldCount = React.useMemo(() => readFields(objDraft.fields).entries.length, [objDraft]);

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
  const gridColumns = React.useMemo(
    () =>
      readFields(objDraft.fields)
        // objectui#11780 — a column the platform injects AND hides (`__search`,
        // `owning_business_unit_id`) is no column an author manages. Read off
        // the definition this memo already holds, so the key stays
        // `objDraft.fields` and the identity reasoning above is unchanged.
        .entries.filter((e) => !isStudioHiddenSystemField(e.def))
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
        .filter((n) => publishedFieldNames.has(n)),
    [objDraft.fields, publishedFieldNames],
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
  const formFields = React.useMemo(() => formFieldNames(objDraft.fields), [objDraft.fields]);

  // objectui#12515 — what the Form tab's Preview renders. The draft differs
  // from the published definition when there is no published one, a pending
  // draft, or an unsaved edit; then Preview shows the draft unless the author
  // picked Published (offered only when a published version exists).
  const draftDiffers = !hasBaseline || hasDraft || dirty;
  const previewShowsDraft = !hasBaseline || (draftDiffers && previewSource === 'draft');
  const previewDraft = previewShowsDraft ? objDraft : null;
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

  // "+ new object": create a fresh object as a DRAFT in this package (runtime
  // create — same path the classic Studio editor uses), seeded with one text
  // field so the form/grid isn't empty. It stays draft-only (no physical table)
  // until the package publish, so we land on Form · Layout — the metadata-level
  // surface that never fires data SQL.
  const doCreateObject = React.useCallback(
    async (label: string, rawName: string, sharingModel: OwdCreateModel) => {
      if (readOnly) return;
      // Auto-prefix with the package namespace (framework#2694) so a prefix-less
      // object can't be authored; the rule lives in packages-io/spec.
      const name = prefixObjectName(rawName, namespace);
      if (objects.some((o) => o.name === name)) {
        setError({ message: tFormat('engine.studio.data.idExists', locale, { name }) });
        return;
      }
      setCreateBusy(true);
      setError(null);
      try {
        const body = buildObjectSkeleton(name, label, t('engine.studio.data.nameFieldLabel', locale), sharingModel);
        // objectui#11773 — a create is the first-write pin: refused where the
        // name already holds a draft, instead of written over it.
        await client.save('object', name, body, { mode: 'draft', packageId, ifNoneMatch: '*', surface: 'studio' });
        const surface: Surface = { type: 'object', name, label };
        setObjects((prev) => [...prev, surface]);
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
    [objects, client, packageId, onDraftSaved, readOnly, locale, namespace],
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
      // No success toast: with auto-save (objectui#5813) it would fire after
      // every editing pause — the quiet last-saved hint is the affordance.
      onDraftSaved?.();
    } catch (e) {
      setError(objectSaveRefusal(e, body, locale));
    } finally {
      setSaving(false);
    }
  }, [saveObjDraft, current, objDraft, onDraftSaved, packageId, locale]);

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
  const { sending: sendingObjDraft, loaded: objLoaded } = useDraftAutoSave({
    // objectui#11232 — the object `doSave` addresses.
    target: `object:${current?.name ?? ''}`,
    loadedFor: objDraftFor,
    dirty,
    blocked: !current || !!saving || readOnly || saveBlocking > 0 || objIncomplete !== null,
    snapshot: objDraft,
    save: doSave,
  });
  // Only the open object's own buffer is held (objectui#11272).
  const objHeld = objLoaded ? objIncomplete : null;
  // objectui#12725 — the copilot's mark on the selected field: its key path is
  // `["fields", NAME]` in the object body, and only a `copilot` write answers.
  const fieldCopilotMark =
    objLoaded && fieldSel?.kind === 'field' ? copilotDraftMarkOf(objDraftChanges, ['fields', fieldSel.id]) : null;
  useHeldEditReport(onHeldEditChange, objHeld?.clause ?? null);
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
    if (readOnly || !objLoaded) return;
    const view = readFields(objDraft.fields);
    const existing = view.entries.map((e) => e.name);
    const name = typedName && !existing.includes(typedName) ? typedName : addedFieldName(label, existing);
    view.entries.push(newField(name, type, label));
    setObjDraft((d) => ({ ...d, fields: writeFields(view) }));
    setDirty(true);
    setFieldSel({ kind: 'field', id: name });
  }, [objDraft, readOnly, objLoaded]);
  const addFieldTakenNames = React.useMemo(
    () => readFields(objDraft.fields).entries.map((e) => e.name),
    [objDraft.fields],
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
        onDraftSaved?.();
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

  return (
    <div ref={pillarRef} className="flex h-full flex-col">
      {objConflictDialog}
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
          onAdd={readOnly ? undefined : openCreateDialog}
          addLabel={t('engine.studio.data.newObject', locale)}
          addTestId="studio-rail-add"
          search={{ value: query, onChange: setQuery, placeholder: t('engine.studio.data.searchObjects', locale) }}
          isMobile={isMobile}
          open={railOpen}
        >
          {objects.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">
              {error ? t('engine.studio.loadFailed', locale) : objectsLoaded ? t('engine.studio.data.noObjects', locale) : t('engine.studio.loading', locale)}
            </p>
          )}
          {objects
            .filter(
              (o) =>
                !query.trim() ||
                o.label.toLowerCase().includes(query.trim().toLowerCase()) ||
                o.name.toLowerCase().includes(query.trim().toLowerCase()),
            )
            .map((o) => {
              const Icon = getIcon(o.icon);
              return (
                <StudioRailRow
                  key={o.name}
                  active={current?.name === o.name}
                  onClick={() => {
                    setCurrent(o);
                    if (isMobile) setRailOpen(false);
                  }}
                  icon={<Icon className="h-4 w-4 shrink-0" />}
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
            meta={current && objLoaded ? tFormat('engine.studio.data.fieldCount', locale, { count: fieldCount }) : undefined}
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
                ) : savedAt && !dirty ? (
                  <span className="text-[11px] text-muted-foreground" data-testid="data-saved-at">
                    {tFormat('engine.studio.data.lastSaved', locale, {
                      time: savedAt.toLocaleTimeString(displayLocale, { hour: '2-digit', minute: '2-digit' }),
                    })}
                  </span>
                ) : null}
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
                {readOnly && (
                  <StudioReadOnlyLink
                    packageId={packageId}
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
                {!readOnly && (
                  <button
                    type="button"
                    data-testid="empty-state-new-object"
                    onClick={openCreateDialog}
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
                  // objectui#11785 — "Show me" opens the named field's inspector.
                  onShow={(target) => setFieldSel({ kind: target.kind, id: target.id })}
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
                      : (target) => setFieldSel({ kind: target.kind, id: target.id })
                  }
                  className={cn('mb-2 px-3 py-1.5 text-[11px]', bodyFlush && 'mx-6 mt-3')}
                />
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
                <ObjectValidationsPanel
                  draft={objDraft}
                  onPatch={onPatch}
                  disabled={readOnly}
                  onBlockingIssuesChange={reportPanelBlocking}
                />
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
                <ObjectActionsPanel
                  draft={objDraft}
                  onPatch={onPatch}
                  disabled={readOnly}
                  actionSchema={typeSchemas.action}
                  onBlockingIssuesChange={reportPanelBlocking}
                />
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
                {!readOnly && (
                  <AddFieldPopover
                    open={gridAddFieldOpen}
                    onOpenChange={setGridAddFieldOpen}
                    onCreate={addField}
                    takenNames={addFieldTakenNames}
                    returnFocusTo={() => gridAddFieldButton.current}
                  >
                    <span aria-hidden="true" className="pointer-events-none absolute right-4 top-2 h-0 w-0" />
                  </AddFieldPopover>
                )}
                <GridFieldAuthoringProvider
                  value={{
                    // Read-only package: keep the per-column inspector (view props)
                    // but drop add-column and drag-reorder — both are doomed writes.
                    ...(readOnly
                      ? {}
                      : {
                          onAddColumn: () => setGridAddFieldOpen(true),
                          addColumnLabel: t('engine.studio.data.addField', locale),
                          onReorderFields: doReorderFields,
                        }),
                    onEditColumn: (fieldName) => {
                      // ignore non-field columns (e.g. the row-actions column)
                      if (readFields(objDraft.fields).entries.some((e) => e.name === fieldName)) {
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
                <ObjectFormDesigner
                  draft={objDraft}
                  objectName={current.name}
                  systemFieldNames={STUDIO_SYSTEM_FIELD_NAMES}
                  onChange={onPatch}
                  selectedField={fieldSel?.kind === 'field' ? fieldSel.id : null}
                  onSelectField={(name) => setFieldSel({ kind: 'field', id: name })}
                  selectedGroup={fieldSel?.kind === 'group' ? fieldSel.id : null}
                  onSelectGroup={(key) => setFieldSel({ kind: 'group', id: key })}
                  onAddField={addField}
                  readOnly={readOnly}
                  modeControl={formModeControl}
                />
              ) : (
              <>
              <FormToolbar
                leading={formModeControl}
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
                    if (name && readFields(objDraft.fields).entries.some((f) => f.name === name)) {
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
            id={fieldSel.id}
            onClose={() => setFieldSel(null)}
            closeLabel={t('engine.studio.close', locale)}
            // objectui#12725 — the copilot's 草稿 chip on a field it changed.
            actions={fieldCopilotMark ? <DraftChip locale={locale} className="mr-1" /> : undefined}
            // objectui#12453 — a read-only package saves no draft: no footer.
            footer={readOnly ? null : t('engine.studio.inspector.draftFooter', locale)}
            bodyClassName="flex min-h-0 flex-1 flex-col"
          >
            {(() => {
              const fieldRailContent = fieldSel.kind === 'group' ? (
                <ObjectGroupInspector
                  draft={objDraft}
                  groupKey={fieldSel.id}
                  onPatch={onPatch}
                  onClose={() => setFieldSel(null)}
                  readOnly={readOnly}
                  locale={locale}
                />
              ) : inspector ? (
                React.createElement(inspector, {
                  type: 'object',
                  name: current.name,
                  draft: objDraft,
                  selection: fieldSel,
                  onPatch,
                  onClearSelection: () => setFieldSel(null),
                  onSelectionChange: setFieldSel,
                  onBlockingIssuesChange: (count: number) =>
                    setBlockingReport({ key: fieldSelKey, count }),
                  readOnly,
                  locale,
                })
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
              const railContent = fieldCopilotMark ? (
                <>
                  {fieldRailContent}
                  <DraftSourceLine at={fieldCopilotMark.at} locale={locale} className="mt-4 border-t pt-3" />
                </>
              ) : (
                fieldRailContent
              );
              if (!readOnly) return <div className="min-h-0 flex-1 overflow-auto p-3">{railContent}</div>;
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
              const reason = t('engine.studio.pkg.readonlyHint', locale);
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
        storedName={(identifier) => prefixObjectName(identifier, namespace)}
        extra={
          /* Record sharing (OWD) — the third thing `New object` must ask for
             (`7a90afdf9`). Without it the object saves as a draft happily and
             is then REFUSED at Publish → Publish all by `security-owd-unset`, a
             wall the author meets only after building the whole object. The
             gloss is the SAME string the Settings tab shows for each model, so
             the two surfaces cannot describe one baseline two ways.

             `controlled_by_parent` is absent on purpose — see OWD_CREATE_MODELS:
             a just-created object has no master-detail field for it to derive
             access from. */
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
        }
        onSubmit={({ label, name }) => void doCreateObject(label, name, createOwd)}
      />
    </div>
  );
}

/** Automations pillar — flows: list → FlowPreview (default OFF / review-then-enable). */
/**
 * One flow's runtime enable/bound state, as `GET /automation/_status` puts it on
 * the wire — the same report `IAutomationService.getFlowRuntimeStates` produces,
 * so the shape is the spec's and is TAKEN from it rather than restated
 * (objectui#7265; this used to be a module-local copy under the spec's own name,
 * already three keys behind it).
 *
 * `Partial<>` is the one deliberate divergence, and it is about the READER, not
 * the contract: this types a JSON body that has not been validated and may come
 * from an older backend that sends neither `enabled` nor `bound` — the effect
 * hard-codes the degraded case (`if (!res.ok) return`, "dots just don't
 * render"). Every member is therefore optional HERE while the contract keeps
 * `name` / `enabled` / `bound` required, and the reads below narrow each one
 * explicitly (`if (s?.name)`, then `s.enabled !== false`, `!!s.bound` and the
 * two string checks in `flowRailState`) instead of trusting the type. Pinned in
 * `spec-symbol-parity.test.ts`: if the spec ever
 * relaxes those three itself, the pin fails and this alias should collapse to a
 * plain re-export.
 */
type FlowRuntimeState = Partial<SpecFlowRuntimeState>;

/**
 * What the Automations rail keeps from one flow's runtime row (objectui#11281).
 *
 * `bound` alone cannot say why an enabled flow is unbound. The contract's
 * `FlowRuntimeState.bound` is false both for a flow that declares no trigger
 * and for one whose declared trigger the engine has not armed, and "`triggerType`
 * distinguishes the two". `reason` is the platform's one sentence for why such a
 * flow is not armed: a deployment policy and a binding failure each arrive in
 * the platform's own words. So the rail keeps both beside `enabled` / `bound`.
 *
 * The shape is `flow-problems`' `FlowRuntimeRow` (objectui#11779): the rail,
 * the flow header and the Problems panel derive one run status from it
 * (`deriveFlowRunStatus`), so it is declared once, where that derivation is.
 */
type FlowRailState = FlowRuntimeRow;

/**
 * Narrow one unvalidated runtime row into the rail's state. `triggerType` and
 * `reason` are kept only as non-empty strings and are otherwise absent, the way
 * the engine omits them, so a row without them, and every older backend, reads
 * exactly as it did before they existed.
 */
function flowRailState(s: FlowRuntimeState): FlowRailState {
  const { triggerType, reason } = s;
  return {
    enabled: s.enabled !== false,
    bound: !!s.bound,
    ...(typeof triggerType === 'string' && triggerType.length > 0 ? { triggerType } : {}),
    ...(typeof reason === 'string' && reason.length > 0 ? { reason } : {}),
  };
}

/**
 * A flow's live status in the Automations rail, from the engine's runtime state
 * (persisted `status` is intent; this is what's actually live). Renders nothing
 * for a flow the engine doesn't know yet (never published) — the amber
 * "unpublished draft" chip already covers that case.
 *
 * objectui#12349 — and from the engine's registration verdict, which the flow
 * list serves beside its items. A flow the engine REFUSED has no runtime row,
 * so it used to render nothing here; it now reads "Refused by the engine",
 * titled with the engine's `reason.message`, as sent and never parsed. An
 * `unregistered` flow reads "Not running here". A `registered` verdict, and
 * none at all, leave the row's reading below.
 *
 * The state is the run status `deriveFlowRunStatus` derives, worded by
 * `describeFlowRunStatus` — the derivation the flow header's Status pill and the
 * Problems panel read too (objectui#11779), so the three cannot disagree:
 *   - enabled and bound, or enabled with no declared trigger: "On", titled
 *     "bound to its trigger" / "no trigger (run manually)" — a flow that runs
 *     when invoked is never called "not running";
 *   - enabled, with a declared trigger the engine has not armed: "Not running
 *     here". Its title is the platform's `reason`, verbatim (objectui#11281),
 *     or, from a backend that predates the field, the contract's own reading of
 *     the row: its trigger is not armed here;
 *   - disabled: "Off".
 *
 * objectui#12454 — drawn as a 6 px dot, as the redesign's rail draws it: green
 * for On, grey for Not running here, amber for Refused, a hollow ring for Off
 * (`flowDotClass`). The words are the element's visually hidden text and the
 * row's title (the dot no longer prints them), and the dot's own title is the
 * reason it always carried. The rail's legend names each look.
 * Nothing here is styled as an error: a deployment policy is not a defect.
 */
export function FlowStatusDot({
  state,
  registration,
  locale,
}: {
  state?: FlowRailState;
  /** The engine's verdict on this flow, from the list's `registrations`; absent when none was served. */
  registration?: FlowRegistration;
  locale: string;
}): React.ReactElement | null {
  const reading = flowRailStatus(state, registration, locale);
  if (!reading) return null;
  const { status, view } = reading;
  // objectui#12454 — a 6 px dot; the status words stay the element's text
  // (visually hidden, so a reader and a search still find them) and the hover
  // text stays the reason as it was.
  return (
    <span title={view.title} data-status={status.kind} className="inline-flex h-4 w-3 shrink-0 items-center justify-center">
      <span aria-hidden className={'h-1.5 w-1.5 rounded-full ' + flowDotClass(status)} />
      <span className="sr-only">{view.label}</span>
    </span>
  );
}

/**
 * The rail's reading of one flow: the run status `FlowStatusDot` draws and the
 * row's title names, or `null` when there is nothing to say — a flow the engine
 * does not know yet and holds no verdict on (the amber "unpublished draft" chip
 * already covers that case).
 */
function flowRailStatus(
  state: FlowRailState | undefined,
  registration: FlowRegistration | undefined,
  locale: string,
): { status: FlowRunStatus; view: FlowRunStatusView } | null {
  const decides = registration?.state === 'refused' || registration?.state === 'unregistered';
  if (!state && !decides) return null;
  const status = deriveFlowRunStatus(state, undefined, registration);
  return { status, view: describeFlowRunStatus(status, locale) };
}

/**
 * The dot's look per run status (objectui#12454): green when the flow runs
 * (bound, or run by hand), grey when this deployment does not run it, amber
 * when the engine refused it, and a hollow ring when it is switched off.
 * Nothing here is styled as an error: a deployment policy is not a defect.
 */
function flowDotClass(status: FlowRunStatus): string {
  switch (status.kind) {
    case 'on':
    case 'manual':
      return 'bg-emerald-500';
    case 'refused':
      return 'bg-amber-500';
    case 'off':
      return 'border border-muted-foreground/70';
    default:
      return 'bg-muted-foreground/50';
  }
}

/** Each trigger kind's 14 px glyph and its words, in the rail rows and the legend (objectui#12454). */
const FLOW_GLYPH_ICON: Record<FlowTriggerGlyph, LucideIcon> = {
  record: Zap,
  scheduled: Clock,
  screen: MousePointerClick,
  autolaunched: CornerDownRight,
};
const FLOW_GLYPH_LABEL_KEY: Record<FlowTriggerGlyph, string> = {
  record: 'engine.studio.auto.kind.record',
  scheduled: 'engine.studio.auto.kind.scheduled',
  screen: 'engine.studio.auto.kind.screen',
  autolaunched: 'engine.studio.auto.kind.autolaunched',
};

/** The React key of the trailing group, whose grouping key is the empty string. */
const NO_OBJECT_GROUP_KEY = '__no_object__';

/**
 * The engine's registration verdict on each flow of the rail's scope
 * (objectui#12349): the flow list's `registrations`, which the server serves
 * beside the items, read through the same list read the rail's own loader
 * makes (one request when both are in flight). Every entry is parsed with the
 * spec's `FlowRegistrationSchema` at the client.
 *
 * A read that fails leaves every flow unjudged — what an absent
 * `registrations` already means — so the rail reads as it did before the
 * verdict existed; the rail's own list read reports a failing list.
 */
async function readFlowRegistrations(
  client: { listResponse: MetadataClient['listResponse'] },
  packageId: string | null,
): Promise<Record<string, FlowRegistration>> {
  try {
    const answer = await client.listResponse('flow', packageId === null ? {} : { packageId });
    return answer.registrations ?? {};
  } catch {
    return {};
  }
}

/**
 * Each flow's definition in the rail's scope, by name (objectui#12454): what
 * the rail's grouping and trigger glyphs read. Read with the drafts overlaid,
 * so a draft-only flow, and a published one whose draft moved its trigger,
 * group as the author's draft has them; a server that refuses that read gives
 * the published list, and a failing list gives none, which groups every flow
 * under "No object" rather than failing the rail.
 */
async function readFlowDefinitions(client: MetadataClient, packageId: string | null): Promise<Map<string, unknown>> {
  const scope = packageId === null ? {} : { packageId };
  const read = async (): Promise<Array<Record<string, unknown>> | null | undefined> => {
    try {
      return await client.withPreviewDrafts(true).list<Record<string, unknown>>('flow', scope);
    } catch {
      return await client.list<Record<string, unknown>>('flow', scope);
    }
  };
  const definitions = new Map<string, unknown>();
  try {
    for (const flow of (await read()) ?? []) {
      if (flow && typeof flow.name === 'string' && flow.name) definitions.set(flow.name, flow);
    }
  } catch {
    /* no definitions: every flow groups under "No object" */
  }
  return definitions;
}

/**
 * The scope's objects, name → label in the designer locale (objectui#12454):
 * the rail's group headers and their order, and which objects count as the
 * scope's own when a flow is grouped by the data it touches. The package's
 * object list, as the Data rail reads it; unscoped in the package-less scope.
 * A failing read gives an empty index, which `groupFlowsByObject` reads as
 * "every object is the scope's".
 */
async function readObjectLabels(client: MetadataClient, packageId: string | null, locale: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  try {
    const objects = await client.list<Record<string, unknown>>('object', packageId === null ? {} : { packageId });
    for (const object of objects ?? []) {
      if (!object || typeof object.name !== 'string' || !object.name) continue;
      const label = resolveI18nLabel(object.label as I18nLabel | undefined, locale)?.trim();
      labels.set(object.name, label || object.name);
    }
  } catch {
    /* an empty index */
  }
  return labels;
}

/** The trigger the New automation dialog chose (objectui#11788). */
export interface NewFlowTrigger {
  triggerType: string;
  /** The object a record trigger watches, when the author named one. */
  objectName?: string;
}

/**
 * The Start node's own trigger and object fields, localized — the source of the
 * New automation dialog's choices (objectui#11788), so the dialog offers what
 * the Start node offers, under the same labels, and shows the object picker for
 * exactly the triggers the Start node shows it for (`objectName`'s `showWhen`).
 */
function newFlowTriggerFields(locale: string): { trigger?: FlowConfigField; object?: FlowConfigField } {
  const start = localizeFlowFields('start', fieldsForNodeType('start'), locale);
  return {
    trigger: start.find((f) => f.id === 'triggerType'),
    object: start.find((f) => f.id === 'objectName'),
  };
}

/**
 * `flow` with the chosen trigger written on its Start node, where the Start
 * node's trigger field writes it (`config.triggerType`, and `config.objectName`
 * for the object) — objectui#11788. No choice leaves the skeleton as it was.
 */
function withStartTrigger(
  flow: Record<string, unknown>,
  trigger: NewFlowTrigger | null,
): Record<string, unknown> {
  if (!trigger) return flow;
  const nodes = Array.isArray(flow.nodes) ? (flow.nodes as Array<Record<string, unknown>>) : [];
  return {
    ...flow,
    nodes: nodes.map((n) => {
      if (n.type !== 'start') return n;
      const config = n.config && typeof n.config === 'object' && !Array.isArray(n.config) ? (n.config as Record<string, unknown>) : {};
      return {
        ...n,
        config: {
          ...config,
          triggerType: trigger.triggerType,
          ...(trigger.objectName ? { objectName: trigger.objectName } : {}),
        },
      };
    }),
  };
}

/** No navigation order: one shared empty list, so the rail's memo holds across renders. */
const NO_OBJECT_ORDER: readonly string[] = [];

export function AutomationsPillar({
  packageId,
  objectOrder = NO_OBJECT_ORDER,
  publishNonce = 0,
  onDraftSaved,
  readOnly = false,
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
  onDraftSaved?: () => void;
  /** Courtesy gate: hide/disable flow-authoring affordances. */
  readOnly?: boolean;
  /** objectui#11786 — the clause of the edit the autosave holds unsent, for the surface's Publish. */
  onHeldEditChange?: (clause: string | null) => void;
}): React.ReactElement {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  const navigate = useNavigate();
  // The draft writes' package binding (objectui#11553): none in the
  // package-less scope, so the draft row stays as package-less as the flow it
  // edits. The client sends no `package=` for an absent id.
  const draftPackageId = packageId ?? undefined;
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
  const shownFlows = railNeedle ? flows.filter(flowMatches) : flows;
  // objectui#7255 — same live-pulse subscription as the sibling rails; this
  // one only replaces the flow LIST, so it needs no edit-buffer hold either.
  const metadataRefreshNonce = useMetadataRefreshNonce();
  const [current, setCurrent] = React.useState<Surface | null>(null);
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
  }, [publishNonce]);

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
        const [items, registrations, definitions, objects] = await Promise.all([
          packageId === null
            ? loadPackageLessSurfaces(client, 'flow', locale)
            : loadPackageSurfaces(client, 'flow', packageId, locale),
          readFlowRegistrations(client, packageId),
          readFlowDefinitions(client, packageId),
          readObjectLabels(client, packageId, locale),
        ]);
        if (cancelled) return;
        setFlows(items);
        setFlowRegistrations(registrations);
        setFlowDefinitions(definitions);
        setObjectLabels(objects);
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
        setCurrent((c) => c ?? deepLinked ?? (named ? null : items[0]) ?? null);
      } catch (e) {
        if (!cancelled) setError(plainRefusal(e));
      } finally {
        if (!cancelled) setListed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, packageId, publishNonce, metadataRefreshNonce, locale]);

  const doCreateFlow = React.useCallback(
    async (label: string, name: string, trigger: NewFlowTrigger | null) => {
      setCreateBusy(true);
      setError(null);
      try {
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
        // objectui#11773 — a create is the first-write pin: refused where the
        // name already holds a draft, instead of written over it.
        await client.save('flow', name, skeleton, { mode: 'draft', packageId: draftPackageId, ifNoneMatch: '*', surface: 'studio' });
        const item: Surface = { type: 'flow', name, label };
        setFlows((fs) => [...fs.filter((f) => f.name !== name), item]);
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
    [client, draftPackageId, onDraftSaved, locale],
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
        // version it serves pins the first of them.
        const draftRead = await readDraftForSave<Record<string, unknown>>(client, 'flow', current.name, draftPackageId);
        if (cancelled) return;
        const draftBody = extractDraftBody(draftRead.answer);
        // objectui#11799 — the baseline is read only for a flow with no
        // pending draft, the one case it is used. An unsaved flow always has
        // one, so it never asks `/layers`, which answers 404 for it.
        const layRaw = draftBody ? null : await client.layered<Record<string, unknown>>('flow', current.name);
        if (cancelled) return;
        const lay = layRaw as { effective?: Record<string, unknown>; code?: Record<string, unknown> } | null;
        const baseline = (lay?.effective ?? lay?.code ?? {}) as Record<string, unknown>;
        // Served draft as-is, baseline only without one (objectui#10765).
        setDraft(draftBody ?? baseline);
        setDraftFor(`flow:${current.name}`);
        // objectui#11773 — the next save is pinned to what the draft read served.
        recordFlowRead('flow', current.name, draftPackageId, draftRead.pin);
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
  }, [client, current, draftPackageId, publishNonce, flowReloadNonce, recordFlowRead]);

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
      const outcome = await saveFlowDraft('flow', current.name, draft, { mode: 'draft', packageId: draftPackageId, surface: 'studio' });
      // objectui#11773 — the author chose the saved version; the load replaces the buffer.
      if (outcome === 'reloaded') return;
      setHasDraft(true);
      // objectui#11204 — clean only if nothing was edited while it was in flight.
      if (sent.unmoved()) setAutoDirty(false);
      onDraftSaved?.();
    } catch (e) {
      // objectui#11785 — read against `draft`, the body this save sent.
      setError(flowSaveRefusal(e, draft, locale));
    } finally {
      setSaving(false);
    }
  }, [saveFlowDraft, current, draft, draftPackageId, onDraftSaved, locale]);
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
    blocked: !current || !isEditable || !!saving || readOnly || flowIncomplete !== null,
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
      onDraftSaved?.();
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
  }, [saveFlowDraft, current, draft, draftPackageId, onDraftSaved, locale, readOnly, sendingFlowDraft]);

  // The rail's "+" — and the empty block's button, which runs this same
  // handler (objectui#12514). objectui#11553 — no "New" in the package-less
  // scope: new authoring stays package-first, and this scope reaches flows
  // that already exist without a package.
  const openCreateFlow =
    !readOnly && packageId !== null
      ? () => {
          setError(null);
          setNewTrigger('');
          setNewTriggerObject('');
          setNewChoice(FLOW_PRESETS[0]);
          setNewNeeds(null);
          setCreating(true);
        }
      : undefined;
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
  // row, in the drawer over it (objectui#11795).
  const configBodyEl =
    selection && inspector && current && flowLoaded ? (
      React.createElement(inspector, {
        type: 'flow',
        name: current.name,
        draft,
        selection,
        onPatch,
        onClearSelection: () => setSelection(null),
        onSelectionChange: setSelection,
        // objectui#11124 — the pillar's real flag, threaded exactly as
        // the Data pillar threads it (objectui#2259).
        readOnly,
        locale,
      })
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
    current && flowLoaded
      ? (() => {
          const defaultOff = t('engine.studio.auto.defaultOff', locale);
          const toggle = (
            <button
              type="button"
              role="switch"
              aria-checked={flowEnabled}
              onClick={toggleEnabled}
              disabled={!isEditable || !!saving || readOnly}
              aria-describedby={readOnly ? toggleReadOnlyReasonId : undefined}
              // A read-only package's reason is the wrapper's (objectui#12303),
              // not a `title` the disabled button can never show.
              title={
                readOnly
                  ? undefined
                  : `${defaultOff}\n${flowEnabled ? t('engine.studio.auto.disableTitle', locale) : t('engine.studio.auto.enableTitle', locale)}`
              }
              className={
                'inline-flex h-7 items-center gap-2 rounded-md px-1 text-[12px] text-foreground hover:bg-muted disabled:opacity-50' +
                (readOnly ? ' disabled:pointer-events-none' : '')
              }
            >
              <span className={'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ' + (flowEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40')}>
                <span className={'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ' + (flowEnabled ? 'translate-x-[18px]' : 'translate-x-0.5')} />
              </span>
              {flowEnabled ? t('engine.studio.auto.enabled', locale) : t('engine.studio.auto.disabled', locale)}
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
    readOnly && packageId !== null ? (
      <StudioReadOnlyLink packageId={packageId} title={t('engine.studio.pkg.readonlyHint', locale)} locale={locale} />
    ) : null;
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
          }}
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
          {railGroups.map((group) => {
            const items = railNeedle ? group.items.filter(flowMatches) : group.items;
            if (items.length === 0) return null;
            const groupKey = group.key || NO_OBJECT_GROUP_KEY;
            return (
              <StudioRailGroup
                key={groupKey}
                testId={`auto-rail-group-${group.key || 'none'}`}
                label={group.label}
                count={items.length}
                collapsed={!railNeedle && foldedGroups.has(groupKey)}
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
                        setCurrent(f);
                        if (isMobile) setRailOpen(false);
                      }}
                      icon={<Glyph aria-hidden className={'h-3.5 w-3.5 shrink-0' + (active ? '' : ' text-muted-foreground')} />}
                      trailing={<FlowStatusDot state={flowStatus[f.name]} registration={flowRegistrations[f.name]} locale={locale} />}
                    >
                      {f.label}
                    </StudioRailRow>
                  );
                })}
              </StudioRailGroup>
            );
          })}
          {flows.length > 0 && shownFlows.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">
              {tFormat('engine.list.emptyQuery', locale, { query: railQuery.trim() })}
            </p>
          )}
          {flows.length === 0 && !creating && (error || !listed || openCreateFlow) && (
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
                {flowSwitchEl}
                {!flowTabsEl && autoReadOnlyLinkEl}
              </>
            }
            tabs={flowTabsEl}
          />
          {/* objectui#12454 — the body is the flow, flush under the tab row:
              no padded band and no bordered card around the canvas. A refusal
              or a held edit sits above it, inside the column's gutter. */}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {(error || flowHeld) && (
              <div className="shrink-0 space-y-2 px-6 pb-1 pt-3">
                {error && (
                  <StudioRefusalStrip
                    refusal={error}
                    locale={locale}
                    // objectui#11785 — "Show me" selects the named step, which opens
                    // its inspector in the right rail.
                    onShow={(target) => setSelection({ kind: target.kind, id: target.id })}
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
                          // nothing; its way in is the Setup list the sentence
                          // names, so the action is a link that says it leaves.
                          <Button asChild size="sm" variant="outline">
                            <Link to={packagedAutomationPath()} data-testid="auto-empty-open-setup">
                              {t('engine.studio.org.openSetup', locale)}
                              <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                            </Link>
                          </Button>
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
                        onPatch: readOnly ? undefined : onPatch,
                        locale,
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
              footer={readOnly ? null : t('engine.studio.inspector.draftFooter', locale)}
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
                    <ObjectPicker
                      label={startTrigger.object.label}
                      value={newTriggerObject}
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
                      onCommit={setNewTriggerObject}
                      locale={locale}
                    />
                  )}
                </div>
              )}
            </div>
          </fieldset>
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
  packageId,
  publishNonce,
  onDraftSaved,
  readOnly = false,
  onDirtyChange,
}: {
  packageId: string;
  publishNonce?: number;
  onDraftSaved?: () => void;
  /** Courtesy gate: hide/disable permission-authoring affordances. */
  readOnly?: boolean;
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
    Array<{ name: string; label: string; isDefault?: boolean }>
  >([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState<string | null>(null);
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
  const [query, setQuery] = React.useState('');
  // inline creator (same rail pattern as the Data pillar's object creator)
  const [creating, setCreating] = React.useState(false);
  const [createErr, setCreateErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // [ADR-0090 D6] "why can this user access?" — right-side explain sheet.
  const [explainOpen, setExplainOpen] = React.useState(false);
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
  const confirmDiscardEdits = React.useCallback(() => {
    if (!pillarDirty) return true;
    return window.confirm(t('engine.edit.unsavedLeaveConfirm', locale));
  }, [pillarDirty, locale]);

  const load = React.useCallback(async () => {
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
      const [list, drafts] = await Promise.all([
        client.list('permission', { packageId }) as Promise<Array<Record<string, unknown>>>,
        client.listDrafts({ packageId, type: 'permission' }).catch(() => []),
      ]);
      const byName = new Map<string, { name: string; label: string; isDefault?: boolean }>();
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
      const scoped = [...byName.values()];
      setPerms(scoped);
      // A `?surface=owd:overview` deep-link opens the OWD overview instead of a
      // permission set; `current` still defaults to the first set so switching
      // back to the matrix has a target. Applied once — a later publish re-runs
      // `load`, and we must not yank the user back to OWD then.
      if (!appliedOwdDeepLink.current && initialSurface?.type === 'owd') {
        appliedOwdDeepLink.current = true;
        setOwdOpen(true);
      }
      const deepLinked = resolveSurfaceDeepLink(scoped, initialSurface, 'permission');
      setCurrent((c) => c ?? deepLinked?.name ?? scoped[0]?.name ?? null);
    } catch (e) {
      setError(formatMetadataError(e));
    } finally {
      setLoaded(true);
    }
  }, [client, packageId, locale]);

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
      try {
        // Package door → create as a DRAFT stamped with this package (D6/D7),
        // published atomically with the rest of the package.
        // objectui#11773 — a create is the first-write pin: refused where the
        // name already holds a draft, instead of written over it.
        await client.save('permission', name, buildPermissionSkeleton(name, label), {
          mode: 'draft',
          packageId,
          ifNoneMatch: '*',
          surface: 'studio',
        });
        toast.success(tFormat('engine.studio.access.created', locale, { label }));
        setCreating(false);
        onDraftSaved?.();
        await load();
        // Land on the new set's matrix — also from the OWD overview, whose
        // discard the "+ New" gate already confirmed up front.
        setOwdOpen(false);
        setCurrent(name);
      } catch (e) {
        setCreateErr(formatMetadataError(e));
      } finally {
        setBusy(false);
      }
    },
    [client, load, packageId, onDraftSaved, locale],
  );

  const filtered = perms.filter(
    (p) =>
      !query.trim() ||
      p.label.toLowerCase().includes(query.trim().toLowerCase()) ||
      p.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

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
  const accessStatus: StudioItemStatus | undefined = readOnly
    ? undefined
    : { label: t('engine.studio.access.banner', locale), title: t('engine.studio.access.bannerTitle', locale) };
  const accessNoteEl = accessStatus ? (
    <StudioStatusChip {...accessStatus} />
  ) : (
    <StudioReadOnlyLink
      packageId={packageId}
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
  const openCreateSet = readOnly
    ? undefined
    : () => {
        if (!confirmDiscardEdits()) return;
        setCreateErr(null);
        setCreating(true);
      };
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
          {readOnly && accessNoteEl}
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
      {!readOnly && (
        <SuggestedBindingsPanel
          packageId={packageId}
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
          search={{ value: query, onChange: setQuery, placeholder: t('engine.studio.access.search', locale) }}
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
                p.isDefault ? (
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">default</span>
                ) : undefined
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
          <main className="min-h-0 flex-1 overflow-auto">
          {owdOpen ? (
            /* Sibling surface: the package-wide OWD baseline overview
             * (objectui#2505) — object × sharingModel,
             * batch-edited as per-object drafts. */
            <PackageOwdOverviewPanel
              client={client}
              packageId={packageId}
              publishNonce={publishNonce}
              onDraftSaved={onDraftSaved}
              readOnly={readOnly}
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
              publishNonce={publishNonce}
              onDraftSaved={onDraftSaved}
              readOnly={readOnly}
              onDirtyChange={setMatrixDirty}
              embedded
              studio={{
                tab: accessTab,
                onTabChange: setAccessTab,
                leading: accessRailToggleEl,
                chips: accessNoteEl,
                actions: accessExplainEl,
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

      <AccessExplainPanel open={explainOpen} onOpenChange={setExplainOpen} packageId={packageId} />

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
        onSubmit={({ label, name }) => void doCreate(label, name)}
      />
    </div>
  );
}

export default StudioDesignSurface;
