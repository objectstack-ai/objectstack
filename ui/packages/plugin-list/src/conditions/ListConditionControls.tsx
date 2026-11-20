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
 *   chips, then the reader's filter chips, 「+ Add filter」 and 「Reset」. It
 *   draws nothing at all while there is nothing to show, so the row the host
 *   reserves for it takes no height.
 *
 * All three are controlled: they read the host's filter group and sort array
 * and hand back the next one. Nothing here stores anything or changes what a
 * filter row or a sort entry looks like.
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
import { ArrowDown, ArrowUp, Lock, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { FieldList, type FieldListItem } from './FieldList';
import { FilterValuePanel, isQuickRowApplied, quickDateWindowOf } from './FilterValuePanel';
import {
  addSortLevel,
  chipsAreIndependent,
  defaultQuickOperator,
  isValuelessOperator,
  moveSortItem,
  newConditionId,
  quickFilterFamily,
  readViewConditions,
  removeCondition,
  seedValueFor,
  sortWording,
  toggleSortOrder,
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

/** The value half of a chip: 「Negotiation, Proposal」, 「≥ 100」, 「Today」. */
export function describeConditionValue(
  field: ConditionField | undefined,
  operator: string,
  value: unknown,
  t: Translate,
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
  } else {
    text = list.map(String).join(joiner);
  }
  // 「is any of」 is what a value list means on its own; every other operator is named.
  return operator === 'in' || (operator === 'equals' && (family === 'option' || family === 'boolean'))
    ? text
    : `${opLabel} ${text}`;
}

function chipText(field: ConditionField | undefined, fieldName: string | undefined, operator: string, value: unknown, t: Translate) {
  return t('listConditions.chips.pattern', {
    field: field?.label ?? fieldName ?? '',
    value: describeConditionValue(field, operator, value, t),
  });
}

function viewChipText(chip: ViewConditionChip, fields: ReadonlyArray<ConditionField>, t: Translate): string {
  if (chip.anyOf) return chip.anyOf.map((member) => viewChipText(member, fields, t)).join(t('listConditions.chips.or'));
  if (!chip.field || !chip.operator) return t('listConditions.chips.viewFilter');
  const field = fields.find((f) => f.value === chip.field);
  return chipText(field, chip.field, chip.operator, chip.value, t);
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
      footer={
        <button
          type="button"
          onClick={() => setStep({ kind: 'advanced' })}
          className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid={`${testId}-open-advanced`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          {t('listConditions.filter.advanced')}
        </button>
      }
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
            'flex h-7 flex-1 items-center justify-center gap-1 rounded-sm text-[13px] text-muted-foreground hover:bg-accent',
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
                className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
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
  onSortChange: (next: SortItem[]) => void;
  filters: FilterBuilderRowGroup;
  filterFields: ReadonlyArray<ConditionField>;
  onFiltersChange: (next: FilterBuilderRowGroup) => void;
  /** The view's own filter, drawn as locked chips. */
  viewFilter?: unknown;
  shownFields?: ReadonlyArray<string>;
  renderAdvanced: () => React.ReactNode;
  /** Back to the view as saved. Drawn only when passed. */
  onReset?: () => void;
  /** The list on screen is the view's own: 「Reset」 is drawn but disabled. */
  resetDisabled?: boolean;
  /** Extra chips the host draws after the filter chips (its own quick filters). */
  trailing?: React.ReactNode;
  className?: string;
}

const CHIP_CLASS =
  'inline-flex h-6 max-w-[280px] shrink-0 items-center gap-1 rounded-full border px-2 text-[13px] leading-none';

export function ConditionChipRow({
  sort,
  sortFields,
  onSortChange,
  filters,
  filterFields,
  onFiltersChange,
  viewFilter,
  shownFields,
  renderAdvanced,
  onReset,
  resetDisabled,
  trailing,
  className,
}: ConditionChipRowProps) {
  const { t } = useListConditionTranslation();
  const [openChip, setOpenChip] = React.useState<string | null>(null);
  const dragFrom = React.useRef<number | null>(null);

  const viewChips = React.useMemo(() => readViewConditions(viewFilter), [viewFilter]);
  const appliedRows = (filters.conditions ?? []).filter(isQuickRowApplied);
  const independent = chipsAreIndependent(filters);
  const hasChips = sort.length > 0 || viewChips.length > 0 || appliedRows.length > 0 || !!trailing;
  if (!hasChips) return null;

  const fieldOf = (list: ReadonlyArray<ConditionField>, name: string) => list.find((f) => f.value === name);

  const moveSort = (from: number, to: number) => onSortChange(moveSortItem(sort, from, to));

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
          testId={`condition-panel-${key}`}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div
      role="group"
      aria-label={t('listConditions.chips.region')}
      className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-1.5', className)}
      data-testid="condition-chips"
    >
      {sort.map((item, index) => {
        const field = fieldOf(sortFields, item.field);
        const label = field?.label ?? item.field;
        const direction = sortDirectionLabel(field?.type, item.order === 'desc' ? 'desc' : 'asc', t);
        const Arrow = item.order === 'desc' ? ArrowDown : ArrowUp;
        return (
          <span
            key={item.id}
            className={cn(CHIP_CLASS, 'cursor-grab border-primary/30 bg-primary/5 text-foreground')}
            draggable={sort.length > 1}
            title={sort.length > 1 ? t('listConditions.chips.dragSort') : undefined}
            onDragStart={(event) => {
              dragFrom.current = index;
              event.dataTransfer?.setData('text/plain', String(index));
            }}
            onDragOver={(event) => {
              if (dragFrom.current !== null) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragFrom.current !== null) moveSort(dragFrom.current, index);
              dragFrom.current = null;
            }}
            onDragEnd={() => {
              dragFrom.current = null;
            }}
            data-testid={`sort-chip-${item.field}`}
            data-order={item.order}
            data-priority={index + 1}
          >
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1"
              onClick={() => onSortChange(toggleSortOrder(sort, item.id))}
              onKeyDown={(event) => {
                if (!event.altKey) return;
                if (event.key === 'ArrowLeft' && index > 0) {
                  event.preventDefault();
                  moveSort(index, index - 1);
                } else if (event.key === 'ArrowRight' && index < sort.length - 1) {
                  event.preventDefault();
                  moveSort(index, index + 1);
                }
              }}
              aria-label={t('listConditions.chips.toggleSort', { label: `${label} ${direction}` })}
              title={direction}
              data-testid={`sort-chip-toggle-${item.field}`}
            >
              <Arrow className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
            <button
              type="button"
              className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => onSortChange(sort.filter((s) => s.id !== item.id))}
              aria-label={t('listConditions.chips.remove', { label })}
              data-testid={`sort-chip-remove-${item.field}`}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        );
      })}

      {viewChips.map((chip) => {
        const text = viewChipText(chip, filterFields, t);
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
            const text = chipText(field, row.field, row.operator, row.value, t);
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

      {filterPopover(
        'add',
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-1.5 text-[13px] text-muted-foreground"
          data-testid="condition-add-filter"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          {t('listConditions.chips.addFilter')}
        </Button>,
      )}

      {onReset && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6 shrink-0 gap-1 px-1.5 text-[13px] text-muted-foreground"
          onClick={onReset}
          disabled={resetDisabled}
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
