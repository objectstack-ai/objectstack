// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27135 — `GET /meta/object` and `GET /meta/object/:name` serve a validation
 * rule's `message` in the request's locale, from the key the ObjectQL rule
 * evaluator refuses a write with (`objectValidationMessageKey`,
 * `objects.<object>._validations.<rule>.message`).
 *
 * The RULE lives in `@objectstack/spec/system` (`translateObject`, pinned in
 * `i18n-resolver.object-validations.test.ts`), and objectql's
 * `engine-validation-locale-negotiation.test.ts` pins that the served rule and
 * the refusal of the same write are one string. What can only be tested here
 * is the PLUMBING: both object reads hand the document to that translator with
 * the request's locale. Before this, both served the authored message under a
 * translated locale, while the refusal of the same write was translated.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

const AUTHORED = 'A closed ticket cannot be reopened.';
const ZH = '已关闭的工单不能重新打开。';
const UNTRANSLATED = 'A ticket needs an owner.';

const SERVED = {
    name: 'helpdesk_ticket',
    label: 'Ticket',
    fields: { status: { name: 'status', type: 'select', label: 'Status' } },
    validations: [
        {
            type: 'state_machine',
            name: 'closed_is_final',
            message: AUTHORED,
            field: 'status',
            transitions: { open: ['closed'], closed: [] },
        },
        { type: 'script', name: 'needs_owner', message: UNTRANSLATED, condition: 'record.owner == null' },
    ],
};

const BUNDLE: Record<string, any> = {
    en: { objects: { helpdesk_ticket: { label: 'Ticket' } } },
    'zh-CN': {
        objects: {
            helpdesk_ticket: { label: '工单', _validations: { closed_is_final: { message: ZH } } },
        },
    },
};

const i18nService = {
    getLocales: () => ['en', 'zh-CN'],
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

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
        getPackagedObjectBase: vi.fn((name: string) => (name === SERVED.name ? SERVED : undefined)),
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

/** The body of the last `res.json(...)` (indexed: this package's `lib` predates ES2022). */
function lastBody(res: ReturnType<typeof mockRes>): any {
    const calls = res.json.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : undefined;
}

async function listMessages(locale: string): Promise<unknown> {
    const res = mockRes();
    await routeFor(makeRest(), '/api/v1/meta/:type').handler(
        { method: 'GET', params: { type: 'object' }, query: {}, body: {}, headers: { 'accept-language': locale } },
        res,
    );
    const body = lastBody(res);
    const items = Array.isArray(body) ? body : body?.items ?? [];
    return items[0]?.validations?.map((r: any) => r.message);
}

async function itemMessages(locale: string): Promise<unknown> {
    const res = mockRes();
    await routeFor(makeRest(), '/api/v1/meta/:type/:name').handler(
        {
            method: 'GET',
            params: { type: 'object', name: 'helpdesk_ticket' },
            query: {},
            body: {},
            headers: { 'accept-language': locale },
        },
        res,
    );
    return lastBody(res)?.item?.validations?.map((r: any) => r.message);
}

describe('#27135 /meta serves validations[].message in the request locale', () => {
    it('by-name read serves the translated message, and the authored one where the bundle has none', async () => {
        expect(await itemMessages('zh-CN')).toEqual([ZH, UNTRANSLATED]);
    });

    it('list read serves the same', async () => {
        expect(await listMessages('zh-CN')).toEqual([ZH, UNTRANSLATED]);
    });

    it('a locale with no entry keeps the authored messages', async () => {
        expect(await itemMessages('en')).toEqual([AUTHORED, UNTRANSLATED]);
        expect(await listMessages('en')).toEqual([AUTHORED, UNTRANSLATED]);
    });
});
