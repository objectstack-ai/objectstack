// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29212 — the dashboard save door refuses a dashboard that declares one
 * global filter key twice (the #29023 refusal), in every save mode.
 *
 * The rule lives in the spec parse (`duplicateGlobalFilterNames`, the
 * `globalFilters` refinement of `DashboardSchema`), and `saveMetaItem` parses
 * with that schema, so `PUT /api/v1/meta/dashboard/X` answers
 * `422 INVALID_METADATA` at the second declaration's key and stores nothing,
 * with no mode, with `mode: 'publish'` and with `mode: 'draft'` alike. This
 * pins that the door keeps reading the refusal; the v18 stored listing
 * (`refused-shapes.ts`) names a row already stored in the shape.
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

const MODES = [
    ['no mode', {}],
    ['publish', { mode: 'publish' }],
    ['draft', { mode: 'draft' }],
] as const;

const boardWith = (globalFilters: unknown[]) => ({
    name: 'dup_board',
    label: 'Dup Board',
    widgets: [],
    globalFilters,
});

describe('#29212 the save door refuses a dashboard that declares one global filter key twice', () => {
    for (const [label, mode] of MODES) {
        it(`${label}: two filters named \`r\` answer 422 INVALID_METADATA at globalFilters.1.name, and nothing is stored`, async () => {
            const { protocol, rows } = makeProtocol();

            const err = await rejection(protocol.saveMetaItem({
                type: 'dashboard', name: 'dup_board', ...mode, item: boardWith([
                    { name: 'r', field: 'region', type: 'text' },
                    { name: 'r', field: 'status', type: 'text' },
                ]),
            }));

            expect(err.code).toBe('INVALID_METADATA');
            expect(err.status).toBe(422);
            expect(err.issues).toEqual([expect.objectContaining({ path: 'globalFilters.1.name', code: 'custom' })]);
            expect(err.issues[0].message.startsWith(
                "This dashboard declares the global filter 'r' twice in globalFilters: globalFilters[0] and globalFilters[1].",
            )).toBe(true);
            expect(rows.size).toBe(0);
        });

        it(`${label}: control, the same dashboard with distinct filter names saves`, async () => {
            const { protocol, rows } = makeProtocol();

            const result = await protocol.saveMetaItem({
                type: 'dashboard', name: 'dup_board', ...mode, item: boardWith([
                    { name: 'r', field: 'region', type: 'text' },
                    { name: 's', field: 'status', type: 'text' },
                ]),
            });

            expect(result.success).toBe(true);
            expect(rows.size).toBe(1);
        });
    }
});
