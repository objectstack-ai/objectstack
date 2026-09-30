// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The import TEMPLATE that `GET {basePath}/data/:object/export?template=true`
 * answers: an xlsx workbook with no data rows, whose columns are the ones an
 * import can actually write.
 *
 * ## Why the template has its own column rule
 *
 * The export's default columns are every field of the object, narrowed only
 * by what the caller may READ. That is right for an export, whose reader wants
 * to SEE the data, and wrong for a template, whose reader wants to FILL it: the
 * registry injects `created_at`, `created_by`, `organization_id` and the other
 * platform columns onto every object, and a value typed into one of them never
 * lands. So the export's rule is left exactly as it is, and the template takes
 * {@link templateColumns} — one question per column: "if I fill this in, does
 * the import store it?"
 *
 * Each exclusion in {@link TEMPLATE_COLUMN_EXCLUSIONS} names the write-path
 * behaviour that makes the answer "no", measured through `POST /data/:object/import`
 * on the SQL driver (better-sqlite3) under a non-system caller:
 *
 * | rule         | what the write path does with a value in that column          |
 * |--------------|----------------------------------------------------------------|
 * | `readonly`   | `stripReadonlyFields` drops it on insert and update, with a    |
 * |              | `warn` and the field's `defaultValue` in its place             |
 * | `autonumber` | `stripRuntimeOwnedFields` drops it; the sequence issues one    |
 * | `computed`   | `formula`: SQL refuses the row, memory creates it. `summary`:  |
 * |              | stored, then overwritten by the next write of a child record   |
 * | `system`     | the injected columns are all `readonly` save `owner_id`, which |
 * |              | the security middleware refuses (403) when it names anyone     |
 * |              | but the caller and the caller holds no transfer grant          |
 *
 * `hidden` is NOT an exclusion: an author-declared `hidden: true` field that
 * is writable is stored by the import, so it is a column ([#18386] ruling,
 * Q2 C). The injected hidden columns are `readonly`, so the `readonly` row
 * keeps them out.
 *
 * Field-level security narrows the rest to what the caller may WRITE — see
 * {@link resolveTemplateProjection}.
 *
 * An explicit `?fields=` list is honoured exactly as asked: the caller named
 * the columns, so no rule narrows them (the export treats `?fields=` the same).
 *
 * ## What the instructions sheet says is what the reader does
 *
 * Every accepted spelling the instructions state is taken from the import
 * reader's own vocabulary — the boolean tokens are the spec's
 * `IMPORT_BOOLEAN_TRUE_TOKENS` / `IMPORT_BOOLEAN_FALSE_TOKENS`, and each
 * example spelling for numbers, dates and times lives in
 * {@link TEMPLATE_READER_CLAIMS}, which the tests run through
 * `import-coerce.ts`'s own parsers. A sentence here that the reader does not
 * honour is a failing test, not a stale comment.
 *
 * ## Why not the streaming writer
 *
 * A template has no rows to stream, and the export's `WorkbookWriter` path has
 * never been measured with data validations. This builds an ordinary
 * `Workbook` and writes it once.
 */

import {
  BOOLEAN_VALUE_TYPES,
  FILE_REFERENCE_TYPES,
  IMPORT_BOOLEAN_FALSE_TOKENS,
  IMPORT_BOOLEAN_TRUE_TOKENS,
  IMPORT_REFERENCE_TYPES,
  MULTI_OPTION_TYPES,
  NUMERIC_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  isMultiValueField,
} from '@objectstack/spec/data';
import type { ISecurityService, SecurityContext } from '@objectstack/spec/contracts';
import { buildFieldMetaMap, type ExportFieldMeta } from './export-format.js';
import { loadExcelJs, type Workbook, type Worksheet } from './xlsx-module.js';

// ── the column rule ─────────────────────────────────────────────────

/** The keys of a field definition the column rule and the instructions read. */
export interface TemplateFieldDef {
  type?: unknown;
  readonly?: unknown;
  system?: unknown;
  required?: unknown;
  defaultValue?: unknown;
  min?: unknown;
  max?: unknown;
}

/** One exclusion of the template's column rule. */
export interface TemplateColumnExclusion {
  /** Stable id, one per row of the column-rule table in the module header. */
  readonly id: 'system' | 'readonly' | 'computed' | 'autonumber';
  /** Does this rule keep the field out of the template? */
  readonly excludes: (def: TemplateFieldDef) => boolean;
}

/**
 * The template's exclusions, one per row of the table in the module header.
 * A field any of them excludes is not a template column.
 */
export const TEMPLATE_COLUMN_EXCLUSIONS: readonly TemplateColumnExclusion[] = Object.freeze([
  { id: 'system', excludes: (def) => def.system === true },
  { id: 'readonly', excludes: (def) => def.readonly === true },
  { id: 'computed', excludes: (def) => def.type === 'formula' || def.type === 'summary' },
  { id: 'autonumber', excludes: (def) => def.type === 'autonumber' },
]);

/**
 * The object's field definitions by name, in the order the object declares
 * them. Accepts both shapes `fields` takes across the stack — the object map
 * the registry serves and a `FieldDefinition[]` — exactly as
 * `buildFieldMetaMap` does, so a name here is a name there.
 */
export function templateFieldDefs(schema: unknown): Map<string, TemplateFieldDef> {
  const out = new Map<string, TemplateFieldDef>();
  const fields = (schema as { fields?: unknown } | null | undefined)?.fields;
  const entries: Array<[string, unknown]> = Array.isArray(fields)
    ? fields.map((f) => [typeof (f as { name?: unknown })?.name === 'string' ? String((f as { name: string }).name) : '', f])
    : fields && typeof fields === 'object'
      ? Object.entries(fields as Record<string, unknown>).map(([key, def]) => [
        def && typeof def === 'object' && typeof (def as { name?: unknown }).name === 'string'
          ? String((def as { name: string }).name)
          : key,
        def,
      ])
      : [];
  for (const [name, def] of entries) {
    if (!name || !def || typeof def !== 'object') continue;
    out.set(name, def as TemplateFieldDef);
  }
  return out;
}

export interface TemplateColumnsOptions {
  /** `?fields=` as the caller sent it. Non-empty ⇒ honoured verbatim. */
  explicitFields?: readonly string[];
  /**
   * The field names the caller's field-level security admits, or `undefined`
   * when no field-level security applies (no security service is composed).
   * Ignored for an explicit `?fields=` list.
   */
  permitted?: ReadonlySet<string>;
}

/**
 * The template's columns, in the order the object declares its fields —
 * never reordered: a required column is marked in its header, not moved.
 */
export function templateColumns(schema: unknown, opts: TemplateColumnsOptions = {}): string[] {
  if (opts.explicitFields && opts.explicitFields.length > 0) return [...opts.explicitFields];
  const out: string[] = [];
  for (const [name, def] of templateFieldDefs(schema)) {
    if (TEMPLATE_COLUMN_EXCLUSIONS.some((rule) => rule.excludes(def))) continue;
    if (opts.permitted && !opts.permitted.has(name)) continue;
    out.push(name);
  }
  return out;
}

// ── field-level security ────────────────────────────────────────────

/**
 * Which field-level-security projection narrowed the columns: `writable` (the
 * security service's write projection), `readable` (its read projection — the
 * contract's soft-fail case, which the response states), or `none` (no
 * projection applies: no security service, or an explicit `?fields=`).
 */
export type TemplateProjectionSource = 'writable' | 'readable' | 'none';

export type TemplateProjection =
  | { source: 'writable' | 'readable'; permitted: ReadonlySet<string> }
  | { source: 'none' }
  | { source: 'unanswered' };

/**
 * Ask the security service which fields the template may offer.
 *
 * `getWritableFields` first: the fields a write may name without field-level
 * security refusing the row. A service without it, or one that gives no answer,
 * is the contract's soft-fail case — the READ projection narrows instead, and
 * `readable` obliges the caller to say so. `unanswered`: a service is present
 * and gave neither answer, so the caller refuses rather than widen silently.
 */
export async function resolveTemplateProjection(
  security: Partial<Pick<ISecurityService, 'getWritableFields' | 'getReadableFields'>> | undefined,
  objectName: string,
  context: SecurityContext | undefined,
): Promise<TemplateProjection> {
  if (!security) return { source: 'none' };
  if (typeof security.getWritableFields === 'function') {
    const writable = await security.getWritableFields(objectName, context);
    if (Array.isArray(writable)) return { source: 'writable', permitted: new Set(writable) };
  }
  if (typeof security.getReadableFields === 'function') {
    const readable = await security.getReadableFields(objectName, context);
    if (Array.isArray(readable)) return { source: 'readable', permitted: new Set(readable) };
  }
  return { source: 'unanswered' };
}

/**
 * Whether a column is marked required (`*`) in the template: a row that leaves
 * it blank is refused. A `required` field that declares a `defaultValue` is
 * NOT marked — the engine fills the default before it checks, so a blank cell
 * there is accepted.
 */
export function isTemplateRequired(def: TemplateFieldDef | undefined): boolean {
  return def?.required === true && def.defaultValue === undefined;
}

// ── request reading ─────────────────────────────────────────────────

/**
 * The export parameters that select or page ROWS, or toggle the header. A
 * template has no data rows and always carries its header, so on a template
 * request each of these would be ignored — and an ignored parameter is refused
 * on this route rather than dropped.
 */
export const TEMPLATE_INAPPLICABLE_PARAMS: readonly string[] = Object.freeze([
  'limit', 'page', 'filter', 'search', 'searchFields', 'orderby', 'header',
]);

export type TemplateModeRead =
  | { kind: 'export' }
  | { kind: 'template' }
  | { kind: 'refused'; message: string };

/**
 * Read `?template=` and the parameters it constrains. `true` / `false` in any
 * letter case; `false` and absence both answer the ordinary export. Anything
 * else is refused rather than read as `false`, because reading it as `false`
 * answers a data export to a caller who asked for a template.
 */
export function readTemplateMode(query: Record<string, unknown>): TemplateModeRead {
  const raw = query.template;
  if (raw === undefined) return { kind: 'export' };
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : undefined;
  if (value === 'false') return { kind: 'export' };
  if (value !== 'true') {
    return {
      kind: 'refused',
      message: `The "template" query parameter takes true or false, got ${JSON.stringify(raw)}. `
        + 'template=true answers an xlsx import template; template=false, or no template parameter, '
        + 'answers the data export.',
    };
  }
  const inapplicable = TEMPLATE_INAPPLICABLE_PARAMS.filter((name) => query[name] !== undefined);
  if (inapplicable.length > 0) {
    const names = inapplicable.map((n) => `"${n}"`).join(', ');
    return {
      kind: 'refused',
      message: `template=true answers an import template, which has no data rows and always carries its header, `
        + `so ${inapplicable.length === 1 ? `the ${names} query parameter has` : `the query parameters ${names} have`} `
        + 'nothing to apply to. Remove them, or drop template=true to export data.',
    };
  }
  const format = query.format;
  if (format !== undefined && String(format).trim().toLowerCase() !== 'xlsx') {
    return {
      kind: 'refused',
      message: `template=true answers an xlsx workbook, and format ${JSON.stringify(format)} cannot carry `
        + 'its dropdowns or its instructions sheet. Omit format, or send format=xlsx.',
    };
  }
  return { kind: 'template' };
}

// ── what the instructions claim about the reader ────────────────────

/**
 * Every example spelling the instructions sheet quotes, with the value the
 * import reader produces for it (or `undefined` for a refused one). The text
 * is BUILT from these, and the tests run each one through the reader
 * (`parseNumberCell`, `parseDateCell`, `splitMulti`) — so the sheet cannot
 * claim a spelling the reader does not honour.
 */
export const TEMPLATE_READER_CLAIMS = Object.freeze({
  number: {
    thousands: [['1,000', 1000], ['12,345.67', 12345.67]] as ReadonlyArray<readonly [string, number]>,
    decimalCommaRefused: '3,14',
    decimalPoint: ['3.14', 3.14] as readonly [string, number],
    currencySymbols: ['$', '¥', '€', '£', '￥'] as readonly string[],
    percent: ['25%', 25] as readonly [string, number],
    negative: ['(1,234)', -1234] as readonly [string, number],
  },
  date: {
    accepted: [['2026-01-31', '2026-01-31'], ['2026/1/31', '2026-01-31']] as ReadonlyArray<readonly [string, string]>,
    refused: ['01/31/2026', '31/01/2026', '26/1/31', '2026-02-30'] as readonly string[],
  },
  datetime: {
    /** Zone-naive: read in the business timezone, so only the reading's existence is claimed. */
    naive: ['2026-01-31 09:30:00', '2026/1/31 9:30'] as readonly string[],
    /** Offset-bearing: read as written. */
    offset: ['2026-01-31T09:30:00+08:00', '2026-01-31T01:30:00.000Z'] as readonly [string, string],
  },
  time: {
    accepted: [['09:30', '09:30:00'], ['09:30:00', '09:30:00']] as ReadonlyArray<readonly [string, string]>,
  },
  /** The separators a multi-value cell is split on, as the sheet names them. */
  multiSeparators: ['、', ',', ';'] as readonly string[],
});

// ── localized text ──────────────────────────────────────────────────

export interface TemplateText {
  templateSheet: string;
  instructionsSheet: string;
  filenameSuffix: string;
  notes: readonly string[];
  /** The note stating the soft-fail: the columns are the READ projection. */
  readProjectionNote: string;
  headings: readonly [string, string, string, string, string];
  required: string;
  optional: string;
  booleanWords: readonly [string, string];
  multiJoiner: string;
  text: string;
  sampleText: string;
  email: string;
  url: string;
  phone: string;
  number: string;
  range: (min: unknown, max: unknown) => string;
  boolean: (trueTokens: string, falseTokens: string) => string;
  singleOption: (labels: string) => string;
  multiOption: (labels: string) => string;
  freeMulti: string;
  date: string;
  datetime: string;
  time: string;
  reference: (target: string) => string;
  multiReference: (target: string) => string;
  file: string;
  multiFile: string;
  unknownField: string;
}

const C = TEMPLATE_READER_CLAIMS;
const SEPARATORS_EN = `${C.multiSeparators.join(' ')} or a line break`;
const SEPARATORS_ZH = `${C.multiSeparators.join(' ')} 或换行`;
const THOUSANDS = C.number.thousands.map(([s]) => s);

const EN: TemplateText = {
  templateSheet: 'Template',
  instructionsSheet: 'Instructions',
  filenameSuffix: 'import template',
  notes: [
    'Fill one record per row on the Template sheet, starting at row 2. Row 2 holds an example value for each column: '
      + 'replace it or delete it before you import, or it is imported as a record.',
    'Columns marked * are required: a row that leaves one of them blank is refused.',
  ],
  readProjectionNote: 'These columns are the fields you can read: this deployment cannot say which fields you can edit. '
    + 'A row that fills a field you can read but not edit is refused.',
  headings: ['Column', 'Field', 'Type', 'Required', 'How to fill it'],
  required: 'Yes',
  optional: 'No',
  booleanWords: ['yes', 'no'],
  multiJoiner: ', ',
  text: 'Text.',
  sampleText: 'Sample',
  email: 'An email address.',
  url: 'A URL.',
  phone: 'A phone number.',
  number: `A number. Type it as a number, or as text in which a comma may only group thousands: 1 to 3 digits, then `
    + `groups of exactly 3, and only before any "." (${THOUSANDS.join(' or ')}). Any other comma is refused, a decimal `
    + `comma included: write ${C.number.decimalPoint[0]}, not ${C.number.decimalCommaRefused}. Also read: a leading `
    + `currency symbol (${C.number.currencySymbols.join(' ')}), a trailing % (removed, so ${C.number.percent[0]} is read `
    + `as ${C.number.percent[1]}), and parentheses for a negative (${C.number.negative[0]} is read as `
    + `${C.number.negative[1]}).`,
  range: (min, max) => (min !== undefined && max !== undefined
    ? ` Between ${min} and ${max}.`
    : min !== undefined ? ` At least ${min}.` : ` At most ${max}.`),
  boolean: (t, f) => `Yes or no. Also read, in any letter case: ${t} for yes, and ${f} for no.`,
  singleOption: (labels) => `One option from the dropdown: ${labels}. The option code is read too, and letter case is ignored.`,
  multiOption: (labels) => `One or more of: ${labels}. Separate several with ${SEPARATORS_EN}.`,
  freeMulti: `One or more values. Separate several with ${SEPARATORS_EN}.`,
  date: `A date: ${C.date.accepted[0][0]}, or year first: ${C.date.accepted[1][0]}. A date cell is read as the day it shows. `
    + `Month-first and day-first dates (${C.date.refused[0]}, ${C.date.refused[1]}), two-digit years (${C.date.refused[2]}) `
    + `and a day that does not exist (${C.date.refused[3]}) are refused.`,
  datetime: `A date and time: ${C.datetime.naive[0]}, or year first: ${C.datetime.naive[1]}, read in your organization's `
    + `business time zone (UTC when none is set); or ISO 8601 with an offset, read as written: ${C.datetime.offset[0]}.`,
  time: `A time of day: ${C.time.accepted.map(([s]) => s).join(' or ')}.`,
  reference: (target) => `The name of a ${target} record, or its id. A value that matches more than one record is refused `
    + 'as ambiguous (reference_ambiguous).',
  multiReference: (target) => `One or more ${target} record names or ids, separated by ${SEPARATORS_EN}. A value that `
    + 'matches more than one record is refused as ambiguous (reference_ambiguous).',
  file: 'A file id or URL.',
  multiFile: `One or more file ids or URLs, separated by ${SEPARATORS_EN}.`,
  unknownField: 'Not a field of this object.',
};

const ZH: TemplateText = {
  templateSheet: '模板',
  instructionsSheet: '填写说明',
  filenameSuffix: '导入模板',
  notes: [
    '在「模板」工作表中每行填写一条记录,从第 2 行开始。第 2 行是每一列的示例值:导入前请替换或删除,否则它会作为一条记录被导入。',
    '带 * 的列为必填:其中任一列留空的行会被拒绝。',
  ],
  readProjectionNote: '这些列是你可读的字段:当前部署无法判断你可编辑哪些字段。填写了可读但不可编辑字段的行会被拒绝。',
  headings: ['列', '字段', '类型', '必填', '填写方式'],
  required: '是',
  optional: '否',
  booleanWords: ['是', '否'],
  multiJoiner: '、',
  text: '文本。',
  sampleText: '示例',
  email: '邮箱地址。',
  url: '网址(URL)。',
  phone: '电话号码。',
  number: `数字。可以填数值,也可以填文本;文本中的逗号只能作千分位:开头 1 到 3 位数字,之后每组恰好 3 位,且只能出现在「.」之前`
    + `(${THOUSANDS.join(' 或 ')})。其他任何逗号都会被拒绝,包括小数逗号:请写 ${C.number.decimalPoint[0]},`
    + `不要写 ${C.number.decimalCommaRefused}。另外可以识别:开头的货币符号(${C.number.currencySymbols.join(' ')})、`
    + `结尾的 %(会被去掉,${C.number.percent[0]} 读作 ${C.number.percent[1]})、表示负数的括号`
    + `(${C.number.negative[0]} 读作 ${C.number.negative[1]})。`,
  range: (min, max) => (min !== undefined && max !== undefined
    ? ` 取值范围 ${min} 到 ${max}。`
    : min !== undefined ? ` 最小 ${min}。` : ` 最大 ${max}。`),
  boolean: (t, f) => `是或否。以下写法也可识别(不区分大小写):表示「是」的 ${t};表示「否」的 ${f}。`,
  singleOption: (labels) => `从下拉列表中选择一项:${labels}。也可以填选项代码,不区分大小写。`,
  multiOption: (labels) => `填一项或多项:${labels}。多项之间用 ${SEPARATORS_ZH} 分隔。`,
  freeMulti: `填一个或多个值,多个之间用 ${SEPARATORS_ZH} 分隔。`,
  date: `日期:${C.date.accepted[0][0]},或年份在前的 ${C.date.accepted[1][0]}。日期单元格按其显示的日期读取。`
    + `月份或日期在前的写法(${C.date.refused[0]}、${C.date.refused[1]})、两位数年份(${C.date.refused[2]})`
    + `以及不存在的日期(${C.date.refused[3]})都会被拒绝。`,
  datetime: `日期时间:${C.datetime.naive[0]},或年份在前的 ${C.datetime.naive[1]},按组织的业务时区读取`
    + `(未设置时区时按 UTC);也可以填带时区偏移的 ISO 8601,按所写时区读取:${C.datetime.offset[0]}。`,
  time: `时间:${C.time.accepted.map(([s]) => s).join(' 或 ')}。`,
  reference: (target) => `填「${target}」记录的名称,或其 ID。匹配到多条记录的值会因有歧义被拒绝(reference_ambiguous)。`,
  multiReference: (target) => `填一个或多个「${target}」记录的名称或 ID,用 ${SEPARATORS_ZH} 分隔。`
    + '匹配到多条记录的值会因有歧义被拒绝(reference_ambiguous)。',
  file: '文件 ID 或 URL。',
  multiFile: `一个或多个文件 ID 或 URL,用 ${SEPARATORS_ZH} 分隔。`,
  unknownField: '不是该对象的字段。',
};

/** The template's language: Chinese for a `zh*` request locale, English otherwise. */
export function templateText(locale: string | undefined): TemplateText {
  return typeof locale === 'string' && locale.trim().toLowerCase().startsWith('zh') ? ZH : EN;
}

// ── describing one column ───────────────────────────────────────────

/** Everything the workbook writes about one template column. */
export interface TemplateColumn {
  field: string;
  /** The header cell: the (localized) label, with ` *` when required. */
  header: string;
  type: string;
  required: boolean;
  /** The "How to fill it" cell of the instructions sheet. */
  howToFill: string;
  /** The example cell under the header. `undefined` leaves it blank. */
  example: string | number | undefined;
  /** The values a dropdown offers, for a closed single-valued domain. */
  dropdown?: readonly string[];
  /** Format the column as text, so a value like `00123` keeps its zeros. */
  textFormat: boolean;
}

export interface DescribeTemplateOptions {
  locale?: string;
  /** The display label of each referenced object, by object name. */
  referenceLabels?: ReadonlyMap<string, string>;
}

function optionLabels(meta: ExportFieldMeta | undefined): string[] {
  const out: string[] = [];
  for (const o of meta?.options ?? []) {
    if (!o) continue;
    const label = typeof o.label === 'string' && o.label.trim().length > 0 ? o.label : o.value;
    if (label === undefined || label === null) continue;
    const s = String(label);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function numberExample(def: TemplateFieldDef | undefined): number {
  let n = 1;
  if (typeof def?.min === 'number' && n < def.min) n = def.min;
  if (typeof def?.max === 'number' && n > def.max) n = def.max;
  return n;
}

const TIME_OF_DAY_TYPES = new Set(['date', 'datetime', 'time']);

/** Free-text types whose example is the localized word for "sample". */
const SAMPLE_TEXT_TYPES = new Set(['text', 'textarea', 'markdown', 'richtext', 'html']);

/** Example values that satisfy the write door's format check for their type. */
const FORMATTED_TEXT_EXAMPLES: Readonly<Record<string, string>> = Object.freeze({
  email: 'name@example.com',
  url: 'https://example.com',
  phone: '+1 202 555 0100',
});

/**
 * Describe each template column: its header, the instructions row and the
 * example value. `schema` is the object as the caller reads it (labels
 * already localized).
 */
export function describeTemplateColumns(
  schema: unknown,
  fields: readonly string[],
  opts: DescribeTemplateOptions = {},
): TemplateColumn[] {
  const text = templateText(opts.locale);
  const defs = templateFieldDefs(schema);
  const metaMap = buildFieldMetaMap(schema);
  const trueTokens = [...IMPORT_BOOLEAN_TRUE_TOKENS].join(' ');
  const falseTokens = [...IMPORT_BOOLEAN_FALSE_TOKENS].join(' ');

  return fields.map((field) => {
    const def = defs.get(field);
    const meta = metaMap.get(field);
    const type = meta?.type ?? '';
    const required = isTemplateRequired(def);
    const label = meta?.label?.trim() || field;
    const column: TemplateColumn = {
      field,
      header: required ? `${label} *` : label,
      type,
      required,
      howToFill: text.text,
      example: undefined,
      textFormat: true,
    };
    if (!def || !meta) {
      column.howToFill = text.unknownField;
      return column;
    }
    const multi = isMultiValueField({ type, multiple: meta.multiple });

    if (NUMERIC_VALUE_TYPES.has(type)) {
      const hasRange = typeof def.min === 'number' || typeof def.max === 'number';
      column.howToFill = text.number + (hasRange
        ? text.range(typeof def.min === 'number' ? def.min : undefined, typeof def.max === 'number' ? def.max : undefined)
        : '');
      column.example = numberExample(def);
      column.textFormat = false;
    } else if (BOOLEAN_VALUE_TYPES.has(type)) {
      column.howToFill = text.boolean(trueTokens, falseTokens);
      column.example = text.booleanWords[0];
      column.dropdown = text.booleanWords;
    } else if (SINGLE_OPTION_TYPES.has(type) || MULTI_OPTION_TYPES.has(type)) {
      const labels = optionLabels(meta);
      if (multi) {
        column.howToFill = labels.length > 0 ? text.multiOption(labels.join(', ')) : text.freeMulti;
        column.example = labels.length > 0 ? labels.slice(0, 2).join(text.multiJoiner) : undefined;
      } else {
        column.howToFill = text.singleOption(labels.join(', '));
        column.example = labels[0];
        if (labels.length > 0) column.dropdown = labels;
      }
    } else if (TIME_OF_DAY_TYPES.has(type)) {
      column.howToFill = type === 'date' ? text.date : type === 'datetime' ? text.datetime : text.time;
      column.example = type === 'date' ? C.date.accepted[0][0]
        : type === 'datetime' ? C.datetime.naive[0]
          : C.time.accepted[0][0];
      column.textFormat = false;
    } else if (IMPORT_REFERENCE_TYPES.has(type)) {
      const target = meta.reference ?? '';
      const targetLabel = opts.referenceLabels?.get(target) || target;
      column.howToFill = multi ? text.multiReference(targetLabel) : text.reference(targetLabel);
    } else if (FILE_REFERENCE_TYPES.has(type)) {
      column.howToFill = multi ? text.multiFile : text.file;
    } else if (SAMPLE_TEXT_TYPES.has(type)) {
      column.example = text.sampleText;
    } else if (type in FORMATTED_TEXT_EXAMPLES) {
      column.howToFill = type === 'email' ? text.email : type === 'url' ? text.url : text.phone;
      column.example = FORMATTED_TEXT_EXAMPLES[type];
    }
    return column;
  });
}

// ── the workbook ────────────────────────────────────────────────────

/**
 * The first row the dropdowns cover is the example row; the last is this many
 * rows below the header. It matches the import job's row cap, so a template
 * filled to what the import will take has a dropdown on every row.
 */
export const TEMPLATE_VALIDATED_ROWS = 50_000;

/** The data validation a worksheet cell carries, read off exceljs' own `Cell` type. */
type TemplateDataValidation = ReturnType<Worksheet['getCell']>['dataValidation'];

/**
 * exceljs' worksheet-level range validations.
 *
 * `Worksheet` constructs `this.dataValidations = new DataValidations()`
 * (`exceljs/lib/doc/worksheet.js`), and the sheet writer emits a range-keyed
 * entry as ONE `<dataValidation sqref="C2:C50001">` — but `exceljs@4.4.0`'s
 * published `index.d.ts` comments the member out. The per-cell alternative
 * (`getCell(...).dataValidation`) would create an empty cell for every covered
 * row, which a spreadsheet then reports as 50 000 used rows. So the member is
 * reached through this one assertion, and a runtime without it fails loudly
 * instead of shipping a template whose dropdowns silently vanished.
 */
function rangeValidations(ws: Worksheet): { add(address: string, validation: TemplateDataValidation): unknown } {
  const dv = (ws as unknown as { dataValidations?: { add?: unknown } }).dataValidations;
  if (!dv || typeof dv.add !== 'function') {
    throw new Error('exceljs no longer exposes Worksheet.dataValidations; the import template cannot declare its dropdowns');
  }
  return dv as { add(address: string, validation: TemplateDataValidation): unknown };
}

/** Column letters for a 1-based column index (1 → A, 27 → AA). */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Where the instructions sheet's field table starts, and where its dropdown lists start. */
const INSTRUCTIONS_TABLE_HEADER_ROW = 4;
const DROPDOWN_FIRST_COLUMN = 7;

export interface BuildTemplateOptions {
  locale?: string;
  /** `readable` adds the note that states the soft-fail. */
  projection?: TemplateProjectionSource;
}

/**
 * Build the template workbook. The first sheet is the template — the import
 * reader reads the first worksheet when no `sheet` is named — with the header
 * row and one example row; the second is the instructions, whose columns to
 * the right of the field table double as the dropdowns' source ranges (an
 * inline list is capped at 255 characters, a range is not).
 */
export async function buildImportTemplateWorkbook(
  columns: readonly TemplateColumn[],
  opts: BuildTemplateOptions = {},
): Promise<Workbook> {
  const text = templateText(opts.locale);
  const ExcelJS = await loadExcelJs();
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(text.templateSheet, { views: [{ state: 'frozen', ySplit: 1 }] });
  const guide = wb.addWorksheet(text.instructionsSheet);

  // Template: header + example row.
  const header = sheet.addRow(columns.map((c) => c.header));
  header.font = { bold: true };
  const example = sheet.addRow(columns.map((c) => (c.example === undefined ? null : c.example)));
  example.font = { italic: true, color: { argb: 'FF808080' } };
  columns.forEach((c, i) => {
    const col = sheet.getColumn(i + 1);
    col.width = Math.min(Math.max(c.header.length + 4, 12), 40);
    if (c.textFormat) col.numFmt = '@';
  });

  // Instructions: notes, then one row per column.
  const notes = opts.projection === 'readable' ? [...text.notes, text.readProjectionNote] : text.notes;
  notes.forEach((note, i) => { guide.getCell(i + 1, 1).value = note; });
  const headingRow = guide.getRow(INSTRUCTIONS_TABLE_HEADER_ROW);
  text.headings.forEach((h, i) => { headingRow.getCell(i + 1).value = h; });
  headingRow.font = { bold: true };
  columns.forEach((c, i) => {
    const row = guide.getRow(INSTRUCTIONS_TABLE_HEADER_ROW + 1 + i);
    row.getCell(1).value = c.header;
    row.getCell(2).value = c.field;
    row.getCell(3).value = c.type;
    row.getCell(4).value = c.required ? text.required : text.optional;
    row.getCell(5).value = c.howToFill;
    row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
  });
  guide.getColumn(1).width = 24;
  guide.getColumn(2).width = 24;
  guide.getColumn(3).width = 14;
  guide.getColumn(4).width = 10;
  guide.getColumn(5).width = 80;

  // Dropdowns: each list in its own column of the instructions sheet, and a
  // list validation over the template column that references it.
  const validations = rangeValidations(sheet);
  const quotedGuide = `'${text.instructionsSheet.replace(/'/g, "''")}'`;
  let listColumn = DROPDOWN_FIRST_COLUMN;
  columns.forEach((c, i) => {
    if (!c.dropdown || c.dropdown.length === 0) return;
    const letter = columnLetter(listColumn);
    guide.getCell(INSTRUCTIONS_TABLE_HEADER_ROW, listColumn).value = c.header;
    guide.getCell(INSTRUCTIONS_TABLE_HEADER_ROW, listColumn).font = { bold: true };
    c.dropdown.forEach((v, j) => { guide.getCell(INSTRUCTIONS_TABLE_HEADER_ROW + 1 + j, listColumn).value = v; });
    const first = INSTRUCTIONS_TABLE_HEADER_ROW + 1;
    const last = INSTRUCTIONS_TABLE_HEADER_ROW + c.dropdown.length;
    const target = columnLetter(i + 1);
    validations.add(`${target}2:${target}${TEMPLATE_VALIDATED_ROWS + 1}`, {
      type: 'list',
      allowBlank: true,
      formulae: [`${quotedGuide}!$${letter}$${first}:$${letter}$${last}`],
      showErrorMessage: true,
      // `warning`, not `stop`: the reader also takes an option's code and
      // every boolean token, so a value outside the list may still be right.
      errorStyle: 'warning',
      errorTitle: c.header,
      error: c.howToFill.slice(0, 255),
    });
    listColumn += 1;
  });

  return wb;
}
