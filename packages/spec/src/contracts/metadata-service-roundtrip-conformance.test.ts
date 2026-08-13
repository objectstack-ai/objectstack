// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `METADATA_ROUNDTRIP_CASES` driver #1 — the contract's own reference double.
 *
 * This file runs the shared table (`metadata-service-roundtrip-conformance.ts`)
 * against a `Map`-of-`Map`s keyed by the CANONICAL type × the `name` ARGUMENT,
 * refusing what it cannot key (#7378, maintainer ruling 2026-08-12) — which is
 * what the table's `expected` column means. Its subject is deliberately NOT a
 * shipped implementation: `packages/spec` is the dependency root and the
 * contract has no runtime, so nothing here can import one. The shipped
 * implementations are driven by
 * `packages/objectql/src/metadata-service-roundtrip-conformance.test.ts`.
 *
 * So what does this file buy, if it "asserts that a `Map` behaves like a
 * `Map`"? Two things the objectql driver cannot:
 *
 * 1. **It keeps the reference semantics honest.** The objectql driver states
 *    per-implementation answers as deltas against this table; a table whose own
 *    reference answers were never executed would let a typo in `expected`
 *    silently redefine what "conforming" means for every subject at once.
 * 2. **It keeps the table executable from the dependency root.** A third-party
 *    author implementing this contract can run the same cases without
 *    depending on `@objectstack/metadata`, `@objectstack/core` or ObjectQL.
 *
 * The pre-existing double in `metadata-service.test.ts` is untouched and stays
 * where it is: it pins the contract's TYPE surface (a minimal implementation
 * compiles, optional members are optional) and its own inline round-trip. This
 * file pins the table. Neither subsumes the other.
 *
 * Refs #7223, #6725.
 */

import { describe, it, expect } from 'vitest';
import type { IMetadataService } from './metadata-service';
import {
    METADATA_ROUNDTRIP_CASES,
    type MetadataRoundTripCase,
} from './metadata-service-roundtrip-conformance';
import { StandardErrorCode } from '../api/errors.zod';
import { pluralToSingular } from '../shared/metadata-collection.zod';

/**
 * The #7378 three-cell register contract (maintainer ruling 2026-08-12),
 * restated locally. The shipped implementations share ONE guard —
 * `assertMetadataRegisterContract` / `canonicalMetadataServiceType`
 * (`@objectstack/core`, `packages/core/src/metadata-service-contract.ts`,
 * whose header carries the verbatim ruling) — which this file deliberately
 * does NOT import: `packages/spec` is the dependency root and core depends on
 * spec, not the other way round. The semantics are restated against the same
 * `PLURAL_TO_SINGULAR` map (which spec itself owns, so the fold has one
 * source), keeping the reference double executable from the root; keep the
 * two in step through the shared conformance table, which both drivers replay.
 */
function registerRefusal(message: string): Error & { code: string; status: number } {
    const error = new Error(message) as Error & { code: string; status: number };
    error.code = StandardErrorCode.enum.VALIDATION_ERROR;
    error.status = 400;
    return error;
}

/** Rows 1 and 3: refuse what the store cannot key, before any write. */
function assertRegisterContract(type: string, name: string, data: unknown): void {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        const shape = data === null ? 'null' : Array.isArray(data) ? 'an array' : `a ${typeof data}`;
        throw registerRefusal(
            `IMetadataService.register('${type}', '${name}'): data is ${shape}, not a metadata document — ` +
                `refused, never accepted-and-dropped or coerced into storability (#7378 row 3).`,
        );
    }
    const documentName = (data as { name?: unknown }).name;
    if (documentName !== undefined && documentName !== name) {
        throw registerRefusal(
            `IMetadataService.register('${type}', '${name}'): data.name is '${String(documentName)}', which disagrees ` +
                `with the name argument '${name}' — refused, since silent resolution in either direction can misplace the item (#7378 row 1).`,
        );
    }
}

/**
 * The reference store: CANONICAL `type` → `name` → `data`, guarded by the
 * refusals above, and nothing else. Written out here rather than imported so
 * that the reference semantics live in the file that asserts them — typed
 * against the contract so a signature change reaches this file via `tsc`.
 * Every member folds its `type` through `pluralToSingular` (#7378 row 2), so
 * the two spellings of a type address one store in both directions.
 */
function createReferenceService(): IMetadataService {
    const store = new Map<string, Map<string, unknown>>();
    const typeStore = (type: string): Map<string, unknown> => {
        const canonical = pluralToSingular(type);
        let map = store.get(canonical);
        if (!map) {
            map = new Map();
            store.set(canonical, map);
        }
        return map;
    };

    return {
        register: async (type, name, data) => {
            assertRegisterContract(type, name, data);
            typeStore(type).set(name, data);
        },
        get: async (type, name) => typeStore(type).get(name),
        list: async (type) => Array.from(typeStore(type).values()),
        unregister: async (type, name) => { typeStore(type).delete(name); },
        exists: async (type, name) => typeStore(type).has(name),
        listNames: async (type) => Array.from(typeStore(type).keys()),
        getObject: async (name) => typeStore('object').get(name),
        listObjects: async () => Array.from(typeStore('object').values()),
    };
}

/**
 * The `name` a case's written document carries when that is NOT the key the
 * case reads — the spelling a misplacing implementation would file the item
 * under, which the refusal's message must NAME and its absence probes cover.
 */
function disagreeingDocumentName(testCase: MetadataRoundTripCase): string | undefined {
    const written = testCase.writes[testCase.writes.length - 1]?.data;
    const documentName = (written as { name?: unknown } | undefined)?.name;
    return typeof documentName === 'string' && documentName !== testCase.read.name
        ? documentName
        : undefined;
}

/**
 * A `refused` row (#7378 rows 1/3): the single write rejects with the
 * ADR-0112 envelope (`code` AND `status` — a rejection test that checks only
 * "it threw" is not one), locates the problem in its message, and stores
 * NOTHING — neither under the argument key nor under the document's own name.
 */
async function assertRefused(service: IMetadataService, testCase: MetadataRoundTripCase): Promise<void> {
    expect(testCase.writes).toHaveLength(1);
    const write = testCase.writes[0];

    const error = await service.register(write.type, write.name, write.data).then(
        () => undefined,
        (thrown: unknown) => thrown as Error & { code?: string; status?: number },
    );
    expect(error, `register must REFUSE this write (#7378): ${testCase.id}`).toBeDefined();
    expect(error).toMatchObject({
        code: StandardErrorCode.enum.VALIDATION_ERROR,
        status: 400,
    });

    // 报错定位 — the message names the write's coordinates…
    const message = String(error?.message ?? '');
    expect(message).toContain(`'${write.type}'`);
    expect(message).toContain(`'${write.name}'`);
    // …and, on the mismatch rows, BOTH disagreeing spellings.
    const disagreeing = disagreeingDocumentName(testCase);
    if (disagreeing !== undefined) {
        expect(message).toContain(`'${disagreeing}'`);
    }

    // The refusal wrote nothing: absent under the argument key…
    expect(await service.get(testCase.read.type, testCase.read.name)).toBeUndefined();
    expect(await service.exists(testCase.read.type, testCase.read.name)).toBe(false);
    const names = await service.listNames(testCase.read.type);
    expect(names).not.toContain(testCase.read.name);
    // …and never under the document's own name either — the misplacement the
    // ruling exists to make impossible.
    if (disagreeing !== undefined) {
        expect(await service.get(testCase.read.type, disagreeing)).toBeUndefined();
        expect(names).not.toContain(disagreeing);
    }
}

/** Replay a case's setup, then answer its single read through all four members. */
async function replay(service: IMetadataService, testCase: MetadataRoundTripCase) {
    for (const write of testCase.writes) {
        await service.register(write.type, write.name, write.data);
    }
    for (const removal of testCase.removes ?? []) {
        await service.unregister(removal.type, removal.name);
    }
    return {
        got: await service.get(testCase.read.type, testCase.read.name),
        exists: await service.exists(testCase.read.type, testCase.read.name),
        names: await service.listNames(testCase.read.type),
    };
}

describe('IMetadataService round-trip conformance — contract reference double', () => {
    it.each(METADATA_ROUNDTRIP_CASES.map((testCase) => [testCase.id, testCase] as const))(
        '%s',
        async (_id, testCase) => {
            if (testCase.expected.kind === 'refused') {
                await assertRefused(createReferenceService(), testCase);
                return;
            }

            const { got, exists, names } = await replay(createReferenceService(), testCase);

            if (testCase.expected.kind === 'readable') {
                expect(got).toEqual(testCase.expected.document);
                expect(exists).toBe(true);
                // Exactly once: a store that appended instead of overwriting
                // would satisfy every assertion above on the re-register rows
                // and fail only this one.
                expect(names.filter((name) => name === testCase.read.name)).toHaveLength(1);
            } else {
                expect(got).toBeUndefined();
                expect(exists).toBe(false);
                expect(names).not.toContain(testCase.read.name);
            }
        },
    );

    it('states a case id at most once, so a driver override cannot silently target two rows', () => {
        const ids = METADATA_ROUNDTRIP_CASES.map((testCase) => testCase.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('covers both an object-typed and a non-object-typed round-trip', () => {
        // The asymmetry that produced #6725: `object` reads are special-cased in
        // SchemaRegistry and the generic types are not. A table that lost one of
        // the two sides would still look full.
        const readable = METADATA_ROUNDTRIP_CASES.filter((c) => c.expected.kind === 'readable');
        expect(readable.some((c) => c.read.type === 'object')).toBe(true);
        expect(readable.some((c) => c.read.type !== 'object')).toBe(true);
    });
});
