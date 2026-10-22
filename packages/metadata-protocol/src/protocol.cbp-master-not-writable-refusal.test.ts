// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25092 — the object save door refuses a `controlled_by_parent` detail whose
 * one required `master_detail` is marked `readonly: true` or `system: true`.
 *
 * ADR-0055 §1 derives such an object's master from exactly one required
 * `master_detail` that every write of a detail supplies. The rule lives in the
 * spec parse (`controlledByParentMasterRefusal`, shape `master-not-writable`),
 * and `saveMetaItem` parses with `ObjectSchema`, so the door answers
 * `422 INVALID_METADATA` at `fields` and stores nothing — the same refusal
 * `os validate` and `os build` meet, from the same rule.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** The engine surface the repository write path touches (as the container-issue-descent harness). */
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

const detailWith = (flags: Record<string, unknown>) => ({
    name: 'work_order_item',
    label: 'Work Order Item',
    sharingModel: 'controlled_by_parent',
    fields: {
        order: { name: 'order', type: 'master_detail', label: 'Order', reference: 'work_order', required: true, ...flags },
        note: { name: 'note', type: 'text', label: 'Note' },
    },
});

describe('#25092 the save door refuses a controlled_by_parent detail whose one master is not writable', () => {
    it.each([
        ['readonly: true', { readonly: true }, '`readonly: true`'],
        ['system: true', { system: true }, '`system: true`'],
    ])('a one master marked %s answers 422 INVALID_METADATA at `fields`, and nothing is stored', async (_label, flags, named) => {
        const { protocol, rows } = makeProtocol();

        const err = await rejection(protocol.saveMetaItem({
            type: 'object', name: 'work_order_item', item: detailWith(flags),
        }));

        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        expect(err.issues).toEqual([expect.objectContaining({ path: 'fields', code: 'custom' })]);
        expect(err.issues[0].message.startsWith(
            "Object 'work_order_item' declares sharingModel 'controlled_by_parent' with its one required "
            + `\`master_detail\`, \`order\`, marked ${named}.`,
        )).toBe(true);
        expect(rows.size).toBe(0);
    });

    it('control: the same detail with a writable master saves', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({
            type: 'object', name: 'work_order_item', item: detailWith({}),
        });

        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });
});
