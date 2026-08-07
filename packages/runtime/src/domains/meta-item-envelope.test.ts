// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /meta/:type/:name` on the dispatcher's `/meta` domain answers ONE body
 * shape — the spec-declared `{ type, name, item }` envelope — no matter which
 * of its three resolvers produced the answer (#5563).
 *
 * The domain resolves a single item through a chain, and each link used to
 * decide the response structure on its own:
 *
 *   - `protocol.getMetaItem` → the envelope (what `packages/spec` declares);
 *   - the ObjectQL **registry** fallback → `registry.getObject(name)`, a bare
 *     document;
 *   - the **MetadataService** fallback → `metaSvc.getItem(...)`, also bare.
 *
 * So one request could answer two different structures depending on which
 * service happened to be up — the same defect the REST server carried between
 * its cached and non-cached branches, one layer over. A consumer could only
 * sniff. Both fallbacks now wrap what they found, with `type`/`name` taken from
 * the request (exactly the values the protocol would have echoed back).
 *
 * Every assertion reads a value from INSIDE `item`, so re-flattening a fallback
 * fails on the value rather than passing vacuously on a key that is merely
 * present.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const CUSTOMER = { name: 'customer', label: 'Customer', fields: { id: { type: 'text' } } };
const AGENT = { name: 'triage_bot', label: 'Triage Bot', model: 'claude' };

/** Build a dispatcher whose kernel resolves exactly the named services. */
function make(services: Record<string, any>) {
    const kernel = {
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    } as any;
    return new HttpDispatcher(kernel);
}

const ctx = (): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u1', systemPermissions: [] },
});

describe('#5563 dispatcher /meta single-item — one shape across the resolver chain', () => {
    it('protocol hit: the envelope is passed through untouched', async () => {
        const getMetaItem = vi.fn(async ({ type, name }: any) => ({
            type, name, item: CUSTOMER, lock: 'none', editable: true,
        }));
        const res = await make({ protocol: { getMetaItem } }).handleMetadata('/object/customer', ctx(), 'GET');

        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toMatchObject({ type: 'object', name: 'customer', lock: 'none' });
        expect(res.response.body.data.item).toMatchObject({ label: 'Customer' });
    });

    it('REGISTRY fallback answers the envelope, not the bare ObjectSchema', async () => {
        // No protocol at all → the ObjectQL registry is the resolver. It hands
        // back the schema document; the domain owns wrapping it.
        const getObject = vi.fn(() => CUSTOMER);
        const res = await make({ objectql: { registry: { getObject } } })
            .handleMetadata('/object/customer', ctx(), 'GET');

        expect(res.response.status).toBe(200);
        const body = res.response.body.data;
        expect(getObject).toHaveBeenCalledWith('customer');
        expect(body).toMatchObject({ type: 'object', name: 'customer' });
        expect(body.item).toMatchObject({ name: 'customer', label: 'Customer' });
        expect(body.item.fields).toEqual({ id: { type: 'text' } });
        // Not spread at the top level — that was the old, second shape.
        expect(body.label).toBeUndefined();
        expect(body.fields).toBeUndefined();
    });

    it('an item-less protocol answer falls through to the registry instead of being served as a hit', async () => {
        // A metadata-store outage resolves `getMetaItem` to `{ type, name }`
        // with NO item. The guard used to read `data.item ?? data`, which is
        // truthy for any truthy `data`, so that item-less answer was served as
        // a hit and this fallback never ran — the guard's own comment said it
        // fell through. Now it does.
        const getMetaItem = vi.fn(async ({ type, name }: any) => ({ type, name }));
        const getObject = vi.fn(() => CUSTOMER);
        const res = await make({
            protocol: { getMetaItem, getProjectId: () => 'env_1' },
            objectql: { registry: { getObject } },
        }).handleMetadata('/object/customer', ctx(), 'GET');

        expect(getMetaItem).toHaveBeenCalled();
        expect(getObject).toHaveBeenCalled();
        expect(res.response.body.data.item).toMatchObject({ label: 'Customer' });
    });

    it('METADATASERVICE fallback answers the envelope, with the request`s singular type', async () => {
        // Generic (non-object) type, no protocol → the MetadataService is the
        // resolver, and the URL is the plural spelling, so the envelope must
        // carry the canonical singular the protocol branch would have answered.
        const getItem = vi.fn(async () => AGENT);
        const res = await make({ metadata: { getItem } })
            .handleMetadata('/agents/triage_bot', ctx(), 'GET');

        expect(res.response.status).toBe(200);
        const body = res.response.body.data;
        expect(body).toMatchObject({ type: 'agent', name: 'triage_bot' });
        expect(body.item).toMatchObject({ label: 'Triage Bot', model: 'claude' });
        expect(body.model).toBeUndefined();
    });

    it('a resolver-less request is still 404, not an empty envelope', async () => {
        const res = await make({}).handleMetadata('/agent/nope', ctx(), 'GET');
        expect(res.response.status).toBe(404);
    });
});
