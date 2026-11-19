/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The values of one quick-filter condition, drawn by the field's type: a
 * coloured multi-pick of an option field, a record pick of a lookup, a text or
 * number box, relative date windows, yes / no. The operator sits on top and
 * can be changed at any point; nothing has to be chosen before the values.
 *
 * Every pick and keystroke hands the row back at once (`onChange`): there is
 * no Apply. A text box waits a beat after the last keystroke so a word is one
 * query, not one per letter.
 */

import * as React from 'react';
import {
  cn,
  Button,
  Checkbox,
  Input,
  LookupValuePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  isFilterValueComplete,
  type FilterBuilderRow,
} from '@object-ui/components';
import { getBadgeColorClasses, getBadgeHexAppearance } from '@object-ui/fields';
import { ChevronLeft } from 'lucide-react';
import { DATE_RANGE_PRESET_MACRO_WINDOWS, type DateRangePreset } from '@objectstack/spec/data';
import {
  QUICK_FILTER_OPERATORS,
  isValuelessOperator,
  quickFilterFamily,
  seedValueFor,
  type ConditionField,
} from './conditionModel';
import { quickDateWindowLabel, quickOperatorLabel, useListConditionTranslation } from './conditionTranslations';

/** The relative windows the date quick filter offers: four of the spec's presets. */
export const QUICK_DATE_WINDOWS = ['today', 'this_week', 'this_month', 'last_30_days'] as const satisfies readonly DateRangePreset[];
type QuickDateWindow = (typeof QUICK_DATE_WINDOWS)[number];

export interface FilterValuePanelProps {
  field: ConditionField;
  row: FilterBuilderRow;
  onChange: (row: FilterBuilderRow) => void;
  /** Shown as a back arrow beside the field name: return to the field list. */
  onBack?: () => void;
  testId?: string;
}

/** Is this row a filter the list applies (an operator that needs no value, or a finished value)? */
export function isQuickRowApplied(row: Pick<FilterBuilderRow, 'operator' | 'value'>): boolean {
  return isValuelessOperator(row.operator) || isFilterValueComplete(row.operator, row.value);
}

function useDebounced(callback: (value: string) => void, delay: number) {
  const ref = React.useRef(callback);
  ref.current = callback;
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return React.useCallback(
    (value: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => ref.current(value), delay);
    },
    [delay],
  );
}

export function FilterValuePanel({ field, row, onChange, onBack, testId = 'filter-values' }: FilterValuePanelProps) {
  const { t } = useListConditionTranslation();
  const family = quickFilterFamily(field);
  const offered = QUICK_FILTER_OPERATORS[family];
  const operators = offered.includes(row.operator) ? offered : [row.operator, ...offered];
  const operatorLabel = (op: string) => quickOperatorLabel(op, t);

  const setOperator = (operator: string) =>
    onChange({ ...row, operator: operator as FilterBuilderRow['operator'], value: seedValueFor(operator, row.value) });
  const setValue = (value: FilterBuilderRow['value']) => onChange({ ...row, value });

  return (
    <div className="flex w-72 max-w-full flex-col" data-testid={testId} data-field={field.value}>
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0"
            onClick={onBack}
            aria-label={t('listConditions.filter.back')}
            data-testid={`${testId}-back`}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
        <span className="truncate text-[13px] font-medium">{field.label}</span>
        <Select value={row.operator} onValueChange={setOperator}>
          <SelectTrigger
            className="ml-auto h-7 w-auto min-w-0 gap-1 border-0 px-2 text-[13px] text-muted-foreground shadow-none"
            aria-label={t('listConditions.filter.operator')}
            data-testid={`${testId}-operator`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((op) => (
              <SelectItem key={op} value={op}>
                {operatorLabel(op)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!isValuelessOperator(row.operator) && (
        <div className="p-1.5">
          <ValueBody family={family} field={field} row={row} setValue={setValue} testId={testId} />
        </div>
      )}
    </div>
  );
}

function ValueBody({
  family,
  field,
  row,
  setValue,
  testId,
}: {
  family: ReturnType<typeof quickFilterFamily>;
  field: ConditionField;
  row: FilterBuilderRow;
  setValue: (value: FilterBuilderRow['value']) => void;
  testId: string;
}) {
  switch (family) {
    case 'option':
      return <OptionValues field={field} row={row} setValue={setValue} testId={testId} />;
    case 'lookup':
      return (
        <LookupValuePicker
          field={field}
          value={row.value ?? []}
          multiple={row.operator === 'in' || row.operator === 'not_in'}
          onChange={setValue}
        />
      );
    case 'number':
      return <NumberValues row={row} setValue={setValue} testId={testId} />;
    case 'date':
      return <DateValues field={field} row={row} setValue={setValue} testId={testId} />;
    case 'boolean':
      return <BooleanValues row={row} setValue={setValue} testId={testId} />;
    default:
      return <TextValue row={row} setValue={setValue} testId={testId} />;
  }
}

function asList(value: FilterBuilderRow['value']): Array<string | number> {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [typeof value === 'boolean' ? String(value) : value];
}

function OptionValues({
  field,
  row,
  setValue,
  testId,
}: {
  field: ConditionField;
  row: FilterBuilderRow;
  setValue: (value: FilterBuilderRow['value']) => void;
  testId: string;
}) {
  const { t } = useListConditionTranslation();
  const [query, setQuery] = React.useState('');
  const options = field.options ?? [];
  const picked = asList(row.value).map(String);
  const shown = query.trim()
    ? options.filter((o) => o.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    : options;
  const multi = row.operator === 'in' || row.operator === 'not_in';

  const toggle = (key: string, raw: string | number | boolean) => {
    const value = typeof raw === 'number' ? raw : String(raw);
    if (!multi) {
      setValue(picked.includes(key) ? '' : value);
      return;
    }
    const current = asList(row.value);
    setValue(
      picked.includes(key)
        ? current.filter((entry) => String(entry) !== key)
        : [...current, value],
    );
  };

  return (
    <div className="flex flex-col gap-1">
      {options.length > 8 && (
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('listConditions.filter.searchOptions')}
          aria-label={t('listConditions.filter.searchOptions')}
          className="h-8 text-[13px]"
          data-testid={`${testId}-option-search`}
        />
      )}
      <ul className="max-h-64 overflow-y-auto" role="listbox" aria-multiselectable={multi || undefined}>
        {shown.map((option) => {
          const key = String(option.value);
          const checked = picked.includes(key);
          const hex = getBadgeHexAppearance(option.color);
          return (
            <li key={key}>
              <label
                className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-[13px] hover:bg-accent"
                data-testid={`${testId}-option-${key}`}
                data-checked={checked || undefined}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(key, option.value)}
                  aria-label={option.label}
                />
                <span
                  className={cn(
                    'inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-xs',
                    hex ? hex.className : getBadgeColorClasses(option.color, option.value),
                  )}
                  style={hex?.style}
                >
                  {option.label}
                </span>
              </label>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-2 py-2 text-[13px] text-muted-foreground">{t('listConditions.filter.noOptions')}</li>
        )}
      </ul>
    </div>
  );
}

function TextValue({
  row,
  setValue,
  testId,
}: {
  row: FilterBuilderRow;
  setValue: (value: FilterBuilderRow['value']) => void;
  testId: string;
}) {
  const { t } = useListConditionTranslation();
  const [text, setText] = React.useState(() => (typeof row.value === 'string' ? row.value : ''));
  const emit = useDebounced(setValue, 250);
  return (
    <Input
      autoFocus
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        emit(e.target.value);
      }}
      placeholder={t('listConditions.filter.textPlaceholder')}
      aria-label={t('listConditions.filter.textPlaceholder')}
      className="h-8 text-[13px]"
      data-testid={`${testId}-text`}
    />
  );
}

function toNumber(raw: string): number | '' {
  if (raw.trim() === '') return '';
  const n = Number(raw);
  return Number.isFinite(n) ? n : '';
}

function NumberValues({
  row,
  setValue,
  testId,
}: {
  row: FilterBuilderRow;
  setValue: (value: FilterBuilderRow['value']) => void;
  testId: string;
}) {
  const { t } = useListConditionTranslation();
  if (row.operator === 'between') {
    const [from, to] = Array.isArray(row.value) ? row.value : [];
    const set = (index: 0 | 1, raw: string) => {
      const next: Array<string | number> = [from ?? '', to ?? ''];
      next[index] = toNumber(raw);
      setValue(next);
    };
    return (
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          value={from ?? ''}
          onChange={(e) => set(0, e.target.value)}
          aria-label={t('listConditions.filter.from')}
          placeholder={t('listConditions.filter.from')}
          className="h-8 text-[13px]"
          data-testid={`${testId}-number-from`}
        />
        <Input
          type="number"
          value={to ?? ''}
          onChange={(e) => set(1, e.target.value)}
          aria-label={t('listConditions.filter.to')}
          placeholder={t('listConditions.filter.to')}
          className="h-8 text-[13px]"
          data-testid={`${testId}-number-to`}
        />
      </div>
    );
  }
  return (
    <Input
      autoFocus
      type="number"
      value={typeof row.value === 'number' || typeof row.value === 'string' ? row.value : ''}
      onChange={(e) => setValue(toNumber(e.target.value))}
      placeholder={t('listConditions.filter.numberPlaceholder')}
      aria-label={t('listConditions.filter.numberPlaceholder')}
      className="h-8 text-[13px]"
      data-testid={`${testId}-number`}
    />
  );
}

/** The quick window a stored pair is, if it is one of the four. */
export function quickDateWindowOf(value: FilterBuilderRow['value']): QuickDateWindow | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  return QUICK_DATE_WINDOWS.find((w) => {
    const [start, end] = DATE_RANGE_PRESET_MACRO_WINDOWS[w];
    return value[0] === start && value[1] === end;
  });
}

export function quickDateWindowValue(window: QuickDateWindow): string[] {
  const [start, end] = DATE_RANGE_PRESET_MACRO_WINDOWS[window];
  return [start, end];
}

function DateValues({
  field,
  row,
  setValue,
  testId,
}: {
  field: ConditionField;
  row: FilterBuilderRow;
  setValue: (value: FilterBuilderRow['value']) => void;
  testId: string;
}) {
  const { t } = useListConditionTranslation();
  const inputType = field.type === 'datetime' ? 'datetime-local' : field.type === 'time' ? 'time' : 'date';
  if (row.operator !== 'between') {
    return (
      <Input
        type={inputType}
        value={typeof row.value === 'string' ? row.value : ''}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 text-[13px]"
        aria-label={field.label}
        data-testid={`${testId}-date`}
      />
    );
  }
  const current = quickDateWindowOf(row.value);
  const pair = Array.isArray(row.value) && !current ? row.value : [];
  const custom = !current;
  return (
    <div className="flex flex-col gap-0.5" role="radiogroup" aria-label={field.label}>
      {QUICK_DATE_WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          role="radio"
          aria-checked={current === w}
          onClick={() => setValue(quickDateWindowValue(w))}
          className={cn(
            'flex h-8 items-center rounded-sm px-2 text-left text-[13px] hover:bg-accent',
            current === w && 'bg-accent font-medium',
          )}
          data-testid={`${testId}-window-${w}`}
        >
          {quickDateWindowLabel(w, t)}
        </button>
      ))}
      <div className="mt-1 border-t pt-1.5" data-testid={`${testId}-custom`}>
        <div className="px-2 pb-1 text-[11px] text-muted-foreground">{t('listConditions.filter.customRange')}</div>
        <div className="flex items-center gap-1.5">
          <Input
            type={inputType}
            value={custom ? String(pair[0] ?? '') : ''}
            onChange={(e) => setValue([e.target.value, String(pair[1] ?? '')])}
            aria-label={t('listConditions.filter.from')}
            className="h-8 text-[13px]"
            data-testid={`${testId}-date-from`}
          />
          <Input
            type={inputType}
            value={custom ? String(pair[1] ?? '') : ''}
            onChange={(e) => setValue([String(pair[0] ?? ''), e.target.value])}
            aria-label={t('listConditions.filter.to')}
            className="h-8 text-[13px]"
            data-testid={`${testId}-date-to`}
          />
        </div>
      </div>
    </div>
  );
}

function BooleanValues({
  row,
  setValue,
  testId,
}: {
  row: FilterBuilderRow;
  setValue: (value: FilterBuilderRow['value']) => void;
  testId: string;
}) {
  const { t } = useListConditionTranslation();
  const choices: Array<{ value: boolean; label: string }> = [
    { value: true, label: t('listConditions.filter.yes') },
    { value: false, label: t('listConditions.filter.no') },
  ];
  return (
    <div className="flex flex-col gap-0.5" role="radiogroup">
      {choices.map((choice) => (
        <button
          key={String(choice.value)}
          type="button"
          role="radio"
          aria-checked={row.value === choice.value}
          onClick={() => setValue(choice.value)}
          className={cn(
            'flex h-8 items-center rounded-sm px-2 text-left text-[13px] hover:bg-accent',
            row.value === choice.value && 'bg-accent font-medium',
          )}
          data-testid={`${testId}-boolean-${choice.value}`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
