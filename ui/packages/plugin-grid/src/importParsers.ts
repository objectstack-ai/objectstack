/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 *
 * Pure parsing & type-inference helpers for the Import Wizard. Kept free of
 * React so they can be unit-tested in isolation and so the (heavier) Excel
 * parser can be code-split behind a dynamic import — CSV/paste imports never
 * pay for ExcelJS.
 *
 * Every parser produces the same shape the wizard consumes: a `string[][]`
 * whose first row is the header. Empty rows are dropped to match the
 * spreadsheet "trailing blank lines don't count" intuition.
 */

/** A column's inferred semantic type, used to power smart mapping & UI hints. */
export type InferredType = 'text' | 'number' | 'boolean' | 'date' | 'datetime';

/** Error codes thrown by {@link parseSpreadsheetFile}; callers map these to i18n. */
export const ImportParseError = {
  /** Extension is neither a delimited text file nor a supported spreadsheet. */
  Unsupported: 'IMPORT_UNSUPPORTED_FILE',
  /** Legacy binary .xls — ExcelJS only reads OOXML (.xlsx). */
  LegacyXls: 'IMPORT_LEGACY_XLS',
} as const;

/**
 * Quote-aware parser for delimited text (CSV/TSV). Handles RFC-4180 style
 * doubled quotes and quoted fields containing the delimiter or newlines.
 * Trailing whitespace on each field is trimmed, and all-empty rows skipped.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') { inQuotes = true; }
    else if (ch === delimiter) { row.push(field.trim()); field = ''; }
    else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(field.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = []; field = '';
      if (ch === '\r') i++;
    } else { field += ch; }
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** Back-compat alias — the wizard historically called this `parseCSV`. */
export const parseCSV = (text: string): string[][] => parseDelimited(text, ',');

/** Format an ExcelJS cell value into the canonical string the wizard expects. */
function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const iso = v.toISOString();
    // Pure dates (midnight UTC) render as YYYY-MM-DD; keep time otherwise.
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // Formula cell → use its computed result.
    if ('result' in o) return formatCellValue(o.result);
    // Rich text → concatenate runs.
    if (Array.isArray(o.richText)) return o.richText.map((r) => String((r as { text?: unknown }).text ?? '')).join('');
    // Hyperlink → prefer display text.
    if ('text' in o) return formatCellValue(o.text);
    if ('hyperlink' in o) return String(o.hyperlink ?? '');
    if ('error' in o) return String(o.error ?? '');
    return '';
  }
  return String(v);
}

/**
 * Parse the first worksheet of an .xlsx workbook into `string[][]`. ExcelJS is
 * loaded lazily so it stays out of the main bundle.
 */
export async function parseExcelArrayBuffer(buffer: ArrayBuffer): Promise<string[][]> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const width = ws.columnCount;
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (excelRow) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) {
      cells.push(formatCellValue(excelRow.getCell(c).value).trim());
    }
    if (cells.some((c) => c !== '')) rows.push(cells);
  });
  return rows;
}

/**
 * Decode a delimited-text import file's bytes into a string. Real-world
 * spreadsheet CSVs are not reliably UTF-8 — zh-CN Excel's "另存为 CSV" writes
 * GBK, which `file.text()` (always UTF-8) turns into mojibake headers that can
 * never be mapped — so the encoding is sniffed instead of assumed:
 *   1. An explicit BOM (UTF-8 / UTF-16 LE / UTF-16 BE) wins.
 *   2. Otherwise try strict UTF-8; its validation rejects GBK multi-byte runs.
 *   3. Fall back to GB18030 (a superset of GBK/GB2312), the dominant
 *      non-UTF-8 CSV encoding in practice.
 */
export function decodeSpreadsheetText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch {
      // Runtimes without the gb18030 decoder (e.g. small-ICU Node) — degrade
      // to lossy UTF-8 rather than failing the whole import.
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

/**
 * The delimiter a delimited-text import file is read with, picked off its
 * name: `.tsv` is tab-delimited, `.csv` and `.txt` are comma-delimited, and
 * every other file answers `null`. {@link parseSpreadsheetFile} picks its text
 * arm by this answer, and the import wizard sends a file it answers for to the
 * server's CSV import door (objectui#13315), so the two read "a CSV file" the
 * same way.
 */
export function delimitedFileDelimiter(fileName: string): ',' | '\t' | null {
  const name = fileName.toLowerCase();
  if (name.endsWith('.tsv')) return '\t';
  if (name.endsWith('.csv') || name.endsWith('.txt')) return ',';
  return null;
}

/**
 * Parse any supported import file into `string[][]`. Delimited text is
 * decoded via {@link decodeSpreadsheetText} (UTF-8 with GB18030 fallback);
 * .xlsx is parsed via {@link parseExcelArrayBuffer}. Throws an
 * {@link ImportParseError} code for unsupported / legacy formats.
 */
export async function parseSpreadsheetFile(file: File): Promise<string[][]> {
  const delimiter = delimitedFileDelimiter(file.name);
  if (delimiter) {
    const text = decodeSpreadsheetText(await file.arrayBuffer());
    return parseDelimited(text, delimiter);
  }
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    return parseExcelArrayBuffer(await file.arrayBuffer());
  }
  if (name.endsWith('.xls')) throw new Error(ImportParseError.LegacyXls);
  throw new Error(ImportParseError.Unsupported);
}

/**
 * Parse a paste payload (clipboard) into `string[][]`. Prefers an HTML
 * `<table>` (what Excel/Sheets put on the clipboard, preserving structure),
 * falling back to tab- or comma-delimited plain text. Returns `null` when the
 * payload holds no tabular data.
 */
export function parseClipboardTable(html: string | null, text: string | null): string[][] | null {
  if (html && /<table[\s>]/i.test(html) && typeof DOMParser !== 'undefined') {
    const rows = parseHtmlTable(html);
    if (rows.length) return rows;
  }
  if (text && text.trim()) {
    // Excel/Sheets copy as TSV; lone-value pastes have neither tab nor comma.
    const delimiter = text.includes('\t') ? '\t' : ',';
    const rows = parseDelimited(text, delimiter);
    if (rows.length) return rows;
  }
  return null;
}

function parseHtmlTable(html: string): string[][] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return [];
  const out: string[][] = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll('th,td').forEach((td) => cells.push((td.textContent ?? '').trim()));
    if (cells.some((c) => c !== '')) out.push(cells);
  });
  return out;
}

/** Boolean-looking tokens, excluding 0/1 (those read as numbers, not flags). */
const BOOLEAN_TOKENS = new Set(['true', 'false', 'yes', 'no', 'y', 'n', '是', '否']);
/** Max cells sampled per column when inferring type — caps cost on huge files. */
const INFER_SAMPLE_LIMIT = 50;

const isNumberLike = (s: string) => s !== '' && !isNaN(Number(s));
const isBooleanLike = (s: string) => BOOLEAN_TOKENS.has(s.toLowerCase());
const hasTimeComponent = (s: string) => /\d{1,2}:\d{2}/.test(s) || /T\d{2}:\d{2}/.test(s);

// ── Date shapes ──────────────────────────────────────────────────────────
// `Date.parse` alone is not a date test: V8's legacy parser skips unknown
// words before the first number and reads any word whose first three letters
// spell a month, so `Phase 2`, `Room 12`, `Imported QA task 1` and
// `Marketing 2026` all parse (objectui#11813). A value must first have an
// explicit date shape; `Date.parse` then only confirms the parts are in range.
// Shape only: which of day and month comes first in `07/10/2026` stays
// `Date.parse`'s call.

/** A clock time that may follow a numeric date: `T12:00`, ` 09:30:15.250`, ` 2:30 PM`, with an optional zone. */
const TIME_SUFFIX = String.raw`(?:(?:T|,?\s+)\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[ap]m)?(?:\s*(?:z|utc|gmt))?(?:\s*[+-]\d{2}:?\d{2})?)?`;

/**
 * Numeric dates: year first (`2026-10-07`, `2026/10/07`, ISO-8601 date-times
 * such as `2026-10-07T12:00:00Z`), or day and month first with a two- or
 * four-digit year (`10/07/2026`, `7.10.2026`, `10/7/26`). Both separators must
 * match, so a code like `A-12` or a version like `1.2.3` has no date shape.
 */
const NUMERIC_DATE = new RegExp(
  String.raw`^(?:\d{4}([-/.])\d{1,2}\1\d{1,2}|\d{1,2}([-/.])\d{1,2}\2(?:\d{4}|\d{2}))${TIME_SUFFIX}$`,
  'i',
);
/** ISO-8601 year and month: `2026-10`. */
const ISO_YEAR_MONTH = /^\d{4}-\d{1,2}$/;

/** English month names and their abbreviations: the only month words `Date.parse` reads by name. */
const MONTH_WORDS = new Set([
  'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june',
  'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov', 'november',
  'dec', 'december',
]);
/** Every other word a month-name date may carry: weekdays, meridiem and zone markers. */
const CALENDAR_WORDS = new Set([
  ...MONTH_WORDS,
  'mon', 'monday', 'tue', 'tues', 'tuesday', 'wed', 'wednesday', 'thu', 'thur', 'thurs', 'thursday',
  'fri', 'friday', 'sat', 'saturday', 'sun', 'sunday', 'am', 'pm', 'utc', 'gmt', 'z',
]);

/**
 * Month-name dates (`Oct 7, 2026`, `7 October 2026`, `7-Oct-2026`,
 * `Wed, 07 Oct 2026 12:00:00 GMT`): a digit, a month name, and no word that is
 * not a calendar word — so `Room 101, Oct` and `Marketing 2026` are text.
 */
function isMonthNameDate(s: string): boolean {
  if (!/\d/.test(s)) return false;
  const words = s.toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.some((w) => MONTH_WORDS.has(w)) && words.every((w) => CALENDAR_WORDS.has(w));
}

const hasDateShape = (s: string) => NUMERIC_DATE.test(s) || ISO_YEAR_MONTH.test(s) || isMonthNameDate(s);
const isDateLike = (s: string) => !isNumberLike(s) && hasDateShape(s) && !isNaN(Date.parse(s));

/**
 * Infer a column's semantic type from a sample of its values. Empty cells are
 * ignored; a column is only assigned a non-text type when *every* sampled value
 * matches it (conservative — avoids mislabelling mixed columns). Order matters:
 * boolean before number before date so 0/1 stay numeric and years stay numbers.
 */
export function inferColumnType(values: Array<string | undefined>): InferredType {
  const samples = values
    .map((v) => (v ?? '').trim())
    .filter((v) => v !== '')
    .slice(0, INFER_SAMPLE_LIMIT);
  if (samples.length === 0) return 'text';
  if (samples.every(isBooleanLike)) return 'boolean';
  if (samples.every(isNumberLike)) return 'number';
  if (samples.every(isDateLike)) return samples.some(hasTimeComponent) ? 'datetime' : 'date';
  return 'text';
}

/** Whether an inferred column type can reasonably feed a given object field type. */
export function isTypeCompatible(inferred: InferredType, fieldType: string): boolean {
  switch (inferred) {
    case 'number': return ['number', 'currency', 'percent'].includes(fieldType);
    case 'boolean': return fieldType === 'boolean';
    case 'date': case 'datetime': return fieldType === 'date' || fieldType === 'datetime';
    case 'text': return true;
    default: return true;
  }
}

// ── Airtable-style column → field mapping suggestions ───────────────────

/** Normalize a header/field key: lower-case, strip separators/punctuation.
 *  Also strips the `*`/`＊` required-marker our downloaded templates append to
 *  header labels, so a filled-in template round-trips back to the same field. */
const normalizeKey = (s: string): string =>
  s.toLowerCase().replace(/[\s_\-.]+/g, '').replace(/[()（）[\]{}:：,，、/*＊]/g, '');

/** Split a header/label into comparable tokens (space/underscore/case/CJK aware). */
function tokenize(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_\-./()（）[\]{}:：,，、*＊]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Bilingual synonym groups — headers and field names in the same group are
 * treated as strong matches even when neither contains the other (e.g. a
 * `邮箱` column onto an `email` field). Deliberately conservative: only
 * unambiguous, common CRM/spreadsheet concepts.
 */
const SYNONYM_GROUPS: string[][] = [
  ['name', 'fullname', 'displayname', '姓名', '名称', '名字'],
  ['email', 'emailaddress', 'mail', '邮箱', '电子邮箱', '邮件'],
  ['phone', 'tel', 'telephone', 'mobile', 'cell', '手机', '电话', '手机号', '联系电话'],
  ['date', '日期'],
  ['datetime', 'timestamp', '时间', '日期时间'],
  ['amount', 'price', 'total', 'cost', '金额', '价格', '总额', '总价', '费用'],
  ['status', 'state', '状态'],
  ['address', '地址'],
  ['company', 'organization', 'org', '公司', '单位', '组织', '企业'],
  ['description', 'desc', 'note', 'notes', 'remark', 'remarks', '备注', '描述', '说明'],
  ['id', 'code', 'number', 'no', '编号', '编码', '代码'],
  ['quantity', 'qty', 'count', '数量'],
  ['country', '国家'], ['city', '城市'], ['province', 'state', '省份', '省'],
  ['gender', 'sex', '性别'], ['age', '年龄'],
  ['title', '标题', '职位', '头衔'],
  ['owner', 'assignee', 'assignedto', '负责人', '负责', '所有者', '归属人'],
  ['createdat', 'createdon', 'createtime', '创建时间'],
  ['updatedat', 'updatedon', 'modifiedtime', '更新时间'],
];

const SYNONYM_INDEX: Map<string, number> = (() => {
  const m = new Map<string, number>();
  SYNONYM_GROUPS.forEach((group, gi) => group.forEach((k) => m.set(normalizeKey(k), gi)));
  return m;
})();

/** Confidence bucket used for the mapping UI badge. */
export type MappingConfidence = 'high' | 'medium' | 'low';

/** Why a column was matched to a field — drives the UI hint text. */
export type MappingReason = 'exact' | 'normalized' | 'synonym' | 'contains' | 'token' | 'none';

/** A per-column mapping suggestion with a confidence score, à la Airtable. */
export interface ColumnSuggestion {
  columnIndex: number;
  /** The suggested field name, or `null` when nothing matched confidently. */
  fieldName: string | null;
  /** Match strength in [0, 1]. */
  score: number;
  confidence: MappingConfidence | null;
  reason: MappingReason;
  /** Content-inferred type of the column (for the type-mismatch hint). */
  inferredType: InferredType;
}

/** Minimal field descriptor the mapper needs (keeps this module React-free). */
export interface MappableField {
  name: string;
  label?: string;
  type: string;
}

/** Map a raw score to a confidence bucket (null → not assigned). */
export function scoreToConfidence(score: number): MappingConfidence | null {
  if (score >= 0.85) return 'high';
  if (score >= 0.55) return 'medium';
  if (score > 0) return 'low';
  return null;
}

/** Minimum score for a column/field pair to be auto-applied. */
const MIN_MATCH_SCORE = 0.4;

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  sa.forEach((x) => { if (sb.has(x)) inter++; });
  return inter / (sa.size + sb.size - inter);
}

/** Best (score, reason) for a single header ↔ field pair. */
function scorePair(header: string, field: MappableField, inferred: InferredType): { score: number; reason: MappingReason } {
  const targets = [field.name, field.label].filter((s): s is string => !!s);
  const hNorm = normalizeKey(header);
  const hTokens = tokenize(header);
  // Held as one record rather than two captured `let`s: `bump` only ever
  // mutates them from inside a closure, which TypeScript's control-flow
  // analysis does not track — it would still believe `reason` is `'none'` at
  // the type gate below and report those comparisons as non-overlapping.
  const best: { score: number; reason: MappingReason } = { score: 0, reason: 'none' };
  const bump = (s: number, r: MappingReason) => { if (s > best.score) { best.score = s; best.reason = r; } };

  for (const target of targets) {
    if (header.trim() === target.trim()) { bump(1, 'exact'); continue; }
    const tNorm = normalizeKey(target);
    if (hNorm && tNorm && hNorm === tNorm) { bump(0.95, 'normalized'); continue; }
    if (hNorm && tNorm && (hNorm.includes(tNorm) || tNorm.includes(hNorm))) {
      const ratio = Math.min(hNorm.length, tNorm.length) / Math.max(hNorm.length, tNorm.length);
      bump(0.5 + ratio * 0.35, 'contains');
    }
    const j = jaccard(hTokens, tokenize(target));
    if (j > 0) bump(0.4 + j * 0.45, 'token');
  }

  // Synonym signal — header and any target land in the same concept group.
  const hGroup = SYNONYM_INDEX.get(hNorm);
  if (hGroup !== undefined && targets.some((t) => SYNONYM_INDEX.get(normalizeKey(t)) === hGroup)) {
    bump(0.82, 'synonym');
  }

  // Type gate: for softer (non-exact) matches, reward a compatible inferred
  // type and heavily discount an incompatible one so we don't confidently map
  // a text column onto a number field just because the names rhyme.
  if (best.reason !== 'exact' && best.reason !== 'normalized' && inferred !== 'text' && best.score > 0) {
    if (isTypeCompatible(inferred, field.type)) best.score = Math.min(1, best.score + 0.05);
    else best.score *= 0.5;
  }
  return { score: best.score, reason: best.reason };
}

/**
 * Suggest a field for every source column, Airtable-style: score each
 * column/field pair on name/label similarity, bilingual synonyms, token
 * overlap and (content-inferred) type compatibility, then assign globally by
 * descending score so each column and each field is used at most once. `rows`
 * is optional — without sample data only name-based signals fire (type gates
 * are skipped). Returns one entry per column, in column order.
 */
export function suggestColumnMappings(
  headers: string[],
  fields: MappableField[],
  rows?: string[][],
): ColumnSuggestion[] {
  const inferred = headers.map((_, ci) => inferColumnType(rows ? rows.map((r) => r[ci]) : []));

  type Pair = { ci: number; field: string; score: number; reason: MappingReason };
  const pairs: Pair[] = [];
  headers.forEach((header, ci) => {
    fields.forEach((field) => {
      const { score, reason } = scorePair(header, field, inferred[ci]);
      if (score > 0) pairs.push({ ci, field: field.name, score, reason });
    });
  });
  // Greedy global assignment: highest-scoring pairs win their column + field.
  pairs.sort((a, b) => b.score - a.score);
  const usedCol = new Set<number>();
  const usedField = new Set<string>();
  const chosen = new Map<number, Pair>();
  for (const p of pairs) {
    if (p.score < MIN_MATCH_SCORE || usedCol.has(p.ci) || usedField.has(p.field)) continue;
    chosen.set(p.ci, p);
    usedCol.add(p.ci);
    usedField.add(p.field);
  }

  return headers.map((_, ci) => {
    const c = chosen.get(ci);
    if (!c) return { columnIndex: ci, fieldName: null, score: 0, confidence: null, reason: 'none' as MappingReason, inferredType: inferred[ci] };
    return { columnIndex: ci, fieldName: c.field, score: c.score, confidence: scoreToConfidence(c.score), reason: c.reason, inferredType: inferred[ci] };
  });
}
