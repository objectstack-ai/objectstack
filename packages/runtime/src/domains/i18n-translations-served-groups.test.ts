// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25785 — the translation bundle a console open downloads leaves out
 * Studio's `metadataForms`, and Studio's forms stay translated.
 *
 * ## The defect
 *
 * `GET /i18n/translations/:locale` served the i18n service's whole locale tree,
 * `metadataForms` included: 75 KB of the 221 KB raw a console open downloaded
 * on `examples/app-crm` zh-CN, the second-largest group after `objects`. No
 * browser reads it there. Studio's authoring forms arrive already translated:
 * the `/meta` (`/meta/types`) handler resolves `metadataForms.<type>` on the
 * server, over the same service, before it serves each form.
 *
 * ## What is pinned
 *
 * - A: both exits (the requested locale and the `zh` → `zh-CN` fallback) and
 *   both spellings serve every group but the server-resolved ones, unchanged,
 *   and the body is the closed `GetTranslationsResponseSchema`.
 * - B: the service's own tree is never edited, and `/meta`, read over the same
 *   service AFTER a boot read, still serves Studio's form translated. That is
 *   the consumer an in-place delete would silently break.
 * - C: the validator still hashes the bytes served, so a warm reopen is still
 *   `304`, and a change confined to a group that is not served does not move it.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { RestServer } from '@objectstack/rest';
import { GetTranslationsResponseSchema } from '@objectstack/spec/api';
import { SERVER_RESOLVED_TRANSLATION_GROUPS } from '@objectstack/spec/system';

import { handleI18nRequest } from './i18n.js';
import { apiErrorResponse } from '../error-envelope.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const MEMBER_EC = { userId: 'usr_member', isSystem: false, positions: [], permissions: [], systemPermissions: [] };

function member(headers: Record<string, string> = {}): HttpProtocolContext {
    return { request: { headers }, executionContext: { ...MEMBER_EC } } as unknown as HttpProtocolContext;
}

type Bundles = Record<string, Record<string, unknown>>;

/** Hands back the STORED tree, as the core fallback and service-i18n both do. */
function makeService(bundles: Bundles) {
    return {
        getLocales: vi.fn(() => Object.keys(bundles)),
        getDefaultLocale: vi.fn(() => 'en'),
        getFallbackLocale: vi.fn(() => 'en'),
        getTranslations: vi.fn((locale: string) => bundles[locale] ?? {}),
    };
}

function makeDeps(service: ReturnType<typeof makeService>): DomainHandlerDeps {
    return {
        getService: vi.fn(async () => service),
        resolveService: vi.fn(async () => service),
        success: (data: any, meta?: any) => ({ status: 200, body: { success: true, data, meta } }),
        error: (message: string, httpStatus = 500, details?: any) =>
            apiErrorResponse({ message, httpStatus, details }),
    } as unknown as DomainHandlerDeps;
}

async function read(
    service: ReturnType<typeof makeService>,
    subPath = '/translations/zh-CN',
    query: Record<string, unknown> = {},
    context: HttpProtocolContext = member(),
): Promise<any> {
    return handleI18nRequest(makeDeps(service), subPath, 'GET', query, context);
}

function validatorOf(body: unknown): string {
    return `W/"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`;
}

/** The groups a console reads, as the platform bundle carries them. */
const SERVED_GROUPS = {
    objects: { lead: { label: '潜在客户', fields: { company: { label: '公司' } } } },
    apps: { crm: { label: '客户关系管理' } },
    settings: { mail: { title: '邮件投递' } },
    messages: { save: '保存' },
};

/** Studio's dashboard authoring form, translated the way platform-objects ships it. */
const METADATA_FORMS = {
    dashboard: {
        label: '仪表板',
        sections: { layout: { label: '布局' } },
        fields: { columns: { label: '列数', helpText: '栅格列数' } },
    },
};

function zhTree(): Record<string, unknown> {
    return { ...SERVED_GROUPS, metadataForms: METADATA_FORMS };
}

describe('#25785 A — the served document leaves the server-resolved groups out', () => {
    it('names metadataForms as a server-resolved group (the constant this door reads)', () => {
        expect(SERVER_RESOLVED_TRANSLATION_GROUPS).toContain('metadataForms');
    });

    it.each([
        ['the path spelling', '/translations/zh-CN', {}],
        ['the query spelling', '/translations', { locale: 'zh-CN' }],
    ])('%s: every other group is served unchanged, metadataForms is not', async (_label, subPath, query) => {
        const result = await read(makeService({ en: {}, 'zh-CN': zhTree() }), subPath, query);
        expect(result.response.status).toBe(200);
        expect(result.response.body.data).toEqual({ locale: 'zh-CN', translations: SERVED_GROUPS });
        expect(result.response.body.data.translations).not.toHaveProperty('metadataForms');
    });

    it('the locale fallback exit (zh → zh-CN) leaves it out too', async () => {
        const result = await read(makeService({ en: {}, 'zh-CN': zhTree() }), '/translations/zh');
        expect(result.response.status).toBe(200);
        expect(result.response.body.data).toEqual({ locale: 'zh-CN', requestedLocale: 'zh', translations: SERVED_GROUPS });
    });

    it('the body satisfies the closed GetTranslationsResponseSchema, which refuses the unserved group', async () => {
        const result = await read(makeService({ en: {}, 'zh-CN': zhTree() }));
        expect(GetTranslationsResponseSchema.safeParse(result.response.body.data).success).toBe(true);

        // Control: the same document WITH the group is refused by the schema, so
        // the parse above passes because the door left it out, not because the
        // schema reads nothing.
        const unserved = GetTranslationsResponseSchema.safeParse({ locale: 'zh-CN', translations: zhTree() });
        expect(unserved.success).toBe(false);
        expect(unserved.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
    });

    it('a tree with nothing to leave out is served as it is', async () => {
        const result = await read(makeService({ en: {}, 'zh-CN': { ...SERVED_GROUPS } }));
        expect(result.response.body.data.translations).toEqual(SERVED_GROUPS);
    });
});

// ── B: the service's tree, and the consumer that reads it ───────────────────

function mockRes() {
    return { json: vi.fn(), status: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() };
}

/** A RestServer whose `/meta` handler translates from `i18n` — the route Studio reads its forms from. */
function restOver(i18n: ReturnType<typeof makeService>): RestServer {
    const server = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const protocol = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn(async () => ({
            entries: [{
                type: 'dashboard',
                label: 'Dashboard',
                form: {
                    schemaId: 'dashboard',
                    type: 'simple',
                    sections: [{ name: 'layout', label: 'Layout', fields: [{ field: 'columns', type: 'number', label: 'Columns' }] }],
                },
            }],
            types: ['dashboard'],
            registered: ['dashboard'],
        })),
        getMetaItems: vi.fn(async () => []),
        getMetaItem: vi.fn(async () => undefined),
        getMetaItemCached: undefined as any,
        findData: vi.fn().mockResolvedValue([]),
    };
    const rest = new RestServer(
        server as any, protocol as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        async () => i18n,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    return rest;
}

async function readStudioForm(rest: RestServer, locale: string): Promise<any> {
    const route = (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta');
    if (!route) throw new Error('route not registered: GET /api/v1/meta');
    const res = mockRes();
    await route.handler({ method: 'GET', params: {}, query: {}, body: {}, headers: { 'accept-language': locale } }, res);
    const body = res.json.mock.calls.at(-1)?.[0];
    return body.entries.find((e: any) => e.type === 'dashboard');
}

describe("#25785 B — the service keeps the group, and Studio's forms stay translated", () => {
    it("a boot read does not edit the service's tree", async () => {
        const stored = zhTree();
        const service = makeService({ en: {}, 'zh-CN': stored });
        await read(service);
        expect(stored.metadataForms).toBe(METADATA_FORMS);
        expect(service.getTranslations('zh-CN')).toHaveProperty('metadataForms', METADATA_FORMS);
    });

    it('/meta, read over the same service after a boot read, serves the form translated', async () => {
        const service = makeService({ en: {}, 'zh-CN': zhTree() });
        const boot = await read(service);
        expect(boot.response.body.data.translations).not.toHaveProperty('metadataForms');

        const entry = await readStudioForm(restOver(service), 'zh-CN');
        expect(entry.label).toBe('仪表板');
        expect(entry.form.sections[0].label).toBe('布局');
        expect(entry.form.sections[0].fields[0].label).toBe('列数');
    });
});

// ── C: the validator, over the bytes now served ─────────────────────────────

describe('#25785 C — a warm reopen is still answered 304', () => {
    it('the validator hashes the served body, and naming it answers 304', async () => {
        const service = makeService({ en: {}, 'zh-CN': zhTree() });
        const first = await read(service);
        expect(first.response.headers.ETag).toBe(validatorOf(first.response.body));

        const again = await read(service, '/translations/zh-CN', {}, member({ 'if-none-match': first.response.headers.ETag }));
        expect(again.response.status).toBe(304);
        expect(again.response.body).toBeUndefined();
    });

    it('a change confined to an unserved group serves the same bytes, so the validator holds', async () => {
        const bundles: Bundles = { en: {}, 'zh-CN': zhTree() };
        const service = makeService(bundles);
        const before = (await read(service)).response.headers.ETag;

        bundles['zh-CN'] = { ...SERVED_GROUPS, metadataForms: { dashboard: { label: '看板' } } };
        expect((await read(service)).response.headers.ETag).toBe(before);

        bundles['zh-CN'] = { ...SERVED_GROUPS, messages: { save: '存储' }, metadataForms: METADATA_FORMS };
        expect((await read(service)).response.headers.ETag).not.toBe(before);
    });
});
