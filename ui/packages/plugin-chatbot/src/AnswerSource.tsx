/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "How this was computed": one collapsed block per answer turn that draws the
 * `source` block each data tool answered beside its result (object, filter,
 * grouping, aggregations, how many records, and whose records were read), so
 * a reader can check an answer's number.
 *
 * The block receives only the lifted `AnswerSource` copies
 * (`detectAnswerSource`), never a tool's `result` or `args`, so nothing else
 * of a tool payload can reach this face in any visibility mode.
 */
import * as React from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
} from '@object-ui/components';
import { builtinAggregateLabels, useObjectTranslation, useSafeTranslate } from '@object-ui/i18n';
import { CalculatorIcon, ChevronDownIcon } from 'lucide-react';
import type { AnswerSource } from './mapMessages';

/** The scope value the block states in words; any other value draws nothing. */
const SCOPE_VISIBLE_TO_YOU = 'visible_to_you';

type FilterScalar = string | number | boolean;

/** One filter condition as the block draws it: field, operator label key, comparands. */
interface FilterRow {
  field: string;
  /** A `filterBuilder.operators.*` key, the words the filter builder already draws. */
  operator: string;
  values: FilterScalar[];
  /** `between` draws its two comparands as a range. */
  range?: boolean;
}

/**
 * The query dialect's comparison operators, by the filter builder's operator
 * key that names each one. An operator outside this table is not lowered.
 */
const COMPARISON_OPERATORS: Readonly<Record<string, string>> = {
  $eq: 'equals',
  $ne: 'not_equals',
  $gt: 'greater_than',
  $gte: 'greater_than_or_equal',
  $lt: 'less_than',
  $lte: 'less_than_or_equal',
  $in: 'in',
  $nin: 'not_in',
  $contains: 'contains',
  $icontains: 'icontains',
  $notContains: 'not_contains',
  $startsWith: 'starts_with',
  $endsWith: 'ends_with',
  $between: 'between',
};

/** The query dialect's presence operators: a boolean comparand picks one of two keys. */
const PRESENCE_OPERATORS: Readonly<Record<string, readonly [string, string]>> = {
  $null: ['is_null', 'is_not_null'],
  $empty: ['is_empty', 'is_not_empty'],
  $exists: ['exists', 'notExists'],
};

/**
 * The `en` pack's words for each operator key above, the fallback when no
 * locale provider is mounted (byte-equal to `filterBuilder.operators.*`).
 */
const OPERATOR_WORDS_EN: Readonly<Record<string, string>> = {
  equals: 'Equals',
  not_equals: 'Does not equal',
  greater_than: 'Greater than',
  greater_than_or_equal: 'Greater than or equal',
  less_than: 'Less than',
  less_than_or_equal: 'Less than or equal',
  in: 'In',
  not_in: 'Not in',
  contains: 'Contains',
  icontains: 'Contains (ignore case)',
  not_contains: 'Does not contain',
  starts_with: 'Starts with',
  ends_with: 'Ends with',
  between: 'Between',
  is_null: 'Is null',
  is_not_null: 'Is not null',
  is_empty: 'Is empty',
  is_not_empty: 'Is not empty',
  exists: 'Is set',
  notExists: 'Is not set',
};

const isScalar = (v: unknown): v is FilterScalar =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * One `field: comparand` entry as rows, or `null` when it does not lower. A
 * comparand whose keys are all field names is a condition on a lookup's
 * record (`{ project: { client: ID } }` reads `project.client`), lowered
 * under the dotted path.
 */
function lowerCondition(field: string, comparand: unknown): FilterRow[] | null {
  if (field.startsWith('$')) return null;
  if (comparand === null) return [{ field, operator: 'is_null', values: [] }];
  if (isScalar(comparand)) return [{ field, operator: 'equals', values: [comparand] }];
  if (!isPlainObject(comparand)) return null;
  const entries = Object.entries(comparand);
  if (entries.length === 0) return null;
  if (entries.every(([key]) => !key.startsWith('$'))) {
    const rows: FilterRow[] = [];
    for (const [sub, value] of entries) {
      const lowered = lowerCondition(`${field}.${sub}`, value);
      if (!lowered) return null;
      rows.push(...lowered);
    }
    return rows;
  }
  if (entries.length !== 1) return null;
  const row = lowerOperator(field, entries[0][0], entries[0][1]);
  return row ? [row] : null;
}

/** One `{ $op: value }` comparand as a row, or `null` when the table does not name the operator. */
function lowerOperator(field: string, op: string, value: unknown): FilterRow | null {
  const presence = PRESENCE_OPERATORS[op];
  if (presence) {
    return typeof value === 'boolean'
      ? { field, operator: value ? presence[0] : presence[1], values: [] }
      : null;
  }
  const operator = COMPARISON_OPERATORS[op];
  if (!operator) return null;
  if (op === '$between') {
    return Array.isArray(value) && value.length === 2 && value.every(isScalar)
      ? { field, operator, values: value, range: true }
      : null;
  }
  if (op === '$in' || op === '$nin') {
    return Array.isArray(value) && value.length > 0 && value.every(isScalar)
      ? { field, operator, values: value }
      : null;
  }
  return isScalar(value) ? { field, operator, values: [value] } : null;
}

/** A flat object of `field: comparand` entries as rows, or `null` when any entry does not lower. */
function lowerConditions(node: Record<string, unknown>): FilterRow[] | null {
  const rows: FilterRow[] = [];
  for (const [field, comparand] of Object.entries(node)) {
    const lowered = lowerCondition(field, comparand);
    if (!lowered) return null;
    rows.push(...lowered);
  }
  return rows;
}

/**
 * A filter in the query dialect (`FilterCondition`) as one logic over flat
 * rows: a flat object of field conditions (AND), or a lone `$and` / `$or` of
 * such objects. Anything else (a nested group, `$not`, a field reference, an
 * operator the table does not name) is `null`, and the block draws the
 * filter as served instead of guessing at its meaning.
 */
function lowerSourceFilter(
  filter: Record<string, unknown>,
): { logic: 'and' | 'or'; rows: FilterRow[] } | null {
  if (!isPlainObject(filter)) return null;
  const keys = Object.keys(filter);
  if (keys.length === 1 && (keys[0] === '$and' || keys[0] === '$or')) {
    const list = filter[keys[0]];
    if (!Array.isArray(list) || list.length === 0) return null;
    const rows: FilterRow[] = [];
    for (const item of list) {
      if (!isPlainObject(item)) return null;
      const lowered = lowerConditions(item);
      if (!lowered) return null;
      rows.push(...lowered);
    }
    return { logic: keys[0] === '$or' ? 'or' : 'and', rows };
  }
  const rows = lowerConditions(filter);
  return rows ? { logic: 'and', rows } : null;
}

/** The filter as served, on one line, for a filter the block could not lower. */
function servedFilterText(filter: unknown): string {
  try {
    return JSON.stringify(filter) ?? '';
  } catch {
    return '';
  }
}

function AnswerSourceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

function AnswerSourceSection({ source }: { source: AnswerSource }) {
  const { t } = useObjectTranslation();
  const tt = useSafeTranslate();
  const aggregateWords = builtinAggregateLabels(tt) as Record<string, string>;
  const word = (v: FilterScalar): string =>
    typeof v === 'boolean'
      ? v
        ? t('filterBuilder.trueLabel', { defaultValue: 'True' })
        : t('filterBuilder.falseLabel', { defaultValue: 'False' })
      : String(v);

  const lowered = source.filter !== undefined ? lowerSourceFilter(source.filter) : null;
  const joiner = lowered?.logic === 'or'
    ? t('filterBuilder.or', { defaultValue: 'OR' })
    : t('filterBuilder.and', { defaultValue: 'AND' });

  return (
    <dl className="space-y-1.5" data-testid="answer-source-section" data-object={source.object}>
      <AnswerSourceRow label={t('chatbot.answerSource.object', { defaultValue: 'Object' })}>
        {source.label ?? source.object}
      </AnswerSourceRow>
      <AnswerSourceRow label={t('chatbot.answerSource.filter', { defaultValue: 'Filter' })}>
        {source.filter === undefined ? (
          t('chatbot.answerSource.allRecords', { defaultValue: 'All records' })
        ) : lowered ? (
          <ul className="space-y-0.5" data-testid="answer-source-filter">
            {lowered.rows.map((row, i) => (
              <li key={`${row.field}-${i}`}>
                {i > 0 ? <span className="text-muted-foreground">{joiner} </span> : null}
                <span className="font-medium">{row.field}</span>{' '}
                <span className="text-muted-foreground">
                  {tt(`filterBuilder.operators.${row.operator}`, OPERATOR_WORDS_EN[row.operator])}
                </span>
                {row.values.length > 0 ? (
                  <>
                    {' '}
                    {row.range
                      ? `${word(row.values[0])} – ${word(row.values[1])}`
                      : row.values.map(word).join(', ')}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <code className="font-mono text-[11px]" data-testid="answer-source-filter-served">
            {servedFilterText(source.filter)}
          </code>
        )}
      </AnswerSourceRow>
      {source.groupBy.length > 0 ? (
        <AnswerSourceRow label={t('chatbot.answerSource.groupedBy', { defaultValue: 'Grouped by' })}>
          {source.groupBy.join(', ')}
        </AnswerSourceRow>
      ) : null}
      {source.aggregations.length > 0 ? (
        <AnswerSourceRow
          label={t('chatbot.answerSource.aggregations', { defaultValue: 'Aggregations' })}
        >
          <ul className="space-y-0.5">
            {source.aggregations.map((a, i) => (
              <li key={`${a.function}-${a.field ?? ''}-${i}`}>
                {aggregateWords[a.function] ?? a.function}
                {a.field ? <span className="font-medium"> {a.field}</span> : null}
              </li>
            ))}
          </ul>
        </AnswerSourceRow>
      ) : null}
      {source.records !== undefined ? (
        <AnswerSourceRow label={t('chatbot.answerSource.records', { defaultValue: 'Records' })}>
          <span data-testid="answer-source-records">{source.records}</span>
        </AnswerSourceRow>
      ) : null}
      {source.scope === SCOPE_VISIBLE_TO_YOU ? (
        <p className="text-muted-foreground" data-testid="answer-source-scope">
          {t('chatbot.answerSource.visibleToYou', { defaultValue: 'Only records visible to you' })}
        </p>
      ) : null}
    </dl>
  );
}

export interface AnswerSourceBlockProps {
  /** The turn's lifted sources, one per tool that answered one, in call order. */
  sources: ReadonlyArray<{ key: string; source: AnswerSource }>;
  className?: string;
}

/** The turn's "How this was computed" block; draws nothing for a turn with no source. */
export function AnswerSourceBlock({ sources, className }: AnswerSourceBlockProps) {
  const { t } = useObjectTranslation();
  if (sources.length === 0) return null;
  return (
    <Collapsible
      className={cn('not-prose mb-4 text-xs', className)}
      data-testid="answer-source"
    >
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
        <CalculatorIcon className="size-3.5" aria-hidden="true" />
        <span className="font-medium">
          {t('chatbot.answerSource.title', { defaultValue: 'How this was computed' })}
        </span>
        <ChevronDownIcon
          className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3 rounded-md border bg-muted/30 p-3">
        {sources.map(({ key, source }, i) => (
          <React.Fragment key={key}>
            {i > 0 ? <hr className="border-border/60" /> : null}
            <AnswerSourceSection source={source} />
          </React.Fragment>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
