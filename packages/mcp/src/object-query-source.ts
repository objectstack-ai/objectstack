// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { pickSentenceLocale } from '@objectstack/core';
import { ObjectQuerySourceSchema, type ObjectQuerySource } from '@objectstack/spec/ai';

/**
 * [#35138, ADR-0149 M1] The `source` block the object read tools answer
 * beside a successful result (`query_records`, `aggregate_records`): how the
 * figures were computed, as `ObjectQuerySourceSchema` (`@objectstack/spec/ai`)
 * types it, and `line`, that source already written as one finished sentence
 * in the caller's language, for the answer to quote. Without it an aggregate
 * answer comes back as a bare number the model has to source by itself, and
 * a model handed a finished line copies it where it often does not assemble
 * the same line from parts.
 *
 * The spec declares the shape and fixes no wording; the wording is this
 * file's. The language is picked by the shared picker (`pickSentenceLocale`,
 * `@objectstack/core`) over the bridge's ladder (`userTextLocales`), the one
 * `ifNotRecorded` and the dataset tools' `nextStep` / `sourceLine` read, so
 * every sentence in one caller's results speaks one language.
 *
 * ## Only from the read that ran
 *
 * Composed from the request the tool actually executed, after it answered:
 * the object, the caller's `where` exactly as sent, the aggregations and
 * group keys, the caller's own `orderBy`, the cut, the expanded lookups, the
 * one-per-group reading. A name is shown by its label only where the
 * caller's served definition shows that field (the view the read ran under);
 * any other name is the caller's own string, so the line names nothing the
 * caller cannot see. Nothing is read for it but that served definition.
 *
 * ## `scope`
 *
 * The block states `visible_to_you` on every call: these doors ask no
 * `getReadFilter` question, and the schema states `visible_to_you` whenever
 * the producer obtains no answer. It is true for every caller, since the
 * read ran under the caller's permissions and row-level security.
 *
 * ## Served only when it parses
 *
 * The composed block is parsed with `ObjectQuerySourceSchema` before it is
 * served, and a block the schema refuses is not served at all, the reader's
 * own rule (a refused block is no block). A block that cannot state the read
 * truthfully is not served either: a one-per-group read over several keys,
 * which the schema's single-key `latestPer` cannot name.
 */

/** The languages {@link SOURCE_COPY} writes; `en` is the floor. */
const SOURCE_LOCALES = ['en', 'zh-Hans', 'zh-Hant', 'ja'] as const;
type SourceLocale = (typeof SOURCE_LOCALES)[number];

/** The longest `line` the producer serves (the schema's stated budget). */
export const SOURCE_LINE_MAX = 280;

type AggregationFn = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct';
type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

interface SourceCopy {
  /** Opens the line; the open ask cards' citation grader reads `Source:` / `来源：`. */
  readonly lead: string;
  /** Joins the line's parts. */
  readonly gap: string;
  /** Joins the items of one part. */
  readonly list: string;
  /** Closes the line. */
  readonly end: string;
  readonly object: (label: string, name: string) => string;
  readonly measure: (fn: AggregationFn, field: string | undefined) => string;
  readonly measureFilter: (measure: string, filter: string) => string;
  readonly granular: (field: string, granularity: Granularity) => string;
  readonly groupedBy: (keys: string) => string;
  readonly filter: (json: string) => string;
  readonly orderKey: (field: string, order: 'asc' | 'desc') => string;
  readonly orderedBy: (keys: string) => string;
  readonly first: (n: number) => string;
  readonly latestPer: (by: string, orderedBy: string) => string;
  readonly related: (paths: string) => string;
  readonly records: (n: number) => string;
  readonly scope: string;
}

const SOURCE_COPY: Readonly<Record<SourceLocale, SourceCopy>> = {
  en: {
    lead: 'Source: ',
    gap: '; ',
    list: ', ',
    end: '.',
    object: (label, name) => `${label} (${name})`,
    measure: (fn, field) => {
      if (field === undefined) return fn === 'count' ? 'count' : fn;
      switch (fn) {
        case 'count': return `count of ${field}`;
        case 'sum': return `sum of ${field}`;
        case 'avg': return `average of ${field}`;
        case 'min': return `minimum of ${field}`;
        case 'max': return `maximum of ${field}`;
        case 'count_distinct': return `distinct count of ${field}`;
      }
    },
    measureFilter: (m, f) => `${m} (filter ${f})`,
    granular: (field, g) => `${field} (${g})`,
    groupedBy: (keys) => `grouped by ${keys}`,
    filter: (json) => `filter ${json}`,
    orderKey: (field, order) => `${field} ${order === 'desc' ? 'descending' : 'ascending'}`,
    orderedBy: (keys) => `ordered by ${keys}`,
    first: (n) => `first ${n}`,
    latestPer: (by, orderedBy) => `one record per ${by}, the first by ${orderedBy}`,
    related: (paths) => `with related ${paths}`,
    records: (n) => (n === 1 ? '1 record' : `${n} records`),
    scope: 'only records visible to you',
  },
  'zh-Hans': {
    lead: '来源：',
    gap: '；',
    list: '、',
    end: '。',
    object: (label, name) => `${label}（${name}）`,
    measure: (fn, field) => {
      if (field === undefined) return fn === 'count' ? '计数' : fn;
      switch (fn) {
        case 'count': return `${field} 计数`;
        case 'sum': return `${field} 合计`;
        case 'avg': return `${field} 平均值`;
        case 'min': return `${field} 最小值`;
        case 'max': return `${field} 最大值`;
        case 'count_distinct': return `${field} 去重计数`;
      }
    },
    measureFilter: (m, f) => `${m}（筛选条件 ${f}）`,
    granular: (field, g) => `${field}（${({ day: '日', week: '周', month: '月', quarter: '季度', year: '年' } as const)[g]}）`,
    groupedBy: (keys) => `按${keys}分组`,
    filter: (json) => `筛选条件 ${json}`,
    orderKey: (field, order) => `${field} ${order === 'desc' ? '降序' : '升序'}`,
    orderedBy: (keys) => `按${keys}排序`,
    first: (n) => `取前 ${n} 个`,
    latestPer: (by, orderedBy) => `每个${by}一条，按${orderedBy}取第一条`,
    related: (paths) => `关联 ${paths}`,
    records: (n) => `共 ${n} 条记录`,
    scope: '仅含你可见的记录',
  },
  'zh-Hant': {
    lead: '來源：',
    gap: '；',
    list: '、',
    end: '。',
    object: (label, name) => `${label}（${name}）`,
    measure: (fn, field) => {
      if (field === undefined) return fn === 'count' ? '計數' : fn;
      switch (fn) {
        case 'count': return `${field} 計數`;
        case 'sum': return `${field} 合計`;
        case 'avg': return `${field} 平均值`;
        case 'min': return `${field} 最小值`;
        case 'max': return `${field} 最大值`;
        case 'count_distinct': return `${field} 不重複計數`;
      }
    },
    measureFilter: (m, f) => `${m}（篩選條件 ${f}）`,
    granular: (field, g) => `${field}（${({ day: '日', week: '週', month: '月', quarter: '季', year: '年' } as const)[g]}）`,
    groupedBy: (keys) => `按${keys}分組`,
    filter: (json) => `篩選條件 ${json}`,
    orderKey: (field, order) => `${field} ${order === 'desc' ? '降序' : '升序'}`,
    orderedBy: (keys) => `按${keys}排序`,
    first: (n) => `取前 ${n} 個`,
    latestPer: (by, orderedBy) => `每個${by}一筆，按${orderedBy}取第一筆`,
    related: (paths) => `關聯 ${paths}`,
    records: (n) => `共 ${n} 筆記錄`,
    scope: '僅含你可見的記錄',
  },
  ja: {
    lead: '出典：',
    gap: '、',
    list: '・',
    end: '。',
    object: (label, name) => `${label}（${name}）`,
    measure: (fn, field) => {
      if (field === undefined) return fn === 'count' ? '件数' : fn;
      switch (fn) {
        case 'count': return `${field} の件数`;
        case 'sum': return `${field} の合計`;
        case 'avg': return `${field} の平均`;
        case 'min': return `${field} の最小値`;
        case 'max': return `${field} の最大値`;
        case 'count_distinct': return `${field} の異なる値の数`;
      }
    },
    measureFilter: (m, f) => `${m}（条件 ${f}）`,
    granular: (field, g) => `${field}（${({ day: '日', week: '週', month: '月', quarter: '四半期', year: '年' } as const)[g]}）`,
    groupedBy: (keys) => `${keys}ごとに集計`,
    filter: (json) => `条件 ${json}`,
    orderKey: (field, order) => `${field} ${order === 'desc' ? '降順' : '昇順'}`,
    orderedBy: (keys) => `${keys}で並べ替え`,
    first: (n) => `先頭 ${n} 件`,
    latestPer: (by, orderedBy) => `${by}ごとに1件（${orderedBy}の先頭）`,
    related: (paths) => `関連 ${paths}`,
    records: (n) => `${n} 件のレコード`,
    scope: 'あなたが閲覧できるレコードのみ',
  },
};

/** One `groupBy` entry as the tools accept it. */
export type ExecutedGroupKey = string | { field: string; dateGranularity?: Granularity; alias?: string };

/** One aggregation as the tools accept it (`AggregationNodeSchema`). */
export interface ExecutedAggregation {
  function: AggregationFn;
  field?: string;
  alias: string;
  filter?: unknown;
}

/** The read a tool executed, as {@link composeObjectQuerySource} reads it. */
export interface ExecutedObjectRead {
  /** The object read. */
  object: string;
  /** The caller's `where`, exactly as sent and as the read ran it. */
  where?: Record<string, unknown>;
  groupBy?: readonly ExecutedGroupKey[];
  aggregations?: readonly ExecutedAggregation[];
  /** The caller's own `orderBy`; an order the tool supplies itself is not the caller's and is not stated. */
  orderBy?: ReadonlyArray<{ field: string; order: 'asc' | 'desc' }>;
  /** The row or group cut the read took. Stated only beside {@link orderBy}, as the schema has it. */
  limit?: number;
  /** The lookups read in the same call (`query_records`' `expand`). */
  related?: readonly string[];
  /** `query_records`' one-record-per-group reading. */
  latestPer?: { by: readonly string[]; orderBy: ReadonlyArray<{ field: string; order: 'asc' | 'desc' }> };
  /** How many records the figures cover, when the read established it; never guessed. */
  records?: number;
}

/** The caller's served definition of the object, as the label lookups read it. */
export interface ServedLabels {
  /** The object's plural label, else its label. */
  object?: string;
  /** Each served field's label, by name. */
  fields: ReadonlyMap<string, string>;
}

/** A non-blank string, trimmed, or `undefined`. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * The labels a served definition shows: the object's plural label (else its
 * label) and each field's label, from the name-keyed `fields` map the bridges
 * serve. Nothing for a definition the bridge could not give.
 */
export function servedLabelsOf(def: Record<string, unknown> | undefined): ServedLabels {
  const fields = new Map<string, string>();
  const map = def?.fields;
  if (map !== null && typeof map === 'object' && !Array.isArray(map)) {
    for (const [name, field] of Object.entries(map as Record<string, unknown>)) {
      const label = field !== null && typeof field === 'object' ? textOf((field as { label?: unknown }).label) : undefined;
      if (label !== undefined) fields.set(name, label);
    }
  }
  return { object: textOf(def?.pluralLabel) ?? textOf(def?.label), fields };
}

/** Code points of `text`, so a cut never splits a surrogate pair. */
function cut(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

function lengthOf(text: string): number {
  return Array.from(text).length;
}

/** A filter written for the line: compact JSON, exactly the caller's names and values. */
function filterText(filter: unknown): string {
  try {
    return JSON.stringify(filter) ?? '';
  } catch {
    return '';
  }
}

/**
 * The finished line, at most {@link SOURCE_LINE_MAX} characters: when the
 * parts run long, the filter's JSON is shortened first (the block carries it
 * whole in `filter`), then the line itself is cut.
 */
function composeLine(copy: SourceCopy, parts: readonly string[], filterAt: number, filterJson: string): string {
  const join = (filter: string) => {
    const all = parts.map((p, i) => (i === filterAt ? copy.filter(filter) : p));
    return `${copy.lead}${all.join(copy.gap)}${copy.end}`;
  };
  let line = join(filterJson);
  if (filterAt >= 0 && lengthOf(line) > SOURCE_LINE_MAX) {
    const room = SOURCE_LINE_MAX - lengthOf(join(''));
    line = join(room >= 2 ? cut(filterJson, room) : '…');
  }
  return cut(line, SOURCE_LINE_MAX);
}

/**
 * [#35138] The `source` block for one read the tool executed, in the
 * language `locales` picks, or `undefined` when the read cannot be stated
 * truthfully in the schema's shape or the composed block does not parse.
 * Reads nothing: `read` is what ran, `labels` what the caller is served.
 */
export function composeObjectQuerySource(
  read: ExecutedObjectRead,
  labels: ServedLabels,
  locales: readonly (string | undefined)[],
): ObjectQuerySource | undefined {
  // The schema names one key the latest row is taken per; a read over
  // several would be stated as something it was not.
  if (read.latestPer !== undefined && read.latestPer.by.length !== 1) return undefined;

  const copy = SOURCE_COPY[pickSentenceLocale(locales, SOURCE_LOCALES)];
  const named = (name: string) => labels.fields.get(name) ?? name;
  const join = (items: readonly string[]) => items.join(copy.list);

  const groupBy = (read.groupBy ?? []).map((g) => (typeof g === 'string' ? { field: g } : g));
  const aggregations = read.aggregations ?? [];
  const orderBy = read.orderBy ?? [];
  const related = read.related ?? [];
  const filter = read.where !== undefined && Object.keys(read.where).length > 0 ? read.where : undefined;
  const records = typeof read.records === 'number' && Number.isInteger(read.records) && read.records >= 0
    ? read.records
    : undefined;
  const limit = orderBy.length > 0 && typeof read.limit === 'number' && Number.isInteger(read.limit) && read.limit > 0
    ? read.limit
    : undefined;

  const parts: string[] = [
    labels.object !== undefined && labels.object !== read.object ? copy.object(labels.object, read.object) : read.object,
  ];
  if (aggregations.length > 0) {
    parts.push(join(aggregations.map((a) => {
      const measure = copy.measure(a.function, a.field !== undefined && a.field !== '' ? named(a.field) : undefined);
      return a.filter !== undefined ? copy.measureFilter(measure, filterText(a.filter)) : measure;
    })));
  }
  if (groupBy.length > 0) {
    parts.push(copy.groupedBy(join(groupBy.map((g) => (
      g.dateGranularity !== undefined ? copy.granular(named(g.field), g.dateGranularity) : named(g.field)
    )))));
  }
  const filterAt = filter !== undefined ? parts.length : -1;
  const filterJson = filter !== undefined ? filterText(filter) : '';
  if (filter !== undefined) parts.push(copy.filter(filterJson));
  if (read.latestPer !== undefined) {
    parts.push(copy.latestPer(named(read.latestPer.by[0]), join(read.latestPer.orderBy.map((o) => copy.orderKey(named(o.field), o.order)))));
  }
  if (orderBy.length > 0) parts.push(copy.orderedBy(join(orderBy.map((o) => copy.orderKey(named(o.field), o.order)))));
  if (limit !== undefined) parts.push(copy.first(limit));
  if (related.length > 0) parts.push(copy.related(join(related.map(named))));
  if (records !== undefined) parts.push(copy.records(records));
  parts.push(copy.scope);

  const block: ObjectQuerySource = {
    object: read.object,
    ...(filter !== undefined ? { filter: filter as ObjectQuerySource['filter'] } : {}),
    scope: 'visible_to_you',
    ...(groupBy.length > 0 ? { groupBy: groupBy.map((g) => g.field) } : {}),
    ...(aggregations.length > 0
      ? {
        aggregations: aggregations.map((a) => ({
          function: a.function,
          ...(a.field !== undefined && a.field !== '' ? { field: a.field } : {}),
        })),
      }
      : {}),
    ...(orderBy.length > 0 ? { orderBy: orderBy.map((o) => ({ field: o.field, order: o.order })) } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(related.length > 0 ? { related: [...related] } : {}),
    ...(read.latestPer !== undefined
      ? { latestPer: { groupBy: read.latestPer.by[0], orderField: read.latestPer.orderBy[0].field } }
      : {}),
    ...(records !== undefined ? { records } : {}),
    line: composeLine(copy, parts, filterAt, filterJson),
  };
  return ObjectQuerySourceSchema.safeParse(block).success ? block : undefined;
}
