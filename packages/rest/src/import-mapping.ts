// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Named import mappings (#2611) — resolve a registered `mapping` artifact
 * (`defineMapping`, stack `mappings:`) by name and apply its `fieldMapping`
 * pipeline to parsed rows.
 *
 * Seam with the inline request `mapping`:
 *   • inline  = a `{ sourceColumn: targetField }` rename (or a
 *     `FieldMappingEntry[]` whose entries may add `transform`
 *     trim/uppercase/lowercase, `defaultValue` and `required`, applied in
 *     `import-prepare.ts`) for one-off, wizard-driven imports — unmapped
 *     columns pass through untouched.
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

import { PackageScopedNameRefusedError, type MappingArtifactLike, type MappingFailure } from '@objectstack/core';

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
 * [ADR-0150 D3, #32071] The refusal a by-name read threw, or `undefined` for
 * any other failure. Recognised by class and, as the runtime's `/meta` door
 * recognises it (`isPackageScopedRefusal`), by shape: `code ===
 * 'RESOURCE_CONFLICT'` with a `refusal` whose `status` is `'refused'`, which
 * is what reaches this door when the error crossed a realm or a second copy
 * of `@objectstack/core` and `instanceof` cannot see it. The answer is the
 * error's own code, status and sentence.
 */
function packageScopedRefusalOf(err: unknown): { code: string; status: number; message: string } | undefined {
    if (err instanceof PackageScopedNameRefusedError) return { code: err.code, status: err.status, message: err.message };
    const thrown = err as {
        code?: unknown; status?: unknown; httpStatus?: unknown; message?: unknown;
        refusal?: { status?: unknown; message?: unknown };
    } | null | undefined;
    if (thrown?.code !== 'RESOURCE_CONFLICT' || thrown.refusal?.status !== 'refused') return undefined;
    const status = typeof thrown.status === 'number' ? thrown.status
        : typeof thrown.httpStatus === 'number' ? thrown.httpStatus : 409;
    const message = typeof thrown.message === 'string' && thrown.message ? thrown.message : String(thrown.refusal.message ?? '');
    return { code: thrown.code, status, message };
}

/**
 * How the protocol reads the middle segment of the `/meta` door's qualified
 * address (`MetaItemAddress` in `@objectstack/metadata-protocol`, spelled
 * structurally: this package reaches the protocol as a service, never as an
 * import).
 */
type MetaItemAddress =
    | { readonly kind: 'environment' }
    | { readonly kind: 'namespace'; readonly namespace: string; readonly packageId: string };

/** The protocol reads a named mapping is resolved with, feature-detected. */
export interface NamedMappingProtocol {
    getMetaItem?: (req: { type: string; name: string; packageId?: string }) => Promise<unknown>;
    resolveMetaItemAddress?: (req: { type: string; segment: string; name: string }) => MetaItemAddress | undefined;
    admitEnvironmentQualifier?: (req: { type: string; name: string }) => void;
}

/** The by-name read a `mappingName` asks for. */
type MappingRead = { type: 'mapping'; name: string; packageId?: string };

/**
 * [ADR-0150 D2/D5, #32079] The by-name read a `mappingName` spells.
 *
 * A name with no `/` is the bare read, unchanged (#32071). `NAMESPACE/NAME`
 * and `_env/NAME` are the qualified address the `/meta` door reads as
 * `GET /meta/mapping/NAMESPACE/NAME` and `GET /meta/mapping/_env/NAME`, read
 * by the protocol reads that path is read by, so the import door has no
 * address vocabulary of its own. `resolveMetaItemAddress` reads the first
 * segment in D5's order, and the read is then:
 *  - an installed namespace: `?package=` naming its holder, the exact
 *    qualifier (`getMetaItem` with `packageId`): that package's mapping, or
 *    the `not-held-by-qualifier` refusal naming every holder;
 *  - `_env`: the environment's own mapping. `admitEnvironmentQualifier`
 *    refuses a name only packages hold, naming every holder; admitted, the
 *    read is a caller with no package, which answers the environment's item.
 *
 * Anything else is no address, and is read exactly as before this spelling
 * existed: the whole string, by name. A mapping name is snake_case, so such a
 * string names no mapping and answers not found. ⛔ Never the part after the
 * `/` read bare, which could answer a holder the request did not name. An
 * `_env` address on a protocol with no `admitEnvironmentQualifier` is no
 * address either. The `/meta` door's sub-resource literals keep their route
 * there (seat ruling Q1 = A on #31691), so a mapping named one of them
 * (`history`, …) has no qualified spelling here either.
 *
 * @throws {PackageScopedNameRefusedError} for a shareable namespace two of
 *   whose owners hold the name (`ambiguous-in-namespace`), and for `_env` and
 *   a name only packages hold (`not-held-by-qualifier`).
 */
async function namedMappingRead(p: NamedMappingProtocol, mappingName: string): Promise<MappingRead> {
    const bare: MappingRead = { type: 'mapping', name: mappingName };
    const slash = mappingName.indexOf('/');
    if (slash <= 0 || slash === mappingName.length - 1 || mappingName.includes('/', slash + 1)) return bare;
    if (typeof p.resolveMetaItemAddress !== 'function') return bare;
    const name = mappingName.slice(slash + 1);
    const address = await p.resolveMetaItemAddress({ type: 'mapping', segment: mappingName.slice(0, slash), name });
    if (address?.kind === 'namespace') return { type: 'mapping', name, packageId: address.packageId };
    if (address?.kind === 'environment' && typeof p.admitEnvironmentQualifier === 'function') {
        await p.admitEnvironmentQualifier({ type: 'mapping', name });
        return { type: 'mapping', name };
    }
    return bare;
}

/**
 * Resolve a named mapping artifact and check it against the request:
 * target object must match the URL object, and the artifact's declared
 * sourceFormat (when set) must match the payload format actually sent.
 *
 * [ADR-0150 D3, #32071] `mapping` is addressed by `(package, name)`. The
 * door names no package (the target object's owner is no caller: a package's
 * mapping into an object another package owns would be refused outside its
 * closure, where it is served today), so the protocol's by-name read resolves
 * it as a caller with no package: the environment's own item, else the one
 * package holder. A name two packages hold is refused by that read naming
 * both, and the refusal is answered as the `409 RESOURCE_CONFLICT` it is,
 * with its own sentence — ⛔ never as `404 MAPPING_NOT_FOUND`, which would
 * tell the caller the name means nothing when it means more than one thing.
 * Every other failure of the read keeps its answer: not found.
 *
 * [ADR-0150 D5, #32079] The request names the holder with the qualified
 * address `NAMESPACE/NAME` (or `_env/NAME`) in `mappingName`, which reaches
 * exactly that holder or is refused as the `/meta` door refuses that address
 * ({@link namedMappingRead}).
 */
export async function resolveNamedMapping(
    p: NamedMappingProtocol,
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
        const res = await p.getMetaItem(await namedMappingRead(p, mappingName)) as Record<string, unknown> | undefined;
        artifact = res?.item as MappingArtifactLike | undefined;
    } catch (err) {
        // [#32071] The by-name read refused: the name is held by more than
        // one package, or [#32079] the qualified address names a holder
        // that does not hold it. Answered with the refusal's own code,
        // status and sentence, which names every candidate.
        const refused = packageScopedRefusalOf(err);
        if (refused) return { ok: false, status: refused.status, code: refused.code, error: refused.message };
        /* anything else is treated as not found below */
    }
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
