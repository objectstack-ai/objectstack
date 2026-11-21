/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35956 — a list cell's change that makes other fields required
 * asks for them in place, before anything is written.
 *
 * Changing 「阶段」 to 「赢单」 when 「赢单原因」 is required on 赢单 used to be
 * written alone, refused by the engine, and left the reader with a red cell and
 * often no place to type the reason (a column the view does not draw). Now the
 * select-first grid's `confirmCommit` asks first: when the new value makes
 * fields required that are still empty (`collectRequiredWhenPromptFields`, the
 * one pre-evaluation the kanban drop and the record page use), the shared
 * `RequiredFieldsDialog` opens. Save writes the cell's value and the typed
 * values in ONE update through the grid's own row save (`save`, the same
 * guarded write a cell commit makes, so the row redraws in place and the save
 * toast offers Undo); a refusal stays in the dialog. Cancel writes nothing and
 * the cell shows what it showed before.
 *
 * Either way the table is told "no" (`confirmCommit` resolves `false`): the
 * write, when there is one, was the grid's, not the table's.
 */

import React from 'react';
import { getRecordDisplayName, resolveFieldAffordance } from '@object-ui/core';
import {
  collectRequiredWhenPromptFields,
  hasFieldEditWidget,
  RequiredFieldsDialog,
  type RequiredFieldsDialogField,
  type RequiredFieldsDialogChange,
  type RequiredWhenPromptField,
} from '@object-ui/fields';
import { stateLabelOf } from './objectGridStateConfirm';

type FieldDefs = Record<string, any> | undefined;

export interface CellRequiredPromptInputs {
  objectName: string | undefined;
  objectSchema: unknown;
  objectFields: FieldDefs;
  perms: Parameters<typeof resolveFieldAffordance>[1];
  /** The grid's field label (the column header when it draws one). */
  labelOf: (field: string) => string;
  /** The grid's option localisation. */
  translateOptions: (objectName: string, field: string, options: any[]) => any[];
  /** The grid's option label for one stored code. */
  optionLabel: (field: string, code: string, fallback: string) => string;
  /** The grid's word for no value. */
  emptyText: string;
  /** The grid's row save: one guarded update of `changes` over `row`. */
  save: (row: any, changes: Record<string, unknown>) => Promise<void>;
}

interface PendingPrompt {
  row: any;
  columnKey: string;
  value: unknown;
  fields: RequiredWhenPromptField[];
  resolve: (written: boolean) => void;
}

/**
 * The ask `confirmCommit` makes, and the dialog the grid renders once.
 * `renderDialog` is called from the grid's JSX, after every helper `inputs`
 * reads is in scope (the labels read the grid's columns).
 */
export function useCellRequiredPrompt(inputs: CellRequiredPromptInputs): {
  ask: (row: any, columnKey: string, value: unknown) => Promise<boolean> | null;
  renderDialog: () => React.ReactNode;
} {
  const [pending, setPending] = React.useState<PendingPrompt | null>(null);
  const pendingRef = React.useRef<PendingPrompt | null>(null);
  const { objectName, objectSchema, objectFields, perms } = inputs;

  // A field this reader may write from the list: the field grant the cell
  // editors ask (`listInlineEdit`).
  const fillable = (name: string, def: Record<string, unknown>): boolean =>
    def.readonly !== true
    && (!objectName || resolveFieldAffordance('listInlineEdit', perms, objectName, name));

  const label = (f: RequiredWhenPromptField): RequiredFieldsDialogField => {
    const options = f.def.options;
    const localized = objectName && Array.isArray(options)
      ? inputs.translateOptions(objectName, f.name, options)
      : options;
    return { ...f, def: { ...f.def, ...(localized ? { options: localized } : {}) }, label: inputs.labelOf(f.name) };
  };

  const settle = (written: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(written);
  };

  // Unmounting the grid answers an open ask "no", as the state confirm does.
  React.useEffect(() => () => { pendingRef.current?.resolve(false); pendingRef.current = null; }, []);

  const ask = (row: any, columnKey: string, value: unknown): Promise<boolean> | null => {
    if (!row || typeof row !== 'object') return null;
    const fields = collectRequiredWhenPromptFields(objectFields, row, { [columnKey]: value }, { fillable });
    if (fields.length === 0) return null;
    // The table writes nothing either way: the grid's own save did, or the
    // reader cancelled. A second ask while one is open answers the first no.
    return new Promise<boolean>((resolve) => {
      pendingRef.current?.resolve(false);
      const next: PendingPrompt = { row, columnKey, value, fields, resolve: () => resolve(false) };
      pendingRef.current = next;
      setPending(next);
    });
  };

  const renderDialog = (): React.ReactNode => {
    if (!pending) return null;
    const { row, columnKey, value } = pending;
    const changes: RequiredFieldsDialogChange[] = [{
      name: columnKey,
      label: inputs.labelOf(columnKey),
      value: stateLabelOf(
        objectFields?.[columnKey]?.options,
        value,
        (code, fallback) => inputs.optionLabel(columnKey, code, fallback),
        inputs.emptyText,
      ),
    }];
    const refusalField = (name: string): RequiredFieldsDialogField | null => {
      const def = objectFields?.[name];
      if (!def || typeof def !== 'object' || name === columnKey) return null;
      // A field a refusal names joins the dialog when it could have been asked
      // for: it has an edit widget and this reader may write it.
      if (!hasFieldEditWidget(def.type) || !fillable(name, def)) return null;
      return label({ name, def: { name, ...def } });
    };
    return (
      <RequiredFieldsDialog
        open
        fields={pending.fields.map(label)}
        recordName={getRecordDisplayName(objectSchema, row)}
        changes={changes}
        moreFields={(values) => collectRequiredWhenPromptFields(
          objectFields,
          row,
          { [columnKey]: value, ...values },
          { exclude: [columnKey], fillable },
        ).map(label)}
        refusalField={refusalField}
        labelOf={(name) => (objectFields?.[name] ? inputs.labelOf(name) : undefined)}
        onCancel={() => settle(false)}
        onSubmit={async (values) => {
          await inputs.save(row, { [columnKey]: value, ...values });
          settle(true);
        }}
      />
    );
  };
  return { ask, renderDialog };
}
