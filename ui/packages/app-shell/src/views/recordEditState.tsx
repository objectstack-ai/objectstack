/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page's EDIT STATE — "Edit" turns the overview into a form: the
 * record's fields become inputs (the record-level inline-edit session), the
 * master-detail body tables become editable lines, and ONE Save writes the
 * record's changes and every table's creates / updates / deletes in one
 * `POST /api/v1/batch`, one transaction: all of it lands, or none of it does.
 *
 * Pieces, each consumed by `RecordDetailView`:
 *
 *   - {@link RecordEditStateController} — mounted under the page's
 *     `InlineEditProvider`; enters the session, owns Save / Cancel (the header's
 *     two buttons call it), places a refused save's reasons on the field or line
 *     they are about, and registers the unsaved edits with the shell's
 *     leave guard. While the state is open it draws each body table as
 *     `@object-ui/plugin-form`'s `RecordBodyTableEditor`, through
 *     `@object-ui/plugin-detail`'s `RecordBodyTableEditorSlotContext`: the page
 *     keeps its `record:related_list` nodes, and each one whose relationship
 *     is a body table renders the editor in its place. The editor is a host
 *     element, never a registered node type a page could carry.
 *   - {@link bodyTablesSaveTogether} — whether the batch path can carry the
 *     tables at all (the card's item 5, see there).
 *   - {@link withDetailWritesWithheld} — ruling A's client half: a locked
 *     record's master-detail children draw no New / Edit / Delete.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runBatchTransaction } from '@object-ui/core';
import {
  RecordEditSessionContext,
  attributeRecordEditRefusal,
  buildRecordEditBatch,
  RecordBodyTableEditor,
  type BodyTableEditHandle,
  type RecordEditSession,
} from '@object-ui/plugin-form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@object-ui/components';
import { useInlineEdit, type RelatedRecordActionsValue } from '@object-ui/react';
import { RecordBodyTableEditorSlotContext, type RecordBodyTableEditorSlot } from '@object-ui/plugin-detail';
import { canServeApiOperation } from '@objectstack/spec/data';
import { useRegisterUnsavedEdits } from '../chrome/unsavedEdits.js';

/**
 * Can ONE batch carry this record's body tables (the card's item 5)?
 *
 * `POST /api/v1/batch` is a bulk surface: every object it writes must grant the
 * `bulk` primitive AND the write it performs (`bulk ∧ child`, the REST batch
 * route's gate, read here through the same spec derivation
 * `canServeApiOperation`). The record needs `bulk ∧ update`; each body table's
 * child `bulk ∧ create / update / delete`. When any is refused the page does
 * not offer an edit it cannot save: the tables stay read-only in the edit state
 * with a notice saying why, and the record's own fields save through the plain
 * update they always used. Decided from the objects' `enable` blocks the page
 * already holds — no request.
 */
export function bodyTablesSaveTogether(
  objectDef: { enable?: unknown } | null | undefined,
  objects: ReadonlyArray<any> | null | undefined,
  bodyTableIds: ReadonlySet<string>,
): boolean {
  if (bodyTableIds.size === 0) return false;
  if (!canServeApiOperation(objectDef?.enable as any, 'bulk', { bulkChild: 'update' })) return false;
  for (const id of bodyTableIds) {
    const child = id.slice(0, id.indexOf('.'));
    const def = (objects ?? []).find((o) => o?.name === child);
    for (const op of ['create', 'update', 'delete'] as const) {
      if (!canServeApiOperation(def?.enable, 'bulk', { bulkChild: op })) return false;
    }
  }
  return true;
}

/**
 * Is `childObject.fk` a master-detail child of `parentObject` — a detail row
 * ruling A's lock holds? Read off the child's own field definition.
 */
export function isMasterDetailChild(
  objects: ReadonlyArray<any> | null | undefined,
  parentObject: string | undefined,
  childObject: string,
  fk: string | undefined,
): boolean {
  if (!parentObject || !fk) return false;
  const def = (objects ?? []).find((o) => o?.name === childObject);
  const field = def?.fields?.[fk];
  return field?.type === 'master_detail' && (field.reference === parentObject || field.referenceTo === parentObject);
}

/**
 * Ruling A, client half (「一起锁」): what the related-record bridge serves while
 * the record is held by a locking approval — its master-detail children's
 * lists and body tables draw no New, Edit or Delete, because the server refuses
 * each of them `RECORD_LOCKED`. Everything else the bridge serves, and every
 * other child, is untouched. Handed to `RelatedRecordActionsBridge`'s existing
 * `serve` prop.
 */
export function withDetailWritesWithheld(
  bridge: RelatedRecordActionsValue,
  isDetail: (childObject: string, fk: string | undefined) => boolean,
): RelatedRecordActionsValue {
  return {
    ...bridge,
    resolve: (input) => {
      const handlers = bridge.resolve(input);
      if (!isDetail(input.objectName, input.relationshipField)) return handlers;
      const { onCreate: _create, onEdit: _edit, onDelete: _delete, ...rest } = handlers;
      return rest;
    },
  };
}

/** What the header's Cancel / Save call. */
export interface RecordEditStateControl {
  save: () => Promise<void>;
  cancel: () => void;
}

/**
 * What the header's Edit calls to ENTER the edit state (ruling B, 「全部保留」:
 * inline edit and the edit state are two modes, one at a time). With no inline
 * session it enters; with an inline session holding no changes it ends that
 * session and enters; with unsaved inline changes it asks first — discard
 * them and enter, or keep editing inline and save them through the save bar.
 */
export interface RecordEditStateEntry {
  requestEnter: () => void;
}

export interface RecordEditStateControllerProps {
  /** The page is in its edit state. */
  active: boolean;
  /** Leave the edit state (after a save, or a cancel). */
  onExit: () => void;
  /** Enter the edit state (once any inline session is out of the way). */
  onEnter: () => void;
  /** Filled each render with the controller's Save / Cancel. */
  controlRef: React.MutableRefObject<RecordEditStateControl | null>;
  /** Filled each render with the controller's enter request. */
  enterRef: React.MutableRefObject<RecordEditStateEntry | null>;
  /** The discard confirm's title, message and two buttons. */
  discardInlineTitle: string;
  discardInlineMessage: string;
  discardLabel: string;
  keepEditingLabel: string;
  /** A save started or settled — the header greys its two buttons meanwhile. */
  onSavingChange: (saving: boolean) => void;
  dataSource: any;
  objectName: string | undefined;
  recordId: string | number | null | undefined;
  /** Re-read the record after a save. */
  refresh: () => void | Promise<void>;
  /** The page's body tables, by relationship id (`CHILD_OBJECT.FK_FIELD`). */
  bodyTableIds: ReadonlySet<string>;
  /** The body tables are edited (one batch can carry them) — see {@link bodyTablesSaveTogether}. */
  bodyTablesEditable: boolean;
  /** The page draws body tables that stay read-only (the batch cannot carry them). */
  bodyTablesReadOnly: boolean;
  /** The notice shown when they do. */
  readOnlyNotice: string;
  /** The question asked before unsaved edits are dropped. */
  unsavedMessage: string;
  children: React.ReactNode;
}

export const RecordEditStateController: React.FC<RecordEditStateControllerProps> = ({
  active,
  onExit,
  onEnter,
  controlRef,
  enterRef,
  discardInlineTitle,
  discardInlineMessage,
  discardLabel,
  keepEditingLabel,
  onSavingChange,
  dataSource,
  objectName,
  recordId,
  refresh,
  bodyTableIds,
  bodyTablesEditable,
  bodyTablesReadOnly,
  readOnlyNotice,
  unsavedMessage,
  children,
}) => {
  const inline = useInlineEdit();
  const tablesRef = useRef(new Map<string, BodyTableEditHandle>());
  const [dirtyTables, setDirtyTables] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  // Stable by construction (a `useState` initializer), never a memo's identity
  // (ui AGENTS.md #10): the editors key their registration effect on these.
  const [api] = useState(() => ({
    register: (handle: BodyTableEditHandle) => {
      tablesRef.current.set(handle.id, handle);
      return () => {
        if (tablesRef.current.get(handle.id) === handle) tablesRef.current.delete(handle.id);
      };
    },
    reportDirty: (id: string, dirty: boolean) => {
      setDirtyTables((prev) => {
        if (prev.has(id) === dirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(id); else next.delete(id);
        return next;
      });
    },
  }));
  const session: RecordEditSession = { register: api.register, reportDirty: api.reportDirty, saving };

  // The body tables drawn as editors while the state is open (and one batch
  // can carry them). Keyed on the ids' content, not the set's identity: the
  // page computes the set afresh each render, and every related list on the
  // page reads this value.
  const editedTablesKey = active && bodyTablesEditable ? [...bodyTableIds].sort().join('\n') : '';
  const editorSlot = useMemo<RecordBodyTableEditorSlot | null>(
    () => (editedTablesKey
      ? {
          ids: new Set(editedTablesKey.split('\n')),
          render: ({ objectName: child, relationshipField, title }) => (
            <RecordBodyTableEditor objectName={child} relationshipField={relationshipField} title={title} />
          ),
        }
      : null),
    [editedTablesKey],
  );

  // Enter the record-level session once the edit state opens (the provider's
  // `canEdit` admits it on the render that set `active`), and leave the edit
  // state if the session ends some other way.
  const editing = !!inline?.editing;
  const canEdit = !!inline?.canEdit;
  const enter = inline?.enter;
  const enteredRef = useRef(false);
  useEffect(() => {
    if (!active) {
      enteredRef.current = false;
      return;
    }
    if (!enteredRef.current && canEdit && !editing) {
      enteredRef.current = true;
      enter?.();
    }
  }, [active, canEdit, editing, enter]);
  const wasEditingRef = useRef(false);
  useEffect(() => {
    if (active && wasEditingRef.current && !editing && !saving) onExit();
    wasEditingRef.current = editing;
  }, [active, editing, saving, onExit]);
  useEffect(() => {
    if (!active) setDirtyTables((prev) => (prev.size === 0 ? prev : new Set()));
  }, [active]);

  useEffect(() => { onSavingChange(saving); }, [saving, onSavingChange]);

  const draftKeys = inline ? Object.keys(inline.draft) : [];
  const dirty = active && (draftKeys.length > 0 || dirtyTables.size > 0);
  useRegisterUnsavedEdits(dirty, unsavedMessage);

  const finish = useCallback(async () => {
    inline?.reset();
    setDirtyTables(new Set());
    onExit();
    await refresh();
  }, [inline, onExit, refresh]);

  const save = useCallback(async () => {
    if (!inline || saving || !dataSource || !objectName || recordId == null) return;
    const draft = inline.draft;
    const handles = [...tablesRef.current.values()];
    inline.setError(null);
    inline.setFieldErrors(null);
    for (const h of handles) h.setErrors(null);
    const tables = bodyTablesEditable
      ? handles.flatMap((h) => {
          const snap = h.snapshot();
          return snap ? [{ id: h.id, ...snap }] : [];
        })
      : [];
    const built = buildRecordEditBatch(objectName, String(recordId), draft, tables);
    // An untouched record writes no update of its own: op 0 goes when the draft is empty.
    const hasDraft = Object.keys(draft).length > 0;
    const ops = hasDraft ? built.ops : built.ops.slice(1);
    const owners = hasDraft ? built.owners : built.owners.slice(1);
    if (ops.length === 0) {
      await finish();
      return;
    }
    setSaving(true);
    inline.setSaving(true);
    try {
      if (tables.length === 0) {
        // The record alone — the plain update the inline session always used.
        await dataSource.update(objectName, recordId, draft);
      } else {
        await runBatchTransaction(dataSource, ops);
      }
      await finish();
    } catch (err) {
      const refusal = attributeRecordEditRefusal(err, ops, owners);
      inline.setFieldErrors(refusal.fieldErrors);
      inline.setError(refusal.message);
      for (const h of handles) {
        h.setErrors(refusal.rowErrors[h.id] ?? null, refusal.tableErrors[h.id] ?? null);
      }
    } finally {
      inline.setSaving(false);
      setSaving(false);
    }
  }, [inline, saving, dataSource, objectName, recordId, bodyTablesEditable, finish]);

  const cancel = useCallback(() => {
    inline?.cancel();
    setDirtyTables(new Set());
    onExit();
  }, [inline, onExit]);

  controlRef.current = active ? { save, cancel } : null;

  // Ruling B (「全部保留」): one mode at a time. The edit state enters the same
  // inline session, so an inline session already open is ended first — after
  // a confirm when it holds changes. `wasEditingRef` is cleared before the
  // session ends, so ending it is not read as leaving the edit state.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const enterNow = () => {
    if (inline?.editing) {
      wasEditingRef.current = false;
      inline.cancel();
    }
    onEnter();
  };
  enterRef.current = active
    ? null
    : {
        requestEnter: () => {
          if (inline?.editing && Object.keys(inline.draft).length > 0) setConfirmDiscard(true);
          else enterNow();
        },
      };

  return (
    <RecordEditSessionContext.Provider value={active && bodyTablesEditable ? session : null}>
      <RecordBodyTableEditorSlotContext.Provider value={editorSlot}>
        {children}
      </RecordBodyTableEditorSlotContext.Provider>
      <AlertDialog open={confirmDiscard} onOpenChange={(open) => { if (!open) setConfirmDiscard(false); }}>
        <AlertDialogContent data-record-edit-discard-inline="">
          <AlertDialogHeader>
            <AlertDialogTitle>{discardInlineTitle}</AlertDialogTitle>
            <AlertDialogDescription>{discardInlineMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{keepEditingLabel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscard(false);
                enterNow();
              }}
            >
              {discardLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {active && (inline?.error || bodyTablesReadOnly) && (
        <div
          className="sticky bottom-0 z-30 mt-4 space-y-1 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm"
          data-record-edit-state=""
          data-fab-yield=""
        >
          {bodyTablesReadOnly && (
            <p className="text-muted-foreground" data-record-edit-tables-read-only="">{readOnlyNotice}</p>
          )}
          {inline?.error && (
            <p role="alert" className="text-destructive" data-record-edit-error="">{inline.error}</p>
          )}
        </div>
      )}
    </RecordEditSessionContext.Provider>
  );
};
