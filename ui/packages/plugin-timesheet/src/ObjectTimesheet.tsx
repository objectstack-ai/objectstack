/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-timesheet` — the editable row × weekday entry grid a list view of
 * `type: 'timesheet'` draws (objectstack#34382).
 *
 * ## What it reads
 *
 * The view's `timesheet` block (`rowFields`, `dateField`, `valueField`), the
 * view's effective `filter` (`ListView` hands down the authored filter joined
 * with the toolbar's), and `objectName`. A missing or incomplete block draws
 * the "Timesheet configuration required" screen (`timesheet-missing-binding`),
 * the refusal `view/layout-without-binding` names.
 *
 * ## What it queries
 *
 * One `find` per displayed week: the view filter AND `dateField` inside the
 * week, capped at the platform's non-grid row ceiling, with the row fields'
 * relations expanded so a lookup row shows its record's name. The week starts
 * on the display locale's first day (`firstDayOfWeek`).
 *
 * ## What it writes
 *
 * Each cell edit is ONE call on the record doors — `create`, `update` or
 * `delete` (`planCellWrite` in `./timesheetModel.ts` decides which) — so the
 * object's hooks, validation and permissions judge every cell on its own. A
 * refusal stays on the cell that caused it, with the server's message, and the
 * typed text is kept so the viewer can correct it. Every write is announced
 * with `notifyDataChanged`, which also re-reads this grid.
 *
 * ## Strings
 *
 * `timesheet.*`, a lazy namespace (`@object-ui/i18n/namespaces/timesheet`):
 * nothing that reads one renders before `useTimesheetNamespace` answers
 * `ready`. Provider-less hosts get the English table below.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { DataSource, ObjectTimesheetSchema } from '@object-ui/types';
import {
  useDataInvalidation,
  useFilterScope,
  useResolvedFilter,
  useSafeFieldLabel,
  useSettledSchema,
  notifyDataChanged,
  NonGridRowCeilingNote,
} from '@object-ui/react';
import {
  Button,
  DataErrorState,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  cn,
} from '@object-ui/components';
import { createSafeTranslation, firstDayOfWeek, useDisplayLocale, useSafeTranslate } from '@object-ui/i18n';
import { useTimesheetNamespace } from '@object-ui/i18n/namespaces/timesheet';
import { FieldEditWidget, getCellRenderer, resolveCellRendererType } from '@object-ui/fields';
import { usePermissions } from '@object-ui/permissions';
import {
  applyNonGridRowCeiling,
  buildExpandFields,
  mergeFilterNodes,
  nonGridRowCeilingQuery,
  type NonGridCeilingResult,
} from '@object-ui/core';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  addDays,
  buildTimesheetRows,
  parseCellInput,
  planCellWrite,
  recordIdOf,
  resolveTimesheetConfig,
  rowKeyOf,
  rowValuesComplete,
  startOfWeek,
  weekDays,
  weekQueryBounds,
  fromDayKey,
  type TimesheetBinding,
  type TimesheetCell,
  type TimesheetRow,
} from './timesheetModel';

/** English for a host with no i18n provider; the catalogues hold the rest. */
const TIMESHEET_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'timesheet.missingBindingTitle': 'Timesheet configuration required',
  'timesheet.missingBindingMessage':
    'Declare timesheet.rowFields, timesheet.dateField and timesheet.valueField on this view.',
  'timesheet.previousWeek': 'Previous week',
  'timesheet.thisWeek': 'This week',
  'timesheet.nextWeek': 'Next week',
  'timesheet.total': 'Total',
  'timesheet.addRow': 'Add row',
  'timesheet.addRowConfirm': 'Add',
  'timesheet.cancel': 'Cancel',
  'timesheet.noRows': 'No entries this week. Add a row to start.',
  'timesheet.multipleRecords': 'This day holds more than one record. Edit them in the list.',
  'timesheet.invalidNumber': 'Enter a number',
  'timesheet.saveFailed': 'Not saved: {{message}}',
  'timesheet.loadFailed': 'This week could not be loaded.',
  'timesheet.rowIncomplete': 'Fill in every row field first.',
  'timesheet.cellLabel': '{{row}}, {{day}}',
  'timesheet.rowTotalLabel': '{{row}} total',
  'timesheet.dayTotalLabel': '{{day}} total',
};

const useTimesheetTranslation = createSafeTranslation(
  TIMESHEET_DEFAULT_TRANSLATIONS,
  'timesheet.missingBindingTitle',
);

export interface ObjectTimesheetProps {
  schema: ObjectTimesheetSchema;
  dataSource?: DataSource;
  className?: string;
  /** The day the first displayed week holds; today when omitted. */
  initialDate?: Date;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** One cell's in-flight state: the typed text, and a refusal if one came back. */
interface CellDraft {
  text: string;
  saving?: boolean;
  error?: string;
}

const cellId = (rowKey: string, day: string): string => `${rowKey}|${day}`;

export const ObjectTimesheet: React.FC<ObjectTimesheetProps> = (props) => {
  // The namespace frame: no `timesheet.*` key is read before its catalogue is
  // resident in the page's language.
  const namespace = useTimesheetNamespace();
  // The retry control cannot read a `timesheet.*` key: its catalogue is what
  // failed. It reads the packs' own `common.retry`.
  const tt = useSafeTranslate();
  if (namespace.status === 'loading') {
    return (
      <div className="flex flex-col gap-3 p-4" data-testid="timesheet-namespace-loading" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (namespace.status === 'failed') {
    return (
      <div className="flex justify-center p-8" data-testid="timesheet-namespace-failed">
        <Button variant="outline" size="sm" onClick={namespace.retry}>
          {tt('common.retry', 'Retry')}
        </Button>
      </div>
    );
  }
  return <TimesheetFrame {...props} />;
};

const TimesheetFrame: React.FC<ObjectTimesheetProps> = ({ schema, dataSource, className, initialDate }) => {
  const { t } = useTimesheetTranslation();
  const binding = useMemo(
    () => resolveTimesheetConfig(schema.timesheet),
    // Keyed on the block's content, never on its identity (AGENTS.md #10).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(schema.timesheet ?? null)],
  );
  if (!binding || !schema.objectName) {
    return (
      <div
        className={cn('flex h-full flex-col items-center justify-center gap-2 p-8 text-center', className)}
        data-testid="timesheet-missing-binding"
      >
        <p className="font-medium">{t('timesheet.missingBindingTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('timesheet.missingBindingMessage')}</p>
      </div>
    );
  }
  return (
    <TimesheetGridView
      schema={schema}
      objectName={schema.objectName}
      binding={binding}
      dataSource={dataSource}
      className={className ?? schema.className}
      initialDate={initialDate}
      t={t}
    />
  );
};

interface GridViewProps {
  schema: ObjectTimesheetSchema;
  objectName: string;
  binding: TimesheetBinding;
  dataSource?: DataSource;
  className?: string;
  initialDate?: Date;
  t: Translate;
}

function TimesheetGridView({ schema, objectName, binding, dataSource, className, initialDate, t }: GridViewProps) {
  const locale = useDisplayLocale();
  const firstDay = useMemo(() => {
    try {
      return firstDayOfWeek(locale);
    } catch {
      return 1;
    }
  }, [locale]);
  const [anchor, setAnchor] = useState<Date>(() => initialDate ?? new Date());
  const weekStart = startOfWeek(anchor, firstDay);
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const weekEnd = addDays(weekStart, 7);

  const { ready: schemaSettled, def: objectSchema } = useSettledSchema<any>(objectName, dataSource);
  const perms = usePermissions();
  const filterScope = useFilterScope();
  const queryFilter = useResolvedFilter(schema.filter as any, filterScope);
  const invalidationNonce = useDataInvalidation(dataSource ? objectName : undefined);
  const rowFieldsKey = binding.rowFields.join('\u0000');

  const [records, setRecords] = useState<Record<string, unknown>[] | null>(null);
  const [ceiling, setCeiling] = useState<NonGridCeilingResult | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CellDraft>>({});
  const [addedRows, setAddedRows] = useState<Record<string, unknown>[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!dataSource || typeof dataSource.find !== 'function' || !schemaSettled) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        // Only the row fields' relations are drawn, so only theirs are
        // expanded — each judged against field-level read access first.
        const expandable = buildExpandFields(objectSchema?.fields, binding.rowFields);
        const expand = !perms?.isLoaded
          ? expandable
          : expandable.filter((f) => perms.checkField(objectName, f, 'read'));
        const [from, to] = weekQueryBounds(weekStart, weekEnd, objectSchema?.fields?.[binding.dateField]?.type);
        const result = await dataSource.find(objectName, {
          $filter: mergeFilterNodes(
            queryFilter,
            [binding.dateField, '>=', from],
            [binding.dateField, '<', to],
          ) as any,
          ...nonGridRowCeilingQuery(),
          ...(expand.length > 0 ? { $expand: expand } : {}),
        });
        if (cancelled) return;
        const capped = applyNonGridRowCeiling<Record<string, unknown>>(result);
        setRecords(capped.rows);
        setCeiling(capped);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error : new Error(String(error)));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, objectName, schemaSettled, objectSchema, perms, queryFilter, invalidationNonce, weekStart, weekEnd, rowFieldsKey, binding.dateField]);

  const grid = useMemo(
    () => buildTimesheetRows(records ?? [], binding, days, addedRows),
    [records, binding, days, addedRows],
  );

  const fieldLabels = useSafeFieldLabel();
  const fieldDef = (name: string): any => objectSchema?.fields?.[name] ?? { name, type: 'text' };
  const fieldLabel = (name: string): string => {
    const fallback = objectSchema?.fields?.[name]?.label || name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return fieldLabels.fieldLabel(objectName, name, fallback);
  };
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }), [locale]);
  const dayHeading = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'numeric', day: 'numeric' }),
    [locale],
  );
  const rangeFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale]);
  const rowName = (row: TimesheetRow): string =>
    binding.rowFields.map((f) => displayText(row.values[f])).filter(Boolean).join(' · ');

  const writeCell = async (row: TimesheetRow, day: string, cell: TimesheetCell, text: string) => {
    const id = cellId(row.key, day);
    const parsed = parseCellInput(text);
    if (parsed === 'invalid') {
      setDrafts((d) => ({ ...d, [id]: { text, error: t('timesheet.invalidNumber') } }));
      return;
    }
    const write = planCellWrite(binding, row, day, cell, parsed, fieldDef(binding.dateField)?.type);
    if (write.kind === 'none' || write.kind === 'readonly' || !dataSource) {
      setDrafts(({ [id]: _dropped, ...rest }) => rest);
      return;
    }
    setDrafts((d) => ({ ...d, [id]: { text, saving: true } }));
    try {
      let recordId: string | undefined;
      if (write.kind === 'create') {
        const created = (await dataSource.create(objectName, write.data)) as Record<string, unknown> | undefined;
        recordId = created ? recordIdOf(created) : undefined;
        setRecords((rs) => [...(rs ?? []), { ...write.data, ...row.values, ...(created ?? {}) }]);
      } else if (write.kind === 'update') {
        await dataSource.update(objectName, write.id, write.data);
        recordId = write.id;
        setRecords((rs) => (rs ?? []).map((r) => (recordIdOf(r) === write.id ? { ...r, ...write.data } : r)));
      } else {
        await dataSource.delete(objectName, write.id);
        recordId = write.id;
        setRecords((rs) => (rs ?? []).filter((r) => recordIdOf(r) !== write.id));
      }
      setDrafts(({ [id]: _saved, ...rest }) => rest);
      notifyDataChanged({ objectName, ...(recordId ? { recordId } : {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDrafts((d) => ({ ...d, [id]: { text, error: t('timesheet.saveFailed', { message }) } }));
    }
  };

  if (loadError) {
    return (
      <DataErrorState
        data-testid="timesheet-load-error"
        className={cn('h-40', className)}
        title={t('timesheet.loadFailed')}
        message={loadError.message}
      />
    );
  }

  const today = new Date();
  return (
    <div className={cn('flex h-full w-full flex-col gap-3 overflow-auto p-2', className)} data-testid="object-timesheet">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t('timesheet.previousWeek')}
          data-testid="timesheet-prev-week"
          onClick={() => setAnchor(fromDayKey(addDays(weekStart, -7)))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" data-testid="timesheet-this-week" onClick={() => setAnchor(today)}>
          {t('timesheet.thisWeek')}
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('timesheet.nextWeek')}
          data-testid="timesheet-next-week"
          onClick={() => setAnchor(fromDayKey(addDays(weekStart, 7)))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium" data-testid="timesheet-range">
          {`${rangeFormat.format(fromDayKey(weekStart))} – ${rangeFormat.format(fromDayKey(addDays(weekStart, 6)))}`}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-1"
          data-testid="timesheet-add-row"
          onClick={() => setAdding(true)}
        >
          <Plus className="h-4 w-4" />
          {t('timesheet.addRow')}
        </Button>
      </div>

      {records === null ? (
        <Skeleton className="h-48 w-full" data-testid="timesheet-loading" />
      ) : (
        <table className="w-full border-collapse text-sm" data-testid="timesheet-table">
          <thead>
            <tr className="border-b">
              {binding.rowFields.map((f) => (
                <th key={f} scope="col" className="px-2 py-1.5 text-left font-medium">
                  {fieldLabel(f)}
                </th>
              ))}
              {days.map((day) => (
                <th key={day} scope="col" className="px-2 py-1.5 text-right font-medium" data-testid={`timesheet-day-${day}`}>
                  {dayHeading.format(fromDayKey(day))}
                </th>
              ))}
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                {t('timesheet.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.length === 0 && (
              <tr>
                <td colSpan={binding.rowFields.length + 8} className="px-2 py-6 text-center text-muted-foreground" data-testid="timesheet-empty">
                  {t('timesheet.noRows')}
                </td>
              </tr>
            )}
            {grid.rows.map((row) => {
              const name = rowName(row);
              return (
                <tr key={row.key} className="border-b" data-testid="timesheet-row">
                  {binding.rowFields.map((f) => {
                    const def = fieldDef(f);
                    const Cell = getCellRenderer(resolveCellRendererType(def));
                    return (
                      <td key={f} className="px-2 py-1">
                        <Cell value={row.values[f]} field={def} />
                      </td>
                    );
                  })}
                  {days.map((day) => {
                    const cell = row.cells[day];
                    const id = cellId(row.key, day);
                    const label = t('timesheet.cellLabel', { row: name, day: dayHeading.format(fromDayKey(day)) });
                    if (cell.records.length > 1) {
                      return (
                        <td key={day} className="px-2 py-1 text-right">
                          <span
                            className="inline-block w-full rounded px-2 py-1 text-muted-foreground"
                            title={t('timesheet.multipleRecords')}
                            aria-label={`${label}: ${numberFormat.format(cell.sum)}`}
                            data-testid="timesheet-cell-readonly"
                          >
                            {numberFormat.format(cell.sum)}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td key={day} className="px-1 py-1 text-right">
                        <TimesheetCellInput
                          label={label}
                          value={cell.records.length === 1 ? numberFormat.format(cell.sum) : ''}
                          draft={drafts[id]}
                          onDraft={(text) => setDrafts((d) => ({ ...d, [id]: { text } }))}
                          onCommit={(text) => writeCell(row, day, cell, text)}
                          onRevert={() => setDrafts(({ [id]: _reverted, ...rest }) => rest)}
                        />
                      </td>
                    );
                  })}
                  <td
                    className="px-2 py-1 text-right font-medium"
                    aria-label={t('timesheet.rowTotalLabel', { row: name })}
                    data-testid="timesheet-row-total"
                  >
                    {numberFormat.format(row.total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <th scope="row" colSpan={binding.rowFields.length} className="px-2 py-1.5 text-left">
                {t('timesheet.total')}
              </th>
              {days.map((day) => (
                <td
                  key={day}
                  className="px-2 py-1.5 text-right"
                  aria-label={t('timesheet.dayTotalLabel', { day: dayHeading.format(fromDayKey(day)) })}
                  data-testid="timesheet-day-total"
                >
                  {numberFormat.format(grid.dayTotals[day])}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right" data-testid="timesheet-week-total">
                {numberFormat.format(grid.weekTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
      {ceiling && <NonGridRowCeilingNote result={ceiling} />}

      <AddRowDialog
        open={adding}
        binding={binding}
        fieldDef={fieldDef}
        fieldLabel={fieldLabel}
        t={t}
        onCancel={() => setAdding(false)}
        onAdd={(values) => {
          setAdding(false);
          setAddedRows((rows) =>
            rows.some((r) => rowKeyOf(r, binding.rowFields) === rowKeyOf(values, binding.rowFields))
              ? rows
              : [...rows, values],
          );
        }}
      />
    </div>
  );
}

/** A row field value as plain text, for the accessible row name. */
function displayText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return String(v.name ?? v.label ?? v.title ?? v.id ?? v._id ?? '');
  }
  return String(value);
}

interface CellInputProps {
  label: string;
  value: string;
  draft?: CellDraft;
  onDraft: (text: string) => void;
  onCommit: (text: string) => void;
  onRevert: () => void;
}

function TimesheetCellInput({ label, value, draft, onDraft, onCommit, onRevert }: CellInputProps) {
  const text = draft ? draft.text : value;
  const commit = () => {
    if (draft && !draft.saving && !draft.error) onCommit(draft.text);
  };
  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={draft?.error ? true : undefined}
        aria-busy={draft?.saving ? true : undefined}
        title={draft?.error}
        data-testid="timesheet-cell"
        className={cn(
          'h-8 w-16 rounded border border-transparent bg-transparent px-2 text-right tabular-nums',
          'hover:border-input focus:border-ring focus:outline-none',
          draft?.saving && 'opacity-60',
          draft?.error && 'border-destructive text-destructive',
        )}
        value={text}
        disabled={draft?.saving}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (draft?.error) onCommit(draft.text);
            else commit();
          } else if (e.key === 'Escape') {
            onRevert();
          }
        }}
      />
      {draft?.error && (
        <span className="sr-only" role="alert" data-testid="timesheet-cell-error">
          {draft.error}
        </span>
      )}
    </>
  );
}

interface AddRowDialogProps {
  open: boolean;
  binding: TimesheetBinding;
  fieldDef: (name: string) => any;
  fieldLabel: (name: string) => string;
  t: Translate;
  onCancel: () => void;
  onAdd: (values: Record<string, unknown>) => void;
}

function AddRowDialog({ open, binding, fieldDef, fieldLabel, t, onCancel, onAdd }: AddRowDialogProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [showError, setShowError] = useState(false);
  useEffect(() => {
    if (open) {
      setValues({});
      setShowError(false);
    }
  }, [open]);
  const complete = rowValuesComplete(values, binding.rowFields);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-md" data-testid="timesheet-add-row-dialog">
        <DialogHeader>
          <DialogTitle>{t('timesheet.addRow')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {binding.rowFields.map((f) => (
            <label key={f} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{fieldLabel(f)}</span>
              <FieldEditWidget
                field={fieldDef(f) as never}
                value={values[f]}
                onChange={(v: unknown) => setValues((prev) => ({ ...prev, [f]: v }))}
              />
            </label>
          ))}
          {showError && !complete && (
            <span className="text-xs text-destructive" data-testid="timesheet-row-incomplete">
              {t('timesheet.rowIncomplete')}
            </span>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('timesheet.cancel')}
          </Button>
          <Button
            data-testid="timesheet-add-row-confirm"
            onClick={() => {
              if (!complete) {
                setShowError(true);
                return;
              }
              onAdd(values);
            }}
          >
            {t('timesheet.addRowConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
