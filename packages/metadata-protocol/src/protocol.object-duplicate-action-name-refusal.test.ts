// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26725 — the object save door refuses an object that declares one action
 * name twice.
 *
 * Measured on `main` @ `c8583f80` before the rule, on a `pnpm dev:crm` boot:
 * `PUT /api/v1/meta/object/dup_item?mode=draft` with two actions named `dup`
 * answered 200 and the publish answered 200. The rule lives in the spec parse
 * (`duplicateActionNames`, the object refinement), and `saveMetaItem` parses
 * with `ObjectSchema`, so the door answers `422 INVALID_METADATA` at the
 * second declaration and stores nothing — the refusal `defineStack` and
 * `os validate` meet, from the same rule.
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

const act = (name: string, label: string) => ({ name, label, type: 'script', target: 'noop', locations: ['record_header'] });

const itemWith = (actions: unknown[]) => ({
    name: 'dup_item',
    label: 'Dup Item',
    sharingModel: 'private',
    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
    actions,
});

describe('#26725 the save door refuses an object that declares one action name twice', () => {
    it('two actions named `dup` answer 422 INVALID_METADATA at the second one, and nothing is stored', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await rejection(protocol.saveMetaItem({
            type: 'object', name: 'dup_item', item: itemWith([act('dup', 'Dup A'), act('dup', 'Dup B')]),
        }));

        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        expect(err.issues).toEqual([expect.objectContaining({ path: 'actions.1', code: 'custom' })]);
        expect(err.issues[0].message.startsWith(
            "Object 'dup_item' declares the action 'dup' twice in actions: actions[0] and actions[1].",
        )).toBe(true);
        expect(rows.size).toBe(0);
    });

    it('control: the same object with distinct action names saves', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({
            type: 'object', name: 'dup_item', item: itemWith([act('dup', 'Dup A'), act('dup_b', 'Dup B')]),
        });

        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });
});
