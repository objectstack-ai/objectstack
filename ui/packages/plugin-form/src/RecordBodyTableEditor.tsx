/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordBodyTableEditor — a record page's master-detail body table in the
 * page's EDIT STATE: the child rows as editable lines (add / edit / remove),
 * saved together with the record's own fields in ONE batch by the page host.
 *
 * The record page draws its body tables as `record:related_list` nodes. In its
 * edit state the host draws this editor in each one's place and owns the
 * save: the editor holds its rows, and hands the host a snapshot (rows, the rows as
 * loaded, the child schema) through {@link RecordEditSessionContext}. The host
 * folds the record's field draft and every table's snapshot into one
 * `POST /api/v1/batch` with {@link buildRecordEditBatch} — the same
 * `buildMasterDetailEditBatch` construction `MasterDetailForm` and
 * `LineItemsPanel` persist through, so a line is diffed into
 * create / update / delete exactly as the edit form diffs it.
 *
 * The pieces are `MasterDetailForm`'s: the `LineItemsField` grid, the child
 * columns `deriveDetail` derives, the field-permission pass
 * (`applyColumnPermissions`) and the add / remove rows of the
 * affordance-to-grant map (`relatedNew` / `relatedRowDelete`), so the lines
 * edit here as they edit in the form.
 *
 * ⚖️ The server is the validation authority on the record page (the inline
 * surface's ruling, `InlineEditSaveBar`): nothing here evaluates a rule. A
 * refused batch is PRESENTED — {@link attributeRecordEditRefusal} places each
 * reason the server named on the record's field or on the line whose write
 * carried that field.
 */

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { BatchTransactionOperation, GridFieldMetadata } from '@object-ui/types';
import { resolveAffordance, type SchemaLike } from '@object-ui/core';
import { LineItemsField, lookupAutofillByField, useBooleanValueLabel, type GridColumn } from '@object-ui/fields';
import { cn } from '@object-ui/components';
import { usePermissions } from '@object-ui/permissions';
import {
  extractFieldErrors,
  extractWriteErrorMessage,
  useRecordContext,
} from '@object-ui/react';
import { buildMasterDetailEditBatch, idOf, isBlankRow, type ChildSchema } from './masterDetailTx';
import { applyColumnPermissions } from './fieldWriteGate';
import { deriveDetail } from './deriveMasterDetail';
import { schemaDefaultValues } from './schemaDefaults';
import { useFormChromeTranslation } from './formChrome';

/** One reason the server gave about one line of a body table. */
export interface BodyTableRowError {
  /** The line's position in the table as drawn, from 0. */
  row: number;
  /** The child field the reason names, when it names one. */
  field?: string;
  message: string;
}

/** What a body-table editor hands the host at save time. */
export interface BodyTableSnapshot {
  childObject: string;
  relationshipField: string;
  rows: Record<string, any>[];
  original: Record<string, any>[];
  childSchema: ChildSchema;
}

/** One body-table editor, as the host's session sees it. */
export interface BodyTableEditHandle {
  /** The relationship id, `child.fk`. */
  id: string;
  /** `null` while the table's rows or schema are still loading — the host does not save then. */
  snapshot(): BodyTableSnapshot | null;
  /** Show (or clear, with `null`) the server's reasons about this table's lines. */
  setErrors(rows: BodyTableRowError[] | null, table?: string[] | null): void;
}

/** The host's edit session, read by every body-table editor under it. */
export interface RecordEditSession {
  /** Register an editor; the returned function unregisters it. */
  register(handle: BodyTableEditHandle): () => void;
  /** An editor's lines moved away from (or back to) what it loaded. */
  reportDirty(id: string, dirty: boolean): void;
  /** A save is in flight: every editor takes no input. */
  saving: boolean;
}

export const RecordEditSessionContext = React.createContext<RecordEditSession | null>(null);

/** Who wrote each operation of a record edit batch, by operation index. */
export type RecordEditOpOwner = { kind: 'parent' } | { kind: 'row'; table: string; row: number };

/**
 * The ONE batch of a record-page save: the record's field draft (op 0, an
 * update of only the edited keys) and every body table's lines diffed into
 * create / update / delete — `buildMasterDetailEditBatch`, table by table, so
 * each op can be traced back to the line it came from ({@link RecordEditOpOwner}).
 */
export function buildRecordEditBatch(
  parentObject: string,
  parentId: string,
  parentDraft: Record<string, any>,
  tables: ReadonlyArray<{ id: string } & BodyTableSnapshot>,
): { ops: BatchTransactionOperation[]; owners: RecordEditOpOwner[] } {
  const ops: BatchTransactionOperation[] = [buildMasterDetailEditBatch(parentObject, parentId, parentDraft, [])[0]];
  const owners: RecordEditOpOwner[] = [{ kind: 'parent' }];
  for (const t of tables) {
    const tableOps = buildMasterDetailEditBatch(parentObject, parentId, {}, [t]).slice(1);
    // Rows are traced back by id (update / delete) or by position among the
    // id-less rows (create): the builder emits creates first, in row order,
    // skipping blank rows; then updates; then deletes.
    const createRows = t.rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !idOf(r) && !isBlankRow({ ...r, [t.relationshipField]: parentId }, t.relationshipField));
    let createCursor = 0;
    for (const op of tableOps) {
      let row = -1;
      if (op.action === 'create') {
        row = createRows[createCursor++]?.i ?? -1;
      } else if (op.id != null) {
        row = t.rows.findIndex((r) => idOf(r) === String(op.id));
      }
      ops.push(op);
      owners.push({ kind: 'row', table: t.id, row });
    }
  }
  return { ops, owners };
}

/** How a refused record-edit batch reads, placed on the field or line it is about. */
export interface RecordEditRefusal {
  /** Reasons about the record's own fields, by field name. */
  fieldErrors: Record<string, string> | null;
  /** Reasons about body-table lines, by table id. */
  rowErrors: Record<string, BodyTableRowError[]>;
  /** Reasons about a table that no single line carries, by table id. */
  tableErrors: Record<string, string[]>;
  /** The summary line for the whole save. */
  message: string;
}

/**
 * Place a refused batch's reasons (objectui#6868: presented, never
 * re-derived). The batch answers ONE error for the transaction and does not
 * say which operation raised it, so each reason the server attributes to a
 * field is placed by the operations that WROTE that field: on the record when
 * only the record's update carries it, on a line when exactly one line's write
 * carries it, and on its table when several lines of one table do. A reason
 * that names no field (a lock, a permission refusal) stays the summary.
 */
export function attributeRecordEditRefusal(
  err: unknown,
  ops: ReadonlyArray<BatchTransactionOperation>,
  owners: ReadonlyArray<RecordEditOpOwner>,
): RecordEditRefusal {
  const message = extractWriteErrorMessage(err) ?? (err instanceof Error ? err.message : String(err));
  const out: RecordEditRefusal = { fieldErrors: null, rowErrors: {}, tableErrors: {}, message };
  const fields = extractFieldErrors(err);
  if (!fields) return out;
  const parentFields: Record<string, string> = {};
  for (const { field, message: reason } of fields) {
    const carriers = ops
      .map((op, i) => ({ op, owner: owners[i] }))
      .filter(({ op }) => op.action !== 'delete' && op.data && Object.prototype.hasOwnProperty.call(op.data, field));
    const rows = carriers.filter((c) => c.owner?.kind === 'row') as Array<{ op: BatchTransactionOperation; owner: { kind: 'row'; table: string; row: number } }>;
    const parent = carriers.some((c) => c.owner?.kind === 'parent');
    if (rows.length === 0) {
      // Only the record writes it — or nothing does, and the record is still
      // the best place: its fields are the page's inputs.
      parentFields[field] = reason;
      continue;
    }
    if (parent) parentFields[field] = reason;
    const tables = new Set(rows.map((r) => r.owner.table));
    if (rows.length === 1 && rows[0].owner.row >= 0) {
      const { table, row } = rows[0].owner;
      (out.rowErrors[table] ??= []).push({ row, field, message: reason });
    } else {
      for (const table of tables) (out.tableErrors[table] ??= []).push(reason);
    }
  }
  out.fieldErrors = Object.keys(parentFields).length > 0 ? parentFields : null;
  return out;
}

export interface RecordBodyTableEditorProps {
  /** The child object of the body table. */
  objectName: string;
  /** The child's master-detail FK back to the record. */
  relationshipField: string;
  /** The table's heading, as the read-mode table drew it. */
  title?: string;
}

/** Lines read for one table — the window `LineItemsPanel` and `MasterDetailForm` read. */
const BODY_TABLE_EDIT_LIMIT = 500;

/**
 * The editor itself. Reads the record (parent) and the data source from
 * `RecordContextProvider` (as the page's related lists do), and the session from
 * {@link RecordEditSessionContext}; with no session it renders nothing — it is
 * a part of the record page's edit state, never a standalone block.
 */
export const RecordBodyTableEditor: React.FC<RecordBodyTableEditorProps> = ({ objectName, relationshipField, title }) => {
  const session = useContext(RecordEditSessionContext);
  const record = useRecordContext();
  // The record page's adapter, as its related lists read it.
  const dataSource = record?.dataSource as any;
  const parentObject = record?.objectName;
  const parentId = record?.recordId;
  const perms = usePermissions();
  const { t } = useFormChromeTranslation();
  const booleanLabel = useBooleanValueLabel();
  const booleanTrue = booleanLabel(true);
  const booleanFalse = booleanLabel(false);
  const id = `${objectName}.${relationshipField}`;

  const [childSchema, setChildSchema] = useState<{ fields?: Record<string, any> } | null>(null);
  const [rows, setRows] = useState<Record<string, any>[] | null>(null);
  const [original, setOriginal] = useState<Record<string, any>[]>([]);
  const [rowErrors, setRowErrors] = useState<BodyTableRowError[] | null>(null);
  const [tableErrors, setTableErrors] = useState<string[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!dataSource || typeof dataSource.getObjectSchema !== 'function') return;
    Promise.resolve(dataSource.getObjectSchema(objectName))
      .then((s: any) => { if (!cancelled) setChildSchema(s ?? { fields: {} }); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [dataSource, objectName]);

  const derived = useMemo(() => {
    if (!childSchema || !parentObject) return null;
    try {
      return deriveDetail(objectName, childSchema as any, parentObject, { booleanLabel, relationshipField });
    } catch {
      return null;
    }
    // Keyed on the two WORDS, not on `booleanLabel` (a new function each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childSchema, parentObject, objectName, relationshipField, booleanTrue, booleanFalse]);

  // The lines as stored, read once per edit session (the editor mounts with it).
  useEffect(() => {
    let cancelled = false;
    if (!dataSource || parentId == null || !derived) return;
    Promise.resolve(dataSource.find(objectName, {
      $filter: { [relationshipField]: parentId },
      ...(derived.sortField
        ? { $orderby: [{ field: derived.sortField, order: 'asc' as const }, { field: 'id', order: 'asc' as const }] }
        : {}),
      $top: BODY_TABLE_EDIT_LIMIT,
    }))
      .then((res: any) => {
        if (cancelled) return;
        const loaded = (res?.data ?? []) as Record<string, any>[];
        setOriginal(loaded.map((r) => ({ ...r })));
        setRows(loaded.map((r) => ({ ...r })));
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [dataSource, parentId, derived, objectName, relationshipField]);

  // objectstack#35816 — a new line starts on the child object's static
  // defaults, the values a create form seeds (`schemaDefaultValues`), so a
  // required column with a default is filled instead of flagged empty. A
  // default the server resolves per insert (`NOW()`, a CEL expression) is not
  // seeded; the server fills it as it fills an omitted field.
  const newRowValues = useMemo(
    () => schemaDefaultValues(childSchema as Parameters<typeof schemaDefaultValues>[0]),
    [childSchema],
  );

  const snapshotRef = useRef<BodyTableSnapshot | null>(null);
  snapshotRef.current = rows && derived
    ? { childObject: objectName, relationshipField, rows, original, childSchema }
    : null;

  const register = session?.register;
  useEffect(() => {
    if (!register) return;
    return register({
      id,
      snapshot: () => snapshotRef.current,
      setErrors: (r, tbl) => {
        setRowErrors(r && r.length > 0 ? r : null);
        setTableErrors(tbl && tbl.length > 0 ? tbl : null);
      },
    });
  }, [register, id]);

  const reportDirty = session?.reportDirty;
  const onChange = useCallback((next: Record<string, any>[]) => {
    setRows(next);
    reportDirty?.(id, true);
  }, [reportDirty, id]);

  if (!session) return null;

  const lineSource = { objectSchema: childSchema as SchemaLike | null, objectName, perms };
  const heading = title || (childSchema as any)?.pluralLabel || (childSchema as any)?.label || objectName;
  const labelOf = (field?: string) =>
    (field && (derived?.columns.find((c) => c.name === field)?.label || (childSchema?.fields as any)?.[field]?.label)) || field;

  return (
    <section
      className="space-y-2"
      data-body-table-editor={id}
      aria-busy={rows === null && !loadFailed ? true : undefined}
    >
      <h3 className="text-sm font-medium text-foreground">{heading}</h3>
      {loadFailed ? (
        <p className="py-4 text-sm text-destructive" role="alert">
          {t('form.lineItems.loadFailed')}
        </p>
      ) : rows === null || !derived ? (
        <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <LineItemsField
          value={rows}
          onChange={onChange}
          disabled={session.saving}
          contextRecord={record?.data as Record<string, unknown> | undefined}
          lookupAutofill={lookupAutofillByField(childSchema?.fields as Record<string, unknown> | undefined)}
          newRowValues={newRowValues}
          // objectstack#35816 — a new line's empty required cell reads red
          // once a save was refused, not the moment the line appears; the
          // server stays the judge of what is missing.
          newRowRequiredShown={rowErrors !== null || tableErrors !== null}
          field={({
            columns: applyColumnPermissions(derived.columns as GridColumn[], { perms, objectName, mode: 'edit' }),
            totalField: derived.amountField,
            sortField: derived.sortField,
            allowAdd: resolveAffordance('relatedNew', lineSource).allowed,
            allowDelete: resolveAffordance('relatedRowDelete', lineSource).allowed,
          } satisfies Partial<GridFieldMetadata>) as GridFieldMetadata}
        />
      )}
      {(rowErrors || tableErrors) && (
        <ul
          role="alert"
          className={cn('space-y-0.5 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-xs text-destructive')}
        >
          {(rowErrors ?? []).map((e, i) => (
            <li key={`row-${i}`} data-body-table-row-error={e.row}>
              <span className="font-medium">
                {t('detail.bodyTableRow', { row: e.row + 1 })}
                {e.field ? ` · ${labelOf(e.field)}` : ''}
              </span>
              {': '}
              {e.message}
            </li>
          ))}
          {(tableErrors ?? []).map((message, i) => (
            <li key={`table-${i}`} data-body-table-error="">{message}</li>
          ))}
        </ul>
      )}
    </section>
  );
};
