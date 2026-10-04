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

import type { MappingArtifactLike, MappingFailure } from '@objectstack/core';

// The `fieldMapping` pipeline (`applyMappingToRows`) and the pre-row target
// refusal (`refuseUnknownMappingTargets`) live in `@objectstack/core`
// (`utils/import-mapping.ts`), shared with the connector sync executor.
export {
    applyMappingToRows,
    refuseUnknownMappingTargets,
    type ApplyMappingOptions,
    type MappingArtifactLike,
    type MappingFailure,
} from '@objectstack/core';

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
                error: `Mapping "${mappingName}" uses transform "javascript", which the import path does not execute (there is no server-side sandbox), so the import is refused rather than run with that transform skipped`,
            };
        }
    }
    return { ok: true, artifact };
}
