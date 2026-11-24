// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Automations pillar — the flow rail, the flow canvas and its inspectors,
 * the New automation dialog — with the published-flow-names read only it makes,
 * moved out of `StudioDesignSurface.tsx` unchanged by objectstack#36893 (the
 * move-only split's pillar slice; the surface re-exports it).
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { extractDraftBody, formatMetadataError, readDraftChanges, type DraftChange } from '@object-ui/data-objectstack';
import type { MetadataClient } from '@object-ui/data-objectstack';
import { type StudioSurfaceLabel } from './StudioAiCopilot.js';
import { isSlotEscapeExempt, useStudioRightSlot } from './studioRightSlotState.js';
import { AUTOMATIONS_CONFIG_FOLD_WIDTH, useIsNarrowerThan } from './wideViewport.js';
import { STUDIO_FOLD_LABEL } from './studio-tokens.js';
import { StudioInspector } from './StudioInspector.js';
import { isAgentDraftSurface } from './StudioDraftMark.js';
import { StudioAiDraftNotice } from './StudioAiDraftNotice.js';
import { StudioItemHeader, StudioTab } from './StudioItemHeader.js';
import { StudioItemTools } from '../item-tools/StudioItemTools.js';
import { useStudioItemDraftStatus } from './studioItemDraftStatus.js';
import { FlowItemMoreMenu, flowCloneNoticeText, type FlowCopied } from './FlowItemMoreMenu.js';
import { FlowLedgerSwitch } from './FlowLedgerSwitch.js';
import { requestFlowToggle, useFlowLedgerWalledReadOnly } from '../setup/packagedFlowLedger.js';
import { activationReading } from '../setup/packagedFlows.js';
import { StudioRail, StudioRailGroup, StudioRailRow } from './StudioRail.js';
import { StudioEmptyState, StudioEmptyStateAction } from './StudioEmptyState.js';
import { FLOW_TRIGGER_GLYPHS, flowTriggerGlyph, groupFlowsByObject } from './flowGrouping.js';
import { StudioRefusalStrip } from './StudioRefusalStrip.js';
import { StudioPicker } from './StudioPicker.js';
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
  useIsMobile,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import { Ban, Workflow, SlidersHorizontal, MousePointer2, Loader2, Lock, Menu } from 'lucide-react';
import {
  useRegisteredMetadataPreview,
  useRegisteredMetadataPreviewTypes,
  type MetadataSelection,
} from '../metadata-admin/preview-registry.js';
import {
  useRegisteredMetadataInspector,
  useRegisteredMetadataInspectorTypes,
} from '../metadata-admin/inspector-registry.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { isPublishConflictKeptEditing, readDraftForSave, useDraftSaveGuard } from '../metadata-admin/DraftConflictDialog.js';
import {
  DraftVerdictContext,
  draftEnvelopeDiagnostics,
  editedItemDiagnostics,
  verdictPreviewEntries,
  type ServerDiagnostics,
} from '../metadata-admin/draftVerdict.js';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { publishSavedItem, publishCreated, publishedPinOfLayers, STUDIO_SAVE_TOAST_ID, useStudioSaveEntry, type StudioSaveResult } from './studioSaveBar.js';
import {
  flowHeldEdit,
  flowSaveRefusal,
  plainRefusal,
  publishFailureOf,
  publishRefusal,
  type StudioRefusal,
} from './metadataError.js';
import {
  loadPackageLessSurfaces,
  loadPackageSurfaces,
} from './packageSurfaces.js';
import { studioOrgScopePath } from './studioScope.js';
import { studioPillarItemPath } from './metadataArea.js';
import { useCanAuthorMetadata } from '../../hooks/useCanAuthorMetadata.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
import { type Surface } from './navSurface.js';
import { useSurfaceDeepLink, resolveSurfaceDeepLink } from './useSurfaceDeepLink.js';
import { buildFlowSkeleton } from './skeletons.js';
import { t, tFormat, translateValidationMessage, useMetadataLocale } from '../metadata-admin/i18n.js';
import { ObjectPicker } from '../metadata-admin/inspectors/ObjectPicker.js';
import {
  FlowRegistrationContext,
  FlowRuntimeContext,
  deriveFlowRunStatus,
  type FlowRunStatus,
} from '../metadata-admin/previews/flow-problems.js';
import {
  FlowMetaPills,
  FlowPreviewChromeProvider,
  FlowSelectionTitle,
  flowSelectionHeading,
  type FlowPreviewSection,
  type FlowProblemTally,
} from '../metadata-admin/previews/FlowPreview.js';
import { InspectorShellHostProvider } from '../metadata-admin/inspectors/_shared.js';
import { useFlowLabelOf, useFlowLabelTranslations } from '../metadata-admin/previews/flow-label-translations.js';
import type { FlowRegistration } from '@objectstack/spec/api';
import { CreateItemDialog } from './CreateItemDialog.js';
import { FLOW_PRESETS, flowPresetTrigger, type FlowPreset } from './flowPresets.js';
import {
  ContributedRailRow,
  RailCustomizationFilter,
  RailCustomizationMark,
  StudioPairItemChip,
  contributedItemTitle,
  railCustomizationsOf,
  useOpenContributor,
  useRailCustomizationsOnly,
  withPairItems,
} from './StudioRailCustomizations.js';
import { baseContributionsOf, withContributedFlowGroups, type ContributedOnObject } from './contributionRows.js';
import {
  StudioCustomizeButton,
  StudioOverrideChip,
  StudioRestoreOriginalDialog,
  overrideDraftBody,
  useServedOverride,
  type CustomizeBlock,
} from './StudioCustomizeControls.js';
import { SavedToCustomizationNote } from '../../preview/savedToCustomization.js';
import { toast } from 'sonner';

/**
 * objectstack#34818 — the names of the flows that have a published version in
 * these scopes: the published list (`list()` serves no drafts). Any failed read
 * answers `null`, "unknown", so the Runs tab keeps its sentence that names both
 * causes rather than claim the flow was never published.
 */
async function readPublishedFlowNames(
  client: Pick<MetadataClient, 'listResponse'>,
  scopes: ReadonlyArray<string | null>,
): Promise<ReadonlySet<string> | null> {
  try {
    const answers = await Promise.all(
      scopes.map((packageId) => client.listResponse<Record<string, unknown>>('flow', packageId === null ? {} : { packageId })),
    );
    const names = new Set<string>();
    for (const answer of answers) {
      for (const item of answer?.items ?? []) {
        if (item && typeof item.name === 'string' && item.name) names.add(item.name);
      }
    }
    return names;
  } catch {
    return null;
  }
}

/** Automations pillar — flows: list → FlowPreview (default OFF / review-then-enable). */
export function AutomationsPillar({
  packageId: railPackageId,
  objectOrder = NO_OBJECT_ORDER,
  publishNonce = 0,
  onDraftSaved,
  readOnly: packageReadOnly = false,
  customization = null,
  onHeldEditChange,
  onSurfaceLabelChange,
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
  /**
   * objectstack#35018 — the open flow's label for the copilot's chip:
   * 「正在看：流程 · 新会议提醒」, never the type word and machine name.
   */
  onSurfaceLabelChange?: (surface: StudioSurfaceLabel | null) => void;
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
  // objectstack#35319 — a row names its flow as the open flow's header does:
  // the package's `flows.NAME.label` in the console's language, else the
  // authored label. The search matches that name, the authored label and the
  // machine name, so what the row shows is always searchable.
  const flowLabelOf = useFlowLabelOf();
  const railLabel = (f: Surface) => flowLabelOf(f.name) || f.label;
  const flowMatches = (f: Surface) =>
    [railLabel(f), f.label, f.name].some((text) => text.toLowerCase().includes(railNeedle));
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
    // objectstack#36726 — and the published flow the buffer was loaded at, for the Save's publish.
    recordPublished: recordFlowPublished,
    publish: publishFlow,
    dialog: flowConflictDialog,
  } = useDraftSaveGuard(client, reloadFlowDraft);
  const [selection, setSelection] = React.useState<MetadataSelection | null>(null);
  // The package's translations of the flow label and its approval-step labels (flow-label-translations.tsx).
  const flowLabels = useFlowLabelTranslations(current?.name ?? '');
  // objectstack#35018 — lift the open flow's label to the copilot's chip, the
  // pillar's word first: 「正在看：流程 · 新会议提醒」 — the label the canvas
  // header reads. Keyed on primitives, the callback read through a ref.
  const onSurfaceLabelChangeRef = React.useRef(onSurfaceLabelChange);
  React.useEffect(() => {
    onSurfaceLabelChangeRef.current = onSurfaceLabelChange;
  });
  const currentFlowType = current?.type;
  const currentFlowName = current?.name;
  const currentFlowLabel = current ? flowLabels?.flowLabel || current.label : undefined;
  const flowSubject = t('engine.studio.copilot.subject.flow', locale);
  React.useEffect(() => {
    onSurfaceLabelChangeRef.current?.(
      currentFlowType && currentFlowName && currentFlowLabel
        ? { type: currentFlowType, name: currentFlowName, label: `${flowSubject} · ${currentFlowLabel}` }
        : null,
    );
  }, [currentFlowType, currentFlowName, currentFlowLabel, flowSubject]);
  React.useEffect(
    () => () => {
      onSurfaceLabelChangeRef.current?.(null);
    },
    [],
  );
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState<false | 'draft' | 'publish'>(false);
  const [hasDraft, setHasDraft] = React.useState(false);
  // objectstack#36511 item 6 — the per-key provenance the flow's draft read
  // served (`draftChanges`), `null` with no draft: whether the AI assistant
  // wrote the pending draft the page opened on.
  const [flowDraftChanges, setFlowDraftChanges] = React.useState<DraftChange[] | null>(null);
  // The aside header's slot for the hosted inspector's header actions (the
  // flow node's "···" menu), so they sit in the title bar (`InspectorShellHost`).
  const [configHeaderSlot, setConfigHeaderSlot] = React.useState<HTMLElement | null>(null);
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
  // objectstack#34818 — the flows of the rail's scope that have a published
  // version, so the Runs tab can tell "not published yet" from "the engine is
  // not answering". `null` until read, and after a failed read: unknown.
  const [publishedFlowNames, setPublishedFlowNames] = React.useState<ReadonlySet<string> | null>(null);
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
        const [baseItems, registrations, definitions, objects, pair, publishedNames] = await Promise.all([
          packageId === null
            ? loadPackageLessSurfaces(client, 'flow', locale)
            : loadPackageSurfaces(client, 'flow', packageId, locale),
          readFlowRegistrations(client, packageId),
          readFlowDefinitions(client, packageId),
          readObjectLabels(client, packageId, locale),
          readPair().catch(() => null),
          readPublishedFlowNames(client, [packageId, ...(pairId === null ? [] : [pairId])]),
        ]);
        if (cancelled) return;
        const items: Surface[] = withPairItems<Surface>(baseItems, pair?.[0] ?? [], pairId);
        setFlows(items);
        setPublishedFlowNames(publishedNames);
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
        // objectstack#36511 — and published at once, switched off as it was
        // born: no draft is left for a package publish, and the switch arms it.
        // objectstack#36726 — pinned `If-None-Match: *`: a flow another writer
        // published under the name since the check above is refused, not replaced.
        const live = await publishSavedItem(
          client,
          { type: 'flow', name, packageId: target ?? railPackageId },
          false,
          publishCreated,
        );
        if (!live.ok) {
          if ('error' in live) setError(plainRefusal(live.error));
          return;
        }
        const item: Surface = target === null ? { type: 'flow', name, label } : { type: 'flow', name, label, addedIn: target };
        setFlows((fs) => [...fs.filter((f) => f.name !== name), item]);
        // objectstack#36742 — the engine's row for the new flow is read, as
        // after a Save: the snapshot held was taken before the flow existed,
        // and its missing row read as 「未发布草稿」 over a published flow.
        setStatusNonce((n) => n + 1);
        // objectstack#28572 — the rail reads again after the save, so the
        // pair's list it reads holds the new flow.
        if (target !== null) setFlowListNonce((n) => n + 1);
        // objectui#12454 — and groups by what it was born with.
        setFlowDefinitions((m) => new Map([...m, [name, skeleton]]));
        setCurrent(item);
        setHasDraft(false);
        setCreating(false);
        // objectstack#36742 — its own words: the flow is published, but born
        // switched off, so 「已保存并生效」 would promise a run it will not do.
        toast.success(tFormat('engine.studio.auto.createdOff', locale, { name: label }), { id: STUDIO_SAVE_TOAST_ID });
      } catch (e) {
        // Shown in the create dialog, which prints the message only: kept whole.
        setError(plainRefusal(e));
      } finally {
        setCreateBusy(false);
      }
    },
    [client, railPackageId, packageReadOnly, customization, locale, flows],
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
        // objectstack#36726 — the published flow's layers at the address the
        // Save's publish writes, read FIRST (the server's order for the
        // version and the body): a publish landing between this and the reads
        // below leaves the pin older than the buffer, so the next Save is
        // asked about, never published over it. At the drafts' own package it
        // is also the baseline read below.
        const baselineScope = draftPackageId ? { packageId: draftPackageId } : {};
        const layAtReadAt = await client
          .layered<Record<string, unknown>>('flow', current.name, readAt ? { packageId: readAt } : {})
          .then(
            (lay) => ({ ok: true as const, lay }),
            (err: unknown) => ({ ok: false as const, err }),
          );
        if (cancelled) return;
        const publishedAt = layAtReadAt.ok ? publishedPinOfLayers(layAtReadAt.lay) : null;
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
        let layRaw: unknown = null;
        if (!draftBody) {
          if (readAt === draftPackageId) {
            // The read above, at this same address: its refusal is the load's error, as it always was.
            if (!layAtReadAt.ok) throw layAtReadAt.err;
            layRaw = layAtReadAt.lay;
          } else {
            layRaw = await client.layered<Record<string, unknown>>('flow', current.name, baselineScope);
          }
        }
        if (cancelled) return;
        const lay = layRaw as { effective?: Record<string, unknown>; code?: Record<string, unknown> } | null;
        const baseline = (lay?.effective ?? lay?.code ?? {}) as Record<string, unknown>;
        // Served draft as-is, baseline only without one (objectui#10765).
        setDraft(draftBody ?? baseline);
        flowStoredRef.current = draftBody ?? baseline;
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
        // objectstack#36726 — …and its publish to the published flow the layers served there.
        recordFlowPublished('flow', current.name, readAt, publishedAt);
        flowReadAtRef.current = { key: `flow:${current.name}`, at: readAt };
        setHasDraft(!!draftBody);
        setFlowDraftChanges(draftBody ? readDraftChanges(draftRead.answer) : null);
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
  }, [client, current, draftPackageId, publishNonce, flowReloadNonce, recordFlowRead, recordFlowPublished, flowCustomizing]);

  // objectui#5813 — local dirty flag: auto-save arms only after a real edit.
  const [autoDirty, setAutoDirty] = React.useState(false);
  const onPatch = React.useCallback(
    (patch: Record<string, unknown>) => {
      setDraft((d) => ({ ...d, ...patch }));
      setAutoDirty(true);
    },
    [],
  );
  // objectstack#36511 — the flow as the server holds it (as loaded, or as last
  // saved): what the enable switch writes its status onto, so a flip never
  // carries an edit Save has not sent.
  const flowStoredRef = React.useRef<Record<string, unknown>>({});
  const flowDraftRef = React.useRef(draft);
  React.useLayoutEffect(() => {
    flowDraftRef.current = draft;
  });
  // objectstack#36511 — the top bar's Save for the open flow (canvas and
  // properties): its draft, then that flow's own publish, so it is live at
  // once. A refused publish keeps the edits on the page with the reason.
  const doSave = React.useCallback(async (): Promise<StudioSaveResult> => {
    if (!current) return { kind: 'declined' };
    setSaving('draft');
    setError(null);
    const body = draft;
    const hadDraft = hasDraft;
    try {
      // objectstack#28570 — a read-only base's flow is saved into the pair the
      // ensure door answers, under its own name, declaring the override. A
      // refused door is shown as it was sent, and nothing is saved.
      const custom = readOnly ? customizationRef.current : null;
      let target: { packageId: string | undefined; body: Record<string, unknown> } = { packageId: draftPackageId, body };
      let entering = false;
      if (custom) {
        let pair: string;
        try {
          pair = await pairForFlow(custom, current.name);
        } catch (e) {
          const refusal = plainRefusal(e);
          setError(refusal);
          return { kind: 'refused', reason: refusal.message };
        }
        const declared = overrideDraftBody(body, custom.base, custom.basedOn);
        if (declared === null) {
          const refusal = { message: tFormat('engine.studio.customize.noVersion', locale, { package: custom.baseLabel }) };
          setError(refusal);
          return { kind: 'refused', reason: refusal.message };
        }
        // The buffer was read at another package (the base, before its pair
        // was listed): the pair is taken to hold no draft of the flow, so a
        // draft there is a conflict the author is asked about, never one this
        // save overwrites. Its receipt pins the saves after it.
        const key = `flow:${current.name}`;
        if (!(flowReadAtRef.current?.key === key && flowReadAtRef.current.at === pair)) {
          recordFlowRead('flow', current.name, pair, { ifNoneMatch: '*' });
          // objectstack#36726 — and to hold no live row of it: one published
          // there meanwhile is asked about, never replaced.
          recordFlowPublished('flow', current.name, pair, { ifNoneMatch: '*' });
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
      if (outcome === 'reloaded') return { kind: 'declined' };
      // The badge reads the declaration the server now serves.
      if (entering) setServedNonce((n) => n + 1);
      setSaving('publish');
      // objectstack#36726 — pinned to the published flow this buffer was loaded at.
      const live = await publishSavedItem(
        client,
        { type: 'flow', name: current.name, packageId: target.packageId ?? null },
        hadDraft,
        publishFlow,
      );
      // The published flow moved and the author chose to reload: the load replaces the buffer.
      if (!live.ok && 'reloaded' in live) return { kind: 'declined' };
      if (!live.ok) {
        setHasDraft(!live.draftDiscarded);
        if (live.draftDiscarded) recordFlowRead('flow', current.name, target.packageId, { ifNoneMatch: '*' });
        // objectstack#26858 — what the pending draft now says, or the live flow's verdict.
        rereadFlowVerdict(current.name, target.packageId);
        // The published flow moved and the author kept editing: read as the draft conflict's "not saved".
        const refusal = isPublishConflictKeptEditing(live.error)
          ? flowSaveRefusal(live.error, target.body, locale)
          : publishRefusal(publishFailureOf('flow', current.name, live.error), 'flow', target.body, locale);
        setError(refusal);
        return { kind: 'refused', reason: refusal.message };
      }
      // Live: no draft is left, so the next save asserts none.
      setHasDraft(false);
      recordFlowRead('flow', current.name, target.packageId, { ifNoneMatch: '*' });
      flowStoredRef.current = body;
      // The engine's row for the flow is read again: the publish armed or disarmed it.
      setStatusNonce((n) => n + 1);
      // objectstack#26858 — and the verdict: the one held described the body before this Save.
      rereadFlowVerdict(current.name, target.packageId);
      // objectstack#36511 — clean once nothing was edited since; the top bar's
      // toast says the flow is saved (the header's 已保存 badge retired with it).
      if (JSON.stringify(flowDraftRef.current) === JSON.stringify(body)) setAutoDirty(false);
      return { kind: 'saved' };
    } catch (e) {
      // objectui#11785 — read against `body`, the body this save sent.
      const refusal = flowSaveRefusal(e, body, locale);
      setError(refusal);
      return { kind: 'refused', reason: refusal.message };
    } finally {
      setSaving(false);
    }
  }, [saveFlowDraft, publishFlow, client, current, draft, hasDraft, draftPackageId, locale, rereadFlowVerdict, readOnly, pairForFlow, recordFlowRead, recordFlowPublished]);
  // objectui#11786 — an edit that leaves a step's required input out (a step
  // just added, before it is filled in) is held, not sent: the server would
  // refuse the flow with a 422 naming that input. The step's inspector hints the
  // input, and the line below names it. Asked of the spec's own flow judges
  // (`specRequiresField`) over the inputs each step's inspector offers.
  const flowIncomplete = React.useMemo(
    () => (autoDirty ? flowHeldEdit(draft, locale) : null),
    [autoDirty, draft, locale],
  );
  // objectui#11272 — the buffer is the open flow's own once its load installed it.
  const flowLoaded = current !== null && draftFor === `flow:${current.name}`;
  // Only the open flow's own buffer is held (objectui#11272).
  const flowHeld = flowLoaded ? flowIncomplete : null;
  // objectstack#36511 — what opening another flow (or a new one) would drop.
  const flowUnsaved = flowLoaded && autoDirty;
  useStudioSaveEntry(
    current && flowLoaded && isEditable && !editLocked && !restoring
      ? {
          label: current.label || current.name,
          order: 0,
          dirty: autoDirty,
          held: flowHeld?.clause ?? null,
          save: () => doSave(),
          cancel: () => {
            setAutoDirty(false);
            setError(null);
            reloadFlowDraft();
          },
        }
      : null,
  );
  useHeldEditReport(onHeldEditChange, flowHeld?.clause ?? null);
  // objectstack#36511 item 6 — the AI assistant's unpublished draft is the
  // version on screen: say Save makes it live too, and offer to drop that one
  // flow's draft (`DELETE /meta/flow/NAME?state=draft`, at the package it was
  // read at), back to the live version. Edits not yet saved go with it, asked first.
  const flowAiDraft =
    flowLoaded && hasDraft && (flowDraftChanges ?? []).some((change) => isAgentDraftSurface(change.by));
  const [discardingFlowDraft, setDiscardingFlowDraft] = React.useState(false);
  const discardFlowDraft = React.useCallback(async () => {
    if (!current) return;
    if (autoDirty && !window.confirm(t('engine.studio.aiDraft.discardConfirmUnsaved', locale))) return;
    const at = flowReadAtRef.current?.key === `flow:${current.name}` ? flowReadAtRef.current.at : draftPackageId;
    setDiscardingFlowDraft(true);
    setError(null);
    try {
      await client.reset('flow', current.name, { state: 'draft', ...(at ? { packageId: at } : {}) });
      setHasDraft(false);
      setFlowDraftChanges(null);
      setAutoDirty(false);
      // The load installs the live version and pins the next save to it.
      reloadFlowDraft();
      // The ledger behind Changes re-reads on the pulse, one item fewer.
      emitMetadataRefresh();
    } catch (e) {
      const refusal = plainRefusal(e);
      setError({ ...refusal, message: tFormat('engine.studio.aiDraft.discardFailed', locale, { reason: refusal.message }) });
    } finally {
      setDiscardingFlowDraft(false);
    }
  }, [autoDirty, client, current, draftPackageId, locale, reloadFlowDraft]);
  // objectui#12725 — the header's draft line reads the badge's ledger.
  const flowDraftStatus = useStudioItemDraftStatus(
    current ? { type: 'flow', name: current.name } : null,
    hasDraft && flowLoaded,
    locale,
  );

  // Enable/disable persists via the flow's deployment `status` (active = on,
  // obsolete = off). objectstack#36511 — the switch is live at once, as an
  // installed app's ledger switch is: it writes the status onto the flow as
  // the server holds it, never onto an edit Save has not sent, and publishes
  // that one flow. The edits on the page keep the new status and stay unsaved.
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
    // package refuses the save, so the flip would only be rolled back.
    if (!current || readOnly) return;
    // objectui#11272 — refused on a buffer that is not this flow's document
    // (its load is not in yet): the switch is not offered then either.
    if (draftFor !== `flow:${current.name}`) return;
    const flowName = current.name;
    const prevStatus = draft.status;
    const next = !(draft.status !== 'obsolete' && draft.status !== 'invalid');
    const nextStatus = next ? 'active' : 'obsolete';
    const stored = { ...flowStoredRef.current, status: nextStatus };
    const hadDraft = hasDraft;
    setDraft((d) => ({ ...d, status: nextStatus }));
    setSaving('draft');
    setError(null);
    // objectui#11124 — the switch and the canvas status (both read
    // `draft.status`) never show a status the server refused. Only `status`
    // is put back, and only on the same flow, still holding the refused one.
    const rollBack = () =>
      setDraft((d) => {
        if (draftFlowRef.current !== flowName || d.status !== nextStatus) return d;
        const { status: _refused, ...rest } = d;
        return prevStatus !== undefined ? { ...rest, status: prevStatus } : rest;
      });
    try {
      // objectui#11773 — a reload replaced the buffer the flip was taken on.
      if ((await saveFlowDraft('flow', flowName, stored, { mode: 'draft', packageId: draftPackageId, surface: 'studio' })) === 'reloaded') return;
      setSaving('publish');
      // objectstack#36726 — pinned to the published flow this buffer was loaded at, as the Save is.
      const live = await publishSavedItem(
        client,
        { type: 'flow', name: flowName, packageId: draftPackageId ?? null },
        hadDraft,
        publishFlow,
      );
      // The author chose to reload: the load replaces the buffer, the switch with it.
      if (!live.ok && 'reloaded' in live) return;
      if (!live.ok) {
        setHasDraft(!live.draftDiscarded);
        if (live.draftDiscarded) recordFlowRead('flow', flowName, draftPackageId, { ifNoneMatch: '*' });
        rollBack();
        setError(
          isPublishConflictKeptEditing(live.error)
            ? flowSaveRefusal(live.error, stored, locale)
            : publishRefusal(publishFailureOf('flow', flowName, live.error), 'flow', stored, locale),
        );
        return;
      }
      setHasDraft(false);
      recordFlowRead('flow', flowName, draftPackageId, { ifNoneMatch: '*' });
      if (draftFlowRef.current === flowName) flowStoredRef.current = stored;
      setStatusNonce((n) => n + 1);
      rereadFlowVerdict(flowName, draftPackageId);
      toast.success(next ? t('engine.studio.auto.enabledToast', locale) : t('engine.studio.auto.disabledToast', locale));
    } catch (e) {
      rollBack();
      setError(flowSaveRefusal(e, stored, locale));
    } finally {
      setSaving(false);
    }
  }, [saveFlowDraft, publishFlow, client, current, draft, draftFor, hasDraft, draftPackageId, locale, readOnly, recordFlowRead, rereadFlowVerdict]);

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
          if (!confirmDropUnsavedWork(flowUnsaved, locale)) return;
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
        // The door stored the copy live and the engine already holds its row;
        // the `_status` snapshot this pillar holds predates it, so it is read
        // once more, or the copy's header reads the row it lacks as an
        // unpublished draft. The other landing remounts the pillar keyed by
        // package, and that mount reads `_status` itself.
        setStatusNonce((n) => n + 1);
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
  // objectstack#34818 — Debug takes the Configuration's place in the slot, so
  // opening it shows the properties half, where the simulator is drawn.
  const flowDebugOpen = flowSection === 'debug';
  React.useEffect(() => {
    if (flowDebugOpen && showSlotProps) showSlotProps();
  }, [flowDebugOpen, showSlotProps]);
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
                      title={[railLabel(f), t(FLOW_GLYPH_LABEL_KEY[glyph], locale), reading?.view.label].filter(Boolean).join(' · ')}
                      onClick={() => {
                        // objectstack#26705 — another flow's load replaces the
                        // buffer the held step lives in; the open one keeps it.
                        if (!active && !confirmDropUnsavedWork(flowUnsaved, locale)) return;
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
                      {railLabel(f)}
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
            title={current ? flowLabels?.flowLabel || current.label || current.name : t('engine.studio.auto.heading', locale)}
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
            // objectstack#36745 — the meta wrapper is a block-level flex, so
            // the give-way row inside it reads the slot's whole width.
            meta={
              isEditable ? (
                <>
                  <span id={canvasHintId} className="sr-only">
                    {t('engine.studio.auto.canvasHint', locale)}
                  </span>
                  {flowOpen && headerRunStatus && (
                    <span data-testid="auto-flow-meta" className="flex min-w-0">
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
                {/* objectstack#36511 — a Save or a switch flip in flight. */}
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
                      confirmOpen: () => confirmDropUnsavedWork(flowUnsaved, locale),
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
            {(error || flowHeld || flowAiDraft) && (
              <div className="shrink-0 space-y-2 px-6 pb-1 pt-3">
                {flowAiDraft && (
                  <StudioAiDraftNotice
                    locale={locale}
                    onDiscard={!editLocked ? () => void discardFlowDraft() : undefined}
                    busy={discardingFlowDraft || saving !== false}
                  />
                )}
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
                      value={{
                        section,
                        onSectionChange: setFlowSection,
                        onProblemsChange: setProblemTally,
                        published: current && publishedFlowNames ? publishedFlowNames.has(current.name) : undefined,
                        // objectstack#34818 — in the right slot, Debug draws the simulator there.
                        debugTarget: inSlot && section === 'debug' ? slot.propsTarget : null,
                      }}
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

        {/* #34818 — Debug takes the Configuration's place, and the aside is
            not drawn: in the classic row the simulator column widens to the
            aside's width; in the right slot the simulator is drawn in the
            slot itself (the chrome's `debugTarget`). The selection is kept,
            so leaving Debug brings the aside back as it was. */}
        {flowsEmpty || section === 'debug' ? null : configFolded && !inSlot ? (
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
            selection && inspector && current && flowLoaded ? flowSelectionHeading(draft, selection, locale, flowLabels) : null;
          const aside = (
            <StudioInspector
              testId="auto-config-aside"
              className={inSlot ? 'w-full flex-1 border-l-0' : undefined}
              eyebrow={heading?.eyebrow ?? t('engine.studio.auto.config', locale)}
              title={heading && <FlowSelectionTitle heading={heading} locale={locale} />}
              onClose={selection ? () => setSelection(null) : undefined}
              closeLabel={t('engine.studio.deselect', locale)}
              actions={heading ? <span ref={setConfigHeaderSlot} data-testid="auto-config-header-actions" className="flex shrink-0 items-center" /> : undefined}
              // objectui#12453 — a read-only package saves no draft: no footer.
              // objectstack#28570 — a customized flow saves into the pair.
              footer={
                editLocked
                  ? null
                  : readOnly
                    ? t('engine.studio.customize.saveFooter', locale)
                    : t('engine.studio.inspector.draftFooter', locale)
              }
              // objectui#12454 — a selection's inspector brings its own padding
              // (the metadata inspector shell); only the empty sentence takes the aside's.
              bodyClassName={heading ? 'p-0' : undefined}
            >
              {heading ? (
                <InspectorShellHostProvider value={{ onSelectionChange: setSelection, headerActionsTarget: configHeaderSlot }}>
                  {configBodyEl}
                </InspectorShellHostProvider>
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
        submitLabel={t('engine.studio.createLive', locale)}
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
