// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3946] `POST /data/:object/query` spread the request body OVER
// `{ object: objectName }`, so a body `object` key moved the read to a
// different object than the URL named — the same shape #3933 fixed on the REST
// bulk routes, found by the follow-up sweep for that pattern.
//
// These run through the REAL `callData`, so they pin both halves at once: the
// object the ADR-0049 exposure gate consults and the object actually queried
// are the same one, and it is the one in the path.

import { describe, it, expect, vi } from 'vitest';
import { handleDataRequest } from './data.js';

/** Records what the protocol service was asked for. */
function setup(objectDefs: Record<string, any> = {}) {
    const findData = vi.fn(async (req: any) => ({ object: req.object, records: [], total: 0 }));
    const protocol = { findData };
    const metadata = { getObject: async (name: string) => objectDefs[name] };
    const deps: any = {
        // [#5155] The request is the first argument of every kernel-reading
        // facility now; the fake takes it so a call site that forgot to pass
        // one cannot silently resolve the wrong slot name.
        resolveService: async (_ctx: any, name: string) => (name === 'protocol' ? protocol : name === 'metadata' ? metadata : null),
        getService: () => null,
        getObjectQL: async () => null,
        getRequestKernelService: async () => null,
        isMultiTenantHost: () => false,
        success: (data: any) => ({ status: 200, body: data }),
        error: (message: string, code = 500) => ({ status: code, body: { error: message } }),
        routeNotFound: (route: string) => ({ status: 404, body: { route } }),
        errorFromThrown: (e: any) => ({ status: e?.statusCode ?? e?.status ?? 500, body: { error: e?.message } }),
        resolveActiveOrganizationId: async () => undefined,
        announceKernelEvent: async () => {},
    };
    const context: any = { dataDriver: undefined, environmentId: undefined, executionContext: { userId: 'u1' } };
    return { deps, context, findData };
}

const post = (deps: any, context: any, path: string, body: any) =>
    handleDataRequest(deps, path, 'POST', body, {}, context);

describe('POST /data/:object/query binds to the object in the path (#3946)', () => {
    it('a body `object` cannot move the read to another object', async () => {
        const { deps, context, findData } = setup();
        const res = await post(deps, context, 'crm_account/query', {
            object: 'sys_user',
            where: { name: 'x' },
        });

        expect(res.handled).toBe(true);
        expect(findData).toHaveBeenCalledTimes(1);
        expect(findData.mock.calls[0][0].object).toBe('crm_account');
    });

    it('the exposure gate and the read agree on the path object', async () => {
        // `sys_user` is hidden from the API; `crm_account` is not. Pointing the
        // URL at the exposed object and naming the hidden one in the body must
        // not read the hidden one — and must not be refused on its behalf
        // either. Both decisions follow the path.
        const { deps, context, findData } = setup({
            crm_account: { apiEnabled: true },
            sys_user: { apiEnabled: false },
        });

        const res: any = await post(deps, context, 'crm_account/query', { object: 'sys_user' });
        expect(res.response.status).toBe(200);
        expect(findData.mock.calls[0][0].object).toBe('crm_account');

        // Addressed directly, the hidden object is still refused. The gate
        // THROWS a `{ statusCode }` shape; the dispatcher above turns it into
        // an envelope (`errorFromThrown`), so assert the throw here.
        await expect(post(deps, context, 'sys_user/query', {})).rejects.toMatchObject({ statusCode: 404 });
        expect(findData).toHaveBeenCalledTimes(1); // the refused call never read
    });

    it('still forwards the rest of the body as the query', async () => {
        const { deps, context, findData } = setup();
        await post(deps, context, 'crm_account/query', { where: { status: 'open' }, limit: 5 });

        const req = findData.mock.calls[0][0];
        expect(req.object).toBe('crm_account');
        expect(req.query).toMatchObject({ where: { status: 'open' }, limit: 5 });
    });

    it('still honours an explicit `query` envelope', async () => {
        const { deps, context, findData } = setup();
        await post(deps, context, 'crm_account/query', { query: { where: { status: 'open' } } });

        expect(findData.mock.calls[0][0].query).toEqual({ where: { status: 'open' } });
    });

    it('threads the caller execution context through unchanged', async () => {
        const { deps, context, findData } = setup();
        await post(deps, context, 'crm_account/query', { context: { userId: 'root', isSystem: true } });

        expect(findData.mock.calls[0][0].context).toBe(context.executionContext);
    });
});
