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
    type ExportFieldMeta,
} from './export-format.js';
import { resolveNamedMapping, applyMappingToRows, type MappingArtifactLike } from './import-mapping.js';

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

    const header = cells[0].map(h => h.trim());
    const fields = header.map(h => mapping[h] ?? h);
    const out: Array<Record<string, any>> = [];
    for (let r = 1; r < cells.length; r++) {
        const row = cells[r];
        const obj: Record<string, any> = {};
        for (let c = 0; c < fields.length; c++) {
            const key = fields[c];
            if (!key) continue;
            const raw = row[c] ?? '';
            obj[key] = raw;
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
    const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = sheet !== undefined ? wb.getWorksheet(sheet as any) : wb.worksheets[0];
    if (!ws) return [];

    const cells: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row: any) => {
        const values = row.values as any[]; // 1-based; index 0 is unused
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

/** Everything the import runner needs, parsed & validated from a request body. */
export interface PreparedImport {
    rows: Array<Record<string, any>>;
    metaMap: Map<string, ExportFieldMeta>;
    writeMode: 'insert' | 'update' | 'upsert';
    matchFields: string[];
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
    let matchFields: string[] = Array.isArray(body?.matchFields)
        ? body.matchFields.filter((f: any) => typeof f === 'string' && f.length > 0)
        : [];
    // Default ON: automations always ran historically (the engine ignored the
    // flag until #2922), so opt-out must be explicit — matches platform
    // convention (Salesforce runs triggers on import by default).
    const runAutomations = body?.runAutomations !== false;
    // Default OFF (opt-in): a normal import must still walk the state machine —
    // only an explicit "historical" import skips it (#3479), so mid-lifecycle
    // rows aren't rejected by `initialStates`. Unlike `runAutomations`, the safe
    // default is the strict one.
    const treatAsHistorical = body?.treatAsHistorical === true;
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

    // Normalize `mapping` to a `{ sourceColumn: targetField }` record. Accepts
    // either that compact form or a FieldMappingEntry[].
    const mapping: Record<string, string> = {};
    if (Array.isArray(body?.mapping)) {
        for (const e of body.mapping) {
            if (e && typeof e.sourceField === 'string' && typeof e.targetField === 'string') {
                mapping[e.sourceField] = e.targetField;
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

    // Apply the named mapping's fieldMapping pipeline (rename + transforms;
    // strict projection — only mapped targets reach the write path). Inline
    // `mapping` was empty in this branch, so rows still carry raw headers.
    if (mappingArtifact) {
        const applied = applyMappingToRows(rows, mappingArtifact);
        if (!applied.ok) return applied;
        rows = applied.rows;
    }

    // Resolve the object's field metadata so cells coerce to storage values
    // (booleans, numbers, dates→ISO, select label→code) and lookup names resolve
    // to record ids. Best-effort: a failed lookup leaves `metaMap` empty and
    // every value passes through untouched.
    let metaMap = new Map<string, ExportFieldMeta>();
    try {
        let schema: any = undefined;
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

    return {
        ok: true,
        prepared: {
            rows, metaMap, writeMode, matchFields, dryRun, runAutomations,
            treatAsHistorical,
            trimWhitespace, nullValues, createMissingOptions, skipBlankMatchKey,
        },
    };
}
