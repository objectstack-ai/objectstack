// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25013 — a `Field.select` shorthand string that is no system identifier is
 * refused at the object save door, by the refusal an explicit option value
 * already meets.
 *
 * The shorthand (`packages/spec` `selectWithOptions`) used to delete every
 * character outside `[a-z0-9_]`, so `Field.select(['no-overlay'])` declared
 * the value `nooverlay` — a different value than the one written, accepted
 * without a word. It now only lower-cases and joins whitespace with `_`, so
 * the written value reaches `SelectOptionSchema.value` and `saveMetaItem`
 * answers `422 INVALID_METADATA` naming the option slot, exactly as for
 * `{ label: 'no-overlay', value: 'no-overlay' }`.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { Field } from '@objectstack/spec/data';
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

const objectWith = (status: unknown) => ({
    name: 'ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: { status: { name: 'status', label: 'Status', ...(status as object) } },
});

describe('#25013 the save door refuses a shorthand option that is no system identifier', () => {
    it('`Field.select([\'open\', \'no-overlay\'])` answers 422 INVALID_METADATA at the option slot, and nothing is stored', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await rejection(protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectWith(Field.select(['open', 'no-overlay'])),
        }));

        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        expect(err.issues).toEqual([
            expect.objectContaining({ path: 'fields.status.options.1.value', code: 'invalid_format' }),
        ]);
        expect(rows.size).toBe(0);
    });

    it('the explicit `{ value: \'no-overlay\' }` meets the identical refusal — one refusal set, not two', async () => {
        const shorthand = await rejection(makeProtocol().protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectWith(Field.select(['open', 'no-overlay'])),
        }));
        const explicit = await rejection(makeProtocol().protocol.saveMetaItem({
            type: 'object', name: 'ticket',
            item: objectWith(Field.select({ options: ['open', { label: 'no-overlay', value: 'no-overlay' }] })),
        }));

        expect([explicit.code, explicit.status]).toEqual(['INVALID_METADATA', 422]);
        expect(shorthand.issues).toEqual(explicit.issues);
    });

    it('control: the documented transform still saves (`In Progress` → `in_progress`)', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectWith(Field.select(['Open', 'In Progress'])),
        });

        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });
});
