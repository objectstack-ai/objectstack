// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16458 — `GET /meta` localises the derived JSON `schema` of every type
 * entry, not only its `form`.
 *
 * The RULE lives in `@objectstack/spec/system` (`resolveMetadataFormSchemaTitles`,
 * pinned in `i18n-resolver.test.ts`): a `metadataForms.<type>.fields.<path>.label`
 * becomes the `title` of the JSON Schema node the path addresses, stepping
 * through an array's `items` so a repeater ROW property is `<repeater>.<prop>`.
 * What can only be tested here is the PLUMBING: `translateMetaTypesResponse`
 * hands `entry.schema` through that overlay with the same bundle, locale and
 * options it already hands `entry.form`. Before this seam existed the served
 * schema carried the zod `title` only, so a repeater's column headers — which
 * the console reads from `items.properties[k].title` and from NOTHING on the
 * form — stayed English in every locale a bundle named them for.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

/** The served shape `getMetaTypes()` derives for a `dashboard` entry, trimmed to the header. */
const DASHBOARD_SCHEMA = () => ({
    type: 'object',
    properties: {
        columns: { type: 'integer', description: 'Number of grid columns (default 12)' },
        header: {
            type: 'object',
            properties: {
                showTitle: { type: 'boolean' },
                actions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string', title: 'Label' },
                            actionUrl: { type: 'string', title: 'Action URL' },
                        },
                    },
                },
            },
        },
    },
});

const FORM = () => ({
    schemaId: 'dashboard',
    type: 'simple',
    sections: [{ name: 'layout', label: 'Layout', fields: [{ field: 'columns', type: 'number' }] }],
});

const ZH_DATA = {
    metadataForms: {
        dashboard: {
            label: '仪表板',
            fields: {
                columns: { label: '列数' },
                'header.showTitle': { label: '显示标题' },
                'header.actions': { label: '操作按钮' },
                'header.actions.label': { label: '标签' },
                'header.actions.actionUrl': { label: '操作地址' },
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
            entries: [{ type: 'dashboard', label: 'Dashboard', form: FORM(), schema: DASHBOARD_SCHEMA() }],
            types: ['dashboard'],
            registered: ['dashboard'],
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

const rowProps = (entry: any) => entry.schema.properties.header.properties.actions.items.properties;

describe('#16458 — GET /meta serves a localised `schema` beside the localised `form`', () => {
    const bundles = () => ({ en: {}, 'zh-CN': ZH_DATA });

    it('a zh-CN request names the repeater row columns through the schema `title`', async () => {
        const body = await readTypes(makeRest(i18nFor(bundles())), 'zh-CN');
        const entry = body.entries.find((e: any) => e.type === 'dashboard');
        expect(entry.label).toBe('仪表板');
        expect(rowProps(entry).label.title).toBe('标签');
        expect(rowProps(entry).actionUrl.title).toBe('操作地址');
        // Composite child and top-level field — the same overlay, one rule.
        expect(entry.schema.properties.header.properties.showTitle.title).toBe('显示标题');
        expect(entry.schema.properties.header.properties.actions.title).toBe('操作按钮');
        expect(entry.schema.properties.columns.title).toBe('列数');
        // The form is still translated by the sibling seam.
        expect(entry.form.sections[0].fields[0].label).toBe('列数');
        // The overlay wrote `title` and nothing else on the node.
        expect(rowProps(entry).label.type).toBe('string');
        expect(entry.schema.properties.columns.description).toBe('Number of grid columns (default 12)');
    });

    it('control — an en request leaves the authored titles in place', async () => {
        const body = await readTypes(makeRest(i18nFor(bundles())), 'en');
        const entry = body.entries.find((e: any) => e.type === 'dashboard');
        expect(rowProps(entry).label.title).toBe('Label');
        expect(rowProps(entry).actionUrl.title).toBe('Action URL');
        expect(entry.schema.properties.header.properties.showTitle.title).toBeUndefined();
        expect(entry.schema.properties.columns.title).toBeUndefined();
    });

    it('control — the served schema is not mutated in place across requests', async () => {
        const rest = makeRest(i18nFor(bundles()));
        await readTypes(rest, 'zh-CN');
        const body = await readTypes(rest, 'en');
        const entry = body.entries.find((e: any) => e.type === 'dashboard');
        expect(rowProps(entry).label.title).toBe('Label');
    });
});
