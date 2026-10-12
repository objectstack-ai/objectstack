// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22823] Census row 10 of #22661 — `callData` hands a caller's `where` to the
 * ObjectQL ENGINE on two arms: the `query` fallback (no protocol service
 * resolved) and the `aggregate` arm (which never takes the protocol). The engine
 * lowers a NESTED-RELATION condition by reading the related object as the
 * caller, so each condition's TARGET is asked the exposure gate the addressed
 * object is asked, for `list`, before the engine is called, and a target the
 * gate does not serve refuses the call with the data door's own answer (`404
 * OBJECT_API_DISABLED`, or `405 OBJECT_API_METHOD_NOT_ALLOWED` with the
 * effective operation set).
 *
 * Asserted on the envelope (`code` and `status`) and on the engine: a refused
 * condition never reaches `find` / `aggregate`. Each refused shape is paired
 * with a CONTROL the gate serves, which reaches the engine unchanged, and the
 * protocol path is pinned untouched — with the protocol service present the
 * query is the data door's to judge, and this door hands it over verbatim.
 */

import { describe, expect, it, vi } from 'vitest';
import { callData, type ActionExecutionDeps } from './action-execution.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

const REQ = { request: {} } as HttpProtocolContext;
const MEMBER = { userId: 'rc_member', isSystem: false, positions: [], permissions: [] } as any;

const lookup = (name: string, reference: string) => ({ name, label: name, type: 'lookup', reference });

const object = (name: string, enable?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    ...(enable ? { enable } : {}),
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        ...extra,
    },
});

const SCHEMAS: Record<string, unknown> = {
    rc_source: object('rc_source', undefined, {
        hidden: lookup('hidden', 'rc_hidden'),
        closed: lookup('closed', 'rc_closed'),
        denyall: lookup('denyall', 'rc_denyall'),
        getonly: lookup('getonly', 'rc_getonly'),
        listonly: lookup('listonly', 'rc_listonly'),
        open: lookup('open', 'rc_open'),
    }),
    // `apiEnabled: false` is judged FIRST: a whitelist granting `list` beside it changes nothing.
    rc_hidden: object('rc_hidden', { apiEnabled: false, apiMethods: ['list'] }),
    rc_closed: object('rc_closed', { apiMethods: ['create'] }),
    rc_denyall: object('rc_denyall', { apiMethods: [] }),
    rc_getonly: object('rc_getonly', { apiMethods: ['get'] }),
    rc_listonly: object('rc_listonly', { apiMethods: ['list'] }),
    rc_open: object('rc_open'),
};

/** Each refused target, the door's answer, and the effective set a 405 names. */
const REFUSED = {
    hidden: { status: 404, code: 'OBJECT_API_DISABLED', allowed: undefined },
    closed: { status: 405, code: 'OBJECT_API_METHOD_NOT_ALLOWED', allowed: ['create', 'import'] },
    denyall: { status: 405, code: 'OBJECT_API_METHOD_NOT_ALLOWED', allowed: [] },
    getonly: { status: 405, code: 'OBJECT_API_METHOD_NOT_ALLOWED', allowed: ['get'] },
} as const;
const SERVED = ['listonly', 'open'] as const;

/**
 * The engine `callData` falls back to, with its registry (the schema the
 * engine's relation lowering reads) and spies on the two verbs a caller's
 * `where` reaches. `withProtocol` adds the data door, which then serves the
 * query arm.
 */
function makeHarness(opts: { withProtocol?: boolean } = {}) {
    const find = vi.fn(async () => [{ id: 's1', name: 'source' }]);
    const aggregate = vi.fn(async () => [{ n: 1 }]);
    const findData = vi.fn(async (req: any) => ({ object: req.object, records: [], total: 0, hasMore: false }));
    const engine: any = { registry: { getObject: (n: string) => SCHEMAS[n] }, find, aggregate };
    const services: Record<string, any> = {
        metadata: { getObject: async (n: string) => SCHEMAS[n] },
        objectql: engine,
        ...(opts.withProtocol ? { protocol: { findData } } : {}),
    };
    const deps: ActionExecutionDeps = {
        resolveService: (async (_ctx: HttpProtocolContext, name: string) => services[name]) as any,
        getObjectQL: async () => engine,
    };
    return { deps, find, aggregate, findData };
}

const refusal = (e: any) => ({ code: e?.code, status: e?.status, object: e?.object, param: e?.param, allowed: e?.allowed });

describe('[#22823] callData asks each nested-relation condition\'s target its exposure before the engine reads it', () => {
    for (const [rel, answer] of Object.entries(REFUSED)) {
        it(`query fallback: ${rel} is refused ${answer.status} ${answer.code}, top level and under a combinator`, async () => {
            const h = makeHarness();
            for (const where of [{ [rel]: { name: 'x' } }, { name: 'source', $or: [{ [rel]: { name: 'x' } }] }]) {
                const err: any = await callData(h.deps, REQ, 'query', { object: 'rc_source', query: { where } }, undefined, undefined, MEMBER)
                    .catch((e) => e);
                expect(err).toBeInstanceOf(Error);
                expect(refusal(err)).toEqual({ code: answer.code, status: answer.status, object: `rc_${rel}`, param: `where.${rel}`, allowed: answer.allowed });
            }
            expect(h.find).not.toHaveBeenCalled();
        });

        it(`aggregate arm: ${rel} is refused ${answer.status} ${answer.code} before the engine aggregates`, async () => {
            const h = makeHarness();
            const err: any = await callData(
                h.deps, REQ, 'aggregate',
                { object: 'rc_source', where: { [rel]: { name: 'x' } }, aggregations: [{ function: 'count', alias: 'n' }] },
                undefined, undefined, MEMBER,
            ).catch((e) => e);
            expect(err).toBeInstanceOf(Error);
            expect(refusal(err)).toEqual({ code: answer.code, status: answer.status, object: `rc_${rel}`, param: `where.${rel}`, allowed: answer.allowed });
            expect(h.aggregate).not.toHaveBeenCalled();
        });
    }

    for (const rel of SERVED) {
        it(`CONTROL ${rel}: served, the condition reaches the engine unchanged on both arms`, async () => {
            const h = makeHarness();
            await callData(h.deps, REQ, 'query', { object: 'rc_source', query: { where: { [rel]: { name: 'x' } } } }, undefined, undefined, MEMBER);
            expect(h.find).toHaveBeenCalledTimes(1);
            expect((h.find.mock.calls[0] as any[])[1].where).toEqual({ [rel]: { name: 'x' } });
            await callData(
                h.deps, REQ, 'aggregate',
                { object: 'rc_source', where: { [rel]: { name: 'x' } }, aggregations: [{ function: 'count', alias: 'n' }] },
                undefined, undefined, MEMBER,
            );
            expect(h.aggregate).toHaveBeenCalledTimes(1);
            expect((h.aggregate.mock.calls[0] as any[])[1].where).toEqual({ [rel]: { name: 'x' } });
        });
    }

    it('CONTROL: a plain id comparand on the same lookups is the source\'s own column and is served', async () => {
        const h = makeHarness();
        await callData(h.deps, REQ, 'query', { object: 'rc_source', query: { where: { hidden: 'h1', getonly: { $in: ['g1'] } } } }, undefined, undefined, MEMBER);
        expect(h.find).toHaveBeenCalledTimes(1);
    });

    it('CONTROL: a system context is not asked, as the addressed object\'s gate is not', async () => {
        const h = makeHarness();
        await callData(h.deps, REQ, 'query', { object: 'rc_source', query: { where: { hidden: { name: 'x' } } } }, undefined, undefined, { isSystem: true } as any);
        expect(h.find).toHaveBeenCalledTimes(1);
    });

    it('the protocol path is untouched: the data door gets the query verbatim and the engine is never called here', async () => {
        const h = makeHarness({ withProtocol: true });
        const query = { where: { hidden: { name: 'x' } } };
        await callData(h.deps, REQ, 'query', { object: 'rc_source', query }, undefined, undefined, MEMBER);
        expect(h.findData).toHaveBeenCalledTimes(1);
        expect((h.findData.mock.calls[0] as any[])[0].query).toEqual(query);
        expect(h.find).not.toHaveBeenCalled();
    });
});
