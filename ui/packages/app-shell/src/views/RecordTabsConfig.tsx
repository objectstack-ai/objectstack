// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record page's tabs, arranged in design mode (objectstack#36499,
 * objectstack#36737, epic objectstack#36359): an administrator arranges the
 * record page's tabs in place, for everyone.
 *
 * - The tabs are part of the design mode (objectstack#36737, the
 *   maintainer's ruling 「照 Twenty 归类」: a record page's layout is
 *   customized under the one layout bar, as Twenty's record page layouts
 *   are). While the mode is on, the tab row of the record page is the editor
 *   ({@link RecordTabsEditor}) in place. There is no entry of its own in the
 *   record's 「…」 and no bar of its own: the mode's bar is the one bar.
 * - The editor is drawn for a workspace administrator who may author
 *   metadata, on the desktop full page of an object whose package Studio
 *   lists: writable (an object of a self-built app, the gate of Studio's
 *   design entries, `useStudioDesignGate`), or read-only (an installed app's
 *   object, Studio's view posture, `useStudioEntryGate`) where the
 *   customization door does not wall this caller off
 *   (`useCustomizeDoorWalled`). Not on a phone, not in a drawer or pane, not
 *   on a page its author composed.
 * - The record stays on screen as the preview: the page is drawn from the
 *   object with the draft's `relatedLists` (`previewRecordTabsObject`), in
 *   the administrator's default order (their own arrangement is set aside
 *   while the mode is on).
 * - The draft is staged with the mode's other changes, under the object's key
 *   ({@link recordTabsChangeKey}), so it survives a move to another page of
 *   the app. The mode's 「Cancel」 drops it and writes nothing; the mode's
 *   「Save」 writes it with the rest (`saveRecordTabs`): the object's
 *   `relatedLists`, published, the order everyone sees by default. On an
 *   installed object it writes the `relatedLists` of the object extension of
 *   the base's paired `.custom` package instead (`recordTabsInstalled.ts`),
 *   where every tab can be moved, a related one hidden, and each is marked
 *   with where it comes from (the original package, another package, this
 *   environment). A reader's own arrangement is a diff laid over that default
 *   (`relatedArrangement.ts`), and 「Restore default order」 returns them to
 *   it.
 * - The field area is not changed here: 「Adjust field groups」 opens the
 *   object in Studio.
 *
 * A tab's name changes only in the app's source language, the design-mode
 * menu's rename precedent (objectstack#36363, ruling (4)): the name field is
 * open when the session language is the deployment's default and the tab's
 * shown name is its stored one (or it has none of its own yet).
 *
 * @module
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, EyeOff, GripVertical, Lock, Pencil } from 'lucide-react';
import { Button, Input, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { isRecordPageBuiltinTab, readRelatedListsArrangement, relatedListEntryName } from '@objectstack/spec/data';
import { useDesignMode, useDesignModeActive, useDesignModeChange } from '../layout/designMode.js';
import { useStudioDesignGate, useStudioEntryGate } from '../hooks/useStudioDesignGate.js';
import { useCustomizeDoorWalled } from './studio-design/StudioCustomizeControls.js';
import { relatedListEntryNames, type DerivedRelatedList } from '../utils/deriveRelatedLists.js';
import { studioItemPath } from './studio-design/studioAddress.js';
import { entryDetails } from './studio-design/relatedListVocabulary.js';
import {
  editRecordTabsDraft,
  initialRecordTabsDraft,
  previewRecordTabsObject,
  recordTabsCatalog,
  sameRecordTabsDraft,
  type RecordTabId,
  type RecordTabsCatalog,
  type RecordTabsDraft,
  type RecordTabsEdit,
} from './recordTabsConfigModel.js';
import { consoleRecordTabsDoors, saveRecordTabs, type RecordTabsSaveTexts } from './recordTabsConfigSave.js';
import {
  initialInstalledTabsDraft,
  previewInstalledTabsObject,
  recordTabSource,
  recordTabsPackageOf,
  type RecordTabSource,
} from './recordTabsInstalled.js';
import type { RecordTabsIo } from './recordTabsConfigIo.js';

type RecordTabsObjectDef = Record<string, unknown> & { name?: string };

/** The metadata client, the stored list and the default language: loaded with the editor (`recordTabsConfigIo.tsx`). */
const RecordTabsConfigIo = React.lazy(() => import('./recordTabsConfigIo.js'));

/** The design mode's key for the record-page tabs of `objectName`: one staged change per object. */
export function recordTabsChangeKey(objectName: string): string {
  return `record-tabs:${objectName}`;
}

/** The package an object is kept in, as served (`_packageId`), or `null`. */
export function objectPackageId(objectDef: RecordTabsObjectDef | null | undefined): string | null {
  return recordTabsPackageOf(objectDef);
}

/**
 * Where a save lands, as the editor knows it: `own`, the object's writable
 * package; `pair`, the paired `.custom` package of the installed base.
 */
export type RecordTabsMode = 'own' | 'pair';

/** Where 「Adjust field groups」 goes: the object in Studio's Data pillar. */
export function recordTabsStudioPath(objectDef: RecordTabsObjectDef | null | undefined): string | null {
  const packageId = objectPackageId(objectDef);
  const name = objectDef?.name;
  return packageId && typeof name === 'string' && name ? studioItemPath(packageId, 'object', name) : null;
}

/**
 * What the design mode holds for an object's tabs: the draft, the draft the
 * editor opened on, and what its write needs (the object's package and the
 * catalog the draft was made against), so the mode's 「Save」 writes it from
 * any page of the app.
 */
export interface RecordTabsChange {
  readonly objectName: string;
  readonly packageId: string;
  readonly mode: RecordTabsMode;
  readonly catalog: RecordTabsCatalog;
  readonly initial: RecordTabsDraft;
  readonly draft: RecordTabsDraft;
}

export interface RecordTabsConfigInput {
  readonly objectDef: RecordTabsObjectDef | null | undefined;
  readonly objects: readonly RecordTabsObjectDef[];
  /** The page may draw the editor at all: a desktop full page drawing the synthesized record page. */
  readonly enabled: boolean;
  readonly canRead?: (objectName: string) => boolean;
  /** A related list's name on the page when no entry names it (its FK's title, else the child's plural). */
  readonly titleOf: (list: DerivedRelatedList) => string;
}

export interface RecordTabsConfig {
  /** The design mode is on and this caller may arrange this object's tabs here. */
  readonly active: boolean;
  /** The object the page draws while the editor is on, else `undefined`. */
  readonly previewObject: RecordTabsObjectDef | undefined;
  /** The editor that takes the tab row's place, while the editor is on. */
  readonly editor: React.ReactNode;
}

/** The record page's tab configuration for the object on screen, under the design mode. */
export function useRecordTabsConfig({ objectDef, objects, enabled, canRead, titleOf }: RecordTabsConfigInput): RecordTabsConfig {
  const { t, language } = useObjectTranslation();
  const designing = useDesignModeActive();
  const saving = useDesignMode()?.saving ?? false;
  const objectName = typeof objectDef?.name === 'string' ? objectDef.name : '';
  const packageId = objectPackageId(objectDef);
  const studioPath = recordTabsStudioPath(objectDef);
  // The gates are read only while the mode is on: nothing is drawn outside it.
  const gated = enabled && designing;
  const own = useStudioDesignGate(gated ? studioPath : null) !== null;
  const entry = useStudioEntryGate(gated && !own ? studioPath : null);
  const walled = useCustomizeDoorWalled();
  const mode: RecordTabsMode | null = !gated || !packageId ? null : own ? 'own' : entry?.posture === 'view' && !walled ? 'pair' : null;
  const active = mode !== null && !!objectDef && !!objectName;

  const change = useDesignModeChange<RecordTabsChange>(recordTabsChangeKey(objectName));
  const staged = change.value && change.value.mode === mode ? change.value : undefined;

  const catalog = React.useMemo<RecordTabsCatalog | null>(
    () => (active && objectDef ? recordTabsCatalog(objectDef, objects, { canRead }) : null),
    [active, objectDef, objects, canRead],
  );
  const opened = React.useMemo<RecordTabsDraft | null>(() => {
    if (!active || !catalog || !objectDef) return null;
    return mode === 'pair'
      ? initialInstalledTabsDraft(objectDef, objects, catalog, { canRead })
      : initialRecordTabsDraft(objectDef, objects, catalog, { canRead });
  }, [active, catalog, objectDef, objects, canRead, mode]);
  /** What the editor shows: the staged draft, else the object as it is. */
  const unchanged = React.useMemo<RecordTabsChange | null>(
    () => (catalog && opened && packageId && mode ? { objectName, packageId, mode, catalog, initial: opened, draft: opened } : null),
    [catalog, opened, packageId, mode, objectName],
  );
  const session = staged ?? unchanged;

  // The metadata client, the stored list and the deployment's default
  // language (the rename gate), from the editor's lazily loaded part.
  const [io, setIo] = React.useState<RecordTabsIo | null>(null);
  React.useEffect(() => {
    if (!active) setIo(null);
  }, [active]);
  const client = io?.client ?? null;

  const texts = React.useMemo<RecordTabsSaveTexts>(
    () => ({
      notListed: t('designMode.recordTabs.notListed', {
        defaultValue: "This object's package is not listed, so its tabs cannot be saved.",
      }),
      pendingDraft: t('designMode.recordTabs.pendingDraft', {
        defaultValue: 'This object has unpublished changes in Studio. Publish or discard them there, then save again.',
      }),
      notWritable: t('designMode.recordTabs.notWritable', {
        defaultValue: "This object's package cannot be written, so its tabs cannot be saved here.",
      }),
      pairNotWritable: t('designMode.recordTabs.pairNotWritable', {
        defaultValue: "This app's customization package cannot be written, so its tabs cannot be saved.",
      }),
    }),
    [t],
  );

  // An edit stages the draft with the mode's other changes; an edit back to
  // where the editor opened takes it off, so 「Save」 has nothing of it to write.
  const { stage, unstage } = change;
  const edit = React.useCallback(
    (step: RecordTabsEdit) => {
      if (!session || !client) return;
      const draft = editRecordTabsDraft(session.draft, step);
      if (sameRecordTabsDraft(draft, session.initial)) {
        unstage();
        return;
      }
      const doors = consoleRecordTabsDoors(client);
      stage({ ...session, draft }, (value) =>
        saveRecordTabs(
          {
            objectName: value.objectName,
            packageId: value.packageId,
            draft: value.draft,
            catalog: value.catalog,
            initial: value.initial,
          },
          texts,
          doors,
        ),
      );
    },
    [session, client, stage, unstage, texts],
  );

  const previewObject = React.useMemo(
    () =>
      session && objectDef
        ? session.mode === 'pair'
          ? previewInstalledTabsObject(objectDef, session.draft, session.catalog)
          : previewRecordTabsObject(objectDef, session.draft, session.catalog)
        : undefined,
    [session, objectDef],
  );
  const pairId = (objectDef && readRelatedListsArrangement(objectDef)?.packageId) ?? null;
  const packageNames = io?.packageNames;
  const sourceOf = React.useCallback(
    (list: DerivedRelatedList): RecordTabSource | undefined => (objectDef ? recordTabSource(list, objectDef, objects) : undefined),
    [objectDef, objects],
  );
  const packageName = React.useCallback((id: string) => packageNames?.get(id) ?? id, [packageNames]);

  const storedLists = io?.stored?.objectName === objectName ? io.stored.lists : null;
  const sourceLanguage = io?.sourceLanguage ?? false;

  const editor = session ? (
    <>
      <RecordTabsEditor
        catalog={session.catalog}
        draft={session.draft}
        initial={session.initial}
        titleOf={titleOf}
        storedLists={storedLists}
        sourceLanguage={sourceLanguage}
        studioPath={studioPath}
        // Until what a save writes through has loaded, and while the mode saves.
        disabled={saving || !client}
        onEdit={edit}
        {...(session.mode === 'pair' ? { installed: { sourceOf, packageName } } : {})}
      />
      <React.Suspense fallback={null}>
        <RecordTabsConfigIo
          objectName={objectName}
          packageId={session.packageId}
          pairId={session.mode === 'pair' ? pairId : null}
          language={language}
          onIo={setIo}
        />
      </React.Suspense>
    </>
  ) : null;

  return { active: session !== null, previewObject, editor };
}

const CHIP = 'inline-flex h-8 max-w-full shrink-0 items-center gap-1 rounded-md border px-1.5 text-sm';

interface ChipProps {
  id: string;
  label: string;
  /** Why this tab keeps its place, when it does. */
  fixedReason?: string;
  rename?: { open: boolean; hint?: string; onRename: (label: string | undefined) => void };
  hide?: { label: string; onHide: () => void };
  /** Where the tab comes from, on an installed object (card item 7). */
  source?: { kind: RecordTabSource['kind']; text: string };
  disabled: boolean;
}

function TabChipBody({ label, fixedReason, rename, hide, source, disabled, handle }: ChipProps & { handle?: React.ReactNode }) {
  const { t } = useObjectTranslation();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(label);
  const commit = () => {
    setEditing(false);
    if (value.trim() !== label) rename?.onRename(value.trim() || undefined);
  };
  return (
    <>
      {handle ??
        (fixedReason ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={fixedReason} data-record-tabs-fixed="" />
        ) : null)}
      {editing ? (
        <Input
          autoFocus
          value={value}
          aria-label={t('designMode.recordTabs.name', { defaultValue: 'Tab name' })}
          className="h-6 w-36 px-1.5 text-sm"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setValue(label);
              setEditing(false);
            }
          }}
          data-record-tabs-rename-input=""
        />
      ) : (
        <span className="truncate px-0.5" title={fixedReason}>
          {label}
        </span>
      )}
      {source && !editing && (
        <span
          className="max-w-32 shrink-0 truncate rounded bg-muted px-1 text-[11px] leading-4 text-muted-foreground"
          title={source.text}
          data-record-tabs-source={source.kind}
        >
          {source.text}
        </span>
      )}
      {rename && !editing && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          disabled={disabled || !rename.open}
          title={rename.open ? undefined : rename.hint}
          aria-label={t('designMode.recordTabs.rename', { defaultValue: 'Rename {{name}}', name: label })}
          onClick={() => {
            setValue(label);
            setEditing(true);
          }}
          data-record-tabs-rename=""
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {hide && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          disabled={disabled}
          aria-label={hide.label}
          title={hide.label}
          onClick={hide.onHide}
          data-record-tabs-hide=""
        >
          <EyeOff className="h-3.5 w-3.5" />
        </Button>
      )}
    </>
  );
}

function SortableTabChip(props: ChipProps & { sortable: boolean }) {
  const { t } = useObjectTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
    disabled: !props.sortable || props.disabled,
  });
  const handle = props.sortable ? (
    <button
      type="button"
      className="inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      aria-label={t('designMode.recordTabs.drag', { defaultValue: 'Move {{name}}', name: props.label })}
      disabled={props.disabled}
      {...attributes}
      {...listeners}
      data-record-tabs-handle=""
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  ) : undefined;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(CHIP, 'bg-background', isDragging && 'z-10 shadow-md')}
      data-record-tabs-tab={props.id}
    >
      <TabChipBody {...props} handle={handle} />
    </li>
  );
}

/**
 * The tab row in design mode: the shown tabs in order, each with a drag
 * handle, a rename and a hide; then 附件 (hide only), 审批 and 动态 (fixed,
 * where the page draws them last); then the 「Hidden」 area, from which a tab
 * is shown again; and 「Adjust field groups」.
 *
 * On an installed object (`installed`), every tab is in the draft's order and
 * moves: another package's list and the built-in tabs too; a related tab
 * hides, a built-in one does not (the `.custom` list cannot hide it); each
 * related tab carries where it comes from.
 */
export function RecordTabsEditor({
  catalog,
  draft,
  initial,
  titleOf,
  storedLists,
  sourceLanguage,
  studioPath,
  disabled = false,
  onEdit,
  installed,
}: {
  catalog: RecordTabsCatalog;
  draft: RecordTabsDraft;
  initial: RecordTabsDraft;
  titleOf: (list: DerivedRelatedList) => string;
  /** The object's stored `relatedLists`; `null` while unread or when the read failed (no rename then). */
  storedLists: readonly unknown[] | null;
  /** The session language is the deployment's default. */
  sourceLanguage: boolean;
  studioPath: string | null;
  disabled?: boolean;
  onEdit: (edit: RecordTabsEdit) => void;
  /** The object is an installed one: every tab arranges, each related tab with its source. */
  installed?: {
    sourceOf: (list: DerivedRelatedList) => RecordTabSource | undefined;
    packageName: (packageId: string) => string;
  };
}) {
  const { t } = useObjectTranslation();
  const byId = React.useMemo(() => new Map(catalog.candidates.map((c) => [c.id, c] as const)), [catalog]);
  const defaultLabel = (id: RecordTabId): string => {
    const candidate = byId.get(id);
    return candidate ? titleOf(candidate.list) : id;
  };
  const labelOf = (id: RecordTabId): string =>
    isRecordPageBuiltinTab(id) ? builtinLabel(id) : (draft.labels[id] ?? defaultLabel(id));
  const contributed = t('designMode.recordTabs.contributed', {
    defaultValue: 'Another package adds this tab. It is placed there.',
  });
  const sourceOnly = t('designMode.recordTabs.renameSourceOnly', {
    defaultValue: "Tab names are changed in the app's source language",
  });
  const builtinFixed = t('designMode.recordTabs.builtinFixed', {
    defaultValue: 'The platform draws this tab last, under its own name.',
  });
  const builtinMoves = t('designMode.recordTabs.builtinMoves', {
    defaultValue: 'A built-in tab can be moved, not hidden or renamed.',
  });
  const builtinLabel = (name: string): string =>
    name === 'sys_attachment'
      ? t('detail.attachments', { defaultValue: 'Attachments' })
      : name === 'sys_approval_request'
        ? t('detail.approvalsPanelTitle', { defaultValue: 'Approvals' })
        : t('detail.timeline', { defaultValue: 'Activity' });
  const sourceTag = (list: DerivedRelatedList): ChipProps['source'] => {
    const source = installed?.sourceOf(list);
    if (!source) return undefined;
    if (source.kind === 'base') {
      return { kind: 'base', text: t('designMode.recordTabs.sourceBase', { defaultValue: 'Original package' }) };
    }
    if (source.kind === 'environment') {
      return { kind: 'environment', text: t('designMode.recordTabs.sourceEnvironment', { defaultValue: 'This environment' }) };
    }
    return {
      kind: 'package',
      text: t('designMode.recordTabs.sourcePackage', {
        defaultValue: 'From {{name}}',
        name: installed?.packageName(source.packageId) ?? source.packageId,
      }),
    };
  };
  /** Ruling (4): the name opens in the source language, where the shown name is the stored one. */
  const renameOpen = (id: RecordTabId): boolean => {
    if (!sourceLanguage || storedLists === null) return false;
    const candidate = byId.get(id);
    if (!candidate) return false;
    const entry = storedLists.find((e) => {
      const name = relatedListEntryName(e);
      return name !== undefined && !isRecordPageBuiltinTab(name) && relatedListEntryNames(name, candidate.list);
    });
    const storedLabel = entryDetails(entry).label;
    return storedLabel === undefined || storedLabel === initial.labels[id];
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const to = draft.order.indexOf(String(over.id));
    if (to >= 0) onEdit({ kind: 'move', id: String(active.id), to });
  };
  const hideLabel = (name: string) => t('designMode.recordTabs.hide', { defaultValue: 'Hide {{name}}', name });
  const showLabel = (name: string) => t('designMode.recordTabs.show', { defaultValue: 'Show {{name}}', name });
  const attachments = t('detail.attachments', { defaultValue: 'Attachments' });
  const hiddenNames: Array<{ id: string; label: string; restore: () => void }> = draft.hidden
    .filter((id) => byId.has(id))
    .map((id) => ({ id, label: labelOf(id), restore: () => onEdit({ kind: 'restore', id }) }));
  if (!installed && catalog.files && draft.attachmentsHidden) {
    hiddenNames.push({ id: 'sys_attachment', label: attachments, restore: () => onEdit({ kind: 'attachments', hidden: false }) });
  }
  // An installed object's attachments tab the base hides: naming it shows it.
  if (installed && catalog.files && draft.hidden.includes('sys_attachment')) {
    hiddenNames.push({ id: 'sys_attachment', label: attachments, restore: () => onEdit({ kind: 'restore', id: 'sys_attachment' }) });
  }

  return (
    <div
      role="region"
      aria-label={t('designMode.recordTabs.title', { defaultValue: 'Configure tabs' })}
      className="flex min-w-0 flex-col gap-2 border-b border-border pb-3"
      data-testid="record-tabs-editor"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={[...draft.order]} strategy={horizontalListSortingStrategy}>
          <ul className="flex min-w-0 flex-wrap items-center gap-2" aria-label={t('designMode.recordTabs.shown', { defaultValue: 'Tabs' })}>
            {draft.order.map((id) => {
              if (isRecordPageBuiltinTab(id)) {
                return (
                  <SortableTabChip
                    key={id}
                    id={id}
                    label={labelOf(id)}
                    sortable
                    disabled={disabled}
                    fixedReason={builtinMoves}
                  />
                );
              }
              const candidate = byId.get(id);
              const fixed = !installed && candidate?.fromPackage !== undefined;
              const label = labelOf(id);
              return (
                <SortableTabChip
                  key={id}
                  id={id}
                  label={label}
                  sortable={!fixed}
                  disabled={disabled}
                  fixedReason={fixed ? contributed : undefined}
                  rename={
                    fixed
                      ? undefined
                      : {
                          open: renameOpen(id),
                          hint: sourceOnly,
                          onRename: (next) => onEdit({ kind: 'rename', id, label: next === defaultLabel(id) ? undefined : next }),
                        }
                  }
                  hide={fixed ? undefined : { label: hideLabel(label), onHide: () => onEdit({ kind: 'hide', id }) }}
                  source={candidate && installed ? sourceTag(candidate.list) : undefined}
                />
              );
            })}
            {/* Another package's lists: placed by that package, after this object's own (objectstack#35901). */}
            {catalog.candidates
              .filter((candidate) => !installed && candidate.fromPackage !== undefined)
              .map((candidate) => (
                <li key={candidate.id} className={cn(CHIP, 'bg-muted/40 text-muted-foreground')} data-record-tabs-tab={candidate.id}>
                  <TabChipBody id={candidate.id} label={labelOf(candidate.id)} fixedReason={contributed} disabled={disabled} />
                </li>
              ))}
            {!installed && catalog.files && !draft.attachmentsHidden && (
              <li className={cn(CHIP, 'bg-background')} data-record-tabs-tab="sys_attachment">
                <TabChipBody
                  id="sys_attachment"
                  label={attachments}
                  fixedReason={builtinFixed}
                  disabled={disabled}
                  hide={{ label: hideLabel(attachments), onHide: () => onEdit({ kind: 'attachments', hidden: true }) }}
                />
              </li>
            )}
            {(installed ? [] : [t('detail.approvalsPanelTitle', { defaultValue: 'Approvals' }), t('detail.timeline', { defaultValue: 'Activity' })]).map(
              (label, index) => (
                <li
                  key={label}
                  className={cn(CHIP, 'bg-muted/40 text-muted-foreground')}
                  data-record-tabs-tab={index === 0 ? 'sys_approval_request' : 'sys_activity'}
                >
                  <TabChipBody id={label} label={label} fixedReason={builtinFixed} disabled={disabled} />
                </li>
              ),
            )}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm" data-testid="record-tabs-hidden">
        <span className="text-xs font-medium text-muted-foreground">
          {t('designMode.recordTabs.hidden', { defaultValue: 'Hidden' })}
        </span>
        {hiddenNames.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t('designMode.recordTabs.noneHidden', { defaultValue: 'None' })}</span>
        ) : (
          hiddenNames.map((item) => (
            <span key={item.id} className={cn(CHIP, 'border-dashed text-muted-foreground')} data-record-tabs-hidden-tab={item.id}>
              <span className="truncate px-0.5">{item.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                disabled={disabled}
                aria-label={showLabel(item.label)}
                title={showLabel(item.label)}
                onClick={item.restore}
                data-record-tabs-restore=""
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
            </span>
          ))
        )}
        {studioPath && (
          <Link
            to={studioPath}
            className="ml-auto text-xs font-medium text-primary underline-offset-4 hover:underline"
            data-testid="record-tabs-field-groups"
          >
            {t('designMode.recordTabs.adjustFieldGroups', { defaultValue: 'Adjust field groups' })}
          </Link>
        )}
      </div>
    </div>
  );
}
