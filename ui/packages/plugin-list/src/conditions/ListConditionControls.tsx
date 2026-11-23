/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list's filter and sort controls: what the view bar's 「Filter」 and
 * 「Sort」 open, and the condition row under the bar.
 *
 * - `FilterPanel`: the field list → that field's values → the list filters on
 *   every pick. Its footer opens the advanced panel the host passes
 *   (`renderAdvanced`, today's `FilterBuilder`), kept for 「or」 groups.
 * - `SortPanel`: the same field list with the direction on top; one click on
 *   a field adds a sort level (or sets that level's direction).
 * - `ConditionChipRow`: sort chips, then the view's own conditions as locked
 *   chips (less the ones the host draws itself, `hostDrawnFields`), then the
 *   reader's filter chips, 「+ Add filter」 and 「Reset」 (only while the host
 *   has something to reset). It draws nothing at all while there is nothing
 *   to show, so the row the host reserves for it takes no height.
 *
 * All three are controlled: they read the host's filter group and sort array
 * and hand back the next one. Nothing here stores anything or changes what a
 * filter row or a sort entry looks like. The row makes two reads, both
 * through the host's data source: the names of the records a lookup condition
 * points at (`useLookupValueNames`), so a chip says 「Account: Globex」, not
 * the record's id; and the definition of the object a view condition on a
 * related record's field reaches (`useRelatedConditionFields`), so that chip
 * says 「Account › Industry: Technology」.
 */

import * as React from 'react';
import {
  cn,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  type FilterBuilderRow,
  type FilterBuilderRowGroup,
  type SortItem,
} from '@object-ui/components';
import { referencedRecordTitle } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
import { useSafeFieldLabel } from '@object-ui/i18n';
import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter, Lock, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { FieldList, type FieldListItem } from './FieldList';
import { FilterValuePanel, isQuickRowApplied, quickDateWindowOf } from './FilterValuePanel';
import {
  addSortLevel,
  chipsAreIndependent,
  defaultQuickOperator,
  isValuelessOperator,
  newConditionId,
  quickFilterFamily,
  readViewConditions,
  relationPathOf,
  removeCondition,
  seedValueFor,
  sortWording,
  upsertCondition,
  type ConditionField,
  type ViewConditionChip,
} from './conditionModel';
import { quickDateWindowLabel, quickOperatorLabel, useListConditionTranslation } from './conditionTranslations';

type Translate = ReturnType<typeof useListConditionTranslation>['t'];

const POPOVER_CLASS = 'w-auto p-0';

// ---------------------------------------------------------------------------
// Chip wording
// ---------------------------------------------------------------------------

function optionLabel(field: ConditionField | undefined, raw: unknown): string {
  const hit = field?.options?.find((o) => String(o.value) === String(raw));
  return hit ? hit.label : String(raw);
}

/** The name of the record a lookup value points at, or `undefined` while it is not read. */
export type LookupValueName = (field: string, id: string) => string | undefined;

/**
 * The value half of a chip: 「Negotiation, Proposal」, 「≥ 100」, 「Today」.
 * A lookup's value is the referenced record's name when `nameOf` has it, and
 * its id only when the name cannot be read.
 */
export function describeConditionValue(
  field: ConditionField | undefined,
  operator: string,
  value: unknown,
  t: Translate,
  nameOf?: LookupValueName,
): string {
  const opLabel = quickOperatorLabel(operator, t);
  if (isValuelessOperator(operator)) return opLabel;
  const family = quickFilterFamily(field);
  const joiner = t('listConditions.chips.listJoiner');
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  let text: string;
  // A named window says what it is on its own: 「Today」, not 「between Today」.
  const window = family === 'date' && operator === 'between' ? quickDateWindowOf(value as FilterBuilderRow['value']) : undefined;
  if (window) return quickDateWindowLabel(window, t);
  if (family === 'boolean') {
    text = list.map((v) => (v === true || v === 'true' ? t('listConditions.filter.yes') : t('listConditions.filter.no'))).join(joiner);
  } else if (operator === 'between') {
    text = list.map(String).join(' – ');
  } else if (family === 'option') {
    text = list.map((v) => optionLabel(field, v)).join(joiner);
  } else if (family === 'lookup' && field && nameOf) {
    text = list.map((v) => nameOf(field.value, String(v)) ?? String(v)).join(joiner);
  } else {
    text = list.map(String).join(joiner);
  }
  // 「is any of」 is what a value list means on its own; every other operator is
  // named, and with no value it is the operator alone, never one with a trailing space.
  if (operator === 'in' || (operator === 'equals' && (family === 'option' || family === 'boolean'))) return text;
  return text ? `${opLabel} ${text}` : opLabel;
}

function chipText(
  field: ConditionField | undefined,
  fieldName: string | undefined,
  operator: string,
  value: unknown,
  t: Translate,
  nameOf?: LookupValueName,
) {
  return t('listConditions.chips.pattern', {
    field: field?.label ?? fieldName ?? '',
    value: describeConditionValue(field, operator, value, t, nameOf),
  });
}

function viewChipText(
  chip: ViewConditionChip,
  fields: ReadonlyArray<ConditionField>,
  t: Translate,
  nameOf?: LookupValueName,
  relatedFieldOf?: RelatedFieldOf,
): string {
  if (chip.anyOf) {
    return chip.anyOf.map((member) => viewChipText(member, fields, t, nameOf, relatedFieldOf)).join(t('listConditions.chips.or'));
  }
  if (!chip.field || !chip.operator) return t('listConditions.chips.viewFilter');
  const path = relationPathOf(chip.field);
  if (path) {
    // A related record's field: 「Account › Industry: Technology」, each name
    // its label where one is known and its raw name where none is. No record
    // name is read for it (`nameOf` names the list's own lookups only).
    const related = relatedFieldOf?.(chip.field);
    const label = t('listConditions.chips.relationPath', {
      lookup: fields.find((f) => f.value === path.lookup)?.label ?? path.lookup,
      field: related?.label ?? path.field,
    });
    return t('listConditions.chips.pattern', {
      field: label,
      value: describeConditionValue(related, chip.operator, chip.value, t),
    });
  }
  const field = fields.find((f) => f.value === chip.field);
  return chipText(field, chip.field, chip.operator, chip.value, t, nameOf);
}

// ---------------------------------------------------------------------------
// Related fields
// ---------------------------------------------------------------------------

/** A related record's field, by its chip path `<lookup>.<field>`, or `undefined` while it is not read. */
export type RelatedFieldOf = (path: string) => ConditionField | undefined;

/** The value of a declared option (an array of `{ value, label }` or a keyed object) and its declared label. */
function declaredOptions(raw: unknown): Array<{ value: string; label: string }> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (Array.isArray(raw)) {
    return raw.map((o) => {
      const value = o && typeof o === 'object' ? (o as { value?: unknown }).value : o;
      const label = o && typeof o === 'object' ? (o as { label?: unknown }).label : undefined;
      return { value: String(value), label: typeof label === 'string' && label ? label : String(value) };
    });
  }
  return Object.entries(raw as Record<string, unknown>).map(([value, meta]) => {
    const label = meta && typeof meta === 'object' ? (meta as { label?: unknown }).label : undefined;
    return { value, label: typeof label === 'string' && label ? label : value };
  });
}

/**
 * The related fields the view's relation-path chips name (`<lookup>.<field>`),
 * read from the definition of the object each lookup points at
 * (`referenceTo`) through the host's data source: one definition read per
 * target, again only when the targets change. The field's label and its
 * options' labels are translated as the list translates its own fields
 * (`fields.<object>.<field>`, `fieldOptions.<object>.<field>.<value>`), with
 * the declared label, then the raw name, as the fallback.
 *
 * Keyed on the targets it reads, never on the identity of the arrays the host
 * rebuilds every render (`ui/AGENTS.md` #10). A read that fails answers
 * `undefined`: the chip keeps the raw names.
 */
export function useRelatedConditionFields(
  dataSource: Pick<DataSource, 'getObjectSchema'> | null | undefined,
  fields: ReadonlyArray<ConditionField>,
  conditions: ReadonlyArray<NamedCondition>,
): RelatedFieldOf {
  const { fieldLabel, translateOptions } = useSafeFieldLabel();
  const wanted = new Set<string>();
  for (const condition of conditions) {
    const path = relationPathOf(condition.field);
    const target = path ? fields.find((f) => f.value === path.lookup)?.referenceTo : undefined;
    if (target) wanted.add(target);
  }
  const readKey = JSON.stringify([...wanted].sort());

  const [read, setRead] = React.useState<{ key: string; defs: ReadonlyMap<string, unknown> } | null>(null);

  React.useEffect(() => {
    const targets = JSON.parse(readKey) as string[];
    if (targets.length === 0 || !dataSource || typeof dataSource.getObjectSchema !== 'function') return;
    let cancelled = false;
    void Promise.all(
      targets.map(async (target) => {
        try {
          return [target, await dataSource.getObjectSchema(target)] as const;
        } catch {
          // The chip keeps the raw names: the labels are a courtesy, the condition still filters.
          return [target, undefined] as const;
        }
      }),
    ).then((answers) => {
      if (!cancelled) setRead({ key: readKey, defs: new Map(answers) });
    });
    return () => {
      cancelled = true;
    };
  }, [dataSource, readKey]);

  const defs = read?.key === readKey ? read.defs : undefined;
  return React.useCallback<RelatedFieldOf>(
    (chipField) => {
      const path = relationPathOf(chipField);
      const target = path ? fields.find((f) => f.value === path.lookup)?.referenceTo : undefined;
      if (!path || !target) return undefined;
      const def = defs?.get(target) as { fields?: Record<string, { label?: unknown; type?: unknown; multiple?: unknown; options?: unknown }> } | undefined;
      const declared = def?.fields?.[path.field];
      if (!declared) return undefined;
      const label = typeof declared.label === 'string' && declared.label ? declared.label : path.field;
      const options = declaredOptions(declared.options);
      return {
        value: path.field,
        label: fieldLabel(target, path.field, label),
        type: typeof declared.type === 'string' ? declared.type : 'text',
        multiple: declared.multiple === true,
        ...(options ? { options: translateOptions(target, path.field, options) } : {}),
      };
    },
    [defs, fields, fieldLabel, translateOptions],
  );
}

// ---------------------------------------------------------------------------
// Lookup names
// ---------------------------------------------------------------------------

/** One condition as the name read sees it: a field and the value it compares. */
export interface NamedCondition {
  field?: string;
  operator?: string;
  value?: unknown;
}

function lookupIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((v): v is string | number => (typeof v === 'string' && v !== '') || typeof v === 'number')
    .map(String);
}

/**
 * The names of the records the lookup conditions on screen point at, read
 * the way the lookup value picker reads them: the target's records by id
 * through the host's data source, named by the lookup's `displayField`, else
 * the target's own name field (`referencedRecordTitle`). One record read and
 * one definition read per target, again only when the ids change.
 *
 * Keyed on what it reads (targets and ids), never on the identity of the
 * arrays the host rebuilds every render (`ui/AGENTS.md` #10). A read that
 * fails, or a record nothing names, answers `undefined`: the chip keeps the id.
 */
export function useLookupValueNames(
  dataSource: Pick<DataSource, 'find' | 'getObjectSchema'> | null | undefined,
  fields: ReadonlyArray<ConditionField>,
  conditions: ReadonlyArray<NamedCondition>,
): LookupValueName {
  const wanted = new Map<string, Set<string>>();
  for (const condition of conditions) {
    if (!condition.field || !condition.operator || isValuelessOperator(condition.operator)) continue;
    const field = fields.find((f) => f.value === condition.field);
    if (!field?.referenceTo || quickFilterFamily(field) !== 'lookup') continue;
    const ids = lookupIds(condition.value);
    if (ids.length === 0) continue;
    const held = wanted.get(field.referenceTo) ?? new Set<string>();
    for (const id of ids) held.add(id);
    wanted.set(field.referenceTo, held);
  }
  const readKey = JSON.stringify(
    [...wanted.entries()].map(([target, ids]) => [target, [...ids].sort()] as const).sort(([a], [b]) => a.localeCompare(b)),
  );

  const [read, setRead] = React.useState<{
    key: string;
    byTarget: ReadonlyMap<string, { def: unknown; records: ReadonlyMap<string, Record<string, unknown>> }>;
  } | null>(null);

  React.useEffect(() => {
    const targets = JSON.parse(readKey) as Array<[string, string[]]>;
    if (targets.length === 0 || !dataSource || typeof dataSource.find !== 'function') return;
    let cancelled = false;
    void Promise.all(
      targets.map(async ([target, ids]) => {
        let def: unknown;
        if (typeof dataSource.getObjectSchema === 'function') {
          try {
            def = await dataSource.getObjectSchema(target);
          } catch {
            def = undefined;
          }
        }
        const records = new Map<string, Record<string, unknown>>();
        try {
          const result = await dataSource.find(target, { $top: ids.length, $filter: { id: { $in: ids } } });
          for (const record of Array.isArray(result?.data) ? result.data : []) {
            const id = (record as Record<string, unknown> | null)?.id;
            if (id !== undefined && id !== null) records.set(String(id), record as Record<string, unknown>);
          }
        } catch {
          // The chip keeps the id: the name is a courtesy, the condition still filters.
        }
        return [target, { def, records }] as const;
      }),
    ).then((answers) => {
      if (!cancelled) setRead({ key: readKey, byTarget: new Map(answers) });
    });
    return () => {
      cancelled = true;
    };
  }, [dataSource, readKey]);

  const byTarget = read?.key === readKey ? read.byTarget : undefined;
  return React.useCallback<LookupValueName>(
    (fieldName, id) => {
      const field = fields.find((f) => f.value === fieldName);
      const answer = field?.referenceTo ? byTarget?.get(field.referenceTo) : undefined;
      const record = answer?.records.get(id);
      return answer && record ? referencedRecordTitle(answer.def, record, field?.displayField) : undefined;
    },
    [byTarget, fields],
  );
}

/** The words for one sort direction on a field of `type`: time, size or the alphabet. */
export function sortDirectionLabel(type: string | undefined, order: 'asc' | 'desc', t: Translate): string {
  switch (sortWording(type)) {
    case 'time':
      return order === 'asc' ? t('listConditions.sort.time_asc') : t('listConditions.sort.time_desc');
    case 'size':
      return order === 'asc' ? t('listConditions.sort.size_asc') : t('listConditions.sort.size_desc');
    default:
      return order === 'asc' ? t('listConditions.sort.alphabet_asc') : t('listConditions.sort.alphabet_desc');
  }
}

// ---------------------------------------------------------------------------
// FilterPanel
// ---------------------------------------------------------------------------

export interface FilterPanelProps {
  fields: ReadonlyArray<ConditionField>;
  /** The fields the view shows, in column order. */
  shownFields?: ReadonlyArray<string>;
  value: FilterBuilderRowGroup;
  onChange: (next: FilterBuilderRowGroup) => void;
  /** The advanced (multi-condition) panel, drawn by the host. */
  renderAdvanced: () => React.ReactNode;
  /** Open on this row's values instead of the field list. */
  conditionId?: string;
  /**
   * The field list's footer opens the advanced panel (the default). `false`
   * (the phone's panel, objectstack#35884, which does not edit advanced
   * filters): no footer.
   */
  advancedOffered?: boolean;
  testId?: string;
}

type FilterStep = { kind: 'fields' } | { kind: 'values'; row: FilterBuilderRow } | { kind: 'advanced' };

export function FilterPanel({
  fields,
  shownFields,
  value,
  onChange,
  renderAdvanced,
  conditionId,
  advancedOffered = true,
  testId = 'filter-panel',
}: FilterPanelProps) {
  const { t } = useListConditionTranslation();
  const rows = value.conditions ?? [];
  const [step, setStep] = React.useState<FilterStep>(() => {
    if (!chipsAreIndependent(value)) return { kind: 'advanced' };
    const row = conditionId ? rows.find((c) => c.id === conditionId) : undefined;
    return row ? { kind: 'values', row } : { kind: 'fields' };
  });

  // The rows the group holds are written as the values change, and only once
  // they filter: an unfinished row is held here, never handed to the host.
  const commit = (row: FilterBuilderRow) => {
    setStep({ kind: 'values', row });
    const held = rows.some((c) => c.id === row.id);
    if (isQuickRowApplied(row)) onChange(upsertCondition(value, row));
    else if (held) onChange(removeCondition(value, row.id));
  };

  const pickField = (item: FieldListItem) => {
    const field = fields.find((f) => f.value === item.value);
    const existing = rows.find((c) => c.field === item.value);
    if (existing) {
      setStep({ kind: 'values', row: existing });
      return;
    }
    const operator = defaultQuickOperator(field);
    const row: FilterBuilderRow = { id: newConditionId(), field: item.value, operator, value: seedValueFor(operator, undefined) };
    if (isValuelessOperator(operator)) commit(row);
    else setStep({ kind: 'values', row });
  };

  if (step.kind === 'advanced') {
    return (
      <div className="w-[calc(100vw-2rem)] max-w-[600px] p-3 sm:w-[600px] sm:p-4" data-testid={`${testId}-advanced`}>
        {renderAdvanced()}
      </div>
    );
  }

  if (step.kind === 'values') {
    const field = fields.find((f) => f.value === step.row.field) ?? { value: step.row.field, label: step.row.field };
    return (
      <FilterValuePanel
        field={field}
        row={step.row}
        onChange={commit}
        onBack={conditionId ? undefined : () => setStep({ kind: 'fields' })}
        testId={`${testId}-values`}
      />
    );
  }

  return (
    <FieldList
      fields={fields.filter((f) => !f.disabled)}
      shownFields={shownFields}
      onPick={pickField}
      testId={`${testId}-fields`}
      footer={advancedOffered ? (
        <button
          type="button"
          onClick={() => setStep({ kind: 'advanced' })}
          className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid={`${testId}-open-advanced`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          {t('listConditions.filter.advanced')}
        </button>
      ) : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// SortPanel
// ---------------------------------------------------------------------------

export interface SortPanelProps {
  fields: ReadonlyArray<ConditionField>;
  shownFields?: ReadonlyArray<string>;
  value: ReadonlyArray<SortItem>;
  onChange: (next: SortItem[]) => void;
  /** Called after a field is picked: the host closes its popover. */
  onDone?: () => void;
  /** A row under the field list (the host's note on fields it cannot sort by). */
  footer?: React.ReactNode;
  /**
   * Every sort level in one panel, drawn by the host (today's `SortBuilder`),
   * behind the field list's footer, as the filter panel's advanced step.
   */
  renderAdvanced?: () => React.ReactNode;
  testId?: string;
}

export function SortPanel({
  fields,
  shownFields,
  value,
  onChange,
  onDone,
  footer,
  renderAdvanced,
  testId = 'sort-panel',
}: SortPanelProps) {
  const { t } = useListConditionTranslation();
  const [order, setOrder] = React.useState<'asc' | 'desc'>('asc');
  const [advanced, setAdvanced] = React.useState(false);
  if (advanced && renderAdvanced) {
    return (
      <div className="w-[calc(100vw-2rem)] max-w-[600px] p-3 sm:w-[600px] sm:p-4" data-testid={`${testId}-advanced`}>
        {renderAdvanced()}
      </div>
    );
  }
  const header = (
    <div className="flex gap-1 border-b p-1.5" role="radiogroup" aria-label={t('listConditions.sort.direction')}>
      {(['asc', 'desc'] as const).map((dir) => (
        <button
          key={dir}
          type="button"
          role="radio"
          aria-checked={order === dir}
          onClick={() => setOrder(dir)}
          className={cn(
            'flex h-7 flex-1 items-center justify-center gap-1 rounded-sm text-sm text-muted-foreground hover:bg-accent',
            order === dir && 'bg-accent font-medium text-foreground',
          )}
          data-testid={`${testId}-order-${dir}`}
        >
          {dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />}
          {dir === 'asc' ? t('listConditions.sort.ascending') : t('listConditions.sort.descending')}
        </button>
      ))}
    </div>
  );
  return (
    <FieldList
      fields={fields}
      shownFields={shownFields}
      header={header}
      footer={
        footer || renderAdvanced ? (
          <>
            {footer}
            {renderAdvanced && (
              <button
                type="button"
                onClick={() => setAdvanced(true)}
                className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                data-testid={`${testId}-open-advanced`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                {t('listConditions.sort.advanced')}
              </button>
            )}
          </>
        ) : undefined
      }
      testId={`${testId}-fields`}
      onPick={(item) => {
        onChange(addSortLevel(value, item.value, order, newConditionId()));
        onDone?.();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// ConditionChipRow
// ---------------------------------------------------------------------------

export interface ConditionChipRowProps {
  sort: ReadonlyArray<SortItem>;
  sortFields: ReadonlyArray<ConditionField>;
  /**
   * Kept for hosts that pass it; the row writes no sort itself since
   * objectstack#35878 — its one sort chip opens `renderSortPanel`, which writes.
   */
  onSortChange?: (next: SortItem[]) => void;
  filters: FilterBuilderRowGroup;
  filterFields: ReadonlyArray<ConditionField>;
  onFiltersChange: (next: FilterBuilderRowGroup) => void;
  /** The view's own filter, drawn as locked chips. */
  viewFilter?: unknown;
  /**
   * Fields whose conditions in `viewFilter` the HOST draws itself (the data
   * page's 「Filtered by」 tags for its address conditions): they still filter,
   * and the row draws no locked chip for them, so each condition shows once.
   */
  hostDrawnFields?: ReadonlyArray<string>;
  /** Where the names of the records a lookup condition points at are read. */
  dataSource?: Pick<DataSource, 'find' | 'getObjectSchema'> | null;
  shownFields?: ReadonlyArray<string>;
  renderAdvanced: () => React.ReactNode;
  /**
   * Every sort level in one panel, drawn by the host (the Sort panel's
   * 「all sort levels」 step): a sort chip opens it (objectstack#35876). The
   * chip itself never changes the sort.
   */
  renderSortLevels: () => React.ReactNode;
  /**
   * Back to the view as saved. Drawn only when passed: the host passes it
   * only while the reader has something of their own to reset.
   */
  onReset?: () => void;
  /** Extra chips the host draws after the filter chips (its own quick filters). */
  trailing?: React.ReactNode;
  /**
   * The sort panel the one sort chip (or, with no sort, the 「Sort」 button)
   * opens (objectstack#35878), as a function of the call that closes it.
   * Absent ⇒ no sort chip and no 「Sort」 button: the row draws the filter
   * half only.
   */
  renderSortPanel?: (close: () => void) => React.ReactNode;
  /**
   * The host's end of the row (objectstack#35878: 「Personalized · Reset」),
   * drawn at the right in place of the row's own 「Reset」.
   */
  end?: React.ReactNode;
  /** The reader may add a filter (`userActions.filter`); `false` ⇒ no 「Filter」 and no 「+」. */
  filterOffered?: boolean;
  /**
   * objectstack#35892 — where the row may be narrow (a record page's related
   * tab, in a drawer too): below 28rem of the row's own width the 「Sort」 and
   * 「Filter」 buttons and the sort chip keep their icon alone, named by their
   * `aria-label` and `title`.
   */
  collapsibleLabels?: boolean;
  className?: string;
}

const CHIP_CLASS =
  'inline-flex h-6 max-w-[280px] shrink-0 items-center gap-1 rounded-md border px-2 text-sm leading-none';

/**
 * A control of the condition row below `sm`: 44 px on both sides (WCAG 2.5.5),
 * as the bar's Filter and Sort triggers were before they moved here
 * (objectstack#35878).
 */
const ROW_TOUCH_TARGET = 'max-sm:h-11 max-sm:min-w-11';

/** 「Sort」, 「Filter」 and 「+」 before anything is set: dashed, so they do not read as a condition in force. */
const EMPTY_BUTTON_CLASS =
  'max-sm:h-11 max-sm:min-w-11 inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed px-2 text-sm leading-none text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ConditionChipRow({
  sort,
  sortFields,
  filters,
  filterFields,
  onFiltersChange,
  viewFilter,
  hostDrawnFields,
  dataSource,
  shownFields,
  renderAdvanced,
  renderSortLevels,
  onReset,
  trailing,
  renderSortPanel,
  end,
  filterOffered = true,
  collapsibleLabels = false,
  className,
}: ConditionChipRowProps) {
  const { t } = useListConditionTranslation();
  const [openChip, setOpenChip] = React.useState<string | null>(null);

  // Keyed on the names, not on the array the host may rebuild every render.
  const hostDrawnKey = (hostDrawnFields ?? []).join('\u0000');
  const viewChips = React.useMemo(() => {
    const hostDrawn = new Set(hostDrawnKey ? hostDrawnKey.split('\u0000') : []);
    return readViewConditions(viewFilter).filter((chip) => !(chip.field && hostDrawn.has(chip.field)));
  }, [viewFilter, hostDrawnKey]);
  const appliedRows = (filters.conditions ?? []).filter(isQuickRowApplied);
  const namedConditions = [
    ...viewChips.flatMap((chip) => (chip.anyOf ? chip.anyOf : [chip])),
    ...appliedRows,
  ];
  const nameOf = useLookupValueNames(dataSource, filterFields, namedConditions);
  const relatedFieldOf = useRelatedConditionFields(dataSource, filterFields, namedConditions);
  const independent = chipsAreIndependent(filters);
  // Nothing to show and nothing to offer: the row the host reserves stays empty.
  if (!renderSortPanel && !filterOffered && !end && !trailing && sort.length === 0 && viewChips.length === 0 && appliedRows.length === 0) {
    return null;
  }

  const fieldOf = (list: ReadonlyArray<ConditionField>, name: string) => list.find((f) => f.value === name);
  // objectstack#35892 — under `collapsibleLabels`, a button's words go below
  // 28rem of the row's width (the row is its own container, `@container/conditions`).
  const collapsingLabel = collapsibleLabels ? 'hidden @[28rem]/conditions:inline' : undefined;
  const sortChipName = sort.length > 0
    ? t('listConditions.chips.sortedBy', { field: fieldOf(sortFields, sort[0].field)?.label ?? sort[0].field })
    : t('listConditions.chips.sort');

  const filterPopover = (key: string, trigger: React.ReactNode, conditionId?: string) => (
    <Popover key={key} open={openChip === key} onOpenChange={(open) => setOpenChip(open ? key : null)}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className={POPOVER_CLASS} data-testid={`condition-popover-${key}`}>
        <FilterPanel
          fields={filterFields}
          shownFields={shownFields}
          value={filters}
          onChange={onFiltersChange}
          renderAdvanced={renderAdvanced}
          conditionId={conditionId}
          // The add-a-filter panel is the list's Filter panel (it was the
          // bar's Filter popover before objectstack#35878): its own id.
          testId={key === 'add' ? undefined : `condition-panel-${key}`}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div
      role="group"
      aria-label={t('listConditions.chips.region')}
      // One line at every width: what does not fit scrolls sideways
      // (objectstack#35878).
      className={cn(
        'flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto',
        collapsibleLabels && '@container/conditions',
        className,
      )}
      data-testid="condition-chips"
    >
      {/* objectstack#35878 — the sort, at any number of levels, is ONE chip:
          「Sorted by X」, 「+N」 for the levels after the first. With no sort
          it is the dashed 「Sort」 button, which opens the sort panel; the
          chip opens every level at once (objectstack#35876). */}
      {renderSortPanel && (
        <Popover open={openChip === 'sort'} onOpenChange={(open) => setOpenChip(open ? 'sort' : null)}>
          <PopoverTrigger asChild>
            {sort.length > 0 ? (
              <button
                type="button"
                className={cn(CHIP_CLASS, ROW_TOUCH_TARGET, 'border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10')}
                data-testid="condition-sort"
                data-levels={sort.length}
                {...(collapsibleLabels ? { 'aria-label': sortChipName, title: sortChipName } : {})}
              >
                <ArrowUpDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className={cn('truncate', collapsingLabel)}>
                  {sortChipName}
                </span>
                {sort.length > 1 && (
                  <span className="rounded bg-muted px-1 text-xs tabular-nums text-muted-foreground" data-testid="sort-chip-more">
                    +{sort.length - 1}
                  </span>
                )}
              </button>
            ) : (
              <button
                type="button"
                className={EMPTY_BUTTON_CLASS}
                data-testid="condition-sort"
                data-levels={0}
                {...(collapsibleLabels ? { 'aria-label': sortChipName, title: sortChipName } : {})}
              >
                <ArrowUpDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className={collapsingLabel}>{t('listConditions.chips.sort')}</span>
              </button>
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className={POPOVER_CLASS} data-testid="condition-popover-sort">
            {sort.length > 0 ? (
              // objectstack#35876 — a sort in force opens every level in one
              // panel; the chip never flips a direction itself.
              <div className="w-[calc(100vw-2rem)] max-w-[600px] p-3 sm:w-[600px] sm:p-4" data-testid="sort-chip-panel">
                {renderSortLevels()}
              </div>
            ) : (
              renderSortPanel(() => setOpenChip(null))
            )}
          </PopoverContent>
        </Popover>
      )}

      {viewChips.map((chip) => {
        const text = viewChipText(chip, filterFields, t, nameOf, relatedFieldOf);
        return (
          <span
            key={chip.key}
            className={cn(CHIP_CLASS, 'border-dashed bg-muted/60 text-muted-foreground')}
            title={t('listConditions.chips.viewOwn')}
            aria-label={`${text} · ${t('listConditions.chips.viewOwn')}`}
            data-testid="view-condition-chip"
            data-locked="true"
            data-field={chip.field}
          >
            <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{text}</span>
          </span>
        );
      })}

      {independent
        ? appliedRows.map((row) => {
            const field = fieldOf(filterFields, row.field);
            const text = chipText(field, row.field, row.operator, row.value, t, nameOf);
            return (
              <span
                key={row.id}
                className={cn(CHIP_CLASS, 'bg-background text-foreground')}
                data-testid={`filter-chip-${row.field}`}
              >
                {filterPopover(
                  row.id,
                  <button type="button" className="min-w-0 truncate" data-testid={`filter-chip-open-${row.field}`}>
                    {text}
                  </button>,
                  row.id,
                )}
                <button
                  type="button"
                  className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => onFiltersChange(removeCondition(filters, row.id))}
                  aria-label={t('listConditions.chips.remove', { label: text })}
                  data-testid={`filter-chip-remove-${row.field}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            );
          })
        : appliedRows.length > 0 && (
            <span className={cn(CHIP_CLASS, 'bg-background text-foreground')} data-testid="filter-chip-advanced">
              {filterPopover(
                'advanced',
                <button type="button" className="min-w-0 truncate" data-testid="filter-chip-open-advanced">
                  {t('listConditions.filter.advanced')}
                  <span className="ml-1 tabular-nums text-muted-foreground">{appliedRows.length}</span>
                </button>,
              )}
              <button
                type="button"
                className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => onFiltersChange({ ...filters, conditions: [] })}
                aria-label={t('listConditions.chips.remove', { label: t('listConditions.filter.advanced') })}
                data-testid="filter-chip-remove-advanced"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          )}

      {trailing}

      {/* With no filter of the reader's own, the dashed 「Filter」 button; with
          one, a 「+」 after the chips (objectstack#35878). Either opens the
          field list. */}
      {filterOffered && filterPopover(
        'add',
        appliedRows.length === 0 ? (
          <button
            type="button"
            className={EMPTY_BUTTON_CLASS}
            data-testid="condition-add-filter"
            data-empty="true"
            {...(collapsibleLabels ? { 'aria-label': t('listConditions.chips.filter'), title: t('listConditions.chips.filter') } : {})}
          >
            <ListFilter className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className={collapsingLabel}>{t('listConditions.chips.filter')}</span>
          </button>
        ) : (
          <button
            type="button"
            className={cn(EMPTY_BUTTON_CLASS, 'w-6 justify-center px-0')}
            aria-label={t('listConditions.chips.addFilter')}
            title={t('listConditions.chips.addFilter')}
            data-testid="condition-add-filter"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </button>
        ),
      )}

      {end ? (
        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2" data-testid="condition-row-end">{end}</div>
      ) : onReset && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6 shrink-0 gap-1 px-1.5 text-sm text-muted-foreground"
          onClick={onReset}
          title={t('listConditions.chips.resetHint')}
          data-testid="condition-reset"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          {t('listConditions.chips.reset')}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConditionDiscardButton
// ---------------------------------------------------------------------------

export interface ConditionDiscardButtonProps {
  onDiscard: () => void;
  /** The button's text; defaults to 「Discard」. */
  label?: string;
  /** The button's tooltip; defaults to 「Back to the default sort and filter」. */
  title?: string;
  'data-testid'?: string;
  className?: string;
}

/**
 * 「Discard」 (objectstack#35892): the list page's, beside its Save
 * (objectstack#35955), and a record page's related tab's, at its condition
 * row's end, where there is no Save. One ghost button in the row's size, so
 * both read as one control; a host draws it only while there is something to
 * discard.
 */
export function ConditionDiscardButton({
  onDiscard,
  label,
  title,
  'data-testid': testId = 'condition-discard',
  className,
}: ConditionDiscardButtonProps) {
  const { t } = useListConditionTranslation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-6 shrink-0 gap-1 px-1.5 text-sm font-normal text-muted-foreground shadow-none', className)}
      onClick={onDiscard}
      title={title ?? t('listConditions.chips.discardHint')}
      data-testid={testId}
    >
      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
      {label ?? t('listConditions.chips.discard')}
    </Button>
  );
}
