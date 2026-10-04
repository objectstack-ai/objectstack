// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `mapping` artifact's `fieldMapping` pipeline, applied to parsed rows,
 * and the pre-row refusal of a target that is no field of the object. Moved
 * here unchanged from `@objectstack/rest` (`import-mapping.ts`), which keeps
 * the by-name resolution of the manual import door (`resolveNamedMapping`,
 * with its `sourceFormat` gate) and re-exports every name below. Both the
 * import door and the connector sync executor apply a mapping through these
 * two functions, so a pulled record and an uploaded row are projected alike.
 */

import {
    importMappingEntryTargets,
    indexImportMappingTargets,
    judgeImportMappingTarget,
    REFERENCE_VALUE_TYPES,
    unknownImportMappingTargets,
    type ImportMappingTargetHead,
    type UnknownImportMappingTarget,
} from '@objectstack/spec/data';
import { isBlank } from './import-coerce.js';

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

/**
 * [#20150] Refuse a mapping whose `fieldMapping` names a target that is no
 * field of the object — BEFORE any row, so the dry run and the commit give the
 * same answer.
 *
 * Without this the two paths disagreed: the dry run asked the engine's
 * `validateData` for each row's verdict, which never judges the row's KEYS, so
 * it answered `ok`; the commit reached the engine's write door, which does,
 * and failed every row with `INVALID_FIELD`. A preview that promises the write
 * breaks the #4633 contract (the dry run predicts the write).
 *
 * The verdict is `unknownImportMappingTargets` from `@objectstack/spec/data`,
 * the ONE place that decides what a target may name; `os validate` asks the
 * same function at author time, so the two cannot drift. It has no opinion on
 * an object whose field map is unreadable or empty, and returns nothing there,
 * so this refuses nothing the write would have accepted.
 *
 * [#20149] A declared part of a compound field (`mailing_address.street`) is
 * a target, and {@link applyMappingToRows} assembles it. What stays refused
 * here, each naming the parts that ARE legal: a part the field's value does
 * not declare, a dotted path on a field that has no parts (never a lookup
 * traversal), and a part of a field the same mapping also writes whole, since
 * one row carries one value for the field.
 *
 * The refusal carries the code the commit's per-row refusal already carries
 * (`INVALID_FIELD`, 400) and opens with the same sentence, so a caller reading
 * either path reads one answer.
 *
 * @param objectSchema The target object's definition as the import door
 *   resolved it (`undefined` when it could not; then nothing is judged).
 */
export function refuseUnknownMappingTargets(
    artifact: MappingArtifactLike,
    objectName: string,
    objectSchema: unknown,
): MappingFailure | undefined {
    const misses = unknownImportMappingTargets(artifact.fieldMapping, objectSchema);
    if (misses.length === 0) return undefined;
    const unknown = misses.filter((m) => m.reason === 'unknown');
    const collides = misses.filter((m) => m.reason === 'collides');
    const refusedBeforeAnyRow = 'the import is refused before any row, on the dry run and the commit alike';
    const sentences: string[] = [];
    if (unknown.length > 0) {
        const listed = unknown.map((m) => `${m.path} "${m.target}"${describeHead(m.head)}`).join(', ');
        sentences.push(
            `Unknown field '${unknown[0].target}' on object '${objectName}': mapping "${artifact.name}" `
            + `names ${unknown.length === 1 ? 'a target' : `${unknown.length} targets`} that ${unknown.length === 1 ? 'is' : 'are'} `
            + `no field of the object (${listed}). Every row would be refused on write, so ${refusedBeforeAnyRow}.`,
        );
    }
    if (collides.length > 0) {
        sentences.push(
            `Mapping "${artifact.name}" writes a compound field both whole and by part (${collides.map(describeCollision).join(', ')}): `
            + `one row carries one value for a field, so the two collide${unknown.length > 0 ? '' : `, and ${refusedBeforeAnyRow}`}. `
            + 'Map the field whole or by its parts, not both.',
        );
    }
    // Every refusal, a collision included, ends by listing the legal parts
    // (ruling on #20149, item 3: the refusal names the field and lists them).
    sentences.push(`Point each target at a field the object declares${partsHint(objectSchema)}.`);
    return { ok: false, status: 400, code: 'INVALID_FIELD', error: sentences.join(' ') };
}

/** Why a dotted target is not one, from what its head names (#20149). */
function describeHead(head: ImportMappingTargetHead | undefined): string {
    if (!head || !head.field) return '';
    if (head.parts) {
        return ` (the ${head.type ?? 'compound'} field "${head.name}" declares the parts ${head.parts.join(', ')})`;
    }
    const what = head.type ? `the ${head.type} field "${head.name}"` : `"${head.name}"`;
    if (head.type && REFERENCE_VALUE_TYPES.has(head.type)) {
        return ` (${what} has no parts: a dotted target never traverses a reference, so map the column to `
            + `"${head.name}" with transform "lookup")`;
    }
    return ` (${what} has no parts)`;
}

function describeCollision(m: UnknownImportMappingTarget): string {
    return `${m.path} "${m.target}", with the whole field at ${m.wholeAt}`;
}

/** The compound fields of the object and their parts, for the prescription (#20149). */
function partsHint(objectSchema: unknown): string {
    const index = indexImportMappingTargets(objectSchema);
    if (!index || index.parts.size === 0) return '';
    const listed = [...index.parts].map(([field, parts]) => `${field}: ${parts.join(', ')}`).join('; ');
    return `, or at a declared part of a compound field as field.part (${listed})`;
}

const first = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

/** What {@link applyMappingToRows} needs beyond the rows and the artifact. */
export interface ApplyMappingOptions {
    /**
     * [#20149] The target object's definition as the import door resolved it.
     * A target the shared verdict judges a declared PART of a compound field
     * (`mailing_address.street`) is assembled into that field's value; without
     * a definition no target is read as a part (and none was judged either).
     */
    objectSchema?: unknown;
    /** The request's `trimWhitespace` (default `true`), applied to part cells. */
    trimWhitespace?: boolean;
    /** The request's `nullValues`: a part cell holding one of them is blank. */
    nullValues?: string[];
}

/**
 * Apply the artifact's fieldMapping pipeline to raw parsed rows (headers as
 * in the source file). Returns NEW rows containing only mapped targets.
 *
 * [#20149] Assembly of a compound field. Every target naming a declared part
 * (`mailing_address.street`, …) is written into ONE value under the field's
 * own key (`mailing_address: { street, city, … }`), before the engine sees the
 * row, whatever transform produced it. The rule, measured against the address
 * value schema (every part optional, a closed key set) and the engine:
 *
 * - a BLANK part cell contributes nothing (blank = what cell coercion calls
 *   blank: empty, whitespace, or one of the request's `nullValues`). The
 *   schema would accept `street: ''`, but a blank flat cell leaves its field
 *   unset, and a blank part does the same one level down;
 * - a string part is trimmed under `trimWhitespace`, as a flat text cell is.
 *   Coercion never reaches inside a compound value, so it happens here; any
 *   other value passes through for the engine's value-shape check to judge;
 * - a field whose every mapped part is blank in a row is left UNSET, exactly
 *   like a blank flat cell;
 * - otherwise the assembled object is the field's whole new value: on an
 *   update it REPLACES the stored one, so a part the row leaves blank is
 *   absent from it.
 *
 * The dry run and the commit both arrive here through `prepareImportRequest`,
 * so they judge the same assembled row.
 */
export function applyMappingToRows(
    rows: Array<Record<string, unknown>>,
    artifact: MappingArtifactLike,
    options: ApplyMappingOptions = {},
): { ok: true; rows: Array<Record<string, unknown>> } | MappingFailure {
    // Judged once per mapping, by the one verdict the door refused with.
    const partOf = new Map<string, { field: string; part: string }>();
    const index = indexImportMappingTargets(options.objectSchema);
    if (index) {
        for (const entry of artifact.fieldMapping) {
            for (const { target } of importMappingEntryTargets(entry)) {
                const verdict = judgeImportMappingTarget(index, target);
                if (verdict.kind === 'part') partOf.set(target, { field: verdict.field, part: verdict.part });
            }
        }
    }
    const trim = options.trimWhitespace !== false;

    const out: Array<Record<string, unknown>> = [];
    for (const row of rows) {
        const mapped: Record<string, unknown> = {};
        const assembled = new Map<string, Record<string, unknown>>();
        const write = (target: string, value: unknown): void => {
            const at = partOf.get(target);
            if (!at) { mapped[target] = value; return; }
            let parts = assembled.get(at.field);
            if (!parts) { parts = {}; assembled.set(at.field, parts); }
            // A later entry naming the same part wins, blank included — the
            // same last-write rule a repeated flat target follows.
            if (isBlank(value, options.nullValues)) { delete parts[at.part]; return; }
            parts[at.part] = trim && typeof value === 'string' ? value.trim() : value;
        };
        for (const entry of artifact.fieldMapping) {
            const transform = entry.transform ?? 'none';
            const sep = entry.params?.separator ?? ' ';
            switch (transform) {
                case 'none':
                case 'lookup': { // lookup values resolve downstream via metaMap
                    write(first(entry.target), row[first(entry.source)]);
                    break;
                }
                case 'constant': {
                    write(first(entry.target), entry.params?.value);
                    break;
                }
                case 'map': {
                    const raw = row[first(entry.source)];
                    const valueMap = entry.params?.valueMap ?? {};
                    write(first(entry.target), typeof raw === 'string' && raw in valueMap ? valueMap[raw] : raw);
                    break;
                }
                case 'split': {
                    const raw = row[first(entry.source)];
                    const targets = Array.isArray(entry.target) ? entry.target : [entry.target];
                    const parts = typeof raw === 'string' ? raw.split(sep) : [];
                    targets.forEach((t, i) => { write(t, parts[i]?.trim()); });
                    break;
                }
                case 'join': {
                    const sources = Array.isArray(entry.source) ? entry.source : [entry.source];
                    write(first(entry.target), sources
                        .map((s) => row[s])
                        .filter((v) => v !== undefined && v !== null && v !== '')
                        .join(sep));
                    break;
                }
                default:
                    return {
                        ok: false, status: 400, code: 'UNSUPPORTED_TRANSFORM',
                        error: `Mapping "${artifact.name}" uses unknown transform "${transform}"`,
                    };
            }
        }
        for (const [field, value] of assembled) {
            if (Object.keys(value).length > 0) mapped[field] = value;
        }
        out.push(mapped);
    }
    return { ok: true, rows: out };
}
