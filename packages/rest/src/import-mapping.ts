// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Named import mappings (#2611) — resolve a registered `mapping` artifact
 * (`defineMapping`, stack `mappings:`) by name and apply its `fieldMapping`
 * pipeline to parsed rows.
 *
 * Seam with the inline request `mapping`:
 *   • inline  = a plain `{ sourceColumn: targetField }` RENAME for one-off,
 *     wizard-driven imports — unmapped columns pass through untouched.
 *   • artifact = a reusable, governed ETL projection for recurring /
 *     programmatic imports — the output row contains ONLY the mapped
 *     targets (a strict projection; source files from external systems
 *     routinely carry junk columns that must not leak into the write path).
 *
 * Transform support (Prime Directive #10 — implement or reject loudly):
 *   none/constant/map/split/join — applied here.
 *   lookup — the value is copied through; the import pipeline's built-in
 *     reference resolution (metaMap) turns lookup names into record ids,
 *     so a dedicated re-implementation here would be a second dialect.
 *   javascript — REJECTED (400). No server-side sandbox is wired into the
 *     import path yet; silently skipping a declared transform would corrupt
 *     data. Tracked on framework#2611.
 */

export interface MappingArtifactLike {
    name: string;
    targetObject: string;
    sourceFormat?: 'csv' | 'json' | 'xml' | 'sql';
    fieldMapping: Array<{
        source: string | string[];
        target: string | string[];
        transform?: 'none' | 'constant' | 'lookup' | 'split' | 'join' | 'javascript' | 'map';
        params?: {
            value?: unknown;
            valueMap?: Record<string, unknown>;
            separator?: string;
        } & Record<string, unknown>;
    }>;
    mode?: 'insert' | 'update' | 'upsert';
    upsertKey?: string[];
}

export type MappingFailure = { ok: false; status: number; code: string; error: string };
export type ResolveMappingResult = { ok: true; artifact: MappingArtifactLike } | MappingFailure;

/**
 * Resolve a named mapping artifact and check it against the request:
 * target object must match the URL object, and the artifact's declared
 * sourceFormat (when set) must match the payload format actually sent.
 */
export async function resolveNamedMapping(
    p: { getMetaItem?: (req: { type: string; name: string }) => Promise<unknown> },
    opts: { mappingName: string; objectName: string; detectedFormat: 'csv' | 'json' | 'xlsx' },
): Promise<ResolveMappingResult> {
    const { mappingName, objectName, detectedFormat } = opts;
    if (typeof p?.getMetaItem !== 'function') {
        return { ok: false, status: 500, code: 'INTERNAL', error: 'Metadata protocol unavailable; cannot resolve mappingName' };
    }
    let artifact: MappingArtifactLike | undefined;
    try {
        // [#5563] `getMetaItem` answers the `{ type, name, item, … }` envelope on
        // every read path, so the artifact is read straight off `.item` — the
        // conditional "unwrap if it looks wrapped" this used to do was the same
        // shape sniff the single-item route carried, and had the same cause.
        const res = await p.getMetaItem({ type: 'mapping', name: mappingName }) as Record<string, unknown> | undefined;
        artifact = res?.item as MappingArtifactLike | undefined;
    } catch { /* treated as not found below */ }
    if (!artifact || typeof artifact !== 'object' || !Array.isArray(artifact.fieldMapping)) {
        return { ok: false, status: 404, code: 'MAPPING_NOT_FOUND', error: `No mapping artifact named "${mappingName}" is registered` };
    }
    if (artifact.targetObject !== objectName) {
        return {
            ok: false, status: 400, code: 'MAPPING_TARGET_MISMATCH',
            error: `Mapping "${mappingName}" targets object "${artifact.targetObject}", not "${objectName}"`,
        };
    }
    const declared = artifact.sourceFormat;
    if (declared === 'xml' || declared === 'sql') {
        return {
            ok: false, status: 400, code: 'MAPPING_FORMAT_UNSUPPORTED',
            error: `Mapping "${mappingName}" declares sourceFormat "${declared}", which the import endpoint does not accept (csv/json/xlsx)`,
        };
    }
    // xlsx rows are tabular like csv; a csv-declared mapping applies to both.
    const compatible = declared === undefined
        || (declared === 'json' && detectedFormat === 'json')
        || (declared === 'csv' && (detectedFormat === 'csv' || detectedFormat === 'xlsx'));
    if (!compatible) {
        return {
            ok: false, status: 400, code: 'MAPPING_FORMAT_MISMATCH',
            error: `Mapping "${mappingName}" declares sourceFormat "${declared}" but the payload is "${detectedFormat}"`,
        };
    }
    for (const entry of artifact.fieldMapping) {
        if (entry?.transform === 'javascript') {
            return {
                ok: false, status: 400, code: 'UNSUPPORTED_TRANSFORM',
                error: `Mapping "${mappingName}" uses transform "javascript", which the import path does not execute (no server-side sandbox; see framework#2611)`,
            };
        }
    }
    return { ok: true, artifact };
}

const first = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

/**
 * Apply the artifact's fieldMapping pipeline to raw parsed rows (headers as
 * in the source file). Returns NEW rows containing only mapped targets.
 */
export function applyMappingToRows(
    rows: Array<Record<string, unknown>>,
    artifact: MappingArtifactLike,
): { ok: true; rows: Array<Record<string, unknown>> } | MappingFailure {
    const out: Array<Record<string, unknown>> = [];
    for (const row of rows) {
        const mapped: Record<string, unknown> = {};
        for (const entry of artifact.fieldMapping) {
            const transform = entry.transform ?? 'none';
            const sep = entry.params?.separator ?? ' ';
            switch (transform) {
                case 'none':
                case 'lookup': { // lookup values resolve downstream via metaMap
                    mapped[first(entry.target)] = row[first(entry.source)];
                    break;
                }
                case 'constant': {
                    mapped[first(entry.target)] = entry.params?.value;
                    break;
                }
                case 'map': {
                    const raw = row[first(entry.source)];
                    const valueMap = entry.params?.valueMap ?? {};
                    mapped[first(entry.target)] =
                        typeof raw === 'string' && raw in valueMap ? valueMap[raw] : raw;
                    break;
                }
                case 'split': {
                    const raw = row[first(entry.source)];
                    const targets = Array.isArray(entry.target) ? entry.target : [entry.target];
                    const parts = typeof raw === 'string' ? raw.split(sep) : [];
                    targets.forEach((t, i) => { mapped[t] = parts[i]?.trim(); });
                    break;
                }
                case 'join': {
                    const sources = Array.isArray(entry.source) ? entry.source : [entry.source];
                    mapped[first(entry.target)] = sources
                        .map((s) => row[s])
                        .filter((v) => v !== undefined && v !== null && v !== '')
                        .join(sep);
                    break;
                }
                default:
                    return {
                        ok: false, status: 400, code: 'UNSUPPORTED_TRANSFORM',
                        error: `Mapping "${artifact.name}" uses unknown transform "${transform}"`,
                    };
            }
        }
        out.push(mapped);
    }
    return { ok: true, rows: out };
}
