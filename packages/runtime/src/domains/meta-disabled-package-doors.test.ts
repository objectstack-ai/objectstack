// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7557, #24210] The dispatcher's `/meta` doors that read past the protocol —
 * the engine registry (a resolution reader, which keeps a disabled package's
 * objects) or the metadata service (which knows nothing of a disable) — answer
 * a DISABLED package's object or item as `GET /meta/object/:name` and the
 * protocol's by-name read do:
 *
 *  - `/meta/object/:name/state/:field` and the legacy one-segment
 *    `/meta/:name` exit read `registry.getObject`: an object of a disabled
 *    package is answered the protocol's `404 OBJECT_PACKAGE_DISABLED`;
 *  - `/meta/:type/:name/published` falls through to the published snapshot
 *    when the layered read throws: the refusal is the answer, never the
 *    snapshot;
 *  - the item read of a non-object type falls back to the metadata service
 *    when the protocol serves no item: a disabled package's item there is
 *    absent, byte for byte the answer for a name with nothing behind it;
 *  - `/meta/:type/:name/published` of a non-object item reads the stored
 *    overlay row or the snapshot, neither of which knows a disable: a disabled
 *    package's item is absent there too, byte for byte the missing name's
 *    answer (the owner is the plain read's kept envelope `packageId`).
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const DISABLED_PKG = 'app.disabled_demo';
const HEALTHY_PKG = 'app.healthy_demo';
const DISABLED = 'demo_widget';
const HEALTHY = 'healthy_widget';

const schema = (name: string) => ({
    name,
    label: 'Demo',
    fields: { status: { name: 'status', type: 'select', label: 'Status' } },
});

/** The protocol's own refusal, as `objectPackageDisabledError` builds it. */
const refusal = (object: string) => Object.assign(
    new Error(`Object '${object}' belongs to a disabled package and is not being served. `
        + 'Re-enable the package to restore access.'),
    { code: 'OBJECT_PACKAGE_DISABLED', status: 404, object },
);

/**
 * [#24210] The owner each page's plain read names in its kept protection
 * envelope (`packageId`), withheld item or not: `*_page` is published as a
 * stored overlay row, `*_snap` only in the code/package snapshot.
 */
const OWNERS: Record<string, string> = {
    demo_page: DISABLED_PKG, demo_snap: DISABLED_PKG,
    healthy_page: HEALTHY_PKG, healthy_snap: HEALTHY_PKG,
};
const PUBLISHED_ROWS: Record<string, any> = {
    demo_page: { name: 'demo_page', label: 'Demo (published row)' },
    healthy_page: { name: 'healthy_page', label: 'Healthy (published row)' },
};

/** The metadata service's copies: it keeps both packages' pages. */
const SERVICE_ITEMS: Record<string, any> = {
    demo_page: { name: 'demo_page', label: 'Demo', _packageId: DISABLED_PKG },
    healthy_page: { name: 'healthy_page', label: 'Healthy', _packageId: HEALTHY_PKG },
};

function boot(opts: { getMetaTypes?: boolean } = {}) {
    const disabled = { on: true };
    const getMetaItem = vi.fn(async ({ type, name }: any) => {
        if (type === 'object' && name === DISABLED) throw refusal(name);
        if (type === 'object' && name === HEALTHY) return { type, name, item: schema(name) };
        // The protocol answers the disabled package's page as absent (#24210),
        // and holds no copy of the healthy one: the service fallback serves it.
        return {
            type, name, item: undefined, lock: 'none', editable: true,
            ...(OWNERS[name] ? { packageId: OWNERS[name] } : {}),
        };
    });
    const getMetaItemLayered = vi.fn(async ({ type, name }: any) => {
        if (type === 'object' && name === DISABLED) throw refusal(name);
        const row = PUBLISHED_ROWS[name] ?? null;
        return { type, name, code: null, overlay: row, effective: row };
    });
    const protocol: Record<string, unknown> = {
        getMetaItem,
        getMetaItemLayered,
        getMetaItems: vi.fn(async () => undefined),
        ...(opts.getMetaTypes === false ? {} : {
            getMetaTypes: vi.fn(async () => ({ types: ['object', 'page'] })),
        }),
    };
    // The real registry keeps serving both objects (a resolution reader) and
    // answers both predicates.
    const registry = {
        getObject: vi.fn((name: string) => (name === DISABLED || name === HEALTHY ? schema(name) : undefined)),
        listItems: vi.fn(() => []),
        isObjectPackageDisabled: (name: string) => name === DISABLED,
        isPackageDisabled: (id: unknown) => disabled.on && id === DISABLED_PKG,
    };
    const metadata = {
        getItem: vi.fn(async (_type: string, name: string) => SERVICE_ITEMS[name]),
        getPublished: vi.fn(async (_type: string, name: string) => {
            if (name === DISABLED) return schema(name);
            return name.endsWith('_snap') ? { name, label: `${name} (snapshot)` } : undefined;
        }),
        list: vi.fn(async () => []),
    };
    const auth = { api: { getSession: async () => ({ user: { id: 'u_session' } }) } };
    const services: Record<string, any> = { protocol, auth, objectql: { registry }, metadata };
    const get = (n: string) => services[n] ?? null;
    const kernel = {
        context: { getService: get },
        getService: get,
        getServiceAsync: async (n: string) => get(n),
    } as any;
    return {
        // The environment-membership gate is not this file's subject.
        dispatcher: new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false }),
        registry,
        metadata,
        disabled,
        getMetaItemLayered,
    };
}

const SESSION = (): any => ({ request: { headers: {} }, environmentId: 'platform' });

const expectObjectRefusal = (res: any) => {
    expect(res.response?.status).toBe(404);
    expect(res.response?.body?.success).toBe(false);
    expect(res.response?.body?.error?.code).toBe('OBJECT_PACKAGE_DISABLED');
};

describe('#24210 — the dispatcher\'s registry-reading object doors and a disabled package', () => {
    it('/state/:field refuses 404 OBJECT_PACKAGE_DISABLED, never the registry\'s copy', async () => {
        const stack = boot();
        const res = await stack.dispatcher.dispatch(
            'GET', `/meta/object/${DISABLED}/state/status`, {}, { from: 'open' }, SESSION(),
        );
        expectObjectRefusal(res);
        expect(stack.registry.getObject).not.toHaveBeenCalledWith(DISABLED);
    });

    it('/state/:field, the control: another package\'s object is answered', async () => {
        const stack = boot();
        const res = await stack.dispatcher.dispatch(
            'GET', `/meta/object/${HEALTHY}/state/status`, {}, { from: 'open' }, SESSION(),
        );
        expect(res.response?.status).toBe(200);
        expect(res.response?.body?.data).toEqual({ object: HEALTHY, field: 'status', from: 'open', next: null });
    });

    it('the legacy one-segment exit refuses 404 OBJECT_PACKAGE_DISABLED, never the registry\'s copy', async () => {
        // Reached only by a host whose protocol declares no type set (the
        // unknown-type refusal fails open), so the segment is read as a name.
        const stack = boot({ getMetaTypes: false });
        const res = await stack.dispatcher.dispatch('GET', `/meta/${DISABLED}`, {}, {}, SESSION());
        expectObjectRefusal(res);
        expect(stack.registry.getObject).not.toHaveBeenCalledWith(DISABLED);
    });

    it('the legacy one-segment exit, the control: another package\'s object is served', async () => {
        const stack = boot({ getMetaTypes: false });
        const res = await stack.dispatcher.dispatch('GET', `/meta/${HEALTHY}`, {}, {}, SESSION());
        expect(res.response?.status).toBe(200);
        expect(res.response?.body?.data?.name).toBe(HEALTHY);
    });

    it('/published answers the layered read\'s refusal, never the snapshot', async () => {
        const stack = boot();
        const res = await stack.dispatcher.dispatch('GET', `/meta/object/${DISABLED}/published`, {}, {}, SESSION());
        expectObjectRefusal(res);
        expect(stack.metadata.getPublished).not.toHaveBeenCalled();
    });
});

describe('#24210 — the item read\'s metadata-service fallback and a disabled package', () => {
    it('a disabled package\'s item is absent, byte for byte the answer for a missing name', async () => {
        const stack = boot();
        const hidden = await stack.dispatcher.dispatch('GET', '/meta/page/demo_page', {}, {}, SESSION());
        const missing = await stack.dispatcher.dispatch('GET', '/meta/page/no_such_page', {}, {}, SESSION());

        expect(hidden.response?.status).toBe(404);
        expect(hidden.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(hidden.response?.status).toBe(missing.response?.status);
        expect(JSON.stringify(hidden.response?.body)).toBe(JSON.stringify(missing.response?.body));
        // The service was asked, and its copy was not served.
        expect(stack.metadata.getItem).toHaveBeenCalledWith('page', 'demo_page', undefined);
    });

    it('the control: another package\'s item the service holds is served', async () => {
        const stack = boot();
        const res = await stack.dispatcher.dispatch('GET', '/meta/page/healthy_page', {}, {}, SESSION());
        expect(res.response?.status).toBe(200);
        expect(res.response?.body?.data?.item?.name).toBe('healthy_page');
    });
});

describe('#24210 — /published of a disabled package\'s non-object item', () => {
    const published = (stack: ReturnType<typeof boot>, name: string) =>
        stack.dispatcher.dispatch('GET', `/meta/page/${name}/published`, {}, {}, SESSION());

    it('served while enabled, then the missing name\'s answer on both exits, then served again', async () => {
        const stack = boot();
        stack.disabled.on = false;
        expect((await published(stack, 'demo_page')).response?.body?.data).toEqual(PUBLISHED_ROWS.demo_page);
        expect((await published(stack, 'demo_snap')).response?.body?.data).toEqual({ name: 'demo_snap', label: 'demo_snap (snapshot)' });

        stack.disabled.on = true;
        const missing = await published(stack, 'no_such_page');
        expect(missing.response?.status).toBe(404);
        expect(missing.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        stack.metadata.getPublished.mockClear();
        stack.getMetaItemLayered.mockClear();
        for (const name of ['demo_page', 'demo_snap']) {
            const hidden = await published(stack, name);
            expect(hidden.response?.status, name).toBe(missing.response?.status);
            expect(JSON.stringify(hidden.response?.body), name).toBe(JSON.stringify(missing.response?.body));
        }
        // Neither store was asked for a withheld item.
        expect(stack.metadata.getPublished).not.toHaveBeenCalled();
        expect(stack.getMetaItemLayered).not.toHaveBeenCalled();

        stack.disabled.on = false;
        expect((await published(stack, 'demo_page')).response?.body?.data).toEqual(PUBLISHED_ROWS.demo_page);
        expect((await published(stack, 'demo_snap')).response?.body?.data).toEqual({ name: 'demo_snap', label: 'demo_snap (snapshot)' });
    });

    it('the control: another package\'s item is served on both exits while the package is disabled', async () => {
        const stack = boot();
        expect((await published(stack, 'healthy_page')).response?.body?.data).toEqual(PUBLISHED_ROWS.healthy_page);
        expect((await published(stack, 'healthy_snap')).response?.body?.data).toEqual({ name: 'healthy_snap', label: 'healthy_snap (snapshot)' });
    });
});
