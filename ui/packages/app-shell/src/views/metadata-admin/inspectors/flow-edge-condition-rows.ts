// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-edge-condition-rows — the bridge between a flow edge's guard (a CEL
 * predicate) and the field / operator / value rows the list toolbar's
 * `FilterBuilder` edits (objectstack#34818 item 3).
 *
 * The edge inspector offers the rows by default and keeps the formula one
 * click away. This module owns both halves of that switch:
 *
 *  - {@link rowsToCel} WRITES the rows as CEL, in one fixed spelling per
 *    operator (below). A row it cannot spell faithfully is REFUSED by id, never
 *    written in a spelling that means something else.
 *  - {@link celToRows} READS a stored guard back into rows ONLY when it is
 *    byte for byte what {@link rowsToCel} writes for the rows it read. Every
 *    other guard (hand-written, a flow variable, `previous.*`, a spacing the
 *    writer does not use) answers `null`, and the inspector opens it in the
 *    formula input unchanged. That re-write check is the round-trip rule
 *    itself, not a heuristic beside it: nothing is adopted that a later edit
 *    could re-spell.
 *
 * ## The spellings
 *
 * Subjects are the field spellings the edge's scope already offers (the
 * `TriggerScope` prefix plus the field name — `record.meeting_date`), so a row
 * names exactly what the formula picker would insert.
 *
 * - `equals` / `not_equals` → `S == V` / `S != V`.
 * - Ordering (`greater_than` … `less_than_or_equal`, and a date column's
 *   `after` / `before`) → `S != null && S > V`. CEL has no `null` overload for
 *   an ordering comparison, and the server's null-guard gate refuses one whose
 *   operand may be null unless an explicit `!= null` test guards it
 *   (objectstack#27513) — the guard `ConditionBuilder` writes too.
 * - `between` → `S != null && S >= A && S <= B`.
 * - `contains` / `starts_with` / `ends_with` → `S != null && S.contains(V)`
 *   (a CEL string method faults on `null`); `not_contains` →
 *   `S == null || !S.contains(V)`.
 * - `in` / `not_in` → `S in [A, B]` / `!(S in [A, B])`.
 * - `is_empty` / `is_not_empty` → the spec's ruled 「is empty」 table
 *   (`expandEmptyOperator`), in the clauses `ConditionBuilder` writes:
 *   `S == null`, plus `S == ''` on a text column or `size(S) == 0` on a
 *   multi-value one. `is_null` / `is_not_null` (and `notExists` / `exists`)
 *   → `S == null` / `S != null`.
 *
 * Values follow the column: a number column writes the number, a boolean
 * column `true` / `false`, a date column a `'YYYY-MM-DD'` literal or one of
 * the builder's relative points as the formula stdlib's calendar functions —
 * `{today}` → `today()`, `{yesterday}` → `daysAgo(1)`, `{tomorrow}` →
 * `daysFromNow(1)` — and every other column a single-quoted string. So 「会议日期
 * 晚于 今天」 is `record.meeting_date != null && record.meeting_date > today()`.
 *
 * Refused (the row stays on screen and says so; the formula holds it):
 * `icontains`; a datetime or time literal (the builder's `datetime-local`
 * value carries no zone, and a guessed one moves the instant); a relative
 * window (`this_week`) on `between`; any operator the builder does not offer
 * for the column's type; and every operator but the empty checks on a
 * multi-value column.
 *
 * Rows joined by OR or AND (one join, as the builder has one `logic`); a row
 * that writes more than one clause is parenthesised when it is joined.
 */

import { operatorsForFieldType, isFilterValueComplete } from '@object-ui/components';
import { expandEmptyOperator, type EmptyOperatorArm } from '@objectstack/spec/data';
import { FILTER_DATE_LIKE_TYPES, FILTER_LOOKUP_LIKE_TYPES, FILTER_NUMBER_LIKE_TYPES, FILTER_SELECT_LIKE_TYPES } from '@object-ui/types';

/** One column the rows may name: `value` is its CEL subject (`record.meeting_date`). */
export interface EdgeConditionField {
  value: string;
  label: string;
  type?: string;
  multiple?: boolean;
  options?: Array<{ value: string; label: string }>;
}

/** One builder row — the `FilterBuilder`'s own row shape. */
export interface EdgeConditionRow {
  id?: string;
  field: string;
  operator: string;
  value?: unknown;
}

/** The builder's group: one `logic` over flat rows. */
export interface EdgeConditionGroup {
  id?: string;
  logic: 'and' | 'or';
  conditions: EdgeConditionRow[];
}

/** {@link rowsToCel}'s answer: the guard, or the ids of the rows it refused. */
export type RowsToCelResult = { ok: true; cel: string } | { ok: false; refused: string[] };

type Kind = 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'lookup' | 'text';

const NUMBER_TYPES: readonly string[] = FILTER_NUMBER_LIKE_TYPES;
const SELECT_TYPES: readonly string[] = FILTER_SELECT_LIKE_TYPES;
const LOOKUP_TYPES: readonly string[] = FILTER_LOOKUP_LIKE_TYPES;
const DATE_TYPES: readonly string[] = FILTER_DATE_LIKE_TYPES;

/** The builder's bucket for a column, with `date` told apart from `datetime` / `time`. */
function kindOf(field: EdgeConditionField): Kind {
  const type = field.type || 'text';
  if (NUMBER_TYPES.includes(type)) return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'date') return 'date';
  if (DATE_TYPES.includes(type)) return 'datetime';
  if (SELECT_TYPES.includes(type)) return 'select';
  if (LOOKUP_TYPES.includes(type)) return 'lookup';
  return 'text';
}

/** The builder's relative points (`filterRelativeDates`), as the formula stdlib's calendar calls. */
const RELATIVE_POINT_CEL: Readonly<Record<string, string>> = {
  '{today}': 'today()',
  '{yesterday}': 'daysAgo(1)',
  '{tomorrow}': 'daysFromNow(1)',
};
const CEL_RELATIVE_POINT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RELATIVE_POINT_CEL).map(([point, cel]) => [cel, point]),
);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function unquote(literal: string): string {
  return literal.slice(1, -1).replace(/\\(.)/g, '$1');
}

/** One value as a CEL literal for `kind`, or `undefined` when it has no faithful spelling. */
function literalOf(value: unknown, kind: Kind): string | undefined {
  switch (kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
    case 'boolean':
      if (value === true || value === 'true') return 'true';
      if (value === false || value === 'false') return 'false';
      return undefined;
    case 'date':
      if (typeof value !== 'string') return undefined;
      if (RELATIVE_POINT_CEL[value]) return RELATIVE_POINT_CEL[value];
      return ISO_DATE_RE.test(value) ? quote(value) : undefined;
    case 'datetime':
      // Only the relative points: a `datetime-local` literal carries no zone.
      return typeof value === 'string' ? RELATIVE_POINT_CEL[value] : undefined;
    default:
      return typeof value === 'string' ? quote(value) : undefined;
  }
}

/** What a CEL literal reads back as for `kind` — the inverse of {@link literalOf}. */
function valueOf(literal: string, kind: Kind): unknown {
  if (CEL_RELATIVE_POINT[literal]) return CEL_RELATIVE_POINT[literal];
  if (literal.startsWith("'")) return unquote(literal);
  if (literal === 'true') return true;
  if (literal === 'false') return false;
  if (kind === 'number') return Number(literal);
  return literal;
}

function emptyArm(field: EdgeConditionField): EmptyOperatorArm {
  return expandEmptyOperator({ type: field.type || 'text', multiple: field.multiple === true }).arm;
}

function offered(field: EdgeConditionField, operator: string): boolean {
  return operatorsForFieldType(field.type).some((o) => o.value === operator);
}

const ORDERING: Readonly<Record<string, string>> = {
  greater_than: '>', after: '>',
  less_than: '<', before: '<',
  greater_than_or_equal: '>=', less_than_or_equal: '<=',
};
const STRING_METHOD: Readonly<Record<string, string>> = {
  contains: 'contains', starts_with: 'startsWith', ends_with: 'endsWith',
};
const VALUELESS = new Set(['is_empty', 'is_not_empty', 'is_null', 'is_not_null', 'exists', 'notExists']);

/** One complete row's CEL and whether it is more than one clause; `null` = refused. */
function rowCel(row: EdgeConditionRow, field: EdgeConditionField): { cel: string; compound: boolean } | null {
  const s = field.value;
  const op = row.operator;
  if (!offered(field, op)) return null;
  const kind = kindOf(field);
  if (field.multiple === true && op !== 'is_empty' && op !== 'is_not_empty') return null;
  switch (op) {
    case 'is_empty':
    case 'is_not_empty': {
      const empty = op === 'is_empty';
      const arm = emptyArm(field);
      const nullClause = `${s} ${empty ? '==' : '!='} null`;
      if (arm === 'null_only') return { cel: nullClause, compound: false };
      const second = arm === 'text' ? `${s} ${empty ? '==' : '!='} ''` : `size(${s}) ${empty ? '==' : '!='} 0`;
      return { cel: `${nullClause} ${empty ? '||' : '&&'} ${second}`, compound: true };
    }
    case 'is_null':
    case 'notExists':
      return { cel: `${s} == null`, compound: false };
    case 'is_not_null':
    case 'exists':
      return { cel: `${s} != null`, compound: false };
    case 'equals':
    case 'not_equals': {
      const v = literalOf(row.value, kind);
      return v === undefined ? null : { cel: `${s} ${op === 'equals' ? '==' : '!='} ${v}`, compound: false };
    }
    case 'between': {
      if (!Array.isArray(row.value) || row.value.length !== 2) return null;
      const lo = literalOf(row.value[0], kind);
      const hi = literalOf(row.value[1], kind);
      if (lo === undefined || hi === undefined) return null;
      return { cel: `${s} != null && ${s} >= ${lo} && ${s} <= ${hi}`, compound: true };
    }
    case 'in':
    case 'not_in': {
      if (!Array.isArray(row.value) || row.value.length === 0) return null;
      const items = row.value.map((v) => literalOf(v, kind));
      if (items.some((v) => v === undefined)) return null;
      const list = `${s} in [${items.join(', ')}]`;
      return { cel: op === 'in' ? list : `!(${list})`, compound: false };
    }
    case 'not_contains': {
      if (kind !== 'text' || typeof row.value !== 'string') return null;
      return { cel: `${s} == null || !${s}.contains(${quote(row.value)})`, compound: true };
    }
    default: {
      if (ORDERING[op]) {
        const v = literalOf(row.value, kind);
        return v === undefined ? null : { cel: `${s} != null && ${s} ${ORDERING[op]} ${v}`, compound: true };
      }
      if (STRING_METHOD[op]) {
        if (kind !== 'text' || typeof row.value !== 'string') return null;
        return { cel: `${s} != null && ${s}.${STRING_METHOD[op]}(${quote(row.value)})`, compound: true };
      }
      return null;
    }
  }
}

/**
 * A row the author has not finished — no column yet, or a value still missing
 * — is neither written nor refused: it stays on screen while it is built.
 */
function isInProgress(row: EdgeConditionRow, field: EdgeConditionField | undefined): boolean {
  if (!row.field || !field) return true;
  if (VALUELESS.has(row.operator)) return false;
  return !isFilterValueComplete(row.operator, row.value as never);
}

/** Write the rows as one CEL guard; `''` when no row is finished. */
export function rowsToCel(group: EdgeConditionGroup, fields: ReadonlyArray<EdgeConditionField>): RowsToCelResult {
  const byValue = new Map(fields.map((f) => [f.value, f]));
  const terms: Array<{ cel: string; compound: boolean }> = [];
  const refused: string[] = [];
  group.conditions.forEach((row, i) => {
    const field = byValue.get(row.field);
    if (isInProgress(row, field)) return;
    const term = rowCel(row, field!);
    if (term) terms.push(term);
    else refused.push(row.id ?? String(i));
  });
  if (refused.length > 0) return { ok: false, refused };
  const join = group.logic === 'or' ? ' || ' : ' && ';
  const cel = terms.map((t) => (t.compound && terms.length > 1 ? `(${t.cel})` : t.cel)).join(join);
  return { ok: true, cel };
}

// ── Read-back ───────────────────────────────────────────────────────────────

const SUBJECT = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*';
const STRING_LIT = "'(?:[^'\\\\]|\\\\.)*'";
const LITERAL = `(?:${STRING_LIT}|-?\\d+(?:\\.\\d+)?|true|false|today\\(\\)|daysAgo\\(1\\)|daysFromNow\\(1\\))`;
const LIST = `\\[(?:${LITERAL}(?:, ${LITERAL})*)\\]`;

const re = (body: string) => new RegExp(`^${body}$`);
/**
 * The term shapes {@link rowsToCel} writes, most specific first. `nullTest`
 * marks the bare `S == null` / `S != null`, whose operator depends on the
 * column (see {@link readTerm}).
 */
const TERM_PATTERNS: ReadonlyArray<{
  re: RegExp;
  read: (m: RegExpExecArray, kind: Kind) => Omit<EdgeConditionRow, 'field'> | null;
  nullTest?: boolean;
}> = [
  { re: re(`(${SUBJECT}) != null && \\1 >= (${LITERAL}) && \\1 <= (${LITERAL})`), read: (m, k) => ({ operator: 'between', value: [valueOf(m[2], k), valueOf(m[3], k)] }) },
  {
    re: re(`(${SUBJECT}) != null && \\1 (>=|<=|>|<) (${LITERAL})`),
    read: (m, k) => {
      const date = k === 'date' || k === 'datetime';
      const op = { '>': date ? 'after' : 'greater_than', '<': date ? 'before' : 'less_than', '>=': 'greater_than_or_equal', '<=': 'less_than_or_equal' }[m[2]]!;
      return { operator: op, value: valueOf(m[3], k) };
    },
  },
  { re: re(`(${SUBJECT}) != null && \\1\\.(contains|startsWith|endsWith)\\((${STRING_LIT})\\)`), read: (m) => ({ operator: { contains: 'contains', startsWith: 'starts_with', endsWith: 'ends_with' }[m[2]]!, value: unquote(m[3]) }) },
  { re: re(`(${SUBJECT}) == null \\|\\| !\\1\\.contains\\((${STRING_LIT})\\)`), read: (m) => ({ operator: 'not_contains', value: unquote(m[2]) }) },
  { re: re(`(${SUBJECT}) == null \\|\\| (?:\\1 == ''|size\\(\\1\\) == 0)`), read: () => ({ operator: 'is_empty' }) },
  { re: re(`(${SUBJECT}) != null && (?:\\1 != ''|size\\(\\1\\) != 0)`), read: () => ({ operator: 'is_not_empty' }) },
  { re: re(`(${SUBJECT}) (==|!=) null`), read: () => null, nullTest: true },
  { re: re(`!\\((${SUBJECT}) in (${LIST})\\)`), read: (m, k) => ({ operator: 'not_in', value: listOf(m[2], k) }) },
  { re: re(`(${SUBJECT}) in (${LIST})`), read: (m, k) => ({ operator: 'in', value: listOf(m[2], k) }) },
  { re: re(`(${SUBJECT}) (==|!=) (${LITERAL})`), read: (m, k) => ({ operator: m[2] === '==' ? 'equals' : 'not_equals', value: valueOf(m[3], k) }) },
];

function listOf(list: string, kind: Kind): unknown[] {
  return (list.slice(1, -1).match(new RegExp(LITERAL, 'g')) ?? []).map((lit) => valueOf(lit, kind));
}

/** One term (no outer parentheses) as a row, or `null`. */
function readTerm(text: string, byValue: ReadonlyMap<string, EdgeConditionField>): EdgeConditionRow | null {
  for (const pattern of TERM_PATTERNS) {
    const m = pattern.re.exec(text);
    if (!m) continue;
    const field = byValue.get(m[1]);
    if (!field) return null;
    if (pattern.nullTest) {
      // `S == null` is the empty check on a column whose empty value is null
      // alone, and the null test on every other column.
      const nullOnly = emptyArm(field) === 'null_only';
      const operator = m[2] === '==' ? (nullOnly ? 'is_empty' : 'is_null') : nullOnly ? 'is_not_empty' : 'is_not_null';
      return { field: field.value, operator };
    }
    const row = pattern.read(m, kindOf(field));
    return row ? { field: field.value, ...row } : null;
  }
  return null;
}

/** Split `text` at its top-level ` && ` / ` || ` — one join only — or `null`. */
function splitTopLevel(text: string): { parts: string[]; logic: 'and' | 'or' } | null {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  let logic: 'and' | 'or' | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === "'") quoted = false;
      continue;
    }
    if (c === "'") quoted = true;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (text.startsWith(' && ', i) || text.startsWith(' || ', i))) {
      const here = text[i + 1] === '&' ? 'and' : 'or';
      if (logic && logic !== here) return null;
      logic = here;
      parts.push(text.slice(start, i));
      start = i + 4;
      i += 3;
    }
    if (depth < 0) return null;
  }
  if (quoted || depth !== 0 || !logic) return null;
  parts.push(text.slice(start));
  return { parts, logic };
}

/**
 * Read a stored guard into rows, or `null` when it is not exactly what
 * {@link rowsToCel} writes for those rows — the formula input keeps it then.
 * An empty guard reads as no rows.
 */
export function celToRows(cel: string, fields: ReadonlyArray<EdgeConditionField>): EdgeConditionGroup | null {
  const byValue = new Map(fields.map((f) => [f.value, f]));
  const withIds = (logic: 'and' | 'or', rows: EdgeConditionRow[]): EdgeConditionGroup => ({
    logic,
    conditions: rows.map((r, i) => ({ id: `edge-row-${i}`, ...r })),
  });
  const verified = (group: EdgeConditionGroup): EdgeConditionGroup | null => {
    const back = rowsToCel(group, fields);
    return back.ok && back.cel === cel ? group : null;
  };
  if (cel === '') return withIds('and', []);
  const single = readTerm(cel, byValue);
  if (single) {
    const group = verified(withIds('and', [single]));
    if (group) return group;
  }
  const split = splitTopLevel(cel);
  if (!split) return null;
  const rows: EdgeConditionRow[] = [];
  for (const part of split.parts) {
    const inner = part.startsWith('(') && part.endsWith(')') ? part.slice(1, -1) : part;
    const row = readTerm(inner, byValue);
    if (!row) return null;
    rows.push(row);
  }
  return verified(withIds(split.logic, rows));
}
