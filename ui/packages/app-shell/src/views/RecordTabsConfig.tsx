// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * 「Configure tabs」 on the record page (objectstack#36499, epic
 * objectstack#36359): an administrator arranges the record page's tabs in
 * place, for everyone.
 *
 * - The entry is the first of the record's own entries in its 「…」, drawn for
 *   a workspace administrator who may author metadata, on the desktop full
 *   page of an object whose package the server lists writable (the gate of
 *   Studio's design entries, `useStudioDesignGate`). Not on a phone, not in a
 *   drawer or pane, not on a page its author composed.
 * - Chosen, the page enters its edit state in place: a bar across the top of
 *   the page — 「Configure tabs」 at its left, 「Cancel」 and 「Save」 at its
 *   right, the design mode's bar's look — and the tab row turns into the
 *   editor ({@link RecordTabsEditor}). The record stays on screen as the
 *   preview: the page is drawn from the object with the draft's
 *   `relatedLists` (`previewRecordTabsObject`), in the administrator's
 *   default order (their own arrangement is set aside while editing).
 * - 「Cancel」 drops the draft and writes nothing. With a change held, leaving
 *   the page asks first (the shell's unsaved-edits seam).
 * - 「Save」 writes the object's `relatedLists` and publishes it
 *   (`saveRecordTabs`): the order everyone sees by default. A reader's own
 *   arrangement is a diff laid over that default (`relatedArrangement.ts`),
 *   and 「Restore default order」 returns them to it.
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
import { toast } from 'sonner';
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
import { Eye, EyeOff, GripVertical, Lock, Pencil, PanelsTopLeft } from 'lucide-react';
import { Button, Input, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { isRecordPageBuiltinTab, relatedListEntryName } from '@objectstack/spec/data';
import { registerUnsavedEdits } from '../chrome/unsavedEdits.js';
import { useStudioDesignGate } from '../hooks/useStudioDesignGate.js';
import { fetchDefaultLocale, isSameLanguage } from '../layout/designModeMenuSave.js';
import { relatedListEntryNames, type DerivedRelatedList } from '../utils/deriveRelatedLists.js';
import { useMetadataClient } from './metadata-admin/useMetadata.js';
import { studioPillarItemPath } from './studio-design/metadataArea.js';
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
} from './recordTabsConfig.js';
import { consoleRecordTabsDoors, readStoredRelatedLists, saveRecordTabs } from './recordTabsConfigSave.js';

type ObjectLike = Record<string, unknown> & { name?: string };

/** The record's 「…」 entry's name: the host action it is drawn as. */
export const RECORD_TABS_CONFIG_ACTION = 'sys_configure_tabs';

/** The package an object is kept in, as served (`_packageId`), or `null`. */
export function objectPackageId(objectDef: ObjectLike | null | undefined): string | null {
  const id = objectDef?._packageId;
  return typeof id === 'string' && id && id !== 'sys_metadata' ? id : null;
}

/** Where 「Adjust field groups」 goes: the object in Studio's Data pillar. */
export function recordTabsStudioPath(objectDef: ObjectLike | null | undefined): string | null {
  const packageId = objectPackageId(objectDef);
  const name = objectDef?.name;
  return packageId && typeof name === 'string' && name ? studioPillarItemPath(packageId, 'data', { type: 'object', name }) : null;
}

interface Session {
  readonly objectName: string;
  readonly initial: RecordTabsDraft;
  readonly draft: RecordTabsDraft;
}

export interface RecordTabsConfigInput {
  readonly objectDef: ObjectLike | null | undefined;
  readonly objects: readonly ObjectLike[];
  /** The page may offer the entry at all: a desktop full page drawing the synthesized record page. */
  readonly enabled: boolean;
  readonly canRead?: (objectName: string) => boolean;
  /** A related list's name on the page when no entry names it (its FK's title, else the child's plural). */
  readonly titleOf: (list: DerivedRelatedList) => string;
}

export interface RecordTabsConfig {
  /** The 「…」 entry is drawn. */
  readonly offered: boolean;
  /** The edit state is on. */
  readonly active: boolean;
  readonly enter: () => void;
  /** The object the page draws while the edit state is on, else `undefined`. */
  readonly previewObject: ObjectLike | undefined;
  /** The bar, while the edit state is on. */
  readonly bar: React.ReactNode;
  /** The editor that takes the tab row's place, while the edit state is on. */
  readonly editor: React.ReactNode;
}

/** The record page's tab configuration for the object on screen. */
export function useRecordTabsConfig({ objectDef, objects, enabled, canRead, titleOf }: RecordTabsConfigInput): RecordTabsConfig {
  const { t, language } = useObjectTranslation();
  const client = useMetadataClient();
  const objectName = typeof objectDef?.name === 'string' ? objectDef.name : '';
  const packageId = objectPackageId(objectDef);
  const studioPath = recordTabsStudioPath(objectDef);
  const offered = useStudioDesignGate(enabled ? studioPath : null) !== null && !!packageId;

  const [held, setHeld] = React.useState<Session | null>(null);
  const [saving, setSaving] = React.useState(false);
  const session = held && held.objectName === objectName && offered ? held : null;
  const active = session !== null;

  const catalog = React.useMemo<RecordTabsCatalog | null>(
    () => (active && objectDef ? recordTabsCatalog(objectDef, objects, { canRead }) : null),
    [active, objectDef, objects, canRead],
  );

  const enter = React.useCallback(() => {
    if (!objectDef || !objectName) return;
    const opened = recordTabsCatalog(objectDef, objects, { canRead });
    const initial = initialRecordTabsDraft(objectDef, objects, opened, { canRead });
    setHeld({ objectName, initial, draft: initial });
  }, [objectDef, objectName, objects, canRead]);
  const cancel = React.useCallback(() => setHeld(null), []);
  const edit = React.useCallback((change: RecordTabsEdit) => {
    setHeld((prev) => (prev ? { ...prev, draft: editRecordTabsDraft(prev.draft, change) } : prev));
  }, []);

  const dirty = !!session && !sameRecordTabsDraft(session.draft, session.initial);
  const leaveMessage = t('designMode.recordTabs.leaveUnsaved', {
    defaultValue: 'Leave without saving? Your tab changes will be lost.',
  });
  React.useEffect(() => (dirty ? registerUnsavedEdits(leaveMessage) : undefined), [dirty, leaveMessage]);

  // The stored list and the deployment's default language, for the rename gate.
  const [stored, setStored] = React.useState<{ objectName: string; lists: unknown[] | null } | null>(null);
  const [defaultLocale, setDefaultLocale] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!active || !packageId) return undefined;
    let cancelled = false;
    void readStoredRelatedLists(objectName, packageId, client as never).then((lists) => {
      if (!cancelled) setStored({ objectName, lists });
    });
    void fetchDefaultLocale().then((code) => {
      if (!cancelled) setDefaultLocale(code);
    });
    return () => {
      cancelled = true;
    };
  }, [active, objectName, packageId, client]);

  const save = React.useCallback(async () => {
    if (!session || !catalog || !packageId || saving) return;
    setSaving(true);
    try {
      await saveRecordTabs(
        { objectName, packageId, draft: session.draft, catalog },
        {
          notListed: t('designMode.recordTabs.notListed', {
            defaultValue: "This object's package is not listed, so its tabs cannot be saved.",
          }),
          pendingDraft: t('designMode.recordTabs.pendingDraft', {
            defaultValue: 'This object has unpublished changes in Studio. Publish or discard them there, then save again.',
          }),
          notWritable: t('designMode.recordTabs.notWritable', {
            defaultValue: "This object's package cannot be written, so its tabs cannot be saved here.",
          }),
        },
        consoleRecordTabsDoors(client as never),
      );
      setHeld(null);
    } catch (error) {
      toast.error(
        t('designMode.recordTabs.saveFailed', {
          defaultValue: 'The tabs were not saved: {{reason}}',
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSaving(false);
    }
  }, [session, catalog, packageId, saving, objectName, client, t]);

  const previewObject = React.useMemo(
    () => (session && catalog && objectDef ? previewRecordTabsObject(objectDef, session.draft, catalog) : undefined),
    [session, catalog, objectDef],
  );

  const storedLists = stored?.objectName === objectName ? stored.lists : null;
  const sourceLanguage = !!defaultLocale && isSameLanguage(language, defaultLocale);

  const bar = session ? (
    <RecordTabsConfigBar dirty={dirty} saving={saving} onCancel={cancel} onSave={() => void save()} />
  ) : null;
  const editor =
    session && catalog ? (
      <RecordTabsEditor
        catalog={catalog}
        draft={session.draft}
        initial={session.initial}
        titleOf={titleOf}
        storedLists={storedLists}
        sourceLanguage={sourceLanguage}
        studioPath={studioPath}
        disabled={saving}
        onEdit={edit}
      />
    ) : null;

  return { offered, active, enter, previewObject, bar, editor };
}

/**
 * The edit state's bar: 「Configure tabs」 at its left, 「Cancel」 and 「Save」
 * at its right — the design mode's bar's look (`DesignModeBar`), across the
 * top of the record page.
 */
export function RecordTabsConfigBar({
  dirty,
  saving,
  onCancel,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useObjectTranslation();
  const title = t('designMode.recordTabs.title', { defaultValue: 'Configure tabs' });
  return (
    <div
      role="region"
      aria-label={title}
      data-testid="record-tabs-config-bar"
      className="flex h-12 min-w-0 shrink-0 items-center gap-2 bg-primary px-3 text-primary-foreground sm:px-4"
    >
      <PanelsTopLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate text-sm font-semibold">{title}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          disabled={saving}
          onClick={onCancel}
          data-testid="record-tabs-config-cancel"
        >
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8"
          disabled={!dirty || saving}
          onClick={onSave}
          data-testid="record-tabs-config-save"
        >
          {t('common.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  );
}

const CHIP = 'inline-flex h-8 max-w-full shrink-0 items-center gap-1 rounded-md border px-1.5 text-sm';

interface ChipProps {
  id: string;
  label: string;
  /** Why this tab keeps its place, when it does. */
  fixedReason?: string;
  rename?: { open: boolean; hint?: string; onRename: (label: string | undefined) => void };
  hide?: { label: string; onHide: () => void };
  disabled: boolean;
}

function TabChipBody({ label, fixedReason, rename, hide, disabled, handle }: ChipProps & { handle?: React.ReactNode }) {
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
 * The tab row in the edit state: the shown tabs in order, each with a drag
 * handle, a rename and a hide; then 附件 (hide only), 审批 and 动态 (fixed,
 * where the page draws them last); then the 「Hidden」 area, from which a tab
 * is shown again; and 「Adjust field groups」.
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
}) {
  const { t } = useObjectTranslation();
  const byId = React.useMemo(() => new Map(catalog.candidates.map((c) => [c.id, c] as const)), [catalog]);
  const defaultLabel = (id: RecordTabId): string => {
    const candidate = byId.get(id);
    return candidate ? titleOf(candidate.list) : id;
  };
  const labelOf = (id: RecordTabId): string => draft.labels[id] ?? defaultLabel(id);
  const contributed = t('designMode.recordTabs.contributed', {
    defaultValue: 'Another package adds this tab. It is placed there.',
  });
  const sourceOnly = t('designMode.recordTabs.renameSourceOnly', {
    defaultValue: "Tab names are changed in the app's source language",
  });
  const builtinFixed = t('designMode.recordTabs.builtinFixed', {
    defaultValue: 'The platform draws this tab last, under its own name.',
  });
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
  if (catalog.files && draft.attachmentsHidden) {
    hiddenNames.push({ id: 'sys_attachment', label: attachments, restore: () => onEdit({ kind: 'attachments', hidden: false }) });
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-border pb-3" data-testid="record-tabs-editor">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={[...draft.order]} strategy={horizontalListSortingStrategy}>
          <ul className="flex min-w-0 flex-wrap items-center gap-2" aria-label={t('designMode.recordTabs.shown', { defaultValue: 'Tabs' })}>
            {draft.order.map((id) => {
              const candidate = byId.get(id);
              const fixed = candidate?.fromPackage !== undefined;
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
                />
              );
            })}
            {catalog.files && !draft.attachmentsHidden && (
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
            {[t('detail.approvalsPanelTitle', { defaultValue: 'Approvals' }), t('detail.timeline', { defaultValue: 'Activity' })].map(
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
