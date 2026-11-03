// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28409, ADR-0146 D8 item 3] `GET /packages/:id/export` assembles a package's
 * OWN items: the protocol's per-package layer (`getMetaItemsPerPackage`),
 * never the effective read, which serves a base's name with its `.custom`
 * pair's declared override.
 *
 * The protocol is a double here and the door is the real dispatcher: what is
 * pinned is which read the door asks. The layer's content — the pair's item
 * with its `overrides` block, the base's document unchanged — is pinned on
 * the real protocol in `packages/objectql/src/protocol-custom-override-effective-read.test.ts`.
 *
 *  - the base's export carries the base's document, though the effective read
 *    of its name answers the override;
 *  - the pair's export carries the overriding item with its `overrides` block;
 *  - CONTROL: a protocol without the per-package layer is read as before.
 */
import { describe, expect, it, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const BASE = 'com.example.crm';
const PAIR = 'com.example.crm.custom';
const DECLARATION = { package: BASE, basedOn: '1.0.0' };

const view = (columns: string[], extra: Record<string, unknown> = {}) => ({
    name: 'crm_account.all',
    object: 'crm_account',
    viewKind: 'list',
    label: 'All accounts',
    config: { type: 'grid', data: { provider: 'object', object: 'crm_account' }, columns: columns.map((field) => ({ field })) },
    ...extra,
});
const BASE_VIEW = { ...view(['name', 'owner', 'industry']), _packageId: BASE };
const OVERRIDE_VIEW = { ...view(['name', 'industry'], { overrides: DECLARATION }), _packageId: BASE };
const PAIR_VIEW = { ...view(['name', 'industry'], { overrides: DECLARATION }), _packageId: PAIR };

const system = (): any => ({ request: {}, environmentId: 'platform', executionContext: { isSystem: true } });

function make(protocol: any) {
    const registry = {
        getPackage: vi.fn((id: string) => ({ id, manifest: { id, name: id, version: '1.0.0' } })),
        getAllPackages: vi.fn().mockReturnValue([]),
    };
    const kernel: any = {
        context: {
            getService: (name: string) =>
                name === 'objectql' ? { registry } : name === 'protocol' ? protocol : null,
        },
    };
    return new HttpDispatcher(kernel);
}

/** The effective read answers the override under the base's name; the per-package layer, each package's own item. */
function layeredProtocol() {
    const onlyViews = (items: unknown[]) => async (req: { type: string }) => ({ items: req.type === 'view' ? items : [] });
    return {
        getMetaItems: vi.fn(async (req: { type: string; packageId?: string }) =>
            onlyViews(req.packageId === PAIR ? [PAIR_VIEW] : [OVERRIDE_VIEW])(req)),
        getMetaItemsPerPackage: vi.fn(async (req: { type: string; packageId?: string }) =>
            onlyViews(req.packageId === PAIR ? [PAIR_VIEW] : [BASE_VIEW])(req)),
    };
}

const exported = async (protocol: any, id: string) => {
    const r = await make(protocol).handlePackages(`/${encodeURIComponent(id)}/export`, 'GET', undefined, {}, system());
    expect(r.response?.status, JSON.stringify(r.response?.body)).toBe(200);
    const body: any = r.response?.body;
    const manifest = body?.data ?? body;
    return [...(manifest.views ?? []), ...(manifest.viewItems ?? [])] as any[];
};
const columnsOf = (item: any) => (item?.config?.columns ?? []).map((c: any) => c.field);

describe('[#28409] GET /packages/:id/export reads the package\'s own items', () => {
    it('the base\'s export carries its own document, never the override the effective read serves', async () => {
        const protocol = layeredProtocol();
        const views = await exported(protocol, BASE);
        expect(views.map(columnsOf)).toEqual([['name', 'owner', 'industry']]);
        expect(views[0].overrides).toBeUndefined();
        expect(protocol.getMetaItemsPerPackage).toHaveBeenCalledWith({ type: 'view', packageId: BASE });
        expect(protocol.getMetaItems).not.toHaveBeenCalled();
    });

    it('the pair\'s export carries the overriding item with its `overrides` block', async () => {
        const views = await exported(layeredProtocol(), PAIR);
        expect(views.map(columnsOf)).toEqual([['name', 'industry']]);
        expect(views[0].overrides).toEqual(DECLARATION);
        // Provenance stays out of a portable manifest, as before.
        expect(views[0]._packageId).toBeUndefined();
    });

    it('CONTROL: a protocol that serves no per-package layer is read through `getMetaItems`, as before', async () => {
        const { getMetaItems } = layeredProtocol();
        const views = await exported({ getMetaItems }, BASE);
        expect(views.map(columnsOf)).toEqual([['name', 'industry']]);
        expect(getMetaItems).toHaveBeenCalledWith({ type: 'view', packageId: BASE });
    });
});
