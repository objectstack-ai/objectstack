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
 *    answer (the owner is the plain read's kept envelope `packageId`);
 *  - the layered view, `/meta/:type/:name/layers` and the deprecated
 *    `?layers=true`, of a non-object item: the shared layered chain's owner
 *    step answers a disabled package's item as the missing name, byte for
 *    byte, asking the plain read's envelope under the request's `?package=`
 *    scope; the object row stays the protocol's own refusal.
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
    demo_page: DISABLED_PKG, demo_snap: DISABLED_PKG, demo_code: DISABLED_PKG,
    healthy_page: HEALTHY_PKG, healthy_snap: HEALTHY_PKG, healthy_code: HEALTHY_PKG,
};
/**
 * [#24210] Code-shipped pages: the layered read answers a code layer and no
 * overlay. `twin_page` is stored in BOTH packages, so its owner is the one the
 * request's `?package=` names (unscoped, the disabled package's).
 */
const CODE_ROWS: Record<string, any> = {
    demo_code: { name: 'demo_code', label: 'Demo (shipped)' },
    healthy_code: { name: 'healthy_code', label: 'Healthy (shipped)' },
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
    const getMetaItem = vi.fn(async ({ type, name, packageId }: any) => {
        if (type === 'object' && name === DISABLED) throw refusal(name);
        if (type === 'object' && name === HEALTHY) return { type, name, item: schema(name) };
        // The protocol answers the disabled package's page as absent (#24210),
        // and holds no copy of the healthy one: the service fallback serves it.
        const owner = name === 'twin_page' ? (packageId ?? DISABLED_PKG) : OWNERS[name];
        return {
            type, name, item: undefined, lock: 'none', editable: true,
            ...(owner ? { packageId: owner } : {}),
        };
    });
    const getMetaItemLayered = vi.fn(async ({ type, name }: any) => {
        if (type === 'object' && name === DISABLED) throw refusal(name);
        if (CODE_ROWS[name]) return { type, name, code: CODE_ROWS[name], overlay: null, effective: CODE_ROWS[name] };
        const row = name === 'twin_page' ? { name, label: 'Twin' } : PUBLISHED_ROWS[name] ?? null;
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
        getMetaItem,
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

describe('#24210 — the layered view of a disabled package\'s non-object item, both spellings', () => {
    const layers = (stack: ReturnType<typeof boot>, name: string, query: Record<string, string> = {}) =>
        stack.dispatcher.dispatch('GET', `/meta/page/${name}/layers`, {}, query, SESSION());
    const flag = (stack: ReturnType<typeof boot>, name: string, query: Record<string, string> = {}) =>
        stack.dispatcher.dispatch('GET', `/meta/page/${name}`, {}, { ...query, layers: 'true' }, SESSION());
    const SPECIMENS = ['demo_page', 'demo_code']; // an overlay-only and a code-shipped page

    it('served while enabled, then the missing name\'s answer, then served again', async () => {
        const stack = boot();
        stack.disabled.on = false;
        const before = new Map<string, unknown>();
        for (const name of SPECIMENS) {
            const viaLayers = await layers(stack, name);
            const viaFlag = await flag(stack, name);
            expect(viaLayers.response?.status, name).toBe(200);
            expect(viaLayers.response?.body?.data?.effective?.name, name).toBe(name);
            expect(viaFlag.response?.body?.data, name).toEqual(viaLayers.response?.body?.data);
            expect(viaFlag.response?.headers?.Deprecation, name).toBe('true');
            before.set(name, JSON.stringify([viaLayers.response, viaFlag.response]));
        }

        stack.disabled.on = true;
        const missingLayers = await layers(stack, 'no_such_page');
        const missingFlag = await flag(stack, 'no_such_page');
        expect(missingLayers.response?.status).toBe(404);
        // The missing name's answer is the plain read's own absence.
        const missingPlain = await stack.dispatcher.dispatch('GET', '/meta/page/no_such_page', {}, {}, SESSION());
        expect(JSON.stringify(missingLayers.response?.body)).toBe(JSON.stringify(missingPlain.response?.body));
        for (const name of SPECIMENS) {
            // Status, body and headers, byte for byte the missing name's.
            expect(JSON.stringify((await layers(stack, name)).response), name).toBe(JSON.stringify(missingLayers.response));
            expect(JSON.stringify((await flag(stack, name)).response), name).toBe(JSON.stringify(missingFlag.response));
        }
        // Control: another package's pages, both spellings, still served.
        for (const name of ['healthy_page', 'healthy_code']) {
            expect((await layers(stack, name)).response?.body?.data?.effective?.name, name).toBe(name);
            expect((await flag(stack, name)).response?.body?.data?.effective?.name, name).toBe(name);
        }

        stack.disabled.on = false;
        for (const name of SPECIMENS) {
            expect(JSON.stringify([(await layers(stack, name)).response, (await flag(stack, name)).response]), name)
                .toBe(before.get(name));
        }
    });

    it('?package= is the scope the owner is read under: the healthy package\'s copy is served', async () => {
        const stack = boot();
        const missing = await layers(stack, 'no_such_page');
        expect((await layers(stack, 'twin_page', { package: HEALTHY_PKG })).response?.body?.data?.effective?.label).toBe('Twin');
        expect((await flag(stack, 'twin_page', { package: HEALTHY_PKG })).response?.body?.data?.effective?.label).toBe('Twin');
        expect(stack.getMetaItem).toHaveBeenCalledWith({ type: 'page', name: 'twin_page', packageId: HEALTHY_PKG });
        expect(JSON.stringify((await layers(stack, 'twin_page', { package: DISABLED_PKG })).response))
            .toBe(JSON.stringify(missing.response));
        expect(JSON.stringify((await layers(stack, 'twin_page')).response)).toBe(JSON.stringify(missing.response));
    });

    it('the plain read decides which types are hidden: an item it still serves keeps its layered view', async () => {
        // As the protocol serves a `package` item whatever its owner: the
        // envelope names the disabled package, and the item is there.
        const stack = boot();
        stack.getMetaItem.mockImplementation(async ({ type, name }: any) =>
            ({ type, name, item: { name, label: 'still served' }, lock: 'none', editable: true, packageId: DISABLED_PKG }));
        expect((await layers(stack, 'demo_page')).response?.body?.data?.effective?.name).toBe('demo_page');
        expect((await flag(stack, 'demo_page')).response?.body?.data?.effective?.name).toBe('demo_page');
    });

    it('an object keeps the layered read\'s own 404 OBJECT_PACKAGE_DISABLED, on both spellings', async () => {
        const stack = boot();
        expectObjectRefusal(await stack.dispatcher.dispatch('GET', `/meta/object/${DISABLED}/layers`, {}, {}, SESSION()));
        expectObjectRefusal(await stack.dispatcher.dispatch('GET', `/meta/object/${DISABLED}`, {}, { layers: 'true' }, SESSION()));
    });

    it('a plain read that rejects is that fault, never the layered view; a registry that cannot answer withholds nothing', async () => {
        const stack = boot();
        stack.getMetaItem.mockImplementationOnce(async () => {
            throw Object.assign(new Error('metadata store unavailable'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
        });
        const failed = await layers(stack, 'demo_page');
        expect(failed.response?.status).toBe(503);
        expect(JSON.stringify(failed.response?.body)).not.toContain('published row');

        (stack.registry as { isPackageDisabled?: unknown }).isPackageDisabled = undefined;
        expect((await layers(stack, 'demo_page')).response?.body?.data?.effective?.name).toBe('demo_page');
    });
});
