// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 §4.2 · #25168] The object save door refuses an `external` binding
 * on the platform's primary datasource.
 *
 * ADR-0015 §4.2 allows `object.external` only on a datasource whose
 * `schemaMode` is not `'managed'`, declared "enforced at metadata-load time".
 * `saveMetaItem` used to store such an object: `datasource` omitted or
 * `'default'`, `external` present. `ObjectSchema`'s refinement now refuses the
 * binding at `external` (the primary datasource is managed by construction),
 * and this door inherits it through its spec-conformance parse: `422
 * INVALID_METADATA`, the finding at `external`, nothing stored.
 *
 * The half that needs a named datasource's definition is not this door's
 * parse: it cannot see the datasource, so a binding that names one saves here
 * whatever that datasource declares.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** The engine surface the repository write path touches (as the select-shorthand harness). */
function makeProtocol() {
    const rows = new Map<string, Record<string, unknown>>();
    let nextId = 0;
    const engine: any = {
        async findOne(object: string, query?: EngineFindOneQueryInput) {
            assertEngineFindOnePredicate(object, query); return null; },
        async find() { return []; },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            if (table === 'sys_metadata') rows.set(`${data.type}|${data.name}`, data);
            return { id: `r_${nextId}` };
        },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: { registerItem: () => {}, registerObject: () => {} },
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map());
    return { protocol, rows };
}

async function rejection(promise: Promise<unknown>): Promise<any> {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    throw new Error('expected the save to be rejected, but it resolved');
}

const order = (extra: Record<string, unknown>) => ({
    name: 'wh_order',
    label: 'Order',
    sharingModel: 'private',
    fields: { title: { name: 'title', label: 'Title', type: 'text' } },
    ...extra,
});

describe('#25168 the object save door refuses an `external` binding on the primary datasource', () => {
    it.each([
        ['`datasource` omitted', { external: { remoteName: 'orders' } }],
        ["`datasource: 'default'`", { datasource: 'default', external: { remoteName: 'orders' } }],
    ])('%s: 422 INVALID_METADATA at `external`, and nothing is stored', async (_label, extra) => {
        const { protocol, rows } = makeProtocol();

        const err = await rejection(protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: order(extra) }));

        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        expect(err.issues).toEqual([
            expect.objectContaining({ path: 'external', code: 'custom' }),
        ]);
        expect(err.issues[0].message).toMatch(/^Object 'wh_order' declares `external`, but its `datasource` is 'default'/);
        expect(rows.size).toBe(0);
    });

    it.each([
        ['a binding naming a datasource (this half needs only the object)', { datasource: 'lake', external: { remoteName: 'orders' } }],
        ['no binding, on the primary datasource', { datasource: 'default' }],
    ])('control — %s saves', async (_label, extra) => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({ type: 'object', name: 'wh_order', item: order(extra) });

        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });
});
