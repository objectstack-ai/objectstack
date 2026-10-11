// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22737] A NESTED-RELATION filter condition is evaluated on the related
 * object, so the data door asks that TARGET the spec's one exposure decision
 * (`apiExposureDenialReason(enable, 'list')`, ADR-0049) and refuses a target
 * it does not serve, in the door's own exposure answer: `404
 * OBJECT_API_DISABLED`, or `405 OBJECT_API_METHOD_NOT_ALLOWED` with the
 * effective operation set.
 *
 * Asserted on the envelope (`code` and `status`) and on the engine: a refused
 * condition never reaches `engine.find` / `engine.aggregate`, so nothing of the
 * target is read. Each refused shape is paired with a CONTROL the decision
 * serves, which must reach the engine unchanged. The administrator and member
 * answers on a real stack are pinned in `@objectstack/dogfood`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from './protocol.js';

const lookup = (name: string, reference: string) => ({ name, label: name, type: 'lookup', reference });

const object = (name: string, enable?: Record<string, unknown>, extra: Record<string, unknown> = {}): ServiceObject => ({
    name,
    label: name,
    ...(enable ? { enable } : {}),
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        ...extra,
    },
} as unknown as ServiceObject);

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
    // Exposed, with a lookup into the off-switched object: an `expand` entry's own filter reaches it.
    rc_open: object('rc_open', undefined, { inner: lookup('inner', 'rc_hidden') }),
};

function makeProtocol() {
    const find = vi.fn(async () => [{ id: 's1', name: 'source' }]);
    const aggregate = vi.fn(async () => [{ name: 'source', n: 1 }]);
    const count = vi.fn(async () => 1);
    const engine: any = { registry: { getObject: (n: string) => SCHEMAS[n] }, find, aggregate, count };
    return { p: new ObjectStackProtocolImplementation(engine), find, aggregate };
}

/** Each refused target, the door's answer, and the effective set a 405 names. */
const REFUSED = {
    hidden: { status: 404, code: 'OBJECT_API_DISABLED', allowed: undefined },
    closed: { status: 405, code: 'OBJECT_API_METHOD_NOT_ALLOWED', allowed: ['create'] },
    denyall: { status: 405, code: 'OBJECT_API_METHOD_NOT_ALLOWED', allowed: [] },
    getonly: { status: 405, code: 'OBJECT_API_METHOD_NOT_ALLOWED', allowed: ['get'] },
} as const;
const SERVED = ['listonly', 'open'] as const;

/** A member and the most privileged caller: the decision takes no caller. */
const CONTEXTS = [{ userId: 'rc_member' }, { isSystem: true }];

describe('[#22737] the data door refuses a nested-relation condition whose target the API does not serve', () => {
    for (const [rel, answer] of Object.entries(REFUSED)) {
        for (const context of CONTEXTS) {
            it(`${rel}: refused ${answer.status} ${answer.code} on the POST where and the list filter (${JSON.stringify(context)})`, async () => {
                const { p, find } = makeProtocol();
                for (const query of [
                    { where: { [rel]: { name: 'x' } } },
                    { $filter: JSON.stringify({ name: 'source', $or: [{ [rel]: { name: 'x' } }] }) },
                ]) {
                    const err: any = await p.findData({ object: 'rc_source', query, context }).catch((e) => e);
                    expect(err).toBeInstanceOf(Error);
                    expect({ code: err.code, status: err.status }).toEqual({ code: answer.code, status: answer.status });
                    expect(err.object).toBe(`rc_${rel}`);
                    expect(err.allowed).toEqual(answer.allowed);
                }
                expect(find).not.toHaveBeenCalled();
            });
        }
    }

    for (const rel of SERVED) {
        it(`CONTROL ${rel}: served, the condition reaches the engine unchanged`, async () => {
            const { p, find } = makeProtocol();
            await p.findData({ object: 'rc_source', query: { where: { [rel]: { name: 'x' } } } });
            expect(find).toHaveBeenCalledTimes(1);
            expect((find.mock.calls[0] as any[])[1].where).toEqual({ [rel]: { name: 'x' } });
        });
    }

    it('the grouped read is refused before the engine aggregates', async () => {
        const { p, aggregate } = makeProtocol();
        const err: any = await p
            .findData({ object: 'rc_source', query: { where: { hidden: { name: 'x' } }, groupBy: ['name'], aggregations: [{ function: 'count', alias: 'n' }] } })
            .catch((e) => e);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
        expect(aggregate).not.toHaveBeenCalled();
    });

    it('an expand entry\'s own filter is judged against its level: a condition into an unexposed object is refused', async () => {
        const { p, find } = makeProtocol();
        const err: any = await p
            .findData({ object: 'rc_source', query: { expand: { open: { object: 'open', where: { inner: { name: 'x' } } } } } })
            .catch((e) => e);
        expect({ code: err.code, status: err.status, object: err.object }).toEqual({ code: 'OBJECT_API_DISABLED', status: 404, object: 'rc_hidden' });
        expect(find).not.toHaveBeenCalled();
    });

    it('CONTROL: a plain id comparand on the same lookup is the source\'s own column and is served', async () => {
        const { p, find } = makeProtocol();
        await p.findData({ object: 'rc_source', query: { where: { hidden: 'h1', getonly: { $in: ['g1'] } } } });
        expect(find).toHaveBeenCalledTimes(1);
    });
});
