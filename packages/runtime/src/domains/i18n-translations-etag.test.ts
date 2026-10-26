// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25785 — the translation bundle carries a validator, and a browser that
 * holds the current bundle is answered `304` instead of the whole bundle.
 *
 * ## The defect
 *
 * `GET /i18n/translations/:locale` answered every console open with the whole
 * locale bundle (288–361 KB raw, 80–88 KB compressed, measured on a hosted
 * tenant) and no `ETag` or `Cache-Control`, so nothing let the browser
 * revalidate what it already held.
 *
 * ## What is pinned
 *
 * - A: the `200` carries `ETag` and `Cache-Control: private, no-cache`, and its
 *   body is the envelope it always was.
 * - B: the validator is a hash of the bytes served — read here by recomputing
 *   it from the body, so a validator derived from anything cheaper (a counter,
 *   the bundle's identity) fails this file, not production.
 * - C: `If-None-Match` naming that representation, in every spelling RFC 9110
 *   §13.1.2 allows (strong or weak, a list, `*`) and through both header shapes
 *   a transport hands in, is answered `304` with the same two headers and no
 *   body; a stale or malformed one is served the full bundle.
 * - D: the anonymous floor still decides first — a matching validator does not
 *   turn the `401` into a `304`, and no refusal carries a validator.
 *
 * The wire half (both headers and the empty `304` over a real socket) is
 * `i18n-translations-etag.hono.integration.test.ts`.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';

import { handleI18nRequest } from './i18n.js';
import { apiErrorResponse } from '../error-envelope.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const MEMBER_EC = { userId: 'usr_member', isSystem: false, positions: [], permissions: [], systemPermissions: [] };

function member(headers: unknown = {}): HttpProtocolContext {
    return { request: { headers }, executionContext: { ...MEMBER_EC } } as unknown as HttpProtocolContext;
}

function anonymous(headers: unknown = {}): HttpProtocolContext {
    return { request: { headers } } as unknown as HttpProtocolContext;
}

function makeService(bundles: Record<string, Record<string, unknown>>) {
    return {
        getLocales: vi.fn(() => Object.keys(bundles)),
        getDefaultLocale: vi.fn(() => 'en'),
        getTranslations: vi.fn((locale: string) => bundles[locale] ?? {}),
    };
}

function makeDeps(service: ReturnType<typeof makeService>): DomainHandlerDeps {
    return {
        getService: vi.fn(async () => service),
        resolveService: vi.fn(async () => service),
        // The dispatcher's own envelope builder, `meta` slot included.
        success: (data: any, meta?: any) => ({ status: 200, body: { success: true, data, meta } }),
        error: (message: string, httpStatus = 500, details?: any) =>
            apiErrorResponse({ message, httpStatus, details }),
    } as unknown as DomainHandlerDeps;
}

const FR = { objects: { lead: { label: 'Prospect', fields: { company: { label: 'Société' } } } } };
const ZH_CN = { objects: { lead: { label: '潜在客户' } } };

/** The validator of a served body, recomputed from the bytes the transport writes. */
function validatorOf(body: unknown): string {
    return `W/"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`;
}

async function read(
    service: ReturnType<typeof makeService>,
    context: HttpProtocolContext,
    input: { subPath: string; query?: Record<string, unknown> } = { subPath: '/translations/fr' },
): Promise<any> {
    return handleI18nRequest(makeDeps(service), input.subPath, 'GET', input.query ?? {}, context);
}

// ── A + B: the 200 and its validator ────────────────────────────────────────

describe('#25785 A — a translations read carries its validator and cache directive', () => {
    it.each([
        ['the path spelling', { subPath: '/translations/fr' }],
        ['the query spelling', { subPath: '/translations', query: { locale: 'fr' } }],
    ])('%s: 200, the same body as before, plus ETag and Cache-Control: private, no-cache', async (_label, input) => {
        const result = await read(makeService({ en: {}, fr: FR }), member(), input);
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(200);
        expect(result.response.body).toEqual({ success: true, data: { locale: 'fr', translations: FR } });
        expect(result.response.headers['Cache-Control']).toBe('private, no-cache');
        expect(result.response.headers.ETag).toMatch(/^W\/"[A-Za-z0-9_-]{43}"$/);
    });

    it('the locale fallback arm (zh → zh-CN) carries them too, over its own body', async () => {
        const result = await read(makeService({ en: {}, 'zh-CN': ZH_CN }), member(), { subPath: '/translations/zh' });
        expect(result.response.status).toBe(200);
        expect(result.response.body.data).toEqual({ locale: 'zh-CN', requestedLocale: 'zh', translations: ZH_CN });
        expect(result.response.headers['Cache-Control']).toBe('private, no-cache');
        expect(result.response.headers.ETag).toBe(validatorOf(result.response.body));
    });

    it('a refusal carries no validator: the missing-locale 400', async () => {
        const result = await read(makeService({ fr: FR }), member(), { subPath: '/translations', query: {} });
        expect(result.response.status).toBe(400);
        expect(result.response.headers).toBeUndefined();
    });
});

describe('#25785 B — the validator is a hash of the bytes served, recomputed on every read', () => {
    it('equals the hash of the served envelope', async () => {
        const result = await read(makeService({ fr: FR }), member());
        expect(result.response.headers.ETag).toBe(validatorOf(result.response.body));
    });

    it('is stable while the bundle is unchanged, and moves when one string changes', async () => {
        const bundles: Record<string, Record<string, unknown>> = { fr: FR };
        const service = makeService(bundles);
        const first = (await read(service, member())).response.headers.ETag;
        expect((await read(service, member())).response.headers.ETag).toBe(first);

        bundles.fr = { objects: { lead: { label: 'Prospect', fields: { company: { label: 'Entreprise' } } } } };
        const changed = await read(service, member());
        expect(changed.response.headers.ETag).not.toBe(first);
        expect(changed.response.headers.ETag).toBe(validatorOf(changed.response.body));
    });

    it('moves when the bundle object is MUTATED in place — identity is not the validator', async () => {
        const mutable = { objects: { lead: { label: 'Prospect' } } } as Record<string, any>;
        const service = makeService({ fr: mutable });
        const before = (await read(service, member())).response.headers.ETag;
        mutable.objects.lead.label = 'Piste';
        expect((await read(service, member())).response.headers.ETag).not.toBe(before);
    });
});

// ── C: the conditional read ─────────────────────────────────────────────────

describe('#25785 C — If-None-Match naming the current bundle is answered 304, with no body', () => {
    async function currentValidator(): Promise<string> {
        return (await read(makeService({ fr: FR }), member())).response.headers.ETag;
    }

    function expectNotModified(result: any, etag: string) {
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(304);
        expect('body' in result.response).toBe(false);
        // RFC 9110 §15.4.5: the 304 carries the ETag and Cache-Control the 200 would.
        expect(result.response.headers).toEqual({ ETag: etag, 'Cache-Control': 'private, no-cache' });
    }

    it.each([
        ['the weak tag it was served', (etag: string) => etag],
        ['the strong spelling of it (weak comparison)', (etag: string) => etag.replace(/^W\//, '')],
        ['a list naming it after another tag', (etag: string) => `W/"stale", ${etag}`],
        ['a list without spaces', (etag: string) => `"stale",${etag}`],
        ['*', () => '*'],
    ])('%s → 304', async (_label, spell) => {
        const etag = await currentValidator();
        expectNotModified(await read(makeService({ fr: FR }), member({ 'if-none-match': spell(etag) })), etag);
    });

    it('through a Fetch Headers object (the @objectstack/hono catch-all hands its raw Request)', async () => {
        const etag = await currentValidator();
        expectNotModified(await read(makeService({ fr: FR }), member(new Headers({ 'If-None-Match': etag }))), etag);
    });

    it('through a repeated header in the record shape, read as one list', async () => {
        const etag = await currentValidator();
        expectNotModified(await read(makeService({ fr: FR }), member({ 'if-none-match': ['W/"stale"', etag] })), etag);
    });

    it('on the query spelling too', async () => {
        const etag = await currentValidator();
        const result = await read(
            makeService({ fr: FR }), member({ 'if-none-match': etag }), { subPath: '/translations', query: { locale: 'fr' } },
        );
        expectNotModified(result, etag);
    });

    it.each([
        ['a stale validator', 'W/"stale"'],
        ['an unquoted value (malformed: matches nothing)', 'stale'],
        ['an empty header', ''],
    ])('%s is served the full bundle with the current validator', async (_label, header) => {
        const etag = await currentValidator();
        const result = await read(makeService({ fr: FR }), member({ 'if-none-match': header }));
        expect(result.response.status).toBe(200);
        expect(result.response.body).toEqual({ success: true, data: { locale: 'fr', translations: FR } });
        expect(result.response.headers.ETag).toBe(etag);
    });

    it('a validator issued before the bundle changed is served the new bundle, never a 304', async () => {
        const bundles: Record<string, Record<string, unknown>> = { fr: FR };
        const service = makeService(bundles);
        const issued = (await read(service, member())).response.headers.ETag;
        bundles.fr = { objects: { lead: { label: 'Piste' } } };
        const result = await read(service, member({ 'if-none-match': issued }));
        expect(result.response.status).toBe(200);
        expect(result.response.body.data.translations).toEqual({ objects: { lead: { label: 'Piste' } } });
        expect(result.response.headers.ETag).not.toBe(issued);
    });

    it('a validator for one locale does not answer another locale 304', async () => {
        const service = makeService({ fr: FR, 'zh-CN': ZH_CN });
        const frEtag = (await read(service, member())).response.headers.ETag;
        const result = await read(service, member({ 'if-none-match': frEtag }), { subPath: '/translations/zh-CN' });
        expect(result.response.status).toBe(200);
        expect(result.response.body.data.translations).toEqual(ZH_CN);
    });
});

// ── D: the floor decides first ──────────────────────────────────────────────

describe('#25785 D — the anonymous floor still answers before any validator is read', () => {
    it('an anonymous caller holding the current validator gets 401, no 304 and no headers', async () => {
        const etag = (await read(makeService({ fr: FR }), member())).response.headers.ETag;
        const service = makeService({ fr: FR });
        const result = await read(service, anonymous({ 'if-none-match': etag }));
        expect(result.response.status).toBe(401);
        expect(result.response.body.error.code).toBe('UNAUTHENTICATED');
        expect(result.response.headers).toBeUndefined();
        expect(service.getTranslations).not.toHaveBeenCalled();
    });
});
