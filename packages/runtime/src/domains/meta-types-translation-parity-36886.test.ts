// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36886 — the runtime dispatcher answers the metadata types
 * listing in the reader's language, through the one translation
 * `RestServer`'s `GET /meta` runs (`translateMetaTypesListing`).
 *
 * Before this the dispatcher served `getMetaTypes()` as it came, so a zh-CN
 * reader of a host served through it got English type labels, form labels
 * and — since objectstack#36860 — English list headers, while the same reader
 * of a `RestServer` host got Chinese.
 *
 * Pinned, each against a control: both dispatcher doors (`GET /meta` and
 * `GET /meta/types`) answer the same entries as `RestServer`, translated, and
 * carry `Vary: Accept-Language` as `RestServer` does, so a shared cache never
 * hands one reader's language to another; an en request and a host with no
 * i18n service answer the listing untranslated.
 */
import { describe, it, expect, vi } from 'vitest';
// Paid at collection: the dispatcher reaches it through a dynamic import.
import '@objectstack/metadata';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const listing = () => ({
    types: ['hook'],
    entries: [
        {
            type: 'hook',
            label: 'Hook',
            form: { schemaId: 'hook', type: 'simple', sections: [{ label: 'Basics', fields: [{ field: 'events' }] }] },
            list: {
                data: { provider: 'schema', schemaId: 'hook' },
                columns: [
                    { field: 'name', label: 'Name' },
                    { field: 'events', label: 'Events', type: 'list' },
                ],
            },
        },
    ],
});

const BUNDLE: Record<string, any> = {
    en: {},
    'zh-CN': {
        metadataForms: {
            hook: {
                label: '钩子',
                fields: { name: { label: '名称' }, events: { label: '事件' } },
            },
        },
    },
};

const i18nDouble = {
    getLocales: () => Object.keys(BUNDLE),
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

const protocolDouble = () => ({ getMetaTypes: vi.fn(async () => listing()) });

const CTX = { userId: 'u_admin', isSystem: false, systemPermissions: ['studio.access'] };

function bootDispatcher(withI18n = true) {
    const services: Record<string, unknown> = { protocol: protocolDouble(), ...(withI18n ? { i18n: i18nDouble } : {}) };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CTX });
    return async (path: string, locale: string) => {
        const request = { headers: { 'accept-language': locale }, url: `http://localhost/api/v1${path}` };
        const res = await dispatcher.dispatch('GET', path, undefined, {}, { request } as any);
        expect(res.response?.status).toBe(200);
        return { data: (res.response?.body as any)?.data, vary: (res.response as any)?.headers?.Vary };
    };
}

function bootRest() {
    const server = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const rest: any = new RestServer(server as any, protocolDouble() as any, {} as any);
    rest.resolveExecCtx = async () => ({ ...CTX });
    rest.i18nServiceProvider = async () => i18nDouble;
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta');
    return async (locale: string) => {
        let body: any;
        const headers: Record<string, string> = {};
        const res: any = {
            status: vi.fn(() => res),
            header: vi.fn((name: string, value: string) => { headers[name] = value; return res; }),
            send: vi.fn(() => res),
            json: vi.fn((b: any) => { body = b; return res; }),
        };
        await route.handler({ method: 'GET', params: {}, query: {}, body: {}, headers: { 'accept-language': locale } }, res);
        return { data: body, vary: headers.Vary };
    };
}

const read = (data: any) => {
    const hook = data.entries.find((e: any) => e.type === 'hook');
    return {
        label: hook.label,
        form: hook.form.sections[0].fields[0].label,
        headers: hook.list.columns.map((c: any) => c.label),
    };
};

describe('the dispatcher translates the types listing as RestServer does (objectstack#36886)', () => {
    it('both dispatcher doors answer zh-CN with the labels, form and list headers RestServer answers', async () => {
        const rest = await bootRest()('zh-CN');
        const reference = read(rest.data);
        expect(reference).toEqual({ label: '钩子', form: '事件', headers: ['名称', '事件'] });
        const dispatch = bootDispatcher();
        expect(read((await dispatch('/meta', 'zh-CN')).data)).toEqual(reference);
        expect(read((await dispatch('/meta/types', 'zh-CN')).data)).toEqual(reference);
    });

    it('both dispatcher doors vary on Accept-Language, as RestServer does', async () => {
        expect((await bootRest()('zh-CN')).vary).toBe('Accept-Language');
        const dispatch = bootDispatcher();
        expect((await dispatch('/meta', 'zh-CN')).vary).toBe('Accept-Language');
        expect((await dispatch('/meta/types', 'zh-CN')).vary).toBe('Accept-Language');
    });

    it('control — an en request answers the listing as declared', async () => {
        const dispatch = bootDispatcher();
        expect(read((await dispatch('/meta', 'en')).data)).toEqual({ label: 'Hook', form: undefined, headers: ['Name', 'Events'] });
    });

    it('control — a host with no i18n service answers the listing as declared', async () => {
        const dispatch = bootDispatcher(false);
        expect(read((await dispatch('/meta/types', 'zh-CN')).data)).toEqual({ label: 'Hook', form: undefined, headers: ['Name', 'Events'] });
    });
});
