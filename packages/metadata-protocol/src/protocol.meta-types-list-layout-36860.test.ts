// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36860 — `getMetaTypes()` serves each type's declared list layout
 * (`METADATA_LIST_REGISTRY`) as `list` on its entry, beside `form`.
 *
 *  - every registry type is served with its own layout, the object the spec
 *    froze, not a copy that could drift;
 *  - a type the registry does not cover carries no `list` key at all, so a
 *    client that reads it falls back to its own columns (the control).
 */
import { describe, expect, it } from 'vitest';
// `./protocol.js` reaches `import('@objectstack/lint')`; pay its first load at
// collection, never inside a clocked case.
import '@objectstack/lint';
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
    type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { METADATA_LIST_REGISTRY } from '@objectstack/spec/system';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SERVED_TYPES = Array.from(new Set(DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type)));

function makeProtocol() {
    const engine: any = {
        async findOne(object: string, query?: EngineFindOneQueryInput) {
            assertEngineFindOnePredicate(object, query); return null;
        },
        async find() { return []; },
        async insert() { return { id: 'unused' }; },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
        async getObjectSchema() { return undefined; },
        registry: {
            getRegisteredTypes: () => [...SERVED_TYPES],
            registerItem: () => {},
            registerObject: () => {},
            unregisterItem: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
    return new ObjectStackProtocolImplementation(engine, () => new Map(), undefined) as any;
}

describe('GET /meta/types serves the declared list layout (objectstack#36860)', () => {
    it('serves every registry type with its own frozen layout', async () => {
        const { entries } = await makeProtocol().getMetaTypes();
        const byType = new Map<string, any>(entries.map((e: any) => [e.type, e]));
        const declared = Object.keys(METADATA_LIST_REGISTRY);
        expect(declared.length).toBeGreaterThan(0);
        for (const type of declared) {
            const entry = byType.get(type);
            expect(entry, `${type} is served`).toBeDefined();
            expect(entry.list).toBe(METADATA_LIST_REGISTRY[type]);
        }
        expect(byType.get('hook').list.columns.map((c: any) => c.field)).toEqual([
            'name', 'label', 'object', 'events', 'priority', 'async', 'description',
        ]);
    });

    it('control — a type with no declared list carries no `list` key', async () => {
        const { entries } = await makeProtocol().getMetaTypes();
        const undeclared = entries.filter((e: any) => !(e.type in METADATA_LIST_REGISTRY));
        expect(undeclared.length).toBeGreaterThan(0);
        for (const entry of undeclared) expect(Object.prototype.hasOwnProperty.call(entry, 'list'), entry.type).toBe(false);
    });
});
