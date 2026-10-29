// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The runtime dispatcher's data faces refuse a write to `sys_api_key` from a
// principal an API key admitted: changing a key is a signed-in-session act, the
// answer `/keys` gives. The rule is `@objectstack/core`'s
// `apiKeyManagementCredentialRefusal`, asked at the per-object gate every data
// face of this door passes (`refuseUnexposedDataAction`, reached through
// `callData`), and the credential is the one the dispatcher's identity step
// wrote to `HttpProtocolContext.admission`.
//
// Both halves are pinned per case: the refusal (thrown with `code` + `status`,
// rendered by the dispatcher's own `errorFromThrown` on the ADR-0112 envelope)
// and that the protocol was never asked; and, for every caller the rule leaves
// alone, the write the protocol actually received.

import { describe, it, expect, vi } from 'vitest';
import { handleDataRequest } from './data.js';
import { callData } from '../action-execution.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';

/** The dispatcher's OWN exits, borrowed off a real dispatcher (see `data-path-object.test.ts`). */
const realDomainDeps = (() => {
    const dispatcher: any = new HttpDispatcher({ context: { getService: () => null } } as any);
    const domainDeps: DomainHandlerDeps = dispatcher.domainDeps;
    return {
        success: domainDeps.success,
        error: domainDeps.error,
        routeNotFound: domainDeps.routeNotFound,
        errorFromThrown: domainDeps.errorFromThrown,
    };
})();

function setup(admission: { credential: 'api_key' | 'session'; authGate: undefined } | undefined, opts: { isSystem?: boolean } = {}) {
    const updateData = vi.fn(async (req: any) => ({ object: req.object, id: req.id, record: { id: req.id, ...req.data } }));
    const findData = vi.fn(async (req: any) => ({ object: req.object, records: [], total: 0 }));
    const protocol = { updateData, findData };
    const metadata = { getObject: async () => undefined };
    const deps: any = {
        resolveService: async (_ctx: any, name: string) =>
            name === 'protocol' ? protocol : name === 'metadata' ? metadata : null,
        getService: () => null,
        getObjectQL: async () => null,
        getRequestKernelService: async () => null,
        isMultiTenantHost: () => false,
        ...realDomainDeps,
        resolveActiveOrganizationId: async () => undefined,
        announceKernelEvent: async () => {},
    };
    const executionContext: any = { userId: 'u1', ...(opts.isSystem ? { isSystem: true } : {}) };
    const context: any = { dataDriver: undefined, environmentId: undefined, executionContext, ...(admission ? { admission } : {}) };
    return { deps, context, updateData, findData };
}

const API_KEY = { credential: 'api_key' as const, authGate: undefined };
const SESSION = { credential: 'session' as const, authGate: undefined };

describe('dispatcher data faces: changing an API key requires a signed-in session', () => {
    it('refuses PATCH sys_api_key from an API-key-admitted caller with 403 PERMISSION_DENIED, and never asks the protocol', async () => {
        const { deps, context, updateData } = setup(API_KEY);
        let thrown: any;
        try {
            await handleDataRequest(deps, 'sys_api_key/k1', 'PATCH', { revoked: false }, {}, context);
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: 'sys_api_key' });
        expect(updateData).not.toHaveBeenCalled();

        // The envelope this door renders for it, through its own exit.
        const rendered: any = realDomainDeps.errorFromThrown(thrown, 500);
        expect(rendered.status).toBe(403);
        expect(rendered.body.success).toBe(false);
        expect(rendered.body.error.code).toBe('PERMISSION_DENIED');
        expect(rendered.body.error.httpStatus).toBe(403);
    });

    it('refuses the same write through callData, the seam the /mcp bridge and the action doors ask', async () => {
        const { deps, context, updateData } = setup(API_KEY);
        await expect(
            callData(deps, context, 'update', { object: 'sys_api_key', id: 'k1', data: { revoked: true } },
                undefined, undefined, context.executionContext),
        ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: 'sys_api_key' });
        expect(updateData).not.toHaveBeenCalled();
    });

    it('serves the same PATCH for a session-admitted caller, with the patch it sent', async () => {
        const { deps, context, updateData } = setup(SESSION);
        const res: any = await handleDataRequest(deps, 'sys_api_key/k1', 'PATCH', { revoked: false }, {}, context);
        expect(res.response.status).toBe(200);
        expect(updateData).toHaveBeenCalledTimes(1);
        expect(updateData.mock.calls[0][0]).toMatchObject({ object: 'sys_api_key', id: 'k1', data: { revoked: false } });
    });

    it('serves it for a context whose admission this door was never told (the rule is positive on the credential)', async () => {
        const { deps, context, updateData } = setup(undefined);
        const res: any = await handleDataRequest(deps, 'sys_api_key/k1', 'PATCH', { revoked: true }, {}, context);
        expect(res.response.status).toBe(200);
        expect(updateData).toHaveBeenCalledTimes(1);
    });

    it('leaves a system-context write alone whatever the admission says', async () => {
        const { deps, context, updateData } = setup(API_KEY, { isSystem: true });
        await callData(deps, context, 'update', { object: 'sys_api_key', id: 'k1', data: { last_used_at: 'now' } },
            undefined, undefined, context.executionContext);
        expect(updateData).toHaveBeenCalledTimes(1);
    });

    it('leaves reads of sys_api_key, and writes to every other object, alone for an API-key-admitted caller', async () => {
        const { deps, context, updateData, findData } = setup(API_KEY);
        const list: any = await handleDataRequest(deps, 'sys_api_key', 'GET', undefined, {}, context);
        expect(list.response.status).toBe(200);
        expect(findData).toHaveBeenCalledTimes(1);

        const other: any = await handleDataRequest(deps, 'crm_account/a1', 'PATCH', { name: 'x' }, {}, context);
        expect(other.response.status).toBe(200);
        expect(updateData).toHaveBeenCalledTimes(1);
        expect(updateData.mock.calls[0][0].object).toBe('crm_account');
    });
});
