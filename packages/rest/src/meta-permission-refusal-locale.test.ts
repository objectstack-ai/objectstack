// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30126 row 12] The `/meta` read gate's `403 PERMISSION_DENIED` — an app,
 * a dashboard or a list view the caller may not open — speaks the caller's
 * language, as the object and capability refusals of plugin-security do.
 *
 * Opening the Setup app without access answered, in a Chinese console,
 * `You do not have permission to open the 'com.objectstack.setup' app.`: an
 * English sentence around an API name. The gate now renders the operation
 * catalog's `permission_denied` (`@objectstack/spec/system`) in the
 * caller's `ExecutionContext.locale`, through `renderOperationMessage`.
 *
 * Pinned:
 *  - a `zh-CN` caller reads the catalog's Chinese sentence, on all three
 *    refusals, under the same status and code;
 *  - a caller with no locale reads the English one;
 *  - the sentence never carries the item's API name;
 *  - a deployment's `errors.permission_denied` override wins, as it does for
 *    plugin-security's refusals; a lookup that throws leaves the built-in
 *    sentence and the 403.
 */

import { describe, it, expect, vi } from 'vitest';
// Explicit `.js` extension: NodeNext resolution (see the sibling gate tests).
import { RestServer } from './rest-server.js';

const ZH = '您没有执行此操作的权限，如需访问请联系管理员。';
const EN = 'You do not have permission to perform this action. Contact your administrator if you need access.';

const SETUP_ID = 'com.objectstack.setup';
const STORE: Record<string, any[]> = {
    app: [{ name: SETUP_ID, label: 'Setup', requiredPermissions: ['setup.access'], navigation: [] }],
    dashboard: [{ name: 'legal_board', label: 'Legal board', requiredPermissions: ['legal.view'], widgets: [] }],
    view: [{ name: 'contract.legal_queue', object: 'contract', viewKind: 'list', order: 0, config: { type: 'grid', columns: ['name'], requiredPermissions: ['legal.view'] } }],
};

const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.send = vi.fn(() => res);
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

interface Setup {
    locale?: string;
    translate?: (key: string, locale: string) => string;
    translatorThrows?: boolean;
}

async function read(type: string, name: string, opts: Setup = {}) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue({ types: Object.keys(STORE) }),
        getMetaItems: vi.fn(async ({ type: t }: any) => ({ type: singular(t), items: clone(STORE[singular(t)] ?? []) })),
        getMetaItem: vi.fn(async ({ type: t, name: n }: any) => {
            const found = (STORE[singular(t)] ?? []).find((i: any) => i.name === n);
            return { type: singular(t), name: n, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
    };
    const server = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const rest: any = new RestServer(server as any, protocol, {} as any);
    rest.resolveExecCtx = async () => ({
        userId: 'u_member', systemPermissions: [] as string[],
        ...(opts.locale ? { locale: opts.locale } : {}),
    });
    rest.securityServiceProvider = async () => ({ resolvePermissionSetNames: async () => [] });
    rest.serviceExistsProvider = () => true;
    rest.resolveMessageTranslator = async () => {
        if (opts.translatorThrows) throw new Error('i18n service unavailable');
        if (!opts.translate) return undefined;
        const t = opts.translate;
        return (key: string, locale: string) => t(key, locale);
    };
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    const res = makeRes();
    await route.handler({ method: 'GET', path: `/api/v1/meta/${type}/${name}`, params: { type, name }, query: {}, body: {}, headers: {} }, res);
    return res;
}

const REFUSALS = [['app', SETUP_ID], ['dashboard', 'legal_board'], ['view', 'contract.legal_queue']] as const;

describe('[#30126 row 12] the /meta read gate\'s PERMISSION_DENIED speaks the caller\'s locale', () => {
    for (const [type, name] of REFUSALS) {
        it(`${type}/${name}: a zh-CN caller reads the catalog's Chinese sentence, 403 PERMISSION_DENIED`, async () => {
            const res = await read(type, name, { locale: 'zh-CN' });
            expect(res.statusCode).toBe(403);
            expect(res.body?.error?.code).toBe('PERMISSION_DENIED');
            expect(res.body?.error?.message).toBe(ZH);
        });

        it(`${type}/${name}: a caller with no locale reads the English sentence, which names no API name`, async () => {
            const res = await read(type, name);
            expect(res.statusCode).toBe(403);
            expect(res.body?.error?.message).toBe(EN);
            expect(JSON.stringify(res.body)).not.toContain(name);
        });
    }

    it('a deployment\'s errors.permission_denied override wins, in the caller\'s locale', async () => {
        const res = await read('app', SETUP_ID, {
            locale: 'zh-CN',
            translate: (key, locale) => (key === 'errors.permission_denied' && locale === 'zh-CN' ? '请向 IT 部门申请设置权限。' : key),
        });
        expect(res.statusCode).toBe(403);
        expect(res.body?.error?.message).toBe('请向 IT 部门申请设置权限。');
    });

    it('a lookup that echoes the key back is no override: the built-in sentence', async () => {
        const res = await read('dashboard', 'legal_board', { locale: 'zh-CN', translate: (key) => key });
        expect(res.body?.error?.message).toBe(ZH);
    });

    it('a lookup that cannot be resolved leaves the built-in sentence and the 403, never a 500', async () => {
        const res = await read('view', 'contract.legal_queue', { locale: 'zh-CN', translatorThrows: true });
        expect(res.statusCode).toBe(403);
        expect(res.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(res.body?.error?.message).toBe(ZH);
    });
});
