// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14972 — every platform-injected system column reaches the `/meta/object`
 * reads with a localised display name.
 *
 * The RULE lives in `@objectstack/spec/system` (`translateObject`'s built-in
 * system-field label table, unit-tested per column and per shipped locale in
 * `i18n-resolver.test.ts`). What can only be tested here is the SEAM: the
 * protocol's read exits inject the columns (`applyInjectedSystemColumns`)
 * BEFORE this boundary translates the document, and the boundary translates
 * even when the tenant's bundle carries nothing for the object — a custom
 * object ships no per-object entries for columns it never declared, so the
 * built-in table is the only thing that can answer. The served document
 * below therefore spreads the columns from the provenance module's own
 * definitions, exactly as the protocol's injection does, and the bundle names
 * a different object on purpose.
 *
 * Every injected column is named in the assertion: the defect was two rows
 * missing from a table of seven, and a loop over whatever the table happens to
 * carry would have been green with them missing.
 */

import { describe, it, expect, vi } from 'vitest';
import { injectedSystemColumnDefs } from '@objectstack/spec/data';
import { RestServer } from './rest-server.js';

// ---------------------------------------------------------------------------
// Fixtures — one custom object, every injected column, a bundle that knows
// another object
// ---------------------------------------------------------------------------

const INJECTED = injectedSystemColumnDefs({ name: 'contracts', fields: { title: { type: 'text' } } });

/** What the protocol serves: the author's field plus the injected columns. */
const SERVED = {
    name: 'contracts',
    label: 'Contract',
    fields: {
        title: { name: 'title', type: 'text', label: 'Title' },
        ...INJECTED,
    },
};

const BUNDLE: Record<string, any> = {
    'zh-CN': { objects: { showcase_contact: { label: '联系人' } } },
};

const i18nService = {
    getLocales: () => ['en', 'zh-CN'],
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    return { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
}

function protocol() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: any) => (type === 'object' || type === 'objects' ? [SERVED] : [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({
            type: type === 'objects' ? 'object' : type,
            name,
            item: SERVED,
            lock: 'none',
            editable: true,
        })),
        getMetaItemCached: undefined as any,
        findData: vi.fn().mockResolvedValue([]),
    };
}

function makeRest() {
    const rest = new RestServer(
        mockServer() as any, protocol() as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        // i18nServiceProvider — the 14th constructor argument.
        async () => i18nService as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    return rest;
}

function routeFor(rest: RestServer, path: string) {
    const route = (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    if (!route) throw new Error(`route not registered: GET ${path}`);
    return route;
}

/** The body of the last `res.json(...)` (indexed: this package's `lib` target predates `.at`). */
function lastBody(res: ReturnType<typeof mockRes>): any {
    const calls = res.json.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : undefined;
}

async function itemFields(locale: string): Promise<Record<string, any>> {
    const res = mockRes();
    await routeFor(makeRest(), '/api/v1/meta/:type/:name').handler(
        {
            method: 'GET',
            params: { type: 'object', name: 'contracts' },
            query: {},
            body: {},
            headers: { 'accept-language': locale },
        },
        res,
    );
    return lastBody(res)?.item?.fields;
}

async function listFields(locale: string): Promise<Record<string, any>> {
    const res = mockRes();
    await routeFor(makeRest(), '/api/v1/meta/:type').handler(
        { method: 'GET', params: { type: 'object' }, query: {}, body: {}, headers: { 'accept-language': locale } },
        res,
    );
    const body = lastBody(res);
    const items = Array.isArray(body) ? body : body?.items ?? [];
    return items[0]?.fields;
}

const ZH_CN = {
    organization_id: '组织',
    created_at: '创建时间',
    created_by: '创建人',
    updated_at: '更新时间',
    updated_by: '更新人',
    owner_id: '所有者',
    owning_business_unit_id: '所属业务单元',
};

function labelsOf(fields: Record<string, any>): Record<string, unknown> {
    return {
        organization_id: fields.organization_id?.label,
        created_at: fields.created_at?.label,
        created_by: fields.created_by?.label,
        updated_at: fields.updated_at?.label,
        updated_by: fields.updated_by?.label,
        owner_id: fields.owner_id?.label,
        owning_business_unit_id: fields.owning_business_unit_id?.label,
    };
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

describe('#14972 — injected system columns reach the /meta/object reads localised', () => {
    it('the fixture spreads all seven injected columns with their shipped English labels', () => {
        expect(Object.keys(INJECTED).sort()).toEqual([
            'created_at', 'created_by', 'organization_id', 'owner_id',
            'owning_business_unit_id', 'updated_at', 'updated_by',
        ]);
        expect((SERVED.fields as any).organization_id.label).toBe('Organization');
    });

    it('by-name read: every injected column answers Chinese on a zh-CN request', async () => {
        const fields = await itemFields('zh-CN');
        expect(labelsOf(fields)).toEqual(ZH_CN);
        // The author's own field is untouched: the bundle carries nothing for it.
        expect(fields.title.label).toBe('Title');
    });

    it('list read: every injected column answers Chinese on a zh-CN request', async () => {
        const fields = await listFields('zh-CN');
        expect(labelsOf(fields)).toEqual(ZH_CN);
        expect(fields.title.label).toBe('Title');
    });

    it('an en request keeps the shipped English defaults on both reads', async () => {
        for (const fields of [await itemFields('en'), await listFields('en')]) {
            expect(labelsOf(fields)).toEqual({
                organization_id: 'Organization',
                created_at: 'Created At',
                created_by: 'Created By',
                updated_at: 'Last Modified At',
                updated_by: 'Last Modified By',
                owner_id: 'Owner',
                owning_business_unit_id: 'Owning Business Unit',
            });
        }
    });
});
