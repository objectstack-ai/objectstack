// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7557, #24097] `GET /meta/object/:name` on the dispatcher transport answers
 * an object of a DISABLED package as the protocol does: `404
 * OBJECT_PACKAGE_DISABLED`, never the registry's copy of it.
 *
 * The object branch of `handleMetadataRequest` has two registry reads, and
 * both served that object before:
 *
 *  - an UNSCOPED kernel reads `registry.getObject(name)` FIRST and asks the
 *    protocol only when the registry misses;
 *  - a SCOPED kernel asks the protocol first, and when the protocol throws it
 *    fell through to `registry.getObject(name)`.
 *
 * The registry is a resolution reader: it keeps a disabled package's objects
 * on purpose (migrations and cross-package references resolve through it, see
 * `packages/objectql/src/package-disable-enforcement.test.ts`). So neither
 * read may answer an API door for such an object. The protocol's refusal is
 * the answer.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const DISABLED = 'demo_widget';
const HEALTHY = 'healthy_widget';

const schema = (name: string) => ({
    name,
    label: 'Demo',
    fields: { name: { name: 'name', type: 'text', label: 'Name' } },
});

/** The protocol's own refusal, as `objectPackageDisabledError` builds it. */
const refusal = (object: string) => Object.assign(
    new Error(`Object '${object}' belongs to a disabled package and is not being served. `
        + 'Re-enable the package to restore access.'),
    { code: 'OBJECT_PACKAGE_DISABLED', status: 404, object },
);

function boot(opts: { scoped: boolean }) {
    const getMetaItem = vi.fn(async ({ name }: any) => {
        if (name === DISABLED) throw refusal(name);
        return { type: 'object', name, item: schema(name) };
    });
    const protocol: Record<string, unknown> = {
        getMetaItem,
        ...(opts.scoped ? { environmentId: 'env_scoped' } : {}),
    };
    // The real registry keeps serving both objects (a resolution reader) and
    // answers the predicate for the disabled one.
    const registry = {
        getObject: vi.fn((name: string) => (name === DISABLED || name === HEALTHY ? schema(name) : undefined)),
        isObjectPackageDisabled: (name: string) => name === DISABLED,
    };
    const auth = { api: { getSession: async () => ({ user: { id: 'u_session' } }) } };
    const services: Record<string, any> = { protocol, auth, objectql: { registry } };
    const get = (n: string) => services[n] ?? null;
    const kernel = {
        context: { getService: get },
        getService: get,
        getServiceAsync: async (n: string) => get(n),
    } as any;
    return {
        // The environment-membership gate is not this file's subject.
        dispatcher: new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false }),
        getMetaItem,
        registry,
    };
}

const SESSION = (): any => ({ request: { headers: {} }, environmentId: 'platform' });

describe('#24097 — the dispatcher\'s /meta object door and a disabled package', () => {
    for (const scoped of [false, true]) {
        const kernel = scoped ? 'scoped kernel (protocol first)' : 'unscoped kernel (registry first)';

        it(`${kernel}: refuses 404 OBJECT_PACKAGE_DISABLED, never the registry's copy`, async () => {
            const stack = boot({ scoped });

            const res = await stack.dispatcher.dispatch('GET', `/meta/object/${DISABLED}`, {}, {}, SESSION());

            expect(res.response?.status).toBe(404);
            expect(res.response?.body?.success).toBe(false);
            expect(res.response?.body?.error?.code).toBe('OBJECT_PACKAGE_DISABLED');
            // The protocol answered, and the registry's copy was not served.
            expect(stack.getMetaItem).toHaveBeenCalled();
            expect(stack.registry.getObject).not.toHaveBeenCalledWith(DISABLED);
        });

        it(`${kernel}: the control, another package's object is served`, async () => {
            const stack = boot({ scoped });

            const res = await stack.dispatcher.dispatch('GET', `/meta/object/${HEALTHY}`, {}, {}, SESSION());

            expect(res.response?.status).toBe(200);
            expect(res.response?.body?.data?.item?.name).toBe(HEALTHY);
        });
    }
});
