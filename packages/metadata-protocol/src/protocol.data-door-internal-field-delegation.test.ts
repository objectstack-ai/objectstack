// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The data door's `internal: true` evaluate refusal is the ENGINE's: `findData`
 * and the public face (`assertNoInternalFieldEvaluated`) ask the engine's
 * `QueryEvaluationGate` member before the engine reads anything, for every
 * caller, and hand it this door's relation-target exposure question as the
 * hook it runs at each hop. This file pins the door's half — that it asks,
 * with what, before what, and what an engine without the member gets. The
 * walk itself and the position enumeration are pinned beside the definition,
 * in `@objectstack/objectql` (`internal-field-evaluation-guard.test.ts`,
 * `protocol-data-door-internal-field-positions.test.ts`).
 */

import { describe, expect, it, vi } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const VAULT = {
    name: 'dl_vault',
    label: 'Vault',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        holder_id: { name: 'holder_id', label: 'Holder', type: 'lookup', reference: 'dl_holder' },
    },
} as unknown as ServiceObject;

/** The relation target, served nowhere on the API. */
const HOLDER = {
    name: 'dl_holder',
    label: 'Holder',
    enable: { apiEnabled: false },
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
    },
} as unknown as ServiceObject;

const SCHEMAS: Record<string, unknown> = { dl_vault: VAULT, dl_holder: HOLDER };

function refusalOf(param: string) {
    return Object.assign(new Error(`Cannot filter 'dl_vault' by 'name' (${param}): the query was not run.`), {
        code: 'INVALID_FIELD', status: 400, httpStatus: 400, object: 'dl_vault', field: 'name', param,
    });
}

function makeProtocol(gate?: (object: string, query: any, options?: any) => void) {
    const find = vi.fn(async () => [{ id: 'v1', name: 'alpha' }]);
    const engine: any = {
        registry: { getObject: (n: string) => SCHEMAS[n] },
        find,
        findOne: vi.fn(async (object: string, query: any) => { assertEngineFindOnePredicate(object, query); return { id: 'v1' }; }),
        count: vi.fn(async () => 1),
        aggregate: vi.fn(async () => []),
        ...(gate ? { assertNoInternalFieldEvaluated: vi.fn(gate) } : {}),
    };
    return { p: new ObjectStackProtocolImplementation(engine), engine, find };
}

describe('the data door asks the engine\'s internal-field gate', () => {
    it('findData asks it with the object and the query, before the engine reads anything; its refusal is the answer', async () => {
        const { p, engine, find } = makeProtocol(() => { throw refusalOf('filter'); });
        let thrown: any;
        try { await p.findData({ object: 'dl_vault', query: { where: { name: 'alpha' } } }); } catch (e) { thrown = e; }
        expect(thrown).toMatchObject({ code: 'INVALID_FIELD', status: 400, object: 'dl_vault', param: 'filter' });
        expect(engine.assertNoInternalFieldEvaluated).toHaveBeenCalledTimes(1);
        const [object, query, options] = engine.assertNoInternalFieldEvaluated.mock.calls[0];
        expect(object).toBe('dl_vault');
        expect(query).toMatchObject({ where: { name: 'alpha' } });
        expect(typeof options?.beforeRelationTarget).toBe('function');
        expect(find).not.toHaveBeenCalled();
    });

    it('asks it for a system context too — the door takes no caller carve-out', async () => {
        const { p, engine, find } = makeProtocol(() => { throw refusalOf('filter'); });
        await expect(p.findData({ object: 'dl_vault', query: { where: { name: 'alpha' } }, context: { isSystem: true } }))
            .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400 });
        expect(engine.assertNoInternalFieldEvaluated).toHaveBeenCalledTimes(1);
        expect(find).not.toHaveBeenCalled();
    });

    it('the hook it hands over is this door\'s relation-target exposure question', () => {
        const { p } = makeProtocol((_object, _query, options) => options?.beforeRelationTarget?.('dl_holder', 'filter.holder_id'));
        let thrown: any;
        try { p.assertNoInternalFieldEvaluated('dl_vault', { where: { holder_id: { name: 'Pat' } } }); } catch (e) { thrown = e; }
        expect(thrown).toMatchObject({ code: 'OBJECT_API_DISABLED', status: 404, object: 'dl_holder', param: 'filter.holder_id' });
    });

    it('CONTROL — a gate that passes leaves the read served by the engine', async () => {
        const { p, engine, find } = makeProtocol(() => {});
        const res: any = await p.findData({ object: 'dl_vault', query: { where: { name: 'alpha' } } });
        expect(engine.assertNoInternalFieldEvaluated).toHaveBeenCalledTimes(1);
        expect(find).toHaveBeenCalledTimes(1);
        expect((res.records ?? res.data ?? res).length).toBe(1);
    });

    it('an engine without the member is judged on no field here — the flag is the engine\'s to honour', async () => {
        const { p, find } = makeProtocol();
        expect(() => p.assertNoInternalFieldEvaluated('dl_vault', { where: { name: 'alpha' } })).not.toThrow();
        await p.findData({ object: 'dl_vault', query: { where: { name: 'alpha' } } });
        expect(find).toHaveBeenCalledTimes(1);
    });

    it('…but the door\'s exposure question is still asked at every hop on such an engine, before it reads', async () => {
        const { p, find } = makeProtocol();
        for (const [query, param] of [
            [{ where: { holder_id: { name: 'Pat' } } }, 'filter.holder_id'],
            [{ aggregations: [{ function: 'count', alias: 'n', filter: { holder_id: { name: 'Pat' } } }] }, 'aggregations[0].filter.holder_id'],
        ] as const) {
            let thrown: any;
            try { p.assertNoInternalFieldEvaluated('dl_vault', query as any); } catch (e) { thrown = e; }
            expect(thrown).toMatchObject({ code: 'OBJECT_API_DISABLED', status: 404, object: 'dl_holder', param });
        }
        await expect(p.findData({ object: 'dl_vault', query: { where: { holder_id: { name: 'Pat' } } } }))
            .rejects.toMatchObject({ code: 'OBJECT_API_DISABLED', status: 404 });
        expect(find).not.toHaveBeenCalled();
    });
});
