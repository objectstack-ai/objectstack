// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The object designer — one object, full-screen on its metadata address
 * (`/studio/<package>/metadata/object/<name>`, objectstack#36904, epic
 * objectstack#36890; ADR-0146 D1 as amended): the item header (× back to the
 * object list, ‹ › through it), the tabs in #36513's order with the item
 * tools after them (`objectDesignerTabs.ts`), and the object canvas — with the
 * records-grid slot and the object draft-save shape only it uses.
 *
 * It has no object list of its own and no New: the list is the area's
 * (`ResourceListPage`), and its 「新建」 creates an object
 * (`MetadataListCreateDialog`). Another object opens through ×, ‹ › or ⌘K
 * (decision 7). The area mounts it (`StudioMetadataArea`); the old
 * `/data?surface=object:<name>` address redirects there (`dataPillarRedirect`).
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useAdapter, SchemaRendererProvider } from '@object-ui/react';
import { leadWithNameField } from '@object-ui/core';
import {
  dropServedPicklistOptions,
  extractDraftBody,
  formatMetadataError,
  readDraftChanges,
  type DraftChange,
} from '@object-ui/data-objectstack';
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { useStudioRightSlot } from './studioRightSlotState.js';
import { StudioInspector } from './StudioInspector.js';
import { agentDraftMarkOf, DraftChip, DraftSourceLine, isAgentDraftSurface } from './StudioDraftMark.js';
import { StudioTab } from './StudioItemHeader.js';
import { ResourceDetailHeader } from '../metadata-admin/ResourceDetailHeader.js';
import { ItemToolTabPanel, ItemToolTabStrip } from '../item-tools/ItemToolTabs.js';
import { useCanAuthorMetadata, useCanReadAuthoringTrail } from '../../hooks/useCanAuthorMetadata.js';
import { useStudioItemDraftStatus } from './studioItemDraftStatus.js';
import {
  DATA_CONTENT_CONTAINER,
  DATA_TAB_FLAT_ONLY,
  DATA_TAB_FLAT_WIDE_ONLY,
  DATA_TAB_FOLDED_FIRST_ONLY,
  DATA_TAB_FOLDED_ONLY,
} from './dataTabsFold.js';
import {
  OBJECT_DESIGNER_ALWAYS_FLAT,
  OBJECT_DESIGNER_FOLD_FIRST,
  OBJECT_DESIGNER_TOOL_TABS,
  OBJECT_DESIGNER_VIEWS,
  useObjectDesignerTab,
  type ObjectDesignerView,
} from './objectDesignerTabs.js';
import { RECORDS_SCROLLBAR_VISIBLE, revealColumn } from './recordsGridChrome.js';
import { StudioRefusalStrip } from './StudioRefusalStrip.js';
import { pairIdOf } from './AutomationsFlowRail.js';
import {
  addedExtensionFieldName,
  addedFieldName,
  type CelPanelTab,
  extensionFieldsOf,
  fieldCelStamp,
  formFieldNames,
  formPreviewSource,
  isCelPanelTab,
  panelItemCelStamp,
  panelItemOf,
  STUDIO_SYSTEM_FIELD_NAMES,
} from './DataPillarHelpers.js';
import {
  type StudioBaseCustomization,
  StudioHeldNotice,
  StudioReadOnlyLink,
  type StudioSavedDraft,
  useHeldEditReport,
  useShowInputFocus,
} from './StudioPillarKit.js';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  GridFieldAuthoringProvider,
  cn,
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
} from '@object-ui/components';
import { ObjectView as PluginObjectView } from '@object-ui/plugin-view';
import { ListView } from '@object-ui/plugin-list';
import { ObjectForm } from '@object-ui/plugin-form';
import { Ban, Loader2, Plus, ChevronDown, Sparkles } from 'lucide-react';
import {
  type MetadataSelection,
} from '../metadata-admin/preview-registry.js';
import {
  useRegisteredMetadataInspector,
} from '../metadata-admin/inspector-registry.js';
import type { FormViewSpec } from '../metadata-admin/form-spec.js';
import { useMetadataClient, useMetadataTypes } from '../metadata-admin/useMetadata.js';
import { publishedPinOf, isPublishConflictKeptEditing, readDraftForSave, useDraftSaveGuard } from '../metadata-admin/DraftConflictDialog.js';
import {
  authoredObjectBuffer,
  authoredPublishedObject,
  servedOnlyFields,
  type ObjectLayers,
} from '../metadata-admin/authoredObjectBuffer.js';
import {
  DraftVerdictBodyContext,
  DraftVerdictContext,
  draftEnvelopeDiagnostics,
  editedItemDiagnostics,
  type ServerDiagnostics,
} from '../metadata-admin/draftVerdict.js';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { publishSavedItem, readPublishedPin, useStudioSaveEntry, type StudioSaveResult } from './studioSaveBar.js';
import { irreversibleFieldChanges } from './objectSaveConfirm.js';
import {
  destructiveFindings,
  objectHeldEdit,
  objectSaveRefusal,
  plainRefusal,
  publishFailureOf,
  publishRefusal,
  type StudioHeld,
  type StudioRefusal,
} from './metadataError.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
import { type Surface } from './navSurface.js';
import { useSurfaceActionDeepLink } from './useSurfaceDeepLink.js';
import { t, tFormat, translateMetadataType, useMetadataLocale } from '../metadata-admin/i18n.js';
import { InspectorShellHostProvider } from '../metadata-admin/inspectors/_shared.js';
import type { DestructiveChangeIssue } from '@objectstack/spec/api';
import {
  readFields,
  writeFields,
  newField,
  readGroups,
  groupArrangement,
  type FieldEntry,
} from '../metadata-admin/previews/object-fields-io.js';
import { extensionWithArrangement } from '../objectExtensionArrangementSave.js';
import type { FieldTypeId } from '../metadata-admin/previews/field-types.js';
import {
  ExternalObjectNotice,
  readExternalBinding,
  useExternalWriteState,
} from '../metadata-admin/previews/external-object.js';
import { AddFieldPopover } from './AddFieldPopover.js';
import { StudioGridAddFieldButton, StudioGridAddFieldProvider, type StudioGridAddFieldValue } from './StudioGridAddField.js';
import { FormToolbar, ObjectFormDesigner } from './ObjectFormDesigner.js';
import { fieldLayoutSourcesOf } from './fieldLayoutSources.js';
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
import { contributedItemTitle, railCustomizationsOf } from './StudioRailCustomizations.js';
import {
  baseContributionsOf,
  contributedFieldsOf,
} from './contributionRows.js';
import {
  OBJECT_EXTENSION_TYPE,
  baseOwnedFieldNames,
  extensionFieldName,
  extensionBodyForSave,
  extensionFieldNames,
  foldObjectExtension,
  objectExtensionBodyOf,
  routeFoldedFieldsEdit,
  withoutReplacedPlacements,
  type ObjectExtensionBody,
  BaseFieldDisplayPatchContext,
} from './StudioCustomizeControls.js';
import { SavedToCustomizationNote } from '../../preview/savedToCustomization.js';
import { toast } from 'sonner';

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

// Exported for tests and for the area's object page (`StudioMetadataArea`).
export function DataPillar({
  packageId,
  objectName,
  publishNonce = 0,
  onDraftSaved,
  readOnly: packageReadOnly = false,
  customization = null,
  onHeldEditChange,
  onReviewChanges,
}: {
  packageId: string;
  /** objectstack#36904 — the one object this page designs: the name in its metadata address. */
  objectName: string;
  publishNonce?: number;
  onDraftSaved?: (saved?: StudioSavedDraft) => void;
  /** objectstack#34725 — the copilot-changes line's 查看: open the package's pending changes. */
  onReviewChanges?: () => void;
  /** Courtesy gate: hide/disable metadata-authoring affordances (records stay usable). */
  readOnly?: boolean;
  /** objectstack#28575 — on a read-only base, its pair: a base object's new fields and layout land there. */
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
  // objectstack#36904 — the object is the address's: its label, icon and
  // colour are the loaded object's as it is being edited (its draft when it
  // has one, a draft-only object's included, else as served; set where the
  // object loads), its machine name until it has loaded.
  const [served, setServed] = React.useState<{ label?: string; icon?: string; color?: string }>({});
  const current = React.useMemo<Surface>(
    () => ({ type: 'object', name: objectName, label: served.label || objectName, icon: served.icon, color: served.color }),
    [objectName, served],
  );
  const readOnly = packageReadOnly;
  const railPairId = packageReadOnly && customization ? customization.pairId : null;
  const railMarks = railCustomizationsOf(customization?.marks, packageId);
  const [objDraft, setObjDraft] = React.useState<Record<string, unknown>>({});
  // objectstack#28575 (ADR-0146 D10) — a base object of a read-only base takes
  // fields as an extension in the base's pair, never in its own buffer: the
  // pair's `object_extension` of it (`extend` = the object), filed under the
  // object's name. The base object stays as shipped; `objDraft` holds it as
  // served (which already folds the pair's PUBLISHED extension), and what the
  // pillar shows is `shownDraft`, the two folded. `published` names the
  // fields the published extension declares, so one the draft drops is gone.
  const extendsBase = packageReadOnly && customization !== null;
  const [ext, setExt] = React.useState<{
    for: string;
    body: ObjectExtensionBody;
    published: ReadonlySet<string>;
  } | null>(null);
  const [extDirty, setExtDirty] = React.useState(false);
  const [extHasDraft, setExtHasDraft] = React.useState(false);
  const [extReloadNonce, setExtReloadNonce] = React.useState(0);
  const extLoadedRef = React.useRef<string | null>(null);
  // objectstack#36726 — the pair the open extension buffer was read at (`null`: none was listed).
  const extReadAtRef = React.useRef<{ name: string; pair: string | null } | null>(null);
  const extOpen = extendsBase && ext !== null && ext.for === current?.name ? ext : null;
  // Adding a field asks the ensure door for the pair once per base: its
  // answer names every write, ⛔ never a `<base>.custom` spelled here.
  const extWalled = customization?.walled === true;
  const extWritable = extOpen !== null && !extWalled;
  // objectstack#36505 (ADR-0146 D10) — an installed object's field layout is
  // arranged in its pair's extension: the 「字段布局」 tab is editable where
  // that extension is (not walled), and stays read-only where it is not.
  const layoutWritable = extendsBase && extWritable;
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
  // Records grid ⇄ Field layout ⇄ Validations ⇄ … — views of the SAME
  // object. Grid/Form are the runtime renderer (same-renderer principle);
  // Validations edits `validations` rules; Settings edits object basics +
  // the ADR-0085 semantic roles. All patch the one `objDraft`.
  // objectstack#36904 — the open tab is in the address (`objectDesignerTabs.ts`),
  // and the item tools are tabs after the views (epic decision 8): History
  // only for a caller the authoring-trail doors admit, as on every item page.
  const canReadTrail = useCanReadAuthoringTrail();
  const canAuthor = useCanAuthorMetadata();
  const toolTabs = React.useMemo(
    () => OBJECT_DESIGNER_TOOL_TABS.filter((tab) => tab !== 'history' || canReadTrail),
    [canReadTrail],
  );
  const designerTab = useObjectDesignerTab(toolTabs);
  const viewMode = designerTab.location.view;
  const toolTab = designerTab.location.tool;
  // objectui#11781 — the field inspector belongs to the view that opened it,
  // so a view switch closes it, the same act as its own Close: the selection
  // goes, and its blocking count expires with it (see `blockingReport`). Left
  // open, a Records/Form selection stayed beside Validations, Hooks, Actions,
  // API and Settings, where nothing on screen is that field.
  const selectViewMode = (next: ObjectDesignerView) => {
    if (next !== viewMode || toolTab) setFieldSel(null);
    designerTab.selectView(next);
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
  // objectstack#34724 — `?action=<action>` on the object's address opens its
  // Actions view on that action (Studio's landing links a switched-off action
  // that lives in its object's `actions[]` here; `switchedOffActionPath`).
  useSurfaceActionDeepLink(current, current, (name) => showObjTarget({ kind: 'action', id: name }));
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
    // objectstack#37440 — the version the buffer's own Save wrote, which pins its publish.
    heldDraftVersion: heldObjDraftVersion,
    dialog: objConflictDialog,
  } = useDraftSaveGuard(client, reloadObjDraft);
  // objectstack#28575 — the extension buffer's own guard, pinned by its draft read at the pair.
  const reloadExt = React.useCallback(() => setExtReloadNonce((n) => n + 1), []);
  const {
    save: saveExtDraft,
    recordRead: recordExtRead,
    // objectstack#36726 — and the pair's published extension row, for the Save's publish.
    recordPublished: recordExtPublished,
    publish: publishExt,
    heldDraftVersion: heldExtDraftVersion,
    dialog: extConflictDialog,
  } = useDraftSaveGuard(client, reloadExt);
  // The pair a READ names is the surface's (`StudioBaseCustomization.pairId`),
  // read through this ref, so the pair a first add creates never reloads the
  // buffer it is about to save.
  const extReadPairRef = React.useRef<string | null>(customization?.pairId ?? null);
  React.useLayoutEffect(() => {
    extReadPairRef.current = customization?.pairId ?? null;
  });
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
        // objectstack#36904 — the header's label, icon and colour: the draft
        // when there is one (a draft-only object's own label, objectui#11843),
        // else the object as served.
        const shown = (draftBody ?? baseline) as { label?: I18nLabel; icon?: unknown; color?: unknown };
        const next = {
          label: resolveI18nLabel(shown.label, locale)?.trim() || undefined,
          icon: typeof shown.icon === 'string' ? shown.icon : undefined,
          color: typeof shown.color === 'string' ? shown.color : undefined,
        };
        setServed((prev) => (prev.label === next.label && prev.icon === next.icon && prev.color === next.color ? prev : next));
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
          // objectstack#36726 — the published extension's version at the pair,
          // the address the Save's publish writes, read BEFORE the rows below
          // (the server's own order for `/layers`): a publish landing between
          // the reads leaves the pin older than the buffer, so the next Save
          // is asked about, never published over it.
          const publishedAt = await readPublishedPin(client, OBJECT_EXTENSION_TYPE, name, pair);
          if (cancelled) return;
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
          recordExtPublished(OBJECT_EXTENSION_TYPE, name, pair, publishedAt);
        }
        if (refreshOnly) refreshInstalledRef.current = true;
        extReadAtRef.current = { name, pair };
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
  }, [client, current, extendsBase, publishNonce, extReloadNonce, objRefreshNonce, recordExtRead, recordExtPublished]);

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
      // objectstack#36601 — pinned to the published row this buffer was loaded at;
      // objectstack#37440 — and to the draft this Save just wrote (its receipt).
      const live = await publishSavedItem(
        client,
        { type: 'object', name, packageId: to, draftVersion: heldObjDraftVersion('object', name, to) },
        hadDraft,
        publishObj,
      );
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
  }, [saveObjDraft, recordObjRead, publishObj, heldObjDraftVersion, client, current, objDraft, hasDraft, publishedFieldNames, packageId, locale]);

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
  // objectstack#36904 — the address names the object, so it can name one that
  // is not there (a deleted object's bookmark, a mistyped link): loaded with
  // neither a stored object nor a draft, it says so rather than offering an
  // "unpublished new object" to design. A draft-only object has its draft.
  const objMissing = objLoaded && !hasBaseline && !hasDraft;

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
      // objectstack#36726 — a buffer read before any pair was listed read no
      // row there: its publish asserts none, so an extension another writer
      // published at the pair meanwhile is asked about, never replaced.
      const readAt = extReadAtRef.current;
      if (readAt?.name === name && readAt.pair !== pair) {
        recordExtPublished(OBJECT_EXTENSION_TYPE, name, pair, { ifNoneMatch: '*' });
        extReadAtRef.current = { name, pair };
      }
      const outcome = await saveExtDraft(OBJECT_EXTENSION_TYPE, name, extensionBodyForSave(body), {
        mode: 'draft',
        packageId: pair,
        surface: 'studio',
      });
      if (outcome === 'reloaded') return { kind: 'declined' };
      setExtHasDraft(true);
      setSaving('publish');
      // objectstack#36726 — pinned to the published extension row this buffer was loaded at.
      const live = await publishSavedItem(
        client,
        // objectstack#37440 — pinned to the draft this Save just wrote (its receipt).
        { type: OBJECT_EXTENSION_TYPE, name, packageId: pair, draftVersion: heldExtDraftVersion(OBJECT_EXTENSION_TYPE, name, pair) },
        hadDraft,
        publishExt,
      );
      // The published row moved and the author chose to reload: the load replaces the buffer.
      if (!live.ok && 'reloaded' in live) return { kind: 'declined' };
      if (!live.ok) {
        if (live.draftDiscarded) {
          setExtHasDraft(false);
          recordExtRead(OBJECT_EXTENSION_TYPE, name, pair, { ifNoneMatch: '*' });
        }
        // The published row moved and the author kept editing: read as the draft conflict's "not saved".
        const refusal = isPublishConflictKeptEditing(live.error)
          ? plainRefusal(live.error)
          : publishRefusal(
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
  }, [extOpen, customization, extPairFor, saveExtDraft, recordExtRead, recordExtPublished, publishExt, heldExtDraftVersion, client, extHasDraft, locale]);
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
  // objectstack#36505 (ADR-0146 D10) — an edit of an installed object's field
  // layout, written into the pair's extension of it as the WHOLE arrangement
  // (`fieldGroups`, every group listing its members, the objectstack#36498
  // shape), composed by the shared arrangement writer's own composer
  // (`extensionWithArrangement`) over the extension this buffer holds. The
  // fields half of the edit (a pair field's dropped `group`) goes the way a
  // field edit goes; a base field's `group` is not the extension's to write,
  // and the arrangement places it. Saved by the extension's Save with the
  // rest of the buffer, so one Save publishes the object's whole
  // customization (objectstack#36511) and no second writer races this buffer.
  const onExtLayoutPatch = React.useCallback(
    (patch: Record<string, unknown>) => {
      if (!extWritable || !('fieldGroups' in patch || 'fields' in patch)) return;
      setExt((prev) => {
        if (!prev) return prev;
        const folded = foldObjectExtension(objDraft, prev.body, prev.published);
        const fieldsAfter = 'fields' in patch ? patch.fields : folded.fields;
        const groupsAfter = readGroups('fieldGroups' in patch ? patch.fieldGroups : folded.fieldGroups);
        let body: ObjectExtensionBody =
          'fields' in patch
            ? routeFoldedFieldsEdit({
                before: folded.fields,
                after: patch.fields,
                baseOwned: baseOwnedFieldNames(objDraft, prev.body, prev.published),
                ext: prev.body,
              })
            : prev.body;
        body = withoutReplacedPlacements(body);
        body = extensionWithArrangement(body, prev.body.extend, {
          fieldGroups: groupArrangement(readFields(fieldsAfter), groupsAfter),
        });
        return { ...prev, body };
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
  // objectstack#36904 — what the discard refused, kept apart from `error`:
  // the discard re-reads the object, and a load clears `error` as it starts,
  // so the refusal set here was wiped by the very read it asked for.
  const [discardRefusal, setDiscardRefusal] = React.useState<StudioRefusal | null>(null);
  const discardAllDrafts = React.useCallback(async () => {
    if (!adapter || !window.confirm(t('engine.studio.copilotChanges.discardConfirm', locale))) return;
    setDiscardingDrafts(true);
    setDiscardRefusal(null);
    try {
      const result = await adapter.getClient().packages.discardDrafts(packageId);
      if (!result.success || result.failedCount > 0) {
        // The sentence names each item as the rail does (its label, else its
        // name); the server's own words stay behind Details, never in it.
        const labelOf = (f: { type: string; name: string }) =>
          (f.type === 'object' && f.name === current.name ? current.label : '') || f.name;
        const items = [...new Set(result.failed.map(labelOf))].join(
          t('engine.studio.copilotChanges.itemSeparator', locale),
        );
        setDiscardRefusal({
          message: tFormat('engine.studio.copilotChanges.discardFailed', locale, { items }),
          detail: result.failed.map((f) => `${f.type}/${f.name}: ${f.error}`).join('\n') || undefined,
        });
      }
    } catch (e) {
      setDiscardRefusal(plainRefusal(e));
    } finally {
      setDiscardingDrafts(false);
      reloadObjDraft();
      emitMetadataRefresh();
    }
  }, [adapter, locale, current, packageId, reloadObjDraft]);
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
  // objectstack#36505 — where each field of an installed object comes from,
  // for the Field layout canvas: the original package or this environment
  // (a contributed field is named by its own mark).
  const fieldLayoutSources = React.useMemo(
    () =>
      extendsBase
        ? fieldLayoutSourcesOf(shownDraft.fields, {
            contributed: contributedFields,
            environment: [...extensionFieldNames(extOpen?.body), ...(extOpen?.published ?? [])],
          })
        : undefined,
    [extendsBase, shownDraft.fields, contributedFields, extOpen],
  );
  const selectedContributedField =
    fieldSel?.kind === 'field' ? (contributedFields.get(String(fieldSel.id)) ?? null) : null;
  // objectstack#36505 — a group of an installed object is arranged in the
  // pair's extension too, so its inspector edits like a field's.
  const fieldRailReadOnly =
    (readOnly && !(extWritable && (fieldSel?.kind === 'field' || fieldSel?.kind === 'group'))) ||
    selectedContributedField !== null;
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

  // The object's tabs, in #36513's order (`objectDesignerTabs.ts`):
  // underline tabs in the item header. objectui#5813 — the 90% path is
  // Records / Field layout (fields ARE the grid's columns). objectui#12450 —
  // the five power panels are flat tabs beside them when the content column
  // has room, and fold into "Advanced" when it does not, Hooks and API first
  // (the rule lives in `dataTabsFold.ts`).
  const dataTabs = OBJECT_DESIGNER_VIEWS.map((v) => ({ key: v.view, label: t(v.label, locale) }));
  const advancedDataTabs = dataTabs.filter((tab) => !OBJECT_DESIGNER_ALWAYS_FLAT.includes(tab.key));
  const foldFirstTabs = advancedDataTabs.filter((tab) => OBJECT_DESIGNER_FOLD_FIRST.includes(tab.key));
  // objectui#12450 — the Records grid draws flush with the content column.
  const recordsFlush = !toolTab && objLoaded && viewMode === 'grid' && hasBaseline;
  // objectui#12451 — so does the Form tab: its one toolbar row spans the
  // column, and the canvas below it carries its own padding.
  const formFlush = !toolTab && objLoaded && viewMode === 'form';
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
          readOnly && !layoutWritable
            ? undefined
            : (layoutWritable ? extDirty : dirty)
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
  // the object's field groups, never by an internal form view, so the Field
  // layout tab always edits the field groups. objectstack#36505 — it says
  // where they are used, in one sentence, in place of the chip that named the
  // field groups beside a form view.
  const formLayoutSource = current ? (
    <span data-testid="form-layout-used-on" className="text-xs text-muted-foreground">
      {t('engine.studio.data.form.usedOn', locale)}
    </span>
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

  // objectui#12459 — the object's tab row lives in the item header.
  // objectui#12450 — every view flat at a wide content column; narrower,
  // Hooks and API fold into "Advanced", then the other three panels too. Every
  // form is rendered and a container query on the content column displays
  // exactly one of each (see `dataTabsFold.ts`); each trigger's menu holds what
  // is folded at its width. Folded, the trigger keeps its own name whichever
  // panel is open (objectui#11794): renamed to the panel ("Validations ▾") it
  // hid the one word that says sibling panels sit behind it. Where you are
  // still shows twice — the trigger takes the active look while one of its
  // panels is open, and the menu marks that panel as the checked radio item.
  // objectstack#36904 — the item tools follow as tabs (`ItemToolTabStrip`).
  const viewActive = (key: ObjectDesignerView) => !toolTab && viewMode === key;
  const advancedMenu = (tabs: typeof advancedDataTabs, testId: string, className: string) => {
    const open = tabs.find((tab) => viewActive(tab.key));
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <StudioTab data-testid={testId} active={Boolean(open)} className={className}>
            {t('engine.studio.data.tab.advanced', locale)}
            <ChevronDown className="h-3 w-3" />
          </StudioTab>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {/* The group only marks which item is checked; each item
              selects its own panel, as the plain items did. */}
          <DropdownMenuRadioGroup value={open?.key ?? ''}>
            {tabs.map((tab) => (
              <DropdownMenuRadioItem key={tab.key} value={tab.key} onSelect={() => selectViewMode(tab.key)}>
                {tab.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const dataTabRowEl = (
    <>
      {dataTabs.map((tab) =>
        OBJECT_DESIGNER_ALWAYS_FLAT.includes(tab.key) ? (
          <StudioTab key={tab.key} active={viewActive(tab.key)} onClick={() => selectViewMode(tab.key)}>
            {tab.label}
          </StudioTab>
        ) : (
          <StudioTab
            key={tab.key}
            data-testid={`data-tab-flat-${tab.key}`}
            active={viewActive(tab.key)}
            onClick={() => selectViewMode(tab.key)}
            className={OBJECT_DESIGNER_FOLD_FIRST.includes(tab.key) ? DATA_TAB_FLAT_WIDE_ONLY : DATA_TAB_FLAT_ONLY}
          >
            {tab.label}
          </StudioTab>
        ),
      )}
      {advancedMenu(foldFirstTabs, 'data-tabs-advanced-first', DATA_TAB_FOLDED_FIRST_ONLY)}
      {advancedMenu(advancedDataTabs, 'data-tabs-advanced', DATA_TAB_FOLDED_ONLY)}
      <ItemToolTabStrip
        tabs={toolTabs}
        active={toolTab?.tab ?? 'details'}
        onSelect={(tab) => {
          setFieldSel(null);
          designerTab.selectTool({ tab });
        }}
        locale={locale}
      />
    </>
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
        <div className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', DATA_CONTENT_CONTAINER)} data-testid="data-content-column">
          {/* objectstack#36904 — the one header of a full-screen item
              (`ResourceDetailHeader`): × back to the object list, ‹ › through
              it, the tab row; the address carries the open tab to a neighbour. */}
          <ResourceDetailHeader
            testId="data-object-header"
            type="object"
            name={current.name}
            tabAddress={designerTab.address}
            locale={locale}
            icon={HeaderIcon}
            objectTile={{ color: headerColor }}
            label={current.label}
            apiName={current.name}
            typeLabel={translateMetadataType('object', locale, 'Object')}
            packageLabel={packageId}
            // objectui#11781 — Esc with a field open closes the field first.
            closeOnEscape={!inspectorOpen}
            // objectstack#29691 (ADR-0146 D3) — a base object the pair extends
            // saves to the base's pair, named by the base's label.
            note={
              customization !== null && extOpen !== null && (extOpen.published.size > 0 || extHasDraft || extDirty) ? (
                <SavedToCustomizationNote
                  baseLabel={customization.baseLabel}
                  pairId={customization.pairId ?? pairIdOf(customization.base)}
                  testId="data-object-saved-to"
                />
              ) : undefined
            }
            meta={objLoaded ? fieldCountText : undefined}
            status={objDraftStatus}
            primaryAction={
              <>
                {/* objectui#12511 — the header holds no actions of its own, so
                    it reads the same on every tab. Add field is a field action,
                    offered where fields are laid out: the Form toolbar, the
                    Records toolbar (objectstack#34794) and the Records grid's
                    own "+" column (objectui#12516). The item tools are tabs. */}
                {/* objectstack#28575 — the ensure door refuses this caller: Add
                    field draws disabled, in the console's own sentence. */}
                {extendsBase && extWalled && objLoaded && !objIsExternal && !toolTab && (viewMode === 'grid' || viewMode === 'form') && (
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
                {/* objectui#12453 — on the Form tab it carries the layout's
                    read-only sentence the Layout control no longer does. */}
                {readOnly && (
                  <StudioReadOnlyLink
                    item={current}
                    title={
                      viewMode === 'form' && !toolTab && !layoutWritable
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
          {toolTab ? (
            // objectstack#36904 — References, History and Source, as on every
            // item page; Source edits the same buffer the Save sends.
            <ItemToolTabPanel
              tab={toolTab.tab as 'references' | 'history' | 'source'}
              view={toolTab.view}
              onViewChange={(view) => designerTab.selectTool({ tab: toolTab.tab, view })}
              type="object"
              name={current.name}
              packageId={packageId}
              source={
                objLoaded
                  ? {
                      value: objDraft,
                      onChange:
                        objIsExternal || readOnly
                          ? undefined
                          : (next) => {
                              setObjDraft(next);
                              setDirty(true);
                            },
                    }
                  : undefined
              }
              onRolledBack={!readOnly && canAuthor ? () => setObjReloadNonce((n) => n + 1) : undefined}
              locale={locale}
              className="min-h-0 flex-1 overflow-auto"
            />
          ) : (
            <>
              {(error ?? discardRefusal) && (
                <StudioRefusalStrip
                  refusal={(error ?? discardRefusal)!}
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
              ) : objMissing ? (
                <div
                  role="status"
                  data-testid="data-object-not-found"
                  className={cn('flex flex-col items-center justify-center gap-1 py-16 text-sm text-muted-foreground', bodyFlush && 'mx-6')}
                >
                  <span className="font-medium text-foreground">{t('engine.form.objectNotFound', locale)}</span>
                  <span className="font-mono text-xs">{current.name}</span>
                </div>
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
                  // objectstack#36505 — an installed object's layout goes
                  // into its pair's extension, as the whole arrangement.
                  onChange={layoutWritable ? onExtLayoutPatch : onPatch}
                  selectedField={fieldSel?.kind === 'field' ? fieldSel.id : null}
                  onSelectField={(name) => setFieldSel({ kind: 'field', id: name })}
                  selectedGroup={fieldSel?.kind === 'group' ? fieldSel.id : null}
                  onSelectGroup={(key) => setFieldSel({ kind: 'group', id: key })}
                  // objectstack#30057 — on a base object a new field goes into
                  // the pair's extension, from the toolbar beside the mode control.
                  onAddField={canAddFields && !extendsBase ? addField : undefined}
                  readOnly={readOnly && !layoutWritable}
                  modeControl={formToolbarLeading}
                  contributedFields={contributedFields}
                  draftMarkedFields={agentMarkedFields}
                  arrangeContributed={layoutWritable}
                  fieldSources={fieldLayoutSources}
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
                    draft={shownDraft}
                    objectName={current.name}
                    groupKey={fieldSel.id}
                    onPatch={layoutWritable ? onExtLayoutPatch : onPatch}
                    onClose={() => setFieldSel(null)}
                    readOnly={readOnly && !layoutWritable}
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
    </div>
  );
}
