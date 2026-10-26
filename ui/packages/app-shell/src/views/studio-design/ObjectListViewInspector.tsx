// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11823 (step 1) — the Properties panel of an `object` leaf edits the
 * list view its canvas shows: the columns, the filter and the sort, saved to
 * the package draft. ADR-0084's Interface editor, "source + preview": the
 * canvas beside the panel is that running list (`StudioObjectRecordsCanvas`),
 * and it shows the panel's buffer (`StudioCanvasListViewContext`), so an edit
 * shows there before it is published.
 *
 * ## Which view
 *
 * The one the canvas opens, read off the nav entry the way the runtime reads
 * it (`navEntryListTarget`):
 *
 *  - an entry that lands on a named view (`viewName`) → that view, matched
 *    against the object's merged `listViews` as `ObjectView` matches it
 *    (`resolveViewId`). A name that matches none is the view the entry opens
 *    once it exists, `<object>.<viewName>`;
 *  - any other entry → the object's default list view: the merged view
 *    flagged `isDefault`, else `<object>.default`, the identity the
 *    platform's own composer gives a container's default `list`
 *    (`expandViewContainer`).
 *
 * ## What is written, and where
 *
 * The `view` metadata item in its record shape — `{ name, object, viewKind:
 * 'list', config }` — the shape the runtime serves an object's list views in
 * (a package's `defineView` container arrives expanded into these), and the
 * shape the console's own create-view door writes (`viewEnvelope`). It goes
 * through the metadata draft door (`client.save(…, { mode: 'draft',
 * packageId })`) under its own version guard (objectui#11773), debounced by the
 * pillar's autosave like every other Studio editor. A view that does not exist
 * yet is created by the first edit, seeded with the columns the running app
 * shows an object that has no view (`defaultListColumnsFromObject`).
 *
 * ⛔ No new endpoint and no new client: the pillar's `MetadataClient` is the
 * only door. ⛔ Nothing here edits the object definition — fields belong to the
 * Data pillar. A read-only package shows the view and writes nothing: every
 * control is disabled and the pillar's autosave is blocked on the same flag.
 */

import * as React from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import {
  Badge,
  Button,
  cn,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SortBuilder,
  type SortItem,
} from '@object-ui/components';
import { useMetadata } from '@object-ui/react';
import { useAuth } from '@object-ui/auth';
import { resolveViewId } from '@object-ui/core';
import { extractDraftBody, readDraftChanges, type DraftChange, type MetadataClient } from '@object-ui/data-objectstack';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { NavigationModeSchema, resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { InspectorReorderButtons, InspectorShell } from '../metadata-admin/inspectors/_shared.js';
import { FieldsListEditor } from '../metadata-admin/previews/FieldsListEditor.js';
import { useObjectFields } from '../metadata-admin/previews/useObjectFields.js';
import { foldStoredListOptions } from '../metadata-admin/previews/ViewPreview.js';
import { colFieldName } from '../metadata-admin/previews/view-column-io.js';
import { WIDGETS, type ObjectFieldOption } from '../metadata-admin/widgets.js';
import { failed, loaded, type LoadState } from '../metadata-admin/loadState.js';
import { readDraftForSave, useDraftSaveGuard } from '../metadata-admin/DraftConflictDialog.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { defaultListColumnsFromObject } from '../ObjectView.js';
import { findByName, useNavTargetLabel } from '../../hooks/useNavTargetLabel.js';
import {
  listViewsOf,
  navEntryListTarget,
  type StudioCanvasListView,
  type StudioCanvasNavEntry,
} from './studio-canvas-preview.js';
import type { Surface } from './navSurface.js';
import { issueRefusal, plainRefusal } from './metadataError.js';
import { isStudioHiddenSystemField } from './studioHiddenSystemField.js';
import {
  addedArrayElements,
  copilotDraftMarkOf,
  DraftChip,
  DraftSourceLine,
  type CopilotDraftMark,
} from './StudioDraftMark.js';

type Row = Record<string, unknown>;

function isPlainObject(v: unknown): v is Row {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The list view an `object` leaf's panel edits. */
export interface ListViewTarget {
  objectName: string;
  /** The view item's name, `<object>.<key>`: the name its draft is saved under. */
  viewId: string;
  /** A view created at this name is the object's default list view. */
  isDefault: boolean;
}

/** `<object>.<key>` for a key the view item name has to carry qualified (the spec requires the dot). */
function qualifiedViewId(objectName: string, key: string): string {
  return key.includes('.') ? key : `${objectName}.${key}`;
}

/**
 * Which view an `object` leaf's panel edits — see the module docblock.
 *
 * `landingViewName` is the view the entry lands on as the runtime reads the
 * entry (`navEntryListTarget(...).viewName`), not the raw `viewName`: an entry
 * that also slices (`filters`) lands on the data surface, and its view is then
 * the default one. `views` is the object's merged `listViews` map.
 */
export function listViewTargetOf(
  objectName: string,
  landingViewName: string | undefined,
  views: Record<string, unknown>,
): ListViewTarget {
  const ids = Object.keys(views);
  if (landingViewName) {
    const id = resolveViewId(landingViewName, ids, objectName) ?? landingViewName;
    return { objectName, viewId: qualifiedViewId(objectName, id), isDefault: false };
  }
  const flagged = ids.find((id) => isPlainObject(views[id]) && (views[id] as Row).isDefault === true);
  return { objectName, viewId: qualifiedViewId(objectName, flagged ?? 'default'), isDefault: true };
}

/**
 * A view item that does not exist yet: the record shape, bound to its object,
 * listing `columns`. Flagged default only where it is the object's default
 * list view. No `label`: the spec makes it optional, and a label invented here
 * would be one more string written in one locale.
 */
export function newListViewItem(target: ListViewTarget, columns: string[]): Row {
  return {
    name: target.viewId,
    object: target.objectName,
    viewKind: 'list',
    ...(target.isDefault ? { isDefault: true } : {}),
    config: {
      type: 'grid',
      data: { provider: 'object', object: target.objectName },
      columns,
    },
  };
}

/**
 * Where a view item keeps its list body, by the spec's own discriminant: a
 * record holds it under `config`; a flattened overlay row is the body itself.
 */
function listBodyOf(row: Row): Row {
  return isPlainObject(row.config) ? row.config : row;
}

/**
 * Whether a stored view item is a LIST view this panel can edit: the spec's
 * family discriminant says so (`viewKind: 'list'`), or, on a row that carries
 * none, its body lists `columns` (a list view's one required member). A form
 * view (`viewKind: 'form'`) or a body that is neither is not edited here, so
 * a save can never overwrite it.
 */
export function isListViewRow(row: Row): boolean {
  if (row.viewKind === 'list') return true;
  if (row.viewKind !== undefined) return false;
  return Array.isArray(listBodyOf(row).columns);
}

function withListBody(row: Row, body: Row): Row {
  return isPlainObject(row.config) ? { ...row, config: body } : { ...row, ...body };
}

/**
 * The view as one entry of `object-view`'s `listViews`: its list body, with a
 * stored `options.KIND` bag folded as the Studio's view preview folds it
 * (`foldStoredListOptions`), and the item's label.
 */
export function namedListViewOf(row: Row): Row {
  const body = listBodyOf(row);
  const label = row.label ?? body.label;
  return { ...foldStoredListOptions(body), ...(label !== undefined ? { label } : {}) };
}

/**
 * The panel buffer's identity, as the pillar's autosave (`target`,
 * `loadedFor`) and this hook's own load and save compare it: one spelling for
 * all of them. ⛔ Never `view:` + the name: that is the adapter's view CACHE
 * key, which only `invalidateViewKeys` spells (objectui#4373), and this is
 * not a cache key.
 */
function listViewBufferKey(viewId: string): string {
  return `listView:${viewId}`;
}

/** What `useDraftAutoSave` hands a save: whether the buffer is still what it sent. */
interface DraftSendClaim {
  unmoved: () => boolean;
}

/**
 * The package's draft-only objects (a pending draft, no published row), as
 * the pillar last read them, stamped with the `publishNonce` the read ran
 * under (objectui#12508). A view of such an object has no published layer.
 */
export interface DraftOnlyObjects {
  publishNonce: number;
  names: ReadonlySet<string>;
}

export interface ObjectListViewDraft {
  /** The view the open leaf's panel edits; `null` on a leaf that is not an `object`. */
  target: ListViewTarget | null;
  /** The autosave's `target`: the buffer key of the view ({@link listViewBufferKey}), `''` with no target. */
  targetKey: string;
  /** The autosave's `loadedFor`: the target the buffer was loaded for. */
  loadedFor: string;
  /** The view item as the server holds it (draft, else published), with edits; `null` when it does not exist yet. */
  row: Row | null;
  /** The item at the view's name is not a list view (`isListViewRow`): shown as such, never edited. */
  notList: boolean;
  /** The columns a view created here starts with. */
  seedColumns: string[];
  dirty: boolean;
  /** A draft of the view is pending in the package. */
  hasDraft: boolean;
  /**
   * objectui#12725 — the draft read's per-key provenance (`draftChanges`), for
   * the copilot's marks; `null` with no draft, or when the read recorded none.
   */
  draftChanges: DraftChange[] | null;
  /**
   * objectui#12725 — the view as PUBLISHED, read beside a draft only when a
   * copilot mark needs it: which elements of an array setting the copilot
   * added is read by comparing the draft's array with this one's. `null` when
   * nothing is published; `undefined` when it is unknown (not read, or that
   * read failed), and then no element is marked.
   */
  published: Row | null | undefined;
  saving: boolean;
  /**
   * The last load's or save's failure, as thrown. Read at render, in the
   * designer locale, the way the pillar reads its own (objectui#11785): a
   * refused save as an author sentence over its raw text, a load as the text.
   */
  failure: { during: 'load' | 'save'; error: unknown } | null;
  /** Replace the view item with an edited one. */
  edit: (row: Row) => void;
  /** Send the buffer to the package draft — the autosave's `save`. */
  save: (sent: DraftSendClaim) => Promise<void>;
  /** The version-conflict dialog of this buffer's guard; render it once. */
  conflictDialog: React.ReactElement;
  /** What the canvas shows (`StudioCanvasListViewContext`); `null` with nothing to show. */
  canvas: StudioCanvasListView | null;
}

/**
 * The open leaf's list-view buffer, held by the Interfaces pillar so the
 * canvas and the panel read one copy (the folded layout unmounts the panel
 * between tabs; the buffer outlives it). The pillar runs the autosave over it
 * (`useDraftAutoSave`), as it does for its other two buffers.
 */
export function useObjectListViewDraft({
  client,
  packageId,
  leaf,
  publishNonce,
  draftOnlyObjects,
  onDraftSaved,
}: {
  client: MetadataClient;
  packageId: string;
  leaf: Surface | null;
  /** Bumped by a publish: the draft is gone, and the view is re-read. */
  publishNonce: number;
  /**
   * The package's draft-only objects (objectui#12508). Read when a load
   * decides, never a reason to reload: a newer answer does not re-read.
   */
  draftOnlyObjects?: DraftOnlyObjects | null;
  onDraftSaved?: () => void;
}): ObjectListViewDraft {
  const metadata = useMetadata();
  const { user, activeOrganization } = useAuth();
  const currentUserId = user?.id ?? null;
  const currentOrgId = activeOrganization?.id ?? null;
  const objectName = leaf?.type === 'object' && leaf.name ? leaf.name : null;
  // Keyed on the values, never on a memoised object's identity (AGENTS.md #10).
  const navId = leaf?.navId;
  const filtersKey = JSON.stringify(leaf?.filters ?? null);
  const entryViewName = leaf?.viewName;
  const landingViewName = React.useMemo(() => {
    if (!objectName) return undefined;
    const filters = (JSON.parse(filtersKey) as StudioCanvasNavEntry['filters'] | null) ?? undefined;
    return navEntryListTarget(objectName, { navId, filters, viewName: entryViewName }, { currentUserId, currentOrgId })
      .viewName;
  }, [objectName, navId, filtersKey, entryViewName, currentUserId, currentOrgId]);
  const objectDef = objectName ? findByName(metadata.objects, objectName) : undefined;
  const target = objectName ? listViewTargetOf(objectName, landingViewName, listViewsOf(objectDef)) : null;
  const viewId = target?.viewId ?? '';
  const targetKey = viewId ? listViewBufferKey(viewId) : '';
  const seedColumns = React.useMemo(() => defaultListColumnsFromObject(objectDef, 5), [objectDef]);

  const [buffer, setBuffer] = React.useState<{
    for: string;
    row: Row | null;
    dirty: boolean;
    hasDraft: boolean;
    draftChanges: DraftChange[] | null;
    published: Row | null | undefined;
  }>({
    for: '',
    row: null,
    dirty: false,
    hasDraft: false,
    draftChanges: null,
    published: undefined,
  });
  const [failure, setFailure] = React.useState<ObjectListViewDraft['failure']>(null);
  const [saving, setSaving] = React.useState(false);
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const reload = React.useCallback(() => setReloadNonce((n) => n + 1), []);
  // objectui#11773 — one guard per editing buffer; a conflict's "reload" re-runs this load.
  const { save: guardedSave, recordRead, dialog: conflictDialog } = useDraftSaveGuard(client, reload);
  // Declared before the load effect, so a commit updates it first.
  const draftOnlyRef = React.useRef(draftOnlyObjects);
  React.useEffect(() => {
    draftOnlyRef.current = draftOnlyObjects;
  }, [draftOnlyObjects]);

  React.useEffect(() => {
    setFailure(null);
    if (!viewId) {
      setBuffer({ for: '', row: null, dirty: false, hasDraft: false, draftChanges: null, published: undefined });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // objectui#11773 — read at the address the save below writes, so the
        // version it serves pins that save.
        const draftRead = await readDraftForSave<Row>(client, 'view', viewId, packageId);
        if (cancelled) return;
        const draftResp = draftRead.answer;
        // A served draft is the whole document, taken as-is (objectui#10765);
        // the published layer only without one. Both lose the read
        // decorations a save must not send back.
        const draft = extractDraftBody(draftResp) as Row | null;
        // objectui#11799 — so the published layer is read only for a view with
        // no pending draft. A view the panel created and nobody published has
        // a draft and no layer, and `GET …/layers` answers 404 for it.
        // objectui#12508 — nor for a view of a draft-only object: nothing of
        // that object is published, so its view has no layer either. Only an
        // answer read under this same publish counts: one read before it may
        // name an object the publish has just made live.
        const known = draftOnlyRef.current;
        const objectDraftOnly =
          !!objectName && !!known && known.publishNonce === publishNonce && known.names.has(objectName);
        // objectui#12725 — the per-key provenance the same read served. With a
        // copilot entry, the published layer is read beside the draft too (the
        // one added read): an array setting's added elements are the draft's
        // elements the published array does not hold. Not when the draft holds
        // a whole-body entry (`[]`): that write created the draft over no
        // published body, so there is nothing to compare against.
        const draftChanges = draft ? readDraftChanges(draftResp) : null;
        const marksNeedPublished =
          !!draftChanges &&
          draftChanges.some((c) => c.by === 'copilot') &&
          !draftChanges.some((c) => c.path.length === 0);
        // A failure of that added read costs the element marks only, never the
        // editor: the draft is the buffer either way.
        const lay = objectDraftOnly
          ? null
          : !draft
            ? await client.layered<Row>('view', viewId)
            : marksNeedPublished
              ? await client.layered<Row>('view', viewId).catch(() => undefined)
              : null;
        if (cancelled) return;
        const published = (lay as { effective?: unknown; code?: unknown } | null)?.effective ?? (lay as { code?: unknown } | null)?.code;
        const publishedRow = isPlainObject(published) ? (stripReadDecorations(published) as Row) : null;
        const row = draft ?? publishedRow;
        // What the marks compare against: `null` where nothing is published (a
        // draft-only object, or a draft created over no body), `undefined`
        // where it is unknown (not read, or the added read failed).
        const publishedForMarks: Row | null | undefined = !draft
          ? undefined
          : objectDraftOnly || draftChanges?.some((c) => c.path.length === 0)
            ? null
            : marksNeedPublished && lay !== undefined
              ? publishedRow
              : undefined;
        // objectui#11773 — the next save is pinned to what the draft read served.
        recordRead('view', viewId, packageId, draftRead.pin);
        setBuffer({
          for: listViewBufferKey(viewId),
          row,
          dirty: false,
          hasDraft: !!draft,
          draftChanges,
          published: publishedForMarks,
        });
      } catch (e) {
        if (!cancelled) setFailure({ during: 'load', error: e });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, viewId, objectName, packageId, publishNonce, reloadNonce, recordRead]);

  const edit = React.useCallback((row: Row) => {
    setBuffer((b) => ({ ...b, row, dirty: true }));
  }, []);

  const row = buffer.row;
  const notList = !!row && !isListViewRow(row);
  const save = React.useCallback(
    async (sent: DraftSendClaim) => {
      if (!viewId || !row || notList) return;
      setSaving(true);
      try {
        const outcome = await guardedSave('view', viewId, row, { mode: 'draft', packageId, surface: 'studio' });
        // objectui#11773 — the author chose the saved version; the load replaces the buffer.
        if (outcome === 'reloaded') return;
        // objectui#11204 — clean only if nothing was edited while it was in flight.
        const clean = sent.unmoved();
        setBuffer((b) => (b.for === listViewBufferKey(viewId) ? { ...b, hasDraft: true, dirty: clean ? false : b.dirty } : b));
        setFailure(null);
        onDraftSaved?.();
      } catch (e) {
        setFailure({ during: 'save', error: e });
      } finally {
        setSaving(false);
      }
    },
    [guardedSave, viewId, row, notList, packageId, onDraftSaved],
  );

  const current = buffer.for === targetKey && targetKey !== '';
  const objectOf = target?.objectName;
  const isDefaultTarget = !!target?.isDefault;
  // What the canvas shows: the view, edits included. A default list view that
  // does not exist yet shows the columns the running app shows such an object
  // (its "all records" list, `defaultListColumnsFromObject`), which is also
  // what the first edit starts from. A named view that does not exist shows
  // nothing new: the canvas keeps its own fallback.
  const canvas = React.useMemo<StudioCanvasListView | null>(() => {
    if (!current || !objectOf || notList) return null;
    const shown =
      row ??
      (isDefaultTarget && seedColumns.length > 0
        ? newListViewItem({ objectName: objectOf, viewId, isDefault: true }, seedColumns)
        : null);
    return shown ? { objectName: objectOf, viewId, view: namedListViewOf(shown) } : null;
  }, [current, row, notList, objectOf, viewId, isDefaultTarget, seedColumns]);

  return {
    target,
    targetKey,
    loadedFor: buffer.for,
    row: current ? row : null,
    notList: current && notList,
    seedColumns,
    dirty: buffer.dirty,
    hasDraft: current && buffer.hasDraft,
    draftChanges: current ? buffer.draftChanges : null,
    published: current ? buffer.published : undefined,
    saving,
    failure,
    edit,
    save,
    conflictDialog,
    canvas,
  };
}

/** A `{ field, order }` sort entry, the only spelling the spec's list view declares. */
interface SortEntry {
  field: string;
  order: 'asc' | 'desc';
}

function sortEntriesOf(value: unknown): SortEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (s): s is SortEntry =>
      isPlainObject(s) && typeof s.field === 'string' && (s.order === 'asc' || s.order === 'desc'),
  );
}

/**
 * The field names a list body already references: its columns, its filter and
 * sort rules, and a kanban card's fields, title and group-by field
 * (objectui#13152). Read by the panel's field pickers so a reference the view
 * holds keeps drawing (see `ObjectListViewInspector`).
 */
function fieldNamesHeldBy(body: Row): string[] {
  const held = new Set<string>();
  const add = (name: unknown) => {
    if (typeof name === 'string' && name) held.add(name);
  };
  if (Array.isArray(body.columns)) for (const column of body.columns) add(colFieldName(column));
  if (Array.isArray(body.filter)) for (const rule of body.filter) if (isPlainObject(rule)) add(rule.field);
  for (const entry of sortEntriesOf(body.sort)) add(entry.field);
  if (isPlainObject(body.kanban)) {
    if (Array.isArray(body.kanban.columns)) body.kanban.columns.forEach(add);
    add(body.kanban.titleField);
    add(body.kanban.groupByField);
  }
  return [...held];
}

/** Column index out of `FieldsListEditor`'s selection id, `config.columns[N]`. */
function selectedColumnIndex(id: string | undefined): number | null {
  const m = /\.columns\[(\d+)\]$/.exec(id ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * A selection in the panel: a row of its column list, as `FieldsListEditor`
 * spells it, or a kanban view's card (`kind: 'card'`, objectui#12725).
 */
export interface ListViewColumnSelection {
  kind: string;
  id: string;
  label?: string;
}

/**
 * objectui#12725 — the selection of the view's column at `index`, spelled as
 * the panel's column list spells its own (`FieldsListEditor`, under the
 * `config` key), so a column selected on the canvas is that list's row.
 */
export function listViewColumnSelection(index: number, label: string): ListViewColumnSelection {
  return { kind: 'column', id: `config.columns[${index}]`, label };
}

/** The column index a selection names, or `null` when it names no column. */
export function listViewColumnIndexOf(selection: ListViewColumnSelection | null | undefined): number | null {
  return selection?.kind === 'column' ? selectedColumnIndex(selection.id) : null;
}

/**
 * objectui#12725 — the field each column the panel lists shows, in the
 * view's order: the rows a canvas header can select. Empty while the view is
 * loading, and for an item that is not a list view (nothing is edited there).
 * A view not created yet lists the columns its first edit starts from, as the
 * panel does.
 */
export function listViewColumnFields(listView: ObjectListViewDraft): string[] {
  const { target, row, notList, seedColumns, loadedFor, targetKey } = listView;
  if (!target || notList || loadedFor !== targetKey) return [];
  const columns = listBodyOf(row ?? newListViewItem(target, seedColumns)).columns;
  return Array.isArray(columns) ? columns.map((c) => colFieldName(c) ?? '') : [];
}

/**
 * objectui#12725 — the selection of a kanban view's card, made by a click on
 * a card of the board: `id` is the clicked card's record id, the one the
 * canvas outlines. Its properties are the board's card, not that record's.
 */
export function listViewCardSelection(id: string, label: string): ListViewColumnSelection {
  return { kind: 'card', id, label };
}

/** The record id of the card a selection names, or `null` when it names no card. */
export function listViewCardIdOf(selection: ListViewColumnSelection | null | undefined): string | null {
  return selection?.kind === 'card' ? selection.id : null;
}

/**
 * objectui#12725 — whether the view the panel edits renders as a kanban board
 * (its list body's `type`), the one view whose cards a canvas click selects.
 * `false` while the view is loading, and for an item that is not a list view.
 */
export function listViewIsKanban(listView: ObjectListViewDraft): boolean {
  const { target, row, notList, seedColumns, loadedFor, targetKey } = listView;
  if (!target || notList || loadedFor !== targetKey) return false;
  return listBodyOf(row ?? newListViewItem(target, seedColumns)).type === 'kanban';
}

const noop = (): void => {};

/**
 * objectui#13151 — what the panel calls the view, in its header and in its
 * not-created and not-list sentences: the item's own `label`, as authored;
 * without one, the object's display name (`objectText`) and the view's role —
 * "Default view" for the object's default list view, else the key the nav
 * entry names it by. Never the item's qualified name (`<object>.<key>`): the
 * panel shows that beneath, as the machine name, the way the Studio's rows do.
 */
function listViewTitle(target: ListViewTarget, item: Row, objectText: string, locale: string): string {
  const own = resolveI18nLabel(item.label as I18nLabel | undefined, locale);
  if (own) return own;
  if (target.isDefault) return tFormat('engine.studio.inspector.listView.defaultTitle', locale, { object: objectText });
  const prefix = `${target.objectName}.`;
  const key = target.viewId.startsWith(prefix) ? target.viewId.slice(prefix.length) : target.viewId;
  return tFormat('engine.studio.inspector.listView.namedTitle', locale, { object: objectText, view: key });
}

/** objectui#12725 — the copilot's marks on the kanban card section's settings. */
interface KanbanCardMarks {
  fields: CopilotDraftMark | null;
  /** The card fields (`kanban.columns`) the copilot added, by name. */
  addedFields: string[];
  title: CopilotDraftMark | null;
  open: CopilotDraftMark | null;
  groupBy: CopilotDraftMark | null;
}

const SORT_ID = 'studio-list-view-sort';
const FILTER_ID = 'studio-list-view-filter';
const KANBAN_GROUP_ID = 'studio-list-view-kanban-group';
const KANBAN_TITLE_ID = 'studio-list-view-kanban-title';
const KANBAN_OPEN_ID = 'studio-list-view-kanban-open';
const KANBAN_FIELDS_LABEL_ID = 'studio-list-view-kanban-fields';
/** The Select value for "no key written": a Select item cannot carry `''`. */
const UNSET = '__unset__';

/** The copy of each `navigation.mode` the spec declares (`NavigationModeSchema`). */
const NAVIGATION_MODE_LABEL_KEYS: Record<string, string> = {
  page: 'engine.studio.inspector.listView.kanbanCard.mode.page',
  drawer: 'engine.studio.inspector.listView.kanbanCard.mode.drawer',
  modal: 'engine.studio.inspector.listView.kanbanCard.mode.modal',
  split: 'engine.studio.inspector.listView.kanbanCard.mode.split',
  popover: 'engine.studio.inspector.listView.kanbanCard.mode.popover',
  new_window: 'engine.studio.inspector.listView.kanbanCard.mode.newWindow',
  none: 'engine.studio.inspector.listView.kanbanCard.mode.none',
};

/**
 * objectui#12725 — the 看板卡片 section of a kanban view: what each card on
 * the board shows and what a click on one opens, as the StudioRailProps
 * artboard draws it. Each control writes one key the spec declares, and only
 * that key:
 *
 *  - card fields → `kanban.columns` (`KanbanConfigSchema.columns`, "Fields to
 *    show on cards"), ordered;
 *  - title → `kanban.titleField`, optional: empty removes the key, and the
 *    card shows the record's display name, as the spec describes;
 *  - click to open → `navigation.mode` (`NavigationModeSchema`); the default
 *    removes the key;
 *  - group by → `kanban.groupByField`, required by the spec. Every field of
 *    the object is offered: the spec's check refuses only a padded name, and
 *    a field's name is never padded.
 *
 * `KanbanConfigSchema` is strict and requires `groupByField` and `columns`,
 * so the block is born by picking the group-by field (with `columns: []`, on
 * which the board shows the view's own first columns), and the title and the
 * card fields wait for it. ⛔ No colour control: no reader in `plugin-kanban`
 * draws a list view's `rowColor` on a card.
 */
function KanbanCardSection({
  body,
  writeBody,
  fields,
  fieldCatalog,
  readOnly,
  locale,
  selected,
  marks,
}: {
  body: Row;
  writeBody: (next: Row) => void;
  fields: ReadonlyArray<{ name: string; label?: string }>;
  fieldCatalog: LoadState<ObjectFieldOption[]>;
  readOnly: boolean;
  locale: string;
  selected: boolean;
  /** objectui#12725 — the copilot's marks on this section's settings. */
  marks: KanbanCardMarks;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  const kanban = isPlainObject(body.kanban) ? body.kanban : null;
  const navigation = isPlainObject(body.navigation) ? body.navigation : null;
  const groupBy = typeof kanban?.groupByField === 'string' ? kanban.groupByField : '';
  const titleField = typeof kanban?.titleField === 'string' ? kanban.titleField : '';
  const mode = typeof navigation?.mode === 'string' ? navigation.mode : '';
  const writeKanban = (next: Row) => writeBody({ ...body, kanban: next });
  const fieldItems = (current: string) => (
    <>
      {current && !fields.some((f) => f.name === current) && (
        <SelectItem value={current}>
          <span className="font-mono">{current}</span>
        </SelectItem>
      )}
      {fields.map((f) => (
        <SelectItem key={f.name} value={f.name}>
          <span className="flex items-center gap-2">
            <span>{f.label || f.name}</span>
            <code className="text-xs text-muted-foreground">{f.name}</code>
          </span>
        </SelectItem>
      ))}
    </>
  );
  const FieldsWidget = WIDGETS['field-multi'];
  return (
    <div
      ref={ref}
      data-testid="list-view-kanban-card"
      data-selected={selected ? 'true' : undefined}
      className={cn('space-y-3 rounded-md border p-2', selected && 'border-primary ring-1 ring-primary')}
    >
      <div>
        <p className="text-xs font-medium">{t('engine.studio.inspector.listView.kanbanCard', locale)}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {t('engine.studio.inspector.listView.kanbanCard.intro', locale)}
        </p>
      </div>
      {!kanban && (
        <p className="rounded-md border border-dashed px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="list-view-kanban-group-first">
          {t('engine.studio.inspector.listView.kanbanCard.groupByFirst', locale)}
        </p>
      )}
      <div className="space-y-1.5" data-testid="list-view-kanban-fields">
        <p id={KANBAN_FIELDS_LABEL_ID} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('engine.studio.inspector.listView.kanbanCard.fields', locale)}
          {marks.fields && <DraftChip locale={locale} of="kanban.columns" />}
        </p>
        <FieldsWidget
          ariaLabelledBy={KANBAN_FIELDS_LABEL_ID}
          schema={{}}
          value={Array.isArray(kanban?.columns) ? kanban.columns : []}
          readOnly={readOnly || !kanban}
          context={{ conditionScope: 'none', objectFields: fieldCatalog }}
          onChange={(next) => {
            if (kanban && Array.isArray(next)) writeKanban({ ...kanban, columns: next.map(String) });
          }}
          copilotAdded={marks.addedFields.length > 0 ? new Set(marks.addedFields) : undefined}
        />
      </div>
      <div className="space-y-1.5" data-testid="list-view-kanban-title">
        <Label htmlFor={KANBAN_TITLE_ID} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('engine.studio.inspector.listView.kanbanCard.title', locale)}
          {marks.title && <DraftChip locale={locale} of="kanban.titleField" />}
        </Label>
        <Select
          value={titleField || UNSET}
          disabled={readOnly || !kanban}
          onValueChange={(v) => {
            if (!kanban) return;
            const { titleField: _dropped, ...rest } = kanban;
            writeKanban(v === UNSET ? rest : { ...rest, titleField: v });
          }}
        >
          <SelectTrigger id={KANBAN_TITLE_ID} className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>
              <span className="text-muted-foreground">{t('engine.studio.inspector.listView.kanbanCard.titleRecordName', locale)}</span>
            </SelectItem>
            {fieldItems(titleField)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5" data-testid="list-view-kanban-open">
        <Label htmlFor={KANBAN_OPEN_ID} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('engine.studio.inspector.listView.kanbanCard.open', locale)}
          {marks.open && <DraftChip locale={locale} of="navigation.mode" />}
        </Label>
        <Select
          value={mode || UNSET}
          disabled={readOnly}
          onValueChange={(v) => {
            const { mode: _dropped, ...rest } = navigation ?? {};
            const next = v === UNSET ? rest : { ...rest, mode: v };
            const { navigation: _old, ...others } = body;
            writeBody(Object.keys(next).length > 0 ? { ...others, navigation: next } : others);
          }}
        >
          <SelectTrigger id={KANBAN_OPEN_ID} className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>
              <span className="text-muted-foreground">{t('engine.studio.inspector.listView.kanbanCard.openDefault', locale)}</span>
            </SelectItem>
            {mode && !NavigationModeSchema.options.includes(mode as never) && (
              <SelectItem value={mode}>
                <span className="font-mono">{mode}</span>
              </SelectItem>
            )}
            {NavigationModeSchema.options.map((m) => (
              <SelectItem key={m} value={m}>
                {t(NAVIGATION_MODE_LABEL_KEYS[m] ?? m, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 border-t pt-3" data-testid="list-view-kanban-group">
        <Label htmlFor={KANBAN_GROUP_ID} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('engine.studio.inspector.listView.kanbanCard.groupBy', locale)}
          {marks.groupBy && <DraftChip locale={locale} of="kanban.groupByField" />}
        </Label>
        <Select
          value={groupBy || undefined}
          disabled={readOnly}
          onValueChange={(v) => writeKanban({ ...(kanban ?? { columns: [] }), groupByField: v })}
        >
          <SelectTrigger id={KANBAN_GROUP_ID} className="h-8 text-xs">
            <SelectValue placeholder={t('engine.studio.inspector.listView.kanbanCard.pickField', locale)} />
          </SelectTrigger>
          <SelectContent>{fieldItems(groupBy)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * The panel itself: Columns (add, remove, reorder — the Studio's own column
 * manager, `FieldsListEditor`), Filter (the runtime `FilterBuilder`, through
 * the designer's `filter-builder` widget, which writes the spec's
 * `ViewFilterRule[]`) and Sort (the runtime `SortBuilder`, in a popover the
 * width the builder needs, written as the spec's `{ field, order }[]`). On a
 * kanban view, the kanban card section comes first (`KanbanCardSection`).
 */
export function ObjectListViewInspector({
  listView,
  readOnly,
  locale,
  selection,
  onSelectionChange,
}: {
  listView: ObjectListViewDraft;
  readOnly: boolean;
  locale: string;
  /**
   * objectui#12725 — the column selection, held by the host so a click on a
   * canvas header can make it. With `onSelectionChange` the panel's list
   * reads and writes this one; without, the panel keeps its own.
   */
  selection?: ListViewColumnSelection | null;
  onSelectionChange?: (selection: ListViewColumnSelection | null) => void;
}): React.ReactElement | null {
  const { target, row, notList, seedColumns, failure, saving, hasDraft, edit, loadedFor, targetKey, draftChanges, published } =
    listView;
  const objectName = target?.objectName;
  const fieldState = useObjectFields(objectName);
  // objectui#13152 — the fields every picker in this panel offers (the
  // columns' "Add field", the filter, the sort and the kanban card): the
  // object's fields minus the columns the platform injects and hides, judged
  // by the one predicate the Data rail uses (`isStudioHiddenSystemField`,
  // objectui#11780) — the `__search` companion, `owning_business_unit_id`,
  // `organization_id`. An author's own hidden field stays offered, as it does
  // on the Data rail. A field this view already names stays too: the filter
  // and sort builders draw a held field that is not among their options as a
  // blank trigger (the case objectui#11810 kept in the list filter).
  const heldKey = row ? fieldNamesHeldBy(listBodyOf(row)).join('\n') : '';
  const fields = React.useMemo(() => {
    const held = new Set(heldKey.split('\n'));
    return fieldState.fields.filter(
      (f) => held.has(f.name) || !isStudioHiddenSystemField({ system: f.system, hidden: f.hidden }),
    );
  }, [fieldState.fields, heldKey]);
  const [ownSelected, setOwnSelected] = React.useState<{ key: string; index: number | null }>({ key: '', index: null });
  // objectui#13151 — the object's display name, as the nav rail names a
  // label-less entry that opens it: the published label, else its pending
  // draft's, through the app's bundle. No read of its own.
  const navTargetLabel = useNavTargetLabel();
  if (!target) return null;
  const hostHeld = !!onSelectionChange;
  const selectColumn = (sel: ListViewColumnSelection | null) => {
    if (onSelectionChange) onSelectionChange(sel);
    else setOwnSelected({ key: target.viewId, index: listViewColumnIndexOf(sel) });
  };
  const isLoaded = loadedFor === targetKey;
  const refusal = !failure
    ? null
    : failure.during === 'save'
      ? issueRefusal(failure.error, locale)
      : plainRefusal(failure.error);
  const working = row ?? newListViewItem(target, seedColumns);
  const title = listViewTitle(
    target,
    working,
    navTargetLabel({ kind: 'object', objectName: target.objectName }) ?? target.objectName,
    locale,
  );
  const body = listBodyOf(working);
  const columns = Array.isArray(body.columns) ? (body.columns as unknown[]) : [];
  const allStrings = columns.length > 0 && columns.every((c) => typeof c === 'string');
  const selectedIndex = hostHeld
    ? listViewColumnIndexOf(selection)
    : ownSelected.key === target.viewId
      ? ownSelected.index
      : null;
  const writeBody = (next: Row) => edit(withListBody(working, next));
  const fieldCatalog: LoadState<ObjectFieldOption[]> = fieldState.error
    ? failed(fieldState.error)
    : fieldState.loading
      ? { status: 'loading' }
      : loaded(fields.map((f) => ({ name: f.name, label: f.label, type: f.type })));
  const labelOf = (name: string) => fields.find((f) => f.name === name)?.label ?? name;
  const sort = sortEntriesOf(body.sort);
  const sortSummary = sort
    .map((s) =>
      tFormat(
        s.order === 'desc' ? 'engine.studio.inspector.listView.sortDesc' : 'engine.studio.inspector.listView.sortAsc',
        locale,
        { field: labelOf(s.field) },
      ),
    )
    .join(', ');
  const FilterWidget = WIDGETS['filter-builder'];

  // objectui#12725 — the copilot's draft marks. A key path is the item's own:
  // a record-shaped view keeps its list body under `config`.
  const bodyPath = isPlainObject(working.config) ? ['config'] : [];
  const markOf = (...path: string[]) => copilotDraftMarkOf(draftChanges, [...bodyPath, ...path]);
  // `undefined`: the published body is unknown, so no element is marked.
  const publishedBody = published ? listBodyOf(published) : published;
  const addedNames = (mark: CopilotDraftMark | null, draftArray: unknown, publishedArray: unknown): string[] =>
    mark && publishedBody !== undefined
      ? addedArrayElements(draftArray, publishedArray)
          .map((c) => colFieldName(c) ?? (typeof c === 'string' ? c : ''))
          .filter((n) => n !== '')
      : [];
  const kanbanBody = isPlainObject(body.kanban) ? body.kanban : null;
  const publishedKanban = publishedBody && isPlainObject(publishedBody.kanban) ? publishedBody.kanban : null;
  const kanbanFieldsMark = markOf('kanban', 'columns');
  const kanbanMarks: KanbanCardMarks = {
    fields: kanbanFieldsMark,
    addedFields: addedNames(kanbanFieldsMark, kanbanBody?.columns, publishedKanban?.columns),
    title: markOf('kanban', 'titleField'),
    open: markOf('navigation', 'mode'),
    groupBy: markOf('kanban', 'groupByField'),
  };
  const columnsMark = markOf('columns');
  const addedColumns = addedNames(columnsMark, columns, publishedBody?.columns);
  const filterMark = markOf('filter');
  const sortMark = markOf('sort');
  const drawnMarks = [
    ...(body.type === 'kanban' ? [kanbanMarks.fields, kanbanMarks.title, kanbanMarks.open, kanbanMarks.groupBy] : []),
    columnsMark,
    filterMark,
    sortMark,
  ].filter((m): m is CopilotDraftMark => m !== null);
  const latestMark = drawnMarks.reduce<CopilotDraftMark | null>(
    (latest, m) => (!latest || Date.parse(m.at) > Date.parse(latest.at) ? m : latest),
    null,
  );
  const addedLabels = [...new Set([...(body.type === 'kanban' ? kanbanMarks.addedFields : []), ...addedColumns])].map(labelOf);

  return (
    <InspectorShell
      kindLabel={t('engine.studio.inspector.listView.kind', locale)}
      title={title}
      // The panel is the leaf's own, not a selection's: nothing to close.
      hideClose
      onClose={noop}
      headerActions={
        saving ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="list-view-saving">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('engine.studio.autoSaving', locale)}
          </span>
        ) : hasDraft ? (
          <Badge variant="outline" className="text-[10px]">
            {t('engine.studio.unpublishedDraft', locale)}
          </Badge>
        ) : null
      }
    >
      <div data-testid="studio-list-view-inspector" className="space-y-3">
        {/* objectui#13151 — the machine name, secondary to the title, as a
            Studio row shows it (smaller, monospace, only where it differs). */}
        {target.viewId !== title && (
          <p className="truncate font-mono text-[10px] leading-tight text-muted-foreground" data-testid="list-view-name">
            {target.viewId}
          </p>
        )}
        {readOnly ? (
          <p className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="list-view-read-only">
            {t('engine.studio.inspector.listView.readOnly', locale)}
          </p>
        ) : (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t('engine.studio.inspector.listView.intro', locale)}
          </p>
        )}
        {refusal && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive" role="alert" data-testid="list-view-refusal">
            <p className="whitespace-pre-line">{refusal.message}</p>
            {refusal.detail && (
              <details className="mt-1">
                <summary className="cursor-pointer select-none opacity-80">{t('engine.studio.refusal.details', locale)}</summary>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono opacity-90">{refusal.detail}</pre>
              </details>
            )}
          </div>
        )}
        {!isLoaded ? (
          failure ? null : (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('engine.studio.loading', locale)}
            </p>
          )
        ) : notList ? (
          <p className="rounded-md border border-dashed px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="list-view-not-list">
            {tFormat('engine.studio.inspector.listView.notList', locale, { view: title })}
          </p>
        ) : (
          <>
            {!row && (
              <p className="rounded-md border border-dashed px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="list-view-not-created">
                {tFormat('engine.studio.inspector.listView.notCreated', locale, { view: title })}
              </p>
            )}
            {body.type === 'kanban' && (
              // objectui#12725 — a kanban view's card: a card click on the canvas selects it.
              <KanbanCardSection
                body={body}
                writeBody={writeBody}
                fields={fields}
                fieldCatalog={fieldCatalog}
                readOnly={readOnly}
                locale={locale}
                selected={hostHeld && listViewCardIdOf(selection) !== null}
                marks={kanbanMarks}
              />
            )}
            <div className="space-y-1.5" data-testid="list-view-columns">
              <FieldsListEditor
                variantKey="config"
                schema={body}
                columns={columns}
                allStrings={allStrings}
                objectName={objectName}
                objectFieldsOverride={fields}
                selectedIndex={selectedIndex}
                readOnly={readOnly}
                onPatch={(patch) => {
                  if (isPlainObject(patch.config)) writeBody(patch.config);
                }}
                onSelectionChange={selectColumn}
                copilotAdded={addedColumns.length > 0 ? new Set(addedColumns) : undefined}
              />
              {/* A copilot change to `columns` that added no column (a reorder,
                  a removal) has no row to mark: the setting carries the chip. */}
              {columnsMark && addedColumns.length === 0 && <DraftChip locale={locale} of="columns" />}
              {selectedIndex != null && selectedIndex < columns.length && (
                <div className="flex items-center justify-end">
                  <InspectorReorderButtons
                    index={selectedIndex}
                    total={columns.length}
                    disabled={readOnly}
                    onMove={(to) => {
                      const next = [...columns];
                      const [moved] = next.splice(selectedIndex, 1);
                      next.splice(to, 0, moved);
                      writeBody({ ...body, columns: next });
                      selectColumn(listViewColumnSelection(to, selection?.label ?? colFieldName(moved) ?? ''));
                    }}
                  />
                </div>
              )}
            </div>
            <div className="space-y-1.5 border-t pt-3" data-testid="list-view-filter">
              <Label htmlFor={FILTER_ID} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {t('engine.studio.inspector.listView.filter', locale)}
                {filterMark && <DraftChip locale={locale} of="filter" />}
              </Label>
              <FilterWidget
                id={FILTER_ID}
                schema={{}}
                value={body.filter}
                readOnly={readOnly}
                context={{ conditionScope: 'none', objectFields: fieldCatalog }}
                onChange={(rules) => {
                  const { filter: _dropped, ...rest } = body;
                  writeBody(Array.isArray(rules) && rules.length > 0 ? { ...rest, filter: rules } : rest);
                }}
              />
            </div>
            <div className="space-y-1.5 border-t pt-3" data-testid="list-view-sort">
              <Label htmlFor={SORT_ID} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {t('engine.studio.inspector.listView.sort', locale)}
                {sortMark && <DraftChip locale={locale} of="sort" />}
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id={SORT_ID}
                    variant="outline"
                    size="sm"
                    disabled={readOnly}
                    className="h-8 w-full justify-between text-xs font-normal"
                    data-testid="list-view-sort-trigger"
                  >
                    <span className="truncate text-left">
                      {sortSummary || (
                        <span className="text-muted-foreground">{t('engine.studio.inspector.listView.addSort', locale)}</span>
                      )}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[440px] max-w-[90vw] p-3">
                  <SortBuilder
                    fields={fields.map((f) => ({ value: f.name, label: f.label }))}
                    value={sort.map((s, i) => ({ id: `${i}`, ...s }))}
                    onChange={(items: SortItem[]) => {
                      // The builder's row `id` is a React key: the spec refuses it on
                      // a sort entry, so only `{ field, order }` is written.
                      const next = items
                        .filter((it) => !!it.field)
                        .map((it) => ({ field: it.field, order: it.order === 'desc' ? 'desc' : 'asc' }) as SortEntry);
                      const { sort: _dropped, ...rest } = body;
                      writeBody(next.length > 0 ? { ...rest, sort: next } : rest);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            {latestMark && (
              // objectui#12725 — the 来源 line: who drafted the marked settings, and when.
              <DraftSourceLine at={latestMark.at} locale={locale} items={addedLabels} className="border-t pt-3" />
            )}
          </>
        )}
      </div>
    </InspectorShell>
  );
}
