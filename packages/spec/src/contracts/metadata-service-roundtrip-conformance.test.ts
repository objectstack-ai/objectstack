// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `METADATA_ROUNDTRIP_CASES` driver #1 — the contract's own reference double.
 *
 * This file runs the shared table (`metadata-service-roundtrip-conformance.ts`)
 * against a `Map`-of-`Map`s keyed by `type` × the `name` ARGUMENT, which is
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

/**
 * The reference store: `type` → `name` → `data`, and nothing else. Written out
 * here rather than imported so that the reference semantics live in the file
 * that asserts them — the same store `metadata-service.test.ts` builds inline,
 * typed against the contract so a signature change reaches this file via `tsc`.
 */
function createReferenceService(): IMetadataService {
    const store = new Map<string, Map<string, unknown>>();
    const typeStore = (type: string): Map<string, unknown> => {
        let map = store.get(type);
        if (!map) {
            map = new Map();
            store.set(type, map);
        }
        return map;
    };

    return {
        register: async (type, name, data) => { typeStore(type).set(name, data); },
        get: async (type, name) => typeStore(type).get(name),
        list: async (type) => Array.from(typeStore(type).values()),
        unregister: async (type, name) => { typeStore(type).delete(name); },
        exists: async (type, name) => typeStore(type).has(name),
        listNames: async (type) => Array.from(typeStore(type).keys()),
        getObject: async (name) => typeStore('object').get(name),
        listObjects: async () => Array.from(typeStore('object').values()),
    };
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
