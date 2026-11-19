// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34993] REST `/meta` on a translation fault: an i18n service that resolves
 * but whose `getLocales` / `getTranslations` throws. The shared translator
 * (`translationBundleOf`) answers it as no bundle, so the list and the by-name
 * read serve the authored text (200, not 500), and the server log says so at
 * `warn` — this door carries no warning on its answer. The control serves the
 * bundle label over the same harness, so the authored text is the fault's doing.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RestServer } from './rest-server.js';

const ACCOUNT = { name: 'showcase_account', label: 'Account', fields: { industry: { name: 'industry', type: 'text', label: 'Industry' } } };
const ZH_CN = { objects: { showcase_account: { label: '客户', fields: { industry: { label: '行业' } } } } };

function i18nWhoseReadThrows(read: 'getLocales' | 'getTranslations' | undefined, message = 'bundle offline') {
    return {
        getLocales: () => {
            if (read === 'getLocales') throw new Error(message);
            return ['en', 'zh-CN'];
        },
        getTranslations: (locale: string) => {
            if (read === 'getTranslations') throw new Error(message);
            return locale === 'zh-CN' ? ZH_CN : {};
        },
        getDefaultLocale: () => 'en',
    };
}

function restOver(i18n: unknown) {
    const protocol = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: any) => (type === 'object' ? [ACCOUNT] : [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: ACCOUNT, lock: 'none', editable: true })),
        findData: vi.fn().mockResolvedValue([]),
    };
    const server = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn() };
    const rest = new RestServer(
        server as any, protocol as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        async () => i18n as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    return rest;
}

async function read(rest: RestServer, path: string, params: Record<string, string>) {
    const route = (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
    await route.handler({ method: 'GET', params, query: {}, body: {}, headers: { 'accept-language': 'zh-CN' } }, res);
    const status = res.status.mock.calls.length ? res.status.mock.calls[res.status.mock.calls.length - 1][0] : 200;
    const body = res.json.mock.calls[res.json.mock.calls.length - 1]?.[0];
    const doc = path.endsWith(':name') ? body?.item : (Array.isArray(body) ? body : body?.items)?.[0];
    return { status, label: doc?.label, field: doc?.fields?.industry?.label };
}

beforeAll(() => { vi.stubEnv('OS_REST_LOG', 'info'); });
afterAll(() => { vi.unstubAllEnvs(); });

describe('[#34993] REST /meta serves the authored text on a translation fault', () => {
    it('control: the reads answering, the list serves the bundle label', async () => {
        expect(await read(restOver(i18nWhoseReadThrows(undefined)), '/api/v1/meta/:type', { type: 'object' }))
            .toEqual({ status: 200, label: '客户', field: '行业' });
    });

    it.each(['getLocales', 'getTranslations'] as const)('%s throwing: list and by-name read answer 200 untranslated, and the log says why', async (failing) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const rest = restOver(i18nWhoseReadThrows(failing));
            expect(await read(rest, '/api/v1/meta/:type', { type: 'object' }))
                .toEqual({ status: 200, label: 'Account', field: 'Industry' });
            expect(await read(rest, '/api/v1/meta/:type/:name', { type: 'object', name: 'showcase_account' }))
                .toEqual({ status: 200, label: 'Account', field: 'Industry' });
            expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(
                expect.arrayContaining([expect.stringContaining('bundle offline')]),
            );
        } finally {
            warn.mockRestore();
        }
    });
});
