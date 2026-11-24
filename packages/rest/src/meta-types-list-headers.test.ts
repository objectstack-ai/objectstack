// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36860 — `GET /meta` localises the headers of a type's served
 * list layout (`entries[].list`) through the type's form field slot,
 * `metadataForms.<type>.fields.<field>.label`, the slot the form field of the
 * same key reads.
 *
 * The rule lives in `@objectstack/spec/system` (`resolveMetadataListLabels`);
 * what is pinned here is the plumbing: `translateMetaTypesResponse` hands
 * `entry.list` through it with the bundle and locale it hands `entry.form`.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

const LIST = () => ({
    data: { provider: 'schema', schemaId: 'hook' },
    columns: [
        { field: 'name', label: 'Name' },
        { field: 'events', label: 'Events', type: 'list' },
        { field: 'retryPolicy.maxRetries', label: 'Max Retries' },
    ],
});

const ZH_DATA = {
    metadataForms: {
        hook: {
            label: '钩子',
            fields: {
                name: { label: '名称' },
                events: { label: '事件' },
                'retryPolicy.maxRetries': { label: '最大重试次数' },
            },
        },
    },
};

function i18nFor(bundles: Record<string, any>) {
    return {
        getLocales: () => Object.keys(bundles),
        getTranslations: (locale: string) => bundles[locale] ?? {},
        getDefaultLocale: () => 'en',
        getFallbackLocale: () => 'en',
    };
}

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
        getMetaTypes: vi.fn(async () => ({
            entries: [
                { type: 'hook', label: 'Hook', list: LIST() },
                // Control: a type serving no list.
                { type: 'skill', label: 'Skill' },
            ],
            types: ['hook', 'skill'],
            registered: ['hook', 'skill'],
        })),
        getMetaItems: vi.fn(async () => []),
        getMetaItem: vi.fn(async () => undefined),
        getMetaItemCached: undefined as any,
        findData: vi.fn().mockResolvedValue([]),
    };
}

function makeRest(i18n: any) {
    const rest = new RestServer(
        mockServer() as any, protocol() as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        async () => i18n,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    return rest;
}

async function readTypes(rest: RestServer, locale: string | undefined): Promise<any> {
    const route = (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta');
    if (!route) throw new Error('route not registered: GET /api/v1/meta');
    const res = mockRes();
    await route.handler(
        { method: 'GET', params: {}, query: {}, body: {}, headers: locale ? { 'accept-language': locale } : {} },
        res,
    );
    const calls = res.json.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : undefined;
}

const headers = (entry: any) => entry.list.columns.map((c: any) => c.label);

describe('GET /meta serves the list headers in the reader\'s language (objectstack#36860)', () => {
    const bundles = () => ({ en: {}, 'zh-CN': ZH_DATA });

    it('a zh-CN request names each column through its form field slot, dotted paths included', async () => {
        const body = await readTypes(makeRest(i18nFor(bundles())), 'zh-CN');
        const entry = body.entries.find((e: any) => e.type === 'hook');
        expect(headers(entry)).toEqual(['名称', '事件', '最大重试次数']);
        // Only the header is rewritten.
        expect(entry.list.columns[1]).toEqual({ field: 'events', label: '事件', type: 'list' });
        expect(entry.list.data).toEqual({ provider: 'schema', schemaId: 'hook' });
    });

    it('control — an en request keeps the declared headers, and a type serving no list gains none', async () => {
        const body = await readTypes(makeRest(i18nFor(bundles())), 'en');
        expect(headers(body.entries.find((e: any) => e.type === 'hook'))).toEqual(['Name', 'Events', 'Max Retries']);
        expect('list' in body.entries.find((e: any) => e.type === 'skill')).toBe(false);
    });

    it('control — the served list is not rewritten in place across requests', async () => {
        const rest = makeRest(i18nFor(bundles()));
        await readTypes(rest, 'zh-CN');
        const body = await readTypes(rest, 'en');
        expect(headers(body.entries.find((e: any) => e.type === 'hook'))).toEqual(['Name', 'Events', 'Max Retries']);
    });
});
