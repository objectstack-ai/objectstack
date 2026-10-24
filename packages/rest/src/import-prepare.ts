// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Bulk-import request parsing — extracted verbatim from rest-server.ts
 * (#2766 V2) so consumers outside the generic `/data/:object/import` routes
 * (the identity import endpoint in plugin-auth) can accept byte-identical
 * payloads (rows[]/csv/xlsxBase64, mapping in either shape, writeMode +
 * matchFields) without re-implementing the parsers.
 */

import {
    buildFieldMetaMap,
    unmarkCsvTextCell,
    type ExportFieldMeta,
} from './export-format.js';
import {
    resolveNamedMapping, applyMappingToRows, refuseUnknownMappingTargets, type MappingArtifactLike,
} from './import-mapping.js';
import { asXlsxLoadInput, loadExcelJs } from './xlsx-module.js';
import { isBlank } from '@objectstack/core';
import { isMatchKeySets } from '@objectstack/spec/api';

/**
 * Minimal RFC-4180-style CSV parser used by the bulk-import endpoint
 * (M10.9). Handles quoted fields (including embedded quotes via "" and
 * embedded commas/newlines) and both CRLF and LF line endings.
 *
 * The first non-empty line is treated as the header row. Header names
 * can be re-mapped to canonical field names via the optional `mapping`
 * argument (e.g. `{ "First Name": "first_name" }`); unmapped headers
 * pass through unchanged. Empty cells become empty strings.
 *
 * [#25078] Every parsed cell, header row included, is read through
 * `unmarkCsvTextCell` (`./export-format.ts`), the import half of the CSV
 * text-cell rule the CSV export writes with: it removes exactly one leading
 * mark from a cell whose remainder the rule would have marked, and leaves every
 * other cell as parsed. It runs HERE, before any mapping, because it reads the
 * cell's text alone — a named mapping's rows keep their source headers until
 * core's `applyMappingToRows`, so no target field type is known yet. Header
 * cells are reversed before they are trimmed and looked up in `mapping`, so a
 * mapping names the header as the export labelled it. Serves every CSV door
 * that parses through `prepareImportRequest`: the sync import, the async import
 * job and plugin-auth's admin user import.
 *
 * Kept dependency-free so REST stays runtime-portable (Hono / Express
 * adapters both consume this without pulling a CSV lib transitively).
 */
export function parseCsvToRows(csv: string, mapping: Record<string, string> = {}): Array<Record<string, any>> {
    const text = csv.replace(/^\uFEFF/, ''); // strip BOM
    const cells: string[][] = [];
    let cur = '';
    let row: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cur += '"'; i++; }
                else { inQuotes = false; }
            } else {
                cur += ch;
            }
            continue;
        }
        if (ch === '"') { inQuotes = true; continue; }
        if (ch === ',') { row.push(cur); cur = ''; continue; }
        if (ch === '\r') { continue; }
        if (ch === '\n') {
            row.push(cur); cur = '';
            cells.push(row); row = [];
            continue;
        }
        cur += ch;
    }
    if (cur.length > 0 || row.length > 0) { row.push(cur); cells.push(row); }

    // Drop fully-empty trailing rows so a stray newline at EOF doesn't
    // produce a phantom empty record.
    while (cells.length > 0 && cells[cells.length - 1].every(c => c === '')) cells.pop();
    if (cells.length < 2) return [];

    const header = cells[0].map(h => unmarkCsvTextCell(h).trim());
    const fields = header.map(h => mapping[h] ?? h);
    const out: Array<Record<string, any>> = [];
    for (let r = 1; r < cells.length; r++) {
        const row = cells[r];
        const obj: Record<string, any> = {};
        for (let c = 0; c < fields.length; c++) {
            const key = fields[c];
            if (!key) continue;
            const raw = row[c] ?? '';
            obj[key] = unmarkCsvTextCell(raw);
        }
        out.push(obj);
    }
    return out;
}

/**
 * The wall clock an ExcelJS date cell shows in the sheet, as the offset-free
 * `YYYY-MM-DD HH:mm:ss` a CSV export writes.
 *
 * [#8485] An xlsx serial date carries **no timezone** — it is a clock reading,
 * and ExcelJS materialises it as a `Date` whose *UTC* components are that
 * reading (measured: a cell showing `2026-08-01 06:00:00` round-trips to
 * `2026-08-01T06:00:00.000Z` under any host `TZ`). Rendering it with
 * `toISOString()` therefore stamped a `Z` the file never had, and that
 * fabricated offset then took precedence over the caller's business timezone in
 * `parseDateCell` — which honours a written offset by contract. Every real date
 * cell in a user-authored workbook imported as UTC, whatever the tenant's zone.
 */
function xlsxDateToNaiveCell(d: Date): string {
    const p2 = (n: number) => (n < 10 ? `0${n}` : String(n));
    return (
        `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ` +
        `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
    );
}

/**
 * Flatten one ExcelJS cell value to the raw string the coercion layer expects.
 * ExcelJS hands back rich objects for formulas / hyperlinks / rich text / dates;
 * we reduce each to the human-visible text so a server-parsed xlsx yields the
 * same cells a CSV export would (dates → the sheet's own wall clock, so
 * `parseDateCell` re-reads them in the business timezone; see
 * {@link xlsxDateToNaiveCell}).
 */
function xlsxCellToString(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : xlsxDateToNaiveCell(value);
    if (typeof value === 'object') {
        // Formula cell → prefer its computed result.
        if ('result' in value && value.result !== undefined && value.result !== null) return xlsxCellToString(value.result);
        // Hyperlink cell → the visible text, not the target.
        if ('text' in value && typeof value.text === 'string') return value.text;
        if ('hyperlink' in value && typeof value.hyperlink === 'string') return value.hyperlink;
        // Rich text → concatenate runs.
        if (Array.isArray(value.richText)) return value.richText.map((r: any) => r?.text ?? '').join('');
        if ('error' in value && value.error) return String(value.error);
    }
    try { return String(value); } catch { return ''; }
}

/**
 * Parse an .xlsx workbook (raw bytes) into row objects, mirroring
 * {@link parseCsvToRows}: first non-empty row is the header, each subsequent row
 * becomes `{ header→cell }` with the optional `mapping` renaming columns. Reads
 * the named/indexed `sheet` when given, else the first worksheet. Dynamically
 * imports ExcelJS (already a dependency of the export path) so CSV/JSON imports
 * don't pay for it.
 */
export async function parseXlsxToRows(
    buffer: Buffer | ArrayBuffer,
    mapping: Record<string, string> = {},
    sheet?: string | number,
): Promise<Array<Record<string, any>>> {
    const ExcelJS = await loadExcelJs();
    const wb = new ExcelJS.Workbook();
    // The assertion is on the Node `Buffer` arm ONLY. `ArrayBuffer` is already
    // assignable to the module-local shim exceljs declares for this parameter,
    // so that arm reaches `load` unasserted and stays checked; asserting the
    // whole union would switch that check off. See `xlsx-module.ts`.
    await wb.xlsx.load(buffer instanceof ArrayBuffer ? buffer : asXlsxLoadInput(buffer));
    const ws = sheet !== undefined ? wb.getWorksheet(sheet) : wb.worksheets[0];
    if (!ws) return [];

    const cells: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
        // exceljs declares `Row.values` as the 1-based array form (index 0
        // unused) OR a keyed object; a workbook parsed from bytes yields the
        // array. The keyed shape iterates zero times either way — its `.length`
        // was `undefined` before, so the loop below never ran for it.
        const values = Array.isArray(row.values) ? row.values : [];
        const line: string[] = [];
        for (let c = 1; c < values.length; c++) line.push(xlsxCellToString(values[c]));
        cells.push(line);
    });
    while (cells.length > 0 && cells[cells.length - 1].every(c => c === '')) cells.pop();
    if (cells.length < 2) return [];

    const header = cells[0].map(h => h.trim());
    const fields = header.map(h => mapping[h] ?? h);
    const out: Array<Record<string, any>> = [];
    for (let r = 1; r < cells.length; r++) {
        const line = cells[r];
        const obj: Record<string, any> = {};
        for (let c = 0; c < fields.length; c++) {
            const key = fields[c];
            if (!key) continue;
            obj[key] = line[c] ?? '';
        }
        out.push(obj);
    }
    return out;
}

/**
 * [#25491] The per-cell rules of one inline `FieldMappingEntry`
 * (`ImportRequestSchema.mapping` in its array form), keyed by the entry's
 * target: the column has already been renamed to it when the rules run.
 */
interface InlineEntryRule {
    sourceField: string;
    targetField: string;
    transform: InlineTransform;
    hasDefault: boolean;
    defaultValue?: unknown;
    required: boolean;
}

/**
 * The transforms an inline mapping entry may declare that this path applies,
 * each to a string cell (any other value passes through). `none` and `lookup`
 * copy the cell: a `lookup` cell is resolved to a record id by the import's
 * reference resolution downstream, as the named mapping's `lookup` is.
 */
const INLINE_TRANSFORMS = {
    none: (s: string) => s,
    lookup: (s: string) => s,
    trim: (s: string) => s.trim(),
    uppercase: (s: string) => s.toUpperCase(),
    lowercase: (s: string) => s.toLowerCase(),
} as const;
type InlineTransform = keyof typeof INLINE_TRANSFORMS;

type ImportRefusal = { ok: false; status: number; code: string; error: string };

/**
 * Read one inline entry's rules, refusing a transform this path does not
 * apply instead of running the import without it. `date_format` is declared
 * by the spec, but an entry carries no format for it to apply. Returns no
 * rule for a plain rename (no transform, no default, not required), which
 * leaves the row exactly as the rename built it.
 */
function readInlineEntryRule(
    e: { sourceField: string; targetField: string; transform?: unknown; defaultValue?: unknown; required?: unknown },
): { ok: true; rule?: InlineEntryRule } | ImportRefusal {
    const transform = e.transform === undefined ? 'none' : e.transform;
    if (typeof transform !== 'string' || !Object.prototype.hasOwnProperty.call(INLINE_TRANSFORMS, transform)) {
        const named = typeof transform === 'string' ? `"${transform}"` : String(transform);
        const why = transform === 'date_format'
            ? 'a mapping entry carries no date format for it to apply; a cell mapped to a date or datetime field is already parsed as a date, so drop the transform'
            : `the transforms a mapping entry may declare are ${Object.keys(INLINE_TRANSFORMS).join(', ')}`;
        return {
            ok: false, status: 400, code: 'UNSUPPORTED_TRANSFORM',
            error: `Mapping entry "${e.sourceField}" to "${e.targetField}" declares transform ${named}, which the import path does not apply, `
                + `so the import is refused rather than run with that transform skipped: ${why}.`,
        };
    }
    const hasDefault = e.defaultValue !== undefined;
    const required = e.required === true;
    if (transform === 'none' && !hasDefault && !required) return { ok: true };
    return {
        ok: true,
        rule: {
            sourceField: e.sourceField, targetField: e.targetField,
            transform: transform as InlineTransform, hasDefault, defaultValue: e.defaultValue, required,
        },
    };
}

/**
 * Apply each inline entry's rules to every row, in place, before the cells
 * are coerced: the transform to a non-blank string cell, then `defaultValue` to a cell
 * that is blank (what cell coercion calls blank: absent, empty, whitespace or
 * one of the request's `nullValues`), then `required` to what is left. A
 * required cell still blank refuses the whole request before any row is
 * written, on the dry run and the commit alike, naming the column and the
 * rows (numbered as the row report numbers them).
 */
function applyInlineEntryRules(
    rows: Array<Record<string, any>>,
    rules: InlineEntryRule[],
    nullValues: string[] | undefined,
): ImportRefusal | undefined {
    const misses = new Map<InlineEntryRule, number[]>();
    rows.forEach((row, i) => {
        for (const rule of rules) {
            let value = row[rule.targetField];
            // Blankness is judged on the raw cell: a case transform would rewrite a
            // `nullValues` sentinel (matched exactly) out of being one, so a blank
            // cell is never transformed and stays blank for the rules below and
            // for cell coercion.
            if (typeof value === 'string' && !isBlank(value, nullValues)) value = INLINE_TRANSFORMS[rule.transform](value);
            if (rule.hasDefault && isBlank(value, nullValues)) value = rule.defaultValue;
            if (value !== undefined) row[rule.targetField] = value;
            if (rule.required && isBlank(value, nullValues)) {
                const at = misses.get(rule) ?? [];
                at.push(i + 1);
                misses.set(rule, at);
            }
        }
    });
    if (misses.size === 0) return undefined;
    const listed = [...misses].map(([rule, at]) => {
        const shown = at.length > 10 ? `${at.slice(0, 10).join(', ')} and ${at.length - 10} more` : at.join(', ');
        return `"${rule.sourceField}" to "${rule.targetField}" (row${at.length === 1 ? '' : 's'} ${shown})`;
    });
    return {
        ok: false, status: 400, code: 'MISSING_REQUIRED_FIELD',
        error: `The mapping marks ${listed.length === 1 ? 'a column' : 'columns'} required that some rows leave blank: ${listed.join('; ')}. `
            + 'The import is refused before any row, on the dry run and the commit alike. '
            + 'Fill those cells, give the entry a defaultValue, or drop required from it.',
    };
}

/**
 * [#25578] Read a request's `matchFields`. One key set (`string[]`) is read
 * as it always was, non-string and empty names dropped. Ordered key sets
 * (`string[][]`) are read strictly: every set non-empty and every name a
 * non-empty string, and an array mixing names with sets is refused, because
 * a dropped set or name would silently change which record a row matches.
 */
function readMatchFieldsBody(raw: unknown): { ok: true; matchFields: string[] | string[][] } | ImportRefusal {
    if (!Array.isArray(raw)) return { ok: true, matchFields: [] };
    if (!raw.some((x) => Array.isArray(x))) {
        return { ok: true, matchFields: raw.filter((f: any) => typeof f === 'string' && f.length > 0) };
    }
    const malformed = !isMatchKeySets(raw)
        || raw.some((set) => set.length === 0 || set.some((f: unknown) => typeof f !== 'string' || f.length === 0));
    if (malformed) {
        return {
            ok: false, status: 400, code: 'INVALID_REQUEST',
            error: 'matchFields is one key set of field names (["email"]) or ordered key sets, each a non-empty list of field names '
                + '([["credit_code"], ["country", "registration_no"]]); it cannot mix names with sets or carry an empty set or name.',
        };
    }
    return { ok: true, matchFields: raw as string[][] };
}

/** Everything the import runner needs, parsed & validated from a request body. */
export interface PreparedImport {
    rows: Array<Record<string, any>>;
    metaMap: Map<string, ExportFieldMeta>;
    writeMode: 'insert' | 'update' | 'upsert';
    /** One key set, or ordered key sets (first all-non-blank set per row). */
    matchFields: string[] | string[][];
    /** Targets of the inline entries declaring `applyOn: 'create'`. */
    createOnlyFields: string[];
    dryRun: boolean;
    runAutomations: boolean;
    /** #3479 — import established historical facts: skip the state_machine rule
     *  so mid-lifecycle rows are not rejected by `initialStates`. */
    treatAsHistorical: boolean;
    trimWhitespace: boolean;
    nullValues?: string[];
    createMissingOptions: boolean;
    skipBlankMatchKey: boolean;
}

export type PrepareImportResult =
    | { ok: true; prepared: PreparedImport }
    | { ok: false; status: number; code: string; error: string };

/**
 * [#24348] The two request flags that take an object's declared business
 * controls off an import's writes, read ONCE, by the parser below and by the
 * door's gate ({@link importControlOptOutRefusal}) alike, so the gate can never
 * judge a different reading of the body than the one the runner is handed.
 *
 * - `runAutomations` defaults ON: automations always ran historically (the
 *   engine ignored the flag until #2922), so opting out must be explicit —
 *   only a literal `false` turns them off, matching platform convention
 *   (Salesforce runs triggers on import by default). Off, the runner writes
 *   with `skipAutomations`, which skips the object's metadata-bound hooks and
 *   its record-change flow triggers.
 * - `treatAsHistorical` defaults OFF (opt-in): a normal import must still walk
 *   the state machine — only an explicit "historical" import skips it (#3479),
 *   so mid-lifecycle rows aren't rejected by `initialStates`. Unlike
 *   `runAutomations`, the safe default is the strict one. On, the runner
 *   writes with `skipStateMachine` and `preserveAudit` (#3493).
 */
export function readImportControlFlags(body: any): { runAutomations: boolean; treatAsHistorical: boolean } {
    return {
        runAutomations: body?.runAutomations !== false,
        treatAsHistorical: body?.treatAsHistorical === true,
    };
}

/** What each control opt-out takes off the import's writes, in the refusal's words. */
const IMPORT_CONTROL_OPT_OUT_EFFECT = {
    runAutomations: '`runAutomations: false` turns off its triggers and metadata-bound hooks',
    treatAsHistorical: '`treatAsHistorical: true` skips its `state_machine` rule and keeps supplied audit and read-only values',
} as const;

/** A control opt-out the import door refuses, by its request key. */
export type ImportControlOptOut = keyof typeof IMPORT_CONTROL_OPT_OUT_EFFECT;

/** The import door's answer to a control opt-out it does not honour (ADR-0112: code AND status). */
export interface ImportControlOptOutRefusal {
    status: 403;
    code: 'PERMISSION_DENIED';
    message: string;
    /** The opt-outs the request sent, in request-key order: the refusal's subject. */
    refused: ImportControlOptOut[];
}

/**
 * [#24348] WHO MAY TAKE AN OBJECT'S DECLARED CONTROLS OFF AN IMPORT. Answers
 * the refusal when the request sends a control opt-out (`runAutomations:
 * false`, `treatAsHistorical: true`; read through
 * {@link readImportControlFlags}) and `caller` is not the system principal;
 * `undefined` when it sends neither, or when the system principal sends them.
 *
 * Each opt-out removes an app's declared business controls from every row the
 * import writes: its approval flows and other record-change triggers, its
 * metadata-bound hooks (a closed-record freeze, say), its `state_machine` rule
 * and its read-only and audit protection. So it is honoured only for the
 * caller the platform already lets past those controls: the system principal,
 * `ExecutionContext.isSystem === true` — the predicate every door that starts
 * an elevated self-triggered flow asks
 * (`flowStartRefusal`, `@objectstack/runtime`), and the only
 * exemption the create-side read-only strip and the approval record lock
 * admit. ⛔ No permission, capability or administrator standing is read here:
 * none of them lets a caller past those controls anywhere else either (an
 * administrator releases a locked record through the audited approval rescue,
 * never by writing past it). An HTTP request is assembled with
 * `isSystem: false`, so at the import doors every signed-in caller,
 * administrators included, is refused; the opt-outs remain for in-process
 * callers that run as the system principal.
 *
 * Refused LOUDLY, never ignored: a caller that asked for a silent load must
 * learn it did not get one. The doors ask this before the body is parsed, so
 * a refused request writes no row and creates no job — on a dry run too,
 * because a preview of a request the door refuses previews nothing. The
 * default (both keys omitted) and an explicit `runAutomations: true` /
 * `treatAsHistorical: false` are not opt-outs and pass untouched.
 */
export function importControlOptOutRefusal(body: any, caller: unknown): ImportControlOptOutRefusal | undefined {
    const { runAutomations, treatAsHistorical } = readImportControlFlags(body);
    const refused: ImportControlOptOut[] = [];
    if (!runAutomations) refused.push('runAutomations');
    if (treatAsHistorical) refused.push('treatAsHistorical');
    if (refused.length === 0) return undefined;
    if ((caller as { isSystem?: unknown } | null | undefined)?.isSystem === true) return undefined;
    const named = refused.map((k) => (k === 'runAutomations' ? '`runAutomations: false`' : '`treatAsHistorical: true`'));
    const plural = refused.length > 1;
    return {
        status: 403,
        code: 'PERMISSION_DENIED',
        refused,
        message:
            `${named.join(' and ')} ${plural ? 'are' : 'is'} refused for this caller. Only the system principal `
            + '(an in-process caller such as a seed or migration job, never a signed-in user, administrators included) '
            + "may take an object's declared controls off an import's writes: "
            + `${refused.map((k) => IMPORT_CONTROL_OPT_OUT_EFFECT[k]).join(', and ')}. `
            + `Send the request without ${plural ? 'them' : 'it'} to import with those controls in force.`,
    };
}

/**
 * Parse & validate a bulk-import request body into a {@link PreparedImport}.
 *
 * Shared by the synchronous `POST /data/:object/import` route and the async
 * import-job create route so both accept byte-identical payloads (writeMode +
 * matchFields, mapping in either shape, rows[]/csv/xlsxBase64) and resolve the
 * same field metadata. The only knob that differs is `maxRows` (5k sync vs
 * 50k async). Returns a discriminated result; the caller maps `!ok` to an HTTP
 * error using the returned status/code/error.
 */
/**
 * Fold a locale-translated schema's option labels into the authored metaMap as
 * matching synonyms. The export route and the import-template both surface the
 * *translated* option label (e.g. 待规划 for `backlog`), so a re-imported file
 * carries those strings — but `matchOption` compares against the schema the
 * registry serves, which only knows the authored label. Appending each
 * translated label as an extra `{ label, value }` entry keeps the authored
 * label and code working while also accepting what the localized UI displays.
 */
export function mergeLocalizedOptionSynonyms(
    metaMap: Map<string, ExportFieldMeta>,
    localized: Map<string, ExportFieldMeta>,
): void {
    for (const [name, meta] of metaMap) {
        const loc = localized.get(name);
        if (!meta.options?.length || !loc?.options?.length) continue;
        const known = new Set(
            meta.options
                .map((o) => (typeof o?.label === 'string' ? o.label.trim().toLowerCase() : ''))
                .filter(Boolean),
        );
        const synonyms = loc.options.filter(
            (o) =>
                o
                && typeof o.label === 'string'
                && o.label.trim().length > 0
                && o.value !== undefined
                && !known.has(o.label.trim().toLowerCase()),
        );
        if (synonyms.length > 0) {
            meta.options = [...meta.options, ...synonyms.map((o) => ({ label: o.label, value: o.value }))];
        }
    }
}

/**
 * Overwrite each column's `label` with the locale-translated one (#3957).
 *
 * The row report names a failing column by `meta.label`, and `buildFieldMetaMap`
 * reads the AUTHORED schema — so an app authored in English with a `zh-CN`
 * bundle reported `Account: 未找到…`: a localized sentence around an English
 * column name. The translated document is already fetched here for option
 * synonyms; this reads its labels from the same place.
 */
export function applyLocalizedFieldLabels(
    metaMap: Map<string, ExportFieldMeta>,
    localized: Map<string, ExportFieldMeta>,
): void {
    for (const [name, meta] of metaMap) {
        const label = localized.get(name)?.label;
        if (typeof label === 'string' && label.trim().length > 0) meta.label = label;
    }
}

export async function prepareImportRequest(
    body: any,
    opts: {
        p: any;
        objectName: string;
        environmentId?: string;
        maxRows: number;
        /**
         * Optional hook applying the request locale to a schema document (the
         * REST server passes `translateMetaItem` bound to the request). Used to
         * accept locale-translated option labels — the strings the localized
         * export / import template actually contain — as select-cell synonyms.
         */
        localizeSchema?: (schema: any) => Promise<any> | any;
    },
): Promise<PrepareImportResult> {
    const { p, objectName, environmentId, maxRows, localizeSchema } = opts;
    const dryRun = body?.dryRun === true;

    let writeMode: 'insert' | 'update' | 'upsert' =
        body?.writeMode === 'update' || body?.writeMode === 'upsert' ? body.writeMode : 'insert';
    // `matchFields` is one key set (`string[]`, read as it always was) or
    // ordered key sets (`string[][]`), which are read strictly: a malformed
    // set would change which rows match, so it refuses the request.
    const readMatchFields = readMatchFieldsBody(body?.matchFields);
    if (!readMatchFields.ok) return readMatchFields;
    let matchFields: string[] | string[][] = readMatchFields.matchFields;
    // The two control flags, read where the door's gate reads them (#24348):
    // the import doors refuse either opt-out from any caller but the system
    // principal BEFORE this parse (`importControlOptOutRefusal`), so a value
    // that reaches the runner from them is one the gate already admitted.
    const { runAutomations, treatAsHistorical } = readImportControlFlags(body);
    const trimWhitespace = body?.trimWhitespace !== false;
    const nullValues: string[] | undefined = Array.isArray(body?.nullValues)
        ? body.nullValues.filter((v: any) => typeof v === 'string')
        : undefined;
    const createMissingOptions = body?.createMissingOptions === true;
    const skipBlankMatchKey = body?.skipBlankMatchKey === true;

    // ── Named mapping artifact (#2611) ────────────────────────────────
    // `mappingName` references a registered `mapping` artifact
    // (defineMapping / stack `mappings:`) — the reusable, governed form for
    // recurring & programmatic imports. Mutually exclusive with the inline
    // `mapping` rename: one mapping source of truth per request.
    const mappingName: string | undefined =
        typeof body?.mappingName === 'string' && body.mappingName.length > 0 ? body.mappingName : undefined;
    const hasInlineMapping =
        (Array.isArray(body?.mapping) && body.mapping.length > 0) ||
        (!Array.isArray(body?.mapping) && body?.mapping && typeof body.mapping === 'object' && Object.keys(body.mapping).length > 0);
    if (mappingName && hasInlineMapping) {
        return { ok: false, status: 400, code: 'CONFLICTING_MAPPING', error: 'Provide either mappingName or an inline mapping, not both' };
    }
    let mappingArtifact: MappingArtifactLike | undefined;
    if (mappingName) {
        const detectedFormat: 'csv' | 'json' | 'xlsx' | undefined =
            (body?.format === 'json' && Array.isArray(body?.rows)) || Array.isArray(body) ? 'json'
            : typeof body?.csv === 'string' ? 'csv'
            : typeof body?.xlsxBase64 === 'string' ? 'xlsx'
            : undefined;
        if (!detectedFormat) {
            return { ok: false, status: 400, code: 'INVALID_REQUEST', error: 'Provide format:"csv" with csv text, format:"json" with rows[], or format:"xlsx" with xlsxBase64' };
        }
        const resolved = await resolveNamedMapping(p, { mappingName, objectName, detectedFormat });
        if (!resolved.ok) return resolved;
        mappingArtifact = resolved.artifact;
        // Artifact-declared write semantics apply as DEFAULTS: an explicit
        // request writeMode/matchFields wins; absent ones fall back to the
        // artifact's mode/upsertKey.
        if (body?.writeMode === undefined && (mappingArtifact.mode === 'update' || mappingArtifact.mode === 'upsert')) {
            writeMode = mappingArtifact.mode;
        }
        if (matchFields.length === 0 && Array.isArray(mappingArtifact.upsertKey)) {
            matchFields = mappingArtifact.upsertKey.filter((f) => typeof f === 'string' && f.length > 0);
        }
    }

    if (writeMode !== 'insert' && matchFields.length === 0) {
        return { ok: false, status: 400, code: 'INVALID_REQUEST', error: `writeMode "${writeMode}" requires a non-empty matchFields[]` };
    }
    if (skipBlankMatchKey && isMatchKeySets(matchFields)) {
        return {
            ok: false, status: 400, code: 'INVALID_REQUEST',
            error: 'skipBlankMatchKey applies to one key set only. With ordered key sets in matchFields, a row blank on every set '
                + 'is reported as a row error (BLANK_MATCH_KEY) rather than skipped: drop skipBlankMatchKey, or give matchFields one key set.',
        };
    }

    // Normalize `mapping` to a `{ sourceColumn: targetField }` record. Accepts
    // either that compact form or a FieldMappingEntry[]. An entry's own
    // per-cell rules (`transform` / `defaultValue` / `required`) are kept
    // beside the rename and applied once the rows are built (#25491).
    const mapping: Record<string, string> = {};
    const entryRules: InlineEntryRule[] = [];
    // [#25577] Targets of the entries declaring `applyOn: 'create'`: written
    // when the runner creates the row, left out of the patch when it updates one.
    const createOnlyFields: string[] = [];
    if (Array.isArray(body?.mapping)) {
        for (const e of body.mapping) {
            if (e && typeof e.sourceField === 'string' && typeof e.targetField === 'string') {
                mapping[e.sourceField] = e.targetField;
                const read = readInlineEntryRule(e);
                if (!read.ok) return read;
                if (read.rule) entryRules.push(read.rule);
                if (e.applyOn !== undefined && e.applyOn !== 'always' && e.applyOn !== 'create') {
                    return {
                        ok: false, status: 400, code: 'INVALID_REQUEST',
                        error: `Mapping entry "${e.sourceField}" to "${e.targetField}" declares applyOn ${JSON.stringify(e.applyOn)}; `
                            + 'applyOn is "always" (the default: written on create and update) or "create" (written only when the row is created).',
                    };
                }
                if (e.applyOn === 'create' && !createOnlyFields.includes(e.targetField)) createOnlyFields.push(e.targetField);
            }
        }
    } else if (body?.mapping && typeof body.mapping === 'object') {
        for (const [k, v] of Object.entries(body.mapping)) {
            if (typeof v === 'string') mapping[k] = v;
        }
    }
    const applyMapping = (row: Record<string, any>): Record<string, any> => {
        if (Object.keys(mapping).length === 0) return row;
        const out: Record<string, any> = {};
        for (const [k, val] of Object.entries(row)) out[mapping[k] ?? k] = val;
        return out;
    };

    // Build rows[] from JSON array, CSV text, or a base64 xlsx.
    let rows: Array<Record<string, any>> = [];
    if (body?.format === 'json' && Array.isArray(body.rows)) {
        rows = (body.rows as Array<Record<string, any>>).map(applyMapping);
    } else if ((body?.format === 'csv' || typeof body?.csv === 'string') && typeof body?.csv === 'string') {
        rows = parseCsvToRows(body.csv, mapping);
    } else if ((body?.format === 'xlsx' || typeof body?.xlsxBase64 === 'string') && typeof body?.xlsxBase64 === 'string') {
        // Native server-side xlsx parse — the client uploads raw workbook bytes
        // (base64) instead of pre-flattening to CSV.
        try {
            const buf = Buffer.from(body.xlsxBase64, 'base64');
            rows = await parseXlsxToRows(buf, mapping, body.sheet);
        } catch (e: any) {
            return { ok: false, status: 400, code: 'INVALID_REQUEST', error: `Failed to parse xlsx: ${e?.message ?? String(e)}` };
        }
    } else if (Array.isArray(body)) {
        // Permissive: a bare JSON array at the top level.
        rows = (body as Array<Record<string, any>>).map(applyMapping);
    } else {
        return { ok: false, status: 400, code: 'INVALID_REQUEST', error: 'Provide format:"csv" with csv text, format:"json" with rows[], or format:"xlsx" with xlsxBase64' };
    }

    if (rows.length > maxRows) {
        return { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE', error: `Import limit is ${maxRows} rows per request (got ${rows.length}).` };
    }

    if (entryRules.length > 0) {
        const refused = applyInlineEntryRules(rows, entryRules, nullValues);
        if (refused) return refused;
    }

    // Resolve the object's field metadata so cells coerce to storage values
    // (booleans, numbers, dates→ISO, select label→code) and lookup names resolve
    // to record ids. Best-effort: a failed lookup leaves `metaMap` empty and
    // every value passes through untouched.
    let metaMap = new Map<string, ExportFieldMeta>();
    // Hoisted out of the block below so the named mapping's targets can be
    // judged against the same definition (#20150).
    let schema: any = undefined;
    try {
        if (typeof p.getMetaItem === 'function') {
            // `getMetaItem` answers the `{ type, name, item, lock, … }`
            // envelope — one shape, on every read path, since #5563. The
            // translatable schema document is at `.item`; read it directly
            // rather than sniffing which of two shapes arrived.
            const r: any = await p.getMetaItem({ type: 'object', name: objectName });
            schema = r?.item;
        }
        if (!schema && typeof p.getObjectSchema === 'function') {
            schema = await p.getObjectSchema(objectName, environmentId);
        }
        metaMap = buildFieldMetaMap(schema);
        // Round-trip i18n: also accept the locale-translated option labels the
        // localized export / import template display (merged as synonyms; the
        // authored label and option code keep working).
        if (schema && typeof localizeSchema === 'function') {
            try {
                const localized = await localizeSchema(schema);
                if (localized && localized !== schema) {
                    const localizedMeta = buildFieldMetaMap(localized);
                    mergeLocalizedOptionSynonyms(metaMap, localizedMeta);
                    // The row report names columns by label — it must be the
                    // reader's label, not the authored one (#3957).
                    applyLocalizedFieldLabels(metaMap, localizedMeta);
                }
            } catch { /* authored-only option matching */ }
        }
    } catch { /* pass-through coercion */ }

    if (mappingArtifact) {
        // [#20150] A target that names no field of the object is refused HERE,
        // before any row — on the dry run and the commit alike, because both
        // arrive through this function. Judged against the definition resolved
        // above; an unresolved or field-less one is judged by nobody.
        const refused = refuseUnknownMappingTargets(mappingArtifact, objectName, schema);
        if (refused) return refused;

        // Apply the named mapping's fieldMapping pipeline (rename + transforms;
        // strict projection — only mapped targets reach the write path). Inline
        // `mapping` was empty in this branch, so rows still carry raw headers.
        // [#20149] The same definition tells it which targets are declared
        // parts of a compound field, assembled into one value per row.
        const applied = applyMappingToRows(rows, mappingArtifact, { objectSchema: schema, trimWhitespace, nullValues });
        if (!applied.ok) return applied;
        rows = applied.rows;
    }

    return {
        ok: true,
        prepared: {
            rows, metaMap, writeMode, matchFields, createOnlyFields, dryRun, runAutomations,
            treatAsHistorical,
            trimWhitespace, nullValues, createMissingOptions, skipBlankMatchKey,
        },
    };
}
